import { describe, it, expect, vi } from 'vitest';
import { NotFoundException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { SettingsService } from './settings.service';
import { PrismaService } from '../../../prisma/prisma.service';
import { AuditService } from '../../audit/audit.service';

const D = (s: string) => new Prisma.Decimal(s);

function fakeSettingsRow(overrides: Record<string, unknown> = {}) {
  return {
    id: 1,
    default_sweep_rate: D('0.080000'),
    shortfall_warning_threshold: D('0.005000'),
    concentration_warning_threshold: D('0.150000'),
    updated_at: new Date('2026-04-15T00:00:00.000Z'),
    updated_by: null,
    ...overrides,
  };
}

function makeAudit() {
  return { recordChange: vi.fn().mockResolvedValue(undefined) } as unknown as AuditService;
}

function makePrismaForSettings(opts: {
  existing?: Record<string, unknown> | null;
} = {}) {
  const tx = {
    setting: {
      findUnique: vi.fn().mockResolvedValue(opts.existing === null ? null : (opts.existing ?? fakeSettingsRow())),
      update: vi.fn().mockImplementation(async ({ data, where }: { data: Record<string, unknown>; where: { id: number } }) => ({
        ...(opts.existing ?? fakeSettingsRow()),
        ...data,
        id: where.id,
      })),
    },
  };
  const prisma = {
    $transaction: vi.fn(async (cb: (t: typeof tx) => Promise<unknown>) => cb(tx)),
    setting: {
      findUnique: tx.setting.findUnique,
      update: tx.setting.update,
    },
  } as unknown as PrismaService;
  (prisma as unknown as { _tx: typeof tx })._tx = tx;
  return prisma;
}

describe('SettingsService.get', () => {
  it('returns the singleton row mapped via toSettings', async () => {
    const prisma = makePrismaForSettings();
    const svc = new SettingsService(prisma, makeAudit());
    const r = await svc.get();
    expect(r.default_sweep_rate).toBe('0.080000');
    expect(r.shortfall_warning_threshold).toBe('0.005000');
    expect(r.concentration_warning_threshold).toBe('0.150000');
    expect(r.updated_by).toBeNull();
  });

  it('throws 404 when settings row missing', async () => {
    const prisma = makePrismaForSettings({ existing: null });
    const svc = new SettingsService(prisma, makeAudit());
    await expect(svc.get()).rejects.toBeInstanceOf(NotFoundException);
  });
});

describe('SettingsService.update', () => {
  it('happy path: writes only changed fields, bumps updated_at + updated_by_id, audits with diff (stringified)', async () => {
    const existing = fakeSettingsRow();
    const prisma = makePrismaForSettings({ existing });
    const audit = makeAudit();
    const svc = new SettingsService(prisma, audit);

    const r = await svc.update(
      { default_sweep_rate: 0.09, concentration_warning_threshold: 0.2 },
      'actor-1',
    );

    const tx = (prisma as unknown as {
      _tx: { setting: { update: ReturnType<typeof vi.fn> } };
    })._tx;
    expect(tx.setting.update).toHaveBeenCalledOnce();
    const updateArg = tx.setting.update.mock.calls[0]![0] as {
      where: { id: number };
      data: Record<string, unknown>;
    };
    expect(updateArg.where.id).toBe(1);
    expect((updateArg.data.default_sweep_rate as Prisma.Decimal).equals(D('0.09'))).toBe(true);
    expect((updateArg.data.concentration_warning_threshold as Prisma.Decimal).equals(D('0.2'))).toBe(true);
    expect(updateArg.data.shortfall_warning_threshold).toBeUndefined();
    expect(updateArg.data.updated_by_id).toBe('actor-1');
    expect(updateArg.data.updated_at).toBeInstanceOf(Date);

    expect(audit.recordChange).toHaveBeenCalledOnce();
    const auditArg = (audit.recordChange as ReturnType<typeof vi.fn>).mock.calls[0]![0] as {
      entityType: string;
      entityId: string;
      action: string;
      payload: { changed: Record<string, { from: string; to: string }> };
    };
    expect(auditArg.entityType).toBe('setting');
    expect(auditArg.entityId).toBe('1');
    expect(auditArg.action).toBe('update');
    expect(auditArg.payload.changed.default_sweep_rate).toEqual({ from: '0.080000', to: '0.090000' });
    expect(auditArg.payload.changed.concentration_warning_threshold).toEqual({ from: '0.150000', to: '0.200000' });
    expect(auditArg.payload.changed.shortfall_warning_threshold).toBeUndefined();

    expect(r.default_sweep_rate).toBe('0.090000');
  });

  it('no-op: client sends value identical to current → no write, no audit, returns current shape', async () => {
    const existing = fakeSettingsRow();
    const prisma = makePrismaForSettings({ existing });
    const audit = makeAudit();
    const svc = new SettingsService(prisma, audit);

    const r = await svc.update({ default_sweep_rate: 0.08 }, 'actor-1');

    const tx = (prisma as unknown as {
      _tx: { setting: { update: ReturnType<typeof vi.fn> } };
    })._tx;
    expect(tx.setting.update).not.toHaveBeenCalled();
    expect(audit.recordChange).not.toHaveBeenCalled();
    expect(r.default_sweep_rate).toBe('0.080000');
  });

  it('throws 404 when settings row missing', async () => {
    const prisma = makePrismaForSettings({ existing: null });
    const svc = new SettingsService(prisma, makeAudit());
    await expect(
      svc.update({ default_sweep_rate: 0.09 }, 'actor-1'),
    ).rejects.toBeInstanceOf(NotFoundException);
  });
});

import { describe, it, expect, vi } from 'vitest';
import { ConflictException, NotFoundException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { InvestorsService } from './investors.service';
import { PrismaService } from '../../../prisma/prisma.service';
import { AuditService } from '../../audit/audit.service';

function makePrisma() {
  return {
    investor: {
      findMany: vi.fn().mockResolvedValue([]),
      count: vi.fn().mockResolvedValue(0),
      findUnique: vi.fn(),
      create: vi.fn(),
    },
    certificate: {
      groupBy: vi.fn().mockResolvedValue([]),
      aggregate: vi.fn().mockResolvedValue({ _sum: { investor_capital: null } }),
      count: vi.fn().mockResolvedValue(0),
    },
  } as unknown as PrismaService;
}

function makeAudit() {
  return { recordChange: vi.fn().mockResolvedValue(undefined) } as unknown as AuditService;
}

describe('InvestorsService.list', () => {
  it('returns paginated mapped investors with active_cert_count and total_invested', async () => {
    const prisma = makePrisma();
    (prisma.investor.findMany as ReturnType<typeof vi.fn>).mockResolvedValueOnce([
      {
        id: 'i-1',
        legal_name: 'Inversora Alpha',
        rif: 'J-12345678-9',
        kind: 'juridica',
        status: 'active',
        email: null,
        phone: null,
        notes: null,
        created_at: new Date('2026-04-15'),
        updated_at: new Date('2026-04-15'),
        updated_by: null,
      },
    ]);
    (prisma.investor.count as ReturnType<typeof vi.fn>).mockResolvedValueOnce(1);
    (prisma.certificate.groupBy as ReturnType<typeof vi.fn>).mockResolvedValueOnce([
      { investor_id: 'i-1', _count: { _all: 2 } },
    ]);
    (prisma.certificate.aggregate as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
      _sum: { investor_capital: new Prisma.Decimal('285000.00') },
    });

    const svc = new InvestorsService(prisma, makeAudit());
    const r = await svc.list({ limit: 50, offset: 0, sort: 'name_asc' });
    expect(r.total).toBe(1);
    expect(r.data[0]!.active_cert_count).toBe(2);
    expect(r.data[0]!.total_invested).toBe('285000.0000');
  });

  it('passes q-search across legal_name and rif (case-insensitive)', async () => {
    const prisma = makePrisma();
    const svc = new InvestorsService(prisma, makeAudit());
    await svc.list({ limit: 50, offset: 0, sort: 'name_asc', q: 'Alpha' });
    const call = (prisma.investor.findMany as ReturnType<typeof vi.fn>).mock.calls[0]![0];
    expect(call.where.OR).toEqual([
      { legal_name: { contains: 'Alpha', mode: 'insensitive' } },
      { rif: { contains: 'Alpha', mode: 'insensitive' } },
    ]);
  });
});

describe('InvestorsService.detail', () => {
  it('returns mapped investor', async () => {
    const prisma = makePrisma();
    (prisma.investor.findUnique as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
      id: 'i-1',
      legal_name: 'Inversora Alpha',
      rif: 'J-12345678-9',
      kind: 'juridica',
      status: 'active',
      email: null,
      phone: null,
      notes: null,
      created_at: new Date('2026-04-15'),
      updated_at: new Date('2026-04-15'),
      updated_by: null,
    });
    (prisma.certificate.aggregate as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
      _sum: { investor_capital: new Prisma.Decimal('100000.00') },
    });

    const svc = new InvestorsService(prisma, makeAudit());
    const r = await svc.detail('i-1');
    expect(r.legal_name).toBe('Inversora Alpha');
    expect(r.total_invested).toBe('100000.0000');
  });

  it('throws NotFoundException when investor missing', async () => {
    const prisma = makePrisma();
    (prisma.investor.findUnique as ReturnType<typeof vi.fn>).mockResolvedValueOnce(null);
    const svc = new InvestorsService(prisma, makeAudit());
    await expect(svc.detail('missing')).rejects.toBeInstanceOf(NotFoundException);
  });
});

describe('InvestorsService.create', () => {
  it('normalizes RIF, persists, records audit', async () => {
    const prisma = makePrisma();
    (prisma.investor.findUnique as ReturnType<typeof vi.fn>).mockResolvedValueOnce(null);
    (prisma.investor.create as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
      id: 'i-2',
      legal_name: 'Nueva Inversora',
      rif: 'J-30123456-7',
      kind: 'juridica',
      status: 'active',
      email: null,
      phone: null,
      notes: null,
      created_at: new Date(),
      updated_at: new Date(),
      updated_by: null,
    });
    const audit = makeAudit();
    const svc = new InvestorsService(prisma, audit);

    const r = await svc.create({
      input: { legal_name: 'Nueva Inversora', rif: 'j-30123456-7', kind: 'juridica' },
      actorId: 'a-1',
    });
    expect(r.rif).toBe('J-30123456-7');
    const createCall = (prisma.investor.create as ReturnType<typeof vi.fn>).mock.calls[0]![0];
    expect(createCall.data.rif).toBe('J-30123456-7');
    expect(audit.recordChange).toHaveBeenCalledOnce();
  });

  it('throws ConflictException when RIF already exists', async () => {
    const prisma = makePrisma();
    (prisma.investor.findUnique as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
      id: 'existing-1',
    });
    const svc = new InvestorsService(prisma, makeAudit());
    await expect(
      svc.create({
        input: { legal_name: 'X', rif: 'J-12345678-9', kind: 'juridica' },
        actorId: 'a-1',
      }),
    ).rejects.toBeInstanceOf(ConflictException);
  });
});

function fakeInvestorRow(overrides: Record<string, unknown> = {}) {
  return {
    id: 'i-1',
    legal_name: 'Inversora Alpha',
    rif: 'J-12345678-9',
    kind: 'juridica',
    status: 'active',
    email: 'alpha@cashea.app',
    phone: null,
    notes: null,
    created_at: new Date('2026-04-15'),
    updated_at: new Date('2026-04-15'),
    updated_by: null,
    ...overrides,
  };
}

function makePrismaForUpdate(
  opts: {
    existing?: Record<string, unknown> | null;
    updateThrows?: Error;
  } = {},
) {
  const tx = {
    investor: {
      findUnique: vi
        .fn()
        .mockResolvedValue(opts.existing === null ? null : (opts.existing ?? fakeInvestorRow())),
      update: opts.updateThrows
        ? vi.fn().mockRejectedValue(opts.updateThrows)
        : vi
            .fn()
            .mockImplementation(
              async ({
                data,
                where,
              }: {
                data: Record<string, unknown>;
                where: { id: string };
              }) => ({
                ...(opts.existing ?? fakeInvestorRow()),
                ...data,
                id: where.id,
              }),
            ),
    },
    certificate: {
      count: vi.fn().mockResolvedValue(0),
      aggregate: vi.fn().mockResolvedValue({ _sum: { investor_capital: null } }),
    },
  };
  const prisma = {
    $transaction: vi.fn(async (cb: (t: typeof tx) => Promise<unknown>) => cb(tx)),
    ...tx,
  } as unknown as PrismaService;
  (prisma as unknown as { _tx: typeof tx })._tx = tx;
  return prisma;
}

describe('InvestorsService.update', () => {
  it('happy path: writes only changed fields, bumps updated_at + updated_by_id, audits with diff', async () => {
    const existing = fakeInvestorRow();
    const prisma = makePrismaForUpdate({ existing });
    const audit = makeAudit();
    const svc = new InvestorsService(prisma, audit);

    const r = await svc.update('i-1', { email: 'new@cashea.app', notes: 'New notes' }, 'actor-1');

    const tx = (
      prisma as unknown as {
        _tx: { investor: { update: ReturnType<typeof vi.fn> } };
      }
    )._tx;
    expect(tx.investor.update).toHaveBeenCalledOnce();
    const updateArg = tx.investor.update.mock.calls[0]![0] as {
      where: { id: string };
      data: Record<string, unknown>;
    };
    expect(updateArg.where.id).toBe('i-1');
    expect(updateArg.data.email).toBe('new@cashea.app');
    expect(updateArg.data.notes).toBe('New notes');
    // legal_name not in input → not in data
    expect(updateArg.data.legal_name).toBeUndefined();
    expect(updateArg.data.updated_by_id).toBe('actor-1');
    expect(updateArg.data.updated_at).toBeInstanceOf(Date);

    expect(audit.recordChange).toHaveBeenCalledOnce();
    const auditArg = (audit.recordChange as ReturnType<typeof vi.fn>).mock.calls[0]![0] as {
      entityType: string;
      action: string;
      payload: { changed: Record<string, { from: unknown; to: unknown }> };
    };
    expect(auditArg.entityType).toBe('investor');
    expect(auditArg.action).toBe('update');
    expect(auditArg.payload.changed.email).toEqual({
      from: 'alpha@cashea.app',
      to: 'new@cashea.app',
    });
    expect(auditArg.payload.changed.notes).toEqual({ from: null, to: 'New notes' });

    expect(r.email).toBe('new@cashea.app');
  });

  it('no-op: client sends value identical to current → no write, no audit, returns current shape', async () => {
    const existing = fakeInvestorRow({ email: 'same@cashea.app' });
    const prisma = makePrismaForUpdate({ existing });
    const audit = makeAudit();
    const svc = new InvestorsService(prisma, audit);

    const r = await svc.update('i-1', { email: 'same@cashea.app' }, 'actor-1');

    const tx = (
      prisma as unknown as {
        _tx: { investor: { update: ReturnType<typeof vi.fn> } };
      }
    )._tx;
    expect(tx.investor.update).not.toHaveBeenCalled();
    expect(audit.recordChange).not.toHaveBeenCalled();
    expect(r.email).toBe('same@cashea.app');
  });

  it('throws 404 when investor id not found', async () => {
    const prisma = makePrismaForUpdate({ existing: null });
    const svc = new InvestorsService(prisma, makeAudit());
    await expect(svc.update('missing', { email: 'x@y.com' }, 'actor-1')).rejects.toBeInstanceOf(
      NotFoundException,
    );
  });

  it('throws 409 with kind: internal when status changes on internal investor', async () => {
    const existing = fakeInvestorRow({ kind: 'internal' });
    const prisma = makePrismaForUpdate({ existing });
    const svc = new InvestorsService(prisma, makeAudit());
    await expect(svc.update('i-1', { status: 'inactive' }, 'actor-1')).rejects.toBeInstanceOf(
      ConflictException,
    );
  });

  it('allows changing legal_name and email on internal investor (only status is locked)', async () => {
    const existing = fakeInvestorRow({ kind: 'internal' });
    const prisma = makePrismaForUpdate({ existing });
    const svc = new InvestorsService(prisma, makeAudit());

    const r = await svc.update(
      'i-1',
      { legal_name: 'Grupo Cashea Ve C.A. (renamed)', email: 'new@cashea.app' },
      'actor-1',
    );
    expect(r.legal_name).toBe('Grupo Cashea Ve C.A. (renamed)');
    expect(r.email).toBe('new@cashea.app');
  });

  it('clears nullable field when client sends null', async () => {
    const existing = fakeInvestorRow({ email: 'old@cashea.app' });
    const prisma = makePrismaForUpdate({ existing });
    const svc = new InvestorsService(prisma, makeAudit());

    await svc.update('i-1', { email: null }, 'actor-1');

    const tx = (
      prisma as unknown as {
        _tx: { investor: { update: ReturnType<typeof vi.fn> } };
      }
    )._tx;
    const updateArg = tx.investor.update.mock.calls[0]![0] as {
      data: Record<string, unknown>;
    };
    expect(updateArg.data.email).toBeNull();
  });
});

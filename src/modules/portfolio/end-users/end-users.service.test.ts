import { describe, it, expect, vi } from 'vitest';
import { NotFoundException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { EndUsersService } from './end-users.service';
import { PrismaService } from '../../../prisma/prisma.service';
import { AuditService } from '../../audit/audit.service';

function fakeUser(overrides: Record<string, unknown> = {}) {
  return {
    id: 'u-1',
    external_hash: 'smoke-user-1',
    full_name: null as string | null,
    national_id: null as string | null,
    email: null as string | null,
    phone: null as string | null,
    enriched_at: null as Date | null,
    first_seen_at: new Date('2026-04-01'),
    last_seen_at: new Date('2026-05-06'),
    _count: { orders: 1 },
    ...overrides,
  };
}

function makePrismaWithTx(tx: unknown) {
  return {
    $transaction: vi.fn(async (cb: (t: unknown) => Promise<unknown>) => cb(tx)),
    endUser: {
      findMany: vi.fn().mockResolvedValue([]),
      count: vi.fn().mockResolvedValue(0),
      findUnique: vi.fn(),
    },
    order: {
      groupBy: vi.fn().mockResolvedValue([]),
      aggregate: vi.fn().mockResolvedValue({ _sum: { total_amount: null } }),
    },
  };
}

function makeAudit() {
  return { recordChange: vi.fn().mockResolvedValue(undefined) } as unknown as AuditService;
}

describe('EndUsersService.list', () => {
  it('returns paginated mapped users', async () => {
    const tx = {};
    const prisma = makePrismaWithTx(tx);
    (prisma.endUser.findMany as ReturnType<typeof vi.fn>).mockResolvedValueOnce([fakeUser()]);
    (prisma.endUser.count as ReturnType<typeof vi.fn>).mockResolvedValueOnce(1);
    const svc = new EndUsersService(prisma as unknown as PrismaService, makeAudit());
    const r = await svc.list({ limit: 50, offset: 0, sort: 'last_seen_desc' });
    expect(r.total).toBe(1);
    expect(r.data[0]!.external_hash).toBe('smoke-user-1');
  });

  it('passes q-search across the 5 textual fields', async () => {
    const prisma = makePrismaWithTx({});
    const svc = new EndUsersService(prisma as unknown as PrismaService, makeAudit());
    await svc.list({ limit: 50, offset: 0, sort: 'last_seen_desc', q: 'pedro' });
    const call = (prisma.endUser.findMany as ReturnType<typeof vi.fn>).mock.calls[0]![0];
    expect(call.where.OR).toEqual([
      { external_hash: { contains: 'pedro', mode: 'insensitive' } },
      { full_name: { contains: 'pedro', mode: 'insensitive' } },
      { national_id: { contains: 'pedro', mode: 'insensitive' } },
      { email: { contains: 'pedro', mode: 'insensitive' } },
      { phone: { contains: 'pedro', mode: 'insensitive' } },
    ]);
  });

  it('filters by has_national_id=true', async () => {
    const prisma = makePrismaWithTx({});
    const svc = new EndUsersService(prisma as unknown as PrismaService, makeAudit());
    await svc.list({ limit: 50, offset: 0, sort: 'last_seen_desc', has_national_id: true });
    const call = (prisma.endUser.findMany as ReturnType<typeof vi.fn>).mock.calls[0]![0];
    expect(call.where.national_id).toEqual({ not: null });
  });
});

describe('EndUsersService.detail', () => {
  it('returns user with orders_summary', async () => {
    const tx = { endUser: { findUnique: vi.fn() }, order: { groupBy: vi.fn(), aggregate: vi.fn() } };
    const prisma = makePrismaWithTx(tx);
    (prisma.endUser.findUnique as ReturnType<typeof vi.fn>).mockResolvedValueOnce(fakeUser());
    (prisma.order.groupBy as ReturnType<typeof vi.fn>).mockResolvedValueOnce([{ status: 'available', _count: { _all: 1 } }]);
    (prisma.order.aggregate as ReturnType<typeof vi.fn>).mockResolvedValueOnce({ _sum: { total_amount: new Prisma.Decimal('300.00') } });
    const svc = new EndUsersService(prisma as unknown as PrismaService, makeAudit());
    const r = await svc.detail('u-1');
    expect(r.orders_summary.total_amount).toBe('300.0000');
    expect(r.orders_summary.by_status.available).toBe(1);
  });

  it('throws NotFoundException when not found', async () => {
    const prisma = makePrismaWithTx({});
    (prisma.endUser.findUnique as ReturnType<typeof vi.fn>).mockResolvedValueOnce(null);
    const svc = new EndUsersService(prisma as unknown as PrismaService, makeAudit());
    await expect(svc.detail('missing')).rejects.toBeInstanceOf(NotFoundException);
  });
});

describe('EndUsersService.update', () => {
  it('throws 404 when end_user missing', async () => {
    const tx = {
      endUser: { findUnique: vi.fn().mockResolvedValueOnce(null), update: vi.fn() },
      order: { groupBy: vi.fn().mockResolvedValue([]), aggregate: vi.fn().mockResolvedValue({ _sum: { total_amount: null } }) },
    };
    const prisma = makePrismaWithTx(tx);
    const audit = makeAudit();
    const svc = new EndUsersService(prisma as unknown as PrismaService, audit);
    await expect(
      svc.update({ id: 'missing', patch: { email: 'x@y.com' }, actorId: 'a-1' }),
    ).rejects.toBeInstanceOf(NotFoundException);
  });

  it('updates fields, sets enriched_at, records audit row with diff', async () => {
    const before = fakeUser({ email: null, full_name: null });
    const after = fakeUser({ email: 'x@y.com', full_name: 'Pedro', enriched_at: new Date() });
    const tx = {
      endUser: {
        findUnique: vi.fn().mockResolvedValueOnce(before),
        update: vi.fn().mockResolvedValueOnce(after),
      },
      order: {
        groupBy: vi.fn().mockResolvedValue([]),
        aggregate: vi.fn().mockResolvedValue({ _sum: { total_amount: null } }),
      },
    };
    const prisma = makePrismaWithTx(tx);
    const audit = makeAudit();
    const svc = new EndUsersService(prisma as unknown as PrismaService, audit);

    const r = await svc.update({
      id: 'u-1',
      patch: { email: 'x@y.com', full_name: 'Pedro' },
      actorId: 'a-1',
    });

    expect(tx.endUser.update).toHaveBeenCalledOnce();
    const updateCall = (tx.endUser.update as ReturnType<typeof vi.fn>).mock.calls[0]![0];
    expect(updateCall.data.email).toBe('x@y.com');
    expect(updateCall.data.full_name).toBe('Pedro');
    expect(updateCall.data.enriched_at).toBeInstanceOf(Date);

    expect(audit.recordChange).toHaveBeenCalledOnce();
    const auditCall = (audit.recordChange as ReturnType<typeof vi.fn>).mock.calls[0]![0];
    expect(auditCall.entityType).toBe('end_user');
    expect(auditCall.entityId).toBe('u-1');
    expect(auditCall.action).toBe('update');
    expect(auditCall.payload.before).toEqual({ email: null, full_name: null });
    expect(auditCall.payload.after).toEqual({ email: 'x@y.com', full_name: 'Pedro' });
    expect(r.email).toBe('x@y.com');
  });

  it('is no-op when patch matches current values: no update, no audit', async () => {
    const before = fakeUser({ email: 'x@y.com' });
    const tx = {
      endUser: { findUnique: vi.fn().mockResolvedValueOnce(before), update: vi.fn() },
      order: { groupBy: vi.fn().mockResolvedValue([]), aggregate: vi.fn().mockResolvedValue({ _sum: { total_amount: null } }) },
    };
    const prisma = makePrismaWithTx(tx);
    const audit = makeAudit();
    const svc = new EndUsersService(prisma as unknown as PrismaService, audit);
    await svc.update({ id: 'u-1', patch: { email: 'x@y.com' }, actorId: 'a-1' });
    expect(tx.endUser.update).not.toHaveBeenCalled();
    expect(audit.recordChange).not.toHaveBeenCalled();
  });

  it('clears a field when patch sends null', async () => {
    const before = fakeUser({ email: 'old@y.com' });
    const after = fakeUser({ email: null });
    const tx = {
      endUser: {
        findUnique: vi.fn().mockResolvedValueOnce(before),
        update: vi.fn().mockResolvedValueOnce(after),
      },
      order: { groupBy: vi.fn().mockResolvedValue([]), aggregate: vi.fn().mockResolvedValue({ _sum: { total_amount: null } }) },
    };
    const prisma = makePrismaWithTx(tx);
    const audit = makeAudit();
    const svc = new EndUsersService(prisma as unknown as PrismaService, audit);
    await svc.update({ id: 'u-1', patch: { email: null }, actorId: 'a-1' });
    const updateCall = (tx.endUser.update as ReturnType<typeof vi.fn>).mock.calls[0]![0];
    expect(updateCall.data.email).toBeNull();
  });
});

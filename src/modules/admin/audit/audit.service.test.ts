import { describe, it, expect, vi } from 'vitest';
import { AuditQueryService } from './audit.service';
import { PrismaService } from '../../../prisma/prisma.service';

function fakeAuditRow(overrides: Record<string, unknown> = {}) {
  return {
    id: 'audit-1',
    occurred_at: new Date('2026-05-07T12:00:00.000Z'),
    actor_id: 'u-1',
    actor: { id: 'u-1', email: 'op@cashea.app', full_name: 'Operator' },
    action: 'update',
    entity_type: 'investor',
    entity_id: 'inv-1',
    ip_address: null,
    user_agent: null,
    payload: { changed: { email: { from: 'a@x.com', to: 'b@y.com' } } },
    ...overrides,
  };
}

function makePrismaForAudit(opts: {
  rows?: Array<Record<string, unknown>>;
  total?: number;
} = {}) {
  return {
    auditLog: {
      findMany: vi.fn().mockResolvedValue(opts.rows ?? []),
      count: vi.fn().mockResolvedValue(opts.total ?? 0),
    },
  } as unknown as PrismaService;
}

describe('AuditQueryService.list', () => {
  it('returns paginated rows mapped via toAuditEntry (actor expanded, payload pass-through)', async () => {
    const prisma = makePrismaForAudit({ rows: [fakeAuditRow()], total: 1 });
    const svc = new AuditQueryService(prisma);
    const r = await svc.list({ limit: 50, offset: 0 });
    expect(r.total).toBe(1);
    expect(r.data[0]!.actor).toEqual({ id: 'u-1', email: 'op@cashea.app', full_name: 'Operator' });
    expect(r.data[0]!.payload).toEqual({ changed: { email: { from: 'a@x.com', to: 'b@y.com' } } });
    expect(r.data[0]!.occurred_at).toBe('2026-05-07T12:00:00.000Z');
  });

  it('with no filters: where is empty, orderBy occurred_at desc', async () => {
    const prisma = makePrismaForAudit();
    const svc = new AuditQueryService(prisma);
    await svc.list({ limit: 50, offset: 0 });
    const findManyArg = (prisma.auditLog.findMany as ReturnType<typeof vi.fn>).mock.calls[0]![0];
    expect(findManyArg.where).toEqual({});
    expect(findManyArg.orderBy).toEqual({ occurred_at: 'desc' });
    expect(findManyArg.take).toBe(50);
    expect(findManyArg.skip).toBe(0);
    expect(findManyArg.include).toEqual({ actor: true });
  });

  it('with entity_type=setting + entity_id=1: where has both', async () => {
    const prisma = makePrismaForAudit();
    const svc = new AuditQueryService(prisma);
    await svc.list({ limit: 50, offset: 0, entity_type: 'setting', entity_id: '1' });
    const findManyArg = (prisma.auditLog.findMany as ReturnType<typeof vi.fn>).mock.calls[0]![0];
    expect(findManyArg.where).toEqual({ entity_type: 'setting', entity_id: '1' });
  });

  it('with actor_id and date range: where has actor_id and occurred_at gte/lte', async () => {
    const prisma = makePrismaForAudit();
    const svc = new AuditQueryService(prisma);
    const from = new Date('2026-05-01T00:00:00.000Z');
    const to = new Date('2026-05-31T23:59:59.000Z');
    await svc.list({
      limit: 50, offset: 0,
      actor_id: '00000000-0000-4000-8000-000000000001',
      occurred_at_from: from,
      occurred_at_to: to,
    });
    const findManyArg = (prisma.auditLog.findMany as ReturnType<typeof vi.fn>).mock.calls[0]![0];
    expect(findManyArg.where).toEqual({
      actor_id: '00000000-0000-4000-8000-000000000001',
      occurred_at: { gte: from, lte: to },
    });
  });

  it('returns empty data: [] when count is 0', async () => {
    const prisma = makePrismaForAudit({ rows: [], total: 0 });
    const svc = new AuditQueryService(prisma);
    const r = await svc.list({ limit: 50, offset: 0 });
    expect(r.data).toEqual([]);
    expect(r.total).toBe(0);
  });
});

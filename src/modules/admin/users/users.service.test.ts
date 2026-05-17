import { describe, it, expect, vi } from 'vitest';
import { UsersService } from './users.service';
import { PrismaService } from '../../../prisma/prisma.service';
import { AuditService } from '../../audit/audit.service';

function makeAudit() {
  return { recordChange: vi.fn().mockResolvedValue(undefined) } as unknown as AuditService;
}

interface UserRow {
  id: string;
  email: string;
  full_name: string;
  role: 'operator' | 'admin' | 'auditor';
  is_active: boolean;
  last_login_at: Date | null;
  created_at: Date;
}

function makePrismaForUsers(opts: { findManyResult?: UserRow[] } = {}) {
  const prisma = {
    user: {
      findMany: vi.fn().mockResolvedValue(opts.findManyResult ?? []),
    },
  } as unknown as PrismaService;
  return prisma;
}

describe('UsersService.list', () => {
  it('returns { data, total } sorted by created_at desc when no filters', async () => {
    const u1: UserRow = {
      id: 'u-1',
      email: 'a@x.com',
      full_name: 'Ana',
      role: 'operator',
      is_active: true,
      last_login_at: null,
      created_at: new Date('2026-04-01T00:00:00Z'),
    };
    const prisma = makePrismaForUsers({ findManyResult: [u1] });
    const svc = new UsersService(prisma, makeAudit());

    const r = await svc.list({});

    expect(r.total).toBe(1);
    expect(r.data).toHaveLength(1);
    expect(r.data[0]).toEqual({
      id: 'u-1',
      email: 'a@x.com',
      full_name: 'Ana',
      role: 'operator',
      is_active: true,
      last_login_at: null,
      created_at: '2026-04-01T00:00:00.000Z',
    });
    const arg = (prisma.user.findMany as ReturnType<typeof vi.fn>).mock.calls[0]![0];
    expect(arg.orderBy).toEqual({ created_at: 'desc' });
    expect(arg.where).toEqual({});
  });

  it('filters by q (email OR full_name, case-insensitive)', async () => {
    const prisma = makePrismaForUsers();
    const svc = new UsersService(prisma, makeAudit());
    await svc.list({ q: 'Ana' });
    const arg = (prisma.user.findMany as ReturnType<typeof vi.fn>).mock.calls[0]![0];
    expect(arg.where).toEqual({
      OR: [
        { email: { contains: 'Ana', mode: 'insensitive' } },
        { full_name: { contains: 'Ana', mode: 'insensitive' } },
      ],
    });
  });

  it('filters by role', async () => {
    const prisma = makePrismaForUsers();
    const svc = new UsersService(prisma, makeAudit());
    await svc.list({ role: 'admin' });
    const arg = (prisma.user.findMany as ReturnType<typeof vi.fn>).mock.calls[0]![0];
    expect(arg.where).toEqual({ role: 'admin' });
  });

  it('filters by is_active', async () => {
    const prisma = makePrismaForUsers();
    const svc = new UsersService(prisma, makeAudit());
    await svc.list({ is_active: false });
    const arg = (prisma.user.findMany as ReturnType<typeof vi.fn>).mock.calls[0]![0];
    expect(arg.where).toEqual({ is_active: false });
  });

  it('combines all filters with AND', async () => {
    const prisma = makePrismaForUsers();
    const svc = new UsersService(prisma, makeAudit());
    await svc.list({ q: 'maria', role: 'operator', is_active: true });
    const arg = (prisma.user.findMany as ReturnType<typeof vi.fn>).mock.calls[0]![0];
    expect(arg.where).toEqual({
      OR: [
        { email: { contains: 'maria', mode: 'insensitive' } },
        { full_name: { contains: 'maria', mode: 'insensitive' } },
      ],
      role: 'operator',
      is_active: true,
    });
  });
});

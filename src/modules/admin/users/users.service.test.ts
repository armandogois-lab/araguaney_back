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

import { BadRequestException, NotFoundException } from '@nestjs/common';

function makePrismaForUpdate(
  opts: { target?: { id: string; role: string; is_active: boolean } | null } = {},
) {
  const tx = {
    user: {
      findUnique: vi
        .fn()
        .mockResolvedValue(
          opts.target === undefined
            ? { id: 't-1', role: 'operator', is_active: true }
            : opts.target,
        ),
      update: vi.fn().mockImplementation(({ data, where }) => ({
        id: where.id,
        email: 'target@x.com',
        full_name: 'Target',
        role: data.role ?? 'operator',
        is_active: data.is_active ?? true,
        last_login_at: null,
        created_at: new Date('2026-04-01T00:00:00Z'),
      })),
    },
  };
  const prisma = {
    $transaction: vi.fn(async (cb: (t: typeof tx) => Promise<unknown>) => cb(tx)),
  } as unknown as PrismaService;
  (prisma as unknown as { _tx: typeof tx })._tx = tx;
  return prisma;
}

describe('UsersService.update', () => {
  it('rejects self-edit with BadRequestException', async () => {
    const prisma = makePrismaForUpdate();
    const svc = new UsersService(prisma, makeAudit());
    await expect(svc.update('actor-1', 'actor-1', { role: 'admin' })).rejects.toThrow(
      new BadRequestException('No podés modificarte a vos mismo.'),
    );
  });

  it('rejects empty body with BadRequestException', async () => {
    const prisma = makePrismaForUpdate();
    const svc = new UsersService(prisma, makeAudit());
    await expect(svc.update('actor-1', 't-1', {})).rejects.toThrow(
      new BadRequestException('Debés indicar al menos un cambio.'),
    );
  });

  it('rejects unknown user with NotFoundException', async () => {
    const prisma = makePrismaForUpdate({ target: null });
    const svc = new UsersService(prisma, makeAudit());
    await expect(svc.update('actor-1', 'missing', { role: 'admin' })).rejects.toThrow(
      new NotFoundException('Usuario no encontrado.'),
    );
  });

  it('updates role only and audits with before/after', async () => {
    const prisma = makePrismaForUpdate({
      target: { id: 't-1', role: 'operator', is_active: true },
    });
    const audit = makeAudit();
    const svc = new UsersService(prisma, audit);

    const r = await svc.update('actor-1', 't-1', { role: 'admin' });

    expect(r.role).toBe('admin');
    const tx = (prisma as unknown as { _tx: { user: { update: ReturnType<typeof vi.fn> } } })._tx;
    expect(tx.user.update).toHaveBeenCalledWith({
      where: { id: 't-1' },
      data: { role: 'admin' },
      select: expect.any(Object),
    });
    expect(audit.recordChange).toHaveBeenCalledOnce();
    const auditArg = (audit.recordChange as ReturnType<typeof vi.fn>).mock.calls[0]![0];
    expect(auditArg).toMatchObject({
      entityType: 'user',
      entityId: 't-1',
      action: 'update',
      actorId: 'actor-1',
      payload: {
        before: { role: 'operator' },
        after: { role: 'admin' },
      },
    });
  });

  it('updates is_active only and audits before/after with only that field', async () => {
    const prisma = makePrismaForUpdate({
      target: { id: 't-1', role: 'operator', is_active: true },
    });
    const audit = makeAudit();
    const svc = new UsersService(prisma, audit);

    await svc.update('actor-1', 't-1', { is_active: false });

    const auditArg = (audit.recordChange as ReturnType<typeof vi.fn>).mock.calls[0]![0];
    expect(auditArg.payload).toEqual({
      before: { is_active: true },
      after: { is_active: false },
    });
  });

  it('updates both fields and audits both', async () => {
    const prisma = makePrismaForUpdate({
      target: { id: 't-1', role: 'operator', is_active: true },
    });
    const audit = makeAudit();
    const svc = new UsersService(prisma, audit);

    await svc.update('actor-1', 't-1', { role: 'admin', is_active: false });

    const auditArg = (audit.recordChange as ReturnType<typeof vi.fn>).mock.calls[0]![0];
    expect(auditArg.payload).toEqual({
      before: { role: 'operator', is_active: true },
      after: { role: 'admin', is_active: false },
    });
  });
});

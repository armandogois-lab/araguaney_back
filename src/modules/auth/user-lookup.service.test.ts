import { describe, it, expect, vi, beforeEach } from 'vitest';
import { UserLookupService } from './user-lookup.service';
import { PrismaService } from '../../prisma/prisma.service';

describe('UserLookupService', () => {
  let svc: UserLookupService;
  let prisma: { user: { findUnique: ReturnType<typeof vi.fn> } };

  beforeEach(() => {
    prisma = { user: { findUnique: vi.fn() } };
    svc = new UserLookupService(prisma as unknown as PrismaService);
  });

  it('returns { kind: "found", user } when active row exists', async () => {
    prisma.user.findUnique.mockResolvedValueOnce({
      id: '00000000-0000-4000-8000-000000000001',
      email: 'a@cashea.app',
      full_name: 'Alice Operator',
      role: 'operator',
      is_active: true,
    });
    const r = await svc.findByAuthId('auth-uuid-1');
    expect(r).toEqual({
      kind: 'found',
      user: {
        id: '00000000-0000-4000-8000-000000000001',
        email: 'a@cashea.app',
        full_name: 'Alice Operator',
        role: 'operator',
        is_active: true,
      },
    });
    expect(prisma.user.findUnique).toHaveBeenCalledWith({
      where: { auth_user_id: 'auth-uuid-1' },
      select: { id: true, email: true, full_name: true, role: true, is_active: true },
    });
  });

  it('returns { kind: "not_registered" } when no row exists', async () => {
    prisma.user.findUnique.mockResolvedValueOnce(null);
    const r = await svc.findByAuthId('auth-uuid-missing');
    expect(r).toEqual({ kind: 'not_registered' });
  });

  it('returns { kind: "deactivated" } when row exists but is_active=false', async () => {
    prisma.user.findUnique.mockResolvedValueOnce({
      id: '00000000-0000-4000-8000-000000000002',
      email: 'b@cashea.app',
      full_name: 'Bob Inactive',
      role: 'auditor',
      is_active: false,
    });
    const r = await svc.findByAuthId('auth-uuid-2');
    expect(r).toEqual({ kind: 'deactivated' });
  });
});

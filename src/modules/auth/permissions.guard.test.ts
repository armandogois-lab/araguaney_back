import { describe, it, expect, vi } from 'vitest';
import { ExecutionContext, ForbiddenException, UnauthorizedException } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { PermissionsGuard } from './permissions.guard';
import { PrismaService } from '../../prisma/prisma.service';
import { mockAuthUser } from '../../../test/helpers/auth-user.helper';

function makeCtx(
  metadata: string[] | undefined,
  user: unknown,
): {
  ctx: ExecutionContext;
  reflector: Reflector;
} {
  const ctx = {
    switchToHttp: () => ({ getRequest: () => ({ user }) }),
    getHandler: () => () => undefined,
    getClass: () => class {},
  } as unknown as ExecutionContext;
  const reflector = {
    getAllAndOverride: vi.fn().mockReturnValue(metadata),
  } as unknown as Reflector;
  return { ctx, reflector };
}

function makePrisma(grantedKeys: string[]): PrismaService {
  return {
    rolePermission: {
      findMany: vi.fn().mockResolvedValue(grantedKeys.map((key) => ({ permission: { key } }))),
    },
  } as unknown as PrismaService;
}

describe('PermissionsGuard', () => {
  it('returns true when no @RequirePermission metadata is present', async () => {
    const { ctx, reflector } = makeCtx(undefined, mockAuthUser());
    const guard = new PermissionsGuard(reflector, makePrisma([]));
    await expect(guard.canActivate(ctx)).resolves.toBe(true);
  });

  it('returns true when user has all required permissions', async () => {
    const { ctx, reflector } = makeCtx(
      ['certificate.issue', 'certificate.read'],
      mockAuthUser({ role: 'admin' }),
    );
    const guard = new PermissionsGuard(
      reflector,
      makePrisma(['certificate.issue', 'certificate.read']),
    );
    await expect(guard.canActivate(ctx)).resolves.toBe(true);
  });

  it('throws 403 listing missing keys when one is missing', async () => {
    const { ctx, reflector } = makeCtx(
      ['certificate.issue', 'certificate.cancel'],
      mockAuthUser({ role: 'operator' }),
    );
    const guard = new PermissionsGuard(reflector, makePrisma(['certificate.issue']));
    await expect(guard.canActivate(ctx)).rejects.toMatchObject({
      response: expect.objectContaining({ message: 'Permission denied: certificate.cancel' }),
    });
    await expect(guard.canActivate(ctx)).rejects.toBeInstanceOf(ForbiddenException);
  });

  it('throws 401 if req.user is missing (defensive)', async () => {
    const { ctx, reflector } = makeCtx(['x.y'], undefined);
    const guard = new PermissionsGuard(reflector, makePrisma([]));
    await expect(guard.canActivate(ctx)).rejects.toBeInstanceOf(UnauthorizedException);
  });
});

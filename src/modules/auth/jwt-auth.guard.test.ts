import { describe, it, expect, vi } from 'vitest';
import { ExecutionContext, ForbiddenException, UnauthorizedException } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { JwtAuthGuard } from './jwt-auth.guard';
import { JwtService } from './jwt.service';
import { UserLookupService } from './user-lookup.service';
import { mintTestJwt } from '../../../test/helpers/jwt.helper';
import { mockAuthUser } from '../../../test/helpers/auth-user.helper';

function makeCtx(
  headers: Record<string, unknown>,
  isPublicMeta = false,
): {
  ctx: ExecutionContext;
  req: { headers: Record<string, unknown>; user?: unknown };
  reflector: Reflector;
} {
  const req: { headers: Record<string, unknown>; user?: unknown } = { headers };
  const ctx = {
    switchToHttp: () => ({ getRequest: () => req }),
    getHandler: () => () => undefined,
    getClass: () => class {},
  } as unknown as ExecutionContext;
  const reflector = {
    getAllAndOverride: vi.fn().mockReturnValue(isPublicMeta ? true : undefined),
  } as unknown as Reflector;
  return { ctx, req, reflector };
}

function makeJwt(verifyImpl: (t: string) => Promise<{ sub: string }>): JwtService {
  return { verify: verifyImpl } as unknown as JwtService;
}

function makeLookup(impl: (sub: string) => Promise<unknown>): UserLookupService {
  return { findByAuthId: impl } as unknown as UserLookupService;
}

describe('JwtAuthGuard', () => {
  it('returns true and skips checks when @Public() is set', async () => {
    const { ctx, reflector } = makeCtx({}, true);
    const guard = new JwtAuthGuard(
      reflector,
      makeJwt(async () => ({ sub: '' })),
      makeLookup(async () => null),
    );
    await expect(guard.canActivate(ctx)).resolves.toBe(true);
  });

  it('throws 401 when Authorization header is missing', async () => {
    const { ctx, reflector } = makeCtx({});
    const guard = new JwtAuthGuard(
      reflector,
      makeJwt(async () => ({ sub: '' })),
      makeLookup(async () => null),
    );
    await expect(guard.canActivate(ctx)).rejects.toBeInstanceOf(UnauthorizedException);
  });

  it('throws 401 when header is not Bearer', async () => {
    const { ctx, reflector } = makeCtx({ authorization: 'Basic xyz' });
    const guard = new JwtAuthGuard(
      reflector,
      makeJwt(async () => ({ sub: '' })),
      makeLookup(async () => null),
    );
    await expect(guard.canActivate(ctx)).rejects.toBeInstanceOf(UnauthorizedException);
  });

  it('throws 401 when JwtService.verify rejects', async () => {
    const token = 'invalid.jwt.token';
    const { ctx, reflector } = makeCtx({ authorization: `Bearer ${token}` });
    const guard = new JwtAuthGuard(
      reflector,
      makeJwt(async () => {
        throw new UnauthorizedException('Invalid or expired token');
      }),
      makeLookup(async () => null),
    );
    await expect(guard.canActivate(ctx)).rejects.toBeInstanceOf(UnauthorizedException);
  });

  it('throws 403 with "User not registered in the system" when lookup is not_registered', async () => {
    const token = await mintTestJwt({ sub: 'auth-uuid' });
    const { ctx, reflector } = makeCtx({ authorization: `Bearer ${token}` });
    const guard = new JwtAuthGuard(
      reflector,
      makeJwt(async () => ({ sub: 'auth-uuid' })),
      makeLookup(async () => ({ kind: 'not_registered' })),
    );
    await expect(guard.canActivate(ctx)).rejects.toMatchObject({
      response: expect.objectContaining({ message: 'User not registered in the system' }),
    });
    await expect(guard.canActivate(ctx)).rejects.toBeInstanceOf(ForbiddenException);
  });

  it('throws 403 with "User account is deactivated" when lookup is deactivated', async () => {
    const { ctx, reflector } = makeCtx({ authorization: 'Bearer x' });
    const guard = new JwtAuthGuard(
      reflector,
      makeJwt(async () => ({ sub: 'auth-uuid' })),
      makeLookup(async () => ({ kind: 'deactivated' })),
    );
    await expect(guard.canActivate(ctx)).rejects.toMatchObject({
      response: expect.objectContaining({ message: 'User account is deactivated' }),
    });
    await expect(guard.canActivate(ctx)).rejects.toBeInstanceOf(ForbiddenException);
  });

  it('attaches req.user and returns true on found', async () => {
    const user = mockAuthUser();
    const { ctx, req, reflector } = makeCtx({ authorization: 'Bearer x' });
    const guard = new JwtAuthGuard(
      reflector,
      makeJwt(async () => ({ sub: 'auth-uuid' })),
      makeLookup(async () => ({ kind: 'found', user })),
    );
    await expect(guard.canActivate(ctx)).resolves.toBe(true);
    expect(req.user).toEqual(user);
  });
});

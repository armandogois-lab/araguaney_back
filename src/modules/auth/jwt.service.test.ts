import { describe, it, expect, beforeEach } from 'vitest';
import { ConfigService } from '@nestjs/config';
import { UnauthorizedException } from '@nestjs/common';
import { JwtService } from './jwt.service';
import type { EnvConfig } from '../../config/env.config';
import { mintTestJwt, TEST_SECRET } from '../../../test/helpers/jwt.helper';

function makeService(secret = TEST_SECRET): JwtService {
  const config = {
    get: (key: string) => (key === 'SUPABASE_JWT_SECRET' ? secret : undefined),
  } as unknown as ConfigService<EnvConfig, true>;
  return new JwtService(config);
}

describe('JwtService', () => {
  let svc: JwtService;
  beforeEach(() => {
    svc = makeService();
  });

  it('verifies a valid token and returns claims', async () => {
    const token = await mintTestJwt({ sub: 'user-1' });
    const claims = await svc.verify(token);
    expect(claims.sub).toBe('user-1');
    expect(typeof claims.exp).toBe('number');
  });

  it('throws UnauthorizedException for an expired token', async () => {
    const token = await mintTestJwt({ sub: 'user-1', exp: Math.floor(Date.now() / 1000) - 60 });
    await expect(svc.verify(token)).rejects.toBeInstanceOf(UnauthorizedException);
  });

  it('throws UnauthorizedException when signed with a different secret', async () => {
    const token = await mintTestJwt({ sub: 'user-1', secret: 'other-secret' });
    await expect(svc.verify(token)).rejects.toBeInstanceOf(UnauthorizedException);
  });

  it('throws UnauthorizedException when alg is "none"', async () => {
    // jose refuses alg=none entirely; an attacker token with alg=none must not verify
    await expect(svc.verify('eyJhbGciOiJub25lIn0.eyJzdWIiOiJ1c2VyLTEifQ.')).rejects.toBeInstanceOf(
      UnauthorizedException,
    );
  });
});

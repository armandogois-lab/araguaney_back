import { describe, it, expect, beforeEach, beforeAll } from 'vitest';
import { ConfigService } from '@nestjs/config';
import { UnauthorizedException } from '@nestjs/common';
import { JwtService } from './jwt.service';
import type { EnvConfig } from '../../config/env.config';
import { mintTestJwt } from '../../../test/helpers/jwt.helper';
import { getTestKeyPair } from '../../../test/helpers/jwks.helper';

describe('JwtService', () => {
  let svc: JwtService;

  beforeAll(async () => {
    // Make sure the test keypair is generated before any test runs
    await getTestKeyPair();
  });

  beforeEach(async () => {
    const { publicKey } = await getTestKeyPair();
    const config = {
      get: (key: string) => (key === 'SUPABASE_URL' ? 'https://test.supabase.co' : undefined),
    } as unknown as ConfigService<EnvConfig, true>;
    const resolver = async () => publicKey;
    svc = new JwtService(resolver, config);
  });

  it('verifies a valid ES256 token and returns claims', async () => {
    const token = await mintTestJwt({ sub: 'user-1' });
    const claims = await svc.verify(token);
    expect(claims.sub).toBe('user-1');
    expect(typeof claims.exp).toBe('number');
  });

  it('throws UnauthorizedException for an expired token', async () => {
    const token = await mintTestJwt({ sub: 'user-1', exp: Math.floor(Date.now() / 1000) - 60 });
    await expect(svc.verify(token)).rejects.toBeInstanceOf(UnauthorizedException);
  });

  it('throws UnauthorizedException when signed with a different key', async () => {
    const token = await mintTestJwt({ sub: 'user-1', wrongKey: true });
    await expect(svc.verify(token)).rejects.toBeInstanceOf(UnauthorizedException);
  });

  it('throws UnauthorizedException when alg is "none"', async () => {
    await expect(svc.verify('eyJhbGciOiJub25lIn0.eyJzdWIiOiJ1c2VyLTEifQ.')).rejects.toBeInstanceOf(
      UnauthorizedException,
    );
  });

  it('throws UnauthorizedException when issuer does not match', async () => {
    const { SignJWT } = await import('jose');
    const { privateKey } = await getTestKeyPair();
    const token = await new SignJWT({ sub: 'user-1' })
      .setProtectedHeader({ alg: 'ES256' })
      .setIssuer('https://wrong.example.com/auth/v1')
      .setAudience('authenticated')
      .setIssuedAt()
      .setExpirationTime(Math.floor(Date.now() / 1000) + 60)
      .sign(privateKey);
    await expect(svc.verify(token)).rejects.toBeInstanceOf(UnauthorizedException);
  });
});

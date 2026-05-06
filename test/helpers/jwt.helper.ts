import { SignJWT } from 'jose';

export const TEST_SECRET = 'test-secret-for-unit-tests-do-not-use-in-prod';

export async function mintTestJwt(opts: {
  sub: string;
  exp?: number;
  secret?: string;
  alg?: 'HS256' | 'HS384' | 'none';
}): Promise<string> {
  const secret = new TextEncoder().encode(opts.secret ?? TEST_SECRET);
  const exp = opts.exp ?? Math.floor(Date.now() / 1000) + 3600;
  const builder = new SignJWT({ sub: opts.sub })
    .setProtectedHeader({ alg: opts.alg ?? 'HS256' })
    .setIssuedAt()
    .setExpirationTime(exp);
  return await builder.sign(secret);
}

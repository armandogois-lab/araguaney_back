import { SignJWT } from 'jose';
import { getTestKeyPair } from './jwks.helper';

export const TEST_ISSUER = 'https://test.supabase.co/auth/v1';
export const TEST_AUDIENCE = 'authenticated';

export async function mintTestJwt(opts: {
  sub: string;
  exp?: number;
  email?: string;
  /** When set, mint with a different (wrong) keypair to simulate tampered token */
  wrongKey?: boolean;
}): Promise<string> {
  const { privateKey } = await getTestKeyPair();
  const exp = opts.exp ?? Math.floor(Date.now() / 1000) + 3600;
  const builder = new SignJWT({ sub: opts.sub, ...(opts.email ? { email: opts.email } : {}) })
    .setProtectedHeader({ alg: 'ES256' })
    .setIssuer(TEST_ISSUER)
    .setAudience(TEST_AUDIENCE)
    .setIssuedAt()
    .setExpirationTime(exp);

  if (opts.wrongKey) {
    const { generateKeyPair } = await import('jose');
    const wrong = await generateKeyPair('ES256');
    return builder.sign(wrong.privateKey);
  }

  return builder.sign(privateKey);
}

// Backwards-compat re-export so old code that imports TEST_SECRET still works
// during the transition. Removed in subsequent cleanup commits.
export const TEST_SECRET = 'unused-after-jwks-migration';

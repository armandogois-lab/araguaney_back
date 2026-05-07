import { generateKeyPair, exportJWK, type JWK, type CryptoKey as JoseCryptoKey } from 'jose';
import { JWKS_RESOLVER } from '../../src/modules/auth/jwks.tokens';

interface TestKeyPair {
  privateKey: JoseCryptoKey;
  publicKey: JoseCryptoKey;
  jwk: JWK;
}

let cached: TestKeyPair | undefined;

export async function getTestKeyPair(): Promise<TestKeyPair> {
  if (!cached) {
    const { privateKey, publicKey } = await generateKeyPair('ES256');
    cached = {
      privateKey,
      publicKey,
      jwk: await exportJWK(publicKey),
    };
  }
  return cached;
}

export async function jwksTestProvider() {
  const { publicKey } = await getTestKeyPair();
  return {
    provide: JWKS_RESOLVER,
    useValue: async () => publicKey,
  };
}

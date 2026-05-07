import type { JWTVerifyGetKey } from 'jose';

export const JWKS_RESOLVER = Symbol.for('JWKS_RESOLVER');
export type JwksResolver = JWTVerifyGetKey;

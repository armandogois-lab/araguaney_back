import { Inject, Injectable, UnauthorizedException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { jwtVerify } from 'jose';
import type { EnvConfig } from '../../config/env.config';
import type { JwtClaims } from './types';
import { JWKS_RESOLVER, type JwksResolver } from './jwks.tokens';

@Injectable()
export class JwtService {
  private readonly issuer: string;

  constructor(
    @Inject(JWKS_RESOLVER) private readonly jwks: JwksResolver,
    config: ConfigService<EnvConfig, true>,
  ) {
    const supabaseUrl = config.get('SUPABASE_URL', { infer: true });
    this.issuer = `${supabaseUrl}/auth/v1`;
  }

  async verify(token: string): Promise<JwtClaims> {
    try {
      const { payload } = await jwtVerify(token, this.jwks, {
        issuer: this.issuer,
        audience: 'authenticated',
        algorithms: ['ES256', 'RS256'],
      });
      return payload as JwtClaims;
    } catch {
      throw new UnauthorizedException('Invalid or expired token');
    }
  }
}

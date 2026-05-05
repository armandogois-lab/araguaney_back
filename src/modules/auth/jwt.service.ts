import { Injectable, UnauthorizedException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { jwtVerify } from 'jose';
import type { EnvConfig } from '../../config/env.config';
import type { JwtClaims } from './types';

@Injectable()
export class JwtService {
  private readonly secret: Uint8Array;

  constructor(config: ConfigService<EnvConfig, true>) {
    const raw = config.get('SUPABASE_JWT_SECRET', { infer: true });
    this.secret = new TextEncoder().encode(raw);
  }

  async verify(token: string): Promise<JwtClaims> {
    try {
      const { payload } = await jwtVerify(token, this.secret, {
        algorithms: ['HS256'],
      });
      return payload as JwtClaims;
    } catch {
      throw new UnauthorizedException('Invalid or expired token');
    }
  }
}

import { Module } from '@nestjs/common';
import { APP_GUARD } from '@nestjs/core';
import { ConfigService } from '@nestjs/config';
import { createRemoteJWKSet } from 'jose';
import { JwtService } from './jwt.service';
import { UserLookupService } from './user-lookup.service';
import { JwtAuthGuard } from './jwt-auth.guard';
import { PermissionsGuard } from './permissions.guard';
import { JWKS_RESOLVER } from './jwks.tokens';
import type { EnvConfig } from '../../config/env.config';

@Module({
  providers: [
    {
      provide: JWKS_RESOLVER,
      useFactory: (config: ConfigService<EnvConfig, true>) => {
        const supabaseUrl = config.get('SUPABASE_URL', { infer: true });
        return createRemoteJWKSet(new URL(`${supabaseUrl}/auth/v1/.well-known/jwks.json`));
      },
      inject: [ConfigService],
    },
    JwtService,
    UserLookupService,
    { provide: APP_GUARD, useClass: JwtAuthGuard },
    { provide: APP_GUARD, useClass: PermissionsGuard },
  ],
  exports: [JwtService, UserLookupService],
})
export class AuthModule {}

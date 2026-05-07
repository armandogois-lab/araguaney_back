import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { Test } from '@nestjs/testing';
import { INestApplication } from '@nestjs/common';
import { APP_GUARD } from '@nestjs/core';
import { ConfigService } from '@nestjs/config';
import request from 'supertest';
import { MeController } from './me.controller';
import { JwtService } from '../auth/jwt.service';
import { UserLookupService } from '../auth/user-lookup.service';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { PermissionsGuard } from '../auth/permissions.guard';
import { PrismaService } from '../../prisma/prisma.service';
import { mintTestJwt, TEST_SECRET } from '../../../test/helpers/jwt.helper';
import { jwksTestProvider } from '../../../test/helpers/jwks.helper';
import { mockAuthUser } from '../../../test/helpers/auth-user.helper';

describe('GET /api/me', () => {
  let app: INestApplication;
  let lookup: { findByAuthId: ReturnType<typeof vi.fn> };

  beforeEach(async () => {
    lookup = { findByAuthId: vi.fn() };

    const config = {
      get: (key: string) => {
        if (key === 'SUPABASE_URL') return 'https://test.supabase.co';
        if (key === 'SUPABASE_JWT_SECRET') return TEST_SECRET;
        return undefined;
      },
    } as unknown as ConfigService;

    const moduleRef = await Test.createTestingModule({
      controllers: [MeController],
      providers: [
        { provide: ConfigService, useValue: config },
        JwtService,
        await jwksTestProvider(),
        { provide: UserLookupService, useValue: lookup },
        {
          provide: PrismaService,
          useValue: { rolePermission: { findMany: vi.fn().mockResolvedValue([]) } },
        },
        { provide: APP_GUARD, useClass: JwtAuthGuard },
        { provide: APP_GUARD, useClass: PermissionsGuard },
      ],
    }).compile();

    app = moduleRef.createNestApplication();
    app.setGlobalPrefix('api');
    await app.init();
  });

  afterEach(async () => {
    await app.close();
  });

  it('401 when Authorization header is missing', async () => {
    await request(app.getHttpServer())
      .get('/api/me')
      .expect(401)
      .expect((res) => {
        expect(res.body.message).toBe('Missing or malformed Authorization header');
      });
  });

  it('401 when token is expired', async () => {
    const token = await mintTestJwt({ sub: 'auth-uuid', exp: Math.floor(Date.now() / 1000) - 60 });
    await request(app.getHttpServer())
      .get('/api/me')
      .set('Authorization', `Bearer ${token}`)
      .expect(401)
      .expect((res) => {
        expect(res.body.message).toBe('Invalid or expired token');
      });
  });

  it('403 when sub does not match a cfb.users row', async () => {
    lookup.findByAuthId.mockResolvedValueOnce({ kind: 'not_registered' });
    const token = await mintTestJwt({ sub: 'auth-uuid' });
    await request(app.getHttpServer())
      .get('/api/me')
      .set('Authorization', `Bearer ${token}`)
      .expect(403)
      .expect((res) => {
        expect(res.body.message).toBe('User not registered in the system');
      });
  });

  it('200 with the AuthUser when token is valid and user is active', async () => {
    const user = mockAuthUser();
    lookup.findByAuthId.mockResolvedValueOnce({ kind: 'found', user });
    const token = await mintTestJwt({ sub: 'auth-uuid' });
    await request(app.getHttpServer())
      .get('/api/me')
      .set('Authorization', `Bearer ${token}`)
      .expect(200)
      .expect((res) => {
        expect(res.body).toEqual(user);
      });
  });
});

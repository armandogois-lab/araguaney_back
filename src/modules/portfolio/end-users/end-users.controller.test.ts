import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { Test } from '@nestjs/testing';
import { INestApplication } from '@nestjs/common';
import { APP_GUARD } from '@nestjs/core';
import { ConfigService } from '@nestjs/config';
import request from 'supertest';
import { EndUsersController } from './end-users.controller';
import { EndUsersService } from './end-users.service';
import { JwtService } from '../../auth/jwt.service';
import { UserLookupService } from '../../auth/user-lookup.service';
import { JwtAuthGuard } from '../../auth/jwt-auth.guard';
import { PermissionsGuard } from '../../auth/permissions.guard';
import { PrismaService } from '../../../prisma/prisma.service';
import { mintTestJwt, TEST_SECRET } from '../../../../test/helpers/jwt.helper';
import { jwksTestProvider } from '../../../../test/helpers/jwks.helper';
import { mockAuthUser } from '../../../../test/helpers/auth-user.helper';

describe('EndUsersController', () => {
  let app: INestApplication;
  let svc: {
    list: ReturnType<typeof vi.fn>;
    detail: ReturnType<typeof vi.fn>;
    update: ReturnType<typeof vi.fn>;
  };
  let prismaPerms: ReturnType<typeof vi.fn>;

  beforeEach(async () => {
    svc = { list: vi.fn(), detail: vi.fn(), update: vi.fn() };
    prismaPerms = vi
      .fn()
      .mockResolvedValue([
        { permission: { key: 'portfolio.read' } },
        { permission: { key: 'portfolio.write' } },
      ]);
    const config = {
      get: (k: string) => {
        if (k === 'SUPABASE_URL') return 'https://test.supabase.co';
        if (k === 'SUPABASE_JWT_SECRET') return TEST_SECRET;
        return undefined;
      },
    } as unknown as ConfigService;
    const moduleRef = await Test.createTestingModule({
      controllers: [EndUsersController],
      providers: [
        { provide: EndUsersService, useValue: svc },
        { provide: ConfigService, useValue: config },
        JwtService,
        await jwksTestProvider(),
        {
          provide: UserLookupService,
          useValue: {
            findByAuthId: vi
              .fn()
              .mockResolvedValue({ kind: 'found', user: mockAuthUser({ role: 'operator' }) }),
          },
        },
        { provide: PrismaService, useValue: { rolePermission: { findMany: prismaPerms } } },
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

  it('GET /api/end-users → 401 without Authorization', async () => {
    await request(app.getHttpServer()).get('/api/end-users').expect(401);
  });

  it('GET /api/end-users → 200 with empty list', async () => {
    svc.list.mockResolvedValueOnce({ data: [], total: 0, limit: 50, offset: 0 });
    const token = await mintTestJwt({ sub: 'auth-uuid' });
    await request(app.getHttpServer())
      .get('/api/end-users')
      .set('Authorization', `Bearer ${token}`)
      .expect(200);
  });

  it('PATCH /api/end-users/:id → 401 without Authorization', async () => {
    await request(app.getHttpServer())
      .patch('/api/end-users/00000000-0000-4000-8000-000000000001')
      .send({ email: 'x@y.com' })
      .expect(401);
  });

  it('PATCH /api/end-users/:id → 403 when role lacks portfolio.write', async () => {
    prismaPerms.mockResolvedValueOnce([{ permission: { key: 'portfolio.read' } }]);
    const token = await mintTestJwt({ sub: 'auth-uuid' });
    await request(app.getHttpServer())
      .patch('/api/end-users/00000000-0000-4000-8000-000000000001')
      .set('Authorization', `Bearer ${token}`)
      .send({ email: 'x@y.com' })
      .expect(403);
  });

  it('PATCH /api/end-users/:id → 400 when email is malformed', async () => {
    const token = await mintTestJwt({ sub: 'auth-uuid' });
    await request(app.getHttpServer())
      .patch('/api/end-users/00000000-0000-4000-8000-000000000001')
      .set('Authorization', `Bearer ${token}`)
      .send({ email: 'not-an-email' })
      .expect(400);
  });

  it('PATCH /api/end-users/:id → 200 happy path', async () => {
    svc.update.mockResolvedValueOnce({
      id: '00000000-0000-4000-8000-000000000001',
      external_hash: 'h',
      full_name: 'Pedro',
      national_id: 'V-12345678',
      email: 'pedro@cashea.app',
      phone: null,
      enriched_at: new Date().toISOString(),
      first_seen_at: new Date().toISOString(),
      last_seen_at: new Date().toISOString(),
      order_count: 1,
      orders_summary: {
        total_count: 1,
        total_amount: '300.0000',
        by_status: { available: 1, assigned: 0, matured: 0, defaulted: 0 },
      },
    });
    const token = await mintTestJwt({ sub: 'auth-uuid' });
    const res = await request(app.getHttpServer())
      .patch('/api/end-users/00000000-0000-4000-8000-000000000001')
      .set('Authorization', `Bearer ${token}`)
      .send({ full_name: 'Pedro', email: 'pedro@cashea.app' })
      .expect(200);
    expect(res.body.full_name).toBe('Pedro');
    expect(res.body.email).toBe('pedro@cashea.app');
  });
});

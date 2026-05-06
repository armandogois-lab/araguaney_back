import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { Test } from '@nestjs/testing';
import { INestApplication, NotFoundException } from '@nestjs/common';
import { APP_GUARD } from '@nestjs/core';
import { ConfigService } from '@nestjs/config';
import request from 'supertest';
import { MerchantsController } from './merchants.controller';
import { MerchantsService } from './merchants.service';
import { JwtService } from '../../auth/jwt.service';
import { UserLookupService } from '../../auth/user-lookup.service';
import { JwtAuthGuard } from '../../auth/jwt-auth.guard';
import { PermissionsGuard } from '../../auth/permissions.guard';
import { PrismaService } from '../../../prisma/prisma.service';
import { mintTestJwt, TEST_SECRET } from '../../../../test/helpers/jwt.helper';
import { mockAuthUser } from '../../../../test/helpers/auth-user.helper';

describe('MerchantsController', () => {
  let app: INestApplication;
  let svc: { list: ReturnType<typeof vi.fn>; detail: ReturnType<typeof vi.fn> };

  beforeEach(async () => {
    svc = { list: vi.fn(), detail: vi.fn() };
    const config = {
      get: (k: string) => (k === 'SUPABASE_JWT_SECRET' ? TEST_SECRET : undefined),
    } as unknown as ConfigService;
    const moduleRef = await Test.createTestingModule({
      controllers: [MerchantsController],
      providers: [
        { provide: MerchantsService, useValue: svc },
        { provide: ConfigService, useValue: config },
        JwtService,
        {
          provide: UserLookupService,
          useValue: {
            findByAuthId: vi
              .fn()
              .mockResolvedValue({ kind: 'found', user: mockAuthUser({ role: 'operator' }) }),
          },
        },
        {
          provide: PrismaService,
          useValue: {
            rolePermission: {
              findMany: vi.fn().mockResolvedValue([{ permission: { key: 'portfolio.read' } }]),
            },
          },
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

  it('GET /api/merchants → 401 without Authorization', async () => {
    await request(app.getHttpServer()).get('/api/merchants').expect(401);
  });

  it('GET /api/merchants → 200 with list', async () => {
    svc.list.mockResolvedValueOnce({ data: [], total: 0, limit: 50, offset: 0 });
    const token = await mintTestJwt({ sub: 'auth-uuid' });
    const res = await request(app.getHttpServer())
      .get('/api/merchants')
      .set('Authorization', `Bearer ${token}`)
      .expect(200);
    expect(res.body.total).toBe(0);
  });

  it('GET /api/merchants/:id → 404 when service throws', async () => {
    svc.detail.mockRejectedValueOnce(new NotFoundException('Comercio no encontrado'));
    const token = await mintTestJwt({ sub: 'auth-uuid' });
    await request(app.getHttpServer())
      .get('/api/merchants/00000000-0000-4000-8000-000000000099')
      .set('Authorization', `Bearer ${token}`)
      .expect(404);
  });
});

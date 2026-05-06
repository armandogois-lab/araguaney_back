import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { Test } from '@nestjs/testing';
import { INestApplication } from '@nestjs/common';
import { APP_GUARD } from '@nestjs/core';
import { ConfigService } from '@nestjs/config';
import request from 'supertest';
import { OrdersController } from './orders.controller';
import { OrdersService } from './orders.service';
import { JwtService } from '../../auth/jwt.service';
import { UserLookupService } from '../../auth/user-lookup.service';
import { JwtAuthGuard } from '../../auth/jwt-auth.guard';
import { PermissionsGuard } from '../../auth/permissions.guard';
import { PrismaService } from '../../../prisma/prisma.service';
import { mintTestJwt, TEST_SECRET } from '../../../../test/helpers/jwt.helper';
import { mockAuthUser } from '../../../../test/helpers/auth-user.helper';

describe('OrdersController', () => {
  let app: INestApplication;
  let svc: { list: ReturnType<typeof vi.fn>; detail: ReturnType<typeof vi.fn>; stats: ReturnType<typeof vi.fn> };
  let prismaPerms: ReturnType<typeof vi.fn>;
  let lookup: { findByAuthId: ReturnType<typeof vi.fn> };

  beforeEach(async () => {
    svc = { list: vi.fn(), detail: vi.fn(), stats: vi.fn() };
    prismaPerms = vi.fn().mockResolvedValue([{ permission: { key: 'portfolio.read' } }]);
    lookup = { findByAuthId: vi.fn().mockResolvedValue({ kind: 'found', user: mockAuthUser({ role: 'operator' }) }) };

    const config = { get: (k: string) => (k === 'SUPABASE_JWT_SECRET' ? TEST_SECRET : undefined) } as unknown as ConfigService;

    const moduleRef = await Test.createTestingModule({
      controllers: [OrdersController],
      providers: [
        { provide: OrdersService, useValue: svc },
        { provide: ConfigService, useValue: config },
        JwtService,
        { provide: UserLookupService, useValue: lookup },
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

  it('GET /api/orders → 401 without Authorization', async () => {
    await request(app.getHttpServer()).get('/api/orders').expect(401);
  });

  it('GET /api/orders → 403 when role lacks portfolio.read', async () => {
    prismaPerms.mockResolvedValueOnce([]);
    const token = await mintTestJwt({ sub: 'auth-uuid' });
    await request(app.getHttpServer())
      .get('/api/orders')
      .set('Authorization', `Bearer ${token}`)
      .expect(403);
  });

  it('GET /api/orders → 200 with paginated body', async () => {
    svc.list.mockResolvedValueOnce({ data: [], total: 0, limit: 50, offset: 0 });
    const token = await mintTestJwt({ sub: 'auth-uuid' });
    const res = await request(app.getHttpServer())
      .get('/api/orders')
      .set('Authorization', `Bearer ${token}`)
      .expect(200);
    expect(res.body).toEqual({ data: [], total: 0, limit: 50, offset: 0 });
  });

  it('GET /api/orders/stats → 200 with by_status and available_capital', async () => {
    svc.stats.mockResolvedValueOnce({
      by_status: {
        available: { count: 2, total_amount: '400.0000', total_installments_amount: '400.0000' },
        assigned: { count: 0, total_amount: '0.0000', total_installments_amount: '0.0000' },
        matured: { count: 0, total_amount: '0.0000', total_installments_amount: '0.0000' },
        defaulted: { count: 0, total_amount: '0.0000', total_installments_amount: '0.0000' },
      },
      total_orders: 2,
      available_capital: '400.0000',
    });
    const token = await mintTestJwt({ sub: 'auth-uuid' });
    const res = await request(app.getHttpServer())
      .get('/api/orders/stats')
      .set('Authorization', `Bearer ${token}`)
      .expect(200);
    expect(res.body.available_capital).toBe('400.0000');
    expect(res.body.total_orders).toBe(2);
  });

  it('GET /api/orders/:id → 404 when service throws NotFoundException', async () => {
    const { NotFoundException } = await import('@nestjs/common');
    svc.detail.mockRejectedValueOnce(new NotFoundException('Orden no encontrada'));
    const token = await mintTestJwt({ sub: 'auth-uuid' });
    await request(app.getHttpServer())
      .get('/api/orders/00000000-0000-4000-8000-000000000099')
      .set('Authorization', `Bearer ${token}`)
      .expect(404);
  });
});

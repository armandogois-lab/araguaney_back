import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { Test } from '@nestjs/testing';
import { BadRequestException, INestApplication, NotFoundException } from '@nestjs/common';
import { APP_GUARD } from '@nestjs/core';
import { ConfigService } from '@nestjs/config';
import request from 'supertest';
import { InvestorsController } from './investors.controller';
import { InvestorsService } from './investors.service';
import { JwtService } from '../../auth/jwt.service';
import { UserLookupService } from '../../auth/user-lookup.service';
import { JwtAuthGuard } from '../../auth/jwt-auth.guard';
import { PermissionsGuard } from '../../auth/permissions.guard';
import { PrismaService } from '../../../prisma/prisma.service';
import { mintTestJwt, TEST_SECRET } from '../../../../test/helpers/jwt.helper';
import { jwksTestProvider } from '../../../../test/helpers/jwks.helper';
import { mockAuthUser } from '../../../../test/helpers/auth-user.helper';

describe('InvestorsController', () => {
  let app: INestApplication;
  let svc: {
    list: ReturnType<typeof vi.fn>;
    detail: ReturnType<typeof vi.fn>;
    create: ReturnType<typeof vi.fn>;
    update: ReturnType<typeof vi.fn>;
  };
  let prismaPerms: ReturnType<typeof vi.fn>;

  beforeEach(async () => {
    svc = { list: vi.fn(), detail: vi.fn(), create: vi.fn(), update: vi.fn() };
    prismaPerms = vi
      .fn()
      .mockResolvedValue([
        { permission: { key: 'investor.read' } },
        { permission: { key: 'investor.create' } },
      ]);
    const config = {
      get: (k: string) => {
        if (k === 'SUPABASE_URL') return 'https://test.supabase.co';
        if (k === 'SUPABASE_JWT_SECRET') return TEST_SECRET;
        return undefined;
      },
    } as unknown as ConfigService;

    const moduleRef = await Test.createTestingModule({
      controllers: [InvestorsController],
      providers: [
        { provide: InvestorsService, useValue: svc },
        { provide: ConfigService, useValue: config },
        JwtService,
        await jwksTestProvider(),
        {
          provide: UserLookupService,
          useValue: {
            findByAuthId: vi
              .fn()
              .mockResolvedValue({ kind: 'found', user: mockAuthUser({ role: 'admin' }) }),
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

  it('GET /api/investors → 401 without token', async () => {
    await request(app.getHttpServer()).get('/api/investors').expect(401);
  });

  it('GET /api/investors → 200 with list', async () => {
    svc.list.mockResolvedValueOnce({ data: [], total: 0, limit: 50, offset: 0 });
    const t = await mintTestJwt({ sub: 'auth-uuid' });
    await request(app.getHttpServer())
      .get('/api/investors')
      .set('Authorization', `Bearer ${t}`)
      .expect(200);
  });

  it('GET /api/investors/:id → 404 when service throws', async () => {
    svc.detail.mockRejectedValueOnce(new NotFoundException('Inversor no encontrado'));
    const t = await mintTestJwt({ sub: 'auth-uuid' });
    await request(app.getHttpServer())
      .get('/api/investors/00000000-0000-4000-8000-000000000099')
      .set('Authorization', `Bearer ${t}`)
      .expect(404);
  });

  it('POST /api/investors → 401 without token', async () => {
    await request(app.getHttpServer()).post('/api/investors').send({}).expect(401);
  });

  it('POST /api/investors → 403 when role lacks investor.create', async () => {
    prismaPerms.mockResolvedValueOnce([{ permission: { key: 'investor.read' } }]);
    const t = await mintTestJwt({ sub: 'auth-uuid' });
    await request(app.getHttpServer())
      .post('/api/investors')
      .set('Authorization', `Bearer ${t}`)
      .send({ legal_name: 'X', rif: 'J-12345678-9', kind: 'juridica' })
      .expect(403);
  });

  it('POST /api/investors → 400 when RIF malformed (service throws BadRequest)', async () => {
    svc.create.mockRejectedValueOnce(new BadRequestException('RIF inválido'));
    const t = await mintTestJwt({ sub: 'auth-uuid' });
    await request(app.getHttpServer())
      .post('/api/investors')
      .set('Authorization', `Bearer ${t}`)
      .send({ legal_name: 'X', rif: 'foo', kind: 'juridica' })
      .expect(400);
  });

  it('POST /api/investors → 201 happy path', async () => {
    svc.create.mockResolvedValueOnce({
      id: 'i-1',
      legal_name: 'Nueva',
      rif: 'J-30123456-7',
      kind: 'juridica',
      status: 'active',
      email: null,
      phone: null,
      notes: null,
      created_at: new Date().toISOString(),
      active_cert_count: 0,
      total_invested: '0.0000',
    });
    const t = await mintTestJwt({ sub: 'auth-uuid' });
    const res = await request(app.getHttpServer())
      .post('/api/investors')
      .set('Authorization', `Bearer ${t}`)
      .send({ legal_name: 'Nueva', rif: 'J-30123456-7', kind: 'juridica' })
      .expect(201);
    expect(res.body.rif).toBe('J-30123456-7');
  });

  it('PATCH /api/investors/:id → 401 without token', async () => {
    await request(app.getHttpServer())
      .patch('/api/investors/00000000-0000-4000-8000-000000000010')
      .send({ email: 'new@x.com' })
      .expect(401);
  });

  it('PATCH /api/investors/:id → 403 when role lacks investor.update', async () => {
    prismaPerms.mockResolvedValueOnce([{ permission: { key: 'investor.read' } }]);
    const t = await mintTestJwt({ sub: 'auth-uuid' });
    await request(app.getHttpServer())
      .patch('/api/investors/00000000-0000-4000-8000-000000000010')
      .set('Authorization', `Bearer ${t}`)
      .send({ email: 'new@x.com' })
      .expect(403);
  });

  it('PATCH /api/investors/:id → 200 happy', async () => {
    prismaPerms.mockResolvedValueOnce([{ permission: { key: 'investor.update' } }]);
    svc.update.mockResolvedValueOnce({
      id: 'i-1',
      legal_name: 'Inversora Alpha',
      rif: 'J-12345678-9',
      kind: 'juridica',
      status: 'active',
      email: 'new@x.com',
      phone: null,
      notes: null,
      created_at: '2026-04-15T00:00:00.000Z',
      updated_at: '2026-05-06T12:00:00.000Z',
      updated_by: { id: 'u-1', email: 'op@cashea.app', full_name: 'Operator' },
      active_cert_count: 0,
      total_invested: '0.0000',
    });
    const t = await mintTestJwt({ sub: 'auth-uuid' });
    const res = await request(app.getHttpServer())
      .patch('/api/investors/00000000-0000-4000-8000-000000000010')
      .set('Authorization', `Bearer ${t}`)
      .send({ email: 'new@x.com' })
      .expect(200);
    expect(res.body.email).toBe('new@x.com');
    expect(res.body.updated_by.email).toBe('op@cashea.app');
  });

  it('PATCH /api/investors/:id → 400 when body is empty (Zod refine)', async () => {
    prismaPerms.mockResolvedValueOnce([{ permission: { key: 'investor.update' } }]);
    const t = await mintTestJwt({ sub: 'auth-uuid' });
    await request(app.getHttpServer())
      .patch('/api/investors/00000000-0000-4000-8000-000000000010')
      .set('Authorization', `Bearer ${t}`)
      .send({})
      .expect(400);
  });

  it('PATCH /api/investors/:id → 400 when body has unknown key (Zod strict)', async () => {
    prismaPerms.mockResolvedValueOnce([{ permission: { key: 'investor.update' } }]);
    const t = await mintTestJwt({ sub: 'auth-uuid' });
    await request(app.getHttpServer())
      .patch('/api/investors/00000000-0000-4000-8000-000000000010')
      .set('Authorization', `Bearer ${t}`)
      .send({ rif: 'J-99999999-9' })
      .expect(400);
  });
});

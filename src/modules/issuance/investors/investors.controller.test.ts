import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { Test } from '@nestjs/testing';
import { BadRequestException, ConflictException, INestApplication, NotFoundException } from '@nestjs/common';
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
import { mockAuthUser } from '../../../../test/helpers/auth-user.helper';

describe('InvestorsController', () => {
  let app: INestApplication;
  let svc: { list: ReturnType<typeof vi.fn>; detail: ReturnType<typeof vi.fn>; create: ReturnType<typeof vi.fn> };
  let prismaPerms: ReturnType<typeof vi.fn>;

  beforeEach(async () => {
    svc = { list: vi.fn(), detail: vi.fn(), create: vi.fn() };
    prismaPerms = vi.fn().mockResolvedValue([
      { permission: { key: 'investor.read' } },
      { permission: { key: 'investor.create' } },
    ]);
    const config = { get: (k: string) => (k === 'SUPABASE_JWT_SECRET' ? TEST_SECRET : undefined) } as unknown as ConfigService;

    const moduleRef = await Test.createTestingModule({
      controllers: [InvestorsController],
      providers: [
        { provide: InvestorsService, useValue: svc },
        { provide: ConfigService, useValue: config },
        JwtService,
        { provide: UserLookupService, useValue: { findByAuthId: vi.fn().mockResolvedValue({ kind: 'found', user: mockAuthUser({ role: 'admin' }) }) } },
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
    await request(app.getHttpServer()).get('/api/investors').set('Authorization', `Bearer ${t}`).expect(200);
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
      id: 'i-1', legal_name: 'Nueva', rif: 'J-30123456-7', kind: 'juridica', status: 'active',
      email: null, phone: null, notes: null,
      created_at: new Date().toISOString(), active_cert_count: 0, total_invested: '0.0000',
    });
    const t = await mintTestJwt({ sub: 'auth-uuid' });
    const res = await request(app.getHttpServer())
      .post('/api/investors')
      .set('Authorization', `Bearer ${t}`)
      .send({ legal_name: 'Nueva', rif: 'J-30123456-7', kind: 'juridica' })
      .expect(201);
    expect(res.body.rif).toBe('J-30123456-7');
  });
});

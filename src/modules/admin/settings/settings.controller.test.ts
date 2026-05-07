import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { Test } from '@nestjs/testing';
import { INestApplication } from '@nestjs/common';
import { APP_GUARD } from '@nestjs/core';
import { ConfigService } from '@nestjs/config';
import request from 'supertest';
import { SettingsController } from './settings.controller';
import { SettingsService } from './settings.service';
import { JwtService } from '../../auth/jwt.service';
import { UserLookupService } from '../../auth/user-lookup.service';
import { JwtAuthGuard } from '../../auth/jwt-auth.guard';
import { PermissionsGuard } from '../../auth/permissions.guard';
import { PrismaService } from '../../../prisma/prisma.service';
import { mintTestJwt, TEST_SECRET } from '../../../../test/helpers/jwt.helper';
import { jwksTestProvider } from '../../../../test/helpers/jwks.helper';
import { mockAuthUser } from '../../../../test/helpers/auth-user.helper';

describe('SettingsController', () => {
  let app: INestApplication;
  let svc: { get: ReturnType<typeof vi.fn>; update: ReturnType<typeof vi.fn> };
  let prismaPerms: ReturnType<typeof vi.fn>;

  beforeEach(async () => {
    svc = { get: vi.fn(), update: vi.fn() };
    // Default: caller has no admin perms (operator-shaped). Tests opt in to specific perms.
    prismaPerms = vi.fn().mockResolvedValue([]);
    const config = {
      get: (k: string) => {
        if (k === 'SUPABASE_URL') return 'https://test.supabase.co';
        if (k === 'SUPABASE_JWT_SECRET') return TEST_SECRET;
        return undefined;
      },
    } as unknown as ConfigService;

    const moduleRef = await Test.createTestingModule({
      controllers: [SettingsController],
      providers: [
        { provide: SettingsService, useValue: svc },
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

  it('GET /api/settings → 401 without token', async () => {
    await request(app.getHttpServer()).get('/api/settings').expect(401);
  });

  it('GET /api/settings → 200 happy (any authenticated user; no perm decorator)', async () => {
    svc.get.mockResolvedValueOnce({
      default_sweep_rate: '0.080000',
      shortfall_warning_threshold: '0.005000',
      concentration_warning_threshold: '0.150000',
      updated_at: '2026-04-15T00:00:00.000Z',
      updated_by: null,
    });
    const t = await mintTestJwt({ sub: 'auth-uuid' });
    const res = await request(app.getHttpServer())
      .get('/api/settings')
      .set('Authorization', `Bearer ${t}`)
      .expect(200);
    expect(res.body.default_sweep_rate).toBe('0.080000');
  });

  it('PATCH /api/settings → 401 without token', async () => {
    await request(app.getHttpServer())
      .patch('/api/settings')
      .send({ default_sweep_rate: 0.09 })
      .expect(401);
  });

  it('PATCH /api/settings → 403 when role lacks settings.manage', async () => {
    prismaPerms.mockResolvedValueOnce([{ permission: { key: 'audit.read' } }]);
    const t = await mintTestJwt({ sub: 'auth-uuid' });
    await request(app.getHttpServer())
      .patch('/api/settings')
      .set('Authorization', `Bearer ${t}`)
      .send({ default_sweep_rate: 0.09 })
      .expect(403);
  });

  it('PATCH /api/settings → 200 happy (admin)', async () => {
    prismaPerms.mockResolvedValueOnce([{ permission: { key: 'settings.manage' } }]);
    svc.update.mockResolvedValueOnce({
      default_sweep_rate: '0.090000',
      shortfall_warning_threshold: '0.005000',
      concentration_warning_threshold: '0.150000',
      updated_at: '2026-05-07T12:00:00.000Z',
      updated_by: { id: 'u-1', email: 'op@cashea.app', full_name: 'Operator' },
    });
    const t = await mintTestJwt({ sub: 'auth-uuid' });
    const res = await request(app.getHttpServer())
      .patch('/api/settings')
      .set('Authorization', `Bearer ${t}`)
      .send({ default_sweep_rate: 0.09 })
      .expect(200);
    expect(res.body.default_sweep_rate).toBe('0.090000');
    expect(res.body.updated_by.email).toBe('op@cashea.app');
  });

  it('PATCH /api/settings → 400 when body has unknown key (Zod strict)', async () => {
    prismaPerms.mockResolvedValueOnce([{ permission: { key: 'settings.manage' } }]);
    const t = await mintTestJwt({ sub: 'auth-uuid' });
    await request(app.getHttpServer())
      .patch('/api/settings')
      .set('Authorization', `Bearer ${t}`)
      .send({ id: 99, default_sweep_rate: 0.09 })
      .expect(400);
  });
});

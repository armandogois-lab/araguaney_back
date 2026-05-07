import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { Test } from '@nestjs/testing';
import { INestApplication } from '@nestjs/common';
import { APP_GUARD } from '@nestjs/core';
import { ConfigService } from '@nestjs/config';
import request from 'supertest';
import { AuditController } from './audit.controller';
import { AuditQueryService } from './audit.service';
import { JwtService } from '../../auth/jwt.service';
import { UserLookupService } from '../../auth/user-lookup.service';
import { JwtAuthGuard } from '../../auth/jwt-auth.guard';
import { PermissionsGuard } from '../../auth/permissions.guard';
import { PrismaService } from '../../../prisma/prisma.service';
import { mintTestJwt, TEST_SECRET } from '../../../../test/helpers/jwt.helper';
import { mockAuthUser } from '../../../../test/helpers/auth-user.helper';

describe('AuditController', () => {
  let app: INestApplication;
  let svc: { list: ReturnType<typeof vi.fn> };
  let prismaPerms: ReturnType<typeof vi.fn>;

  beforeEach(async () => {
    svc = { list: vi.fn() };
    prismaPerms = vi.fn().mockResolvedValue([]);
    const config = {
      get: (k: string) => (k === 'SUPABASE_JWT_SECRET' ? TEST_SECRET : undefined),
    } as unknown as ConfigService;

    const moduleRef = await Test.createTestingModule({
      controllers: [AuditController],
      providers: [
        { provide: AuditQueryService, useValue: svc },
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

  it('GET /api/audit → 401 without token', async () => {
    await request(app.getHttpServer()).get('/api/audit').expect(401);
  });

  it('GET /api/audit → 403 when role lacks audit.read', async () => {
    prismaPerms.mockResolvedValueOnce([{ permission: { key: 'investor.read' } }]);
    const t = await mintTestJwt({ sub: 'auth-uuid' });
    await request(app.getHttpServer())
      .get('/api/audit')
      .set('Authorization', `Bearer ${t}`)
      .expect(403);
  });

  it('GET /api/audit → 200 happy', async () => {
    prismaPerms.mockResolvedValueOnce([{ permission: { key: 'audit.read' } }]);
    svc.list.mockResolvedValueOnce({ data: [], total: 0, limit: 50, offset: 0 });
    const t = await mintTestJwt({ sub: 'auth-uuid' });
    const res = await request(app.getHttpServer())
      .get('/api/audit')
      .set('Authorization', `Bearer ${t}`)
      .expect(200);
    expect(res.body.total).toBe(0);
  });

  it('GET /api/audit?entity_id=foo → 400 (refine: entity_id without entity_type)', async () => {
    prismaPerms.mockResolvedValueOnce([{ permission: { key: 'audit.read' } }]);
    const t = await mintTestJwt({ sub: 'auth-uuid' });
    await request(app.getHttpServer())
      .get('/api/audit?entity_id=foo')
      .set('Authorization', `Bearer ${t}`)
      .expect(400);
  });

  it('GET /api/audit?entity_type=settings_typo → 400 (Zod enum)', async () => {
    prismaPerms.mockResolvedValueOnce([{ permission: { key: 'audit.read' } }]);
    const t = await mintTestJwt({ sub: 'auth-uuid' });
    await request(app.getHttpServer())
      .get('/api/audit?entity_type=settings_typo')
      .set('Authorization', `Bearer ${t}`)
      .expect(400);
  });
});

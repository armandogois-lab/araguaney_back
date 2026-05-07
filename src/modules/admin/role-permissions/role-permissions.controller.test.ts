import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { Test } from '@nestjs/testing';
import { ConflictException, INestApplication } from '@nestjs/common';
import { APP_GUARD } from '@nestjs/core';
import { ConfigService } from '@nestjs/config';
import request from 'supertest';
import { RolePermissionsController } from './role-permissions.controller';
import { RolePermissionsService } from './role-permissions.service';
import { JwtService } from '../../auth/jwt.service';
import { UserLookupService } from '../../auth/user-lookup.service';
import { JwtAuthGuard } from '../../auth/jwt-auth.guard';
import { PermissionsGuard } from '../../auth/permissions.guard';
import { PrismaService } from '../../../prisma/prisma.service';
import { mintTestJwt, TEST_SECRET } from '../../../../test/helpers/jwt.helper';
import { jwksTestProvider } from '../../../../test/helpers/jwks.helper';
import { mockAuthUser } from '../../../../test/helpers/auth-user.helper';

describe('RolePermissionsController', () => {
  let app: INestApplication;
  let svc: {
    getMatrix: ReturnType<typeof vi.fn>;
    grant: ReturnType<typeof vi.fn>;
    revoke: ReturnType<typeof vi.fn>;
  };
  let prismaPerms: ReturnType<typeof vi.fn>;

  beforeEach(async () => {
    svc = { getMatrix: vi.fn(), grant: vi.fn(), revoke: vi.fn() };
    prismaPerms = vi.fn().mockResolvedValue([]);
    const config = {
      get: (k: string) => {
        if (k === 'SUPABASE_URL') return 'https://test.supabase.co';
        if (k === 'SUPABASE_JWT_SECRET') return TEST_SECRET;
        return undefined;
      },
    } as unknown as ConfigService;

    const moduleRef = await Test.createTestingModule({
      controllers: [RolePermissionsController],
      providers: [
        { provide: RolePermissionsService, useValue: svc },
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

  it('GET /api/role-permissions → 401 without token', async () => {
    await request(app.getHttpServer()).get('/api/role-permissions').expect(401);
  });

  it('GET /api/role-permissions → 403 when role lacks permission.manage', async () => {
    prismaPerms.mockResolvedValueOnce([{ permission: { key: 'audit.read' } }]);
    const t = await mintTestJwt({ sub: 'auth-uuid' });
    await request(app.getHttpServer())
      .get('/api/role-permissions')
      .set('Authorization', `Bearer ${t}`)
      .expect(403);
  });

  it('GET /api/role-permissions → 200 happy', async () => {
    prismaPerms.mockResolvedValueOnce([{ permission: { key: 'permission.manage' } }]);
    svc.getMatrix.mockResolvedValueOnce({
      permissions: [{ key: 'audit.read', description: 'Ver audit' }],
      roles: ['operator', 'admin', 'auditor'],
      matrix: { operator: ['audit.read'], admin: ['audit.read'], auditor: ['audit.read'] },
    });
    const t = await mintTestJwt({ sub: 'auth-uuid' });
    const res = await request(app.getHttpServer())
      .get('/api/role-permissions')
      .set('Authorization', `Bearer ${t}`)
      .expect(200);
    expect(res.body.permissions).toHaveLength(1);
    expect(res.body.matrix.admin).toContain('audit.read');
  });

  it('PUT /:role/:permission_key → 401 without token', async () => {
    await request(app.getHttpServer()).put('/api/role-permissions/auditor/audit.read').expect(401);
  });

  it('PUT /:role/:permission_key → 403 when role lacks permission.manage', async () => {
    prismaPerms.mockResolvedValueOnce([{ permission: { key: 'audit.read' } }]);
    const t = await mintTestJwt({ sub: 'auth-uuid' });
    await request(app.getHttpServer())
      .put('/api/role-permissions/auditor/audit.read')
      .set('Authorization', `Bearer ${t}`)
      .expect(403);
  });

  it('PUT /:role/:permission_key → 200 happy', async () => {
    prismaPerms.mockResolvedValueOnce([{ permission: { key: 'permission.manage' } }]);
    svc.grant.mockResolvedValueOnce({
      role: 'auditor',
      permission_key: 'audit.read',
      granted: true,
    });
    const t = await mintTestJwt({ sub: 'auth-uuid' });
    const res = await request(app.getHttpServer())
      .put('/api/role-permissions/auditor/audit.read')
      .set('Authorization', `Bearer ${t}`)
      .expect(200);
    expect(res.body).toEqual({
      role: 'auditor',
      permission_key: 'audit.read',
      granted: true,
    });
  });

  it('PUT /invalid_role/audit.read → 400 (Zod role enum)', async () => {
    prismaPerms.mockResolvedValueOnce([{ permission: { key: 'permission.manage' } }]);
    const t = await mintTestJwt({ sub: 'auth-uuid' });
    await request(app.getHttpServer())
      .put('/api/role-permissions/superuser/audit.read')
      .set('Authorization', `Bearer ${t}`)
      .expect(400);
  });

  it('DELETE /:role/:permission_key → 204 happy', async () => {
    prismaPerms.mockResolvedValueOnce([{ permission: { key: 'permission.manage' } }]);
    svc.revoke.mockResolvedValueOnce(undefined);
    const t = await mintTestJwt({ sub: 'auth-uuid' });
    await request(app.getHttpServer())
      .delete('/api/role-permissions/auditor/audit.read')
      .set('Authorization', `Bearer ${t}`)
      .expect(204);
  });

  it('DELETE /admin/permission.manage → 409 (lockout protection)', async () => {
    prismaPerms.mockResolvedValueOnce([{ permission: { key: 'permission.manage' } }]);
    svc.revoke.mockRejectedValueOnce(
      new ConflictException({
        message: 'No se puede revocar permission.manage del rol admin',
        role: 'admin',
        permission_key: 'permission.manage',
      }),
    );
    const t = await mintTestJwt({ sub: 'auth-uuid' });
    const res = await request(app.getHttpServer())
      .delete('/api/role-permissions/admin/permission.manage')
      .set('Authorization', `Bearer ${t}`)
      .expect(409);
    expect(res.body.role).toBe('admin');
    expect(res.body.permission_key).toBe('permission.manage');
  });
});

import { describe, it, beforeEach, afterEach, vi } from 'vitest';
import { Test } from '@nestjs/testing';
import { INestApplication } from '@nestjs/common';
import { APP_GUARD } from '@nestjs/core';
import { ConfigService } from '@nestjs/config';
import request from 'supertest';
import { InstallmentsController } from './installments.controller';
import { InstallmentsService } from './installments.service';
import { JwtService } from '../../auth/jwt.service';
import { UserLookupService } from '../../auth/user-lookup.service';
import { JwtAuthGuard } from '../../auth/jwt-auth.guard';
import { PermissionsGuard } from '../../auth/permissions.guard';
import { PrismaService } from '../../../prisma/prisma.service';
import { mintTestJwt, TEST_SECRET } from '../../../../test/helpers/jwt.helper';
import { jwksTestProvider } from '../../../../test/helpers/jwks.helper';
import { mockAuthUser } from '../../../../test/helpers/auth-user.helper';

describe('InstallmentsController', () => {
  let app: INestApplication;
  let svc: { list: ReturnType<typeof vi.fn> };

  beforeEach(async () => {
    svc = { list: vi.fn() };
    const config = {
      get: (k: string) => {
        if (k === 'SUPABASE_URL') return 'https://test.supabase.co';
        if (k === 'SUPABASE_JWT_SECRET') return TEST_SECRET;
        return undefined;
      },
    } as unknown as ConfigService;
    const moduleRef = await Test.createTestingModule({
      controllers: [InstallmentsController],
      providers: [
        { provide: InstallmentsService, useValue: svc },
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

  it('GET /api/installments → 401 without Authorization', async () => {
    await request(app.getHttpServer()).get('/api/installments').expect(401);
  });

  it('GET /api/installments → 200 with empty list', async () => {
    svc.list.mockResolvedValueOnce({ data: [], total: 0, limit: 50, offset: 0 });
    const token = await mintTestJwt({ sub: 'auth-uuid' });
    await request(app.getHttpServer())
      .get('/api/installments?status=pending')
      .set('Authorization', `Bearer ${token}`)
      .expect(200);
  });
});

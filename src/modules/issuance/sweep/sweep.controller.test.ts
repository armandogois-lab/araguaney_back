import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { Test } from '@nestjs/testing';
import { ConflictException, INestApplication } from '@nestjs/common';
import { APP_GUARD } from '@nestjs/core';
import { ConfigService } from '@nestjs/config';
import request from 'supertest';
import { SweepController } from './sweep.controller';
import { SweepService } from './sweep.service';
import { JwtService } from '../../auth/jwt.service';
import { UserLookupService } from '../../auth/user-lookup.service';
import { JwtAuthGuard } from '../../auth/jwt-auth.guard';
import { PermissionsGuard } from '../../auth/permissions.guard';
import { PrismaService } from '../../../prisma/prisma.service';
import { mintTestJwt, TEST_SECRET } from '../../../../test/helpers/jwt.helper';
import { jwksTestProvider } from '../../../../test/helpers/jwks.helper';
import { mockAuthUser } from '../../../../test/helpers/auth-user.helper';

describe('SweepController', () => {
  let app: INestApplication;
  let svc: {
    simulateSweep: ReturnType<typeof vi.fn>;
    issueSweep: ReturnType<typeof vi.fn>;
  };
  let prismaPerms: ReturnType<typeof vi.fn>;

  beforeEach(async () => {
    svc = { simulateSweep: vi.fn(), issueSweep: vi.fn() };
    prismaPerms = vi.fn().mockResolvedValue([{ permission: { key: 'certificate.sweep' } }]);
    const config = {
      get: (k: string) => {
        if (k === 'SUPABASE_URL') return 'https://test.supabase.co';
        if (k === 'SUPABASE_JWT_SECRET') return TEST_SECRET;
        return undefined;
      },
    } as unknown as ConfigService;

    const moduleRef = await Test.createTestingModule({
      controllers: [SweepController],
      providers: [
        { provide: SweepService, useValue: svc },
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

  const futureDate = () => {
    const d = new Date();
    d.setUTCDate(d.getUTCDate() + 7);
    return d.toISOString().slice(0, 10);
  };

  it('POST /api/certificates/sweep/simulate → 401 without token', async () => {
    await request(app.getHttpServer())
      .post('/api/certificates/sweep/simulate')
      .send({})
      .expect(401);
  });

  it('POST /api/certificates/sweep/simulate → 403 when role lacks certificate.sweep', async () => {
    prismaPerms.mockResolvedValueOnce([{ permission: { key: 'certificate.read' } }]);
    const t = await mintTestJwt({ sub: 'auth-uuid' });
    await request(app.getHttpServer())
      .post('/api/certificates/sweep/simulate')
      .set('Authorization', `Bearer ${t}`)
      .send({ term_days: 14, issue_date: futureDate() })
      .expect(403);
  });

  it('POST /api/certificates/sweep/simulate → 200 happy', async () => {
    svc.simulateSweep.mockResolvedValueOnce({
      rules_check: { maturity_boundary: true, order_indivisibility: true, round_down: true },
      payload_hash: 'a'.repeat(64),
    });
    const t = await mintTestJwt({ sub: 'auth-uuid' });
    const res = await request(app.getHttpServer())
      .post('/api/certificates/sweep/simulate')
      .set('Authorization', `Bearer ${t}`)
      .send({ term_days: 14, issue_date: futureDate() })
      .expect(200);
    expect(res.body.payload_hash).toMatch(/^[a-f0-9]{64}$/);
  });

  it('POST /api/certificates/sweep → 401 without token', async () => {
    await request(app.getHttpServer()).post('/api/certificates/sweep').send({}).expect(401);
  });

  it('POST /api/certificates/sweep → 201 happy', async () => {
    svc.issueSweep.mockResolvedValueOnce({ id: 'cert-1', certificate_code: 'C4575A' });
    const t = await mintTestJwt({ sub: 'auth-uuid' });
    const res = await request(app.getHttpServer())
      .post('/api/certificates/sweep')
      .set('Authorization', `Bearer ${t}`)
      .send({
        term_days: 14,
        issue_date: futureDate(),
        order_ids: ['00000000-0000-4000-8000-000000000010'],
        expected_payload_hash: 'a'.repeat(64),
      })
      .expect(201);
    expect(res.body.certificate_code).toBe('C4575A');
  });

  it('POST /api/certificates/sweep → 409 when service throws ConflictException', async () => {
    svc.issueSweep.mockRejectedValueOnce(
      new ConflictException({
        message: 'Ya existe un sweep para esta semana',
        cycle_week: '2026-W20',
      }),
    );
    const t = await mintTestJwt({ sub: 'auth-uuid' });
    const res = await request(app.getHttpServer())
      .post('/api/certificates/sweep')
      .set('Authorization', `Bearer ${t}`)
      .send({
        term_days: 14,
        issue_date: futureDate(),
        order_ids: ['00000000-0000-4000-8000-000000000010'],
        expected_payload_hash: 'a'.repeat(64),
      })
      .expect(409);
    expect(res.body.cycle_week).toBe('2026-W20');
  });
});

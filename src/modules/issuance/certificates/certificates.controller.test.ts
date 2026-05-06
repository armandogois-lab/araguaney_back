import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { Test } from '@nestjs/testing';
import { ConflictException, INestApplication, NotFoundException } from '@nestjs/common';
import { APP_GUARD } from '@nestjs/core';
import { ConfigService } from '@nestjs/config';
import request from 'supertest';
import { CertificatesController } from './certificates.controller';
import { CertificatesService } from './certificates.service';
import { JwtService } from '../../auth/jwt.service';
import { UserLookupService } from '../../auth/user-lookup.service';
import { JwtAuthGuard } from '../../auth/jwt-auth.guard';
import { PermissionsGuard } from '../../auth/permissions.guard';
import { PrismaService } from '../../../prisma/prisma.service';
import { mintTestJwt, TEST_SECRET } from '../../../../test/helpers/jwt.helper';
import { mockAuthUser } from '../../../../test/helpers/auth-user.helper';

describe('CertificatesController', () => {
  let app: INestApplication;
  let svc: {
    simulate: ReturnType<typeof vi.fn>;
    issue: ReturnType<typeof vi.fn>;
    list: ReturnType<typeof vi.fn>;
    detail: ReturnType<typeof vi.fn>;
    cancel: ReturnType<typeof vi.fn>;
  };
  let prismaPerms: ReturnType<typeof vi.fn>;

  beforeEach(async () => {
    svc = { simulate: vi.fn(), issue: vi.fn(), list: vi.fn(), detail: vi.fn(), cancel: vi.fn() };
    prismaPerms = vi
      .fn()
      .mockResolvedValue([
        { permission: { key: 'certificate.simulate' } },
        { permission: { key: 'certificate.issue' } },
        { permission: { key: 'certificate.read' } },
      ]);
    const config = {
      get: (k: string) => (k === 'SUPABASE_JWT_SECRET' ? TEST_SECRET : undefined),
    } as unknown as ConfigService;

    const moduleRef = await Test.createTestingModule({
      controllers: [CertificatesController],
      providers: [
        { provide: CertificatesService, useValue: svc },
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

  const futureDate = () => {
    const d = new Date();
    d.setUTCDate(d.getUTCDate() + 7);
    return d.toISOString().slice(0, 10);
  };

  it('POST /api/certificates/simulate → 401 without token', async () => {
    await request(app.getHttpServer()).post('/api/certificates/simulate').send({}).expect(401);
  });

  it('POST /api/certificates/simulate → 403 when role lacks certificate.simulate', async () => {
    prismaPerms.mockResolvedValueOnce([{ permission: { key: 'certificate.read' } }]);
    const t = await mintTestJwt({ sub: 'auth-uuid' });
    await request(app.getHttpServer())
      .post('/api/certificates/simulate')
      .set('Authorization', `Bearer ${t}`)
      .send({
        investor_id: '00000000-0000-4000-8000-000000000001',
        capital: 100,
        rate: 0.13,
        term_days: 42,
        issue_date: futureDate(),
      })
      .expect(403);
  });

  it('POST /api/certificates/simulate → 200 happy', async () => {
    svc.simulate.mockResolvedValueOnce({
      rules_check: { maturity_boundary: true, order_indivisibility: true, round_down: true },
      payload_hash: 'a'.repeat(64),
    });
    const t = await mintTestJwt({ sub: 'auth-uuid' });
    const res = await request(app.getHttpServer())
      .post('/api/certificates/simulate')
      .set('Authorization', `Bearer ${t}`)
      .send({
        investor_id: '00000000-0000-4000-8000-000000000001',
        capital: 100,
        rate: 0.13,
        term_days: 42,
        issue_date: futureDate(),
      })
      .expect(200);
    expect(res.body.payload_hash).toMatch(/^[a-f0-9]{64}$/);
  });

  it('POST /api/certificates → 401 without token', async () => {
    await request(app.getHttpServer()).post('/api/certificates').send({}).expect(401);
  });

  it('POST /api/certificates → 403 when role lacks certificate.issue', async () => {
    prismaPerms.mockResolvedValueOnce([{ permission: { key: 'certificate.simulate' } }]);
    const t = await mintTestJwt({ sub: 'auth-uuid' });
    await request(app.getHttpServer())
      .post('/api/certificates')
      .set('Authorization', `Bearer ${t}`)
      .send({
        investor_id: '00000000-0000-4000-8000-000000000001',
        capital: 100,
        rate: 0.13,
        term_days: 42,
        issue_date: futureDate(),
        order_ids: ['00000000-0000-4000-8000-000000000010'],
        expected_payload_hash: 'a'.repeat(64),
      })
      .expect(403);
  });

  it('POST /api/certificates → 201 happy', async () => {
    svc.issue.mockResolvedValueOnce({ id: 'cert-1', certificate_code: 'C4572A' });
    const t = await mintTestJwt({ sub: 'auth-uuid' });
    const res = await request(app.getHttpServer())
      .post('/api/certificates')
      .set('Authorization', `Bearer ${t}`)
      .send({
        investor_id: '00000000-0000-4000-8000-000000000001',
        capital: 100,
        rate: 0.13,
        term_days: 42,
        issue_date: futureDate(),
        order_ids: ['00000000-0000-4000-8000-000000000010'],
        expected_payload_hash: 'a'.repeat(64),
      })
      .expect(201);
    expect(res.body.certificate_code).toBe('C4572A');
  });

  it('POST /api/certificates → 409 when service throws ConflictException', async () => {
    svc.issue.mockRejectedValueOnce(
      new ConflictException({ message: 'Orden(es) ya asignada(s)', conflicting_order_ids: ['x'] }),
    );
    const t = await mintTestJwt({ sub: 'auth-uuid' });
    const res = await request(app.getHttpServer())
      .post('/api/certificates')
      .set('Authorization', `Bearer ${t}`)
      .send({
        investor_id: '00000000-0000-4000-8000-000000000001',
        capital: 100,
        rate: 0.13,
        term_days: 42,
        issue_date: futureDate(),
        order_ids: ['00000000-0000-4000-8000-000000000010'],
        expected_payload_hash: 'a'.repeat(64),
      })
      .expect(409);
    expect(res.body.conflicting_order_ids).toEqual(['x']);
  });

  it('GET /api/certificates → 200 with paginated list', async () => {
    svc.list.mockResolvedValueOnce({ data: [], total: 0, limit: 50, offset: 0 });
    const t = await mintTestJwt({ sub: 'auth-uuid' });
    await request(app.getHttpServer())
      .get('/api/certificates')
      .set('Authorization', `Bearer ${t}`)
      .expect(200);
  });

  it('GET /api/certificates/:id → 404 when service throws', async () => {
    svc.detail.mockRejectedValueOnce(new NotFoundException('Certificado no encontrado'));
    const t = await mintTestJwt({ sub: 'auth-uuid' });
    await request(app.getHttpServer())
      .get('/api/certificates/00000000-0000-4000-8000-000000000099')
      .set('Authorization', `Bearer ${t}`)
      .expect(404);
  });

  it('POST /api/certificates/:id/cancel → 401 without token', async () => {
    await request(app.getHttpServer())
      .post('/api/certificates/00000000-0000-4000-8000-000000000010/cancel')
      .send({ reason: 'Some reason for cancel' })
      .expect(401);
  });

  it('POST /api/certificates/:id/cancel → 403 when role lacks certificate.cancel', async () => {
    prismaPerms.mockResolvedValueOnce([{ permission: { key: 'certificate.read' } }]);
    const t = await mintTestJwt({ sub: 'auth-uuid' });
    await request(app.getHttpServer())
      .post('/api/certificates/00000000-0000-4000-8000-000000000010/cancel')
      .set('Authorization', `Bearer ${t}`)
      .send({ reason: 'Some reason for cancel' })
      .expect(403);
  });

  it('POST /api/certificates/:id/cancel → 200 happy', async () => {
    prismaPerms.mockResolvedValueOnce([{ permission: { key: 'certificate.cancel' } }]);
    svc.cancel.mockResolvedValueOnce({
      id: 'cert-1',
      certificate_code: 'C4572A',
      status: 'cancelled',
      cancelled_at: '2026-05-06T12:00:00.000Z',
      released_order_count: 2,
    });
    const t = await mintTestJwt({ sub: 'auth-uuid' });
    const res = await request(app.getHttpServer())
      .post('/api/certificates/00000000-0000-4000-8000-000000000010/cancel')
      .set('Authorization', `Bearer ${t}`)
      .send({ reason: 'Operator entered wrong rate' })
      .expect(200);
    expect(res.body.status).toBe('cancelled');
    expect(res.body.released_order_count).toBe(2);
  });

  it('POST /api/certificates/:id/cancel → 400 when reason is too short (Zod)', async () => {
    prismaPerms.mockResolvedValueOnce([{ permission: { key: 'certificate.cancel' } }]);
    const t = await mintTestJwt({ sub: 'auth-uuid' });
    await request(app.getHttpServer())
      .post('/api/certificates/00000000-0000-4000-8000-000000000010/cancel')
      .set('Authorization', `Bearer ${t}`)
      .send({ reason: 'no' })
      .expect(400);
  });

  it('GET /api/certificates passes callerRole to the service', async () => {
    svc.list.mockResolvedValueOnce({ data: [], total: 0, limit: 50, offset: 0 });
    const t = await mintTestJwt({ sub: 'auth-uuid' });
    await request(app.getHttpServer())
      .get('/api/certificates?include_deleted=true')
      .set('Authorization', `Bearer ${t}`)
      .expect(200);
    expect(svc.list).toHaveBeenCalledOnce();
    const callArgs = svc.list.mock.calls[0]!;
    expect(callArgs[0]).toMatchObject({ include_deleted: true });
    expect(callArgs[1]).toBe('operator');
  });
});

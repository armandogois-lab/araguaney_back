import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { Test } from '@nestjs/testing';
import { INestApplication } from '@nestjs/common';
import { APP_GUARD } from '@nestjs/core';
import { ConfigService } from '@nestjs/config';
import request from 'supertest';
import { BatchesController } from './batches.controller';
import { BatchesService } from './batches.service';
import { JwtService } from '../auth/jwt.service';
import { UserLookupService } from '../auth/user-lookup.service';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { PermissionsGuard } from '../auth/permissions.guard';
import { PrismaService } from '../../prisma/prisma.service';
import { mintTestJwt, TEST_SECRET } from '../../../test/helpers/jwt.helper';
import { mockAuthUser } from '../../../test/helpers/auth-user.helper';
import { buildWorkbook, STANDARD_HEADERS } from '../../../test/helpers/xlsx.helper';

describe('BatchesController', () => {
  let app: INestApplication;
  let svc: { upload: ReturnType<typeof vi.fn> };
  let prismaPerms: ReturnType<typeof vi.fn>;
  let prismaBatchFindUnique: ReturnType<typeof vi.fn>;
  let prismaBatchFindMany: ReturnType<typeof vi.fn>;
  let prismaBatchCount: ReturnType<typeof vi.fn>;
  let prismaErrorsFindMany: ReturnType<typeof vi.fn>;
  let prismaErrorsCount: ReturnType<typeof vi.fn>;
  let lookup: { findByAuthId: ReturnType<typeof vi.fn> };

  beforeEach(async () => {
    svc = { upload: vi.fn() };
    prismaPerms = vi
      .fn()
      .mockResolvedValue([
        { permission: { key: 'batch.upload' } },
        { permission: { key: 'batch.read' } },
      ]);
    prismaBatchFindUnique = vi.fn();
    prismaBatchFindMany = vi.fn().mockResolvedValue([]);
    prismaBatchCount = vi.fn().mockResolvedValue(0);
    prismaErrorsFindMany = vi.fn().mockResolvedValue([]);
    prismaErrorsCount = vi.fn().mockResolvedValue(0);

    lookup = {
      findByAuthId: vi
        .fn()
        .mockResolvedValue({ kind: 'found', user: mockAuthUser({ role: 'operator' }) }),
    };

    const config = {
      get: (key: string) => (key === 'SUPABASE_JWT_SECRET' ? TEST_SECRET : undefined),
    } as unknown as ConfigService;

    const moduleRef = await Test.createTestingModule({
      controllers: [BatchesController],
      providers: [
        { provide: BatchesService, useValue: svc },
        { provide: ConfigService, useValue: config },
        JwtService,
        { provide: UserLookupService, useValue: lookup },
        {
          provide: PrismaService,
          useValue: {
            rolePermission: { findMany: prismaPerms },
            batch: {
              findUnique: prismaBatchFindUnique,
              findMany: prismaBatchFindMany,
              count: prismaBatchCount,
            },
            importError: { findMany: prismaErrorsFindMany, count: prismaErrorsCount },
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

  async function makeXlsx(): Promise<Buffer> {
    return await buildWorkbook({
      sheets: [
        {
          name: 'S1',
          headers: [...STANDARD_HEADERS],
          rows: [],
        },
      ],
    });
  }

  it('POST /api/batches → 401 without Authorization', async () => {
    const buf = await makeXlsx();
    await request(app.getHttpServer())
      .post('/api/batches')
      .attach('file', buf, 'a.xlsx')
      .expect(401);
  });

  it('POST /api/batches → 403 when role lacks batch.upload', async () => {
    prismaPerms.mockResolvedValueOnce([{ permission: { key: 'batch.read' } }]);
    const token = await mintTestJwt({ sub: 'auth-uuid' });
    const buf = await makeXlsx();
    await request(app.getHttpServer())
      .post('/api/batches')
      .set('Authorization', `Bearer ${token}`)
      .attach('file', buf, 'a.xlsx')
      .expect(403);
  });

  it('POST /api/batches → 400 when no file is attached', async () => {
    const token = await mintTestJwt({ sub: 'auth-uuid' });
    await request(app.getHttpServer())
      .post('/api/batches')
      .set('Authorization', `Bearer ${token}`)
      .expect(400);
  });

  it('POST /api/batches → 400 when file is .xls (legacy format)', async () => {
    const token = await mintTestJwt({ sub: 'auth-uuid' });
    await request(app.getHttpServer())
      .post('/api/batches')
      .set('Authorization', `Bearer ${token}`)
      .attach('file', Buffer.from('binary'), {
        filename: 'a.xls',
        contentType: 'application/vnd.ms-excel',
      })
      .expect(400);
  });

  it('POST /api/batches → 400 when file > 10 MB', async () => {
    const token = await mintTestJwt({ sub: 'auth-uuid' });
    const big = Buffer.alloc(11 * 1024 * 1024);
    await request(app.getHttpServer())
      .post('/api/batches')
      .set('Authorization', `Bearer ${token}`)
      .attach('file', big, {
        filename: 'big.xlsx',
        contentType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      })
      .expect(400);
  });

  it('POST /api/batches → 200 with imported result', async () => {
    svc.upload.mockResolvedValueOnce({
      batch_id: 'b-1',
      external_code: 'B-20260506-103245',
      excel_upload_id: 'u-1',
      status: 'imported',
      rows_imported: 5,
      rows_rejected: 0,
      total_orders_amount: '1500.0000',
      total_installments_amount: '1125.0000',
      imported_at: '2026-05-06T10:32:45.000Z',
      rejection_reason: null,
      decimal_separator_detected: 'dot',
      errors_preview: [],
      errors_total: 0,
    });
    const token = await mintTestJwt({ sub: 'auth-uuid' });
    const buf = await makeXlsx();
    const res = await request(app.getHttpServer())
      .post('/api/batches')
      .set('Authorization', `Bearer ${token}`)
      .attach('file', buf, 'a.xlsx')
      .expect(200);
    expect(res.body.batch_id).toBe('b-1');
    expect(res.body.status).toBe('imported');
  });

  it('POST /api/batches → 409 when content_hash duplicate (service throws ConflictException)', async () => {
    const { ConflictException } = await import('@nestjs/common');
    svc.upload.mockRejectedValueOnce(
      new ConflictException({
        message: 'Archivo ya fue subido',
        existing_batch_id: 'prev-batch',
        existing_excel_upload_id: 'prev-upload',
      }),
    );
    const token = await mintTestJwt({ sub: 'auth-uuid' });
    const buf = await makeXlsx();
    const res = await request(app.getHttpServer())
      .post('/api/batches')
      .set('Authorization', `Bearer ${token}`)
      .attach('file', buf, 'a.xlsx')
      .expect(409);
    expect(res.body.existing_batch_id).toBe('prev-batch');
  });

  it('POST /api/batches → errors_preview is capped at 50 even when total is higher', async () => {
    svc.upload.mockResolvedValueOnce({
      batch_id: 'b-1',
      external_code: 'B-CODE',
      excel_upload_id: 'u-1',
      status: 'imported',
      rows_imported: 0,
      rows_rejected: 60,
      total_orders_amount: '0.0000',
      total_installments_amount: '0.0000',
      imported_at: '2026-05-06T10:32:45.000Z',
      rejection_reason: null,
      decimal_separator_detected: 'dot',
      errors_preview: Array.from({ length: 50 }, (_, i) => ({
        sheet_name: 'S1',
        row_number: i + 2,
        field_name: 'rif',
        error_code: 'invalid_rif',
        error_message: 'RIF inválido',
      })),
      errors_total: 60,
    });
    const token = await mintTestJwt({ sub: 'auth-uuid' });
    const buf = await makeXlsx();
    const res = await request(app.getHttpServer())
      .post('/api/batches')
      .set('Authorization', `Bearer ${token}`)
      .attach('file', buf, 'a.xlsx')
      .expect(200);
    expect(res.body.errors_total).toBe(60);
    expect(res.body.errors_preview).toHaveLength(50);
  });

  it('GET /api/batches → 200 with empty list', async () => {
    const token = await mintTestJwt({ sub: 'auth-uuid' });
    const res = await request(app.getHttpServer())
      .get('/api/batches')
      .set('Authorization', `Bearer ${token}`)
      .expect(200);
    expect(res.body).toEqual({ data: [], total: 0, limit: 50, offset: 0 });
  });

  it('GET /api/batches → 400 on invalid query (bad status enum)', async () => {
    const token = await mintTestJwt({ sub: 'auth-uuid' });
    await request(app.getHttpServer())
      .get('/api/batches?status=bogus')
      .set('Authorization', `Bearer ${token}`)
      .expect(400);
  });

  it('GET /api/batches/:id → 404 when not found', async () => {
    prismaBatchFindUnique.mockResolvedValueOnce(null);
    const token = await mintTestJwt({ sub: 'auth-uuid' });
    await request(app.getHttpServer())
      .get('/api/batches/00000000-0000-4000-8000-000000000099')
      .set('Authorization', `Bearer ${token}`)
      .expect(404);
  });

  it('GET /api/batches/:id/errors → 404 when batch not found', async () => {
    prismaBatchFindUnique.mockResolvedValueOnce(null);
    const token = await mintTestJwt({ sub: 'auth-uuid' });
    await request(app.getHttpServer())
      .get('/api/batches/00000000-0000-4000-8000-000000000099/errors')
      .set('Authorization', `Bearer ${token}`)
      .expect(404);
  });

  it('GET /api/batches/:id/errors → 200 with paginated list when batch exists', async () => {
    prismaBatchFindUnique.mockResolvedValueOnce({ id: '00000000-0000-4000-8000-000000000001' });
    prismaErrorsFindMany.mockResolvedValueOnce([
      {
        id: 'e-1',
        sheet_name: 'S1',
        row_number: 5,
        field_name: 'rif',
        error_code: 'invalid_rif',
        error_message: 'RIF inválido',
        raw_value: 'foo',
        created_at: new Date('2026-05-06T10:00:00Z'),
      },
    ]);
    prismaErrorsCount.mockResolvedValueOnce(1);
    const token = await mintTestJwt({ sub: 'auth-uuid' });
    const res = await request(app.getHttpServer())
      .get('/api/batches/00000000-0000-4000-8000-000000000001/errors')
      .set('Authorization', `Bearer ${token}`)
      .expect(200);
    expect(res.body.total).toBe(1);
    expect(res.body.data[0].error_code).toBe('invalid_rif');
  });
});

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { ConflictException } from '@nestjs/common';
import { BatchesService } from './batches.service';
import type { IngestionService } from './ingestion.service';
import type { StorageService } from './storage.service';
import { PrismaService } from '../../prisma/prisma.service';

function makePrisma() {
  return {
    excelUpload: {
      findUnique: vi.fn(),
      findFirst: vi.fn(),
      create: vi.fn(),
    },
    batch: {
      create: vi.fn().mockImplementation(async ({ data }: { data: unknown }) => ({
        id: 'batch-uuid',
        ...(data as object),
      })),
    },
  } as unknown as PrismaService;
}

function makeIngestion(): IngestionService {
  return {
    parseAndImport: vi.fn().mockResolvedValue({
      status: 'imported',
      rowsImported: 5,
      rowsRejected: 1,
      totalOrdersAmount: '1500.0000',
      totalInstallmentsAmount: '1125.0000',
      rejectionReason: null,
      decimalSeparatorDetected: 'dot',
      errorsTotal: 1,
      errorsPreview: [],
    }),
  } as unknown as IngestionService;
}

function makeStorage(): StorageService {
  return {
    uploadExcel: vi.fn().mockResolvedValue('uuid.xlsx'),
  } as unknown as StorageService;
}

describe('BatchesService.upload', () => {
  let prisma: PrismaService;
  let ingestion: IngestionService;
  let storage: StorageService;
  let svc: BatchesService;

  beforeEach(() => {
    prisma = makePrisma();
    ingestion = makeIngestion();
    storage = makeStorage();
    svc = new BatchesService(prisma, ingestion, storage);
    (prisma.excelUpload.findFirst as ReturnType<typeof vi.fn>).mockResolvedValue(null);
    (prisma.excelUpload.create as ReturnType<typeof vi.fn>).mockResolvedValue({
      id: 'upload-uuid',
    });
  });

  it('happy path: hashes file, uploads to storage, creates rows, returns response', async () => {
    const buffer = Buffer.from('hello');
    const result = await svc.upload({
      fileBuffer: buffer,
      filename: 'test.xlsx',
      mimeType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      actorId: 'user-1',
      externalCode: undefined,
    });

    expect(result.batch_id).toBe('batch-uuid');
    expect(result.excel_upload_id).toBe('upload-uuid');
    expect(result.status).toBe('imported');
    expect(result.rows_imported).toBe(5);
    expect(storage.uploadExcel).toHaveBeenCalled();
    expect(ingestion.parseAndImport).toHaveBeenCalledWith({
      batchId: 'batch-uuid',
      fileBuffer: buffer,
      actorId: 'user-1',
    });
  });

  it('rejects duplicate content_hash with ConflictException carrying existing_batch_id', async () => {
    (prisma.excelUpload.findFirst as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
      id: 'prev-upload',
      content_hash: 'h',
      batch: { id: 'prev-batch' },
    });
    await expect(
      svc.upload({
        fileBuffer: Buffer.from('hello'),
        filename: 'test.xlsx',
        mimeType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
        actorId: 'user-1',
        externalCode: undefined,
      }),
    ).rejects.toBeInstanceOf(ConflictException);
  });

  it('uses provided external_code when given', async () => {
    await svc.upload({
      fileBuffer: Buffer.from('hello'),
      filename: 'test.xlsx',
      mimeType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      actorId: 'user-1',
      externalCode: 'B-CUSTOM-001',
    });
    const call = (prisma.batch.create as ReturnType<typeof vi.fn>).mock.calls[0]![0] as {
      data: { external_code: string };
    };
    expect(call.data.external_code).toBe('B-CUSTOM-001');
  });

  it('generates external_code when not provided', async () => {
    await svc.upload({
      fileBuffer: Buffer.from('hello'),
      filename: 'test.xlsx',
      mimeType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      actorId: 'user-1',
      externalCode: undefined,
    });
    const call = (prisma.batch.create as ReturnType<typeof vi.fn>).mock.calls[0]![0] as {
      data: { external_code: string };
    };
    expect(call.data.external_code).toMatch(/^B-\d{8}-\d{6}$/);
  });

  it('computes sha256 of the buffer for content_hash', async () => {
    await svc.upload({
      fileBuffer: Buffer.from('hello'),
      filename: 'test.xlsx',
      mimeType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      actorId: 'user-1',
      externalCode: undefined,
    });
    const call = (prisma.excelUpload.create as ReturnType<typeof vi.fn>).mock.calls[0]![0] as {
      data: { content_hash: string };
    };
    expect(call.data.content_hash).toBe(
      '2cf24dba5fb0a30e26e83b2ac5b9e29e1b161e5c1fa7425e73043362938b9824',
    );
  });

  it('returns errors_preview from ingestion result', async () => {
    (ingestion.parseAndImport as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
      status: 'imported',
      rowsImported: 0,
      rowsRejected: 2,
      totalOrdersAmount: '0.0000',
      totalInstallmentsAmount: '0.0000',
      rejectionReason: null,
      decimalSeparatorDetected: 'dot',
      errorsTotal: 2,
      errorsPreview: [
        {
          sheetName: 'S1',
          rowNumber: 2,
          fieldName: 'rif',
          errorCode: 'invalid_rif',
          errorMessage: 'RIF con formato inválido',
          rawValue: 'foo',
        },
        {
          sheetName: 'S1',
          rowNumber: 3,
          fieldName: 'monto de cuota',
          errorCode: 'invalid_amount',
          errorMessage: 'Monto inválido: NA',
          rawValue: 'NA',
        },
      ],
    });
    const result = await svc.upload({
      fileBuffer: Buffer.from('hello'),
      filename: 'test.xlsx',
      mimeType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      actorId: 'user-1',
      externalCode: undefined,
    });
    expect(result.errors_total).toBe(2);
    expect(result.errors_preview).toHaveLength(2);
    expect(result.errors_preview[0]!.error_code).toBe('invalid_rif');
  });
});

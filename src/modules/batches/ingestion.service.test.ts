import { describe, it, expect, vi, beforeEach } from 'vitest';
import { IngestionService } from './ingestion.service';
import { ExcelParserService } from './excel-parser.service';
import { PrismaService } from '../../prisma/prisma.service';
import { AuditService } from '../audit/audit.service';
import { buildWorkbook, STANDARD_HEADERS } from '../../../test/helpers/xlsx.helper';

function makeAudit() {
  return { recordChange: vi.fn().mockResolvedValue(undefined) } as unknown as AuditService;
}

function row(overrides: Record<string, unknown> = {}): Array<string | number | Date | null> {
  const base: Record<string, string | number | Date | null> = {
    'Fecha de Compra': new Date(Date.UTC(2026, 4, 1)),
    Usuario: 'user-hash-1',
    Rif: 'J-12345678-9',
    'Razón Social': 'Mercantil C.A.',
    'Identificador de Orden': 'ORD-001',
    'Número de Cuota': 1,
    'Monto Total de la Orden': '300.00',
    'Identificador de Cuota': 'INST-001-1',
    'Monto de Cuota': '75.00',
    'Vencimiento Cuota': new Date(Date.UTC(2026, 4, 15)),
    ...(overrides as Record<string, string | number | Date | null>),
  };
  return STANDARD_HEADERS.map((h) => base[h]!);
}

function makePrismaMock(
  opts: {
    existingMerchantByRif?: Record<string, { id: string; current_name: string }>;
    existingEndUserByHash?: Record<string, { id: string }>;
    existingOrderIds?: Set<string>;
    existingInstallmentIds?: Set<string>;
  } = {},
): PrismaService {
  const merchantStore = new Map(Object.entries(opts.existingMerchantByRif ?? {}));
  const endUserStore = new Map(Object.entries(opts.existingEndUserByHash ?? {}));
  const orderIds = opts.existingOrderIds ?? new Set<string>();
  const instIds = opts.existingInstallmentIds ?? new Set<string>();

  const inserted = {
    orders: [] as unknown[],
    installments: [] as unknown[],
    importErrors: [] as unknown[],
    merchantHistoryInserts: 0,
    merchantNameUpdates: 0,
  };

  const prisma: Record<string, unknown> = {
    $transaction: vi.fn(async (cb: (tx: typeof prisma) => Promise<unknown>) => cb(prisma)),
    merchant: {
      findMany: vi.fn(async ({ where }: { where: { rif: { in: string[] } } }) => {
        return where.rif.in
          .filter((rif) => merchantStore.has(rif))
          .map((rif) => {
            const m = merchantStore.get(rif)!;
            return { id: m.id, rif, current_name: m.current_name };
          });
      }),
      createMany: vi.fn(
        async ({ data }: { data: Array<{ id: string; rif: string; current_name: string }> }) => {
          for (const m of data) {
            merchantStore.set(m.rif, { id: m.id, current_name: m.current_name });
          }
          return { count: data.length };
        },
      ),
      update: vi.fn(
        async ({ where, data }: { where: { id: string }; data: { current_name?: string } }) => {
          if (data.current_name) inserted.merchantNameUpdates++;
          return { id: where.id, ...data };
        },
      ),
    },
    merchantNameHistory: {
      createMany: vi.fn(async ({ data }: { data: unknown[] }) => {
        inserted.merchantHistoryInserts += data.length;
        return { count: data.length };
      }),
      updateMany: vi.fn(async () => ({ count: 1 })),
    },
    endUser: {
      findMany: vi.fn(async ({ where }: { where: { external_hash: { in: string[] } } }) => {
        return where.external_hash.in
          .filter((h) => endUserStore.has(h))
          .map((h) => ({ id: endUserStore.get(h)!.id, external_hash: h }));
      }),
      createMany: vi.fn(
        async ({ data }: { data: Array<{ id: string; external_hash: string }> }) => {
          for (const u of data) endUserStore.set(u.external_hash, { id: u.id });
          return { count: data.length };
        },
      ),
    },
    order: {
      findMany: vi.fn(async ({ where }: { where: { external_order_id: { in: string[] } } }) => {
        return [...where.external_order_id.in]
          .filter((id) => orderIds.has(id))
          .map((id) => ({ external_order_id: id }));
      }),
      createMany: vi.fn(async ({ data }: { data: unknown[] }) => {
        inserted.orders.push(...data);
        return { count: data.length };
      }),
    },
    installment: {
      findMany: vi.fn(
        async ({ where }: { where: { external_installment_id: { in: string[] } } }) => {
          return [...where.external_installment_id.in]
            .filter((id) => instIds.has(id))
            .map((id) => ({ external_installment_id: id }));
        },
      ),
      createMany: vi.fn(async ({ data }: { data: unknown[] }) => {
        inserted.installments.push(...data);
        return { count: data.length };
      }),
    },
    importError: {
      createMany: vi.fn(async ({ data }: { data: unknown[] }) => {
        inserted.importErrors.push(...data);
        return { count: data.length };
      }),
    },
    batch: {
      update: vi.fn(async ({ where, data }: { where: { id: string }; data: unknown }) => ({
        id: where.id,
        ...(data as object),
      })),
    },
  };

  (prisma as unknown as { _inserted: typeof inserted })._inserted = inserted;
  return prisma as unknown as PrismaService;
}

describe('IngestionService.parseAndImport', () => {
  let parser: ExcelParserService;

  beforeEach(() => {
    parser = new ExcelParserService();
  });

  it('imports a single happy-path order with 3 cuotas', async () => {
    const buffer = await buildWorkbook({
      sheets: [
        {
          name: 'S1',
          headers: [...STANDARD_HEADERS],
          rows: [
            row({
              'Identificador de Cuota': 'I-1',
              'Número de Cuota': 1,
              'Monto de Cuota': '75.00',
              'Vencimiento Cuota': new Date(Date.UTC(2026, 4, 15)),
            }),
            row({
              'Identificador de Cuota': 'I-2',
              'Número de Cuota': 2,
              'Monto de Cuota': '75.00',
              'Vencimiento Cuota': new Date(Date.UTC(2026, 4, 29)),
            }),
            row({
              'Identificador de Cuota': 'I-3',
              'Número de Cuota': 3,
              'Monto de Cuota': '150.00',
              'Vencimiento Cuota': new Date(Date.UTC(2026, 5, 12)),
            }),
          ],
        },
      ],
    });

    const prisma = makePrismaMock();
    const svc = new IngestionService(prisma, parser, makeAudit());
    const result = await svc.parseAndImport({
      batchId: 'batch-1',
      fileBuffer: buffer,
      actorId: 'user-1',
    });

    expect(result.status).toBe('imported');
    expect(result.rowsImported).toBe(1);
    expect(result.rowsRejected).toBe(0);
    expect(result.totalOrdersAmount).toBe('300.0000');
    expect(result.totalInstallmentsAmount).toBe('300.0000');
    const inserted = (
      prisma as unknown as { _inserted: { orders: unknown[]; installments: unknown[] } }
    )._inserted;
    expect(inserted.orders).toHaveLength(1);
    expect(inserted.installments).toHaveLength(3);
  });

  it('returns rejected when parser is fatal (header missing)', async () => {
    const headers = STANDARD_HEADERS.filter((h) => h !== 'Rif');
    const buffer = await buildWorkbook({ sheets: [{ name: 'S1', headers, rows: [row()] }] });
    const prisma = makePrismaMock();
    const svc = new IngestionService(prisma, parser, makeAudit());
    const result = await svc.parseAndImport({
      batchId: 'batch-1',
      fileBuffer: buffer,
      actorId: 'user-1',
    });

    expect(result.status).toBe('rejected');
    expect(result.rowsImported).toBe(0);
    expect(result.rejectionReason).toMatch(/rif/i);
  });

  it('reuses existing merchant when RIF already known and name matches', async () => {
    const buffer = await buildWorkbook({
      sheets: [{ name: 'S1', headers: [...STANDARD_HEADERS], rows: [row()] }],
    });
    const prisma = makePrismaMock({
      existingMerchantByRif: {
        'J-12345678-9': { id: 'merch-existing', current_name: 'Mercantil C.A.' },
      },
    });
    const svc = new IngestionService(prisma, parser, makeAudit());
    const result = await svc.parseAndImport({
      batchId: 'batch-1',
      fileBuffer: buffer,
      actorId: 'user-1',
    });

    expect(result.status).toBe('imported');
    const inserted = (prisma as unknown as { _inserted: { merchantHistoryInserts: number } })
      ._inserted;
    expect(inserted.merchantHistoryInserts).toBe(0);
  });

  it('writes merchant_name_history when name drifts', async () => {
    const buffer = await buildWorkbook({
      sheets: [
        {
          name: 'S1',
          headers: [...STANDARD_HEADERS],
          rows: [row({ 'Razón Social': 'Mercantil S.A. (renamed)' })],
        },
      ],
    });
    const prisma = makePrismaMock({
      existingMerchantByRif: {
        'J-12345678-9': { id: 'merch-existing', current_name: 'Mercantil C.A.' },
      },
    });
    const svc = new IngestionService(prisma, parser, makeAudit());
    const result = await svc.parseAndImport({
      batchId: 'batch-1',
      fileBuffer: buffer,
      actorId: 'user-1',
    });

    expect(result.status).toBe('imported');
    const inserted = (
      prisma as unknown as {
        _inserted: { merchantHistoryInserts: number; merchantNameUpdates: number };
      }
    )._inserted;
    expect(inserted.merchantHistoryInserts).toBe(1);
    expect(inserted.merchantNameUpdates).toBe(1);
  });

  it('creates a new end_user when external_hash is unknown', async () => {
    const buffer = await buildWorkbook({
      sheets: [
        { name: 'S1', headers: [...STANDARD_HEADERS], rows: [row({ Usuario: 'new-user-hash' })] },
      ],
    });
    const prisma = makePrismaMock();
    const svc = new IngestionService(prisma, parser, makeAudit());
    const result = await svc.parseAndImport({
      batchId: 'batch-1',
      fileBuffer: buffer,
      actorId: 'user-1',
    });

    expect(result.status).toBe('imported');
    expect(
      (prisma as unknown as { endUser: { createMany: ReturnType<typeof vi.fn> } }).endUser
        .createMany,
    ).toHaveBeenCalled();
  });

  it('rejects a group whose order_id already exists in DB', async () => {
    const buffer = await buildWorkbook({
      sheets: [{ name: 'S1', headers: [...STANDARD_HEADERS], rows: [row()] }],
    });
    const prisma = makePrismaMock({ existingOrderIds: new Set(['ORD-001']) });
    const svc = new IngestionService(prisma, parser, makeAudit());
    const result = await svc.parseAndImport({
      batchId: 'batch-1',
      fileBuffer: buffer,
      actorId: 'user-1',
    });

    expect(result.rowsImported).toBe(0);
    expect(result.rowsRejected).toBeGreaterThan(0);
    expect(result.errorsPreview.some((e) => e.errorCode === 'order_already_exists')).toBe(true);
  });

  it('emits row-level invalid_amount for a non-numeric Monto de Cuota', async () => {
    const buffer = await buildWorkbook({
      sheets: [
        { name: 'S1', headers: [...STANDARD_HEADERS], rows: [row({ 'Monto de Cuota': 'NA' })] },
      ],
    });
    const prisma = makePrismaMock();
    const svc = new IngestionService(prisma, parser, makeAudit());
    const result = await svc.parseAndImport({
      batchId: 'batch-1',
      fileBuffer: buffer,
      actorId: 'user-1',
    });

    expect(
      result.errorsPreview.some(
        (e) => e.errorCode === 'invalid_amount' && e.fieldName === 'monto de cuota',
      ),
    ).toBe(true);
    expect(result.rowsImported).toBe(0);
  });

  it('emits inconsistent_merchant when a group has mixed RIFs', async () => {
    const buffer = await buildWorkbook({
      sheets: [
        {
          name: 'S1',
          headers: [...STANDARD_HEADERS],
          rows: [
            row({ 'Identificador de Cuota': 'I-1', 'Número de Cuota': 1 }),
            row({ 'Identificador de Cuota': 'I-2', 'Número de Cuota': 2, Rif: 'J-99999999-0' }),
          ],
        },
      ],
    });
    const prisma = makePrismaMock();
    const svc = new IngestionService(prisma, parser, makeAudit());
    const result = await svc.parseAndImport({
      batchId: 'batch-1',
      fileBuffer: buffer,
      actorId: 'user-1',
    });

    expect(result.errorsPreview.some((e) => e.errorCode === 'inconsistent_merchant')).toBe(true);
    expect(result.rowsImported).toBe(0);
  });

  it('rejects group with > 3 installments', async () => {
    const buffer = await buildWorkbook({
      sheets: [
        {
          name: 'S1',
          headers: [...STANDARD_HEADERS],
          rows: [
            row({ 'Identificador de Cuota': 'I-1', 'Número de Cuota': 1 }),
            row({ 'Identificador de Cuota': 'I-2', 'Número de Cuota': 2 }),
            row({ 'Identificador de Cuota': 'I-3', 'Número de Cuota': 3 }),
            row({ 'Identificador de Cuota': 'I-4', 'Número de Cuota': 4 }),
          ],
        },
      ],
    });
    const prisma = makePrismaMock();
    const svc = new IngestionService(prisma, parser, makeAudit());
    const result = await svc.parseAndImport({
      batchId: 'batch-1',
      fileBuffer: buffer,
      actorId: 'user-1',
    });

    expect(
      result.errorsPreview.some(
        (e) =>
          e.errorCode === 'invalid_installment_count' ||
          e.errorCode === 'invalid_installment_number',
      ),
    ).toBe(true);
    expect(result.rowsImported).toBe(0);
  });

  it('bulks DB writes: 1 merchant.findMany + 1 order.createMany regardless of order count', async () => {
    const N = 50;
    const rows = Array.from({ length: N }, (_, i) =>
      row({
        'Identificador de Orden': `ORD-${i.toString().padStart(4, '0')}`,
        'Identificador de Cuota': `INST-${i.toString().padStart(4, '0')}-1`,
      }),
    );
    const buffer = await buildWorkbook({
      sheets: [{ name: 'S1', headers: [...STANDARD_HEADERS], rows }],
    });
    const prisma = makePrismaMock();
    const svc = new IngestionService(prisma, parser, makeAudit());
    const result = await svc.parseAndImport({
      batchId: 'batch-1',
      fileBuffer: buffer,
      actorId: 'user-1',
    });

    expect(result.status).toBe('imported');
    expect(result.rowsImported).toBe(N);
    type SpyRec = { [K in 'findMany' | 'createMany']: ReturnType<typeof vi.fn> };
    const p = prisma as unknown as {
      merchant: SpyRec;
      endUser: SpyRec;
      order: SpyRec;
      installment: SpyRec;
    };
    // Reads: a single findMany per master domain — not N.
    expect(p.merchant.findMany).toHaveBeenCalledTimes(1);
    expect(p.endUser.findMany).toHaveBeenCalledTimes(1);
    // Writes: a single createMany call per domain (50 rows fits in one chunk).
    expect(p.order.createMany).toHaveBeenCalledTimes(1);
    expect(p.installment.createMany).toHaveBeenCalledTimes(1);
    expect(p.merchant.createMany).toHaveBeenCalledTimes(1);
    expect(p.endUser.createMany).toHaveBeenCalledTimes(1);
  });

  it('caps errorsPreview at 50 even when there are more errors', async () => {
    const rows = Array.from({ length: 60 }, (_, i) =>
      row({
        'Monto de Cuota': 'NA',
        'Identificador de Orden': `ORD-${i}`,
        'Identificador de Cuota': `I-${i}`,
      }),
    );
    const buffer = await buildWorkbook({
      sheets: [{ name: 'S1', headers: [...STANDARD_HEADERS], rows }],
    });
    const prisma = makePrismaMock();
    const svc = new IngestionService(prisma, parser, makeAudit());
    const result = await svc.parseAndImport({
      batchId: 'batch-1',
      fileBuffer: buffer,
      actorId: 'user-1',
    });

    expect(result.errorsTotal).toBeGreaterThanOrEqual(60);
    expect(result.errorsPreview).toHaveLength(50);
  });
});

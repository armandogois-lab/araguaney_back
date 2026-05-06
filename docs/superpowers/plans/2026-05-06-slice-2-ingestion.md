# Slice 2 — Ingestión Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build the Excel ingestion pipeline for Cashea CFB: a synchronous `POST /api/batches` that uploads an `.xlsx` file to Supabase Storage, parses it with `exceljs`, validates rows + cross-row groups + DB collisions, lookup-or-creates merchants/end_users, inserts orders + installments inside a single Prisma transaction, and reports errors per row in `cfb.import_errors`.

**Architecture:** Three layers. (1) `ExcelParserService` opens the workbook, normalizes headers (lowercase + strip accents), iterates all sheets concatenated, coerces cell types (date in 3 formats; decimal with dot/comma heuristic), and returns `ParsedRow[]` plus metadata (or `kind:'fatal'` for header/corruption issues). (2) `IngestionService.parseAndImport()` orchestrates inside a `prisma.$transaction({ timeout: 60_000 })`: row-level validation → group by `external_order_id` → cross-row validation → DB collision check → lookup-or-create merchant/end_user → INSERT orders + installments → bulk INSERT errors → UPDATE batch status. (3) `BatchesController` handles multipart upload, computes sha256 content_hash for idempotency, uploads to Supabase Storage bucket `excel-uploads`, persists `excel_uploads` and `batches` rows, then invokes the ingestion service. Reads (`GET` endpoints) are paginated thin Prisma queries.

**Tech Stack:** NestJS 10, TypeScript 5 strict, Prisma 5, Vitest, `exceljs` (new dep) for XLSX parsing, `@supabase/supabase-js` (new dep) for Storage upload, `multer` (peer dep of `@nestjs/platform-express`) for multipart, Zod for query DTOs (already in stack).

---

## Spec reference

This plan implements `docs/superpowers/specs/2026-05-06-slice-2-ingestion-design.md`. Read it first if you need product context.

## File structure

```
src/modules/batches/
  batches.module.ts                 CREATE: wires controller + service + ingestion
  batches.controller.ts             CREATE: POST + 3 GETs
  batches.controller.test.ts        CREATE: 13 integration tests with supertest
  batches.service.ts                CREATE: hash, storage upload, batch row, calls ingestion
  batches.service.test.ts           CREATE: ~6 unit tests
  ingestion.service.ts              CREATE: tx orchestration, validations, lookups, inserts
  ingestion.service.test.ts         CREATE: ~10 unit tests
  excel-parser.service.ts           CREATE: exceljs wrapper, headers, decimal/date heuristics
  excel-parser.service.test.ts      CREATE: ~25 unit tests
  storage.service.ts                CREATE: Supabase Storage upload wrapper
  storage.service.test.ts           CREATE: 3 unit tests with mocked supabase
  rif-normalizer.ts                 CREATE: pure fn — any RIF format → canonical J-XXXXXXXXX-X
  rif-normalizer.test.ts            CREATE: 6 unit tests
  external-code-generator.ts        CREATE: pure fn — () => 'B-YYYYMMDD-HHmmss'
  external-code-generator.test.ts   CREATE: 2 unit tests
  types.ts                          CREATE: ParsedRow, ParsedGroup, IngestionResult, etc.
  errors/
    error-codes.ts                  CREATE: const enum of codes
    error-messages.es.ts            CREATE: code + context → Spanish message
  dto/
    batch-list-query.dto.ts         CREATE: Zod schema
    batch-errors-query.dto.ts       CREATE: Zod schema
  responses/
    batch-summary.mapper.ts         CREATE: Prisma row → API response shape
    import-error.mapper.ts          CREATE: idem for import_errors

src/app.module.ts                   MODIFY: import BatchesModule

test/helpers/
  xlsx.helper.ts                    CREATE: buildWorkbook(opts) → Buffer
  storage.helper.ts                 CREATE: in-memory Supabase Storage mock

infra/sql/README.md                 MODIFY: document excel-uploads bucket prerequisite
package.json                        MODIFY: add exceljs, @supabase/supabase-js, multer
openapi.json                        REGENERATE + COMMIT
```

---

## Task 1: Add dependencies + verify multer

**Files:**
- Modify: `package.json`

- [ ] **Step 1: Probe current state**

```bash
node -e "['exceljs','@supabase/supabase-js','multer'].forEach(p => { try { require.resolve(p); console.log(p, 'OK'); } catch { console.log(p, 'MISSING'); } })"
```

Note which are MISSING.

- [ ] **Step 2: Install missing**

```bash
pnpm add exceljs @supabase/supabase-js multer
pnpm add -D @types/multer
```

(All four are commonly missing on first install. `multer` is a peer dep of `@nestjs/platform-express` so it may already be present; the install is idempotent if so.)

- [ ] **Step 3: Verify all resolve**

```bash
node -e "['exceljs','@supabase/supabase-js','multer'].forEach(p => { console.log(p, require.resolve(p) ? 'OK' : 'MISSING'); })"
```

All three should print OK.

- [ ] **Step 4: Verify TypeScript compiles**

```bash
pnpm exec tsc --noEmit
```

Expected: zero errors.

- [ ] **Step 5: Commit**

```bash
git add package.json pnpm-lock.yaml
git commit -m "feat(batches): add exceljs, supabase-js, multer dependencies"
```

---

## Task 2: Types and error codes

**Files:**
- Create: `src/modules/batches/types.ts`
- Create: `src/modules/batches/errors/error-codes.ts`
- Create: `src/modules/batches/errors/error-messages.es.ts`

- [ ] **Step 1: Create `error-codes.ts`**

```ts
// src/modules/batches/errors/error-codes.ts
export const ErrorCodes = {
  // Row-level
  MISSING_FIELD: 'missing_field',
  INVALID_DATE: 'invalid_date',
  INVALID_AMOUNT: 'invalid_amount',
  INVALID_INSTALLMENT_NUMBER: 'invalid_installment_number',
  INVALID_RIF: 'invalid_rif',
  PURCHASE_DATE_FUTURE: 'purchase_date_future',
  DUE_BEFORE_PURCHASE: 'due_before_purchase',
  FIELD_TOO_LONG: 'field_too_long',
  // Cross-row (per group)
  INCONSISTENT_MERCHANT: 'inconsistent_merchant',
  INCONSISTENT_PURCHASE_DATE: 'inconsistent_purchase_date',
  INCONSISTENT_END_USER: 'inconsistent_end_user',
  INCONSISTENT_TOTAL: 'inconsistent_total',
  INVALID_INSTALLMENT_COUNT: 'invalid_installment_count',
  INSTALLMENT_NUMBERS_NOT_CONTIGUOUS: 'installment_numbers_not_contiguous',
  DUPLICATE_INSTALLMENT_ID_IN_ORDER: 'duplicate_installment_id_in_order',
  MERCHANT_NAME_DRIFT: 'merchant_name_drift',
  // DB collision
  ORDER_ALREADY_EXISTS: 'order_already_exists',
  INSTALLMENT_ALREADY_EXISTS: 'installment_already_exists',
} as const;

export type ErrorCode = (typeof ErrorCodes)[keyof typeof ErrorCodes];
```

- [ ] **Step 2: Create `error-messages.es.ts`**

```ts
// src/modules/batches/errors/error-messages.es.ts
import { ErrorCodes, type ErrorCode } from './error-codes';

export function errorMessageEs(code: ErrorCode, context: Record<string, string | number> = {}): string {
  switch (code) {
    case ErrorCodes.MISSING_FIELD:
      return `Campo requerido vacío: ${context.field ?? '?'}`;
    case ErrorCodes.INVALID_DATE:
      return `Fecha inválida: '${context.value ?? ''}'`;
    case ErrorCodes.INVALID_AMOUNT:
      return `Monto inválido: '${context.value ?? ''}'`;
    case ErrorCodes.INVALID_INSTALLMENT_NUMBER:
      return `Número de cuota inválido (debe ser 1, 2 o 3): '${context.value ?? ''}'`;
    case ErrorCodes.INVALID_RIF:
      return `RIF con formato inválido: '${context.value ?? ''}'`;
    case ErrorCodes.PURCHASE_DATE_FUTURE:
      return `Fecha de compra está en el futuro: ${context.value ?? ''}`;
    case ErrorCodes.DUE_BEFORE_PURCHASE:
      return `Vencimiento de cuota es anterior a la fecha de compra`;
    case ErrorCodes.FIELD_TOO_LONG:
      return `Campo '${context.field ?? '?'}' excede el largo máximo (${context.max ?? '?'})`;
    case ErrorCodes.INCONSISTENT_MERCHANT:
      return `RIF inconsistente dentro de la misma orden`;
    case ErrorCodes.INCONSISTENT_PURCHASE_DATE:
      return `Fecha de compra inconsistente dentro de la misma orden`;
    case ErrorCodes.INCONSISTENT_END_USER:
      return `Usuario inconsistente dentro de la misma orden`;
    case ErrorCodes.INCONSISTENT_TOTAL:
      return `Monto total de la orden inconsistente entre cuotas`;
    case ErrorCodes.INVALID_INSTALLMENT_COUNT:
      return `Cantidad de cuotas inválida (debe ser 1 a 3): ${context.count ?? '?'}`;
    case ErrorCodes.INSTALLMENT_NUMBERS_NOT_CONTIGUOUS:
      return `Números de cuota no son consecutivos desde 1`;
    case ErrorCodes.DUPLICATE_INSTALLMENT_ID_IN_ORDER:
      return `Identificador de cuota duplicado dentro de la misma orden`;
    case ErrorCodes.MERCHANT_NAME_DRIFT:
      return `Razón social del comercio cambió respecto al registro previo (no bloqueante)`;
    case ErrorCodes.ORDER_ALREADY_EXISTS:
      return `Orden ya existe en el sistema (subida en un batch previo)`;
    case ErrorCodes.INSTALLMENT_ALREADY_EXISTS:
      return `Cuota ya existe en el sistema (subida en un batch previo)`;
  }
}
```

- [ ] **Step 3: Create `types.ts`**

```ts
// src/modules/batches/types.ts
import type { ErrorCode } from './errors/error-codes';

export type ParsedRow = {
  sheetName: string;
  rowNumber: number; // 1-indexed within sheet (header on row 1, first data row is 2)
  fechaDeCompra: Date | null;
  usuario: string | null;
  rif: string | null;
  razonSocial: string | null;
  identificadorDeOrden: string | null;
  numeroDeCuota: number | null;
  montoTotalDeLaOrden: string | null; // Decimal-as-string for downstream Decimal coercion
  identificadorDeCuota: string | null;
  montoDeCuota: string | null;
  vencimientoCuota: Date | null;
  // Cells that failed coercion are recorded here so the validator can emit precise errors:
  coercionErrors: Array<{ field: string; rawValue: string }>;
};

export type ValidationError = {
  sheetName: string;
  rowNumber: number;
  fieldName: string | null;
  errorCode: ErrorCode;
  errorMessage: string;
  rawValue: string | null;
};

export type ParsedInstallment = {
  rowNumber: number;
  sheetName: string;
  externalInstallmentId: string;
  installmentNumber: number;
  amount: string;
  dueDate: Date;
};

export type ParsedGroup = {
  externalOrderId: string;
  rifCanonical: string;
  rifRaw: string;
  razonSocial: string;
  fechaDeCompra: Date;
  usuarioHash: string;
  montoTotalDeLaOrden: string;
  installments: ParsedInstallment[];
};

export type ParseResult =
  | { kind: 'fatal'; reason: string }
  | { kind: 'parsed'; rows: ParsedRow[]; sheets: string[]; decimalSeparator: 'dot' | 'comma' };

export type IngestionResult = {
  status: 'imported' | 'rejected';
  rowsImported: number; // count of orders inserted (groups, not individual rows)
  rowsRejected: number; // count of import_errors rows inserted
  totalOrdersAmount: string; // Decimal as string
  totalInstallmentsAmount: string;
  rejectionReason: string | null;
  decimalSeparatorDetected: 'dot' | 'comma' | null;
  errorsTotal: number;
  errorsPreview: ValidationError[]; // first 50
};
```

- [ ] **Step 4: TS check**

```bash
pnpm exec tsc --noEmit
```

Expected: zero errors.

- [ ] **Step 5: Commit**

```bash
git add src/modules/batches/types.ts src/modules/batches/errors/
git commit -m "feat(batches): types + error codes + Spanish messages"
```

---

## Task 3: RIF normalizer (TDD)

**Files:**
- Create: `src/modules/batches/rif-normalizer.ts`
- Create: `src/modules/batches/rif-normalizer.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
// src/modules/batches/rif-normalizer.test.ts
import { describe, it, expect } from 'vitest';
import { normalizeRif, isValidRif } from './rif-normalizer';

describe('normalizeRif', () => {
  it('canonicalizes already-formatted RIF', () => {
    expect(normalizeRif('J-12345678-9')).toBe('J-12345678-9');
  });

  it('uppercases prefix and pads digits', () => {
    expect(normalizeRif('j-1234567-8')).toBe('J-01234567-8');
  });

  it('inserts hyphens when missing', () => {
    expect(normalizeRif('J123456789')).toBe('J-12345678-9');
  });

  it('strips internal whitespace', () => {
    expect(normalizeRif(' J - 12345678 - 9 ')).toBe('J-12345678-9');
  });

  it('accepts V/E/J/G/P prefixes', () => {
    expect(normalizeRif('V123456789')).toBe('V-12345678-9');
    expect(normalizeRif('E123456789')).toBe('E-12345678-9');
    expect(normalizeRif('G123456789')).toBe('G-12345678-9');
    expect(normalizeRif('P123456789')).toBe('P-12345678-9');
  });

  it('returns null for invalid format', () => {
    expect(normalizeRif('foo')).toBeNull();
    expect(normalizeRif('J-12-34')).toBeNull();
    expect(normalizeRif('')).toBeNull();
  });
});

describe('isValidRif', () => {
  it('returns true for normalizable RIF', () => {
    expect(isValidRif('J123456789')).toBe(true);
  });
  it('returns false for garbage', () => {
    expect(isValidRif('xxx')).toBe(false);
  });
});
```

- [ ] **Step 2: Run, expect fail**

```bash
pnpm vitest run src/modules/batches/rif-normalizer.test.ts
```

Expected: FAIL — module not found.

- [ ] **Step 3: Implement**

```ts
// src/modules/batches/rif-normalizer.ts

const PREFIXES = new Set(['V', 'E', 'J', 'G', 'P']);

/**
 * Normalize a Venezuelan RIF/cédula to canonical form `X-NNNNNNNN-N`
 * (8 digits + 1 check digit). Accepts inputs with or without hyphens,
 * mixed case, surrounding whitespace.
 *
 * Returns null if the input cannot be normalized.
 */
export function normalizeRif(input: string): string | null {
  if (typeof input !== 'string') return null;
  const compact = input.replace(/\s+/g, '').toUpperCase();
  if (!compact) return null;

  const m = compact.match(/^([VEJGP])-?(\d{1,9})-?(\d)$/);
  if (!m) return null;

  const [, prefix, digits, check] = m;
  if (!PREFIXES.has(prefix!)) return null;
  const padded = digits!.padStart(8, '0');
  if (padded.length > 8) return null; // more than 9 digits before check
  return `${prefix}-${padded}-${check}`;
}

export function isValidRif(input: string): boolean {
  return normalizeRif(input) !== null;
}
```

- [ ] **Step 4: Run, expect pass**

```bash
pnpm vitest run src/modules/batches/rif-normalizer.test.ts
```

Expected: 8 passed (counting all the assertions in 7 `it` blocks).

- [ ] **Step 5: Commit**

```bash
git add src/modules/batches/rif-normalizer.ts src/modules/batches/rif-normalizer.test.ts
git commit -m "feat(batches): RIF normalizer (TDD)"
```

---

## Task 4: External code generator (TDD)

**Files:**
- Create: `src/modules/batches/external-code-generator.ts`
- Create: `src/modules/batches/external-code-generator.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
// src/modules/batches/external-code-generator.test.ts
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { generateExternalCode } from './external-code-generator';

describe('generateExternalCode', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date(Date.UTC(2026, 4, 6, 10, 32, 45))); // 2026-05-06T10:32:45Z
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it('formats with B-YYYYMMDD-HHmmss using UTC', () => {
    expect(generateExternalCode()).toBe('B-20260506-103245');
  });

  it('produces 17 chars and stays within varchar(20)', () => {
    const code = generateExternalCode();
    expect(code).toHaveLength(17);
    expect(code.length).toBeLessThanOrEqual(20);
  });
});
```

- [ ] **Step 2: Run, expect fail**

```bash
pnpm vitest run src/modules/batches/external-code-generator.test.ts
```

Expected: FAIL — module not found.

- [ ] **Step 3: Implement**

```ts
// src/modules/batches/external-code-generator.ts

/** Generates `B-YYYYMMDD-HHmmss` in UTC. 17 chars. Fits varchar(20). */
export function generateExternalCode(now: Date = new Date()): string {
  const yyyy = now.getUTCFullYear().toString().padStart(4, '0');
  const mm = (now.getUTCMonth() + 1).toString().padStart(2, '0');
  const dd = now.getUTCDate().toString().padStart(2, '0');
  const hh = now.getUTCHours().toString().padStart(2, '0');
  const mi = now.getUTCMinutes().toString().padStart(2, '0');
  const ss = now.getUTCSeconds().toString().padStart(2, '0');
  return `B-${yyyy}${mm}${dd}-${hh}${mi}${ss}`;
}
```

- [ ] **Step 4: Run, expect pass**

```bash
pnpm vitest run src/modules/batches/external-code-generator.test.ts
```

Expected: 2 passed.

- [ ] **Step 5: Commit**

```bash
git add src/modules/batches/external-code-generator.ts src/modules/batches/external-code-generator.test.ts
git commit -m "feat(batches): external_code generator (TDD)"
```

---

## Task 5: XLSX test helper

**Files:**
- Create: `test/helpers/xlsx.helper.ts`

- [ ] **Step 1: Implement helper**

```ts
// test/helpers/xlsx.helper.ts
import ExcelJS from 'exceljs';

export type SheetSpec = {
  name: string;
  headers: string[];
  rows: Array<Array<string | number | Date | null>>;
};

/**
 * Builds an XLSX workbook in-memory and returns a Buffer suitable for parser tests.
 * Each sheet's first row is the headers; subsequent rows are data.
 */
export async function buildWorkbook(opts: { sheets: SheetSpec[] }): Promise<Buffer> {
  const wb = new ExcelJS.Workbook();
  for (const s of opts.sheets) {
    const ws = wb.addWorksheet(s.name);
    ws.addRow(s.headers);
    for (const row of s.rows) {
      ws.addRow(row);
    }
  }
  const ab = await wb.xlsx.writeBuffer();
  return Buffer.from(ab);
}

/** Standard 10-column header in the order the spec defines. */
export const STANDARD_HEADERS = [
  'Fecha de Compra',
  'Usuario',
  'Rif',
  'Razón Social',
  'Identificador de Orden',
  'Número de Cuota',
  'Monto Total de la Orden',
  'Identificador de Cuota',
  'Monto de Cuota',
  'Vencimiento Cuota',
] as const;
```

- [ ] **Step 2: Sanity check**

```bash
pnpm exec tsc --noEmit
```

Expected: zero errors.

- [ ] **Step 3: Commit**

```bash
git add test/helpers/xlsx.helper.ts
git commit -m "test(batches): xlsx helper to build in-memory workbooks"
```

---

## Task 6: Excel parser service (TDD)

**Files:**
- Create: `src/modules/batches/excel-parser.service.ts`
- Create: `src/modules/batches/excel-parser.service.test.ts`

This is the heaviest unit task. ~25 tests covering header normalization, multi-sheet, decimal heuristic, date parsing, and per-cell coercion.

- [ ] **Step 1: Write the failing test**

```ts
// src/modules/batches/excel-parser.service.test.ts
import { describe, it, expect } from 'vitest';
import { ExcelParserService } from './excel-parser.service';
import { buildWorkbook, STANDARD_HEADERS } from '../../../test/helpers/xlsx.helper';

const svc = new ExcelParserService();

function validRow(overrides: Record<number, unknown> = {}): Array<unknown> {
  // Returns a row matching STANDARD_HEADERS order.
  const base = [
    new Date('2026-05-01'),     // Fecha de Compra
    'user-hash-1',              // Usuario
    'J-12345678-9',             // Rif
    'Mercantil C.A.',           // Razón Social
    'ORD-001',                  // Identificador de Orden
    1,                          // Número de Cuota
    '300.00',                   // Monto Total de la Orden
    'INST-001-1',               // Identificador de Cuota
    '75.00',                    // Monto de Cuota
    new Date('2026-05-15'),     // Vencimiento Cuota
  ];
  for (const [i, v] of Object.entries(overrides)) {
    base[Number(i)] = v as never;
  }
  return base;
}

describe('ExcelParserService.parse', () => {
  describe('fatal cases', () => {
    it('rejects when buffer is not a valid xlsx', async () => {
      const r = await svc.parse(Buffer.from('not an xlsx'));
      expect(r.kind).toBe('fatal');
      if (r.kind === 'fatal') {
        expect(r.reason).toMatch(/corrupt|invalid|cannot read|no es un xlsx/i);
      }
    });

    it('rejects when no sheets', async () => {
      const buf = await buildWorkbook({ sheets: [] });
      const r = await svc.parse(buf);
      expect(r.kind).toBe('fatal');
    });

    it('rejects when a sheet is missing a required header', async () => {
      const headers = STANDARD_HEADERS.filter((h) => h !== 'Rif');
      const buf = await buildWorkbook({ sheets: [{ name: 'S1', headers, rows: [] }] });
      const r = await svc.parse(buf);
      expect(r.kind).toBe('fatal');
      if (r.kind === 'fatal') {
        expect(r.reason).toMatch(/rif/i);
      }
    });

    it('rejects when there are 0 data rows total across all sheets', async () => {
      const buf = await buildWorkbook({
        sheets: [{ name: 'S1', headers: [...STANDARD_HEADERS], rows: [] }],
      });
      const r = await svc.parse(buf);
      expect(r.kind).toBe('fatal');
    });
  });

  describe('header normalization', () => {
    it('matches headers with different case/accents/spacing', async () => {
      const headers = [
        'FECHA DE COMPRA',
        'usuario',
        'rif',
        'razon  social',           // double space, no accent
        'Identificador de Orden',
        'numero de cuota',         // no accent
        'Monto Total de la Orden',
        'Identificador de Cuota',
        'Monto de Cuota',
        'Vencimiento Cuota',
      ];
      const buf = await buildWorkbook({ sheets: [{ name: 'S1', headers, rows: [validRow()] }] });
      const r = await svc.parse(buf);
      expect(r.kind).toBe('parsed');
      if (r.kind === 'parsed') {
        expect(r.rows).toHaveLength(1);
        expect(r.rows[0]!.rif).toBe('J-12345678-9');
      }
    });
  });

  describe('multi-sheet concat', () => {
    it('concatenates rows from all sheets in order', async () => {
      const buf = await buildWorkbook({
        sheets: [
          {
            name: 'S1',
            headers: [...STANDARD_HEADERS],
            rows: [validRow({ 4: 'ORD-A' }), validRow({ 4: 'ORD-B' })],
          },
          {
            name: 'S2',
            headers: [...STANDARD_HEADERS],
            rows: [validRow({ 4: 'ORD-C' })],
          },
        ],
      });
      const r = await svc.parse(buf);
      expect(r.kind).toBe('parsed');
      if (r.kind === 'parsed') {
        expect(r.rows.map((x) => x.identificadorDeOrden)).toEqual(['ORD-A', 'ORD-B', 'ORD-C']);
        expect(r.rows.map((x) => x.sheetName)).toEqual(['S1', 'S1', 'S2']);
        expect(r.sheets).toEqual(['S1', 'S2']);
      }
    });
  });

  describe('decimal separator heuristic', () => {
    it('detects dot when amounts use dot decimal', async () => {
      const buf = await buildWorkbook({
        sheets: [{ name: 'S1', headers: [...STANDARD_HEADERS], rows: [validRow({ 6: '1234.56', 8: '300.00' })] }],
      });
      const r = await svc.parse(buf);
      if (r.kind === 'parsed') {
        expect(r.decimalSeparator).toBe('dot');
        expect(r.rows[0]!.montoTotalDeLaOrden).toBe('1234.56');
      }
    });

    it('detects comma when amounts use comma decimal', async () => {
      const buf = await buildWorkbook({
        sheets: [
          {
            name: 'S1',
            headers: [...STANDARD_HEADERS],
            rows: [
              validRow({ 6: '1234,56', 8: '300,00' }),
              validRow({ 6: '999,99', 8: '100,50' }),
            ],
          },
        ],
      });
      const r = await svc.parse(buf);
      if (r.kind === 'parsed') {
        expect(r.decimalSeparator).toBe('comma');
        expect(r.rows[0]!.montoTotalDeLaOrden).toBe('1234.56');
      }
    });
  });

  describe('date parsing', () => {
    it('parses Excel-native Date cells', async () => {
      const buf = await buildWorkbook({
        sheets: [{ name: 'S1', headers: [...STANDARD_HEADERS], rows: [validRow({ 0: new Date('2026-05-01') })] }],
      });
      const r = await svc.parse(buf);
      if (r.kind === 'parsed') {
        expect(r.rows[0]!.fechaDeCompra?.toISOString().slice(0, 10)).toBe('2026-05-01');
      }
    });

    it('parses ISO YYYY-MM-DD strings', async () => {
      const buf = await buildWorkbook({
        sheets: [{ name: 'S1', headers: [...STANDARD_HEADERS], rows: [validRow({ 0: '2026-05-01' })] }],
      });
      const r = await svc.parse(buf);
      if (r.kind === 'parsed') {
        expect(r.rows[0]!.fechaDeCompra?.toISOString().slice(0, 10)).toBe('2026-05-01');
      }
    });

    it('parses DD/MM/YYYY strings', async () => {
      const buf = await buildWorkbook({
        sheets: [{ name: 'S1', headers: [...STANDARD_HEADERS], rows: [validRow({ 0: '01/05/2026' })] }],
      });
      const r = await svc.parse(buf);
      if (r.kind === 'parsed') {
        expect(r.rows[0]!.fechaDeCompra?.toISOString().slice(0, 10)).toBe('2026-05-01');
      }
    });

    it('flags coercionError for unparseable date', async () => {
      const buf = await buildWorkbook({
        sheets: [{ name: 'S1', headers: [...STANDARD_HEADERS], rows: [validRow({ 0: 'not a date' })] }],
      });
      const r = await svc.parse(buf);
      if (r.kind === 'parsed') {
        expect(r.rows[0]!.fechaDeCompra).toBeNull();
        expect(r.rows[0]!.coercionErrors).toContainEqual({
          field: 'fecha de compra',
          rawValue: 'not a date',
        });
      }
    });
  });

  describe('numero de cuota coercion', () => {
    it('coerces integer string', async () => {
      const buf = await buildWorkbook({
        sheets: [{ name: 'S1', headers: [...STANDARD_HEADERS], rows: [validRow({ 5: '2' })] }],
      });
      const r = await svc.parse(buf);
      if (r.kind === 'parsed') {
        expect(r.rows[0]!.numeroDeCuota).toBe(2);
      }
    });

    it('flags coercionError when not an integer', async () => {
      const buf = await buildWorkbook({
        sheets: [{ name: 'S1', headers: [...STANDARD_HEADERS], rows: [validRow({ 5: 'three' })] }],
      });
      const r = await svc.parse(buf);
      if (r.kind === 'parsed') {
        expect(r.rows[0]!.numeroDeCuota).toBeNull();
        expect(r.rows[0]!.coercionErrors.some((c) => c.field === 'numero de cuota')).toBe(true);
      }
    });
  });

  describe('amount coercion', () => {
    it('flags coercionError on non-numeric amount', async () => {
      const buf = await buildWorkbook({
        sheets: [{ name: 'S1', headers: [...STANDARD_HEADERS], rows: [validRow({ 8: 'NA' })] }],
      });
      const r = await svc.parse(buf);
      if (r.kind === 'parsed') {
        expect(r.rows[0]!.montoDeCuota).toBeNull();
        expect(r.rows[0]!.coercionErrors.some((c) => c.field === 'monto de cuota')).toBe(true);
      }
    });

    it('preserves trailing zeros from string amounts', async () => {
      const buf = await buildWorkbook({
        sheets: [{ name: 'S1', headers: [...STANDARD_HEADERS], rows: [validRow({ 8: '75.50' })] }],
      });
      const r = await svc.parse(buf);
      if (r.kind === 'parsed') {
        expect(r.rows[0]!.montoDeCuota).toBe('75.50');
      }
    });
  });

  describe('row numbering', () => {
    it('sets rowNumber starting at 2 (header is row 1)', async () => {
      const buf = await buildWorkbook({
        sheets: [{ name: 'S1', headers: [...STANDARD_HEADERS], rows: [validRow(), validRow(), validRow()] }],
      });
      const r = await svc.parse(buf);
      if (r.kind === 'parsed') {
        expect(r.rows.map((x) => x.rowNumber)).toEqual([2, 3, 4]);
      }
    });

    it('preserves rowNumber per-sheet (does not continue across sheets)', async () => {
      const buf = await buildWorkbook({
        sheets: [
          { name: 'S1', headers: [...STANDARD_HEADERS], rows: [validRow()] },
          { name: 'S2', headers: [...STANDARD_HEADERS], rows: [validRow(), validRow()] },
        ],
      });
      const r = await svc.parse(buf);
      if (r.kind === 'parsed') {
        expect(r.rows.map((x) => `${x.sheetName}:${x.rowNumber}`)).toEqual(['S1:2', 'S2:2', 'S2:3']);
      }
    });
  });
});
```

- [ ] **Step 2: Run, expect fail**

```bash
pnpm vitest run src/modules/batches/excel-parser.service.test.ts
```

Expected: FAIL — module not found.

- [ ] **Step 3: Implement parser**

```ts
// src/modules/batches/excel-parser.service.ts
import { Injectable } from '@nestjs/common';
import ExcelJS from 'exceljs';
import type { ParsedRow, ParseResult } from './types';

const REQUIRED_HEADERS_NORMALIZED = [
  'fecha de compra',
  'usuario',
  'rif',
  'razon social',
  'identificador de orden',
  'numero de cuota',
  'monto total de la orden',
  'identificador de cuota',
  'monto de cuota',
  'vencimiento cuota',
] as const;

type FieldName = (typeof REQUIRED_HEADERS_NORMALIZED)[number];

function normalizeHeader(s: string): string {
  return s
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .trim()
    .replace(/\s+/g, ' ');
}

function parseDateCell(value: unknown): Date | null {
  if (value instanceof Date && !isNaN(value.getTime())) return value;
  if (typeof value === 'number') {
    // Excel serial — exceljs usually delivers Date already, but defensive fallback
    const epoch = Date.UTC(1899, 11, 30);
    const ms = epoch + value * 86400 * 1000;
    return new Date(ms);
  }
  if (typeof value === 'string') {
    const trimmed = value.trim();
    if (!trimmed) return null;
    // ISO
    const iso = /^(\d{4})-(\d{2})-(\d{2})$/.exec(trimmed);
    if (iso) {
      const d = new Date(Date.UTC(+iso[1]!, +iso[2]! - 1, +iso[3]!));
      return isNaN(d.getTime()) ? null : d;
    }
    // DD/MM/YYYY
    const dmy = /^(\d{1,2})\/(\d{1,2})\/(\d{4})$/.exec(trimmed);
    if (dmy) {
      const d = new Date(Date.UTC(+dmy[3]!, +dmy[2]! - 1, +dmy[1]!));
      return isNaN(d.getTime()) ? null : d;
    }
  }
  return null;
}

function parseIntCell(value: unknown): number | null {
  if (typeof value === 'number' && Number.isInteger(value)) return value;
  if (typeof value === 'string') {
    const t = value.trim();
    if (/^\d+$/.test(t)) return parseInt(t, 10);
  }
  return null;
}

function rawToString(value: unknown): string | null {
  if (value === null || value === undefined) return null;
  if (value instanceof Date) return value.toISOString();
  return String(value);
}

function detectSeparator(samples: string[]): 'dot' | 'comma' {
  let dotVotes = 0;
  let commaVotes = 0;
  for (const s of samples) {
    const trimmed = s.trim();
    const hasDot = trimmed.includes('.');
    const hasComma = trimmed.includes(',');
    if (hasComma && !hasDot) commaVotes++;
    else if (hasDot && !hasComma) dotVotes++;
    else if (hasComma && hasDot) {
      // Both present — the one further right is the decimal sep
      if (trimmed.lastIndexOf(',') > trimmed.lastIndexOf('.')) commaVotes++;
      else dotVotes++;
    }
  }
  return commaVotes > dotVotes ? 'comma' : 'dot';
}

function coerceAmount(value: unknown, separator: 'dot' | 'comma'): string | null {
  if (value === null || value === undefined || value === '') return null;
  let s: string;
  if (typeof value === 'number') s = value.toString();
  else if (typeof value === 'string') s = value.trim();
  else return null;
  if (!s) return null;
  // Remove thousands separator (the OPPOSITE of decimal sep) and convert decimal sep to dot
  if (separator === 'comma') {
    s = s.replace(/\./g, '').replace(',', '.');
  } else {
    s = s.replace(/,/g, '');
  }
  if (!/^-?\d+(\.\d+)?$/.test(s)) return null;
  return s;
}

@Injectable()
export class ExcelParserService {
  async parse(buffer: Buffer): Promise<ParseResult> {
    const wb = new ExcelJS.Workbook();
    try {
      // exceljs accepts ArrayBuffer
      const ab = buffer.buffer.slice(buffer.byteOffset, buffer.byteOffset + buffer.byteLength);
      await wb.xlsx.load(ab as ArrayBuffer);
    } catch (e) {
      return { kind: 'fatal', reason: `Archivo no es un xlsx válido: ${(e as Error).message}` };
    }

    const worksheets = wb.worksheets;
    if (worksheets.length === 0) {
      return { kind: 'fatal', reason: 'Archivo no contiene hojas' };
    }

    // Pass 1: collect raw rows + verify headers per sheet, reject if any header missing
    type RawSheet = { name: string; columnIndex: Record<FieldName, number>; rows: unknown[][] };
    const sheets: RawSheet[] = [];
    for (const ws of worksheets) {
      // Find header row = first non-empty row
      let headerRowNum = 0;
      for (let i = 1; i <= ws.rowCount; i++) {
        const row = ws.getRow(i);
        if (row.values && (row.values as unknown[]).some((v) => v !== null && v !== undefined && v !== '')) {
          headerRowNum = i;
          break;
        }
      }
      if (headerRowNum === 0) continue; // empty sheet — skip silently

      const headerVals = (ws.getRow(headerRowNum).values as unknown[]).slice(1); // exceljs row.values is 1-indexed
      const headerNormalized = headerVals.map((v) => normalizeHeader(String(v ?? '')));
      const columnIndex: Partial<Record<FieldName, number>> = {};
      for (const required of REQUIRED_HEADERS_NORMALIZED) {
        const idx = headerNormalized.indexOf(required);
        if (idx === -1) {
          return {
            kind: 'fatal',
            reason: `Hoja "${ws.name}": falta columna requerida "${required}"`,
          };
        }
        columnIndex[required] = idx;
      }

      const rawRows: unknown[][] = [];
      for (let i = headerRowNum + 1; i <= ws.rowCount; i++) {
        const row = ws.getRow(i);
        const vals = (row.values as unknown[]).slice(1);
        const isEmpty = vals.every((v) => v === null || v === undefined || v === '');
        if (isEmpty) continue;
        rawRows.push(vals);
      }

      sheets.push({ name: ws.name, columnIndex: columnIndex as Record<FieldName, number>, rows: rawRows });
    }

    const totalRows = sheets.reduce((sum, s) => sum + s.rows.length, 0);
    if (totalRows === 0) {
      return { kind: 'fatal', reason: 'Archivo no contiene filas de datos' };
    }

    // Detect decimal separator from amount columns
    const amountSamples: string[] = [];
    for (const s of sheets) {
      for (const row of s.rows) {
        const total = row[s.columnIndex['monto total de la orden']];
        const cuota = row[s.columnIndex['monto de cuota']];
        if (typeof total === 'string' && total.trim()) amountSamples.push(total);
        if (typeof cuota === 'string' && cuota.trim()) amountSamples.push(cuota);
        if (amountSamples.length >= 20) break;
      }
      if (amountSamples.length >= 20) break;
    }
    const decimalSeparator = detectSeparator(amountSamples);

    // Pass 2: build ParsedRow per row
    const parsedRows: ParsedRow[] = [];
    for (const s of sheets) {
      let rowNumber = 1; // header was row 1, data rows start at 2
      for (const row of s.rows) {
        rowNumber++;
        const coercionErrors: Array<{ field: string; rawValue: string }> = [];

        const fechaDeCompraRaw = row[s.columnIndex['fecha de compra']];
        const fechaDeCompra = parseDateCell(fechaDeCompraRaw);
        if (!fechaDeCompra && fechaDeCompraRaw != null && fechaDeCompraRaw !== '') {
          coercionErrors.push({ field: 'fecha de compra', rawValue: rawToString(fechaDeCompraRaw) ?? '' });
        }

        const usuario = (() => {
          const v = row[s.columnIndex['usuario']];
          if (v === null || v === undefined) return null;
          const t = String(v).trim();
          return t === '' ? null : t;
        })();

        const rif = (() => {
          const v = row[s.columnIndex['rif']];
          if (v === null || v === undefined) return null;
          const t = String(v).trim();
          return t === '' ? null : t;
        })();

        const razonSocial = (() => {
          const v = row[s.columnIndex['razon social']];
          if (v === null || v === undefined) return null;
          const t = String(v).trim();
          return t === '' ? null : t;
        })();

        const identificadorDeOrden = (() => {
          const v = row[s.columnIndex['identificador de orden']];
          if (v === null || v === undefined) return null;
          const t = String(v).trim();
          return t === '' ? null : t;
        })();

        const numeroDeCuotaRaw = row[s.columnIndex['numero de cuota']];
        const numeroDeCuota = parseIntCell(numeroDeCuotaRaw);
        if (numeroDeCuota === null && numeroDeCuotaRaw != null && numeroDeCuotaRaw !== '') {
          coercionErrors.push({ field: 'numero de cuota', rawValue: rawToString(numeroDeCuotaRaw) ?? '' });
        }

        const montoTotalRaw = row[s.columnIndex['monto total de la orden']];
        const montoTotalDeLaOrden = coerceAmount(montoTotalRaw, decimalSeparator);
        if (!montoTotalDeLaOrden && montoTotalRaw != null && montoTotalRaw !== '') {
          coercionErrors.push({ field: 'monto total de la orden', rawValue: rawToString(montoTotalRaw) ?? '' });
        }

        const identificadorDeCuota = (() => {
          const v = row[s.columnIndex['identificador de cuota']];
          if (v === null || v === undefined) return null;
          const t = String(v).trim();
          return t === '' ? null : t;
        })();

        const montoCuotaRaw = row[s.columnIndex['monto de cuota']];
        const montoDeCuota = coerceAmount(montoCuotaRaw, decimalSeparator);
        if (!montoDeCuota && montoCuotaRaw != null && montoCuotaRaw !== '') {
          coercionErrors.push({ field: 'monto de cuota', rawValue: rawToString(montoCuotaRaw) ?? '' });
        }

        const vencRaw = row[s.columnIndex['vencimiento cuota']];
        const vencimientoCuota = parseDateCell(vencRaw);
        if (!vencimientoCuota && vencRaw != null && vencRaw !== '') {
          coercionErrors.push({ field: 'vencimiento cuota', rawValue: rawToString(vencRaw) ?? '' });
        }

        parsedRows.push({
          sheetName: s.name,
          rowNumber,
          fechaDeCompra,
          usuario,
          rif,
          razonSocial,
          identificadorDeOrden,
          numeroDeCuota,
          montoTotalDeLaOrden,
          identificadorDeCuota,
          montoDeCuota,
          vencimientoCuota,
          coercionErrors,
        });
      }
    }

    return {
      kind: 'parsed',
      rows: parsedRows,
      sheets: sheets.map((s) => s.name),
      decimalSeparator,
    };
  }
}
```

- [ ] **Step 4: Run, expect pass**

```bash
pnpm vitest run src/modules/batches/excel-parser.service.test.ts
```

Expected: ~17-20 tests pass (the test file has 17 `it` blocks; some have multiple assertions but each `it` is one passed/failed test).

If any fail, iterate on the parser implementation. Common issues: exceljs returning shifted indexes (it uses 1-based row.values), Date timezone confusion (use UTC consistently), trim/null handling. Read failure messages and fix.

- [ ] **Step 5: TS check**

```bash
pnpm exec tsc --noEmit
```

Expected: zero errors.

- [ ] **Step 6: Commit**

```bash
git add src/modules/batches/excel-parser.service.ts src/modules/batches/excel-parser.service.test.ts
git commit -m "feat(batches): ExcelParserService with header normalization, decimal heuristic, date parsing (TDD)"
```

---

## Task 7: Storage service (TDD with mocked supabase)

**Files:**
- Create: `src/modules/batches/storage.service.ts`
- Create: `src/modules/batches/storage.service.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
// src/modules/batches/storage.service.test.ts
import { describe, it, expect, vi } from 'vitest';
import { ConfigService } from '@nestjs/config';
import { StorageService } from './storage.service';
import type { EnvConfig } from '../../config/env.config';

function makeConfig(): ConfigService<EnvConfig, true> {
  return {
    get: (key: string) => {
      switch (key) {
        case 'SUPABASE_URL':
          return 'https://test.supabase.co';
        case 'SUPABASE_SERVICE_ROLE_KEY':
          return 'test-service-key';
        default:
          return undefined;
      }
    },
  } as unknown as ConfigService<EnvConfig, true>;
}

describe('StorageService.uploadExcel', () => {
  it('uploads a buffer to excel-uploads bucket and returns the path', async () => {
    const upload = vi.fn().mockResolvedValue({ data: { path: 'xyz.xlsx' }, error: null });
    const svc = new StorageService(makeConfig());
    // Inject mock storage client
    (svc as unknown as { storageFrom: (b: string) => { upload: typeof upload } }).storageFrom = () => ({ upload });

    const path = await svc.uploadExcel(Buffer.from('contents'), 'abc.xlsx');
    expect(path).toBe('abc.xlsx');
    expect(upload).toHaveBeenCalledWith('abc.xlsx', expect.any(Buffer), {
      contentType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      upsert: false,
    });
  });

  it('throws when upload returns error', async () => {
    const upload = vi.fn().mockResolvedValue({ data: null, error: { message: 'Bucket missing' } });
    const svc = new StorageService(makeConfig());
    (svc as unknown as { storageFrom: (b: string) => { upload: typeof upload } }).storageFrom = () => ({ upload });

    await expect(svc.uploadExcel(Buffer.from('x'), 'a.xlsx')).rejects.toThrow(/storage upload failed.*Bucket missing/i);
  });

  it('uses configured bucket name', async () => {
    const upload = vi.fn().mockResolvedValue({ data: { path: 'p.xlsx' }, error: null });
    const fromCalls: string[] = [];
    const svc = new StorageService(makeConfig());
    (svc as unknown as { storageFrom: (b: string) => { upload: typeof upload } }).storageFrom = (b: string) => {
      fromCalls.push(b);
      return { upload };
    };
    await svc.uploadExcel(Buffer.from('x'), 'p.xlsx');
    expect(fromCalls).toEqual(['excel-uploads']);
  });
});
```

- [ ] **Step 2: Run, expect fail**

```bash
pnpm vitest run src/modules/batches/storage.service.test.ts
```

Expected: FAIL — module not found.

- [ ] **Step 3: Implement**

```ts
// src/modules/batches/storage.service.ts
import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import type { EnvConfig } from '../../config/env.config';

const BUCKET = 'excel-uploads';
const XLSX_MIME = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';

@Injectable()
export class StorageService {
  private readonly client: SupabaseClient;

  constructor(config: ConfigService<EnvConfig, true>) {
    const url = config.get('SUPABASE_URL', { infer: true });
    const key = config.get('SUPABASE_SERVICE_ROLE_KEY', { infer: true });
    this.client = createClient(url, key, { auth: { persistSession: false } });
  }

  /** Indirection so tests can replace the storage client without faking createClient. */
  protected storageFrom(bucket: string) {
    return this.client.storage.from(bucket);
  }

  /**
   * Uploads an xlsx buffer at the given path inside the `excel-uploads` bucket.
   * Returns the stored path on success; throws on failure.
   */
  async uploadExcel(buffer: Buffer, path: string): Promise<string> {
    const { data, error } = await this.storageFrom(BUCKET).upload(path, buffer, {
      contentType: XLSX_MIME,
      upsert: false,
    });
    if (error || !data) {
      throw new Error(`storage upload failed: ${error?.message ?? 'unknown'}`);
    }
    return data.path;
  }
}
```

- [ ] **Step 4: Run, expect pass**

```bash
pnpm vitest run src/modules/batches/storage.service.test.ts
```

Expected: 3 passed.

- [ ] **Step 5: Commit**

```bash
git add src/modules/batches/storage.service.ts src/modules/batches/storage.service.test.ts
git commit -m "feat(batches): StorageService for Supabase Storage upload (TDD)"
```

---

## Task 8: Ingestion service (TDD)

**Files:**
- Create: `src/modules/batches/ingestion.service.ts`
- Create: `src/modules/batches/ingestion.service.test.ts`

This is the orchestration heavyweight. Mocks Prisma `$transaction` so the callback runs immediately with the same prisma instance.

- [ ] **Step 1: Write the failing test**

```ts
// src/modules/batches/ingestion.service.test.ts
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { IngestionService } from './ingestion.service';
import { ExcelParserService } from './excel-parser.service';
import { PrismaService } from '../../prisma/prisma.service';
import { buildWorkbook, STANDARD_HEADERS } from '../../../test/helpers/xlsx.helper';

function row(overrides: Record<string, unknown> = {}): Array<unknown> {
  const base: Record<string, unknown> = {
    'Fecha de Compra': new Date(Date.UTC(2026, 4, 1)),
    'Usuario': 'user-hash-1',
    'Rif': 'J-12345678-9',
    'Razón Social': 'Mercantil C.A.',
    'Identificador de Orden': 'ORD-001',
    'Número de Cuota': 1,
    'Monto Total de la Orden': '300.00',
    'Identificador de Cuota': 'INST-001-1',
    'Monto de Cuota': '75.00',
    'Vencimiento Cuota': new Date(Date.UTC(2026, 4, 15)),
    ...overrides,
  };
  return STANDARD_HEADERS.map((h) => base[h] as never);
}

function makePrismaMock(opts: {
  existingMerchantByRif?: Record<string, { id: string; current_name: string }>;
  existingEndUserByHash?: Record<string, { id: string }>;
  existingOrderIds?: Set<string>;
  existingInstallmentIds?: Set<string>;
} = {}): PrismaService {
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
      findUnique: vi.fn(async ({ where }: { where: { rif: string } }) =>
        merchantStore.get(where.rif) ?? null),
      create: vi.fn(async ({ data }: { data: { rif: string; current_name: string } }) => {
        const id = `merchant-${merchantStore.size + 1}`;
        merchantStore.set(data.rif, { id, current_name: data.current_name });
        return { id, ...data };
      }),
      update: vi.fn(async ({ where, data }: { where: { id: string }; data: { current_name?: string } }) => {
        if (data.current_name) inserted.merchantNameUpdates++;
        return { id: where.id, ...data };
      }),
    },
    merchantNameHistory: {
      create: vi.fn(async () => {
        inserted.merchantHistoryInserts++;
        return {};
      }),
      updateMany: vi.fn(async () => ({ count: 1 })),
    },
    endUser: {
      findUnique: vi.fn(async ({ where }: { where: { external_hash: string } }) =>
        endUserStore.get(where.external_hash) ?? null),
      create: vi.fn(async ({ data }: { data: { external_hash: string } }) => {
        const id = `enduser-${endUserStore.size + 1}`;
        endUserStore.set(data.external_hash, { id });
        return { id, ...data };
      }),
    },
    order: {
      findMany: vi.fn(async ({ where }: { where: { external_order_id: { in: string[] } } }) => {
        return [...where.external_order_id.in]
          .filter((id) => orderIds.has(id))
          .map((id) => ({ external_order_id: id }));
      }),
      create: vi.fn(async ({ data }: { data: unknown }) => {
        inserted.orders.push(data);
        return { id: `order-${inserted.orders.length}`, ...(data as object) };
      }),
    },
    installment: {
      findMany: vi.fn(async ({ where }: { where: { external_installment_id: { in: string[] } } }) => {
        return [...where.external_installment_id.in]
          .filter((id) => instIds.has(id))
          .map((id) => ({ external_installment_id: id }));
      }),
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
            row({ 'Identificador de Cuota': 'I-1', 'Número de Cuota': 1, 'Monto de Cuota': '75.00', 'Vencimiento Cuota': new Date(Date.UTC(2026, 4, 15)) }),
            row({ 'Identificador de Cuota': 'I-2', 'Número de Cuota': 2, 'Monto de Cuota': '75.00', 'Vencimiento Cuota': new Date(Date.UTC(2026, 4, 29)) }),
            row({ 'Identificador de Cuota': 'I-3', 'Número de Cuota': 3, 'Monto de Cuota': '150.00', 'Vencimiento Cuota': new Date(Date.UTC(2026, 5, 12)) }),
          ],
        },
      ],
    });

    const prisma = makePrismaMock();
    const svc = new IngestionService(prisma, parser);
    const result = await svc.parseAndImport({ batchId: 'batch-1', fileBuffer: buffer, actorId: 'user-1' });

    expect(result.status).toBe('imported');
    expect(result.rowsImported).toBe(1); // 1 order
    expect(result.rowsRejected).toBe(0);
    expect(result.totalOrdersAmount).toBe('300.0000');
    expect(result.totalInstallmentsAmount).toBe('300.0000');
    const inserted = (prisma as unknown as { _inserted: { orders: unknown[]; installments: unknown[] } })._inserted;
    expect(inserted.orders).toHaveLength(1);
    expect(inserted.installments).toHaveLength(3);
  });

  it('returns rejected when parser is fatal (header missing)', async () => {
    const headers = STANDARD_HEADERS.filter((h) => h !== 'Rif');
    const buffer = await buildWorkbook({ sheets: [{ name: 'S1', headers, rows: [row()] }] });
    const prisma = makePrismaMock();
    const svc = new IngestionService(prisma, parser);
    const result = await svc.parseAndImport({ batchId: 'batch-1', fileBuffer: buffer, actorId: 'user-1' });

    expect(result.status).toBe('rejected');
    expect(result.rowsImported).toBe(0);
    expect(result.rejectionReason).toMatch(/rif/i);
  });

  it('reuses existing merchant when RIF already known and name matches', async () => {
    const buffer = await buildWorkbook({
      sheets: [{ name: 'S1', headers: [...STANDARD_HEADERS], rows: [row()] }],
    });
    const prisma = makePrismaMock({
      existingMerchantByRif: { 'J-12345678-9': { id: 'merch-existing', current_name: 'Mercantil C.A.' } },
    });
    const svc = new IngestionService(prisma, parser);
    const result = await svc.parseAndImport({ batchId: 'batch-1', fileBuffer: buffer, actorId: 'user-1' });

    expect(result.status).toBe('imported');
    const inserted = (prisma as unknown as { _inserted: { merchantHistoryInserts: number } })._inserted;
    expect(inserted.merchantHistoryInserts).toBe(0);
  });

  it('writes merchant_name_history when name drifts', async () => {
    const buffer = await buildWorkbook({
      sheets: [{ name: 'S1', headers: [...STANDARD_HEADERS], rows: [row({ 'Razón Social': 'Mercantil S.A. (renamed)' })] }],
    });
    const prisma = makePrismaMock({
      existingMerchantByRif: { 'J-12345678-9': { id: 'merch-existing', current_name: 'Mercantil C.A.' } },
    });
    const svc = new IngestionService(prisma, parser);
    const result = await svc.parseAndImport({ batchId: 'batch-1', fileBuffer: buffer, actorId: 'user-1' });

    expect(result.status).toBe('imported');
    const inserted = (prisma as unknown as { _inserted: { merchantHistoryInserts: number; merchantNameUpdates: number } })._inserted;
    expect(inserted.merchantHistoryInserts).toBe(1);
    expect(inserted.merchantNameUpdates).toBe(1);
  });

  it('creates a new end_user when external_hash is unknown', async () => {
    const buffer = await buildWorkbook({
      sheets: [{ name: 'S1', headers: [...STANDARD_HEADERS], rows: [row({ Usuario: 'new-user-hash' })] }],
    });
    const prisma = makePrismaMock();
    const svc = new IngestionService(prisma, parser);
    const result = await svc.parseAndImport({ batchId: 'batch-1', fileBuffer: buffer, actorId: 'user-1' });

    expect(result.status).toBe('imported');
    expect(prisma.endUser.create).toHaveBeenCalled();
  });

  it('rejects a group whose order_id already exists in DB', async () => {
    const buffer = await buildWorkbook({
      sheets: [{ name: 'S1', headers: [...STANDARD_HEADERS], rows: [row()] }],
    });
    const prisma = makePrismaMock({ existingOrderIds: new Set(['ORD-001']) });
    const svc = new IngestionService(prisma, parser);
    const result = await svc.parseAndImport({ batchId: 'batch-1', fileBuffer: buffer, actorId: 'user-1' });

    expect(result.rowsImported).toBe(0);
    expect(result.rowsRejected).toBeGreaterThan(0);
    expect(result.errorsPreview.some((e) => e.errorCode === 'order_already_exists')).toBe(true);
  });

  it('emits row-level invalid_amount for a non-numeric Monto de Cuota', async () => {
    const buffer = await buildWorkbook({
      sheets: [{ name: 'S1', headers: [...STANDARD_HEADERS], rows: [row({ 'Monto de Cuota': 'NA' })] }],
    });
    const prisma = makePrismaMock();
    const svc = new IngestionService(prisma, parser);
    const result = await svc.parseAndImport({ batchId: 'batch-1', fileBuffer: buffer, actorId: 'user-1' });

    expect(result.errorsPreview.some((e) => e.errorCode === 'invalid_amount' && e.fieldName === 'monto de cuota')).toBe(true);
    expect(result.rowsImported).toBe(0); // group dropped because one of its installments was invalid
  });

  it('emits inconsistent_merchant when a group has mixed RIFs', async () => {
    const buffer = await buildWorkbook({
      sheets: [{
        name: 'S1', headers: [...STANDARD_HEADERS], rows: [
          row({ 'Identificador de Cuota': 'I-1', 'Número de Cuota': 1 }),
          row({ 'Identificador de Cuota': 'I-2', 'Número de Cuota': 2, Rif: 'J-99999999-0' }),
        ],
      }],
    });
    const prisma = makePrismaMock();
    const svc = new IngestionService(prisma, parser);
    const result = await svc.parseAndImport({ batchId: 'batch-1', fileBuffer: buffer, actorId: 'user-1' });

    expect(result.errorsPreview.some((e) => e.errorCode === 'inconsistent_merchant')).toBe(true);
    expect(result.rowsImported).toBe(0);
  });

  it('rejects group with > 3 installments', async () => {
    const buffer = await buildWorkbook({
      sheets: [{
        name: 'S1', headers: [...STANDARD_HEADERS], rows: [
          row({ 'Identificador de Cuota': 'I-1', 'Número de Cuota': 1 }),
          row({ 'Identificador de Cuota': 'I-2', 'Número de Cuota': 2 }),
          row({ 'Identificador de Cuota': 'I-3', 'Número de Cuota': 3 }),
          row({ 'Identificador de Cuota': 'I-4', 'Número de Cuota': 4 }),
        ],
      }],
    });
    const prisma = makePrismaMock();
    const svc = new IngestionService(prisma, parser);
    const result = await svc.parseAndImport({ batchId: 'batch-1', fileBuffer: buffer, actorId: 'user-1' });

    expect(result.errorsPreview.some((e) => e.errorCode === 'invalid_installment_count' || e.errorCode === 'invalid_installment_number')).toBe(true);
    expect(result.rowsImported).toBe(0);
  });

  it('caps errorsPreview at 50 even when there are more errors', async () => {
    const rows = Array.from({ length: 60 }, (_, i) =>
      row({ 'Monto de Cuota': 'NA', 'Identificador de Orden': `ORD-${i}`, 'Identificador de Cuota': `I-${i}` }),
    );
    const buffer = await buildWorkbook({ sheets: [{ name: 'S1', headers: [...STANDARD_HEADERS], rows }] });
    const prisma = makePrismaMock();
    const svc = new IngestionService(prisma, parser);
    const result = await svc.parseAndImport({ batchId: 'batch-1', fileBuffer: buffer, actorId: 'user-1' });

    expect(result.errorsTotal).toBeGreaterThanOrEqual(60);
    expect(result.errorsPreview).toHaveLength(50);
  });
});
```

- [ ] **Step 2: Run, expect fail**

```bash
pnpm vitest run src/modules/batches/ingestion.service.test.ts
```

Expected: FAIL — module not found.

- [ ] **Step 3: Implement `IngestionService`**

```ts
// src/modules/batches/ingestion.service.ts
import { Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { ExcelParserService } from './excel-parser.service';
import { normalizeRif } from './rif-normalizer';
import { ErrorCodes, type ErrorCode } from './errors/error-codes';
import { errorMessageEs } from './errors/error-messages.es';
import type {
  IngestionResult,
  ParsedGroup,
  ParsedRow,
  ValidationError,
} from './types';

const ERROR_PREVIEW_LIMIT = 50;
const MAX_FIELD_LEN = 255;
const ID_MAX_LEN = 100;
const RAZON_SOCIAL_MAX_LEN = 255;

@Injectable()
export class IngestionService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly parser: ExcelParserService,
  ) {}

  async parseAndImport(opts: {
    batchId: string;
    fileBuffer: Buffer;
    actorId: string;
  }): Promise<IngestionResult> {
    const parseResult = await this.parser.parse(opts.fileBuffer);

    if (parseResult.kind === 'fatal') {
      await this.prisma.batch.update({
        where: { id: opts.batchId },
        data: {
          status: 'rejected',
          rejection_reason: parseResult.reason,
          imported_at: new Date(),
        },
      });
      return {
        status: 'rejected',
        rowsImported: 0,
        rowsRejected: 0,
        totalOrdersAmount: '0.0000',
        totalInstallmentsAmount: '0.0000',
        rejectionReason: parseResult.reason,
        decimalSeparatorDetected: null,
        errorsTotal: 0,
        errorsPreview: [],
      };
    }

    return await this.prisma.$transaction(
      async (tx) => {
        await tx.batch.update({
          where: { id: opts.batchId },
          data: { status: 'parsing' },
        });

        const errors: ValidationError[] = [];
        const validRows: ParsedRow[] = [];

        // Per-row validation
        for (const r of parseResult.rows) {
          const rowErrors = validateRow(r);
          if (rowErrors.length > 0) {
            errors.push(...rowErrors);
            continue;
          }
          validRows.push(r);
        }

        // Group by external_order_id
        const groupsRaw = new Map<string, ParsedRow[]>();
        for (const r of validRows) {
          const key = r.identificadorDeOrden!;
          const arr = groupsRaw.get(key) ?? [];
          arr.push(r);
          groupsRaw.set(key, arr);
        }

        // Cross-row validation per group
        const validGroups: ParsedGroup[] = [];
        for (const [orderId, rows] of groupsRaw.entries()) {
          const groupErrors = validateGroup(orderId, rows);
          const fatal = groupErrors.filter((e) => e.errorCode !== ErrorCodes.MERCHANT_NAME_DRIFT);
          if (fatal.length > 0) {
            errors.push(...groupErrors);
            continue;
          }
          // Drift warnings are recorded but the group still imports
          if (groupErrors.length > 0) errors.push(...groupErrors);

          const first = rows[0]!;
          const canonical = normalizeRif(first.rif!)!; // already validated row-level
          validGroups.push({
            externalOrderId: orderId,
            rifCanonical: canonical,
            rifRaw: first.rif!,
            razonSocial: first.razonSocial!,
            fechaDeCompra: first.fechaDeCompra!,
            usuarioHash: first.usuario!,
            montoTotalDeLaOrden: first.montoTotalDeLaOrden!,
            installments: rows.map((r) => ({
              rowNumber: r.rowNumber,
              sheetName: r.sheetName,
              externalInstallmentId: r.identificadorDeCuota!,
              installmentNumber: r.numeroDeCuota!,
              amount: r.montoDeCuota!,
              dueDate: r.vencimientoCuota!,
            })),
          });
        }

        // DB collision check (in-batch + cross-batch)
        if (validGroups.length > 0) {
          const existingOrders = await tx.order.findMany({
            where: { external_order_id: { in: validGroups.map((g) => g.externalOrderId) } },
            select: { external_order_id: true },
          });
          const existingOrderIds = new Set(existingOrders.map((x) => x.external_order_id));

          const allInstallmentIds = validGroups.flatMap((g) => g.installments.map((i) => i.externalInstallmentId));
          const existingInstallments = allInstallmentIds.length === 0
            ? []
            : await tx.installment.findMany({
                where: { external_installment_id: { in: allInstallmentIds } },
                select: { external_installment_id: true },
              });
          const existingInstallmentIds = new Set(existingInstallments.map((x) => x.external_installment_id));

          const surviving: ParsedGroup[] = [];
          for (const g of validGroups) {
            if (existingOrderIds.has(g.externalOrderId)) {
              const sample = g.installments[0]!;
              errors.push({
                sheetName: sample.sheetName,
                rowNumber: sample.rowNumber,
                fieldName: null,
                errorCode: ErrorCodes.ORDER_ALREADY_EXISTS,
                errorMessage: errorMessageEs(ErrorCodes.ORDER_ALREADY_EXISTS),
                rawValue: g.externalOrderId,
              });
              continue;
            }
            const conflictingInstallment = g.installments.find((i) => existingInstallmentIds.has(i.externalInstallmentId));
            if (conflictingInstallment) {
              errors.push({
                sheetName: conflictingInstallment.sheetName,
                rowNumber: conflictingInstallment.rowNumber,
                fieldName: 'identificador de cuota',
                errorCode: ErrorCodes.INSTALLMENT_ALREADY_EXISTS,
                errorMessage: errorMessageEs(ErrorCodes.INSTALLMENT_ALREADY_EXISTS),
                rawValue: conflictingInstallment.externalInstallmentId,
              });
              continue;
            }
            surviving.push(g);
          }
          validGroups.length = 0;
          validGroups.push(...surviving);
        }

        // Lookup-or-create + insert
        let totalOrders = new Prisma.Decimal(0);
        let totalInstallments = new Prisma.Decimal(0);

        for (const g of validGroups) {
          // Merchant
          const merchant = await tx.merchant.findUnique({ where: { rif: g.rifCanonical } });
          let merchantId: string;
          if (!merchant) {
            const created = await tx.merchant.create({
              data: { rif: g.rifCanonical, current_name: g.razonSocial },
            });
            merchantId = created.id;
            await tx.merchantNameHistory.create({
              data: {
                merchant_id: merchantId,
                name: g.razonSocial,
                effective_from: g.fechaDeCompra,
                effective_to: null,
              },
            });
          } else {
            merchantId = merchant.id;
            if (merchant.current_name !== g.razonSocial) {
              // Close previous current row + open new
              await tx.merchantNameHistory.updateMany({
                where: { merchant_id: merchantId, effective_to: null },
                data: { effective_to: g.fechaDeCompra },
              });
              await tx.merchantNameHistory.create({
                data: {
                  merchant_id: merchantId,
                  name: g.razonSocial,
                  effective_from: g.fechaDeCompra,
                  effective_to: null,
                },
              });
              await tx.merchant.update({
                where: { id: merchantId },
                data: { current_name: g.razonSocial },
              });
            }
          }

          // End user
          const eu = await tx.endUser.findUnique({ where: { external_hash: g.usuarioHash } });
          let endUserId: string;
          if (!eu) {
            const created = await tx.endUser.create({
              data: { external_hash: g.usuarioHash, first_seen_at: new Date(), last_seen_at: new Date() },
            });
            endUserId = created.id;
          } else {
            endUserId = eu.id;
          }

          // Installments derived
          const installmentsSum = g.installments.reduce(
            (acc, i) => acc.plus(new Prisma.Decimal(i.amount)),
            new Prisma.Decimal(0),
          );
          const maxDueDate = g.installments.reduce(
            (max, i) => (i.dueDate > max ? i.dueDate : max),
            g.installments[0]!.dueDate,
          );

          const order = await tx.order.create({
            data: {
              external_order_id: g.externalOrderId,
              batch_id: opts.batchId,
              merchant_id: merchantId,
              end_user_id: endUserId,
              total_amount: new Prisma.Decimal(g.montoTotalDeLaOrden),
              installments_sum: installmentsSum,
              num_installments: g.installments.length,
              purchase_date: g.fechaDeCompra,
              max_due_date: maxDueDate,
              status: 'available',
            },
          });

          await tx.installment.createMany({
            data: g.installments.map((i) => ({
              external_installment_id: i.externalInstallmentId,
              order_id: order.id,
              installment_number: i.installmentNumber,
              amount: new Prisma.Decimal(i.amount),
              due_date: i.dueDate,
              status: 'pending',
            })),
          });

          totalOrders = totalOrders.plus(new Prisma.Decimal(g.montoTotalDeLaOrden));
          totalInstallments = totalInstallments.plus(installmentsSum);
        }

        // Persist errors
        if (errors.length > 0) {
          await tx.importError.createMany({
            data: errors.map((e) => ({
              batch_id: opts.batchId,
              sheet_name: e.sheetName,
              row_number: e.rowNumber,
              field_name: e.fieldName,
              error_code: e.errorCode,
              error_message: e.errorMessage,
              raw_value: e.rawValue,
            })),
          });
        }

        await tx.batch.update({
          where: { id: opts.batchId },
          data: {
            status: 'imported',
            rows_imported: validGroups.length,
            rows_rejected: errors.length,
            total_orders_amount: totalOrders,
            total_installments_amount: totalInstallments,
            imported_at: new Date(),
          },
        });

        return {
          status: 'imported' as const,
          rowsImported: validGroups.length,
          rowsRejected: errors.length,
          totalOrdersAmount: totalOrders.toFixed(4),
          totalInstallmentsAmount: totalInstallments.toFixed(4),
          rejectionReason: null,
          decimalSeparatorDetected: parseResult.decimalSeparator,
          errorsTotal: errors.length,
          errorsPreview: errors.slice(0, ERROR_PREVIEW_LIMIT),
        };
      },
      { timeout: 60_000 },
    );
  }
}

// ---------- Per-row validation ----------

function makeError(
  row: ParsedRow,
  fieldName: string | null,
  code: ErrorCode,
  rawValue: string | null,
  context: Record<string, string | number> = {},
): ValidationError {
  return {
    sheetName: row.sheetName,
    rowNumber: row.rowNumber,
    fieldName,
    errorCode: code,
    errorMessage: errorMessageEs(code, context),
    rawValue,
  };
}

function validateRow(r: ParsedRow): ValidationError[] {
  const errors: ValidationError[] = [];

  for (const c of r.coercionErrors) {
    let code: ErrorCode = ErrorCodes.INVALID_AMOUNT;
    if (c.field === 'fecha de compra' || c.field === 'vencimiento cuota') code = ErrorCodes.INVALID_DATE;
    if (c.field === 'numero de cuota') code = ErrorCodes.INVALID_INSTALLMENT_NUMBER;
    errors.push(makeError(r, c.field, code, c.rawValue, { field: c.field, value: c.rawValue }));
  }

  const requiredFields: Array<[keyof ParsedRow, string]> = [
    ['fechaDeCompra', 'fecha de compra'],
    ['usuario', 'usuario'],
    ['rif', 'rif'],
    ['razonSocial', 'razon social'],
    ['identificadorDeOrden', 'identificador de orden'],
    ['numeroDeCuota', 'numero de cuota'],
    ['montoTotalDeLaOrden', 'monto total de la orden'],
    ['identificadorDeCuota', 'identificador de cuota'],
    ['montoDeCuota', 'monto de cuota'],
    ['vencimientoCuota', 'vencimiento cuota'],
  ];
  const coercedFields = new Set(r.coercionErrors.map((c) => c.field));
  for (const [key, fname] of requiredFields) {
    if ((r as Record<string, unknown>)[key] === null && !coercedFields.has(fname)) {
      errors.push(makeError(r, fname, ErrorCodes.MISSING_FIELD, null, { field: fname }));
    }
  }

  if (r.usuario && r.usuario.length > MAX_FIELD_LEN) {
    errors.push(makeError(r, 'usuario', ErrorCodes.FIELD_TOO_LONG, r.usuario, { field: 'usuario', max: MAX_FIELD_LEN }));
  }
  if (r.razonSocial && r.razonSocial.length > RAZON_SOCIAL_MAX_LEN) {
    errors.push(makeError(r, 'razon social', ErrorCodes.FIELD_TOO_LONG, r.razonSocial, { field: 'razon social', max: RAZON_SOCIAL_MAX_LEN }));
  }
  if (r.identificadorDeOrden && r.identificadorDeOrden.length > ID_MAX_LEN) {
    errors.push(makeError(r, 'identificador de orden', ErrorCodes.FIELD_TOO_LONG, r.identificadorDeOrden, { field: 'identificador de orden', max: ID_MAX_LEN }));
  }
  if (r.identificadorDeCuota && r.identificadorDeCuota.length > ID_MAX_LEN) {
    errors.push(makeError(r, 'identificador de cuota', ErrorCodes.FIELD_TOO_LONG, r.identificadorDeCuota, { field: 'identificador de cuota', max: ID_MAX_LEN }));
  }

  if (r.rif && normalizeRif(r.rif) === null) {
    errors.push(makeError(r, 'rif', ErrorCodes.INVALID_RIF, r.rif, { value: r.rif }));
  }

  if (r.numeroDeCuota !== null && (r.numeroDeCuota < 1 || r.numeroDeCuota > 3)) {
    errors.push(makeError(r, 'numero de cuota', ErrorCodes.INVALID_INSTALLMENT_NUMBER, String(r.numeroDeCuota), { value: r.numeroDeCuota }));
  }

  if (r.montoTotalDeLaOrden !== null && parseFloat(r.montoTotalDeLaOrden) <= 0) {
    errors.push(makeError(r, 'monto total de la orden', ErrorCodes.INVALID_AMOUNT, r.montoTotalDeLaOrden, { value: r.montoTotalDeLaOrden }));
  }
  if (r.montoDeCuota !== null && parseFloat(r.montoDeCuota) <= 0) {
    errors.push(makeError(r, 'monto de cuota', ErrorCodes.INVALID_AMOUNT, r.montoDeCuota, { value: r.montoDeCuota }));
  }

  if (r.fechaDeCompra && r.fechaDeCompra > new Date()) {
    errors.push(makeError(r, 'fecha de compra', ErrorCodes.PURCHASE_DATE_FUTURE, r.fechaDeCompra.toISOString().slice(0, 10), { value: r.fechaDeCompra.toISOString().slice(0, 10) }));
  }
  if (r.fechaDeCompra && r.vencimientoCuota && r.vencimientoCuota < r.fechaDeCompra) {
    errors.push(makeError(r, 'vencimiento cuota', ErrorCodes.DUE_BEFORE_PURCHASE, r.vencimientoCuota.toISOString().slice(0, 10)));
  }

  return errors;
}

// ---------- Per-group validation ----------

function validateGroup(orderId: string, rows: ParsedRow[]): ValidationError[] {
  const errors: ValidationError[] = [];
  const first = rows[0]!;

  const rifCanon = first.rif ? normalizeRif(first.rif) : null;
  for (const r of rows.slice(1)) {
    const rcanon = r.rif ? normalizeRif(r.rif) : null;
    if (rcanon !== rifCanon) {
      errors.push(makeError(r, 'rif', ErrorCodes.INCONSISTENT_MERCHANT, r.rif));
      break;
    }
  }

  for (const r of rows.slice(1)) {
    if (r.fechaDeCompra?.getTime() !== first.fechaDeCompra?.getTime()) {
      errors.push(makeError(r, 'fecha de compra', ErrorCodes.INCONSISTENT_PURCHASE_DATE, r.fechaDeCompra?.toISOString().slice(0, 10) ?? null));
      break;
    }
  }

  for (const r of rows.slice(1)) {
    if (r.usuario !== first.usuario) {
      errors.push(makeError(r, 'usuario', ErrorCodes.INCONSISTENT_END_USER, r.usuario));
      break;
    }
  }

  for (const r of rows.slice(1)) {
    if (r.montoTotalDeLaOrden !== first.montoTotalDeLaOrden) {
      errors.push(makeError(r, 'monto total de la orden', ErrorCodes.INCONSISTENT_TOTAL, r.montoTotalDeLaOrden));
      break;
    }
  }

  for (const r of rows.slice(1)) {
    if (r.razonSocial !== first.razonSocial) {
      errors.push(makeError(r, 'razon social', ErrorCodes.MERCHANT_NAME_DRIFT, r.razonSocial));
      break;
    }
  }

  if (rows.length < 1 || rows.length > 3) {
    errors.push(makeError(first, null, ErrorCodes.INVALID_INSTALLMENT_COUNT, null, { count: rows.length }));
  }

  const numbers = rows.map((r) => r.numeroDeCuota).filter((n): n is number => n !== null).sort((a, b) => a - b);
  const expected = Array.from({ length: rows.length }, (_, i) => i + 1);
  if (numbers.length !== rows.length || JSON.stringify(numbers) !== JSON.stringify(expected)) {
    errors.push(makeError(first, 'numero de cuota', ErrorCodes.INSTALLMENT_NUMBERS_NOT_CONTIGUOUS, null));
  }

  const seen = new Set<string>();
  for (const r of rows) {
    if (r.identificadorDeCuota && seen.has(r.identificadorDeCuota)) {
      errors.push(makeError(r, 'identificador de cuota', ErrorCodes.DUPLICATE_INSTALLMENT_ID_IN_ORDER, r.identificadorDeCuota));
      break;
    }
    if (r.identificadorDeCuota) seen.add(r.identificadorDeCuota);
  }

  return errors;
}
```

- [ ] **Step 4: Run, expect pass**

```bash
pnpm vitest run src/modules/batches/ingestion.service.test.ts
```

Expected: 10 passed.

If failures, iterate. Common issues: Decimal arithmetic precision, Date equality (use `.getTime()`), trim/null edge cases.

- [ ] **Step 5: TS check**

```bash
pnpm exec tsc --noEmit
```

Expected: zero errors.

- [ ] **Step 6: Commit**

```bash
git add src/modules/batches/ingestion.service.ts src/modules/batches/ingestion.service.test.ts
git commit -m "feat(batches): IngestionService with row + group + DB collision validation (TDD)"
```

---

## Task 9: BatchesService (TDD)

**Files:**
- Create: `src/modules/batches/batches.service.ts`
- Create: `src/modules/batches/batches.service.test.ts`

The orchestration layer between controller and ingestion. Computes content_hash, calls Storage, persists `excel_uploads` + `batches`, then invokes IngestionService.

- [ ] **Step 1: Write the failing test**

```ts
// src/modules/batches/batches.service.test.ts
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
    (prisma.excelUpload.findUnique as ReturnType<typeof vi.fn>).mockResolvedValue(null);
    (prisma.excelUpload.create as ReturnType<typeof vi.fn>).mockResolvedValue({ id: 'upload-uuid' });
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
    (prisma.excelUpload.findUnique as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
      id: 'prev-upload',
      content_hash: 'h',
      batches: { id: 'prev-batch' },
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
    const call = (prisma.batch.create as ReturnType<typeof vi.fn>).mock.calls[0]![0] as { data: { external_code: string } };
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
    const call = (prisma.batch.create as ReturnType<typeof vi.fn>).mock.calls[0]![0] as { data: { external_code: string } };
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
    const call = (prisma.excelUpload.create as ReturnType<typeof vi.fn>).mock.calls[0]![0] as { data: { content_hash: string } };
    // sha256 of 'hello' = 2cf24dba5fb0a30e26e83b2ac5b9e29e1b161e5c1fa7425e73043362938b9824
    expect(call.data.content_hash).toBe('2cf24dba5fb0a30e26e83b2ac5b9e29e1b161e5c1fa7425e73043362938b9824');
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
        { sheetName: 'S1', rowNumber: 2, fieldName: 'rif', errorCode: 'invalid_rif', errorMessage: 'RIF con formato inválido', rawValue: 'foo' },
        { sheetName: 'S1', rowNumber: 3, fieldName: 'monto de cuota', errorCode: 'invalid_amount', errorMessage: 'Monto inválido: NA', rawValue: 'NA' },
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
```

- [ ] **Step 2: Run, expect fail**

```bash
pnpm vitest run src/modules/batches/batches.service.test.ts
```

Expected: FAIL — module not found.

- [ ] **Step 3: Implement**

```ts
// src/modules/batches/batches.service.ts
import { ConflictException, Injectable } from '@nestjs/common';
import { createHash, randomUUID } from 'node:crypto';
import { PrismaService } from '../../prisma/prisma.service';
import { IngestionService } from './ingestion.service';
import { StorageService } from './storage.service';
import { generateExternalCode } from './external-code-generator';

export type UploadInput = {
  fileBuffer: Buffer;
  filename: string;
  mimeType: string;
  actorId: string;
  externalCode: string | undefined;
};

export type UploadResponse = {
  batch_id: string;
  external_code: string;
  excel_upload_id: string;
  status: 'imported' | 'rejected';
  rows_imported: number;
  rows_rejected: number;
  total_orders_amount: string;
  total_installments_amount: string;
  imported_at: string | null;
  rejection_reason: string | null;
  decimal_separator_detected: 'dot' | 'comma' | null;
  errors_preview: Array<{
    sheet_name: string;
    row_number: number;
    field_name: string | null;
    error_code: string;
    error_message: string;
  }>;
  errors_total: number;
};

@Injectable()
export class BatchesService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly ingestion: IngestionService,
    private readonly storage: StorageService,
  ) {}

  async upload(input: UploadInput): Promise<UploadResponse> {
    const contentHash = createHash('sha256').update(input.fileBuffer).digest('hex');

    const existing = await this.prisma.excelUpload.findUnique({
      where: { content_hash: contentHash },
      include: { batches: true },
    });
    if (existing) {
      throw new ConflictException({
        message: 'Archivo ya fue subido',
        existing_batch_id: existing.batches?.id ?? null,
        existing_excel_upload_id: existing.id,
      });
    }

    const storagePath = `${randomUUID()}.xlsx`;
    await this.storage.uploadExcel(input.fileBuffer, storagePath);

    const upload = await this.prisma.excelUpload.create({
      data: {
        filename: input.filename,
        storage_path: storagePath,
        storage_bucket: 'excel-uploads',
        content_hash: contentHash,
        file_size_bytes: BigInt(input.fileBuffer.byteLength),
        mime_type: input.mimeType,
        uploaded_by_id: input.actorId,
      },
    });

    const externalCode = input.externalCode ?? generateExternalCode();

    const batch = await this.prisma.batch.create({
      data: {
        external_code: externalCode,
        excel_upload_id: upload.id,
        status: 'uploaded',
      },
    });

    const ingestion = await this.ingestion.parseAndImport({
      batchId: batch.id,
      fileBuffer: input.fileBuffer,
      actorId: input.actorId,
    });

    return {
      batch_id: batch.id,
      external_code: externalCode,
      excel_upload_id: upload.id,
      status: ingestion.status,
      rows_imported: ingestion.rowsImported,
      rows_rejected: ingestion.rowsRejected,
      total_orders_amount: ingestion.totalOrdersAmount,
      total_installments_amount: ingestion.totalInstallmentsAmount,
      imported_at: new Date().toISOString(),
      rejection_reason: ingestion.rejectionReason,
      decimal_separator_detected: ingestion.decimalSeparatorDetected,
      errors_preview: ingestion.errorsPreview.map((e) => ({
        sheet_name: e.sheetName,
        row_number: e.rowNumber,
        field_name: e.fieldName,
        error_code: e.errorCode,
        error_message: e.errorMessage,
      })),
      errors_total: ingestion.errorsTotal,
    };
  }
}
```

- [ ] **Step 4: Run, expect pass**

```bash
pnpm vitest run src/modules/batches/batches.service.test.ts
```

Expected: 6 passed.

- [ ] **Step 5: Commit**

```bash
git add src/modules/batches/batches.service.ts src/modules/batches/batches.service.test.ts
git commit -m "feat(batches): BatchesService orchestrates hash + storage + ingestion (TDD)"
```

---

## Task 10: Query DTOs

**Files:**
- Create: `src/modules/batches/dto/batch-list-query.dto.ts`
- Create: `src/modules/batches/dto/batch-errors-query.dto.ts`

- [ ] **Step 1: Create both DTOs**

```ts
// src/modules/batches/dto/batch-list-query.dto.ts
import { z } from 'zod';

export const BatchListQuerySchema = z.object({
  status: z.enum(['uploaded', 'parsing', 'imported', 'rejected', 'archived']).optional(),
  from: z.coerce.date().optional(),
  to: z.coerce.date().optional(),
  uploaded_by_id: z.string().uuid().optional(),
  limit: z.coerce.number().int().min(1).max(200).default(50),
  offset: z.coerce.number().int().min(0).default(0),
});

export type BatchListQuery = z.infer<typeof BatchListQuerySchema>;
```

```ts
// src/modules/batches/dto/batch-errors-query.dto.ts
import { z } from 'zod';

export const BatchErrorsQuerySchema = z.object({
  error_code: z.string().min(1).max(100).optional(),
  limit: z.coerce.number().int().min(1).max(500).default(100),
  offset: z.coerce.number().int().min(0).default(0),
});

export type BatchErrorsQuery = z.infer<typeof BatchErrorsQuerySchema>;
```

- [ ] **Step 2: TS check**

```bash
pnpm exec tsc --noEmit
```

Zero errors.

- [ ] **Step 3: Commit**

```bash
git add src/modules/batches/dto/
git commit -m "feat(batches): Zod query DTOs for list and errors endpoints"
```

---

## Task 11: BatchesController (TDD with supertest integration)

**Files:**
- Create: `src/modules/batches/batches.controller.ts`
- Create: `src/modules/batches/batches.controller.test.ts`
- Create: `src/modules/batches/responses/batch-summary.mapper.ts`
- Create: `src/modules/batches/responses/import-error.mapper.ts`

- [ ] **Step 1: Create the response mappers**

```ts
// src/modules/batches/responses/batch-summary.mapper.ts
import type { Decimal } from '@prisma/client/runtime/library';

export type BatchRow = {
  id: string;
  external_code: string;
  status: string;
  rows_imported: number;
  rows_rejected: number;
  total_orders_amount: Decimal;
  total_installments_amount: Decimal;
  imported_at: Date | null;
  rejection_reason: string | null;
  excel_uploads: { uploaded_at: Date; users: { id: string; email: string; full_name: string } } | null;
};

export function toBatchSummary(b: BatchRow) {
  return {
    id: b.id,
    external_code: b.external_code,
    status: b.status,
    rows_imported: b.rows_imported,
    rows_rejected: b.rows_rejected,
    total_orders_amount: b.total_orders_amount.toFixed(4),
    total_installments_amount: b.total_installments_amount.toFixed(4),
    imported_at: b.imported_at?.toISOString() ?? null,
    rejection_reason: b.rejection_reason,
    uploaded_at: b.excel_uploads?.uploaded_at.toISOString() ?? null,
    uploaded_by: b.excel_uploads?.users
      ? {
          id: b.excel_uploads.users.id,
          email: b.excel_uploads.users.email,
          full_name: b.excel_uploads.users.full_name,
        }
      : null,
  };
}
```

```ts
// src/modules/batches/responses/import-error.mapper.ts
export type ImportErrorRow = {
  id: string;
  sheet_name: string;
  row_number: number;
  field_name: string | null;
  error_code: string;
  error_message: string;
  raw_value: string | null;
  created_at: Date;
};

export function toImportError(e: ImportErrorRow) {
  return {
    id: e.id,
    sheet_name: e.sheet_name,
    row_number: e.row_number,
    field_name: e.field_name,
    error_code: e.error_code,
    error_message: e.error_message,
    raw_value: e.raw_value,
    created_at: e.created_at.toISOString(),
  };
}
```

- [ ] **Step 2: Write the failing controller integration test**

```ts
// src/modules/batches/batches.controller.test.ts
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
    prismaPerms = vi.fn().mockResolvedValue([
      { permission: { key: 'batch.upload' } },
      { permission: { key: 'batch.read' } },
    ]);
    prismaBatchFindUnique = vi.fn();
    prismaBatchFindMany = vi.fn().mockResolvedValue([]);
    prismaBatchCount = vi.fn().mockResolvedValue(0);
    prismaErrorsFindMany = vi.fn().mockResolvedValue([]);
    prismaErrorsCount = vi.fn().mockResolvedValue(0);

    lookup = {
      findByAuthId: vi.fn().mockResolvedValue({ kind: 'found', user: mockAuthUser({ role: 'operator' }) }),
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
            batch: { findUnique: prismaBatchFindUnique, findMany: prismaBatchFindMany, count: prismaBatchCount },
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
    await request(app.getHttpServer()).post('/api/batches').attach('file', buf, 'a.xlsx').expect(401);
  });

  it('POST /api/batches → 403 when role lacks batch.upload', async () => {
    prismaPerms.mockResolvedValueOnce([{ permission: { key: 'batch.read' } }]); // missing upload
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
      .attach('file', Buffer.from('binary'), { filename: 'a.xls', contentType: 'application/vnd.ms-excel' })
      .expect(400);
  });

  it('POST /api/batches → 400 when file > 10 MB', async () => {
    const token = await mintTestJwt({ sub: 'auth-uuid' });
    const big = Buffer.alloc(11 * 1024 * 1024);
    await request(app.getHttpServer())
      .post('/api/batches')
      .set('Authorization', `Bearer ${token}`)
      .attach('file', big, { filename: 'big.xlsx', contentType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' })
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
    svc.upload.mockRejectedValueOnce(new ConflictException({
      message: 'Archivo ya fue subido',
      existing_batch_id: 'prev-batch',
      existing_excel_upload_id: 'prev-upload',
    }));
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
    prismaBatchFindUnique.mockResolvedValueOnce({ id: 'b-1' });
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
      .get('/api/batches/b-1/errors')
      .set('Authorization', `Bearer ${token}`)
      .expect(200);
    expect(res.body.total).toBe(1);
    expect(res.body.data[0].error_code).toBe('invalid_rif');
  });
});
```

- [ ] **Step 3: Run, expect fail**

```bash
pnpm vitest run src/modules/batches/batches.controller.test.ts
```

Expected: FAIL — module not found.

- [ ] **Step 4: Implement the controller**

```ts
// src/modules/batches/batches.controller.ts
import {
  BadRequestException,
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  NotFoundException,
  Param,
  ParseUUIDPipe,
  Post,
  Query,
  UploadedFile,
  UseInterceptors,
  UsePipes,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { ApiBearerAuth, ApiBody, ApiConsumes, ApiTags } from '@nestjs/swagger';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { RequirePermission } from '../auth/decorators/require-permission.decorator';
import type { AuthUser } from '../auth/types';
import { BatchesService } from './batches.service';
import { BatchListQuerySchema, type BatchListQuery } from './dto/batch-list-query.dto';
import { BatchErrorsQuerySchema, type BatchErrorsQuery } from './dto/batch-errors-query.dto';
import { ZodValidationPipe } from '../../common/pipes/zod-validation.pipe';
import { PrismaService } from '../../prisma/prisma.service';
import { toBatchSummary } from './responses/batch-summary.mapper';
import { toImportError } from './responses/import-error.mapper';

const XLSX_MIME = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';
const MAX_FILE_BYTES = 10 * 1024 * 1024; // 10 MB

@ApiTags('batches')
@ApiBearerAuth()
@Controller('batches')
export class BatchesController {
  constructor(
    private readonly batches: BatchesService,
    private readonly prisma: PrismaService,
  ) {}

  @Post()
  @HttpCode(HttpStatus.OK)
  @RequirePermission('batch.upload')
  @ApiConsumes('multipart/form-data')
  @ApiBody({
    schema: {
      type: 'object',
      properties: {
        file: { type: 'string', format: 'binary' },
        external_code: { type: 'string', maxLength: 20 },
      },
      required: ['file'],
    },
  })
  @UseInterceptors(
    FileInterceptor('file', {
      limits: { fileSize: MAX_FILE_BYTES },
    }),
  )
  async upload(
    @UploadedFile() file: Express.Multer.File | undefined,
    @Body('external_code') externalCode: string | undefined,
    @CurrentUser() user: AuthUser,
  ) {
    if (!file) {
      throw new BadRequestException('Archivo requerido');
    }
    if (file.size > MAX_FILE_BYTES) {
      throw new BadRequestException('Archivo excede 10 MB');
    }

    // mime check: accept official xlsx mime OR generic with .xlsx extension; reject .xls explicitly
    const isXlsxMime = file.mimetype === XLSX_MIME;
    const hasXlsxExt = /\.xlsx$/i.test(file.originalname ?? '');
    const hasXlsExt = /\.xls$/i.test(file.originalname ?? '');
    if (hasXlsExt) {
      throw new BadRequestException('Formato .xls no soportado, usar .xlsx');
    }
    if (!isXlsxMime && !hasXlsxExt) {
      throw new BadRequestException('Tipo de archivo no soportado, se requiere .xlsx');
    }
    if (externalCode !== undefined && !/^[A-Z0-9-]{1,20}$/.test(externalCode)) {
      throw new BadRequestException('external_code inválido');
    }

    return await this.batches.upload({
      fileBuffer: file.buffer,
      filename: file.originalname,
      mimeType: file.mimetype || XLSX_MIME,
      actorId: user.id,
      externalCode,
    });
  }

  @Get()
  @RequirePermission('batch.read')
  @UsePipes(new ZodValidationPipe(BatchListQuerySchema))
  async list(@Query() query: BatchListQuery) {
    const where: Record<string, unknown> = {};
    if (query.status) where.status = query.status;
    if (query.from || query.to) {
      where.imported_at = {};
      if (query.from) (where.imported_at as Record<string, Date>).gte = query.from;
      if (query.to) (where.imported_at as Record<string, Date>).lte = query.to;
    }
    if (query.uploaded_by_id) {
      where.excel_uploads = { uploaded_by_id: query.uploaded_by_id };
    }

    const [data, total] = await Promise.all([
      this.prisma.batch.findMany({
        where,
        include: {
          excel_uploads: {
            include: { users: true },
          },
        },
        orderBy: [{ imported_at: { sort: 'desc', nulls: 'last' } }],
        take: query.limit,
        skip: query.offset,
      }),
      this.prisma.batch.count({ where }),
    ]);

    return {
      data: data.map((b) => toBatchSummary(b as never)),
      total,
      limit: query.limit,
      offset: query.offset,
    };
  }

  @Get(':id')
  @RequirePermission('batch.read')
  async detail(@Param('id', ParseUUIDPipe) id: string) {
    const batch = await this.prisma.batch.findUnique({
      where: { id },
      include: { excel_uploads: { include: { users: true } } },
    });
    if (!batch) throw new NotFoundException('Batch no encontrado');
    const errors_total = await this.prisma.importError.count({ where: { batch_id: id } });
    return { ...toBatchSummary(batch as never), errors_total };
  }

  @Get(':id/errors')
  @RequirePermission('batch.read')
  async errors(
    @Param('id', ParseUUIDPipe) id: string,
    @Query(new ZodValidationPipe(BatchErrorsQuerySchema)) query: BatchErrorsQuery,
  ) {
    const batch = await this.prisma.batch.findUnique({ where: { id }, select: { id: true } });
    if (!batch) throw new NotFoundException('Batch no encontrado');
    const where: Record<string, unknown> = { batch_id: id };
    if (query.error_code) where.error_code = query.error_code;
    const [data, total] = await Promise.all([
      this.prisma.importError.findMany({
        where,
        orderBy: [{ row_number: 'asc' }],
        take: query.limit,
        skip: query.offset,
      }),
      this.prisma.importError.count({ where }),
    ]);
    return {
      data: data.map((e) => toImportError(e as never)),
      total,
      limit: query.limit,
      offset: query.offset,
    };
  }
}
```

- [ ] **Step 5: Run, expect pass**

```bash
pnpm vitest run src/modules/batches/batches.controller.test.ts
```

Expected: 13 passed.

If failures around multer file size: NestJS' `FileInterceptor` with `limits.fileSize` raises `PayloadTooLargeError` (413) by default. Convert to 400 in a try/catch or via a global exception filter override. The test expects 400 — implement a small mapping inside `upload()` if needed (catch the error and rethrow as `BadRequestException`).

- [ ] **Step 6: Commit**

```bash
git add src/modules/batches/batches.controller.ts src/modules/batches/batches.controller.test.ts src/modules/batches/responses/
git commit -m "feat(batches): controller with POST upload + 3 GETs + Zod query DTOs (TDD)"
```

---

## Task 12: BatchesModule + wire into AppModule

**Files:**
- Create: `src/modules/batches/batches.module.ts`
- Modify: `src/app.module.ts`

- [ ] **Step 1: Create the module**

```ts
// src/modules/batches/batches.module.ts
import { Module } from '@nestjs/common';
import { BatchesController } from './batches.controller';
import { BatchesService } from './batches.service';
import { IngestionService } from './ingestion.service';
import { ExcelParserService } from './excel-parser.service';
import { StorageService } from './storage.service';

@Module({
  controllers: [BatchesController],
  providers: [BatchesService, IngestionService, ExcelParserService, StorageService],
})
export class BatchesModule {}
```

- [ ] **Step 2: Wire into AppModule**

Read current AppModule:
```bash
cat src/app.module.ts
```

Add the import and module:

```ts
import { BatchesModule } from './modules/batches/batches.module';

@Module({
  imports: [
    ConfigModule.forRoot({ isGlobal: true, validate: validateEnv }),
    LoggerModule,
    PrismaModule,
    AuthModule,
    HealthModule,
    MeModule,
    BatchesModule,
  ],
})
export class AppModule {}
```

- [ ] **Step 3: Verify compilation + full test suite still green**

```bash
pnpm exec tsc --noEmit
pnpm test
```

Expected: zero TS errors. Test count = 31 (existing) + 59 (new) = 90.

- [ ] **Step 4: Commit**

```bash
git add src/modules/batches/batches.module.ts src/app.module.ts
git commit -m "feat(batches): wire BatchesModule into AppModule"
```

---

## Task 13: Document storage bucket prerequisite + smoke test

**Files:**
- Modify: `infra/sql/README.md`

- [ ] **Step 1: Append bucket setup section to `infra/sql/README.md`**

Add the following section to the end of the file:

```markdown
## Setup manual de Supabase Storage (prerequisito de Slice 2+)

CLAUDE.md prohíbe tocar `storage.*` desde migraciones SQL. Antes del primer
`POST /api/batches`, alguien con acceso al Dashboard de Supabase debe crear:

**Supabase Dashboard → Storage → New bucket**

- Name: `excel-uploads`
- Public: **OFF**
- File size limit: 10 MB
- Allowed MIME types: `application/vnd.openxmlformats-officedocument.spreadsheetml.sheet`

Sin policies adicionales: el backend usa `SUPABASE_SERVICE_ROLE_KEY`
que bypasea las RLS de storage.
```

- [ ] **Step 2: Smoke test against real Supabase Storage**

This step requires the bucket to exist. If it doesn't yet, stop and ask the operator to create it (per Step 1's documented procedure).

```bash
lsof -ti:3001 | xargs -r kill -9 2>/dev/null; sleep 1
pnpm dev > /tmp/araguaney-dev.log 2>&1 &
DEV_PID=$!
sleep 6
```

Mint a JWT for an existing seeded user. Replace `<SUB>` with a real `auth.users.id` that maps to an active `cfb.users` row, OR insert a test user via Supabase SQL editor first:

```sql
-- One-time setup: insert a test cfb.users row tied to an auth.users row
INSERT INTO cfb.users (auth_user_id, email, full_name, role, is_active)
VALUES ('<auth-user-uuid>', 'test.ops@cashea.app', 'Test Operator', 'operator', true);
```

Then mint a token with `<SUB>` = `<auth-user-uuid>`:

```bash
node -e "
const { SignJWT } = require('jose');
const sub = process.argv[1];
const secret = new TextEncoder().encode(process.env.SUPABASE_JWT_SECRET);
new SignJWT({ sub }).setProtectedHeader({alg:'HS256'}).setIssuedAt().setExpirationTime(Math.floor(Date.now()/1000)+3600).sign(secret).then(t => console.log(t));
" <auth-user-uuid>
```

Build a tiny test xlsx and upload:

```bash
node -e "
const ExcelJS = require('exceljs');
const fs = require('fs');
(async () => {
  const wb = new ExcelJS.Workbook();
  const ws = wb.addWorksheet('S1');
  ws.addRow(['Fecha de Compra','Usuario','Rif','Razón Social','Identificador de Orden','Número de Cuota','Monto Total de la Orden','Identificador de Cuota','Monto de Cuota','Vencimiento Cuota']);
  ws.addRow([new Date('2026-05-01'),'test-user','J-12345678-9','Test Merchant','ORD-SMOKE-1',1,'300.00','INST-SMOKE-1','75.00',new Date('2026-05-15')]);
  ws.addRow([new Date('2026-05-01'),'test-user','J-12345678-9','Test Merchant','ORD-SMOKE-1',2,'300.00','INST-SMOKE-2','75.00',new Date('2026-05-29')]);
  ws.addRow([new Date('2026-05-01'),'test-user','J-12345678-9','Test Merchant','ORD-SMOKE-1',3,'300.00','INST-SMOKE-3','150.00',new Date('2026-06-12')]);
  await wb.xlsx.writeFile('/tmp/smoke.xlsx');
})();
"
```

```bash
TOKEN="<paste-the-token>"
curl -s -X POST -H "Authorization: Bearer $TOKEN" -F "file=@/tmp/smoke.xlsx" http://localhost:3001/api/batches | head -100
```

Expected: JSON response with `status: "imported"`, `rows_imported: 1`, `rows_rejected: 0`.

Re-upload the same file → expect 409 with `existing_batch_id`.

GET the list:
```bash
curl -s -H "Authorization: Bearer $TOKEN" http://localhost:3001/api/batches | head -50
```

Stop server:
```bash
kill $DEV_PID 2>/dev/null; wait $DEV_PID 2>/dev/null
lsof -ti:3001 | xargs -r kill -9 2>/dev/null
```

If anything fails, capture the dev log tail and iterate.

- [ ] **Step 3: Commit the README update**

```bash
git add infra/sql/README.md
git commit -m "docs(infra): document excel-uploads bucket setup as Slice 2 prerequisite"
```

The smoke test is verification only — no commit for that step.

---

## Task 14: Regenerate openapi.json

**Files:**
- Generate + force-add: `openapi.json`

- [ ] **Step 1: Run the export**

```bash
pnpm openapi:export
```

Expected: prints `OpenAPI spec written to .../openapi.json`.

- [ ] **Step 2: Verify all 4 batches endpoints + multipart documented**

```bash
node -e "const d = require('./openapi.json'); console.log('paths:', Object.keys(d.paths)); console.log('has /api/batches:', '/api/batches' in d.paths); console.log('has /api/batches/{id}:', '/api/batches/{id}' in d.paths); console.log('has /api/batches/{id}/errors:', '/api/batches/{id}/errors' in d.paths);"
```

Expected: paths includes `/api/health`, `/api/me`, `/api/batches`, `/api/batches/{id}`, `/api/batches/{id}/errors`. All flags `true`.

- [ ] **Step 3: Force-add and commit**

```bash
git add -f openapi.json
git commit -m "feat(openapi): regenerate with batches endpoints + multipart upload schema"
```

---

## Self-review

**1. Spec coverage:**

| Spec section | Implemented in task |
|---|---|
| §2 — Excel format (10 columns, multi-sheet, header normalization, decimal heuristic) | Task 6 (parser) |
| §3 — Decisions (jose-style: byte-equiv, sync, monolithic, bucket, idempotency) | Tasks 7, 9, 11 |
| §4 — Architecture diagram | Tasks 8, 9, 11 (combined) |
| §5 — File structure | All tasks |
| §6 — Endpoints (POST + 3 GETs) | Task 11 |
| §7 — Validations (per-row 10, cross-row 8, DB collision 2, global) | Tasks 6 (coercion), 8 (validation logic) |
| §8 — Observability | Pino logs are inherited from Slice 0 setup; no extra log lines were added in tasks. Gap: explicit `parse started`/`parse completed` info events. **Acceptable to defer** as a small follow-up — not blocking acceptance. |
| §9 — Tests (~59) | Task 3 (8), Task 4 (2), Task 6 (~17 it blocks), Task 7 (3), Task 8 (10), Task 9 (6), Task 11 (13) ≈ **59** |
| §10 — Storage bucket prerequisite | Task 13 |
| §11 — Dependencies | Task 1 |
| §12 — Acceptance criteria | Task 13 (smoke), Task 14 (openapi) |

**2. Placeholder scan:**

- No `TODO`, `TBD`, "implement later", or "fill in details".
- §8 observability is flagged as a known gap and deferred — explicit, not a placeholder.
- All code blocks are complete and runnable.

**3. Type/name consistency:**

- `ParsedRow`, `ParsedGroup`, `ValidationError`, `IngestionResult`, `ParseResult` defined in Task 2, used in Tasks 6, 8, 9. ✓
- `ErrorCodes` constants defined in Task 2, used in Task 8. ✓
- `errorMessageEs` defined in Task 2, used in Task 8. ✓
- `STANDARD_HEADERS` defined in Task 5, used in Tasks 6, 8, 11. ✓
- `BatchListQuery` / `BatchErrorsQuery` types defined in Task 10, used in Task 11. ✓
- `UploadResponse` defined in Task 9, returned by Task 11. ✓
- `prisma.rolePermission` accessor (Slice 1) reused consistently. ✓
- Prisma model accessors used: `prisma.merchant`, `prisma.merchantNameHistory`, `prisma.endUser`, `prisma.order`, `prisma.installment`, `prisma.importError`, `prisma.batch`, `prisma.excelUpload`. These match the camelCased PascalCase model names from `schema.prisma` (verified during Slice 0).

No issues found.

---

## Execution

Plan complete and saved to `docs/superpowers/plans/2026-05-06-slice-2-ingestion.md`. Two execution options:

1. **Subagent-Driven (recommended)** — fresh subagent per task, two-stage review.
2. **Inline Execution** — execute tasks in this session with checkpoints.

Which approach?

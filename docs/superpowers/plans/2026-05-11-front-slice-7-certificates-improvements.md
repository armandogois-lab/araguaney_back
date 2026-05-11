# araguaney_front Slice 7 — `/certificates` detail improvements Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Four targeted improvements to the certificate detail page: Excel export, first-maturity hero card, financial-detail sidebar block, and pagination on the orders pool table.

**Architecture:** All changes are frontend-only. Excel generation is client-side via lazy-imported `exceljs`. No back-end changes; data already returned by `GET /api/certificates/:id`. Each change is scoped to one component (or one new helper).

**Tech Stack:** Next.js 16 App Router, TanStack Query v5, `exceljs` (lazy import), `file-saver` (lazy import), Vitest + Testing Library.

**Spec:** `/Users/llam/dev/araguaney_back/docs/superpowers/specs/2026-05-11-front-slice-7-certificates-improvements-design.md`

**Working directory note:** all front code lives in `/Users/llam/dev/araguaney_front/`. Plan and spec live in `/Users/llam/dev/araguaney_back/docs/`. Implementer must `cd /Users/llam/dev/araguaney_front` for any task command.

**Pre-req branch:** Work on `feat/slice-7-cert-improvements` (Task 1 creates this from `main`).

---

## File Structure

| Path | Action | Responsibility |
|---|---|---|
| `package.json` | modify | Add `exceljs`, `file-saver`, `@types/file-saver` |
| `lib/export/certificate-excel.ts` | create | Pure function: `CertificateDetail` → `Blob` (XLSX) with Resumen + Órdenes sheets |
| `lib/export/certificate-excel.test.ts` | create | Real-library tests: generate, re-parse, assert cell values |
| `components/certificates/cert-header.tsx` | modify | Add `onExport?` + `exporting?` props + button |
| `components/certificates/cert-header.test.tsx` | modify | 3 new tests for the button |
| `components/certificates/certificate-detail-page.tsx` | modify | Lazy-import helper + saveAs on click + exporting state + toast |
| `components/certificates/certificate-detail-page.test.tsx` | modify | 1 new test: click calls helper |
| `components/certificates/cert-hero-strip.tsx` | modify | Grid 5→6 cols; new "PRIMER VTO" card |
| `components/certificates/cert-hero-strip.test.tsx` | modify | 3 new tests for the new card |
| `components/certificates/cert-audit-sidebar.tsx` | modify | Insert "DETALLE FINANCIERO" block between INVERSOR and REGLAS |
| `components/certificates/cert-audit-sidebar.test.tsx` | modify | 2 new tests |
| `components/certificates/cert-orders-table.tsx` | modify | Add 50/page pagination over filtered set |
| `components/certificates/cert-orders-table.test.tsx` | modify | 4 new tests |

**Total:** 2 new files + 11 modifications. ~15 new tests.

**Manual operational tasks:**

| Action | Owner | When |
|---|---|---|
| Push branch + open PR | controller | Task 9 |
| Review + merge | user | After Task 9 |
| Verify Vercel deploy + visual smoke | user | Post-merge |

---

## Task 1: Branch + install dependencies

**Why:** `exceljs` and `file-saver` are not yet in the front. Install before any code that imports them.

**Files:**
- Modify: `package.json` (pnpm will handle the lockfile)

- [ ] **Step 1: Create branch from main**

```bash
cd /Users/llam/dev/araguaney_front
git fetch origin --prune
git checkout main
git pull origin main
git checkout -b feat/slice-7-cert-improvements
```

- [ ] **Step 2: Install runtime deps**

```bash
cd /Users/llam/dev/araguaney_front
pnpm add exceljs file-saver
pnpm add -D @types/file-saver
```

- [ ] **Step 3: Verify install**

```bash
cd /Users/llam/dev/araguaney_front
pnpm typecheck && pnpm test
```

Expected: both clean. The new deps don't break anything because nothing imports them yet.

- [ ] **Step 4: Commit**

```bash
cd /Users/llam/dev/araguaney_front
git add package.json pnpm-lock.yaml
git commit -m "$(cat <<'EOF'
chore(deps): add exceljs + file-saver for client-side Excel export

Both will be lazy-imported in lib/export/certificate-excel.ts so the
initial bundle stays small. exceljs matches the back's import-side
library (consistent stack).

Co-Authored-By: Claude Opus 4.7 <noreply@anthropic.com>
EOF
)"
```

---

## Task 2: `lib/export/certificate-excel.ts` helper

**Why:** Pure function that takes a `CertificateDetail` and returns an XLSX `Blob`. Lives outside React so it's trivially testable and decoupled.

**Files:**
- Create: `lib/export/certificate-excel.ts`
- Create: `lib/export/certificate-excel.test.ts`

- [ ] **Step 1: Failing test**

Create `/Users/llam/dev/araguaney_front/lib/export/certificate-excel.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import ExcelJS from 'exceljs';
import { generateCertificateExcel } from './certificate-excel';
import type { CertificateDetail } from '@/lib/types/certificate';

function mockCert(over: Partial<CertificateDetail> = {}): CertificateDetail {
  return {
    id: 'c-1',
    certificate_code: 'C4572A',
    certificate_type: 'standard',
    status: 'issued',
    investor: { id: 'inv-1', legal_name: 'Inversora Alpha, C.A.', rif: 'J-12345678-9' },
    investor_capital: '100000.0000',
    annual_rate: '0.130000',
    term_days: 42,
    price: '0.984833',
    nominal_target: '101540.6000',
    nominal_actual: '101540.0000',
    investor_paid: '99999.4100',
    investor_returned: '0.5900',
    investor_yield: '1540.5900',
    shortfall_pct: '0.000006',
    issue_date: '2026-04-27',
    maturity_date: '2026-06-08',
    cycle_week: '2026-W18',
    issued_by: { id: 'u-1', email: 'op@x.com', full_name: 'María Rodríguez' },
    created_at: '2026-04-27T14:30:00Z',
    payload_hash: 'h-abc',
    cancellation: null,
    orders: [
      {
        id: 'o-1',
        external_order_id: '85657474',
        merchant: { id: 'm-1', current_name: 'CENTRAL MADEIRENSE', rif: 'J-1' },
        purchase_date: '2026-03-18',
        max_due_date: '2026-04-03',
        installments_sum_snapshot: '87.2400',
        assigned_at: '2026-04-27T14:30:00Z',
        installments: [
          { installment_number: 1, amount: '29.08', due_date: '2026-04-03', status: 'pending' },
          { installment_number: 2, amount: '29.08', due_date: '2026-04-10', status: 'pending' },
          { installment_number: 3, amount: '29.08', due_date: '2026-04-17', status: 'pending' },
        ],
      },
      {
        id: 'o-2',
        external_order_id: '85656105',
        merchant: { id: 'm-2', current_name: 'GRUPO CANALETTO', rif: 'J-2' },
        purchase_date: '2026-03-18',
        max_due_date: '2026-04-10',
        installments_sum_snapshot: '26.0700',
        assigned_at: '2026-04-27T14:30:00Z',
        installments: [
          { installment_number: 1, amount: '26.07', due_date: '2026-04-03', status: 'pending' },
        ],
      },
    ],
    events: [],
    ...over,
  };
}

async function reload(blob: Blob): Promise<ExcelJS.Workbook> {
  const buffer = await blob.arrayBuffer();
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.load(buffer);
  return wb;
}

describe('generateCertificateExcel', () => {
  it('returns a Blob with the xlsx mime type', async () => {
    const blob = await generateCertificateExcel(mockCert());
    expect(blob).toBeInstanceOf(Blob);
    expect(blob.type).toBe(
      'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    );
  });

  it('has two sheets named "Resumen" and "Órdenes"', async () => {
    const blob = await generateCertificateExcel(mockCert());
    const wb = await reload(blob);
    expect(wb.worksheets.map((s) => s.name)).toEqual(['Resumen', 'Órdenes']);
  });

  it('Resumen sheet contains the certificate code and investor info', async () => {
    const blob = await generateCertificateExcel(mockCert());
    const wb = await reload(blob);
    const resumen = wb.getWorksheet('Resumen');
    expect(resumen).toBeDefined();
    // Find row whose A column is "Código"
    const allValuesA: string[] = [];
    resumen!.eachRow((row) => allValuesA.push(String(row.getCell(1).value ?? '')));
    expect(allValuesA).toContain('Código');
    expect(allValuesA).toContain('Inversor');
    expect(allValuesA).toContain('RIF');
    expect(allValuesA).toContain('Primer vto pool');

    const codeRow = resumen!.findRow(
      [...Array(50).keys()].find((i) => resumen!.getCell(`A${i + 1}`).value === 'Código')! + 1,
    );
    expect(String(codeRow!.getCell(2).value)).toBe('C4572A');
  });

  it('Órdenes sheet has a header row + one row per order + a TOTAL row', async () => {
    const blob = await generateCertificateExcel(mockCert());
    const wb = await reload(blob);
    const ordenes = wb.getWorksheet('Órdenes');
    expect(ordenes).toBeDefined();

    // Row 1: headers
    expect(String(ordenes!.getCell('A1').value)).toBe('ID orden');
    expect(String(ordenes!.getCell('B1').value)).toBe('Comercio');

    // Row 2 + 3: order data
    expect(String(ordenes!.getCell('A2').value)).toBe('85657474');
    expect(String(ordenes!.getCell('B2').value)).toBe('CENTRAL MADEIRENSE');
    expect(Number(ordenes!.getCell('F2').value)).toBe(3); // # cuotas
    expect(Number(ordenes!.getCell('G2').value)).toBeCloseTo(87.24, 2);

    expect(String(ordenes!.getCell('A3').value)).toBe('85656105');

    // Row 4: TOTAL
    expect(String(ordenes!.getCell('A4').value)).toBe('TOTAL');
    expect(Number(ordenes!.getCell('F4').value)).toBe(4); // 3 + 1 cuotas
    expect(Number(ordenes!.getCell('G4').value)).toBeCloseTo(113.31, 2);
  });

  it('uses min(orders.max_due_date) for "Primer vto pool"', async () => {
    const blob = await generateCertificateExcel(mockCert());
    const wb = await reload(blob);
    const resumen = wb.getWorksheet('Resumen')!;
    // Find the "Primer vto pool" row
    let foundValue: unknown = null;
    resumen.eachRow((row) => {
      if (String(row.getCell(1).value) === 'Primer vto pool') {
        foundValue = row.getCell(2).value;
      }
    });
    // The min between '2026-04-03' and '2026-04-10' is '2026-04-03' → formatted dd/mm/yyyy
    expect(String(foundValue)).toBe('03/04/2026');
  });

  it('handles empty pool gracefully', async () => {
    const blob = await generateCertificateExcel(mockCert({ orders: [] }));
    const wb = await reload(blob);
    const resumen = wb.getWorksheet('Resumen')!;
    let primerVto: unknown = null;
    resumen.eachRow((row) => {
      if (String(row.getCell(1).value) === 'Primer vto pool') {
        primerVto = row.getCell(2).value;
      }
    });
    expect(String(primerVto)).toBe('—');

    const ordenes = wb.getWorksheet('Órdenes')!;
    // Row 1 is header; row 2 is TOTAL (no data rows). Verify by checking that A2 is "TOTAL"
    expect(String(ordenes.getCell('A2').value)).toBe('TOTAL');
    expect(Number(ordenes.getCell('F2').value)).toBe(0);
    expect(Number(ordenes.getCell('G2').value)).toBe(0);
  });
});
```

- [ ] **Step 2: Run, confirm fails**

```bash
cd /Users/llam/dev/araguaney_front
pnpm test lib/export/certificate-excel.test.ts
```

Expected: import error — module doesn't exist.

- [ ] **Step 3: Implement**

Create `/Users/llam/dev/araguaney_front/lib/export/certificate-excel.ts`:

```ts
import ExcelJS from 'exceljs';
import type { CertificateDetail, CertificateOrder } from '@/lib/types/certificate';

const XLSX_MIME =
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';

const MONEY_FMT = '$#,##0.00';
const PCT_FMT = '0.0000%';
const DATE_FMT = 'dd/mm/yyyy';

export async function generateCertificateExcel(
  cert: CertificateDetail,
): Promise<Blob> {
  const wb = new ExcelJS.Workbook();
  wb.creator = 'Cashea CFB';
  wb.created = new Date();

  buildResumenSheet(wb.addWorksheet('Resumen'), cert);
  buildOrdenesSheet(wb.addWorksheet('Órdenes'), cert);

  const buffer = await wb.xlsx.writeBuffer();
  return new Blob([buffer], { type: XLSX_MIME });
}

function isoToDate(iso: string): Date {
  // YYYY-MM-DD → UTC midnight Date (avoids tz drift when Excel formats)
  const [y, m, d] = iso.split('-').map(Number);
  return new Date(Date.UTC(y, m - 1, d));
}

function statusLabel(status: CertificateDetail['status']): string {
  switch (status) {
    case 'issued':
      return 'Activo';
    case 'matured':
      return 'Vencido';
    case 'cancelled':
      return 'Cancelado';
    default:
      return 'Borrador';
  }
}

function firstMaturity(orders: CertificateOrder[]): string | null {
  if (orders.length === 0) return null;
  return orders.reduce(
    (acc, o) => (o.max_due_date < acc ? o.max_due_date : acc),
    orders[0].max_due_date,
  );
}

function buildResumenSheet(
  sheet: ExcelJS.Worksheet,
  cert: CertificateDetail,
): void {
  sheet.getColumn(1).width = 24;
  sheet.getColumn(2).width = 32;

  const fm = firstMaturity(cert.orders);

  type Row = { k: string; v: unknown; fmt?: string };
  const rows: Row[] = [
    { k: 'Código', v: cert.certificate_code },
    { k: 'Tipo', v: cert.certificate_type },
    { k: 'Estado', v: statusLabel(cert.status) },
    { k: 'Inversor', v: cert.investor.legal_name },
    { k: 'RIF', v: cert.investor.rif },
    { k: 'Capital', v: Number(cert.investor_capital), fmt: MONEY_FMT },
    { k: 'Tasa anual', v: Number(cert.annual_rate), fmt: PCT_FMT },
    { k: 'Plazo', v: `${cert.term_days} días` },
    { k: 'Precio', v: Number(cert.price) },
    { k: 'Nominal objetivo', v: Number(cert.nominal_target), fmt: MONEY_FMT },
    { k: 'Nominal real', v: Number(cert.nominal_actual), fmt: MONEY_FMT },
    { k: 'Pagado inversor', v: Number(cert.investor_paid), fmt: MONEY_FMT },
    { k: 'Residual', v: Number(cert.investor_returned), fmt: MONEY_FMT },
    { k: 'Rendimiento', v: Number(cert.investor_yield), fmt: MONEY_FMT },
    { k: 'Shortfall', v: Number(cert.shortfall_pct), fmt: PCT_FMT },
    { k: 'Emisión', v: isoToDate(cert.issue_date), fmt: DATE_FMT },
    { k: 'Vencimiento', v: isoToDate(cert.maturity_date), fmt: DATE_FMT },
    {
      k: 'Primer vto pool',
      v: fm ? isoToDate(fm) : '—',
      fmt: fm ? DATE_FMT : undefined,
    },
    { k: 'Emitido por', v: `${cert.issued_by.full_name} (${cert.issued_by.email})` },
    { k: 'Hash payload', v: cert.payload_hash },
  ];

  rows.forEach((r, i) => {
    const row = sheet.getRow(i + 1);
    row.getCell(1).value = r.k;
    row.getCell(1).font = { bold: true };
    row.getCell(2).value = r.v as ExcelJS.CellValue;
    if (r.fmt) row.getCell(2).numFmt = r.fmt;
  });
}

function buildOrdenesSheet(
  sheet: ExcelJS.Worksheet,
  cert: CertificateDetail,
): void {
  sheet.columns = [
    { header: 'ID orden', key: 'id', width: 14 },
    { header: 'Comercio', key: 'merchant', width: 32 },
    { header: 'RIF', key: 'rif', width: 14 },
    { header: 'Compra', key: 'purchase', width: 12 },
    { header: 'Últ. vto', key: 'maxDue', width: 12 },
    { header: '# Cuotas', key: 'cuotas', width: 10 },
    { header: 'Monto', key: 'monto', width: 14 },
  ];
  sheet.getRow(1).font = { bold: true };
  sheet.views = [{ state: 'frozen', ySplit: 1 }];

  let totalCuotas = 0;
  let totalMonto = 0;

  cert.orders.forEach((o) => {
    const row = sheet.addRow({
      id: o.external_order_id,
      merchant: o.merchant.current_name,
      rif: o.merchant.rif,
      purchase: isoToDate(o.purchase_date),
      maxDue: isoToDate(o.max_due_date),
      cuotas: o.installments.length,
      monto: Number(o.installments_sum_snapshot),
    });
    row.getCell('purchase').numFmt = DATE_FMT;
    row.getCell('maxDue').numFmt = DATE_FMT;
    row.getCell('monto').numFmt = MONEY_FMT;
    totalCuotas += o.installments.length;
    totalMonto += Number(o.installments_sum_snapshot);
  });

  const totalRow = sheet.addRow({
    id: 'TOTAL',
    merchant: '',
    rif: '',
    purchase: '',
    maxDue: '',
    cuotas: totalCuotas,
    monto: totalMonto,
  });
  totalRow.font = { bold: true };
  totalRow.getCell('monto').numFmt = MONEY_FMT;
}
```

- [ ] **Step 4: Pass + verify**

```bash
cd /Users/llam/dev/araguaney_front
pnpm test lib/export/certificate-excel.test.ts
pnpm typecheck && pnpm lint:check && pnpm test && pnpm format:check
```

All four must pass. The test file uses the real `exceljs` library to re-parse the generated Blob — slightly slow (~150ms per case), but high-fidelity.

- [ ] **Step 5: Commit**

```bash
cd /Users/llam/dev/araguaney_front
git add lib/export/certificate-excel.ts lib/export/certificate-excel.test.ts
git commit -m "$(cat <<'EOF'
feat(export): generateCertificateExcel helper

Pure function: CertificateDetail → Blob (XLSX) with two sheets:
- Resumen: cert metadata + investor info + financial figures
- Órdenes: one row per order + TOTAL row

Money/percent/date cells use proper Excel number formats so the file
opens cleanly in Excel/Numbers/Sheets. exceljs is imported eagerly in
this module; consumers lazy-import the whole module.

Co-Authored-By: Claude Opus 4.7 <noreply@anthropic.com>
EOF
)"
```

---

## Task 3: Wire export button in `<CertHeader>`

**Why:** Adds the "Exportar Excel" button to the detail header. Visible to all roles. New optional props `onExport` and `exporting`.

**Files:**
- Modify: `components/certificates/cert-header.tsx`
- Modify: `components/certificates/cert-header.test.tsx`

- [ ] **Step 1: Failing tests (append)**

Append inside the existing `describe('<CertHeader />', ...)` block in `/Users/llam/dev/araguaney_front/components/certificates/cert-header.test.tsx`:

```tsx
  it('renders "Exportar Excel" button when onExport prop is provided', () => {
    render(
      <UserProvider user={operator}>
        <CertHeader cert={mockCert()} onCancel={vi.fn()} onExport={vi.fn()} />
      </UserProvider>,
    );
    expect(screen.getByRole('button', { name: /exportar excel/i })).toBeInTheDocument();
  });

  it('Exportar button visible for auditor too', () => {
    render(
      <UserProvider user={auditor}>
        <CertHeader cert={mockCert()} onCancel={vi.fn()} onExport={vi.fn()} />
      </UserProvider>,
    );
    expect(screen.getByRole('button', { name: /exportar excel/i })).toBeInTheDocument();
  });

  it('clicking Exportar fires onExport', () => {
    const onExport = vi.fn();
    render(
      <UserProvider user={operator}>
        <CertHeader cert={mockCert()} onCancel={vi.fn()} onExport={onExport} />
      </UserProvider>,
    );
    fireEvent.click(screen.getByRole('button', { name: /exportar excel/i }));
    expect(onExport).toHaveBeenCalled();
  });

  it('button shows "Generando…" and is disabled while exporting=true', () => {
    render(
      <UserProvider user={operator}>
        <CertHeader cert={mockCert()} onCancel={vi.fn()} onExport={vi.fn()} exporting />
      </UserProvider>,
    );
    const btn = screen.getByRole('button', { name: /generando/i });
    expect(btn).toBeDisabled();
  });
```

- [ ] **Step 2: Run, confirm fails**

```bash
cd /Users/llam/dev/araguaney_front
pnpm test components/certificates/cert-header.test.tsx
```

Expected: 4 new failures (button not rendered).

- [ ] **Step 3: Implement**

Replace the entire contents of `/Users/llam/dev/araguaney_front/components/certificates/cert-header.tsx` with:

```tsx
'use client';

import Link from 'next/link';
import { fmtDate } from '@/lib/format/date';
import { hasPermission } from '@/lib/permissions/has-permission';
import { useUser } from '@/lib/auth/user-context';
import type { CertificateDetail } from '@/lib/types/certificate';
import { CertificateStatusPill } from './certificate-status-pill';

interface Props {
  cert: CertificateDetail;
  onCancel: () => void;
  onExport?: () => void;
  exporting?: boolean;
}

export function CertHeader({ cert, onCancel, onExport, exporting = false }: Props) {
  const user = useUser();
  const canCancel = hasPermission(user.role, 'certificate.cancel') && cert.status === 'issued';

  return (
    <div>
      <div className="text-text-3 mb-2 text-[12px]">
        <Link href="/" className="hover:underline">
          Operación
        </Link>{' '}
        ·{' '}
        <Link href="/certificates" className="hover:underline">
          Certificados
        </Link>{' '}
        · <b className="text-text-2 font-mono font-medium">{cert.certificate_code}</b>
      </div>
      <div className="flex items-start justify-between gap-4">
        <div>
          <div className="mb-2 flex items-center gap-3">
            <h1 className="text-[22px] font-semibold tracking-[-0.3px]">
              {cert.investor.legal_name}
            </h1>
            <span className="bg-subtle text-text-2 rounded-md px-2 py-0.5 font-mono text-[12px]">
              {cert.certificate_code}
            </span>
            <CertificateStatusPill status={cert.status} />
          </div>
          <div className="text-text-3 text-[12px]">
            Emitido {fmtDate(cert.issue_date)} por {cert.issued_by.full_name} ·{' '}
            <span className="font-mono">{cert.investor.rif}</span>
          </div>
        </div>
        <div className="flex items-center gap-2">
          {onExport && (
            <button
              type="button"
              onClick={onExport}
              disabled={exporting}
              className="border-border-subtle bg-card text-text-2 hover:bg-subtle rounded-md border px-4 py-2 text-[12px] font-medium disabled:opacity-40"
            >
              {exporting ? 'Generando…' : 'Exportar Excel'}
            </button>
          )}
          {canCancel && (
            <button
              type="button"
              onClick={onCancel}
              className="border-border-subtle bg-card text-text-2 hover:bg-subtle rounded-md border px-4 py-2 text-[12px] font-medium"
            >
              Cancelar certificado
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
```

- [ ] **Step 4: Pass + verify**

```bash
cd /Users/llam/dev/araguaney_front
pnpm test components/certificates/cert-header.test.tsx
pnpm typecheck && pnpm lint:check && pnpm test && pnpm format:check
```

All clean. The existing 5 tests still pass because `onExport` is optional and Cancelar button still renders identically.

- [ ] **Step 5: Commit**

```bash
cd /Users/llam/dev/araguaney_front
git add components/certificates/cert-header.tsx components/certificates/cert-header.test.tsx
git commit -m "$(cat <<'EOF'
feat(certificates): Exportar Excel button in CertHeader

Optional onExport + exporting props. Button visible to all roles
(read-only action). Shows "Generando…" disabled state while pending.

Co-Authored-By: Claude Opus 4.7 <noreply@anthropic.com>
EOF
)"
```

---

## Task 4: Wire export handler in `<CertificateDetailPage>`

**Why:** The detail page lazy-imports the helper + file-saver, builds the file, triggers download, manages exporting state, surfaces toast on outcome.

**Files:**
- Modify: `components/certificates/certificate-detail-page.tsx`
- Modify: `components/certificates/certificate-detail-page.test.tsx`

- [ ] **Step 1: Failing test (append)**

Append inside the existing `describe('<CertificateDetailPage />', ...)` block in `/Users/llam/dev/araguaney_front/components/certificates/certificate-detail-page.test.tsx`:

```tsx
  it('clicking Exportar Excel triggers the helper + saveAs', async () => {
    mockGet.mockResolvedValueOnce(mockCert());
    wrap(<CertificateDetailPage id="c-1" />);
    await waitFor(() =>
      expect(
        screen.getByRole('button', { name: /exportar excel/i }),
      ).toBeInTheDocument(),
    );
    fireEvent.click(screen.getByRole('button', { name: /exportar excel/i }));
    await waitFor(() => expect(mockGenerate).toHaveBeenCalled());
    await waitFor(() => expect(mockSaveAs).toHaveBeenCalled());
    const [_, filename] = mockSaveAs.mock.calls[0];
    expect(filename).toMatch(/Certificado_C4572A.*\.xlsx/);
  });
```

This new test references `mockGenerate` and `mockSaveAs`. At the top of the file, **extend the existing `vi.hoisted` block** and `vi.mock` calls:

```tsx
const { mockGet, mockGenerate, mockSaveAs } = vi.hoisted(() => ({
  mockGet: vi.fn(),
  mockGenerate: vi.fn(),
  mockSaveAs: vi.fn(),
}));

vi.mock('@/lib/api/certificates', () => ({
  getCertificateDetail: (...a: unknown[]) => mockGet(...a),
  cancelCertificate: vi.fn(),
}));

vi.mock('@/lib/export/certificate-excel', () => ({
  generateCertificateExcel: (...a: unknown[]) => mockGenerate(...a),
}));

vi.mock('file-saver', () => ({
  saveAs: (...a: unknown[]) => mockSaveAs(...a),
}));

vi.mock('sonner', () => ({
  toast: { success: vi.fn(), error: vi.fn() },
}));
```

Set the default mock behavior in the existing `beforeEach`:

```tsx
  beforeEach(() => {
    vi.clearAllMocks();
    mockGenerate.mockResolvedValue(new Blob(['fake-xlsx'], { type: 'application/octet-stream' }));
  });
```

(If `beforeEach` doesn't exist yet, add one immediately after the outer `describe(...)` opener.)

- [ ] **Step 2: Confirm fails**

```bash
cd /Users/llam/dev/araguaney_front
pnpm test components/certificates/certificate-detail-page.test.tsx
```

Expected: the new test fails (helper isn't wired).

- [ ] **Step 3: Implement**

Replace the entire contents of `/Users/llam/dev/araguaney_front/components/certificates/certificate-detail-page.tsx` with:

```tsx
'use client';

import { useState } from 'react';
import Link from 'next/link';
import { useQuery } from '@tanstack/react-query';
import { toast } from 'sonner';
import { getCertificateDetail } from '@/lib/api/certificates';
import { CertHeader } from './cert-header';
import { CertHeroStrip } from './cert-hero-strip';
import { CertOrdersTable } from './cert-orders-table';
import { CertAuditSidebar } from './cert-audit-sidebar';
import { CancelCertModal } from './cancel-cert-modal';

interface Props {
  id: string;
}

export function CertificateDetailPage({ id }: Props) {
  const [cancelOpen, setCancelOpen] = useState(false);
  const [exporting, setExporting] = useState(false);
  const { data, isLoading, isError } = useQuery({
    queryKey: ['certificate', id],
    queryFn: () => getCertificateDetail(id),
    staleTime: 30 * 1000,
  });

  async function handleExport() {
    if (!data || exporting) return;
    setExporting(true);
    try {
      const [{ generateCertificateExcel }, { saveAs }] = await Promise.all([
        import('@/lib/export/certificate-excel'),
        import('file-saver'),
      ]);
      const blob = await generateCertificateExcel(data);
      const filename = `Certificado_${data.certificate_code}_${data.issue_date}.xlsx`;
      saveAs(blob, filename);
      toast.success('Excel exportado');
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'No se pudo generar el archivo');
    } finally {
      setExporting(false);
    }
  }

  if (isLoading) {
    return (
      <div className="mx-auto w-full max-w-[1440px] px-9 py-7">
        <div className="text-text-3 py-24 text-center text-sm">Cargando certificado…</div>
      </div>
    );
  }

  if (isError || !data) {
    return (
      <div className="mx-auto w-full max-w-[1440px] px-9 py-7">
        <div className="border-border-subtle bg-card flex flex-col items-center gap-3 rounded-xl border py-24">
          <div className="text-text-2 text-sm">Certificado no encontrado.</div>
          <Link
            href="/certificates"
            className="border-border-subtle rounded border px-3 py-1 text-[12px]"
          >
            Volver al listado
          </Link>
        </div>
      </div>
    );
  }

  return (
    <div className="mx-auto w-full max-w-[1440px] px-9 py-7">
      <CertHeader
        cert={data}
        onCancel={() => setCancelOpen(true)}
        onExport={handleExport}
        exporting={exporting}
      />
      <div className="mt-5 flex flex-col gap-5">
        <CertHeroStrip cert={data} />
        <div className="grid grid-cols-1 gap-5 md:grid-cols-[1fr_320px]">
          <CertOrdersTable orders={data.orders} />
          <CertAuditSidebar cert={data} />
        </div>
      </div>
      {cancelOpen && (
        <CancelCertModal
          certId={data.id}
          certCode={data.certificate_code}
          orderCount={data.orders.length}
          onClose={() => setCancelOpen(false)}
        />
      )}
    </div>
  );
}
```

- [ ] **Step 4: Pass + verify**

```bash
cd /Users/llam/dev/araguaney_front
pnpm test components/certificates/certificate-detail-page.test.tsx
pnpm typecheck && pnpm lint:check && pnpm test && pnpm format:check
```

- [ ] **Step 5: Commit**

```bash
cd /Users/llam/dev/araguaney_front
git add components/certificates/certificate-detail-page.tsx components/certificates/certificate-detail-page.test.tsx
git commit -m "$(cat <<'EOF'
feat(certificates): wire Excel export from detail page

Lazy-imports the helper module + file-saver only on click. Manages
exporting state for the button's disabled/Generando label. Surfaces
toast on success or failure.

Co-Authored-By: Claude Opus 4.7 <noreply@anthropic.com>
EOF
)"
```

---

## Task 5: New "PRIMER VTO" card in `<CertHeroStrip>`

**Files:**
- Modify: `components/certificates/cert-hero-strip.tsx`
- Modify: `components/certificates/cert-hero-strip.test.tsx`

- [ ] **Step 1: Failing tests (append)**

Append inside the existing `describe('<CertHeroStrip />', ...)` in `/Users/llam/dev/araguaney_front/components/certificates/cert-hero-strip.test.tsx`:

```tsx
  it('renders PRIMER VTO card with the earliest order due date and its code', () => {
    render(
      <CertHeroStrip
        cert={mockCert({
          orders: [
            {
              id: 'o-1',
              external_order_id: '99999999',
              merchant: { id: 'm-1', current_name: 'A', rif: 'J-1' },
              purchase_date: '2026-04-01',
              max_due_date: '2026-05-15',
              installments_sum_snapshot: '100.00',
              assigned_at: '2026-04-27T14:30:00Z',
              installments: [],
            },
            {
              id: 'o-2',
              external_order_id: '85657474',
              merchant: { id: 'm-2', current_name: 'B', rif: 'J-2' },
              purchase_date: '2026-04-01',
              max_due_date: '2026-05-03',
              installments_sum_snapshot: '50.00',
              assigned_at: '2026-04-27T14:30:00Z',
              installments: [],
            },
          ],
        })}
      />,
    );
    expect(screen.getByText('PRIMER VTO')).toBeInTheDocument();
    expect(screen.getByText('03/05/2026')).toBeInTheDocument();
    expect(screen.getByText('orden #85657474')).toBeInTheDocument();
  });

  it('shows dash and "sin órdenes" when pool is empty', () => {
    render(<CertHeroStrip cert={mockCert({ orders: [] })} />);
    expect(screen.getByText('PRIMER VTO')).toBeInTheDocument();
    expect(screen.getByText('—')).toBeInTheDocument();
    expect(screen.getByText('sin órdenes')).toBeInTheDocument();
  });

  it('keeps the original 5 cards visible alongside PRIMER VTO', () => {
    render(<CertHeroStrip cert={mockCert()} />);
    expect(screen.getByText('CAPITAL')).toBeInTheDocument();
    expect(screen.getByText('TASA')).toBeInTheDocument();
    expect(screen.getByText('PLAZO')).toBeInTheDocument();
    expect(screen.getByText('COMPOSICIÓN')).toBeInTheDocument();
    expect(screen.getByText('ESTADO')).toBeInTheDocument();
    expect(screen.getByText('PRIMER VTO')).toBeInTheDocument();
  });
```

- [ ] **Step 2: Fails**

```bash
cd /Users/llam/dev/araguaney_front
pnpm test components/certificates/cert-hero-strip.test.tsx
```

- [ ] **Step 3: Implement**

Replace `/Users/llam/dev/araguaney_front/components/certificates/cert-hero-strip.tsx` with:

```tsx
import { fmtMoney2 } from '@/lib/format/money';
import { fmtPct } from '@/lib/format/percent';
import { fmtDate } from '@/lib/format/date';
import { daysSince } from '@/lib/format/cycle-day';
import type { CertificateDetail, CertificateOrder } from '@/lib/types/certificate';

interface Props {
  cert: CertificateDetail;
}

function firstMaturityOrder(orders: CertificateOrder[]): CertificateOrder | null {
  if (orders.length === 0) return null;
  return orders.reduce(
    (acc, o) => (o.max_due_date < acc.max_due_date ? o : acc),
    orders[0],
  );
}

export function CertHeroStrip({ cert }: Props) {
  const merchantCount = new Set(cert.orders.map((o) => o.merchant.id)).size;
  const yieldFormatted = `${fmtMoney2(Number(cert.investor_yield))} al vencimiento`;
  const residualSub = `residual ${fmtMoney2(Number(cert.investor_returned))}`;
  const day = daysSince(cert.issue_date);
  const firstMat = firstMaturityOrder(cert.orders);

  let statusLabel = '';
  let statusSub = '';
  if (cert.status === 'issued') {
    statusLabel = '● Activo';
    statusSub = `día ${day} de ${cert.term_days}`;
  } else if (cert.status === 'matured') {
    statusLabel = '● Vencido';
    statusSub = `vencido ${fmtDate(cert.maturity_date)}`;
  } else if (cert.status === 'cancelled') {
    statusLabel = '● Cancelado';
    const at = cert.cancellation?.cancelled_at ?? cert.created_at;
    statusSub = `cancelado ${fmtDate(at)}`;
  } else {
    statusLabel = '● Borrador';
    statusSub = '';
  }

  return (
    <div className="bg-card border-border-subtle grid grid-cols-2 gap-4 rounded-xl border p-5 md:grid-cols-3 lg:grid-cols-6">
      <Card label="CAPITAL" value={fmtMoney2(Number(cert.investor_capital))} sub={residualSub} />
      <Card label="TASA" value={fmtPct(cert.annual_rate)} sub={yieldFormatted} />
      <Card
        label="PLAZO"
        value={`${cert.term_days}d`}
        sub={`vence ${fmtDate(cert.maturity_date)}`}
      />
      <Card
        label="COMPOSICIÓN"
        value={String(cert.orders.length)}
        sub={`órdenes · ${merchantCount} comercios`}
      />
      <Card label="ESTADO" value={statusLabel} sub={statusSub} />
      <Card
        label="PRIMER VTO"
        value={firstMat ? fmtDate(firstMat.max_due_date) : '—'}
        sub={firstMat ? `orden #${firstMat.external_order_id}` : 'sin órdenes'}
      />
    </div>
  );
}

function Card({ label, value, sub }: { label: string; value: string; sub: string }) {
  return (
    <div>
      <div className="text-text-3 mb-1 text-[10px] uppercase tracking-wide">{label}</div>
      <div className="text-[20px] font-semibold tabular-nums tracking-[-0.3px]">{value}</div>
      <div className="text-text-3 mt-0.5 text-[11px] tabular-nums">{sub}</div>
    </div>
  );
}
```

- [ ] **Step 4: Pass + verify**

```bash
cd /Users/llam/dev/araguaney_front
pnpm test components/certificates/cert-hero-strip.test.tsx
pnpm typecheck && pnpm lint:check && pnpm test && pnpm format:check
```

- [ ] **Step 5: Commit**

```bash
cd /Users/llam/dev/araguaney_front
git add components/certificates/cert-hero-strip.tsx components/certificates/cert-hero-strip.test.tsx
git commit -m "$(cat <<'EOF'
feat(certificates): PRIMER VTO card in hero strip

Sixth card showing the earliest order due date in the pool, with the
external_order_id as sub-label. Responsive: 2 cols mobile, 3 md, 6 lg.

Co-Authored-By: Claude Opus 4.7 <noreply@anthropic.com>
EOF
)"
```

---

## Task 6: New "DETALLE FINANCIERO" block in `<CertAuditSidebar>`

**Files:**
- Modify: `components/certificates/cert-audit-sidebar.tsx`
- Modify: `components/certificates/cert-audit-sidebar.test.tsx`

- [ ] **Step 1: Failing tests (append)**

Append inside the existing `describe('<CertAuditSidebar />', ...)` in `/Users/llam/dev/araguaney_front/components/certificates/cert-audit-sidebar.test.tsx`:

```tsx
  it('renders DETALLE FINANCIERO block with all financial fields', () => {
    render(<CertAuditSidebar cert={mockCert()} />);
    expect(screen.getByText('DETALLE FINANCIERO')).toBeInTheDocument();
    expect(screen.getByText('Precio')).toBeInTheDocument();
    expect(screen.getByText('Nominal objetivo')).toBeInTheDocument();
    expect(screen.getByText('Nominal real')).toBeInTheDocument();
    expect(screen.getByText('Pagado por inversor')).toBeInTheDocument();
    expect(screen.getByText('Residual')).toBeInTheDocument();
    expect(screen.getByText('Rendimiento')).toBeInTheDocument();
    expect(screen.getByText('Shortfall')).toBeInTheDocument();
    expect(screen.getByText('Primer vencimiento')).toBeInTheDocument();
    // sample value formatting
    expect(screen.getByText('0.984833')).toBeInTheDocument();
    expect(screen.getByText('$101,540.60')).toBeInTheDocument();
  });

  it('shows "—" for primer vencimiento when pool is empty', () => {
    render(<CertAuditSidebar cert={mockCert({ orders: [] })} />);
    expect(screen.getByText('Primer vencimiento')).toBeInTheDocument();
    // The "—" appears next to the "Primer vencimiento" label
    const primerVtoRow = screen.getByText('Primer vencimiento').parentElement!;
    expect(primerVtoRow.textContent).toContain('—');
  });
```

- [ ] **Step 2: Fails**

```bash
cd /Users/llam/dev/araguaney_front
pnpm test components/certificates/cert-audit-sidebar.test.tsx
```

- [ ] **Step 3: Implement**

Replace `/Users/llam/dev/araguaney_front/components/certificates/cert-audit-sidebar.tsx` with:

```tsx
import { fmtDate } from '@/lib/format/date';
import { fmtMoney2 } from '@/lib/format/money';
import { fmtPct } from '@/lib/format/percent';
import type {
  CertificateDetail,
  CertificateEvent,
  CertificateOrder,
} from '@/lib/types/certificate';

interface Props {
  cert: CertificateDetail;
}

const EVENT_LIMIT = 10;

function firstMaturity(orders: CertificateOrder[]): string | null {
  if (orders.length === 0) return null;
  return orders.reduce(
    (acc, o) => (o.max_due_date < acc ? o.max_due_date : acc),
    orders[0].max_due_date,
  );
}

export function CertAuditSidebar({ cert }: Props) {
  const events = cert.events.slice(0, EVENT_LIMIT);
  const fm = firstMaturity(cert.orders);
  return (
    <div className="flex flex-col gap-6">
      <Block title="INVERSOR">
        <KV k="Razón social" v={cert.investor.legal_name} />
        <KV k="RIF" v={cert.investor.rif} mono last />
      </Block>

      <Block title="DETALLE FINANCIERO">
        <KV k="Precio" v={cert.price} />
        <KV k="Nominal objetivo" v={fmtMoney2(Number(cert.nominal_target))} />
        <KV k="Nominal real" v={fmtMoney2(Number(cert.nominal_actual))} />
        <KV k="Pagado por inversor" v={fmtMoney2(Number(cert.investor_paid))} />
        <KV k="Residual" v={fmtMoney2(Number(cert.investor_returned))} />
        <KV k="Rendimiento" v={fmtMoney2(Number(cert.investor_yield))} />
        <KV k="Shortfall" v={fmtPct(cert.shortfall_pct, 4)} />
        <KV k="Primer vencimiento" v={fm ? fmtDate(fm) : '—'} last />
      </Block>

      <Block title="REGLAS VERIFICADAS">
        <KV k="Vencimientos ≤ certificado" v={<Check />} />
        <KV k="Órdenes indivisibles" v={<Check />} />
        <KV k="Redondeo hacia abajo" v={<Check />} last />
      </Block>

      <Block title="AUDITORÍA">
        {events.length === 0 ? (
          <div className="text-text-3 py-2 text-[11px] italic">Sin eventos registrados.</div>
        ) : (
          events.map((e, i) => <EventRow key={e.id} event={e} last={i === events.length - 1} />)
        )}
      </Block>
    </div>
  );
}

function Block({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="bg-card border-border-subtle rounded-lg border p-4">
      <div className="text-text-3 mb-3 text-[10px] uppercase tracking-wide">{title}</div>
      {children}
    </div>
  );
}

function KV({
  k,
  v,
  mono = false,
  last = false,
}: {
  k: string;
  v: React.ReactNode;
  mono?: boolean;
  last?: boolean;
}) {
  return (
    <div
      className={
        'flex items-center justify-between gap-3 py-1.5 text-[12px] ' +
        (last ? '' : 'border-border-soft border-b')
      }
    >
      <span className="text-text-3">{k}</span>
      <span className={'text-text-2 font-medium tabular-nums ' + (mono ? 'font-mono' : '')}>
        {v}
      </span>
    </div>
  );
}

function Check() {
  return <span className="text-green-text text-[14px]">✓</span>;
}

function EventRow({ event, last }: { event: CertificateEvent; last: boolean }) {
  return (
    <div className={'flex gap-3 py-2 ' + (last ? '' : 'border-border-soft border-b')}>
      <div className="bg-text-3 mt-2 h-1.5 w-1.5 flex-shrink-0 rounded-full" />
      <div className="text-[11px] leading-snug">
        <div>
          <b className="text-text-2 font-medium">{event.event_type}</b>
        </div>
        <div className="text-text-3 tabular-nums mt-0.5 text-[10px]">
          {fmtDate(event.occurred_at)}
        </div>
      </div>
    </div>
  );
}
```

- [ ] **Step 4: Pass + verify**

```bash
cd /Users/llam/dev/araguaney_front
pnpm test components/certificates/cert-audit-sidebar.test.tsx
pnpm typecheck && pnpm lint:check && pnpm test && pnpm format:check
```

- [ ] **Step 5: Commit**

```bash
cd /Users/llam/dev/araguaney_front
git add components/certificates/cert-audit-sidebar.tsx components/certificates/cert-audit-sidebar.test.tsx
git commit -m "$(cat <<'EOF'
feat(certificates): DETALLE FINANCIERO block in sidebar

Eight fields between INVERSOR and REGLAS VERIFICADAS: precio, nominal
objetivo/real, pagado por inversor, residual, rendimiento, shortfall,
primer vencimiento. All numbers in one place for auditor view.

Co-Authored-By: Claude Opus 4.7 <noreply@anthropic.com>
EOF
)"
```

---

## Task 7: Paginate `<CertOrdersTable>`

**Files:**
- Modify: `components/certificates/cert-orders-table.tsx`
- Modify: `components/certificates/cert-orders-table.test.tsx`

- [ ] **Step 1: Failing tests (append)**

Append inside the existing `describe('<CertOrdersTable />', ...)` in `/Users/llam/dev/araguaney_front/components/certificates/cert-orders-table.test.tsx`:

```tsx
  it('paginates 100 orders to 2 pages of 50', () => {
    const many: CertificateOrder[] = Array.from({ length: 100 }, (_, i) => ({
      id: `o-${i}`,
      external_order_id: String(10_000_000 + i),
      merchant: { id: `m-${i}`, current_name: `Comercio ${i}`, rif: `J-${i}` },
      purchase_date: '2026-03-18',
      max_due_date: '2026-04-03',
      installments_sum_snapshot: '50.0000',
      assigned_at: '2026-04-27T14:30:00Z',
      installments: [
        { installment_number: 1, amount: '50.00', due_date: '2026-04-03', status: 'pending' },
      ],
    }));
    render(<CertOrdersTable orders={many} />);
    expect(screen.getByText(/mostrando 1[–-]50 de 100/i)).toBeInTheDocument();
    // first page shows orders 0..49
    expect(screen.getByText('10000000')).toBeInTheDocument();
    expect(screen.queryByText('10000050')).not.toBeInTheDocument();
  });

  it('prev/next buttons navigate pages', () => {
    const many: CertificateOrder[] = Array.from({ length: 60 }, (_, i) => ({
      id: `o-${i}`,
      external_order_id: String(20_000_000 + i),
      merchant: { id: `m-${i}`, current_name: `C ${i}`, rif: `J-${i}` },
      purchase_date: '2026-03-18',
      max_due_date: '2026-04-03',
      installments_sum_snapshot: '10.0000',
      assigned_at: '2026-04-27T14:30:00Z',
      installments: [],
    }));
    render(<CertOrdersTable orders={many} />);
    expect(screen.getByLabelText(/p[aá]gina anterior/i)).toBeDisabled();
    fireEvent.click(screen.getByLabelText(/p[aá]gina siguiente/i));
    expect(screen.getByText(/mostrando 51[–-]60 de 60/i)).toBeInTheDocument();
    expect(screen.getByLabelText(/p[aá]gina siguiente/i)).toBeDisabled();
    expect(screen.getByText('20000050')).toBeInTheDocument();
  });

  it('pool total is calculated over the filtered set (not just current page)', () => {
    const many: CertificateOrder[] = Array.from({ length: 60 }, (_, i) => ({
      id: `o-${i}`,
      external_order_id: String(30_000_000 + i),
      merchant: { id: `m-${i}`, current_name: `C ${i}`, rif: `J-${i}` },
      purchase_date: '2026-03-18',
      max_due_date: '2026-04-03',
      installments_sum_snapshot: '100.0000',
      assigned_at: '2026-04-27T14:30:00Z',
      installments: [
        { installment_number: 1, amount: '100.00', due_date: '2026-04-03', status: 'pending' },
      ],
    }));
    render(<CertOrdersTable orders={many} />);
    // Page 1 shows 50 rows but total reflects 60 orders × $100 = $6,000
    expect(screen.getByText(/total del pool.*\$6,000\.00.*60 [oó]rdenes.*60 cuotas/i)).toBeInTheDocument();
  });

  it('changing the filter resets page to 0', () => {
    const many: CertificateOrder[] = Array.from({ length: 60 }, (_, i) => ({
      id: `o-${i}`,
      external_order_id: String(40_000_000 + i),
      merchant: { id: `m-${i}`, current_name: i < 5 ? 'CANALETTO' : `Otro ${i}`, rif: `J-${i}` },
      purchase_date: '2026-03-18',
      max_due_date: '2026-04-03',
      installments_sum_snapshot: '10.0000',
      assigned_at: '2026-04-27T14:30:00Z',
      installments: [],
    }));
    render(<CertOrdersTable orders={many} />);
    fireEvent.click(screen.getByLabelText(/p[aá]gina siguiente/i));
    expect(screen.getByText(/mostrando 51[–-]60 de 60/i)).toBeInTheDocument();
    fireEvent.change(screen.getByPlaceholderText(/id o comercio/i), {
      target: { value: 'canaletto' },
    });
    // 5 matches, all visible on page 0
    expect(screen.getByText(/mostrando 1[–-]5 de 5/i)).toBeInTheDocument();
  });
```

Also at the top of the test file, ensure `fireEvent` is imported and `CertificateOrder` is imported (they likely already are; verify and add if missing).

- [ ] **Step 2: Fails**

```bash
cd /Users/llam/dev/araguaney_front
pnpm test components/certificates/cert-orders-table.test.tsx
```

Expected: 4 new failures (no pagination yet).

- [ ] **Step 3: Implement**

Replace `/Users/llam/dev/araguaney_front/components/certificates/cert-orders-table.tsx` with:

```tsx
'use client';

import { useEffect, useMemo, useState } from 'react';
import { fmtDate } from '@/lib/format/date';
import { fmtMoney2 } from '@/lib/format/money';
import type { CertificateOrder } from '@/lib/types/certificate';

interface Props {
  orders: CertificateOrder[];
}

const PAGE_SIZE = 50;

export function CertOrdersTable({ orders }: Props) {
  const [q, setQ] = useState('');
  const [page, setPage] = useState(0);

  const filtered = useMemo(() => {
    if (!q.trim()) return orders;
    const needle = q.toLowerCase().trim();
    return orders.filter(
      (o) =>
        o.external_order_id.toLowerCase().includes(needle) ||
        o.merchant.current_name.toLowerCase().includes(needle),
    );
  }, [orders, q]);

  // Reset page when filter or orders change
  useEffect(() => {
    setPage(0);
  }, [q, orders]);

  if (orders.length === 0) {
    return (
      <div className="border-border-subtle bg-card flex h-48 items-center justify-center rounded-xl border">
        <div className="text-text-3 text-sm">Sin órdenes en este pool.</div>
      </div>
    );
  }

  const totalAmount = filtered.reduce((acc, o) => acc + Number(o.installments_sum_snapshot), 0);
  const totalInstallments = filtered.reduce((acc, o) => acc + o.installments.length, 0);

  const totalPages = Math.max(1, Math.ceil(filtered.length / PAGE_SIZE));
  const safePage = Math.min(page, totalPages - 1);
  const start = filtered.length === 0 ? 0 : safePage * PAGE_SIZE + 1;
  const end = Math.min((safePage + 1) * PAGE_SIZE, filtered.length);
  const paginated = filtered.slice(safePage * PAGE_SIZE, (safePage + 1) * PAGE_SIZE);
  const hasPrev = safePage > 0;
  const hasNext = safePage < totalPages - 1;

  return (
    <div className="bg-card border-border-subtle overflow-hidden rounded-xl border">
      <div className="border-border-subtle flex items-center gap-3 border-b px-4 py-3">
        <input
          type="search"
          placeholder="🔎 ID o comercio"
          value={q}
          onChange={(e) => setQ(e.target.value)}
          className="border-border-subtle bg-card flex-1 rounded-md border px-3 py-1.5 text-[12px]"
        />
        <span className="text-text-3 text-[11px]">
          {filtered.length} de {orders.length}
        </span>
      </div>
      <table className="w-full text-[12px]">
        <thead className="bg-subtle">
          <tr>
            <Th>ID</Th>
            <Th>Comercio</Th>
            <Th align="right">Cuotas</Th>
            <Th>Compra</Th>
            <Th>Últ. vence</Th>
            <Th align="right">Monto</Th>
          </tr>
        </thead>
        <tbody>
          {paginated.map((o) => (
            <tr key={o.id} className="border-border-soft hover:bg-subtle border-b">
              <td className="text-text-2 px-4 py-3 font-mono text-[11.5px]">
                {o.external_order_id}
              </td>
              <td className="max-w-[260px] truncate px-4 py-3" title={o.merchant.current_name}>
                {o.merchant.current_name}
              </td>
              <td className="num px-4 py-3 text-right">{o.installments.length}</td>
              <td className="num px-4 py-3">{fmtDate(o.purchase_date)}</td>
              <td className="num px-4 py-3">{fmtDate(o.max_due_date)}</td>
              <td className="num px-4 py-3 text-right font-medium">
                {fmtMoney2(Number(o.installments_sum_snapshot))}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
      <div className="border-border-subtle flex items-center justify-between border-t px-4 py-3 text-[11.5px]">
        <span className="text-text-3 tabular-nums">
          Mostrando {start}–{end} de {filtered.length.toLocaleString('en-US')}
        </span>
        <div className="flex items-center gap-2">
          <button
            type="button"
            aria-label="Página anterior"
            disabled={!hasPrev}
            onClick={() => setPage((p) => Math.max(0, p - 1))}
            className="border-border-subtle rounded border px-2 py-1 text-[11px] disabled:opacity-40"
          >
            ←
          </button>
          <button
            type="button"
            aria-label="Página siguiente"
            disabled={!hasNext}
            onClick={() => setPage((p) => p + 1)}
            className="border-border-subtle rounded border px-2 py-1 text-[11px] disabled:opacity-40"
          >
            →
          </button>
        </div>
      </div>
      <div className="bg-subtle border-border-subtle border-t px-4 py-3 text-[11.5px]">
        <span className="font-medium">Total del pool: </span>
        <span className="tabular-nums">
          {fmtMoney2(totalAmount)} · {filtered.length} órdenes · {totalInstallments} cuotas
        </span>
      </div>
    </div>
  );
}

function Th({ children, align = 'left' }: { children: React.ReactNode; align?: 'left' | 'right' }) {
  const alignClass = align === 'right' ? 'text-right' : 'text-left';
  return (
    <th
      className={`text-text-3 border-border-subtle border-b px-4 py-2 ${alignClass} text-[9.5px] font-medium tracking-[0.7px] uppercase`}
    >
      {children}
    </th>
  );
}
```

- [ ] **Step 4: Pass + verify**

```bash
cd /Users/llam/dev/araguaney_front
pnpm test components/certificates/cert-orders-table.test.tsx
pnpm typecheck && pnpm lint:check && pnpm test && pnpm format:check
```

All clean. Existing 3 tests still pass (they use ≤2 orders, all visible on page 0).

- [ ] **Step 5: Commit**

```bash
cd /Users/llam/dev/araguaney_front
git add components/certificates/cert-orders-table.tsx components/certificates/cert-orders-table.test.tsx
git commit -m "$(cat <<'EOF'
feat(certificates): paginate orders pool table

Client-side pagination over the filtered set: 50 per page. Prev/next
buttons with aria-labels and disabled state at boundaries. Total
remains over the FULL filtered set so the bottom row reflects real
aggregates while paginating. Filter or orders-prop change resets to
page 0.

Co-Authored-By: Claude Opus 4.7 <noreply@anthropic.com>
EOF
)"
```

---

## Task 8: Local smoke + build verification

**Files:** none (verification only).

- [ ] **Step 1: Run full suite + build**

```bash
cd /Users/llam/dev/araguaney_front
pnpm typecheck && pnpm lint:check && pnpm test && pnpm format:check && pnpm build
```

All five must pass. The `pnpm build` step verifies that the new lazy import boundaries don't break (Next.js may complain about dynamic-imported modules referenced in client components — they shouldn't, but verify).

- [ ] **Step 2: Boot dev + smoke**

```bash
cd /Users/llam/dev/araguaney_front
lsof -ti:3000 | xargs kill -9 2>/dev/null
pnpm dev > /tmp/front-task8.log 2>&1 &
PID=$!
for i in 1 2 3 4 5 6 7 8 9 10 11 12 13 14 15 16 17 18 19 20; do
  if grep -q "Ready in" /tmp/front-task8.log 2>/dev/null; then echo "ready in ${i}s"; break; fi
  sleep 1
done

# Auth gate still works
curl -s -o /dev/null -w "%{http_code} %{redirect_url}\n" http://localhost:3000/certificates
curl -s -o /dev/null -w "%{http_code} %{redirect_url}\n" http://localhost:3000/certificates/some-id

# Stop
kill $PID 2>/dev/null
wait $PID 2>/dev/null
```

Both curl outputs expected: `307` → `/login`.

- [ ] **Step 3: Visual smoke (manual, post-deploy)**

Document for the user:

1. Login operator → emit a cert via wizard (Slice 4 flow).
2. Navigate to `/certificates` → click the row → land on detail.
3. **Hero strip**: verify 6 cards on a wide screen, last one is **PRIMER VTO** with a date + `orden #XXXX`.
4. **Sidebar**: verify the new **DETALLE FINANCIERO** block between INVERSOR and REGLAS VERIFICADAS, with all 8 fields.
5. **Orders table**: scroll to bottom → footer shows `Mostrando 1–N de N` + paginator buttons. For a cert with >50 orders, navigate pages.
6. **Header**: click **Exportar Excel** → button shows "Generando…" briefly → file downloads as `Certificado_CXXXX_YYYY-MM-DD.xlsx`. Open it: two sheets, money/date/percent formatted correctly.
7. Login as auditor → detail page still loads → **Exportar Excel** visible; **Cancelar certificado** hidden.

- [ ] **Step 4: No commit**

---

## Task 9: Push branch + open PR

**Files:** none.

- [ ] **Step 1: Push**

```bash
cd /Users/llam/dev/araguaney_front
git push -u origin feat/slice-7-cert-improvements
```

- [ ] **Step 2: Open PR**

```bash
cd /Users/llam/dev/araguaney_front
gh pr create --title "feat: Slice 7 — /certificates detail improvements" --body "$(cat <<'EOF'
## Summary

Four targeted improvements to the certificate detail page after Slice 5 production use:

- **Exportar Excel** button in the detail header. Generates an XLSX with `Resumen` + `Órdenes` sheets via lazy-imported `exceljs` + `file-saver`. Visible to all roles.
- **Nueva card "PRIMER VTO"** en el hero strip con la fecha más temprana de `max_due_date` del pool y el código de la orden que la tiene.
- **Nuevo bloque "DETALLE FINANCIERO"** en el sidebar derecho con los 8 campos financieros (precio, nominal objetivo/real, pagado por inversor, residual, rendimiento, shortfall, primer vencimiento).
- **Paginación 50/página** en la tabla de órdenes del pool (client-side sobre el array embebido). Total del pool se mantiene sobre el set filtrado completo.

## What's new

- `lib/export/certificate-excel.ts` (+ test) — pure CertificateDetail → Blob helper
- `components/certificates/cert-header.tsx` — añadido botón Exportar
- `components/certificates/certificate-detail-page.tsx` — wired handler con lazy import
- `components/certificates/cert-hero-strip.tsx` — 6ª card
- `components/certificates/cert-audit-sidebar.tsx` — nuevo bloque
- `components/certificates/cert-orders-table.tsx` — paginación
- `package.json` — añade `exceljs`, `file-saver`, `@types/file-saver`

## Test Plan

- [x] `pnpm typecheck && pnpm lint:check && pnpm test && pnpm format:check && pnpm build` — todo clean
- [x] ~15 nuevos tests pasando
- [ ] Vercel preview renders sin console errors
- [ ] Detail page: 6 cards en hero, bloque DETALLE FINANCIERO visible, paginador en la tabla
- [ ] Export Excel descarga archivo válido con dos hojas, números/fechas formateados
- [ ] Auditor ve botón Exportar pero no Cancelar

## Notes

- Sin endpoint Excel en el back — todo client-side. La data ya viene en `GET /api/certificates/:id`.
- Sin hoja de cuotas individuales — agregable como hoja 3 si SUNAVAL lo pide.
- Bundle inicial sin cambios: `exceljs` y `file-saver` son dynamic imports que solo se cargan al hacer click.

🤖 Generated with [Claude Code](https://claude.com/claude-code)
EOF
)"
```

If `gh` fails on "must be a collaborator", surface the URL.

- [ ] **Step 3: Watch CI**

```bash
until gh run list --repo armandogois-lab/araguaney_front --limit 1 --json status -q '.[0].status' | grep -q completed; do sleep 5; done
gh run list --repo armandogois-lab/araguaney_front --limit 1
```

Expected: green ✓.

---

## Summary

**What's new**

- Excel export of cert detail (2 sheets, lazy-loaded libs).
- New PRIMER VTO card in hero.
- New DETALLE FINANCIERO block in sidebar.
- Pagination on orders pool table.
- 2 new files, 11 modifications, ~15 new tests.

**Test Plan**

- [x] `pnpm typecheck && pnpm lint:check && pnpm test && pnpm format:check && pnpm build` — todo clean

**Notes**

- Sin cambios al back; toda la data viene de `GET /api/certificates/:id`.
- `exceljs` y `file-saver` lazy-imported — no inflan el bundle inicial.

---

## Self-Review

**Spec coverage:**

- ✅ Excel export button + helper — Tasks 2-4
- ✅ PRIMER VTO card with date + order code — Task 5
- ✅ DETALLE FINANCIERO block in sidebar with 8 fields — Task 6
- ✅ Pagination on orders table 50/page — Task 7
- ✅ Total computed over full filtered set, not paginated subset — Task 7 (third test)
- ✅ Auditor sees Exportar — Task 3 second test
- ✅ Filter reset on page change — Task 7 fourth test
- ✅ Empty pool edge cases — Tasks 2, 5, 6 all cover this
- ✅ Lazy import of exceljs + file-saver — Task 4
- ✅ Smoke + PR — Tasks 8-9

**Placeholder scan:** No TODOs/TBDs. Step 3 of Task 8 is documentation for the user-driven post-deploy smoke flow, not implementation placeholder.

**Type consistency:**
- `CertificateDetail` consumed by helper (Task 2), header (Task 3), detail-page (Task 4), hero-strip (Task 5), sidebar (Task 6).
- `CertificateOrder` consumed by helper (Task 2), hero-strip (Task 5), sidebar (Task 6), orders-table (Task 7).
- `firstMaturity` helper signature identical in `certificate-excel.ts` and `cert-audit-sidebar.tsx` (`CertificateOrder[] → string | null`). `firstMaturityOrder` in `cert-hero-strip.tsx` returns `CertificateOrder | null` since the card sub-label needs the order code, not just the date.
- `onExport` prop in CertHeader matches the call site in CertificateDetailPage.
- `exporting` boolean prop matches the state variable.
- `PAGE_SIZE = 50` is unique to `cert-orders-table.tsx` (no shared constants needed).

---

**Plan complete and saved to `docs/superpowers/plans/2026-05-11-front-slice-7-certificates-improvements.md`. Two execution options:**

**1. Subagent-Driven (recommended)** — Fresh subagent per task + two-stage review.

**2. Inline Execution** — Same session with batch checkpoints.

**Which approach?**

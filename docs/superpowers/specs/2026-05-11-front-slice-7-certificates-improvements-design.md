# araguaney_front Slice 7 — `/certificates` detail improvements

**Date:** 2026-05-11
**Status:** Draft for implementation
**Spec for:** `araguaney_front`
**Prior slice:** Slice 5 — `/certificates` list + detail + cancel (merged); Slice 6 — `/investors` CRUD (merged)

## Goal

Four targeted improvements to the certificate detail page that operators asked for after using Slice 5 in production:

1. **Export to Excel** — button in detail header generates an XLSX with cert summary + orders pool.
2. **First maturity date card** — new hero strip card surfacing the earliest order due date and its order code.
3. **Financial detail block** — new sidebar block with all financial figures (price, nominal target/actual, paid, residual, yield, shortfall, first maturity) in one place for auditability.
4. **Paginate orders pool table** — currently renders all orders at once; some certs have hundreds.

No back changes. All data already returned by `GET /api/certificates/:id`. Excel generation is client-side.

## Scope (in)

- New "Exportar Excel" button in `<CertHeader>` (visible to all roles).
- New 6th card in `<CertHeroStrip>` for first maturity date.
- New "Detalle financiero" block in `<CertAuditSidebar>`.
- Pagination footer in `<CertOrdersTable>` (50 per page, client-side over the embedded `cert.orders[]` array).
- Dynamic import of `exceljs` + `file-saver` so the bundle penalty is paid only on click.

## Scope (out)

- No back endpoint for Excel — back has no excel-export route and the data fits comfortably in memory.
- No export of the `/certificates` list itself — list export is a separate decision and not asked for today.
- No PDF export — separate library, separate slice.
- No new global state — paginator state is local to `<CertOrdersTable>`.
- No installments-level hoja in the Excel — out of scope for v1. If SUNAVAL asks, add a third sheet later.
- No `/certificates/{code}` URL routing (still uses UUIDs).

## Architecture

```
<CertificateDetailPage>
  ├── <CertHeader>                       MODIFY: add "Exportar Excel" button
  ├── <CertHeroStrip>                    MODIFY: 5→6 cards (add PRIMER VTO)
  └── grid
        ├── <CertOrdersTable>            MODIFY: paginate (50/page client-side)
        └── <CertAuditSidebar>           MODIFY: add "Detalle financiero" block
```

Excel generation lives in a **new** helper `lib/export/certificate-excel.ts` that takes a `CertificateDetail` and returns a `Blob`. The detail page wires a handler. Lazy-imports `exceljs` and `file-saver` to keep the initial bundle clean.

## Dependencies

Add to `package.json`:

- `exceljs` (same library the back uses for Excel import — consistent stack).
- `file-saver` (tiny — 3KB — handles browser download).
- `@types/file-saver` as dev dep.

Both imported lazily — they don't ship in the initial bundle, only in a chunk loaded on first export click.

## Component changes

### `<CertHeader>` (modify)

Add a third action button between the breadcrumb/title block and the existing "Cancelar certificado" button. Visible to **all roles** (no permission gate — export is read-only).

```tsx
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
```

New props: `onExport?: () => void`, `exporting?: boolean`. Both optional so existing tests don't break.

### `<CertHeroStrip>` (modify)

Grid `md:grid-cols-5` → `grid-cols-2 md:grid-cols-3 lg:grid-cols-6`. Add a 6th card at the end:

```ts
const firstMaturityOrder = cert.orders
  .slice()
  .sort((a, b) => a.max_due_date.localeCompare(b.max_due_date))[0];

// Card content
<Card
  label="PRIMER VTO"
  value={firstMaturityOrder ? fmtDate(firstMaturityOrder.max_due_date) : '—'}
  sub={firstMaturityOrder ? `orden #${firstMaturityOrder.external_order_id}` : 'sin órdenes'}
/>
```

The sort is over `max_due_date` strings — ISO `YYYY-MM-DD` sorts correctly lexicographically. Use `.slice()` so we don't mutate `cert.orders`.

Empty pool: `value="—"`, `sub="sin órdenes"`. (Would only happen for malformed data in practice; defensive.)

### `<CertAuditSidebar>` (modify)

Insert a new `<Block title="DETALLE FINANCIERO">` between **INVERSOR** and **REGLAS VERIFICADAS**. Reuses the existing `<KV>` helper.

Fields and order:

| Label | Value source |
|---|---|
| Precio | `cert.price` (raw, no formatting beyond 4 decimals) |
| Nominal objetivo | `fmtMoney2(cert.nominal_target)` |
| Nominal real | `fmtMoney2(cert.nominal_actual)` |
| Pagado por inversor | `fmtMoney2(cert.investor_paid)` |
| Residual | `fmtMoney2(cert.investor_returned)` |
| Rendimiento | `fmtMoney2(cert.investor_yield)` |
| Shortfall | `fmtPct(cert.shortfall_pct)` |
| Primer vencimiento | min(orders.max_due_date) — duplicated from hero, intentional for auditor view |

If `cert.orders` is empty, "Primer vencimiento" shows `—`.

### `<CertOrdersTable>` (modify)

Add client-side pagination over the **filtered** set:

- `PAGE_SIZE = 50` constant.
- New local state `[page, setPage] = useState(0)`.
- `paginated = filtered.slice(page * PAGE_SIZE, (page + 1) * PAGE_SIZE)`.
- Render `<tbody>` from `paginated` (not `filtered`).
- New footer (or extend existing): `Mostrando N–M de total · {orders} órdenes · {installments} cuotas` + `← →` buttons with proper `aria-label`. The pool total (the bold "Total del pool: $X · N órdenes · M cuotas") is calculated over the **full filtered set**, not just the current page — operator sees real aggregates even while paginating.
- Filter change → `useEffect` resets `page` to 0.
- `useEffect` also resets page when the underlying `orders` prop changes (cert switched).

Skeleton/empty/error states unchanged (no fetch — data comes from props).

### `<CertificateDetailPage>` (modify)

Wire the export handler. New local state `[exporting, setExporting] = useState(false)`:

```tsx
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
```

Pass `onExport={handleExport}` and `exporting={exporting}` to `<CertHeader>`.

## New module: `lib/export/certificate-excel.ts`

Pure function. No React. No hooks.

```ts
import type { CertificateDetail } from '@/lib/types/certificate';

export async function generateCertificateExcel(
  cert: CertificateDetail,
): Promise<Blob> {
  const ExcelJS = (await import('exceljs')).default;
  const wb = new ExcelJS.Workbook();
  wb.creator = 'Cashea CFB';
  wb.created = new Date();

  buildResumenSheet(wb.addWorksheet('Resumen'), cert);
  buildOrdenesSheet(wb.addWorksheet('Órdenes'), cert);

  const buffer = await wb.xlsx.writeBuffer();
  return new Blob([buffer], {
    type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  });
}

function buildResumenSheet(sheet, cert) { /* ... see content below ... */ }
function buildOrdenesSheet(sheet, cert) { /* ... see content below ... */ }
```

### "Resumen" sheet content

Two-column key/value layout. Column A widths set to 24, Column B to 32. Header row in bold.

| A | B |
|---|---|
| Código | C4572A |
| Tipo | standard |
| Estado | Activo |
| Inversor | Inversora Alpha, C.A. |
| RIF | J-12345678-9 |
| Capital | $100,000.00 |
| Tasa anual | 13.00% |
| Plazo | 42 días |
| Precio | 0.984833 |
| Nominal objetivo | $101,540.60 |
| Nominal real | $101,540.00 |
| Pagado inversor | $99,999.41 |
| Residual | $0.59 |
| Rendimiento | $1,540.59 |
| Shortfall | 0.0006% |
| Emisión | 27/04/2026 |
| Vencimiento | 08/06/2026 |
| Primer vto pool | 03/05/2026 |
| Emitido por | María Rodríguez (op@x.com) |
| Hash payload | h |

Money fields formatted with `$#,##0.00` Excel format. Percent fields with `0.0000%`. Date fields with `dd/mm/yyyy`.

### "Órdenes" sheet content

Header row (bold, with frozen pane on row 1):

| ID orden | Comercio | RIF | Compra | Últ. vto | # Cuotas | Monto |
|---|---|---|---|---|---|---|

One row per `cert.orders[]` item. Final row:

| TOTAL | | | | | sum(# cuotas) | sum(monto) |

Money column with `$#,##0.00`. Date columns with `dd/mm/yyyy`. Column widths sized for content (auto-fit-ish: 14, 32, 14, 12, 12, 10, 14).

## File map

| Path | Action |
|---|---|
| `package.json` | modify (add deps) |
| `lib/export/certificate-excel.ts` | create |
| `lib/export/certificate-excel.test.ts` | create |
| `components/certificates/cert-header.tsx` | modify (add button) |
| `components/certificates/cert-header.test.tsx` | modify (3 new tests) |
| `components/certificates/cert-hero-strip.tsx` | modify (new card) |
| `components/certificates/cert-hero-strip.test.tsx` | modify (3 new tests) |
| `components/certificates/cert-audit-sidebar.tsx` | modify (new block) |
| `components/certificates/cert-audit-sidebar.test.tsx` | modify (2 new tests) |
| `components/certificates/cert-orders-table.tsx` | modify (paginate) |
| `components/certificates/cert-orders-table.test.tsx` | modify (4 new tests) |
| `components/certificates/certificate-detail-page.tsx` | modify (wire export) |
| `components/certificates/certificate-detail-page.test.tsx` | modify (1 new test) |

**Total:** 2 new files + 11 modifications. ~15 new tests.

## Testing strategy

### `<CertHeader>`

- Button "Exportar Excel" is always rendered (no permission check).
- Click invokes `onExport` prop.
- When `exporting=true`, button shows "Generando…" and is disabled.

### `<CertHeroStrip>`

- Renders new card "PRIMER VTO" with correct date and order code when pool has multiple orders (verifies it picks the min).
- Renders `—` and `sin órdenes` when pool is empty.
- Existing 5-card tests still pass (we don't break old assertions).

### `<CertAuditSidebar>`

- Renders new "DETALLE FINANCIERO" block with all 8 fields.
- "Primer vencimiento" in the block shows `—` when pool is empty.

### `<CertOrdersTable>`

- Paginates 100 orders to 2 pages of 50.
- Prev/next buttons disabled at boundaries.
- Footer pool total computed over filtered set, not paginated subset.
- Filter change resets page to 0.

### `<CertificateDetailPage>`

- Click "Exportar Excel" calls the export helper with the cert data and shows toast.
- (Excel internals not asserted — that's the helper's job.)

### `lib/export/certificate-excel.ts`

- Returns a `Blob` of XLSX mime type.
- Two sheets: "Resumen" and "Órdenes".
- "Resumen" contains the cert code in cell B1.
- "Órdenes" contains a header row + 1 row per order + 1 TOTAL row.
- Money/date cells have the right Excel number formats.

We test these by:

1. Calling `generateCertificateExcel(cert)` with a sample cert.
2. Re-parsing the resulting blob with `exceljs` in the test (loading from buffer).
3. Asserting cell values and types.

No mocks of `exceljs` — we use the real library for the helper tests since that's the unit we're certifying. For component tests we mock `@/lib/export/certificate-excel` and `file-saver`.

## Error handling

| Scenario | UI |
|---|---|
| `exceljs` import fails (network/chunk error) | `toast.error("No se pudo generar el archivo")`. Button re-enables. |
| `wb.xlsx.writeBuffer()` throws | Same as above. |
| `saveAs` throws (browser permission?) | Same as above. |
| Cert detail not yet loaded | Button disabled (already gated by detail page state — only renders when `data` is present). |

No retry — the operator can just click again.

## Visual layout notes

**Hero strip on narrow screens:**
- Mobile (default): 2 columns (3 rows of 2).
- Tablet (md): 3 columns (2 rows of 3).
- Desktop (lg): 6 columns (1 row).

**Sidebar:**
- New block fits naturally — `<CertAuditSidebar>` is already a stack of Blocks. Block order: INVERSOR → DETALLE FINANCIERO → REGLAS VERIFICADAS → AUDITORÍA.

**Pagination footer:**
- Same pattern as `<CertificatesTable>` for consistency.

## Out-of-scope follow-ups

1. **Cuotas sheet in Excel** — if compliance asks for installment-level granularity.
2. **PDF export** — `react-pdf` would be a separate slice; bigger lift.
3. **List Excel export** — separate slice if useful.
4. **URL routing by certificate_code** — `/certificates/C4572A` instead of UUIDs.

These belong in future slices.

## Why each change

| Change | User-facing reason |
|---|---|
| Excel export | Compliance reports / pasting into auditor templates. SUNAVAL follow-ups. |
| Primer vencimiento card | Operators want to know "when does this cert start paying" at a glance. |
| Detalle financiero block | All numbers in one place — currently scattered as sub-labels and lost. |
| Pagination | Certs with 300+ orders make the page sluggish to scroll; pagination scales. |

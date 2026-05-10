# Frontend Slice 4 — Wizard de Nuevo Certificado Design Spec

**Fecha:** 2026-05-10
**Estado:** Aprobado, listo para implementation plan
**Repo afectado:** `araguaney_front` (Slice 3 `/stock` ya en producción)
**Repo dependiente:** `araguaney_back` con `/api/certificates*` e `/api/investors*` desplegados en Railway

---

## Goal

Permitir que el operador de Tesorería emita un certificado bursátil contra el stock disponible: elegir inversor, simular el pool con parámetros (capital, tasa, plazo, fecha), revisar el resultado de la simulación con métricas y concentración, y confirmar la emisión. El wizard cierra el loop "tengo stock → quiero emitir" iniciado en Slice 3.

## Non-Goals (YAGNI)

- **Listado y detail de certificados** (`/certificates` page, drawer/page con events) → Slice 5. Tras emitir, toast verde y modal cierra; el usuario queda en `/stock`.
- **Cancelar certificado emitido** (`POST /:id/cancel`) → Slice 5.
- **Sweep certificate** (cert interno semanal de Cashea) → flujo distinto, slice aparte.
- **Auto-recalc en cada input change con debounce** → "Recalcular" explícito, igual al mockup. Reduce simulate calls + da control claro al operador.
- **Draft persistence / borradores** → si el usuario cierra el modal, pierde el progreso. Acceptable para un flujo que toma <2 min.
- **PDF preview o generación de documentos** → fuera de alcance.
- **Edit de inversor** desde el wizard → solo create. Edit es slice aparte de inversores.
- **Investor type "internal"** → reservado para sweep, fuera de alcance acá. Step 1 lo filtra del listado.
- **Concentración drill-down** ("Ver los 71 →" del mockup) → top 5 sin link, sin acción.
- **Maturity timeline interactivo** (click en un punto = filtrar) → solo display informativo.
- **Multi-tenant / multi-emisor** — un solo Cashea, todo bajo una sola cuenta de Storage.

## Decisiones cerradas (Q&A brainstorm)

| Q | Decisión | Razón |
|---|---|---|
| Alcance Slice 4 | Solo el wizard, sin listado ni detail | Slice acotado; lista/detail = Slice 5 |
| Entry point | Modal lanzado desde botón en `/stock` | Stock es donde se ve qué se va a empaquetar; contextual |
| Step 2 paneles | Los 4: stat cards + breakdown + concentración + timeline | Mockup completo, el back ya devuelve todos los datos en `/simulate` |
| Recalcular | Botón explícito (no auto-debounce) | Mockup explícito; control claro |
| Step 3 | Pantalla de confirmación read-only antes del POST irreversible | Safety: emitir es alto riesgo |
| Investor create inline | Sí, en Step 1, tabs Existente/Nuevo | Flujo único para el operador, no reabrir otro modal |
| Layout | Modal 880px max-width, 2 columnas en Step 2 | Mockup; cabe stat cards + form en pantalla 1080p+ |
| Permisos | `certificate.simulate` para Step 2, `certificate.issue` para Step 3, `investor.create` si crea | Existentes en back Slice 0/4 |

## Hallazgos del back (relevantes)

### `POST /api/certificates/simulate`

Permission: `certificate.simulate`. Body:

```ts
{
  investor_id: string,    // uuid
  capital: number,         // > 0
  rate: number,             // 0..0.999999 (e.g. 0.13 = 13%)
  term_days: 14 | 42,
  issue_date: string,       // ISO date "YYYY-MM-DD" (back coerce a Date; debe ser >= hoy)
}
```

Respuesta (hand-typed):

```ts
type SimulationResult = {
  investor: { id: string; legal_name: string; rif: string };
  capital: string;                        // Decimal as string
  rate: string;
  term_days: 14 | 42;
  issue_date: string;                     // ISO
  maturity_date: string;
  price: string;                           // descuento (e.g. "0.984833")
  nominal_target: string;
  nominal_actual: string;
  investor_paid: string;                   // capital × price (lo que paga hoy)
  investor_returned: string;               // capital - investor_paid (no colocado / devolución)
  investor_yield: string;                  // nominal_actual - investor_paid (intereses)
  shortfall_pct: string;                   // (target - actual) / target
  selected_orders: Array<{
    id: string;
    installments_sum: string;
    merchant_id: string;
    num_installments: number;
    max_due_date: string;
  }>;
  total_eligible_merchants: number;        // total comercios que califican (no necesariamente en pool)
  total_distinct_merchants: number;        // distintos en el pool seleccionado
  installment_plazo_days: { min: number; max: number };
  concentration_top: Array<{
    merchant_id: string;
    current_name: string;
    rif: string;
    amount: string;
    pct: string;                            // 0..1
  }>;
  due_date_distribution: Array<{
    date: string;                           // ISO
    amount: string;
  }>;
  payload_hash: string;                    // sha256 hex; pasar tal cual a /api/certificates
};
```

Errores conocidos:
- `404` "Inversor no encontrado"
- `400` "Inversor interno reservado para certificados sweep"
- `400` "Inversor inactivo"
- `400` "La fecha de emisión no puede ser anterior a hoy"
- `422` "No hay órdenes elegibles para los parámetros" (cuando no se selecciona ninguna)

### `POST /api/certificates`

Permission: `certificate.issue`. Body = SimulateBase + `order_ids` + `expected_payload_hash`:

```ts
{
  investor_id: string,
  capital: number,
  rate: number,
  term_days: 14 | 42,
  issue_date: string,
  order_ids: string[],                  // 1..2000 — copiar de simulate.selected_orders[].id
  expected_payload_hash: string,        // copiar de simulate.payload_hash
}
```

Respuesta: el `Certificate` recién creado (`{ id, code, status: 'issued', ... }`).

Error crítico:
- `409` "payload_hash mismatch": el pool cambió entre simulate y issue (alguien ingestó otra orden, otro usuario emitió un cert que consumió órdenes, etc.). El front debe re-simular y mostrar al usuario el nuevo estado.

### `GET /api/investors`

Permission: `investor.read`. Query params relevantes:
- `kind=juridica` (filtrar a juridicas)
- `status=active`
- `q` (substring search en legal_name/rif)
- `limit`, `offset`

Respuesta:
```ts
type InvestorsListResponse = {
  data: Array<InvestorSummary>;
  total: number;
  limit: number;
  offset: number;
};

type InvestorSummary = {
  id: string;
  legal_name: string;
  rif: string;
  kind: 'juridica' | 'natural' | 'internal';
  status: 'active' | 'inactive';
  email: string | null;
  phone: string | null;
};
```

### `POST /api/investors`

Permission: `investor.create`. Body:

```ts
{
  legal_name: string,        // 1..255
  rif: string,                // 1..50
  kind: 'juridica' | 'natural',     // 'internal' bloqueado por back, no se expone
  email?: string | null,
  phone?: string | null,
  notes?: string | null,
}
```

Respuesta `201`: el `Investor` recién creado.

---

## Architecture

```
/stock (Slice 3)
  └─ <StockPage> (Client)
       ├─ <PageHeader breadcrumb="Operación · Stock de órdenes" actions={<NewCertButton />} />
       ├─ <StockStatsBanner />
       ├─ <StockFilters />
       ├─ <StockTable />
       └─ {wizardOpen && <NewCertWizard onClose={...} />}
            ├─ Modal envoltorio (backdrop + 880px card)
            ├─ <NewCertHeader> (X close + título + step indicator 1·2·3)
            ├─ Body — uno de:
            │    ├─ <NewCertStep1Investor>   (step === 1)
            │    │    ├─ Tabs Existente / Nuevo
            │    │    ├─ <InvestorList> (Existente): useQuery → GET /api/investors?kind=juridica
            │    │    └─ <InvestorCreateForm> (Nuevo): mutation → POST /api/investors
            │    ├─ <NewCertStep2Simulation> (step === 2)
            │    │    ├─ Form column: capital | term toggle | rate | issue_date
            │    │    │    + calc summary read-only (vencimiento, precio, nominal target)
            │    │    └─ Preview column:
            │    │         ├─ <SimRulesBadge>           ("✓ Las 3 reglas se cumplen")
            │    │         ├─ <SimStatCards>            (Comercios, Órdenes, Retorno, Plazo)
            │    │         ├─ <SimInvestorBreakdown>    (capital → no colocado → efectivo → intereses → total)
            │    │         ├─ <SimConcentrationBars>    (top 5 con barras)
            │    │         └─ <SimMaturityTimeline>     (puntos por fecha de cuota)
            │    └─ <NewCertStep3Confirm>    (step === 3)
            │         ├─ Resumen read-only
            │         ├─ Disclaimer "Esta emisión es irreversible salvo cancelación posterior"
            │         └─ Mutation → POST /api/certificates
            └─ <NewCertFooter> (botones contextuales por step)
```

**Server-first**: el wizard es 100% client-side state, montado desde el client `<StockPage>`. No requiere route nueva.

**State management**: el wizard guarda su estado en React state interno con `useReducer` (más limpio que múltiples `useState` para 3 sub-estados acoplados). Al cerrar el modal, el state se descarta (no draft persistence).

**Modular por unidad**: cada sub-componente del Step 2 (stat cards, breakdown, concentration, timeline) es un componente separado con tests propios. La idea: cada uno < 120 líneas, una responsabilidad clara, fácil de revisar.

---

## File Structure

| Path | Action | Responsibility |
|---|---|---|
| `lib/types/investor.ts` | create | `InvestorKind`, `InvestorStatus`, `InvestorSummary`, `InvestorsListResponse`, `InvestorCreate` |
| `lib/types/certificate.ts` | create | `CertificateStatus`, `CertificateType`, `Certificate`, `SimulationResult` (todas las sub-types: ConcentrationItem, DueDateItem, etc.) |
| `lib/api/investors.ts` | create | Server Actions: `listInvestors(query)`, `createInvestor(body)` |
| `lib/api/investors.test.ts` | create | Tests con mock `apiFetch` |
| `lib/api/certificates.ts` | modify | Add `simulateCertificate(body)`, `issueCertificate(body)` (existente: `countCertificatesIssued`) |
| `lib/api/certificates.test.ts` | modify | Add tests para los dos nuevos |
| `lib/format/percent.ts` | create | `fmtPct(n, decimals?)` ("13.0%" / "1.5167%") |
| `lib/format/percent.test.ts` | create | Tests |
| `components/cert-wizard/new-cert-button.tsx` | create | Botón "+ Nuevo certificado" mountable en `<PageHeader actions>` |
| `components/cert-wizard/new-cert-button.test.tsx` | create | Test render + click |
| `components/cert-wizard/new-cert-wizard.tsx` | create | Modal + state reducer + step routing |
| `components/cert-wizard/new-cert-wizard.test.tsx` | create | Smoke integrado del flow completo |
| `components/cert-wizard/wizard-state.ts` | create | Reducer + initial state + action types (extracted for testability) |
| `components/cert-wizard/wizard-state.test.ts` | create | Reducer tests pure |
| `components/cert-wizard/step-indicator.tsx` | create | Visual 1·2·3 con done/active/pending |
| `components/cert-wizard/step-indicator.test.tsx` | create | Tests |
| `components/cert-wizard/step1-investor.tsx` | create | Tabs + InvestorList + InvestorCreateForm |
| `components/cert-wizard/step1-investor.test.tsx` | create | Tests del flujo de Step 1 |
| `components/cert-wizard/investor-list.tsx` | create | Search + lista paginada con click → onSelect(investor) |
| `components/cert-wizard/investor-list.test.tsx` | create | Tests |
| `components/cert-wizard/investor-create-form.tsx` | create | Form (legal_name, rif, kind, email, phone) + mutation |
| `components/cert-wizard/investor-create-form.test.tsx` | create | Tests |
| `components/cert-wizard/step2-simulation.tsx` | create | 2-col layout + form + preview composition |
| `components/cert-wizard/step2-simulation.test.tsx` | create | Tests del flow Recalcular → preview |
| `components/cert-wizard/sim-form.tsx` | create | Inputs (capital, term, rate, date) + calc summary card |
| `components/cert-wizard/sim-form.test.tsx` | create | Tests |
| `components/cert-wizard/sim-rules-badge.tsx` | create | "✓ Las 3 reglas se cumplen" pill |
| `components/cert-wizard/sim-stat-cards.tsx` | create | 4 cards (Comercios, Órdenes, Retorno, Plazo) |
| `components/cert-wizard/sim-stat-cards.test.tsx` | create | Tests |
| `components/cert-wizard/sim-investor-breakdown.tsx` | create | Capital → No colocado → Efectivo → Intereses → Total |
| `components/cert-wizard/sim-investor-breakdown.test.tsx` | create | Tests |
| `components/cert-wizard/sim-concentration-bars.tsx` | create | Top 5 merchants con barras |
| `components/cert-wizard/sim-concentration-bars.test.tsx` | create | Tests |
| `components/cert-wizard/sim-maturity-timeline.tsx` | create | Timeline horizontal con puntos por fecha |
| `components/cert-wizard/sim-maturity-timeline.test.tsx` | create | Tests |
| `components/cert-wizard/step3-confirm.tsx` | create | Resumen final + mutation POST /certificates |
| `components/cert-wizard/step3-confirm.test.tsx` | create | Tests del flow de confirmación + 409 handling |
| `components/cert-wizard/wizard-footer.tsx` | create | Botones contextuales por step |
| `components/cert-wizard/wizard-footer.test.tsx` | create | Tests |
| `components/stock/stock-page.tsx` | modify | Mount `<NewCertButton onClick>` en PageHeader actions, render del wizard cuando open |

**Total**: 31 nuevos + 2 modificados (51 archivos contando tests).

Cada componente individual: <150 LOC, una responsabilidad, test propio.

---

## UI Spec

### Modal envoltorio

```tsx
<div data-testid="modal-backdrop" onClick={onClose}
     className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto bg-black/45 p-12">
  <div onClick={stopPropagation}
       className="bg-card w-full max-w-[880px] overflow-hidden rounded-xl">
    {/* Header */}
    {/* Step indicator */}
    {/* Body */}
    {/* Footer */}
  </div>
</div>
```

Mismo patrón que `<UploadBatchModal>` (Slice 2).

### Header + step indicator

```
┌──────────────────────────────────────────────────────────────────────┐
│ Nuevo certificado                                                  × │
│ Empaqueta órdenes del stock disponible bajo las 3 reglas del producto│
├──────────────────────────────────────────────────────────────────────┤
│ ✓ Datos del inversor → ② Simulación del pool → ③ Emisión y firma    │
└──────────────────────────────────────────────────────────────────────┘
```

Step indicator: pill verde con ✓ en done, pill negra con número en active, pill gris en pending. Flecha `→` entre cada par.

### Step 1 layout

```
┌──────────────────────────────────────────────────────────────────────┐
│ ┌─ Existente ─┬─ Nuevo ─┐                                            │
│ │             │         │                                            │
│ ├─────────────┴─────────┘                                            │
│                                                                      │
│ [TAB ACTIVO=Existente]                                               │
│   [🔎 Buscar por razón social o RIF]                                 │
│   ┌──────────────────────────────────────────────────┐              │
│   │ Inversora Alpha, C.A.    J-12345678-9   2 certs │              │
│   │ Fondo Mutual Caracas     J-30122334-5   1 cert  │              │
│   │ ...                                              │              │
│   └──────────────────────────────────────────────────┘              │
│                                                                      │
│ [TAB ACTIVO=Nuevo]                                                  │
│   Razón social *  [____________________]                             │
│   RIF *           [________]                                         │
│   Tipo            ( ) Jurídica  ( ) Natural                          │
│   Email           [____________________]                             │
│   Teléfono        [____________________]                             │
│   Notas           [____________________]                             │
│   [ Crear inversor ]                                                 │
│                                                                      │
├──────────────────────────────────────────────────────────────────────┤
│                                              [Cancelar]              │
└──────────────────────────────────────────────────────────────────────┘
```

- Tabs styled como segmented control.
- En "Nuevo" tab, los campos validan client-side: legal_name 1-255, rif 1-50 (any chars; back valida formato), email RFC.
- Submit "Crear inversor" → POST /api/investors → on success setState.investor + ir a Step 2.
- Lista pagina al final con `← →` simple si > 50 registros.

### Step 2 layout (2 columnas, mockup `443031f2`)

Reutilizo la descripción ya validada en el brainstorm. Layout:

```
┌────── Form (320px) ──────┬───────── Preview (~520px) ─────────────┐
│ Inversor                 │  ✓ Las 3 reglas se cumplen             │
│ ┌──────────────────────┐ │                                        │
│ │ {legal_name}         │ │  ┌──────┐ ┌──────┐ ┌──────┐ ┌──────┐  │
│ │ {rif}      [Cambiar] │ │  │COMRC.│ │ÓRDS.│ │RTRN. │ │PLAZO │  │
│ └──────────────────────┘ │  │ 71   │ │ 343 │ │$101k │ │7-42d │  │
│                          │  └──────┘ └──────┘ └──────┘ └──────┘  │
│ Capital del inversor     │                                        │
│ [$ 100,000.00         ]  │  Resumen para el inversor              │
│ Lo que desembolsa hoy    │  ─────────────────────                 │
│                          │  Capital                  $100,000.00  │
│ Plazo                    │  − No colocado            −$0.59       │
│ [ 14 días | 42 días ]    │  ───────────────────                  │
│ Convenio Actual/360      │  Capital efectivo          $99,999.41  │
│                          │  + Intereses             +$1,540.59    │
│ Tasa anual               │  ════════════════════                  │
│ [ 13.0           %    ]  │  Total a recibir 08 jun   $101,540.00  │
│                          │                                        │
│ Fecha de emisión         │  Concentración por comercio (top 5)    │
│ [ 27/04/2026          ]  │  Central Madeirense ████████  $17.4k   │
│                          │  Corpocel Store     ████      $9.5k    │
│ ┌─ Calculation ────────┐ │  ...                                   │
│ │ Vencimiento  08 jun  │ │                                        │
│ │ Precio       98.4833%│ │  Distribución de vencimientos          │
│ │ Nominal      $101,540│ │  ●───●───●───●───●                     │
│ └──────────────────────┘ │  27 abr  04 may  18 may  01 jun  08 jun│
│                          │                                        │
└──────────────────────────┴────────────────────────────────────────┘
                                   [Recalcular] [Atrás] [Cancelar] [Emitir →]
```

Estados de la columna derecha:
- **Inicial** (antes del primer Recalcular): placeholder gris "Llená los parámetros y hacé click en Recalcular"
- **Loading**: spinner centrado sobre la columna mientras simulate está pending
- **Success**: los 4 paneles + el banner ✓
- **Error 422 "no elegibles"**: panel rojo "No hay órdenes que cumplan los parámetros. Probá ajustar plazo o fecha."

### Step 3 layout

```
┌──────────────────────────────────────────────────────────────────────┐
│ Vas a emitir un certificado con los siguientes términos:             │
│                                                                      │
│ ┌─ Inversor ──────────────────────────┐  ┌─ Términos ───────────┐   │
│ │ Inversora Alpha, C.A.               │  │ Capital  $100,000.00 │   │
│ │ J-12345678-9                        │  │ Tasa     13.0%       │   │
│ └─────────────────────────────────────┘  │ Plazo    42 días     │   │
│                                          │ Emisión  27/04/2026  │   │
│ ┌─ Pool ──────────────────────────────┐  │ Vence    08/06/2026  │   │
│ │ Nominal certificado    $101,540.60  │  └──────────────────────┘   │
│ │ Total a recibir        $101,540.00  │                              │
│ │ Órdenes empaquetadas   343          │                              │
│ │ Comercios distintos    71           │                              │
│ └─────────────────────────────────────┘                              │
│                                                                      │
│ ⚠️  Esta emisión es irreversible salvo cancelación posterior.        │
│                                                                      │
├──────────────────────────────────────────────────────────────────────┤
│                            [Cancelar] [← Atrás] [Confirmar emisión]  │
└──────────────────────────────────────────────────────────────────────┘
```

Click "Confirmar emisión" → mutation POST /api/certificates → on success: cierra modal + toast `Certificado {code} emitido`.

### Footer botones por step

| Step | Botones |
|---|---|
| 1 (con investor seleccionado) | `[Cancelar] [Continuar →]` |
| 1 (sin selección) | `[Cancelar]` (Continuar disabled) |
| 2 (sim no calculada) | `[Cancelar] [← Atrás] [Recalcular]` (Emitir disabled) |
| 2 (sim calculada) | `[Cancelar] [← Atrás] [Recalcular] [Emitir certificado →]` |
| 3 | `[Cancelar] [← Atrás] [Confirmar emisión]` (loading state durante POST) |

---

## Data Fetching

### Server Actions (lib/api)

`lib/api/investors.ts`:

```ts
'use server';
export async function listInvestors(query: ListInvestorsQuery): Promise<InvestorsListResponse> { ... }
export async function createInvestor(body: InvestorCreate): Promise<InvestorSummary> { ... }
```

`lib/api/certificates.ts` (extender existente):

```ts
'use server';
export async function simulateCertificate(body: SimulateBody): Promise<SimulationResult> { ... }
export async function issueCertificate(body: IssueBody): Promise<Certificate> { ... }
// existente: countCertificatesIssued
```

Patrón `rethrowWithMessage` igual al resto.

### TanStack queries/mutations

```ts
// Step 1 — investor list
const investors = useQuery({
  queryKey: ['investors', { q, kind: 'juridica', status: 'active' }],
  queryFn: () => listInvestors({ ... }),
  staleTime: 60 * 1000,
});

// Step 1 — create investor
const createMut = useMutation({
  mutationFn: createInvestor,
  onSuccess: (inv) => {
    queryClient.invalidateQueries({ queryKey: ['investors'] });
    dispatch({ type: 'SET_INVESTOR', investor: inv });
    dispatch({ type: 'GO_TO_STEP', step: 2 });
  },
});

// Step 2 — simulate
const simMut = useMutation({
  mutationFn: simulateCertificate,
  onSuccess: (sim) => dispatch({ type: 'SET_SIMULATION', simulation: sim }),
});

// Step 3 — issue
const issueMut = useMutation({
  mutationFn: issueCertificate,
  onSuccess: (cert) => {
    toast.success(`Certificado ${cert.code} emitido`);
    queryClient.invalidateQueries({ queryKey: ['orders'] });          // tabla del Stock
    queryClient.invalidateQueries({ queryKey: ['orders-stats'] });     // banner del Stock
    queryClient.invalidateQueries({ queryKey: ['certs-this-week'] });  // banner card 3
    onClose();
  },
  onError: handleIssueError,  // 409 → re-simulate + warning
});
```

---

## Error Handling

| Situación | UX |
|---|---|
| Step 1: 401 | Layout `(app)` redirige a `/auth/clear` (existente) |
| Step 1: 403 (sin `investor.read`) | Tab "Existente" muestra empty state "No tenés permiso" |
| Step 1: 403 sin `investor.create` | Tab "Nuevo" deshabilitada con tooltip |
| Step 1: 5xx en list | Empty state + botón Reintentar |
| Step 1: 4xx en create | Inline error en form (`message` del back) |
| Step 2: 422 "no elegibles" | Reemplaza preview con mensaje "No hay órdenes que cumplan los parámetros. Probá ajustar plazo o fecha." |
| Step 2: 400 fecha pasada | Bloqueado client-side (date input min=today) antes de POST |
| Step 2: 400 inversor inactivo/internal | Toast rojo + vuelve a Step 1 (defensive — Step 1 ya filtra) |
| Step 2: 5xx simulate | Banner rojo en preview "Error simulando, reintentá" |
| Step 3: 409 payload mismatch | Banner amarillo "El stock cambió mientras revisabas. Volvé a Step 2 y recalculá." + botón "Volver a simulación" |
| Step 3: 5xx issue | Toast rojo + permite retry |
| Network error en cualquier paso | Toast con mensaje genérico + retry |

---

## Permissions

Permisos requeridos (todos seedeados en back Slice 0):
- `investor.read` — Step 1 lista
- `investor.create` — Step 1 crear nuevo
- `certificate.simulate` — Step 2 recalcular
- `certificate.issue` — Step 3 confirmar

Si falta alguno, el back tira 403 → manejo según tabla de errores.

Si el usuario es `auditor`, no tiene `investor.create` ni `certificate.issue` → el botón "+ Nuevo certificado" no aparece (gating en `<NewCertButton>` con `useUser()` + `hasPermission()` igual a `<UploadButton>` de Slice 2).

---

## Testing

| Archivo | Tipo | Tests aprox |
|---|---|---|
| `lib/api/investors.test.ts` | unit (mock apiFetch) | 4 (list / list con q / create / error) |
| `lib/api/certificates.test.ts` | unit | +4 (simulate / simulate-error / issue / issue-409) |
| `lib/format/percent.test.ts` | unit | 4 |
| `components/cert-wizard/wizard-state.test.ts` | unit (reducer puro) | 6 (set investor / go step / set sim / reset / 409 transition / cancel) |
| `components/cert-wizard/step-indicator.test.tsx` | unit | 3 (paso 1 active / paso 2 active / done states) |
| `components/cert-wizard/new-cert-button.test.tsx` | unit | 2 (render con permiso / oculto sin permiso) |
| `components/cert-wizard/investor-list.test.tsx` | unit | 4 (loading / empty / data / search debounce) |
| `components/cert-wizard/investor-create-form.test.tsx` | unit | 5 (campos / validation / submit / error / kind toggle) |
| `components/cert-wizard/step1-investor.test.tsx` | unit | 3 (tab toggle / select existing / create flow) |
| `components/cert-wizard/sim-form.test.tsx` | unit | 4 (capital / term / rate / date validation) |
| `components/cert-wizard/sim-stat-cards.test.tsx` | unit | 2 (render / loading) |
| `components/cert-wizard/sim-investor-breakdown.test.tsx` | unit | 3 (montos formateados / shortfall caso / zero caso) |
| `components/cert-wizard/sim-concentration-bars.test.tsx` | unit | 2 (render + bar widths proporcionales) |
| `components/cert-wizard/sim-maturity-timeline.test.tsx` | unit | 2 (render + dates ordered) |
| `components/cert-wizard/step2-simulation.test.tsx` | unit | 5 (initial empty / recalcular / loading / 422 / success) |
| `components/cert-wizard/step3-confirm.test.tsx` | unit | 4 (render / confirm / 409 / 5xx) |
| `components/cert-wizard/wizard-footer.test.tsx` | unit | 5 (botones por step) |
| `components/cert-wizard/new-cert-wizard.test.tsx` | smoke integrado | 3 (flow completo / cancelar mid-flow / 409 recovery) |

**Total**: ~71 tests nuevos.

Mismo setup que slices anteriores: vitest + react-testing-library + jsdom. `renderWithQuery` ya existe.

---

## Smoke Plan (manual, post-deploy)

1. Login como `operator`.
2. `/stock` → ver botón "+ Nuevo certificado" en el header.
3. Click → modal abre, Step 1 activo.
4. Tab "Existente" → buscar un investor existente (poblar via Supabase MCP o crear uno antes), click → avanza a Step 2.
5. (alternativo) Tab "Nuevo" → completar campos → "Crear inversor" → avanza.
6. Step 2 → ingresar capital ($100,000), tasa 13%, plazo 42d, fecha de hoy → "Recalcular" → preview popula con stat cards + breakdown + concentración + timeline.
7. Click "Emitir certificado →" → Step 3.
8. Step 3 → revisar resumen → "Confirmar emisión" → loading → toast verde "Certificado X emitido", modal cierra, tabla del stock se refresca (ahora hay órdenes en `assigned`), banner reduce capital disponible.
9. (negativo) Repetir con capital absurdo (e.g. $0.01) → 422 → preview muestra error "No hay órdenes elegibles" → Recalcular con valores válidos → continúa OK.

---

## Out of Scope (recordatorio)

| | |
|---|---|
| Listado de certificados, detail page | Slice 5 |
| Sweep certificate (interno semanal) | Slice de sweep aparte |
| Cancel de certificado emitido | Slice 5 |
| Auto-recalc con debounce | Si el operador lo pide |
| Draft persistence (cerrar y volver) | YAGNI hasta evidencia de uso |
| PDF preview / generación | Si SUNAVAL exige el doc desde el front |
| Investor edit / inactivar | Slice de inversores |
| Concentración drill-down | Si Tesorería pide ver los 71 |
| Maturity timeline interactivo | YAGNI |

## Dependencias

- TanStack Query v5 (existente)
- shadcn primitives (Pill, etc., existente)
- sonner (existente)
- Hand-typed shapes (back tiene gap de openapi — mismo patrón que slices anteriores)
- **Sin nuevas dependencias** en `package.json`

## Riesgos conocidos

1. **El payload_hash race**: si dos operadores recalculan al mismo tiempo y uno emite, el segundo pega 409. El front lo maneja explícitamente (Step 3 → 409 → "el pool cambió, recalculá"). Edge case real, baja frecuencia (3 operadores), aceptable.
2. **Volumen de órdenes elegibles**: si hay muchas órdenes (>10k) el simulate del back puede tardar. La columna preview muestra spinner; aceptable. Si supera 30s, considerar refactor del simulate (separate slice).
3. **Comportamiento del modal en mobile**: el layout 2-col de Step 2 cabe a partir de 880px de viewport. En mobile el modal scroll-y vertical, columnas colapsan a 1. Tesorería usa desktop (operadores en oficina), así que low priority.
4. **Investor create no valida formato de RIF**: el back acepta cualquier string 1-50; front sigue el contrato del back. Si Tesorería empieza a crear inversores con RIFs malformados, agregar regex `/^[JGVE]-\d{8}-\d$/` en una mejora futura.

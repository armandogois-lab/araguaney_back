# Frontend Slice 2 — `/batches` (Upload + List) Design Spec

**Fecha:** 2026-05-08
**Estado:** Aprobado, listo para implementation plan
**Repo afectado:** `araguaney_front` (Slice 1 ya en producción)
**Repo dependiente:** `araguaney_back` con `/api/batches*` desplegado en Railway

---

## Goal

Permitir que los operadores suban archivos Excel de órdenes BNPL al sistema y vean la lista de lotes históricos con su estado. Es la primera feature de negocio real del frontend — desbloquea todas las features downstream (sin lotes no hay órdenes; sin órdenes no hay certificados).

## Non-Goals (YAGNI)

- Detail page `/batches/{id}` con import errors → Slice 2b cuando un lote real falle.
- Filter pills (status, fecha, uploader) → Slice 2b o cuando haya >50 lotes.
- Pagination UI (limit/offset controls visibles) → Slice 2b.
- Click row → navegación al detail → Slice 2b.
- Field `external_code` en el modal — el back lo acepta opcional pero el design no lo expone, no lo agregamos hasta que un operador lo pida.
- 3-stage preview-then-confirm (drop → validating → preview → confirm) — requiere endpoint nuevo en el back; Slice 2c eventual.
- "Descargar plantilla" button del design — necesita endpoint nuevo del back.
- Cancel mid-upload (AbortController) — YAGNI.
- DataTable component reusable — la tabla en Slice 2 es ad-hoc; reusable cuando un segundo lugar lo necesite.

## Decisiones cerradas (Q&A brainstorm)

| Q | Decisión | Razón |
|---|---|---|
| Q1 | Scope = modal + lista (sin detail) | Ciclo cerrado típico para el operador; detail page espera info real de errors |
| Q2 | Single-step upload (no preview-then-confirm) | YAGNI — el back hoy hace upload+validate+save en un POST; preview UX es nice-to-have |
| Lista shape | Confirmado: código, fecha, uploader, órdenes, capital, estado | Datos disponibles del back; sin % consumido (requiere data de certificados, otro slice) |

## Hallazgos del back (relevantes)

- `BatchStatus` enum: `uploaded | parsing | imported | rejected | archived`
- POST `/api/batches` requiere permission `batch.upload`; auditor NO la tiene
- Max file size: **10 MB**, formato: solo `.xlsx`
- `external_code`: opcional, regex `[A-Z0-9-]{1,20}`
- Response shape rica (hand-typed en el front; back tiene gap de openapi):
  ```ts
  { id, external_code, status, rows_imported, rows_rejected,
    total_orders_amount, total_installments_amount,
    imported_at, rejection_reason,
    uploaded_at, uploaded_by: { id, email, full_name } | null }
  ```

---

## Architecture

```
/batches (Server Component, 5 LOC shell)
  └─ <BatchesPage> (Client)
       ├─ <PageHeader breadcrumb="Datos · Lotes" actions={<UploadButton/>} />
       ├─ <BatchesTable> (TanStack useQuery → GET /api/batches)
       │    ├─ <BatchRow batch={...} />
       │    └─ <BatchStatusPill status={...} />
       └─ {modalOpen && <UploadBatchModal onClose={...} />}
            ├─ <UploadBatchDropzone> (mutation idle)
            │    └─ <UploadBatchRecent> (3 más recientes)
            └─ <UploadBatchUploading> (mutation pending)
                 └─ TanStack useMutation → POST /api/batches
                      └─ onSuccess: invalidateQueries(['batches']) + toast + onClose()
                      └─ onError: setError(message) + modal stays open
```

**Server-first cuando se puede**: el `page.tsx` es un Server Component que monta el cliente. Toda la lógica reactiva (queries, mutations, modal state) vive en clients.

**Modular por dominio**: `components/batches/` con 8 archivos chicos (cada uno <120 líneas), 1 reusable (`<Pill>`) en `components/ui/`.

---

## File Structure

| Path | Action | Responsibility |
|---|---|---|
| `app/(app)/batches/page.tsx` | modify | Server Component, monta `<BatchesPage>` |
| `lib/api/client.ts` | modify | Skip `content-type` cuando body es `FormData` |
| `lib/api/client.test.ts` | modify | Test del FormData skip |
| `lib/api/batches.ts` | create | `listBatches(query)`, `uploadBatch(input)` |
| `lib/api/batches.test.ts` | create | Tests de las 2 funciones |
| `lib/types/batch.ts` | create | `BatchStatus`, `BatchSummary`, `BatchListResponse`, `UploadBatchInput` |
| `lib/format/money.ts` | create | `fmtMoney(n, decimals?)`, `fmtMoney2(n)` |
| `lib/format/money.test.ts` | create | Tests |
| `lib/format/date.ts` | create | `fmtDate(iso)` → `DD/MM/YYYY` |
| `lib/format/date.test.ts` | create | Tests + null handling |
| `lib/permissions/has-permission.ts` | create | `hasPermission(role, perm)` |
| `lib/permissions/has-permission.test.ts` | create | Tests por rol × permission |
| `lib/auth/user-context.tsx` | create | `<UserProvider>` + `useUser()` hook |
| `app/(app)/layout.tsx` | modify | Wrap children en `<UserProvider value={user}>` |
| `components/ui/pill.tsx` | create | Primitivo reusable (variants success/warn/info/neutral/sweep) |
| `components/ui/pill.test.tsx` | create | Tests por variant |
| `components/batches/batches-page.tsx` | create | Orquestador, modal state |
| `components/batches/batches-table.tsx` | create | TanStack useQuery, table render, loading/error/empty states |
| `components/batches/batches-table.test.tsx` | create | Tests con `renderWithQuery()` |
| `components/batches/batch-row.tsx` | create | Render de una fila |
| `components/batches/batch-row.test.tsx` | create | Tests |
| `components/batches/batch-status-pill.tsx` | create | Mapping status → pill variant + label español |
| `components/batches/batch-status-pill.test.tsx` | create | Tests por status |
| `components/batches/upload-button.tsx` | create | `<Button>` con permission check via `useUser()` |
| `components/batches/upload-button.test.tsx` | create | Tests por rol |
| `components/batches/upload-batch-modal.tsx` | create | Modal con stage derivado de `mutation.status` |
| `components/batches/upload-batch-modal.test.tsx` | create | Tests del flow completo |
| `components/batches/upload-batch-dropzone.tsx` | create | Stage 'idle' / 'error': dropzone + recent batches |
| `components/batches/upload-batch-uploading.tsx` | create | Stage 'pending': spinner |
| `components/batches/upload-batch-recent.tsx` | create | Widget en dropzone con últimos 3 lotes |
| `test/helpers/tanstack.tsx` | create | `renderWithQuery()` helper |
| `app/layout.tsx` | modify (verify) | Add `<Toaster />` (sonner) si no está |

**Total nuevo:** ~25 archivos. Cada uno con responsabilidad clara, <120 líneas.

---

## Data Flow

### Listado

```
<BatchesTable> mount
  → useQuery({ queryKey: ['batches', { limit: 50, offset: 0 }],
                queryFn: () => listBatches({ limit: 50, offset: 0 }) })
       ↓
listBatches() → apiFetch<BatchListResponse>('/api/batches?limit=50', { method: 'GET' })
       ↓
Back: GET /api/batches → returns { data: BatchSummary[], total, limit, offset }
       ↓
TanStack cachea por queryKey, retorna data al component
       ↓
data.data.map((b) => <BatchRow batch={b} />)
```

### Upload

```
<UploadButton> click → setModalOpen(true)
  → <UploadBatchModal> renders <UploadBatchDropzone>

User picks file → pickFile(file)
  ↓ Client validations (extension, size, empty)
  ↓ Si fail → setError(...), no mutation
  ↓ Si OK → mutation.mutate({ file })
       ↓ Modal stage cambia a 'pending' (mutation.status)
       ↓ apiFetch('/api/batches', { method: 'POST', body: FormData })
            ↓ apiFetch detecta FormData → no agrega content-type
            ↓ Browser pone multipart/form-data; boundary=...
            ↓ Cookie cfb_token → Authorization: Bearer
       ↓ Back: POST /api/batches → BatchSummary
       ↓ onSuccess(batch):
            - queryClient.invalidateQueries({ queryKey: ['batches'] })
            - toast.success(`Lote ${batch.external_code} ingresado · ${rows_imported} órdenes`)
            - onClose()
       ↓ onError(err):
            - if ApiError → setError(err.body.message)
            - else → setError('Error de red. Intenta de nuevo.')
            - Modal queda abierto, dropzone vuelve a renderizarse con error inline
```

---

## Components

### `<BatchesPage>` (orquestador)

```tsx
'use client';
const [modalOpen, setModalOpen] = useState(false);
return (
  <div className="mx-auto w-full max-w-[1440px] px-9 py-7">
    <PageHeader
      breadcrumb={{ section: 'Datos', current: 'Lotes' }}
      title="Lotes"
      actions={<UploadButton onClick={() => setModalOpen(true)} />}
    />
    <BatchesTable />
    {modalOpen && <UploadBatchModal onClose={() => setModalOpen(false)} />}
  </div>
);
```

### `<BatchesTable>`

`useQuery(['batches', { limit:50, offset:0 }], () => listBatches({ limit:50, offset:0 }))`. Renderiza:
- `isLoading` → `<BatchesTableSkeleton>` ("Cargando lotes…")
- `isError` → `<BatchesTableError>` ("No se pudieron cargar los lotes. Recarga la página.")
- `data.data.length === 0` → `<BatchesTableEmpty>` ("Sin lotes todavía. Sube un Excel para empezar.")
- otherwise → `<table>` con thead + tbody mapped sobre `data.data`

Skeleton/Error/Empty son sub-components in-file (no exportados; YAGNI).

### `<BatchRow>`

| Columna | Render |
|---|---|
| Código | `<td className="font-mono text-[11.5px] text-text-2">{external_code}</td>` |
| Subido | `fmtDate(uploaded_at)` con `.num` |
| Por | `uploaded_by?.full_name ?? '—'` |
| Órdenes | `rows_imported.toLocaleString('en-US')` text-right `.num` |
| Capital | `fmtMoney(Number(total_orders_amount))` text-right `.num` |
| Estado | `<BatchStatusPill status={status} />` |

Hover: `bg-subtle`. Click: no-op en Slice 2.

### `<BatchStatusPill>`

```ts
const MAP: Record<BatchStatus, { variant: PillVariant; label: string }> = {
  imported: { variant: 'success', label: 'Activo' },
  uploaded: { variant: 'info', label: 'Subido' },
  parsing:  { variant: 'info', label: 'Procesando' },
  rejected: { variant: 'warn', label: 'Rechazado' },
  archived: { variant: 'neutral', label: 'Archivado' },
};
```

### `<UploadButton>`

```tsx
'use client';
const user = useUser();
if (!hasPermission(user.role, 'batch.upload')) return null;
return <Button onClick={onClick}>Subir lote</Button>;
```

### `<UploadBatchModal>` (single-step flow)

```tsx
'use client';
const [error, setError] = useState<string | null>(null);
const queryClient = useQueryClient();
const mutation = useMutation({
  mutationFn: uploadBatch,
  onSuccess: (batch) => {
    queryClient.invalidateQueries({ queryKey: ['batches'] });
    toast.success(`Lote ${batch.external_code} ingresado · ${batch.rows_imported.toLocaleString('en-US')} órdenes`);
    onClose();
  },
  onError: (err) => {
    if (err instanceof ApiError) {
      const body = err.body as { message?: string } | null;
      setError(body?.message ?? 'No se pudo subir el lote');
    } else {
      setError('Error de red. Intenta de nuevo.');
    }
  },
});

function pickFile(file: File) {
  if (!/\.xlsx$/i.test(file.name)) return setError('Formato no soportado. Solo .xlsx.');
  if (file.size > 10 * 1024 * 1024) return setError('Archivo excede 10 MB.');
  if (file.size === 0) return setError('Archivo vacío.');
  setError(null);
  mutation.mutate({ file });
}

const stage: 'idle' | 'pending' = mutation.status === 'pending' ? 'pending' : 'idle';
```

Render por stage:
- `'idle'` → `<UploadBatchDropzone onPickFile={pickFile} error={error} />`
- `'pending'` → `<UploadBatchUploading filename={mutation.variables?.file.name} />`

Modal envoltorio:
- Backdrop: `fixed inset-0 bg-black/45 flex items-start justify-center pt-12 z-50`
- Card: `bg-card rounded-xl w-full max-w-[680px] overflow-hidden`
- Click backdrop → `onClose()` (cancela apertura, NO cancela una mutation en progreso)

### `<UploadBatchDropzone>`

Replica el design `c49dcc84-...` del extracted folder:
- Drag/drop con `onDragOver` / `onDragLeave` / `onDrop`
- Click → `inputRef.current.click()`
- Input `type="file" accept=".xlsx" hidden`
- "Excel-ish glyph" (replicado del design: 46×54 cuadrado con label `XLS` verde)
- Texto: "Arrastra el archivo o haz click para seleccionarlo" + "Acepta .xlsx · hasta 10 MB"
- Si `error` prop está set → mensaje en rojo encima del dropzone
- Footer: card con "¿No tienes la plantilla?" + botón "Descargar plantilla" disabled (Slice 2 no implementa download)
- `<UploadBatchRecent>` debajo

### `<UploadBatchUploading>`

Spinner centrado (CSS keyframe `@keyframes spin` en `globals.css` o inline). Texto: "Subiendo {filename}…" + "Validando estructura, duplicados y reglas de negocio".

### `<UploadBatchRecent>`

Lista los 3 lotes más recientes (`useQuery` con `select: data => data.data.slice(0, 3)` o un fetch separado). Si vacío → no renderiza.

```
Lote 00086     hace 7 días · María          45,389 órdenes
Lote 00085     hace 14 días · Pedro         12,140 órdenes
```

### `<Pill>` primitivo

Definido en `components/ui/pill.tsx`. Variants: success/warn/info/neutral/sweep. Cada variant mapea a clases Tailwind con tokens del design (`bg-green-bg`, `text-green-text`, etc.).

---

## API Layer

### `lib/api/client.ts` cambio

**Diff actual:**
```ts
if (!headers.has('content-type') && init?.body) {
  headers.set('content-type', 'application/json');
}
```

**Nuevo:**
```ts
if (
  !headers.has('content-type') &&
  init?.body &&
  !(init.body instanceof FormData)
) {
  headers.set('content-type', 'application/json');
}
```

Razón: cuando `body` es `FormData`, el browser setea automáticamente `multipart/form-data; boundary=...`. Si forzamos `application/json` rompemos el upload.

### `lib/api/batches.ts`

```ts
import { apiFetch } from './client';
import type { BatchListResponse, BatchStatus, BatchSummary, UploadBatchInput } from '@/lib/types/batch';

interface ListBatchesQuery {
  limit?: number;
  offset?: number;
  status?: BatchStatus;
}

export async function listBatches(query: ListBatchesQuery = {}): Promise<BatchListResponse> {
  const params = new URLSearchParams();
  if (query.limit !== undefined) params.set('limit', String(query.limit));
  if (query.offset !== undefined) params.set('offset', String(query.offset));
  if (query.status) params.set('status', query.status);
  const qs = params.toString();
  return apiFetch<BatchListResponse>(`/api/batches${qs ? '?' + qs : ''}`, { method: 'GET' });
}

export async function uploadBatch(input: UploadBatchInput): Promise<BatchSummary> {
  const fd = new FormData();
  fd.set('file', input.file);
  if (input.externalCode) fd.set('external_code', input.externalCode);
  return apiFetch<BatchSummary>('/api/batches', { method: 'POST', body: fd });
}
```

### `lib/types/batch.ts`

```ts
export type BatchStatus = 'uploaded' | 'parsing' | 'imported' | 'rejected' | 'archived';

export interface BatchSummary {
  id: string;
  external_code: string;
  status: BatchStatus;
  rows_imported: number;
  rows_rejected: number;
  total_orders_amount: string;
  total_installments_amount: string;
  imported_at: string | null;
  rejection_reason: string | null;
  uploaded_at: string | null;
  uploaded_by: { id: string; email: string; full_name: string } | null;
}

export interface BatchListResponse {
  data: BatchSummary[];
  total: number;
  limit: number;
  offset: number;
}

export interface UploadBatchInput {
  file: File;
  externalCode?: string;
}
```

---

## Permissions

### Map hardcoded en el front (Slice 2)

```ts
// lib/permissions/has-permission.ts
import type { MeUser } from '@/lib/api/me';

type Role = MeUser['role'];

const ROLE_PERMISSIONS: Record<Role, ReadonlySet<string>> = {
  operator: new Set([
    'batch.read', 'batch.upload',
    'certificate.read', 'certificate.create',
    'investor.read', 'investor.write',
    'order.read', 'audit.read',
  ]),
  admin: new Set([/* same as operator + admin-only keys */]),
  auditor: new Set([
    'batch.read', 'certificate.read', 'order.read',
    'audit.read', 'investor.read',
  ]),
};

export function hasPermission(role: Role, permission: string): boolean {
  return ROLE_PERMISSIONS[role].has(permission);
}
```

**Limitación documentada**: este map duplica la matriz que vive en `cfb.role_permissions` del back. Si un admin edita la matriz en runtime (Slice 5c del back), el front no se entera. **Slice 5+ del front**: el back debe exponer permisos efectivos en `/api/me` y el front los consume directo. Por ahora, esto es suficientemente bueno: los roles no se redefinen frecuentemente.

### `useUser()` hook + `<UserProvider>`

```tsx
// lib/auth/user-context.tsx
'use client';
import { createContext, useContext, type ReactNode } from 'react';
import type { MeUser } from '@/lib/api/me';

const UserContext = createContext<MeUser | null>(null);

export function UserProvider({ user, children }: { user: MeUser; children: ReactNode }) {
  return <UserContext.Provider value={user}>{children}</UserContext.Provider>;
}

export function useUser(): MeUser {
  const user = useContext(UserContext);
  if (!user) throw new Error('useUser must be used inside <UserProvider>');
  return user;
}
```

`(app)/layout.tsx` envuelve `<AppShell user={user}>` con `<UserProvider value={user}>` (o `<AppShell>` lo envuelve internamente — equivalente).

---

## Testing Strategy

### Unit tests

| File | Coverage |
|---|---|
| `lib/format/money.test.ts` | `fmtMoney(1132418)` → `'$1,132,418'`. Decimals si no es entero. Negatives. Zero. |
| `lib/format/date.test.ts` | ISO → DD/MM/YYYY. `null` → `'—'`. Invalid date → `'—'`. |
| `lib/permissions/has-permission.test.ts` | role × permission matrix. Operator tiene `batch.upload`, auditor no. |
| `lib/api/batches.test.ts` | `listBatches` URL building (con/sin query params). `uploadBatch` construye FormData con `file` y opcional `external_code`. Mocks `apiFetch`. |
| `lib/api/client.test.ts` (extender) | FormData body → no `content-type` header. JSON body → sí header. |
| `components/ui/pill.test.tsx` | Cada variant aplica las clases correctas. Render children. |
| `components/batches/batch-status-pill.test.tsx` | Cada `BatchStatus` → label español + variant correctas. |
| `components/batches/batch-row.test.tsx` | Renderiza external_code mono. fmtDate del uploaded_at. uploaded_by null → '—'. Numbers tabular. |
| `components/batches/upload-button.test.tsx` | role=operator → renderiza. role=auditor → null. Click llama onClick. (Mock `useUser`.) |
| `components/batches/batches-table.test.tsx` | Loading state. Error state. Empty state. Success → N rows. (Usa `renderWithQuery` + mock de `listBatches`.) |
| `components/batches/upload-batch-modal.test.tsx` | (1) Drag/drop activa visual. (2) File inválido → error inline, no mutation. (3) File válido → mutation llamada. (4) onSuccess → onClose + invalidate. (5) onError 4xx → mensaje del back. (6) Network error → mensaje genérico. |
| `lib/auth/user-context.test.tsx` | useUser fuera de provider → throws. Dentro → returns user. |

### Integration

`app-shell.test.tsx` ya cubre `<UserProvider>` end-to-end implícitamente cuando agreguemos el wrap en `(app)/layout.tsx`. Si necesita ajuste, mínimo.

### Smoke post-deploy

```bash
FRONT="https://araguaney-front.vercel.app"
curl -sI "$FRONT/batches" | head -2
# 307 → /login (no cookie)
```

Visual end-to-end (browser):
1. Login operator → click "Lotes" → tabla renderiza
2. Click "Subir lote" → modal abre
3. Drag .xlsx válido (≤10MB) → spinner → toast verde + tabla refresca
4. Drag .pdf → error inline, modal queda abierto
5. Login auditor → no aparece "Subir lote"

---

## Tech Stack (sin cambios respecto a Slice 1)

| Decisión | Valor |
|---|---|
| Framework | Next.js 16 + App Router |
| UI | shadcn/ui base-nova + Tailwind v4 (tokens del Slice 1) |
| Data fetching | **TanStack Query** (entra a uso real aquí) |
| Toasts | sonner (verificar si shadcn ya lo trajo, instalar si no) |
| Tests | Vitest + Testing Library |
| Hand-typed shapes | sí, follow-up para back: `@ApiResponse` decorators |

---

## Criterios de éxito

- ✅ `/batches` renderiza con tabla + sidebar
- ✅ Tabla muestra columnas correctas con format apropiado
- ✅ Status pills con colores correctos por estado
- ✅ Loading/error/empty states funcionan
- ✅ "Subir lote" visible para operator/admin, oculto para auditor
- ✅ Modal abre/cierra correctamente
- ✅ Drag/drop con feedback visual
- ✅ File inválido (extension/size/empty) → error inline, no se manda al back
- ✅ File válido → POST → success → toast + tabla refresca
- ✅ Errores del back (4xx) → mensaje inline
- ✅ TanStack Query cachea + invalidate funciona
- ✅ FormData se manda sin override de content-type
- ✅ `pnpm typecheck && pnpm lint:check && pnpm test && pnpm build` 0 errores
- ✅ CI verde, Vercel deploy verde
- ✅ Smoke en producción pasa con un .xlsx real

---

## Follow-ups documentados

| Item | Owner | Slice |
|---|---|---|
| Back: agregar `@ApiResponse` decorators a `/api/batches*` | back | back hotfix |
| Back: endpoint `POST /api/batches/validate` (preview-only) | back | back Slice 6+ |
| Back: endpoint `GET /api/batches/template` (download Excel) | back | back Slice 6+ |
| Back: exponer permisos efectivos en `/api/me` | back | back Slice 6+ |
| Front: detail page `/batches/{id}` con import errors | front | Slice 2b |
| Front: filter pills + pagination UI | front | Slice 2b |
| Front: 3-stage preview-then-confirm UX | front | Slice 2c (depende back validate endpoint) |
| Front: DataTable reusable | front | cuando un segundo lugar lo necesite |

---

## Referencias

- Spec del front Slice 1: `2026-05-08-front-slice-1-app-shell-design.md`
- Plan del front Slice 1: `2026-05-08-front-slice-1-app-shell.md`
- Mockup upload modal: `araguaney_front/design/_extracted/c49dcc84-99c9-49b0-9e7d-fab6502b5e61.js`
- Mockup mock data + helpers: `araguaney_front/design/_extracted/cac2320f-20cb-4f24-a9ec-6b815a661a33.js`
- Back batches controller: `araguaney_back/src/modules/batches/batches.controller.ts`
- Back batch summary mapper: `araguaney_back/src/modules/batches/responses/batch-summary.mapper.ts`
- TanStack Query docs: https://tanstack.com/query/latest
- shadcn sonner: https://ui.shadcn.com/docs/components/sonner

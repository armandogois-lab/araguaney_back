# Slice 2 — Ingestión: diseño

**Fecha**: 2026-05-06
**Autor**: armandogois@cashea.app + Claude (brainstorming)
**Estado**: en revisión
**Próximo paso**: tras aprobación, invocar writing-plans para producir el plan de implementación
**Depende de**: Slice 0 (Foundation) y Slice 1 (Auth) — ambos en `main`.

---

## 1. Objetivo

Permitir al equipo de Tesorería subir un archivo Excel semanal con órdenes BNPL de Cashea y que el backend lo parsee, valide, y persista en `cfb.orders`/`cfb.installments`/`cfb.merchants`/`cfb.end_users`. Reportar errores por fila en `cfb.import_errors` sin abortar el batch entero. Endpoint sincrónico — la respuesta del POST contiene el resultado completo.

### Por qué importa

- Sin ingestión, el sistema no tiene insumo para emitir certificados (Slice 4). Es el primer flujo de write real del backend.
- Es el primer slice que toca múltiples tablas en una transacción atómica.
- Define el contrato con el sistema BNPL fuente (formato Excel — la única interfaz que tienen).

### Fuera de alcance

- Job en background (queue + worker) — sync es suficiente para 3 ops × 1 archivo/semana.
- Edición / re-upload con corrección de errores en línea — operador genera nuevo archivo y lo sube.
- Emisión de certificados a partir de las órdenes — Slice 4.
- Endpoint para borrar/archivar batches — Slice 5+.
- Parsear `national_id` del campo `Usuario` — solo guardamos `external_hash`. Por explícita instrucción del usuario.

---

## 2. Contrato del Excel

### Estructura

- Workbook `.xlsx` (no `.xls`).
- **Una o varias hojas**. La separación entre hojas es **legacy** (cada hoja acumula ~$500 K USD de deuda) y no tiene significado lógico — el parser concatena las filas de todas las hojas.
- Primera fila no-vacía de cada hoja = headers.
- Filas posteriores = data rows. Una fila por **cuota** (no por orden — las órdenes con 3 cuotas tienen 3 filas con el mismo `Identificador de Orden`).

### Columnas (10 obligatorias, headers en español)

| # | Header en Excel | Tipo | Mapeo a DB |
|---|---|---|---|
| 1 | `Fecha de Compra` | Date | `orders.purchase_date` |
| 2 | `Usuario` | string | `end_users.external_hash` (único identificador del cliente) |
| 3 | `Rif` | string | `merchants.rif` (UNIQUE) |
| 4 | `Razón Social` | string | `merchants.current_name` |
| 5 | `Identificador de Orden` | string | `orders.external_order_id` (UNIQUE; agrupa filas en una orden) |
| 6 | `Número de Cuota` | int 1-3 | `installments.installment_number` (CHECK) |
| 7 | `Monto Total de la Orden` | Decimal | `orders.total_amount` |
| 8 | `Identificador de Cuota` | string | `installments.external_installment_id` (UNIQUE) |
| 9 | `Monto de Cuota` | Decimal | `installments.amount` |
| 10 | `Vencimiento Cuota` | Date | `installments.due_date` |

### Campos derivados (calculados por el parser)

Agrupando por `Identificador de Orden`:

- `orders.installments_sum` = SUM(`Monto de Cuota`) del grupo
- `orders.num_installments` = COUNT del grupo
- `orders.max_due_date` = MAX(`Vencimiento Cuota`) del grupo
- `orders.status` = `'available'` (default al crear)
- `installments.status` = `'pending'` (default)

### Headers — normalización para matching

Los headers se normalizan antes de comparar:
- Lowercase
- Strip accents (NFD + remove combining diacritics)
- Trim whitespace
- Collapse internal whitespace a single space

Resultado esperado (10):

```
fecha de compra
usuario
rif
razon social
identificador de orden
numero de cuota
monto total de la orden
identificador de cuota
monto de cuota
vencimiento cuota
```

Si una hoja le falta uno o más de estos headers normalizados → **el batch entero se rechaza** (no procesa ninguna fila, ni siquiera de las hojas correctas — porque concatena todas las hojas en una sola lista).

### Decimal separator

Cashea típicamente exporta en formato US (punto decimal). Pero por ser locale venezolano, podría aparecer coma decimal. **Heurística**: el parser inspecciona los primeros N valores no-vacíos de `Monto Total de la Orden` o `Monto de Cuota`:
- Si > 50% de los valores tienen coma sin punto a la derecha o tienen coma en posición decimal → asumir coma decimal.
- Si no → asumir punto decimal.
- Logueamos el separador detectado y devolvemos `decimal_separator_detected` en la response.

### Date parsing

Se intenta en orden:
1. Excel serial number (lo que devuelve `exceljs` cuando la celda tiene format Date) — convertir con `new Date(serial)`.
2. ISO `YYYY-MM-DD`.
3. `DD/MM/YYYY` (formato venezolano).

Cualquier otro formato → row error `invalid_date`.

---

## 3. Decisiones tomadas

1. **Sync, monolítico**: un solo endpoint POST recibe el archivo, parsea, persiste, y devuelve el resultado. No queue, no worker. Justificable para 3 ops × 1 upload/semana.
2. **Librería de Excel: `exceljs`** (BSD-3, sin issues de licencia, soporte nativo de `.xlsx`, streaming disponible si crece volumen).
3. **Storage: Supabase Storage**, bucket `excel-uploads` privado. El bucket lo crea el operador manualmente desde el Dashboard (CLAUDE.md prohíbe tocar `storage.*` por SQL). Backend usa `SUPABASE_SERVICE_ROLE_KEY` (bypass de RLS).
4. **Idempotencia por `content_hash`**: SHA-256 del archivo crudo. Si ya existe → 409 con referencia al batch previo.
5. **Errores por fila NO abortan el batch**: la transacción de DB sigue, las filas inválidas van a `cfb.import_errors`. El batch termina `imported` con `rows_imported < total`. Si los errores son globales (header faltante, archivo corrupto), `status='rejected'` con `rejection_reason`.
6. **Una transacción Prisma** envuelve todas las inserciones. Timeout extendido a 60s (default 5s no alcanza).
7. **`Usuario` → `external_hash` directo**, sin parsear como cédula. `national_id` queda NULL.
8. **Mensajes al cliente en español** (rules de auth en inglés siguen siendo la excepción documentada en memoria).
9. **DTOs validados con Zod** vía el `ZodValidationPipe` ya construido en Slice 1.
10. **Decimals serializados como string** en JSON para evitar pérdida de precisión.
11. **Permission keys reutilizan las existentes**: `batch.upload` (POST), `batch.read` (GETs). Ya seedeados.

---

## 4. Arquitectura

```
HTTP POST /api/batches (multipart/form-data)
    │ Authorization: Bearer <jwt>
    │ file: <xlsx>  +  external_code? (optional)
    ▼
JwtAuthGuard + PermissionsGuard('batch.upload')
    │
    ▼
BatchesController.upload()
    1. Validate multipart (1 file, .xlsx, ≤ 10 MB)
    2. Compute content_hash = sha256(buffer)
    3. SELECT cfb.excel_uploads WHERE content_hash = ?
       → if found → 409 with existing_batch_id
    4. Storage.upload(bucket='excel-uploads', path=uuid+'.xlsx', buffer)
    5. INSERT cfb.excel_uploads
    6. INSERT cfb.batches (status='uploaded')
    7. await IngestionService.parseAndImport(batchId, fileBuffer)
    8. Return assembled response (sección 6)

IngestionService.parseAndImport(batchId, buffer)
  prisma.$transaction([...], { timeout: 60_000 })
    a. UPDATE batches SET status='parsing'
    b. ExcelParserService.parse(buffer)
        → returns { rows, sheetMeta, decimalSeparator } OR { fatal: 'header_missing'|'corrupted', detail }
    c. If fatal → throw to break tx; catch outside tx → UPDATE status='rejected', rejection_reason
    d. Validate per-row (10 rules) → split into validRows + invalidRows[]
    e. Group validRows by external_order_id
    f. Validate per-group (8 cross-row rules) → drop invalid groups
    g. Validate against DB existing keys → drop colliding groups
    h. For each remaining group:
       - Lookup-or-create Merchant (rif), name history if changed
       - Lookup-or-create EndUser (external_hash)
       - INSERT Order (with derived installments_sum/num_installments/max_due_date)
       - INSERT all installments
    i. INSERT all collected errors (rows + groups + collisions) into cfb.import_errors
    j. UPDATE batches SET status='imported',
       rows_imported=count(orders), rows_rejected=count(errors),
       totals=SUM(...), imported_at=now()
```

---

## 5. Componentes

### Estructura de archivos

```
src/modules/batches/
  batches.module.ts
  batches.controller.ts                 ← POST + GETs
  batches.controller.test.ts
  batches.service.ts                    ← orchestration: hash, storage, batch row, calls ingestion
  batches.service.test.ts
  ingestion.service.ts                  ← the big one: tx, parse coordination, validations, inserts
  ingestion.service.test.ts
  excel-parser.service.ts               ← exceljs wrapper, headers, decimal heuristic, types
  excel-parser.service.test.ts
  rif-normalizer.ts                     ← pure fn: any RIF format → canonical
  rif-normalizer.test.ts
  storage.service.ts                    ← Supabase Storage wrapper (upload, download, exists)
  storage.service.test.ts               ← mocked supabase client
  external-code-generator.ts            ← pure fn: () => 'B-YYYYMMDD-HHmmss'
  types.ts                              ← ParsedRow, ParsedGroup, ValidationError, etc.
  errors/
    error-codes.ts                      ← string enum: 'missing_field' | 'invalid_amount' | ...
    error-messages.es.ts                ← code → Spanish message factory
  dto/
    batch-list-query.dto.ts             ← Zod schema
    batch-errors-query.dto.ts           ← Zod schema
    batch-upload-response.dto.ts        ← TS type for response shape

src/modules/batches/responses/
  batch-summary.mapper.ts               ← Prisma row → API response shape (Decimal → string)
  import-error.mapper.ts                ← idem for import_errors

test/fixtures/excel/
  (built dynamically in tests via test/helpers/xlsx.helper.ts — no committed binaries)

test/helpers/
  xlsx.helper.ts                        ← buildWorkbook({ sheets: [{ name, headers, rows }] }) → Buffer
  storage.helper.ts                     ← in-memory Supabase Storage mock
```

### Tipos clave (`batches/types.ts`)

```ts
export type ParsedCell = string | number | Date | null;

export type ParsedRow = {
  sheetName: string;
  rowNumber: number;       // 1-indexed in sheet (header = 1, first data row = 2)
  fechaDeCompra: Date | null;
  usuario: string | null;
  rif: string | null;       // raw, pre-normalization
  razonSocial: string | null;
  identificadorDeOrden: string | null;
  numeroDeCuota: number | null;
  montoTotalDeLaOrden: string | null;  // raw — parser keeps string for downstream Decimal coercion
  identificadorDeCuota: string | null;
  montoDeCuota: string | null;
  vencimientoCuota: Date | null;
};

export type ValidationError = {
  sheetName: string;
  rowNumber: number;
  fieldName: string | null;        // null for cross-row / group-level errors
  errorCode: ErrorCode;
  errorMessage: string;            // Spanish
  rawValue: string | null;
};

export type ParsedGroup = {
  externalOrderId: string;
  rif: string;            // canonicalized
  razonSocial: string;
  fechaDeCompra: Date;
  usuarioHash: string;
  montoTotalDeLaOrden: string;     // Decimal-as-string
  installments: Array<{
    rowNumber: number;
    sheetName: string;
    externalInstallmentId: string;
    installmentNumber: number;
    amount: string;
    dueDate: Date;
  }>;
};

export type ParseResult =
  | { kind: 'fatal'; reason: string }   // header missing, corrupted, no rows
  | { kind: 'parsed'; rows: ParsedRow[]; sheets: string[]; decimalSeparator: 'dot' | 'comma' };
```

### Error codes (`errors/error-codes.ts`)

```ts
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
  MERCHANT_NAME_DRIFT: 'merchant_name_drift',  // warning, no se descarta el grupo

  // DB collision
  ORDER_ALREADY_EXISTS: 'order_already_exists',
  INSTALLMENT_ALREADY_EXISTS: 'installment_already_exists',
} as const;
export type ErrorCode = typeof ErrorCodes[keyof typeof ErrorCodes];
```

---

## 6. Endpoints (forma exacta)

### `POST /api/batches`

Auth: `@RequirePermission('batch.upload')`.

Request multipart:
```
file: <xlsx>          required
external_code?        optional, ≤ 20 chars, regex /^[A-Z0-9-]+$/
```

Response (200, regardless of imported|rejected):

```jsonc
{
  "batch_id": "uuid",
  "external_code": "B-20260506-103245",
  "excel_upload_id": "uuid",
  "status": "imported",
  "rows_imported": 432,
  "rows_rejected": 18,
  "total_orders_amount": "152340.5000",
  "total_installments_amount": "114255.3800",
  "imported_at": "2026-05-06T10:32:48.123Z",
  "rejection_reason": null,
  "decimal_separator_detected": "dot",
  "errors_preview": [
    {
      "sheet_name": "CFB_1_Comuna",
      "row_number": 142,
      "field_name": "monto de cuota",
      "error_code": "invalid_amount",
      "error_message": "Monto inválido: 'NA'"
    }
  ],
  "errors_total": 18
}
```

`errors_preview`: first 50. If `errors_total > 50`, fetch rest via `/errors` endpoint.

Status codes:
- 200 — upload procesado (sea `imported` o `rejected`).
- 400 — multipart inválido (file ausente, mime malo, > 10 MB, `.xls`).
- 401 / 403 — auth.
- 409 — duplicate `content_hash`. Body: `{ "message": "Archivo ya fue subido", "existing_batch_id": "uuid" }`.
- 500 — error técnico inesperado (storage down, DB down, etc.).

### `GET /api/batches`

Auth: `@RequirePermission('batch.read')`.

Query (Zod):

```ts
{
  status?: 'uploaded'|'parsing'|'imported'|'rejected'|'archived',
  from?: ISO date,           // imported_at >= from
  to?: ISO date,             // imported_at <= to
  uploaded_by_id?: UUID,
  limit?: 1..200 (default 50),
  offset?: >=0 (default 0)
}
```

Response:

```jsonc
{
  "data": [ { /* batch summary, see below */ } ],
  "total": 12,
  "limit": 50,
  "offset": 0
}
```

Sort: `imported_at DESC NULLS LAST, uploaded_at DESC`.

Batch summary:
```jsonc
{
  "id": "uuid",
  "external_code": "B-20260506-103245",
  "status": "imported",
  "rows_imported": 432,
  "rows_rejected": 18,
  "total_orders_amount": "152340.5000",
  "total_installments_amount": "114255.3800",
  "imported_at": "2026-05-06T10:32:48.123Z",
  "rejection_reason": null,
  "uploaded_at": "2026-05-06T10:32:30.001Z",
  "uploaded_by": {
    "id": "uuid",
    "email": "tesoreria.ops@cashea.app",
    "full_name": "..."
  }
}
```

### `GET /api/batches/:id`

Auth: `@RequirePermission('batch.read')`.
Response: igual a un elemento de `data` con `errors_total: number` extra.
404 si el id no existe.

### `GET /api/batches/:id/errors`

Auth: `@RequirePermission('batch.read')`.

Query:
```ts
{
  error_code?: string,
  limit?: 1..500 (default 100),
  offset?: >=0 (default 0)
}
```

Response:
```jsonc
{
  "data": [
    {
      "id": "uuid",
      "sheet_name": "CFB_1_Comuna",
      "row_number": 142,
      "field_name": "monto de cuota",
      "error_code": "invalid_amount",
      "error_message": "Monto inválido: 'NA'",
      "raw_value": "NA",
      "created_at": "2026-05-06T10:32:48.001Z"
    }
  ],
  "total": 18,
  "limit": 100,
  "offset": 0
}
```

404 si el batch no existe.

---

## 7. Validaciones (resumen consolidado)

### Por fila (cualquiera falla → fila a `import_errors`, sigue procesando)

| Campo | Regla | error_code |
|---|---|---|
| Cualquier requerido | No vacío | `missing_field` |
| `fecha de compra` | Date parseable; ≤ today | `invalid_date` / `purchase_date_future` |
| `usuario` | Trimmed non-empty, ≤ 255 | `missing_field` / `field_too_long` |
| `rif` | Match `^[VEJGP]-?\d{8,10}-?\d$` (case-insensitive); normalizado a `J-XXXXXXXXX-X` | `invalid_rif` |
| `razon social` | Non-empty, ≤ 255 | |
| `identificador de orden` | Non-empty, ≤ 100 | |
| `numero de cuota` | Int ∈ {1, 2, 3} | `invalid_installment_number` |
| `monto total de la orden` | Decimal > 0 | `invalid_amount` |
| `identificador de cuota` | Non-empty, ≤ 100 | |
| `monto de cuota` | Decimal > 0 | `invalid_amount` |
| `vencimiento cuota` | Date ≥ `fecha de compra` | `invalid_date` / `due_before_purchase` |

### Por grupo (mismo `identificador de orden`; falla → grupo entero a `import_errors`)

| Regla | error_code |
|---|---|
| Mismo `rif` (canonicalizado) en todas | `inconsistent_merchant` |
| Misma `fecha de compra` | `inconsistent_purchase_date` |
| Mismo `usuario` | `inconsistent_end_user` |
| Mismo `monto total de la orden` | `inconsistent_total` |
| `razon social` igual | `merchant_name_drift` (WARNING — usa el primero, NO descarta) |
| Tamaño ∈ {1, 2, 3} | `invalid_installment_count` |
| `numero de cuota` distintos y consecutivos desde 1 | `installment_numbers_not_contiguous` |
| `identificador de cuota` único en el grupo | `duplicate_installment_id_in_order` |

### Contra DB (antes de insertar, falla → grupo entero a `import_errors`)

| Regla | error_code |
|---|---|
| `external_order_id` no existe en `cfb.orders` | `order_already_exists` |
| ningún `external_installment_id` existe en `cfb.installments` | `installment_already_exists` |

### Globales (falla → batch entero `rejected`, no procesa nada)

- Header obligatorio faltante
- Workbook corrupto / no es un .xlsx válido
- 0 hojas / 0 data rows en total
- Storage upload falla (no llega a parsear)

---

## 8. Observabilidad

Logs Pino en inglés con request-id + userId correlados:

```
{ msg: 'batch upload received', userId, batchId, fileSize, contentHash, externalCode }
{ msg: 'storage upload', batchId, bucket: 'excel-uploads', path, sizeBytes, durationMs }
{ msg: 'parse started', batchId, sheets: [...], rowsTotal }
{ msg: 'decimal separator detected', batchId, separator: 'dot'|'comma', sampleValues: [...3] }
{ msg: 'parse completed', batchId, status, rowsImported, rowsRejected,
  errorsByCode: { invalid_amount: 5, ... }, durationMs }
```

A nivel `error`: `{ msg: 'storage failure', batchId, err }` con stack.

**No se loguea**:
- Contenido del archivo crudo
- Filas individuales (RIF, montos, identificadores son datos sensibles)
- `external_hash` del usuario en eventos info; sí en debug si necesario para troubleshooting

---

## 9. Tests (Vitest)

### Fixtures

`test/helpers/xlsx.helper.ts`:
```ts
export function buildWorkbook(opts: {
  sheets: Array<{
    name: string;
    headers: string[];
    rows: Array<(string | number | Date | null)[]>;
  }>;
}): Promise<Buffer>;
```

Crea workbooks programáticamente. No commiteamos binarios `.xlsx` al repo.

### Cobertura

| Archivo | Tipo | Casos |
|---|---|---|
| `excel-parser.service.test.ts` | unit | Header normalization (accent/case/spaces), parse multi-sheet, decimal detection (dot/comma/ambiguous), date parsing (3 formatos), 10 row validations, 8 cross-row validations | ~25 |
| `rif-normalizer.test.ts` | unit | `J-XXXXXXXXX-X`, `J-XXXXXXXXX`, `J123456789`, `j-12345678-9`, padding | ~6 |
| `ingestion.service.test.ts` | unit (Prisma mockeado) | happy path, merchant exists same/diff name, end_user create/reuse, order_already_exists, transaction rollback on storage failure | ~10 |
| `external-code-generator.test.ts` | unit | format `B-YYYYMMDD-HHmmss`, monotonic | 2 |
| `storage.service.test.ts` | unit (supabase client mockeado) | upload happy, upload failure | 3 |
| `batches.controller.test.ts` | integration | POST sin auth (401), sin permission (403), sin file (400), .xls (400), > 10 MB (400), happy 200, header faltante 200/rejected, duplicate hash 409, **errors_preview capped at 50 when errors_total > 50**, GET list filters, GET detail 404, GET errors paginated/filtered | ~13 |

**Total**: ~59 tests nuevos. Sumado a 31 existentes = **~90 al cierre**.

Sin tests E2E contra Supabase Storage real en este slice — mockeamos el cliente. Smoke test al final del slice valida end-to-end con un archivo de muestra real.

---

## 10. Setup manual previo (operador / admin)

CLAUDE.md prohíbe tocar `storage.*` desde migraciones SQL. Antes del primer deploy / primer POST:

1. **Supabase Dashboard → Storage → New bucket**
   - Name: `excel-uploads`
   - Public: **OFF**
   - File size limit: 10 MB
   - Allowed MIME types: `application/vnd.openxmlformats-officedocument.spreadsheetml.sheet`
2. (Sin policies adicionales — el backend usa `SUPABASE_SERVICE_ROLE_KEY` que bypasea RLS de storage.)

Documentado en `infra/sql/README.md` como prerequisito de operación.

---

## 11. Dependencias nuevas

- `exceljs` (production) — Excel parsing.
- `@supabase/supabase-js` (production) — `StorageClient` para upload. Verificar si ya existe en `package.json`; si no, agregar.
- `multer` (production) y `@types/multer` (dev) — peer de `@nestjs/platform-express` para multipart. Verificar si ya existe; si no, agregar.

(Verificación literal en el plan: `node -e "['exceljs','@supabase/supabase-js','multer'].forEach(p => { try { require.resolve(p); console.log(p, 'OK'); } catch { console.log(p, 'MISSING'); } })"`.)

---

## 12. Criterios de aceptación

1. `pnpm test` corre con ~58 tests nuevos verdes.
2. Bucket `excel-uploads` creado manualmente en Supabase.
3. `POST /api/batches` con archivo válido de muestra → 200 con `status='imported'`. Verificación en Prisma Studio: rows en `cfb.orders`, `cfb.installments`, `cfb.merchants`, `cfb.end_users`.
4. Re-subir el mismo archivo → 409 con `existing_batch_id`.
5. Archivo con header faltante → 200 con `status='rejected'` y `rejection_reason` listando los headers faltantes.
6. Archivo con algunas filas inválidas → 200 con `status='imported'`, `rows_imported < total`, `errors_preview` poblado.
7. `GET /api/batches?status=imported` → lista paginada con counters.
8. `GET /api/batches/:id/errors?error_code=invalid_amount` → filtra y pagina.
9. `pnpm typecheck` y `pnpm lint` clean.
10. `pnpm openapi:export` regenera `openapi.json` con los 4 endpoints + el upload multipart documentado.

---

## 13. Riesgos y mitigaciones

| Riesgo | Mitigación |
|---|---|
| Source system cambia nombres de columnas → todos los uploads fallan | `rejection_reason` lista columnas faltantes con nombres exactos; el operador alerta a IT/BNPL ops sin bucear logs |
| Heurística de decimal separator se equivoca | Log explícito + `decimal_separator_detected` en response; operador puede comparar con la realidad. Override manual queda como follow-up |
| Bucket `excel-uploads` no existe al primer POST | Storage upload devuelve 500 con mensaje claro; documentado como prerequisito en `infra/sql/README.md` |
| Transacción Prisma timeout en archivo grande (10K+ orders) | `$transaction([...], { timeout: 60_000 })` extiende default 5s → 60s |
| Memory peak por buffer en RAM | Aceptable para ≤ 10 MB ya validado. Si crece, exceljs ofrece streaming → futura iteración |
| Filas patológicas pasan validación (ej. `installments_sum > total_amount`) | Slice 2 las acepta (no es un blindaje en DB). Quedan visibles en logs si hay drift. Slice 4 (emisión) decide qué hacer |
| Operador sube `.xls` (formato viejo) | 400 explícito antes de tocar el filesystem |
| Race entre 2 operadores subiendo el mismo archivo simultáneamente | Ambos calculan el mismo hash; el primero que llega al INSERT en `excel_uploads` gana; el segundo recibe el 409 vía la consulta previa o vía la unique constraint en DB. Aceptable. |

---

## 14. Siguiente paso

Tras la aprobación del usuario sobre este spec → invocar `superpowers:writing-plans`.

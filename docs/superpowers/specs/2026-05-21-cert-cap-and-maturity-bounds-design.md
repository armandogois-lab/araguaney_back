# Design — Cert nominal cap (3M USD) + Maturity bounds bilateral

**Fecha:** 2026-05-21
**Autor:** Brainstorming session (armandogois@cashea.app + Claude)
**Tipo:** Reglas de negocio del producto (mismo tier que las 3 reglas duras existentes)
**Estado:** Aprobado por usuario — listo para `writing-plans`

## Resumen ejecutivo

Agregar **dos reglas de negocio invariantes** al sistema CFB, blindadas en código, schema y CLAUDE.md:

1. **Maturity bounds bilateral** — toda cuota de una orden debe vencer dentro de `[cert.issue_date, cert.maturity_date]`. La regla existente "Maturity boundary" (CLAUDE.md) solo cubre el borde superior; agregamos el inferior.
2. **Max nominal por cert (3M USD) con auto-split** — ningún certificado puede tener `nominal_target > cfb.settings.max_cert_nominal_usd`. Si la emisión calculada supera el cap, el sistema crea automáticamente N certificados hermanos (mismo NNNN, letras A/B/C…) que se aprueban y cancelan en bloque.

El trabajo se entrega en **dos slices secuenciales** (Enfoque B):
- **Slice 1** — Maturity bounds (chico, ~1 día).
- **Slice 2** — Cap 3M con auto-split (grande, ~3-5 días).

---

## Contexto y motivación

CLAUDE.md hoy documenta 3 reglas duras del producto:
1. Maturity boundary (cuota ≤ vencimiento cert) — borde superior solo.
2. Order indivisibility (UNIQUE en `certificate_orders.order_id`).
3. Round-down only (suma de cuotas ≤ `nominal_target`).

Esta sesión agrega:
- La **mitad faltante** de la regla 1 (borde inferior).
- Una **regla 4** nueva (cap de nominal con split).

Ambas son requisitos del flujo operativo de Tesorería y de la coherencia regulatoria con Mercantil Merinvest / SUNAVAL. Se documentan en el mismo nivel que las 3 reglas duras existentes porque son **inviolables** y deben blindarse en código + DB + tests.

---

## Slice 1 — Maturity bounds completos

### Objetivo
Garantizar (código y DB) que toda cuota de las órdenes asignadas a un cert cumple:
```
cert.issue_date ≤ installment.due_date ≤ cert.maturity_date
```

### Trabajo

1. **Auditoría del blindaje actual del borde superior (1a):**
   - Localizar dónde se enforza hoy: trigger en `cfb.certificate_orders`, CHECK constraint, o filtro en `eligibility` query del back.
   - Documentar las capas existentes en un comentario del PR.

2. **Agregar blindaje del borde inferior (1b):**
   - **DB:** migración nueva `infra/sql/015_maturity_lower_bound.sql` con trigger en `cfb.certificate_orders` BEFORE INSERT que verifica `MIN(installments.due_date) >= cert.issue_date`. Patrón espejo al de 1a.
   - **Back:** ajustar el query de elegibilidad en `certificates.service.ts` (simulate + issue) y `sweep.service.ts` para excluir órdenes con cuotas anteriores a `issue_date`.
   - **Tests:**
     - Unit: el filtro de elegibilidad descarta órdenes con cuotas past-due.
     - Integration: INSERT directo en `certificate_orders` con cuota past-due → trigger rechaza con error claro.

3. **Actualizar CLAUDE.md** — reemplazar:
   > Maturity boundary: Ninguna cuota puede vencer después del vencimiento del certificado.

   por:
   > Maturity boundary: Toda cuota debe vencer dentro de `[cert.issue_date, cert.maturity_date]`. Ninguna cuota puede ser anterior al inicio del cert ni posterior al vencimiento.

### Esfuerzo
~1 día. Una PR.

### Riesgos
- Si hay órdenes históricas que violan 1b ya asignadas a certs emitidos, el trigger no las afecta (solo nuevos INSERT). No bloquea el deploy.
- Si la auditoría revela que 1a tampoco está blindada en DB (solo filtro de query), agregamos el trigger upper bound en la misma migración.

---

## Slice 2 — Cap 3M con auto-split

### 2.1 Settings entry

```sql
INSERT INTO cfb.settings (key, value, description) VALUES (
  'max_cert_nominal_usd',
  '3000000',
  'Tope máximo de nominal en USD por certificado. Si la emisión supera, el sistema hace auto-split en N certs hermanos.'
);
```

El cap es ajustable sin redeploy. Cached en memoria con TTL corto (~60s) para no consultar settings en cada simulate.

### 2.2 Schema `cfb.certificates` — 2 columnas nuevas

- `split_total INT NOT NULL DEFAULT 1` — total de certs en el grupo (1 = standalone).
- `split_index SMALLINT NOT NULL DEFAULT 0` — posición en el grupo (0=A, 1=B, …). Corresponde a la `letra` del código.

**Sin** columna `split_group_id`: el grupo se identifica por el `nnnn` compartido. Aprovecha el patrón existente y evita una columna nueva.

Migración: `infra/sql/016_cert_split_columns.sql`.

### 2.3 UNIQUE constraints

- **Verificar / agregar:** `UNIQUE (nnnn, letra)` en `cfb.certificates`.
- **Modificar `uq_certs_one_sweep_per_cycle`:**
  - **Antes:** `UNIQUE (cycle_week) WHERE certificate_type='sweep' AND deleted_at IS NULL AND status<>'cancelled'`
  - **Después:** `UNIQUE (cycle_week, nnnn) WHERE certificate_type='sweep' AND deleted_at IS NULL AND status<>'cancelled'`

  Esto permite **1 grupo** de sweep por ciclo (con N letras), pero rechaza dos sweeps independientes en la misma semana.

### 2.4 CHECK constraint en `nominal_target`

```sql
ALTER TABLE cfb.certificates
  ADD CONSTRAINT chk_nominal_under_cap
  CHECK (nominal_target <= cfb.get_max_cert_nominal());
```

Función `cfb.get_max_cert_nominal()` lee el setting. Defensa en profundidad: aunque el servicio falle en partir, el CHECK rechaza el INSERT.

### 2.5 Algoritmo de split (greedy fill)

```
N_splits = ceil(target_nominal / cap)
for i in 0..N-1:
  splits[i].nominal = min(cap, remaining)
  remaining -= splits[i].nominal
```

**Distribución de órdenes** respetando order-indivisibility:
1. Llenar bucket 0 con órdenes hasta llegar a `splits[0].nominal` (round-down).
2. Si la siguiente orden no entra → saltar al bucket 1.
3. Continuar hasta agotar órdenes o buckets.

**Capital del inversor por cert:** `capital_i = nominal_i × price`. La suma == capital total (con round-down a 4 decimales). El gap entre suma de nominales y `target` se devuelve en cash al inversor (mismo principio que round-down hoy).

### 2.6 `SplitterService` (nuevo, compartido)

`src/modules/issuance/shared/splitter.service.ts` — lógica pura, sin DB.

```ts
interface SplitInput {
  target_nominal: Decimal;
  cap: Decimal;
  price: Decimal;
  candidate_orders: OrderWithSum[];
}

interface SplitOutput {
  splits: Array<{
    nominal: Decimal;
    investor_capital: Decimal;
    orders: OrderId[];
  }>;
  total_assigned_nominal: Decimal;
  shortfall_nominal: Decimal;
}

split(input: SplitInput): SplitOutput
```

Reutilizado por `CertificatesService` y `SweepService`.

### 2.7 `CertificatesService.issue()` — flujo modificado

```
1. Leer max_cert_nominal_usd de settings.
2. simulate() → target_nominal.
3. Si target_nominal <= cap:    flujo actual (1 cert).
4. Si target_nominal > cap:     flujo split:
   a. splitter.split(...) → N splits.
   b. En 1 transacción atómica:
      - SELECT nextval(certificate_sequence) → nnnn.
      - Para i=0..N-1:
          INSERT cert {nnnn, letra=letter(i), split_index=i, split_total=N,
                       nominal_target=splits[i].nominal,
                       investor_capital=splits[i].investor_capital,
                       status='draft'}
          INSERT certificate_orders para cada order del bucket.
          UPDATE orders SET status='reserved' WHERE id IN (bucket).
          INSERT cert_event 'created'.
   c. Return: { group: nnnn, certs: [{id, code, nominal}, ...], status: 'draft' }
```

**Atomicidad:** si cualquier paso falla → rollback completo. No quedan drafts huérfanos ni órdenes reservadas.

### 2.8 `SweepService.issueSweep()` — mismo splitter

Idéntico patrón. Diferencias:
- Inversor siempre `kind='internal'` (CASHEA VALORES).
- Las órdenes elegibles son **todo el stock disponible**.

Un sweep con stock de 20M genera 7 borradores (C4575A..G) en una sola transacción.

### 2.9 Approval en bloque

`POST /certificates/:id/approve`:
```
En 1 TX:
  cert = findById(id)
  if cert.split_total == 1:    flujo actual.
  else:
    siblings = findAll(WHERE nnnn = cert.nnnn AND deleted_at IS NULL)
    if siblings.some(s => s.status != 'draft'):
      throw 'No todos los borradores del split están en draft'
    for each sibling:
      UPDATE cert SET status='issued', issued_at=NOW()
      UPDATE orders SET status='assigned' WHERE id IN cert.orders
      INSERT cert_event 'approved'
```

### 2.10 Cancel en bloque

`POST /certificates/:id/cancel` análogo: detecta `split_total > 1`, cancela los N siblings, libera órdenes de los N.

**pg_cron TTL job** (auto-cancel a 24h): itera drafts uno por uno; cuando topa un sibling cancela todo el grupo; el resto se va a encontrar ya en `cancelled` y los skipea.

### 2.11 Hash de payload

Hoy `expected_payload_hash` valida que el operador vio lo mismo que va a emitir. Para splits, el hash debe incluir **la estructura del split** (lista de nominales + lista de order_ids por bucket), no solo el agregado. Si el splitter genera distinta distribución entre simulate y issue (por cambio de stock), el hash no matchea y el operador re-simula.

### 2.12 Front — wizard preview del split

En `Step2Simulation` (cert wizard), si `simulation.splits.length > 1`, mostrar antes del botón Confirmar:

```
┌─ ⚠ Esta emisión generará 3 certificados ─────────┐
│ El nominal calculado (7.15M) supera el máximo de   │
│ 3M por certificado. Se crearán 3 borradores en     │
│ bloque que requieren aprobación conjunta.          │
│                                                    │
│  C4575A  3,000,000.00  2,930,000.00  4,200 órdenes │
│  C4575B  3,000,000.00  2,930,000.00  4,200 órdenes │
│  C4575C  1,150,000.00  1,123,300.00  1,610 órdenes │
└────────────────────────────────────────────────────┘
```

Misma tabla en `SweepModal` para barridos partidos.

### 2.13 Front — lista de certs

En `/certificates`, las filas hermanas se muestran como un solo grupo:
- Columna "Código": `C4575` con badge `A/B/C` o `1 de 3`.
- Click en cualquier hijo abre el **detail del grupo**.

### 2.14 Front — cert detail

Si `split_total > 1`, header con tabs hermanos + sección "Hermanos del split":
```
Split C4575  •  3 certificados  •  Total nominal: 7,150,000.00
[ C4575A ✓ 3M ] [ C4575B ✓ 3M ] [ C4575C ✓ 1.15M ]
```

Botón único **Aprobar split** (en lugar de "Aprobar este borrador") cuando todos están en draft. Botón único **Cancelar split** en bloque.

### 2.15 Tests

**Back (Vitest):**
- `splitter.service.test.ts` — targets 1M, 3M, 3.5M, 9M, 0.01M. Edge cases con order-indivisibility (orden de 2.5M en bucket que ya tiene 1M → salta al siguiente bucket).
- `certificates.service.test.ts` — emisión 7M genera 3 drafts atómicos; aprueba en bloque; cancela en bloque; hash mismatch.
- `sweep.service.test.ts` — barrido 20M genera 7 drafts; UNIQUE permite el grupo y rechaza un segundo sweep en la misma semana.

**Front (Vitest + RTL):**
- `sim-form.test.tsx` — preview muestra tabla de hijos cuando `splits.length > 1`.
- `cert-detail.test.tsx` — botón "Aprobar split" dispara aprobación en bloque.
- `sweep-modal.test.tsx` — preview con tabla de hijos.

### 2.16 Rollout

1. PR back con migration + splitter + servicios + tests.
2. Aplicar `015_maturity_lower_bound.sql` (Slice 1, prod) y `016_cert_split_columns.sql` desde Supabase SQL Editor **en orden**.
3. INSERT del setting `max_cert_nominal_usd` (incluido en `016`).
4. Deploy back (Railway).
5. PR front, deploy Vercel.
6. **Smoke test prod:** emitir cert 1M (no parte), 4M (parte en 2), aprobar/cancelar en bloque. Repetir con sweep.

---

## Updates a CLAUDE.md (post-merge)

Reglas duras del producto pasan de **3 a 4**:

1. **Maturity boundary** (bilateral): Toda cuota vence dentro de `[cert.issue_date, cert.maturity_date]`.
2. **Order indivisibility**: Una orden entra completa a un cert o no entra. UNIQUE en `cfb.certificate_orders.order_id`.
3. **Round-down only**: La suma de cuotas nunca puede exceder `nominal_target`.
4. **Max nominal per cert**: Ningún cert puede exceder `cfb.settings.max_cert_nominal_usd` (3M USD default). Si la emisión supera el cap, auto-split en N certs hermanos (mismo NNNN, letras A/B/C…) con aprobación y cancelación en bloque.

---

## Riesgos y open questions

- **Concentración de merchants en splits:** si el splitter llena por orden de llegada, cert A puede concentrar 80% en un merchant grande mientras B/C diversifican. No es problema regulatorio por ahora, pero si Mercantil lo flag, agregamos balanceo en una iteración futura (no parte de este spec).
- **Cap cambia con drafts en grupo abierto:** si Tesorería ajusta el cap a 2M con drafts ya creados (cert hermano de 3M en draft), los drafts existentes no se re-validan; al aprobar se respetan tal cual fueron creados. El nuevo cap aplica solo a emisiones futuras. Documentado en CLAUDE.md.
- **Hash de payload con N splits:** el formato del hash cambia (debe incluir estructura del split). Bumpea la versión del payload; clients viejos verán mismatch y re-simularán. No requiere migración de datos.
- **Máximo 26 splits por grupo (letras A-Z):** el código `C{NNNN}{LETRA}` usa una sola letra. Con cap=3M, 26 splits = 78M USD por emisión, prácticamente imposible. Si el splitter pide >26, el back lanza `BadRequestException('Emisión excede el máximo de 26 certificados por grupo. Reducir capital o ajustar cap.')`. Si en el futuro se necesita más, evolucionamos a doble letra (AA, AB, ...) en un ADR separado.

---

## Decisiones tomadas (no re-discutir sin ADR nuevo)

- Cap guardado en `cfb.settings`, no hardcoded.
- Auto-split silencioso con preview en el wizard (no requiere segunda confirmación explícita).
- Mismo NNNN + letras A/B/C para split (no NNNN correlativos).
- Greedy fill: 3M + 3M + 1.15M (no equal split).
- Approval **en bloque** (no individual, no híbrido).
- Cap aplica también a sweep.
- Identificador del grupo = `nnnn` compartido (no columna `split_group_id` separada).

---

## Próximo paso

Pasar este spec a la skill `writing-plans` para producir el plan de implementación detallado de Slice 1 (con checkpoints y tasks ejecutables).

# Slice 1 — Maturity Bounds Bilateral — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Garantizar (en código y DB) que toda cuota de una orden asignada a un cert vence dentro de `[cert.issue_date, cert.maturity_date]`. La regla existente "Maturity boundary" solo cubre el borde superior — agregamos el inferior.

**Architecture:** Espejo simétrico del patrón de `max_due_date` que ya existe en `cfb.orders`. Denormalizamos `min_due_date` en orders (igual que max), extendemos el trigger `enforce_maturity_boundary` para chequear ambos bordes, y filtramos en las queries de elegibilidad del back. Una sola migración SQL idempotente más cambios chicos en código + tests.

**Tech Stack:** PostgreSQL (Supabase) trigger PL/pgSQL, Prisma 5, NestJS 10, Vitest.

**Spec de referencia:** `docs/superpowers/specs/2026-05-21-cert-cap-and-maturity-bounds-design.md` — sección "Slice 1".

---

## File Structure

**Create:**
- `infra/sql/015_maturity_lower_bound.sql` — migración idempotente: ADD COLUMN `min_due_date`, backfill, NOT NULL, extender trigger.

**Modify:**
- `prisma/schema.prisma` — agregar `min_due_date DateTime @db.Date` al model `Order`.
- `src/modules/issuance/certificates/certificates.service.ts:62-71` — agregar filtro `min_due_date: { gte: issueDate }` al `findMany` de elegibles + agregar `min_due_date` al `select`.
- `src/modules/issuance/certificates/certificates.service.ts:213-222` — agregar `min_due_date` al raw SQL `SELECT ... FOR UPDATE` y al chequeo de eligibilidad en `issue()`.
- `src/modules/issuance/sweep/sweep.service.ts:55-67` — mismo filtro + select en el `findMany` de simulate.
- `src/modules/issuance/sweep/sweep.service.ts:220-227 y 256-267` — agregar `min_due_date` al raw SQL del FOR UPDATE y al `eligibleNow` de defense-in-depth.
- `src/modules/batches/ingestion.service.ts:334-380` — agregar campo `min_due_date` al tipo `ordersToCreate` y calcularlo desde `g.installments`.
- `CLAUDE.md` — actualizar texto de la regla 1.

**Test (modify):**
- `src/modules/issuance/certificates/certificates.service.test.ts` — agregar test que verifica el filtro `min_due_date: { gte: issueDate }` en `findMany`.
- `src/modules/issuance/sweep/sweep.service.test.ts` — análogo para sweep.
- `src/modules/batches/ingestion.service.test.ts` (si existe — verificar antes de Task 6) — test que orders insertadas tienen `min_due_date` calculado.

---

## Task 0: Crear branch e instalación

**Files:** ninguno (setup).

- [ ] **Step 1: Verificar rama actual y limpiar workspace**

```bash
git status
```
Expected: working tree clean en `main` o branch limpia. Si hay cambios pendientes, stash o commit primero.

- [ ] **Step 2: Crear branch desde main actualizada**

```bash
git checkout main
git pull origin main
git checkout -b feat/maturity-lower-bound
```
Expected: `Switched to a new branch 'feat/maturity-lower-bound'`.

- [ ] **Step 3: Verificar dependencias (no install necesario si ya están)**

```bash
node -v
npm ls @prisma/client | head -3
```
Expected: Node 20+, Prisma 5.x.

---

## Task 1: Migración SQL `015_maturity_lower_bound.sql`

**Files:**
- Create: `infra/sql/015_maturity_lower_bound.sql`

- [ ] **Step 1: Crear el archivo de migración**

Content:
```sql
-- 015_maturity_lower_bound.sql
-- Slice 1 / Maturity Bounds Bilateral — cierra el borde inferior de Rule 1.
-- Idempotente. Apply with: psql -f 015_maturity_lower_bound.sql o paste en Supabase SQL Editor.
-- Depends on: 003_portfolio.sql (cfb.orders, cfb.installments), 007_invariants_complete.sql
--             (cfb.enforce_maturity_boundary, trg_co_maturity_boundary).

BEGIN;

-- 1. ADD COLUMN min_due_date (nullable inicialmente para poder backfill)
ALTER TABLE cfb.orders
  ADD COLUMN IF NOT EXISTS min_due_date date;

-- 2. Backfill desde installments para órdenes existentes
UPDATE cfb.orders o
SET min_due_date = sub.min_due
FROM (
  SELECT order_id, MIN(due_date) AS min_due
    FROM cfb.installments
   GROUP BY order_id
) sub
WHERE o.id = sub.order_id
  AND o.min_due_date IS NULL;

-- 3. NOT NULL después del backfill
ALTER TABLE cfb.orders
  ALTER COLUMN min_due_date SET NOT NULL;

-- 4. Índice para la query de elegibilidad (status + min_due_date)
CREATE INDEX IF NOT EXISTS idx_orders_status_min_due
  ON cfb.orders USING btree (status, min_due_date);

-- 5. Extender el trigger de maturity boundary para chequear ambos bordes
CREATE OR REPLACE FUNCTION cfb.enforce_maturity_boundary() RETURNS trigger
LANGUAGE plpgsql AS $$
DECLARE
  v_order_max_due  date;
  v_order_min_due  date;
  v_cert_maturity  date;
  v_cert_issue     date;
BEGIN
  SELECT max_due_date, min_due_date INTO v_order_max_due, v_order_min_due
    FROM cfb.orders WHERE id = NEW.order_id;
  SELECT maturity_date, issue_date INTO v_cert_maturity, v_cert_issue
    FROM cfb.certificates WHERE id = NEW.certificate_id;

  IF v_order_max_due IS NULL OR v_order_min_due IS NULL
     OR v_cert_maturity IS NULL OR v_cert_issue IS NULL THEN
    RAISE EXCEPTION 'Datos insuficientes para validar maturity boundary'
      USING ERRCODE = 'integrity_constraint_violation';
  END IF;

  IF v_order_max_due > v_cert_maturity THEN
    RAISE EXCEPTION
      'La cuota más tardía de la orden % vence (%) después del vencimiento del certificado % (%)',
      NEW.order_id, v_order_max_due, NEW.certificate_id, v_cert_maturity
      USING ERRCODE = 'check_violation';
  END IF;

  IF v_order_min_due < v_cert_issue THEN
    RAISE EXCEPTION
      'La cuota más temprana de la orden % vence (%) antes del inicio del certificado % (%)',
      NEW.order_id, v_order_min_due, NEW.certificate_id, v_cert_issue
      USING ERRCODE = 'check_violation';
  END IF;

  RETURN NEW;
END;
$$;

-- 6. Trigger ya existe (de 007). DROP + CREATE asegura que apunte a la nueva fn.
DROP TRIGGER IF EXISTS trg_co_maturity_boundary ON cfb.certificate_orders;
CREATE TRIGGER trg_co_maturity_boundary
  BEFORE INSERT OR UPDATE OF order_id, certificate_id ON cfb.certificate_orders
  FOR EACH ROW EXECUTE FUNCTION cfb.enforce_maturity_boundary();

COMMIT;
```

- [ ] **Step 2: Validar sintaxis con psql local o lint**

Si no hay psql local, paste mental verification + abrir el SQL editor de Supabase (DEV branch) y correr en una transacción de prueba con `ROLLBACK` al final:

```sql
BEGIN;
\i infra/sql/015_maturity_lower_bound.sql
ROLLBACK;
```
Expected: sin errores. Si Supabase DEV branch no está disponible, marcar como "validar en Step 11 antes de aplicar a prod".

- [ ] **Step 3: Commit migración**

```bash
git add infra/sql/015_maturity_lower_bound.sql
git commit -m "feat(db): add min_due_date + extend maturity trigger to bilateral bounds"
```

---

## Task 2: Actualizar `prisma/schema.prisma` y regenerar cliente

**Files:**
- Modify: `prisma/schema.prisma` (model `Order` ~line 399)

- [ ] **Step 1: Agregar `min_due_date` al model `Order`**

Encontrar en `prisma/schema.prisma` la línea:
```
  max_due_date      DateTime    @db.Date
```

Agregar justo encima:
```
  min_due_date      DateTime    @db.Date
```

Resultado esperado:
```
  purchase_date     DateTime    @db.Date
  min_due_date      DateTime    @db.Date
  max_due_date      DateTime    @db.Date
```

- [ ] **Step 2: Regenerar el cliente Prisma**

```bash
npm run db:generate
```
Expected: `✔ Generated Prisma Client (...)` sin warnings.

- [ ] **Step 3: Typecheck para detectar usos del tipo `Order` que necesiten updates**

```bash
npm run typecheck
```
Expected: passes. Si falla por un mock o un select que requiere el campo, lo arreglaremos en las tareas siguientes.

- [ ] **Step 4: Commit schema change**

```bash
git add prisma/schema.prisma
git commit -m "feat(schema): add min_due_date to Order model"
```

---

## Task 3: Test failing — filtro `min_due_date` en cert service

**Files:**
- Test: `src/modules/issuance/certificates/certificates.service.test.ts`

- [ ] **Step 1: Agregar test que verifica el filtro pasa a `findMany`**

En `src/modules/issuance/certificates/certificates.service.test.ts`, después del bloque `describe('CertificatesService.simulate', ...)` y dentro de él, agregar un test nuevo. Localizar el último `it(...)` del bloque simulate y agregar antes del cierre:

```ts
  it('filters out orders with installments due before cert issue_date', async () => {
    const prisma = makePrismaForSimulate();
    (prisma.investor.findUnique as ReturnType<typeof vi.fn>).mockResolvedValueOnce(fakeInvestor());
    (prisma.order.findMany as ReturnType<typeof vi.fn>).mockResolvedValueOnce([]);

    const svc = new CertificatesService(prisma, makeAudit());
    await svc.simulate({
      investor_id: 'inv-1',
      capital: 100,
      rate: 0.13,
      term_days: 42,
      issue_date: new Date('2026-05-15'),
    }).catch(() => undefined);

    const call = (prisma.order.findMany as ReturnType<typeof vi.fn>).mock.calls[0][0];
    expect(call.where).toMatchObject({
      status: 'available',
      min_due_date: { gte: new Date('2026-05-15') },
      max_due_date: { lte: new Date('2026-06-26') }, // 2026-05-15 + 42d
    });
    expect(call.select).toMatchObject({ min_due_date: true, max_due_date: true });
  });
```

- [ ] **Step 2: Correr el test — debe fallar**

```bash
npx vitest run src/modules/issuance/certificates/certificates.service.test.ts -t "filters out orders with installments due before cert issue_date"
```
Expected: FAIL. Mensaje debe ser que `call.where` no incluye `min_due_date` o que `select` no lo tiene.

---

## Task 4: Implementación — filtro en cert service

**Files:**
- Modify: `src/modules/issuance/certificates/certificates.service.ts:62-71` y `:213-222`

- [ ] **Step 1: Leer el contexto exacto del bloque a modificar**

```bash
sed -n '58,90p' src/modules/issuance/certificates/certificates.service.ts
```

- [ ] **Step 2: Modificar el `findMany` de simulate**

Buscar:
```ts
    const eligible = await this.prisma.order.findMany({
      where: { status: 'available', max_due_date: { lte: maturityDate } },
```

Reemplazar por:
```ts
    const eligible = await this.prisma.order.findMany({
      where: {
        status: 'available',
        min_due_date: { gte: input.issue_date },
        max_due_date: { lte: maturityDate },
      },
```

Notas:
- `input.issue_date` es el campo del DTO de simulate (Zod lo coerce a `Date`). Verificar el shape de `input` arriba del método si fuera necesario.
- Agregar `min_due_date: true` al `select` que está debajo (al lado de `max_due_date: true`).

- [ ] **Step 3: Modificar el raw SQL del `issue()` (`FOR UPDATE`)**

Localizar el `Prisma.sql` con el `SELECT ... FROM cfb.orders WHERE id IN (...) FOR UPDATE`:
```bash
sed -n '210,235p' src/modules/issuance/certificates/certificates.service.ts
```

Agregar `min_due_date` a la lista de columnas seleccionadas:
```ts
Prisma.sql`SELECT id, external_order_id, installments_sum, min_due_date, max_due_date, merchant_id, status
```

Y al tipo de respuesta arriba:
```ts
            min_due_date: Date;
            max_due_date: Date;
```

- [ ] **Step 4: Defense-in-depth — agregar chequeo en `issue()` si está antes del trigger**

Si el bloque `issue()` tiene un chequeo de elegibilidad sobre `lockedOrders` análogo al de sweep (defensa en profundidad antes del INSERT), agregar la condición:
```ts
  o.min_due_date < input.issue_date
```
al lado del chequeo de `max_due_date > maturityDate`. Si no existe esa defensa en cert (solo en sweep), no agregar nada — el trigger de la DB nos cubre.

- [ ] **Step 5: Correr el test de Task 3 — debe pasar**

```bash
npx vitest run src/modules/issuance/certificates/certificates.service.test.ts -t "filters out orders with installments due before cert issue_date"
```
Expected: PASS.

- [ ] **Step 6: Correr toda la suite del cert service**

```bash
npx vitest run src/modules/issuance/certificates/certificates.service.test.ts
```
Expected: todos los tests pasan (incluyendo los preexistentes — no regresión).

- [ ] **Step 7: Commit cert service + test**

```bash
git add src/modules/issuance/certificates/certificates.service.ts \
        src/modules/issuance/certificates/certificates.service.test.ts
git commit -m "feat(certs): filter orders by min_due_date >= issue_date in simulate+issue"
```

---

## Task 5: Test failing — filtro `min_due_date` en sweep service

**Files:**
- Test: `src/modules/issuance/sweep/sweep.service.test.ts`

- [ ] **Step 1: Leer el patrón existente de tests de sweep**

```bash
sed -n '1,60p' src/modules/issuance/sweep/sweep.service.test.ts
```

- [ ] **Step 2: Agregar test que verifica el filtro en `findMany` del simulate**

Agregar dentro del primer `describe(...)` del sweep service:

```ts
  it('filters out orders with installments due before sweep issue_date', async () => {
    const prisma = makePrismaForSimulate();  // o el helper que esté disponible
    (prisma.order.findMany as ReturnType<typeof vi.fn>).mockResolvedValueOnce([]);

    const svc = new SweepService(prisma, makeAudit(), makeSettings());
    await svc.simulate({
      term_days: 42,
      issue_date: new Date('2026-05-22'),
    }).catch(() => undefined);

    const call = (prisma.order.findMany as ReturnType<typeof vi.fn>).mock.calls[0][0];
    expect(call.where).toMatchObject({
      status: 'available',
      min_due_date: { gte: new Date('2026-05-22') },
      max_due_date: { lte: new Date('2026-07-03') }, // 2026-05-22 + 42d
    });
    expect(call.select).toMatchObject({ min_due_date: true, max_due_date: true });
  });
```

Nota: el nombre de los helpers (`makeAudit`, `makeSettings`) puede diferir — usar los que existan en el archivo de test. Si no hay un `makePrismaForSimulate`, copiar el patrón de los tests existentes en el mismo archivo (ej. inicializar `prisma` con `{ investor: ..., order: { findMany: vi.fn() }, ... }` como hace el cert service test).

- [ ] **Step 3: Correr el test — debe fallar**

```bash
npx vitest run src/modules/issuance/sweep/sweep.service.test.ts -t "filters out orders with installments due before sweep issue_date"
```
Expected: FAIL.

---

## Task 6: Implementación — filtro en sweep service

**Files:**
- Modify: `src/modules/issuance/sweep/sweep.service.ts:55-67`, `:220-227`, `:256-267`

- [ ] **Step 1: Modificar el `findMany` de simulate**

Localizar:
```ts
    const eligible = (await this.prisma.order.findMany({
      where: { status: 'available', max_due_date: { lte: maturityDate } },
```

Reemplazar por:
```ts
    const eligible = (await this.prisma.order.findMany({
      where: {
        status: 'available',
        min_due_date: { gte: input.issue_date },
        max_due_date: { lte: maturityDate },
      },
```

`input.issue_date` ya está disponible en el scope (es el campo del DTO). Agregar `min_due_date: true` al `select`.

- [ ] **Step 2: Modificar el raw SQL del FOR UPDATE en `issueSweep()`**

```bash
sed -n '215,240p' src/modules/issuance/sweep/sweep.service.ts
```

Agregar `min_due_date` a la lista de columnas y al tipo:
```ts
Prisma.sql`SELECT id, external_order_id, installments_sum, min_due_date, max_due_date, merchant_id, status
```

- [ ] **Step 3: Modificar el `eligibleNow` de defense-in-depth**

```bash
sed -n '250,275p' src/modules/issuance/sweep/sweep.service.ts
```

Agregar el filtro a la query y el campo al select:
```ts
        const eligibleNow = (await tx.order.findMany({
          where: {
            status: 'available',
            min_due_date: { gte: input.issue_date },
            max_due_date: { lte: maturityDate },
          },
          select: {
            id: true,
            installments_sum: true,
            min_due_date: true,
            max_due_date: true,
            merchant_id: true,
          },
```

- [ ] **Step 4: Correr el test de Task 5**

```bash
npx vitest run src/modules/issuance/sweep/sweep.service.test.ts -t "filters out orders with installments due before sweep issue_date"
```
Expected: PASS.

- [ ] **Step 5: Correr toda la suite del sweep service**

```bash
npx vitest run src/modules/issuance/sweep/sweep.service.test.ts
```
Expected: todos los tests pasan.

- [ ] **Step 6: Commit sweep service + test**

```bash
git add src/modules/issuance/sweep/sweep.service.ts \
        src/modules/issuance/sweep/sweep.service.test.ts
git commit -m "feat(sweep): filter orders by min_due_date >= issue_date in simulate+issueSweep"
```

---

## Task 7: Update ingestion para setear `min_due_date`

**Files:**
- Modify: `src/modules/batches/ingestion.service.ts:334-380`

- [ ] **Step 1: Agregar `min_due_date` al tipo `ordersToCreate`**

Buscar en `ingestion.service.ts` el bloque:
```ts
        const ordersToCreate: Array<{
          ...
          max_due_date: Date;
          status: 'available';
        }> = [];
```

Agregar la línea `min_due_date: Date;` justo encima de `max_due_date: Date;`:
```ts
          min_due_date: Date;
          max_due_date: Date;
```

- [ ] **Step 2: Calcular `minDueDate` desde los installments**

Localizar el cálculo de `maxDueDate`:
```ts
          const maxDueDate = g.installments.reduce(
            (max, i) => (i.dueDate > max ? i.dueDate : max),
            g.installments[0]!.dueDate,
          );
```

Agregar justo debajo:
```ts
          const minDueDate = g.installments.reduce(
            (min, i) => (i.dueDate < min ? i.dueDate : min),
            g.installments[0]!.dueDate,
          );
```

- [ ] **Step 3: Incluir `min_due_date` en el push**

Buscar el `ordersToCreate.push({...})` y agregar la línea `min_due_date: minDueDate,` justo encima de `max_due_date: maxDueDate,`:
```ts
            purchase_date: g.fechaDeCompra,
            min_due_date: minDueDate,
            max_due_date: maxDueDate,
            status: 'available',
```

- [ ] **Step 4: Typecheck**

```bash
npm run typecheck
```
Expected: passes. Si falla, revisar que el orden de campos en el tipo coincide con el orden en el push (Prisma es tolerante pero TS strict puede no serlo dependiendo del shape).

- [ ] **Step 5: Correr tests de ingestion**

```bash
npx vitest run src/modules/batches/
```
Expected: passes. Si hay tests que crean orders en setup, pueden necesitar agregar `min_due_date` al mock — actualizar con el mismo valor de `max_due_date` si falla.

- [ ] **Step 6: Commit ingestion**

```bash
git add src/modules/batches/ingestion.service.ts
git commit -m "feat(ingestion): compute and persist min_due_date for new orders"
```

---

## Task 8: Update CLAUDE.md

**Files:**
- Modify: `CLAUDE.md` (sección "Las 3 reglas duras del producto")

- [ ] **Step 1: Localizar la regla 1 actual**

```bash
grep -n "Maturity boundary\|Ninguna cuota puede vencer" CLAUDE.md
```
Expected: encuentra la línea con la regla 1.

- [ ] **Step 2: Reemplazar el texto**

Buscar:
```
1. **Maturity boundary**: Ninguna cuota puede vencer después del vencimiento del certificado.
```

Reemplazar por:
```
1. **Maturity boundary**: Toda cuota debe vencer dentro de `[cert.issue_date, cert.maturity_date]`. Ninguna cuota puede ser anterior al inicio del cert ni posterior al vencimiento. Blindada en DB con trigger `cfb.enforce_maturity_boundary` (ver `infra/sql/007_invariants_complete.sql` + `015_maturity_lower_bound.sql`).
```

- [ ] **Step 3: Commit CLAUDE.md**

```bash
git add CLAUDE.md
git commit -m "docs(CLAUDE): update Rule 1 to bilateral maturity boundary"
```

---

## Task 9: Full suite + typecheck + lint

**Files:** ninguno (validación).

- [ ] **Step 1: Typecheck completo**

```bash
npm run typecheck
```
Expected: zero errors.

- [ ] **Step 2: Lint**

```bash
npm run lint
```
Expected: zero errors. Si hay warnings nuevos por unused imports en archivos modificados, limpiarlos.

- [ ] **Step 3: Suite completa de tests**

```bash
npm run test
```
Expected: 100% green. Si algún test preexistente falla por mocks que no tienen `min_due_date`, agregar el campo al mock (usar el mismo valor que `max_due_date` está bien para tests).

- [ ] **Step 4: Regenerar openapi.json (por si algún tipo expuesto cambió)**

```bash
npm run openapi:export
git status
```
Si `openapi.json` cambió:
```bash
git add openapi.json
git commit -m "chore: regenerate openapi.json after schema change"
```
Si no cambió, skip el commit.

---

## Task 10: Aplicar migración a Supabase + smoke test

**Files:** ninguno (deploy/ops).

- [ ] **Step 1: Push branch al remoto**

```bash
git push -u origin feat/maturity-lower-bound
```

- [ ] **Step 2: Aplicar `015_maturity_lower_bound.sql` en Supabase SQL Editor (prod)**

Pasos:
1. Abrir https://supabase.com/dashboard/project/esobivqsddwrbxlytfsn/sql/new
2. Pegar el contenido completo de `infra/sql/015_maturity_lower_bound.sql`
3. Click "Run"
4. Expected: `Success. No rows returned`. Si hay error de "column already exists" en el ALTER, el `IF NOT EXISTS` lo cubre — verificar el log.

- [ ] **Step 3: Validar el backfill**

En el mismo SQL editor:
```sql
SELECT count(*) AS total, count(min_due_date) AS with_min FROM cfb.orders;
SELECT count(*) AS bad FROM cfb.orders WHERE min_due_date IS NULL;
```
Expected: `total = with_min` y `bad = 0`. Si `bad > 0`, hay órdenes sin installments — investigar antes de continuar.

- [ ] **Step 4: Validar el trigger con INSERT de prueba (con ROLLBACK)**

```sql
BEGIN;
-- intentar insertar una orden inválida (cuota antes del issue_date)
-- Asume que hay un cert reciente y una orden test
WITH test_cert AS (
  SELECT id, issue_date FROM cfb.certificates
   WHERE status = 'draft' OR status = 'issued'
   ORDER BY created_at DESC LIMIT 1
),
bad_order AS (
  SELECT o.id, o.min_due_date
    FROM cfb.orders o, test_cert tc
   WHERE o.min_due_date < tc.issue_date AND o.status = 'available'
   LIMIT 1
)
SELECT * FROM bad_order, test_cert;  -- Si hay match, el siguiente INSERT debe fallar
ROLLBACK;
```
Si no hay datos que disparen el caso (no hay órdenes past-due en available), saltarse este paso y validar en step 6 con el smoke test real.

- [ ] **Step 5: Deploy back a Railway**

Hacer merge del PR a main → Railway auto-deploy. Confirmar en https://railway.app/project/... que el build pasa y el healthcheck queda verde.

- [ ] **Step 6: Smoke test prod**

En el front (Vercel), entrar al wizard de nuevo cert. Crear un cert con `issue_date = hoy` y verificar:
- El simulate solo lista órdenes cuyas cuotas no vencieron antes de hoy.
- Si se intenta emitir un cert que de algún modo contenga una orden inválida (no debería poder pasar el filtro, pero el trigger es la última defensa), el back devuelve 500 con el mensaje "La cuota más temprana de la orden X vence (Y) antes del inicio del certificado Z".

---

## Task 11: PR + merge

**Files:** ninguno (PR workflow).

- [ ] **Step 1: Crear PR**

```bash
gh pr create --title "feat(maturity): add bilateral bounds (min_due_date)" --body "$(cat <<'EOF'
## Summary

Cierra el borde inferior de la regla 1 "Maturity boundary" del producto. Hoy el sistema garantiza que ninguna cuota vence después del vencimiento del cert; con este cambio también garantiza que ninguna vence antes del inicio del cert.

- Migración SQL `015_maturity_lower_bound.sql` con backfill idempotente.
- Trigger `cfb.enforce_maturity_boundary` extendido a chequear ambos bordes.
- Eligibility queries en cert + sweep services filtran por `min_due_date >= issue_date`.
- Ingestion calcula y persiste `min_due_date` al crear orders.
- CLAUDE.md actualizado.

Spec: `docs/superpowers/specs/2026-05-21-cert-cap-and-maturity-bounds-design.md` (sección Slice 1).
Plan: `docs/superpowers/plans/2026-05-21-slice-1-maturity-bounds.md`.

## Test plan
- [x] Unit tests de cert + sweep services pasan (filtro verificado con mock).
- [x] `npm run typecheck` + `npm run lint` verdes.
- [ ] Migración aplicada en Supabase prod (manual, ver Task 10).
- [ ] Smoke test en prod: emitir cert hoy, verificar que solo aparecen orders elegibles.

🤖 Generated with [Claude Code](https://claude.com/claude-code)
EOF
)"
```

- [ ] **Step 2: Esperar checks de CI y aprobación**

- [ ] **Step 3: Merge a main**

Squash merge desde GitHub UI o:
```bash
gh pr merge --squash
```

---

## Notas operativas

- **Orden de deploy estricto:** migración SQL primero (Task 10 Step 2), después merge + Railway deploy (Step 5). Si el código se deploya antes de la migración, las queries del back fallarán por columna inexistente.
- **Rollback:** revertir la migración no es trivial (drop column requiere también revertir el trigger). Si hay problemas en prod, el rollback es del código (revertir el commit en Railway), no de la DB — la columna queda como artefacto inocuo.
- **Slice 2** (cap 3M + auto-split) se planifica por separado **después** de que Slice 1 esté mergeado y validado en prod.

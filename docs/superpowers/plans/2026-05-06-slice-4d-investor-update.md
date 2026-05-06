# Slice 4d — Investor PATCH Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build the partial update flow for investors: `PATCH /api/investors/:id` (operator + admin via `investor.update` perm) updates `legal_name`, `email`, `phone`, `notes`, `status`. Hard-blocks status changes on the internal investor (kind='internal'). Records a diff-format audit row inside the same `prisma.$transaction` as the UPDATE. Adds `updated_at` + `updated_by_id` columns to `cfb.investors` for "last edited" UX.

**Architecture:** New code lives in the existing `src/modules/issuance/investors/` module — update completes CRUD on `InvestorsService` (alongside list/detail/create from Slice 4a). One transactional service method that diffs the input against the current row, writes only changed fields, bumps `updated_at`/`updated_by_id`, and inserts an audit row with `{ changed: { field: { from, to } } }` payload. SQL migration 010 adds the two new columns, idempotently. Prisma `Investor`'s relations to `User` are renamed to allow both `created_by` and `updated_by` to coexist (Prisma requires named relations when there are 2+ between the same two models).

**Tech Stack:** NestJS 10, TypeScript 5 strict, Prisma 5, Zod, Vitest, supertest. Reuses `AuditService` from Slice 3, the `prisma.$transaction` + `audit.recordChange({ tx })` pattern from Slices 4a/4b/4c. **One new SQL migration. No new dependencies.**

---

## Spec reference

`docs/superpowers/specs/2026-05-06-slice-4d-investor-update-design.md`. Read first for the 11 decisions table, error matrix, and smoke recipe.

## File structure

```
src/modules/issuance/investors/
  investors.controller.ts                     MODIFY: + @Patch(':id')
  investors.controller.test.ts                MODIFY: + 5 tests; mock svc gains 'update'
  investors.service.ts                        MODIFY: + update() method; private assembleSummary helper; list/detail use include updated_by
  investors.service.test.ts                   MODIFY: + 6 tests; existing list/detail tests adapt to new mapper fields
  investors.dto.ts                            MODIFY: + InvestorUpdateSchema (.strict.refine)
  responses/investor-summary.mapper.ts        MODIFY: + updated_at, updated_by nested object

prisma/schema.prisma                          MODIFY: Investor model gains updated_at + updated_by_id + named relations; User model adds back-relations
infra/sql/
  010_investors_updated_at.sql                CREATE: ALTER TABLE add 2 columns + backfill + FK

openapi.json                                  REGENERATE + COMMIT
```

---

## Task 1: SQL migration 010

**Files:**
- Create: `infra/sql/010_investors_updated_at.sql`

- [ ] **Step 1: Create the migration file**

```sql
-- 010_investors_updated_at.sql
-- Add updated_at and updated_by_id columns to cfb.investors so the frontend
-- can show "last edited at / by whom" without joining cfb.audit_log.
--
-- The audit_log remains the source of truth for full change history;
-- these columns are a denormalized convenience for read paths.
--
-- updated_at is set explicitly by the service on every UPDATE — no DB trigger.
-- For pre-existing rows, default to created_at so "last edited" is sensible
-- before any updates happen.
--
-- Idempotent — safe to re-run.
-- Depends on: 003_portfolio.sql (cfb.investors), 001_init.sql (cfb.users).

BEGIN;

ALTER TABLE cfb.investors
  ADD COLUMN IF NOT EXISTS updated_at  timestamptz,
  ADD COLUMN IF NOT EXISTS updated_by_id uuid;

UPDATE cfb.investors
SET updated_at    = COALESCE(updated_at, created_at),
    updated_by_id = COALESCE(updated_by_id, created_by_id);

ALTER TABLE cfb.investors
  ALTER COLUMN updated_at SET NOT NULL,
  ALTER COLUMN updated_at SET DEFAULT now();

DO $$ BEGIN
  ALTER TABLE cfb.investors
    ADD CONSTRAINT investors_updated_by_id_fkey
      FOREIGN KEY (updated_by_id) REFERENCES cfb.users(id);
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

COMMIT;
```

- [ ] **Step 2: Apply against live Supabase**

Use the Supabase MCP. Project ref: `esobivqsddwrbxlytfsn`. Migration name: `010_investors_updated_at`.

Apply via `mcp__plugin_supabase_supabase__apply_migration` (preferred) or `execute_sql`.

After applying, verify:

```sql
SELECT column_name, is_nullable, data_type, column_default
FROM information_schema.columns
WHERE table_schema = 'cfb' AND table_name = 'investors'
  AND column_name IN ('updated_at', 'updated_by_id')
ORDER BY column_name;
-- Expected: 2 rows.
-- updated_at:    is_nullable='NO',  data_type='timestamp with time zone', column_default contains 'now()'
-- updated_by_id: is_nullable='YES', data_type='uuid'

SELECT count(*) AS backfilled
FROM cfb.investors WHERE updated_at IS NOT NULL;
-- Expected: count matches the total investor count (currently ~2: internal + Inversora Alpha smoke).

SELECT conname FROM pg_constraint
WHERE conrelid = 'cfb.investors'::regclass AND conname = 'investors_updated_by_id_fkey';
-- Expected: 1 row.
```

- [ ] **Step 3: Commit the migration file**

```bash
git add infra/sql/010_investors_updated_at.sql
git commit -m "feat(db): add updated_at + updated_by_id to cfb.investors (010)"
```

---

## Task 2: Prisma schema + mapper + read endpoints update

**Files:**
- Modify: `prisma/schema.prisma`
- Modify: `src/modules/issuance/investors/responses/investor-summary.mapper.ts`
- Modify: `src/modules/issuance/investors/investors.service.ts`
- Modify: `src/modules/issuance/investors/investors.service.test.ts` (adapt mocks)

This task wires the new DB columns through to the API responses without yet adding the update endpoint. After this task, all read endpoints (`GET /api/investors`, `GET /api/investors/:id`) include `updated_at` + `updated_by` in their responses, populated from the new columns.

- [ ] **Step 1: Update `prisma/schema.prisma`**

Find the existing `Investor` model (around line 479):

```prisma
model Investor {
  id            String         @id @default(dbgenerated("gen_random_uuid()")) @db.Uuid
  legal_name    String         @db.VarChar
  rif           String         @unique @db.VarChar
  kind          InvestorKind   @default(juridica)
  status        InvestorStatus @default(active)
  email         String?        @db.VarChar
  phone         String?        @db.VarChar
  notes         String?
  created_at    DateTime       @default(dbgenerated("now()")) @db.Timestamptz(6)
  created_by_id String?        @db.Uuid

  // Relations
  created_by   User?         @relation(fields: [created_by_id], references: [id])
  certificates Certificate[]

  // Note: uq_investors_one_internal is a partial unique index (WHERE kind = 'internal')
  // and is intentionally excluded. See comment at top of file.
  @@index([legal_name], map: "idx_investors_name")
  @@index([status], map: "idx_investors_status")
  @@map("investors")
  @@schema("cfb")
}
```

Replace with:

```prisma
model Investor {
  id            String         @id @default(dbgenerated("gen_random_uuid()")) @db.Uuid
  legal_name    String         @db.VarChar
  rif           String         @unique @db.VarChar
  kind          InvestorKind   @default(juridica)
  status        InvestorStatus @default(active)
  email         String?        @db.VarChar
  phone         String?        @db.VarChar
  notes         String?
  created_at    DateTime       @default(dbgenerated("now()")) @db.Timestamptz(6)
  created_by_id String?        @db.Uuid
  updated_at    DateTime       @default(dbgenerated("now()")) @db.Timestamptz(6)
  updated_by_id String?        @db.Uuid

  // Relations
  created_by   User?         @relation("investor_created_by", fields: [created_by_id], references: [id])
  updated_by   User?         @relation("investor_updated_by", fields: [updated_by_id], references: [id])
  certificates Certificate[]

  // Note: uq_investors_one_internal is a partial unique index (WHERE kind = 'internal')
  // and is intentionally excluded. See comment at top of file.
  @@index([legal_name], map: "idx_investors_name")
  @@index([status], map: "idx_investors_status")
  @@map("investors")
  @@schema("cfb")
}
```

(Two new fields and the two relations to User now have explicit names — Prisma requires this when 2+ relations exist between the same models.)

Then find the `User` model's back-relation (around line 149):

```prisma
  investors           Investor[]
```

Replace with two named back-relations:

```prisma
  investors_created   Investor[]         @relation("investor_created_by")
  investors_updated   Investor[]         @relation("investor_updated_by")
```

- [ ] **Step 2: Regenerate Prisma client**

```bash
pnpm db:generate
```

Expected: regenerates `node_modules/@prisma/client` with `Investor.updated_at`, `Investor.updated_by_id`, `Investor.updated_by`. No errors.

- [ ] **Step 3: Update the summary mapper**

Read `src/modules/issuance/investors/responses/investor-summary.mapper.ts`. Find the existing definition:

```ts
import type { Decimal } from '@prisma/client/runtime/library';

export type InvestorSummaryRow = {
  id: string;
  legal_name: string;
  rif: string;
  kind: string;
  status: string;
  email: string | null;
  phone: string | null;
  notes: string | null;
  created_at: Date;
  active_cert_count: number;
  total_invested: Decimal;
};

export function toInvestorSummary(i: InvestorSummaryRow) {
  return {
    id: i.id,
    legal_name: i.legal_name,
    rif: i.rif,
    kind: i.kind,
    status: i.status,
    email: i.email,
    phone: i.phone,
    notes: i.notes,
    created_at: i.created_at.toISOString(),
    active_cert_count: i.active_cert_count,
    total_invested: i.total_invested.toFixed(4),
  };
}
```

Replace with:

```ts
import type { Decimal } from '@prisma/client/runtime/library';

export type InvestorSummaryRow = {
  id: string;
  legal_name: string;
  rif: string;
  kind: string;
  status: string;
  email: string | null;
  phone: string | null;
  notes: string | null;
  created_at: Date;
  updated_at: Date;
  updated_by: { id: string; email: string; full_name: string } | null;
  active_cert_count: number;
  total_invested: Decimal;
};

export function toInvestorSummary(i: InvestorSummaryRow) {
  return {
    id: i.id,
    legal_name: i.legal_name,
    rif: i.rif,
    kind: i.kind,
    status: i.status,
    email: i.email,
    phone: i.phone,
    notes: i.notes,
    created_at: i.created_at.toISOString(),
    updated_at: i.updated_at.toISOString(),
    updated_by: i.updated_by
      ? { id: i.updated_by.id, email: i.updated_by.email, full_name: i.updated_by.full_name }
      : null,
    active_cert_count: i.active_cert_count,
    total_invested: i.total_invested.toFixed(4),
  };
}
```

- [ ] **Step 4: Add `include: { updated_by: true }` to the existing `list` and `detail` Prisma queries**

In `src/modules/issuance/investors/investors.service.ts`, find the `list` method's existing `findMany`:

```ts
this.prisma.investor.findMany({
  where,
  orderBy: SORT_MAP[query.sort],
  take: query.limit,
  skip: query.offset,
}),
```

Change to:

```ts
this.prisma.investor.findMany({
  where,
  include: { updated_by: true },
  orderBy: SORT_MAP[query.sort],
  take: query.limit,
  skip: query.offset,
}),
```

Find the `detail` method's existing `findUnique`:

```ts
const i = await this.prisma.investor.findUnique({ where: { id } });
```

Change to:

```ts
const i = await this.prisma.investor.findUnique({
  where: { id },
  include: { updated_by: true },
});
```

The `create` method also needs the include for the returned summary. Find:

```ts
const created = await this.prisma.investor.create({
  data: {
    ...
  },
});
```

Change to:

```ts
const created = await this.prisma.investor.create({
  data: {
    ...
  },
  include: { updated_by: true },
});
```

- [ ] **Step 5: Update existing service tests' fake row factories**

The existing `investors.service.test.ts` uses inline mock data for `findMany`/`findUnique`/`create`. These rows now need the new fields.

Find the existing `list` test that mocks `prisma.investor.findMany`:

```ts
(prisma.investor.findMany as ReturnType<typeof vi.fn>).mockResolvedValueOnce([
  {
    id: 'i-1', legal_name: 'Inversora Alpha', rif: 'J-12345678-9',
    kind: 'juridica', status: 'active', email: null, phone: null, notes: null,
    created_at: new Date('2026-04-15'),
  },
]);
```

Change to:

```ts
(prisma.investor.findMany as ReturnType<typeof vi.fn>).mockResolvedValueOnce([
  {
    id: 'i-1', legal_name: 'Inversora Alpha', rif: 'J-12345678-9',
    kind: 'juridica', status: 'active', email: null, phone: null, notes: null,
    created_at: new Date('2026-04-15'),
    updated_at: new Date('2026-04-15'),
    updated_by: null,
  },
]);
```

Find the existing `detail` test that mocks `prisma.investor.findUnique`:

```ts
(prisma.investor.findUnique as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
  id: 'i-1', legal_name: 'Inversora Alpha', rif: 'J-12345678-9',
  kind: 'juridica', status: 'active', email: null, phone: null, notes: null,
  created_at: new Date('2026-04-15'),
});
```

Change to:

```ts
(prisma.investor.findUnique as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
  id: 'i-1', legal_name: 'Inversora Alpha', rif: 'J-12345678-9',
  kind: 'juridica', status: 'active', email: null, phone: null, notes: null,
  created_at: new Date('2026-04-15'),
  updated_at: new Date('2026-04-15'),
  updated_by: null,
});
```

Find the existing `create` test that mocks `prisma.investor.create`:

```ts
(prisma.investor.create as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
  id: 'i-2', legal_name: 'Nueva Inversora', rif: 'J-30123456-7',
  kind: 'juridica', status: 'active', email: null, phone: null, notes: null,
  created_at: new Date(),
});
```

Change to:

```ts
(prisma.investor.create as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
  id: 'i-2', legal_name: 'Nueva Inversora', rif: 'J-30123456-7',
  kind: 'juridica', status: 'active', email: null, phone: null, notes: null,
  created_at: new Date(),
  updated_at: new Date(),
  updated_by: null,
});
```

- [ ] **Step 6: Run all investor tests, expect them all still passing**

```bash
pnpm vitest run src/modules/issuance/investors/
```

Expected: 13 passed (6 service + 7 controller from Slice 4a — unchanged count). The new fields are populated in responses; the existing tests don't assert them but don't break either.

- [ ] **Step 7: Run full test suite + TS check**

```bash
pnpm exec tsc --noEmit && pnpm test 2>&1 | tail -5
```

Expected: zero TS errors, 228 tests passing (no behavior change vs main).

- [ ] **Step 8: Commit**

```bash
git add prisma/schema.prisma src/modules/issuance/investors/responses/investor-summary.mapper.ts src/modules/issuance/investors/investors.service.ts src/modules/issuance/investors/investors.service.test.ts
git commit -m "feat(investors): surface updated_at + updated_by in read endpoints"
```

---

## Task 3: DTO — `InvestorUpdateSchema`

**Files:**
- Modify: `src/modules/issuance/investors/investors.dto.ts`

- [ ] **Step 1: Add `InvestorUpdateSchema`**

Read `src/modules/issuance/investors/investors.dto.ts`. Append the new schema at the end:

```ts
export const InvestorUpdateSchema = z
  .object({
    legal_name: z.string().min(1).max(255).optional(),
    email: z.string().email().max(255).nullable().optional(),
    phone: z.string().min(1).max(50).nullable().optional(),
    notes: z.string().max(1000).nullable().optional(),
    status: z.enum(['active', 'inactive']).optional(),
  })
  .strict()
  .refine((d) => Object.keys(d).length > 0, {
    message: 'Debe enviar al menos un campo a actualizar',
  });

export type InvestorUpdate = z.infer<typeof InvestorUpdateSchema>;
```

- [ ] **Step 2: TS check + commit**

```bash
pnpm exec tsc --noEmit
git add src/modules/issuance/investors/investors.dto.ts
git commit -m "feat(investors): add InvestorUpdateSchema with strict + at-least-one-field"
```

---

## Task 4: `InvestorsService.update` (TDD)

**Files:**
- Modify: `src/modules/issuance/investors/investors.service.ts`
- Modify: `src/modules/issuance/investors/investors.service.test.ts`

The `update` method runs inside `prisma.$transaction(...)`. It diffs the input against the current row, writes only changed fields, bumps `updated_at`/`updated_by_id`, and inserts a diff-format audit row. Includes a no-op detection (no write, no audit if nothing actually changes) and an internal-investor status lock (409).

This task also extracts a private `assembleSummary` helper to deduplicate the `active_cert_count + total_invested` enrichment logic shared across `list/detail/create/update`.

- [ ] **Step 1: Write the failing tests**

Append to `src/modules/issuance/investors/investors.service.test.ts` after the existing `describe('InvestorsService.create', ...)` block:

```ts
function fakeInvestorRow(overrides: Record<string, unknown> = {}) {
  return {
    id: 'i-1',
    legal_name: 'Inversora Alpha',
    rif: 'J-12345678-9',
    kind: 'juridica',
    status: 'active',
    email: 'alpha@cashea.app',
    phone: null,
    notes: null,
    created_at: new Date('2026-04-15'),
    updated_at: new Date('2026-04-15'),
    updated_by: null,
    ...overrides,
  };
}

function makePrismaForUpdate(opts: {
  existing?: Record<string, unknown> | null;
  updateThrows?: Error;
} = {}) {
  const tx = {
    investor: {
      findUnique: vi.fn().mockResolvedValue(opts.existing ?? fakeInvestorRow()),
      update: opts.updateThrows
        ? vi.fn().mockRejectedValue(opts.updateThrows)
        : vi.fn().mockImplementation(async ({ data, where }: { data: Record<string, unknown>; where: { id: string } }) => ({
            ...(opts.existing ?? fakeInvestorRow()),
            ...data,
            id: where.id,
          })),
    },
    certificate: {
      count: vi.fn().mockResolvedValue(0),
      aggregate: vi.fn().mockResolvedValue({ _sum: { investor_capital: null } }),
    },
  };
  const prisma = {
    $transaction: vi.fn(async (cb: (t: typeof tx) => Promise<unknown>) => cb(tx)),
    ...tx,
  } as unknown as PrismaService;
  (prisma as unknown as { _tx: typeof tx })._tx = tx;
  return prisma;
}

describe('InvestorsService.update', () => {
  it('happy path: writes only changed fields, bumps updated_at + updated_by_id, audits with diff', async () => {
    const existing = fakeInvestorRow();
    const prisma = makePrismaForUpdate({ existing });
    const audit = makeAudit();
    const svc = new InvestorsService(prisma, audit);

    const r = await svc.update(
      'i-1',
      { email: 'new@cashea.app', notes: 'New notes' },
      'actor-1',
    );

    const tx = (prisma as unknown as {
      _tx: { investor: { update: ReturnType<typeof vi.fn> } };
    })._tx;
    expect(tx.investor.update).toHaveBeenCalledOnce();
    const updateArg = tx.investor.update.mock.calls[0]![0] as {
      where: { id: string };
      data: Record<string, unknown>;
    };
    expect(updateArg.where.id).toBe('i-1');
    expect(updateArg.data.email).toBe('new@cashea.app');
    expect(updateArg.data.notes).toBe('New notes');
    // legal_name not in input → not in data
    expect(updateArg.data.legal_name).toBeUndefined();
    expect(updateArg.data.updated_by_id).toBe('actor-1');
    expect(updateArg.data.updated_at).toBeInstanceOf(Date);

    expect(audit.recordChange).toHaveBeenCalledOnce();
    const auditArg = (audit.recordChange as ReturnType<typeof vi.fn>).mock.calls[0]![0] as {
      entityType: string;
      action: string;
      payload: { changed: Record<string, { from: unknown; to: unknown }> };
    };
    expect(auditArg.entityType).toBe('investor');
    expect(auditArg.action).toBe('update');
    expect(auditArg.payload.changed.email).toEqual({ from: 'alpha@cashea.app', to: 'new@cashea.app' });
    expect(auditArg.payload.changed.notes).toEqual({ from: null, to: 'New notes' });

    expect(r.email).toBe('new@cashea.app');
  });

  it('no-op: client sends value identical to current → no write, no audit, returns current shape', async () => {
    const existing = fakeInvestorRow({ email: 'same@cashea.app' });
    const prisma = makePrismaForUpdate({ existing });
    const audit = makeAudit();
    const svc = new InvestorsService(prisma, audit);

    const r = await svc.update('i-1', { email: 'same@cashea.app' }, 'actor-1');

    const tx = (prisma as unknown as {
      _tx: { investor: { update: ReturnType<typeof vi.fn> } };
    })._tx;
    expect(tx.investor.update).not.toHaveBeenCalled();
    expect(audit.recordChange).not.toHaveBeenCalled();
    expect(r.email).toBe('same@cashea.app');
  });

  it('throws 404 when investor id not found', async () => {
    const prisma = makePrismaForUpdate({ existing: null });
    const svc = new InvestorsService(prisma, makeAudit());
    await expect(
      svc.update('missing', { email: 'x@y.com' }, 'actor-1'),
    ).rejects.toBeInstanceOf(NotFoundException);
  });

  it('throws 409 with kind: internal when status changes on internal investor', async () => {
    const existing = fakeInvestorRow({ kind: 'internal' });
    const prisma = makePrismaForUpdate({ existing });
    const svc = new InvestorsService(prisma, makeAudit());
    await expect(
      svc.update('i-1', { status: 'inactive' }, 'actor-1'),
    ).rejects.toBeInstanceOf(ConflictException);
  });

  it('allows changing legal_name and email on internal investor (only status is locked)', async () => {
    const existing = fakeInvestorRow({ kind: 'internal' });
    const prisma = makePrismaForUpdate({ existing });
    const svc = new InvestorsService(prisma, makeAudit());

    const r = await svc.update(
      'i-1',
      { legal_name: 'Grupo Cashea Ve C.A. (renamed)', email: 'new@cashea.app' },
      'actor-1',
    );
    expect(r.legal_name).toBe('Grupo Cashea Ve C.A. (renamed)');
    expect(r.email).toBe('new@cashea.app');
  });

  it('clears nullable field when client sends null', async () => {
    const existing = fakeInvestorRow({ email: 'old@cashea.app' });
    const prisma = makePrismaForUpdate({ existing });
    const svc = new InvestorsService(prisma, makeAudit());

    await svc.update('i-1', { email: null }, 'actor-1');

    const tx = (prisma as unknown as {
      _tx: { investor: { update: ReturnType<typeof vi.fn> } };
    })._tx;
    const updateArg = tx.investor.update.mock.calls[0]![0] as {
      data: Record<string, unknown>;
    };
    expect(updateArg.data.email).toBeNull();
  });
});
```

- [ ] **Step 2: Run, expect fail (update doesn't exist yet)**

```bash
pnpm vitest run src/modules/issuance/investors/investors.service.test.ts -t "update"
```

- [ ] **Step 3: Add the `update` method + `assembleSummary` helper**

In `src/modules/issuance/investors/investors.service.ts`:

First, update the imports at the top to include `ConflictException` (already imported), `Prisma` (already imported). Also add the `InvestorUpdate` type import:

Find the existing import:

```ts
import type { InvestorsListQuery, InvestorCreate } from './investors.dto';
```

Change to:

```ts
import type { InvestorsListQuery, InvestorCreate, InvestorUpdate } from './investors.dto';
```

Then, after the existing `create` method and before the closing `}` of the class, add the new methods:

```ts
async update(id: string, input: InvestorUpdate, actorId: string) {
  return await this.prisma.$transaction(async (tx) => {
    const existing = await tx.investor.findUnique({
      where: { id },
      include: { updated_by: true },
    });
    if (!existing) throw new NotFoundException('Inversor no encontrado');

    if (
      existing.kind === 'internal' &&
      input.status !== undefined &&
      input.status !== existing.status
    ) {
      throw new ConflictException({
        message: 'El inversor interno no puede cambiar de estado',
        kind: 'internal',
      });
    }

    const editableFields: Array<keyof InvestorUpdate> = [
      'legal_name',
      'email',
      'phone',
      'notes',
      'status',
    ];

    const changed: Record<string, { from: unknown; to: unknown }> = {};
    const data: Prisma.InvestorUpdateInput = {};
    for (const k of editableFields) {
      if (!(k in input)) continue;
      const next = input[k] ?? null;
      const prev = (existing as Record<string, unknown>)[k] ?? null;
      if (prev !== next) {
        changed[k] = { from: prev, to: next };
        (data as Record<string, unknown>)[k] = next;
      }
    }

    if (Object.keys(changed).length === 0) {
      return this.assembleSummary(tx, existing);
    }

    const updated = await tx.investor.update({
      where: { id },
      data: {
        ...data,
        updated_at: new Date(),
        updated_by_id: actorId,
      },
      include: { updated_by: true },
    });

    await this.audit.recordChange({
      entityType: 'investor',
      entityId: id,
      action: 'update',
      actorId,
      payload: { changed },
      tx,
    });

    return this.assembleSummary(tx, updated);
  });
}

private async assembleSummary(
  tx: Prisma.TransactionClient,
  row: { id: string } & Record<string, unknown>,
) {
  const [count, agg] = await Promise.all([
    tx.certificate.count({
      where: { investor_id: row.id, status: { in: ['issued', 'matured'] }, deleted_at: null },
    }),
    tx.certificate.aggregate({
      where: { investor_id: row.id, status: { in: ['issued', 'matured'] }, deleted_at: null },
      _sum: { investor_capital: true },
    }),
  ]);
  return toInvestorSummary({
    ...(row as unknown as InvestorSummaryRow),
    active_cert_count: count,
    total_invested: agg._sum.investor_capital ?? new Prisma.Decimal(0),
  });
}
```

- [ ] **Step 4: Run update tests, expect 6 pass**

```bash
pnpm vitest run src/modules/issuance/investors/investors.service.test.ts -t "update"
```

Expected: 6 passed.

- [ ] **Step 5: Run all investor service tests, expect 12 pass**

```bash
pnpm vitest run src/modules/issuance/investors/investors.service.test.ts
```

Expected: 12 passed (6 from Slice 4a + 6 new).

- [ ] **Step 6: TS check + commit**

```bash
pnpm exec tsc --noEmit
git add src/modules/issuance/investors/investors.service.ts src/modules/issuance/investors/investors.service.test.ts
git commit -m "feat(investors): InvestorsService.update with diff audit + internal-status lock (TDD)"
```

---

## Task 5: Controller — `PATCH /api/investors/:id` (TDD)

**Files:**
- Modify: `src/modules/issuance/investors/investors.controller.ts`
- Modify: `src/modules/issuance/investors/investors.controller.test.ts`

- [ ] **Step 1: Append controller tests**

Read `src/modules/issuance/investors/investors.controller.test.ts`. The existing file mocks `svc = { list, detail, create }`; we add `update`.

Find:

```ts
svc = { list: vi.fn(), detail: vi.fn(), create: vi.fn() };
```

Change to:

```ts
svc = { list: vi.fn(), detail: vi.fn(), create: vi.fn(), update: vi.fn() };
```

Update the type annotation:

```ts
let svc: { list: ReturnType<typeof vi.fn>; detail: ReturnType<typeof vi.fn>; create: ReturnType<typeof vi.fn>; update: ReturnType<typeof vi.fn> };
```

Append these 5 new tests at the end of the existing `describe('InvestorsController', () => { ... })` block (before its closing `});`):

```ts
it('PATCH /api/investors/:id → 401 without token', async () => {
  await request(app.getHttpServer())
    .patch('/api/investors/00000000-0000-4000-8000-000000000010')
    .send({ email: 'new@x.com' })
    .expect(401);
});

it('PATCH /api/investors/:id → 403 when role lacks investor.update', async () => {
  prismaPerms.mockResolvedValueOnce([{ permission: { key: 'investor.read' } }]);
  const t = await mintTestJwt({ sub: 'auth-uuid' });
  await request(app.getHttpServer())
    .patch('/api/investors/00000000-0000-4000-8000-000000000010')
    .set('Authorization', `Bearer ${t}`)
    .send({ email: 'new@x.com' })
    .expect(403);
});

it('PATCH /api/investors/:id → 200 happy', async () => {
  prismaPerms.mockResolvedValueOnce([{ permission: { key: 'investor.update' } }]);
  svc.update.mockResolvedValueOnce({
    id: 'i-1',
    legal_name: 'Inversora Alpha',
    rif: 'J-12345678-9',
    kind: 'juridica',
    status: 'active',
    email: 'new@x.com',
    phone: null,
    notes: null,
    created_at: '2026-04-15T00:00:00.000Z',
    updated_at: '2026-05-06T12:00:00.000Z',
    updated_by: { id: 'u-1', email: 'op@cashea.app', full_name: 'Operator' },
    active_cert_count: 0,
    total_invested: '0.0000',
  });
  const t = await mintTestJwt({ sub: 'auth-uuid' });
  const res = await request(app.getHttpServer())
    .patch('/api/investors/00000000-0000-4000-8000-000000000010')
    .set('Authorization', `Bearer ${t}`)
    .send({ email: 'new@x.com' })
    .expect(200);
  expect(res.body.email).toBe('new@x.com');
  expect(res.body.updated_by.email).toBe('op@cashea.app');
});

it('PATCH /api/investors/:id → 400 when body is empty (Zod refine)', async () => {
  prismaPerms.mockResolvedValueOnce([{ permission: { key: 'investor.update' } }]);
  const t = await mintTestJwt({ sub: 'auth-uuid' });
  await request(app.getHttpServer())
    .patch('/api/investors/00000000-0000-4000-8000-000000000010')
    .set('Authorization', `Bearer ${t}`)
    .send({})
    .expect(400);
});

it('PATCH /api/investors/:id → 400 when body has unknown key (Zod strict)', async () => {
  prismaPerms.mockResolvedValueOnce([{ permission: { key: 'investor.update' } }]);
  const t = await mintTestJwt({ sub: 'auth-uuid' });
  await request(app.getHttpServer())
    .patch('/api/investors/00000000-0000-4000-8000-000000000010')
    .set('Authorization', `Bearer ${t}`)
    .send({ rif: 'J-99999999-9' })
    .expect(400);
});
```

- [ ] **Step 2: Run, expect fail (PATCH endpoint doesn't exist yet)**

```bash
pnpm vitest run src/modules/issuance/investors/investors.controller.test.ts
```

- [ ] **Step 3: Add the PATCH endpoint to the controller**

Read `src/modules/issuance/investors/investors.controller.ts`. Make these changes:

1. Find the existing import from `./investors.dto`:

```ts
import {
  InvestorsListQuerySchema,
  InvestorCreateSchema,
  type InvestorsListQuery,
  type InvestorCreate,
} from './investors.dto';
```

Replace with:

```ts
import {
  InvestorsListQuerySchema,
  InvestorCreateSchema,
  InvestorUpdateSchema,
  type InvestorsListQuery,
  type InvestorCreate,
  type InvestorUpdate,
} from './investors.dto';
```

2. Add `Patch` to the existing `@nestjs/common` import. Find:

```ts
import { Body, Controller, Get, HttpCode, HttpStatus, Param, ParseUUIDPipe, Post, Query, UsePipes } from '@nestjs/common';
```

Add `Patch`:

```ts
import { Body, Controller, Get, HttpCode, HttpStatus, Param, ParseUUIDPipe, Patch, Post, Query, UsePipes } from '@nestjs/common';
```

3. Add the new endpoint at the end of the controller class (after the existing `create` method, before the closing `}` of the class):

```ts
@Patch(':id')
@HttpCode(HttpStatus.OK)
@RequirePermission('investor.update')
update(
  @Param('id', ParseUUIDPipe) id: string,
  @Body(new ZodValidationPipe(InvestorUpdateSchema)) body: InvestorUpdate,
  @CurrentUser() user: AuthUser,
) {
  return this.investors.update(id, body, user.id);
}
```

- [ ] **Step 4: Run controller tests, expect 12 pass**

```bash
pnpm vitest run src/modules/issuance/investors/investors.controller.test.ts
```

Expected: 12 passed (7 from Slice 4a + 5 new).

- [ ] **Step 5: TS check + commit**

```bash
pnpm exec tsc --noEmit
git add src/modules/issuance/investors/investors.controller.ts src/modules/issuance/investors/investors.controller.test.ts
git commit -m "feat(investors): PATCH /:id endpoint (TDD)"
```

---

## Task 6: Smoke + openapi regeneration

**Files:**
- Generate + force-add: `openapi.json`

- [ ] **Step 1: Run the full test suite + lint**

```bash
pnpm exec tsc --noEmit && pnpm test 2>&1 | tail -10 && pnpm lint 2>&1 | tail -5
```

Expected: zero TS errors, ~239 tests passing total (228 from 4a/4b/4c + 11 from 4d: 6 service + 5 controller). Lint clean.

- [ ] **Step 2: Verify migration 010 applied + investor data shape**

Via Supabase MCP `execute_sql`:

```sql
SELECT column_name, is_nullable
FROM information_schema.columns
WHERE table_schema = 'cfb' AND table_name = 'investors'
  AND column_name IN ('updated_at', 'updated_by_id');
-- Expected: 2 rows, updated_at NOT nullable, updated_by_id nullable.

SELECT id, legal_name, kind, status, updated_at, updated_by_id FROM cfb.investors;
-- Expected: 2 rows. Both should have updated_at populated (backfilled from created_at).
```

Note the IDs of:
- The internal investor (`Grupo Cashea Ve C.A.`, kind=internal). Currently `9278c875-991c-4472-b2c4-6fd70c512719`.
- The external smoke investor (`Inversora Alpha (smoke)`). Currently `7307fa2b-d548-42cf-8bae-3916c32979dd`.

- [ ] **Step 3: Boot dev server**

```bash
lsof -ti:3001 | xargs -r kill -9 2>/dev/null; sleep 1
pnpm dev > /tmp/araguaney-dev.log 2>&1 &
DEV_PID=$!
sleep 7
tail -20 /tmp/araguaney-dev.log
```

Confirm boot succeeded. Look for `Listening on port 3001`. If errors, debug.

- [ ] **Step 4: Run the smoke flow**

The test user (sub `4bba7f81-443c-47b2-9bec-bc5a502380cc`) is `role='operator'`, which has `investor.update`. No role promotion needed.

```bash
cat > scripts/smoke-slice4d.ts <<'TSEOF'
import 'dotenv/config';
import { SignJWT } from 'jose';
import { request as httpRequest } from 'node:http';
import { URL } from 'node:url';
import { Buffer } from 'node:buffer';

const BASE = 'http://localhost:3001';
const SUB = '4bba7f81-443c-47b2-9bec-bc5a502380cc';
const EXTERNAL_ID = process.env.SMOKE_EXTERNAL_ID!;
const INTERNAL_ID = process.env.SMOKE_INTERNAL_ID!;

async function token(): Promise<string> {
  const secret = new TextEncoder().encode(process.env.SUPABASE_JWT_SECRET!);
  return await new SignJWT({ sub: SUB })
    .setProtectedHeader({ alg: 'HS256' })
    .setIssuedAt()
    .setExpirationTime(Math.floor(Date.now() / 1000) + 3600)
    .sign(secret);
}

function call(method: string, path: string, t: string, body?: unknown): Promise<{ status: number; body: string }> {
  return new Promise((resolve, reject) => {
    const u = new URL(BASE + path);
    const data = body ? Buffer.from(JSON.stringify(body), 'utf8') : null;
    const req = httpRequest({
      method, hostname: u.hostname, port: u.port, path: u.pathname + u.search,
      headers: {
        Authorization: `Bearer ${t}`,
        ...(data ? { 'Content-Type': 'application/json', 'Content-Length': data.length } : {}),
      },
    }, (res) => {
      const chunks: Buffer[] = [];
      res.on('data', (c) => chunks.push(c as Buffer));
      res.on('end', () => resolve({ status: res.statusCode ?? 0, body: Buffer.concat(chunks).toString('utf8') }));
    });
    req.on('error', reject);
    if (data) req.write(data);
    req.end();
  });
}

async function main() {
  const t = await token();

  // 1. PATCH external investor: change email + notes.
  const happy = await call('PATCH', `/api/investors/${EXTERNAL_ID}`, t, {
    email: 'alpha-updated@cashea.app',
    notes: 'Smoke 4d test',
  });
  console.log(`${happy.status} PATCH /:id (external happy)\n${happy.body.slice(0, 400)}\n---`);

  // 2. PATCH external with empty body → 400.
  const empty = await call('PATCH', `/api/investors/${EXTERNAL_ID}`, t, {});
  console.log(`${empty.status} PATCH /:id (empty body)\n${empty.body.slice(0, 240)}\n---`);

  // 3. PATCH external with unknown key → 400.
  const unknown = await call('PATCH', `/api/investors/${EXTERNAL_ID}`, t, {
    rif: 'J-99999999-9',
  });
  console.log(`${unknown.status} PATCH /:id (unknown key rif)\n${unknown.body.slice(0, 240)}\n---`);

  // 4. PATCH internal investor's status → 409.
  const internalStatus = await call('PATCH', `/api/investors/${INTERNAL_ID}`, t, {
    status: 'inactive',
  });
  console.log(`${internalStatus.status} PATCH /:id (internal status change)\n${internalStatus.body.slice(0, 240)}\n---`);

  // 5. PATCH internal investor's name → 200.
  const internalName = await call('PATCH', `/api/investors/${INTERNAL_ID}`, t, {
    legal_name: 'Grupo Cashea Ve C.A. (test)',
  });
  console.log(`${internalName.status} PATCH /:id (internal name change)\n${internalName.body.slice(0, 400)}\n---`);

  // 6. Revert internal name.
  const revert = await call('PATCH', `/api/investors/${INTERNAL_ID}`, t, {
    legal_name: 'Grupo Cashea Ve C.A.',
  });
  console.log(`${revert.status} PATCH /:id (revert internal name)\n${revert.body.slice(0, 240)}\n---`);
}
main().catch((e) => { console.error(e); process.exit(1); });
TSEOF
SMOKE_EXTERNAL_ID=7307fa2b-d548-42cf-8bae-3916c32979dd \
SMOKE_INTERNAL_ID=9278c875-991c-4472-b2c4-6fd70c512719 \
pnpm exec tsx scripts/smoke-slice4d.ts 2>&1 | head -120
rm -f scripts/smoke-slice4d.ts
```

(Adjust `SMOKE_EXTERNAL_ID` and `SMOKE_INTERNAL_ID` from Step 2 if they differ in the live DB.)

Expected:
- Call 1 (external happy): **200** with `email: 'alpha-updated@cashea.app'`, `notes: 'Smoke 4d test'`, `updated_by` populated with the test user's email + full_name, `updated_at` close to now.
- Call 2 (empty body): **400** with `Debe enviar al menos un campo a actualizar`.
- Call 3 (unknown key rif): **400** with Zod's "Unrecognized key(s) in object" message.
- Call 4 (internal status): **409** with `kind: 'internal'` in body.
- Call 5 (internal name): **200** with `legal_name: 'Grupo Cashea Ve C.A. (test)'`.
- Call 6 (revert): **200**.

If any call fails, check `/tmp/araguaney-dev.log` for stack traces.

- [ ] **Step 5: Verify audit_log entries via Supabase MCP**

```sql
SELECT entity_id, payload->'changed' AS changed, occurred_at
FROM cfb.audit_log
WHERE entity_type = 'investor' AND action = 'update'
ORDER BY occurred_at DESC
LIMIT 5;
-- Expected: at least 3 rows from the smoke (1 external happy, 2 internal name changes).
-- Each `changed` should be a JSON object with field names as keys and { from, to } values.
```

- [ ] **Step 6: Stop server**

```bash
kill $DEV_PID 2>/dev/null; wait $DEV_PID 2>/dev/null
lsof -ti:3001 | xargs -r kill -9 2>/dev/null
```

- [ ] **Step 7: Regenerate openapi.json**

```bash
pnpm openapi:export
node -e "const d = require('./openapi.json'); const ks = Object.keys(d.paths).sort(); console.log(ks); console.log('count:', ks.length);"
```

Expected: 21 paths total (unchanged count — `PATCH /api/investors/{id}` reuses the existing path from `GET`/`PATCH` is added under the same path key in OpenAPI since OpenAPI keys paths uniquely).

Verify the methods on `/api/investors/{id}`:

```bash
node -e "const d = require('./openapi.json'); console.log(Object.keys(d.paths['/api/investors/{id}']));"
```

Expected: `['get', 'patch']`.

- [ ] **Step 8: Force-add and commit openapi**

```bash
git add -f openapi.json
git commit -m "feat(openapi): regenerate with PATCH /api/investors/{id}"
```

---

## Self-review

**1. Spec coverage:**

| Spec section | Implemented in task |
|---|---|
| §3 Architecture (modify investors/, no new module) | Tasks 2-5 |
| §4 SQL migration 010 + Prisma schema | Tasks 1, 2 |
| §5.1 PATCH /:id endpoint shape (perm, HTTP, body) | Tasks 3 (DTO), 5 (controller) |
| §5.2 Field semantics (absent/value/null) | Task 3 (DTO Zod schema) |
| §5.3 Error matrix (400/401/403/404/409) | Tasks 4 (service), 5 (controller) |
| §6 Service `update` (tx, diff, no-op, internal lock, audit) | Task 4 |
| §6 `assembleSummary` refactor | Task 4 |
| §7 Mapper update (updated_at + updated_by) | Task 2 |
| §8 Audit log diff format | Task 4 (service code + audit assertion in test #1) |
| §9.1 Service tests (~6) | Task 4 |
| §9.2 Controller tests (~5) | Task 5 |
| §9.3 Smoke real | Task 6 |
| §10 Acceptance criteria | Task 6 |

**2. Placeholder scan:**

No "TBD", "TODO", "implement later" patterns. Every step shows the actual code.

**3. Type/name consistency:**

- `InvestorUpdateSchema`, `InvestorUpdate` defined in Task 3, used in Tasks 4 (service), 5 (controller). ✓
- `InvestorSummaryRow.updated_at`, `updated_by` defined in Task 2, populated in Task 4's `assembleSummary` via `include: { updated_by: true }`. ✓
- `InvestorsService.update(id, input, actorId)` signature consistent between Task 4 (service) and Task 5 (controller). ✓
- `assembleSummary(tx, row)` private method defined in Task 4, used inside `update`. (Could be retrofitted into list/detail/create in a future task; not required for 4d scope.)
- Audit `entityType: 'investor'`, `action: 'update'` — new pair for this slice. ✓
- Prisma schema `Investor.updated_by` relation named `'investor_updated_by'`, `Investor.created_by` relation named `'investor_created_by'`. User model back-relations `investors_created`, `investors_updated`. ✓
- Migration 010 column names `updated_at`, `updated_by_id` match Prisma schema field names. ✓

No issues found.

---

## Execution

Plan complete and saved to `docs/superpowers/plans/2026-05-06-slice-4d-investor-update.md`. Two execution options:

1. **Subagent-Driven (recommended)** — fresh subagent per task, two-stage review.
2. **Inline Execution** — execute tasks in this session with checkpoints.

Which approach?

# Slice 4b — Sweep certificates Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build the weekly sweep ("barrido") certificate flow: `POST /api/certificates/sweep/simulate` (preview pool, derive capital from settings rate, validate Friday-soft) and `POST /api/certificates/sweep` (atomic transactional issuance with FOR UPDATE, partial-unique conflict translation, audit). Add the `certificate.sweep` permission and grant it to operator + admin.

**Architecture:** New `src/modules/issuance/sweep/` sibling to `certificates/`. SweepService reuses pricing/payload-hash/iso-week/audit/transaction patterns from Slice 4a. Pool selection takes ALL eligible orders sorted deterministically — no `fillPool`. Capital is derived from `nominalActual × price`. The DB partial-unique index `uq_certs_one_sweep_per_cycle` is the source of truth for "one sweep per ISO week"; we translate Prisma `P2002` into a 409. A small refactor extracts `buildHashPayload` from `CertificatesService` (private method) to a module-level export so both services share one canonical hash schema.

**Tech Stack:** NestJS 10, TypeScript 5 strict, Prisma 5 (Decimal arithmetic + raw SQL FOR UPDATE), Zod, Vitest, supertest. Reuses jose/nestjs-pino/AuditService from prior slices. **One new SQL migration. No new dependencies.**

---

## Spec reference

`docs/superpowers/specs/2026-05-06-slice-4b-sweep-design.md`. Read first for product context, the 12 decisions table, and the smoke test recipe.

## File structure

```
src/modules/issuance/sweep/
  sweep.controller.ts                   CREATE: 2 endpoints (simulate, issue)
  sweep.controller.test.ts              CREATE: 6 supertest
  sweep.service.ts                      CREATE: simulateSweep + issueSweep
  sweep.service.test.ts                 CREATE: 10 unit tests (Prisma mocks)
  sweep.dto.ts                          CREATE: SweepSimulateSchema, SweepIssueSchema
  responses/
    sweep-simulation-result.mapper.ts   CREATE

src/modules/issuance/certificates/
  certificates.service.ts               MODIFY: drop private buildHashPayload (now imported)
  payload-hash/payload-hash.ts          MODIFY: add exported buildHashPayload helper

src/modules/issuance/issuance.module.ts MODIFY: register SweepController + SweepService

infra/sql/
  007_sweep_permission.sql              CREATE: idempotent perm + grants

openapi.json                            REGENERATE + COMMIT
```

---

## Task 1: SQL migration 007

**Files:**
- Create: `infra/sql/007_sweep_permission.sql`

- [ ] **Step 1: Create the migration file**

```sql
-- 007_sweep_permission.sql
-- Adds the certificate.sweep permission and grants it to operator + admin.
-- Idempotent — safe to re-run.
-- Depends on: 005_authz.sql (cfb.permissions, cfb.role_permissions, cfb.role enum).

BEGIN;

INSERT INTO cfb.permissions (key, description) VALUES
  ('certificate.sweep', 'Emitir certificado sweep semanal (barrido del remanente)')
ON CONFLICT (key) DO NOTHING;

INSERT INTO cfb.role_permissions (role, permission_id)
SELECT v.role::cfb.role, p.id
FROM (VALUES
  ('operator', 'certificate.sweep'),
  ('admin',    'certificate.sweep')
) AS v(role, key)
JOIN cfb.permissions p ON p.key = v.key
ON CONFLICT (role, permission_id) DO NOTHING;

COMMIT;
```

- [ ] **Step 2: Apply against live Supabase**

Open Supabase Studio → SQL Editor → paste the file's contents → Run. Verify with:

```sql
SELECT key FROM cfb.permissions WHERE key = 'certificate.sweep';
-- Expected: 1 row.
SELECT role, p.key
FROM cfb.role_permissions rp
JOIN cfb.permissions p ON p.id = rp.permission_id
WHERE p.key = 'certificate.sweep';
-- Expected: 2 rows: operator, admin.
```

If running locally / against a fresh DB, this is the same SQL Editor flow as migrations 001-006.

- [ ] **Step 3: Commit the migration file**

```bash
git add infra/sql/007_sweep_permission.sql
git commit -m "feat(db): add certificate.sweep permission migration (007)"
```

---

## Task 2: Refactor — extract `buildHashPayload` to payload-hash module

This refactor lets `SweepService` import the same canonical hash-payload builder used by `CertificatesService`, eliminating drift risk.

**Files:**
- Modify: `src/modules/issuance/certificates/payload-hash/payload-hash.ts`
- Modify: `src/modules/issuance/certificates/certificates.service.ts`

- [ ] **Step 1: Extend `payload-hash.ts` with the helper**

Append to `src/modules/issuance/certificates/payload-hash/payload-hash.ts` (preserving all existing exports):

```ts
import type { Prisma } from '@prisma/client';

export type BuildHashPayloadInput = {
  capital: Prisma.Decimal;
  rate: Prisma.Decimal;
  termDays: 14 | 42;
  issueDate: Date;
  investorId: string;
  price: Prisma.Decimal;
  nominalTarget: Prisma.Decimal;
  nominalActual: Prisma.Decimal;
  payouts: {
    investorPaid: Prisma.Decimal;
    investorReturned: Prisma.Decimal;
    investorYield: Prisma.Decimal;
    shortfallPct: Prisma.Decimal;
  };
  selectedOrderIds: string[];
};

export function buildHashPayload(opts: BuildHashPayloadInput): PayloadHashInput {
  return {
    inputs: {
      capital: opts.capital.toFixed(4),
      rate: opts.rate.toFixed(6),
      term_days: opts.termDays,
      issue_date: opts.issueDate.toISOString().slice(0, 10),
      investor_id: opts.investorId,
    },
    outputs: {
      price: opts.price.toFixed(6),
      nominal_target: opts.nominalTarget.toFixed(4),
      nominal_actual: opts.nominalActual.toFixed(4),
      investor_paid: opts.payouts.investorPaid.toFixed(4),
      investor_returned: opts.payouts.investorReturned.toFixed(4),
      investor_yield: opts.payouts.investorYield.toFixed(4),
      shortfall_pct: opts.payouts.shortfallPct.toFixed(6),
    },
    order_ids: opts.selectedOrderIds,
  };
}
```

(`PayloadHashInput` is the existing type already exported from this file.)

- [ ] **Step 2: Replace `CertificatesService.buildHashPayload` with the import**

In `src/modules/issuance/certificates/certificates.service.ts`:

Change the existing import line:

```ts
import { computePayloadHash } from './payload-hash/payload-hash';
```

to:

```ts
import { computePayloadHash, buildHashPayload } from './payload-hash/payload-hash';
```

Then **delete** the entire `private buildHashPayload(opts: { ... }) { ... }` method (the block starting at the existing `private buildHashPayload(opts: {` near the bottom of the class).

Find the two call sites:

```ts
this.buildHashPayload({
```

and replace each with:

```ts
buildHashPayload({
```

(There are two: one in `simulate` and one in `issue`. The argument shape is identical — no other changes.)

- [ ] **Step 3: Run all certificates tests, expect 18 still passing**

```bash
pnpm vitest run src/modules/issuance/certificates/
```

Expected: 18 passed (no behavior change).

- [ ] **Step 4: TS check + commit**

```bash
pnpm exec tsc --noEmit
git add src/modules/issuance/certificates/payload-hash/payload-hash.ts src/modules/issuance/certificates/certificates.service.ts
git commit -m "refactor(issuance): extract buildHashPayload to payload-hash module"
```

---

## Task 3: Sweep DTO + simulation-result mapper

**Files:**
- Create: `src/modules/issuance/sweep/sweep.dto.ts`
- Create: `src/modules/issuance/sweep/responses/sweep-simulation-result.mapper.ts`

- [ ] **Step 1: Create DTO**

```ts
// src/modules/issuance/sweep/sweep.dto.ts
import { z } from 'zod';

function startOfTodayUTC(): Date {
  const now = new Date();
  return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));
}

const SweepBase = z.object({
  term_days: z.union([z.literal(14), z.literal(42)]),
  issue_date: z.coerce.date(),
  rate: z.coerce.number().min(0).max(0.999999).optional(),
});

export const SweepSimulateSchema = SweepBase.refine(
  (d) => d.issue_date.getTime() >= startOfTodayUTC().getTime(),
  { message: 'La fecha de emisión no puede ser anterior a hoy' },
);

export const SweepIssueSchema = SweepBase.extend({
  order_ids: z.array(z.string().uuid()).min(1).max(2000),
  expected_payload_hash: z.string().regex(/^[a-f0-9]{64}$/),
}).refine(
  (d) => d.issue_date.getTime() >= startOfTodayUTC().getTime(),
  { message: 'La fecha de emisión no puede ser anterior a hoy' },
);

export type SweepSimulate = z.infer<typeof SweepSimulateSchema>;
export type SweepIssue = z.infer<typeof SweepIssueSchema>;
```

- [ ] **Step 2: Create simulation-result mapper**

```ts
// src/modules/issuance/sweep/responses/sweep-simulation-result.mapper.ts
import type { Decimal } from '@prisma/client/runtime/library';

export type SweepSimulationResultInput = {
  investor: { id: string; legal_name: string; rif: string };
  rate: Decimal;
  rate_source: 'settings_default' | 'override';
  term_days: 14 | 42;
  issue_date: Date;
  maturity_date: Date;
  cycle_week: string;
  price: Decimal;
  nominal_actual: Decimal;
  investor_capital: Decimal;
  investor_paid: Decimal;
  investor_returned: Decimal;
  investor_yield: Decimal;
  shortfall_pct: Decimal;
  selected_orders: Array<{
    id: string;
    installments_sum: Decimal;
    merchant_id: string;
    num_installments: number;
    max_due_date: Date;
  }>;
  installment_plazo_days: { min: number; max: number };
  concentration_top: Array<{
    merchant_id: string;
    current_name: string;
    rif: string;
    amount: Decimal;
    pct: Decimal;
  }>;
  total_distinct_merchants: number;
  due_date_distribution: Array<{ date: Date; amount: Decimal }>;
  payload_hash: string;
  warnings: string[];
};

export function toSweepSimulationResult(s: SweepSimulationResultInput) {
  const installment_count = s.selected_orders.reduce((acc, o) => acc + o.num_installments, 0);
  const merchant_count = new Set(s.selected_orders.map((o) => o.merchant_id)).size;

  const out: Record<string, unknown> = {
    rules_check: { maturity_boundary: true, order_indivisibility: true, round_down: true },
    inputs: {
      investor: { id: s.investor.id, legal_name: s.investor.legal_name, rif: s.investor.rif },
      rate: s.rate.toFixed(6),
      rate_source: s.rate_source,
      term_days: s.term_days,
      issue_date: s.issue_date.toISOString().slice(0, 10),
      maturity_date: s.maturity_date.toISOString().slice(0, 10),
      cycle_week: s.cycle_week,
    },
    pricing: { price: s.price.toFixed(6) },
    pool: {
      order_ids: s.selected_orders.map((o) => o.id),
      order_count: s.selected_orders.length,
      merchant_count,
      installment_count,
      installment_plazo_days: s.installment_plazo_days,
    },
    payouts: {
      nominal_actual: s.nominal_actual.toFixed(4),
      investor_capital: s.investor_capital.toFixed(4),
      investor_paid: s.investor_paid.toFixed(4),
      investor_returned: s.investor_returned.toFixed(4),
      investor_yield: s.investor_yield.toFixed(4),
      shortfall_pct: s.shortfall_pct.toFixed(6),
    },
    concentration: {
      top: s.concentration_top.map((c) => ({
        merchant_id: c.merchant_id,
        current_name: c.current_name,
        rif: c.rif,
        amount: c.amount.toFixed(4),
        pct: c.pct.toFixed(6),
      })),
      total_distinct_merchants: s.total_distinct_merchants,
    },
    due_date_distribution: s.due_date_distribution.map((d) => ({
      date: d.date.toISOString().slice(0, 10),
      amount: d.amount.toFixed(4),
    })),
    payload_hash: s.payload_hash,
  };

  if (s.warnings.length > 0) out.warnings = s.warnings;
  return out;
}
```

- [ ] **Step 3: TS check + commit**

```bash
pnpm exec tsc --noEmit
git add src/modules/issuance/sweep/sweep.dto.ts src/modules/issuance/sweep/responses/
git commit -m "feat(sweep): DTO + simulation-result mapper"
```

---

## Task 4: SweepService.simulateSweep (TDD)

**Files:**
- Create: `src/modules/issuance/sweep/sweep.service.ts`
- Create: `src/modules/issuance/sweep/sweep.service.test.ts`

- [ ] **Step 1: Write the failing tests**

```ts
// src/modules/issuance/sweep/sweep.service.test.ts
import { describe, it, expect, vi } from 'vitest';
import {
  BadRequestException,
  ConflictException,
  UnprocessableEntityException,
} from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { SweepService } from './sweep.service';
import { PrismaService } from '../../../prisma/prisma.service';
import { AuditService } from '../../audit/audit.service';

const D = (s: string) => new Prisma.Decimal(s);
const INTERNAL_ID = '9278c875-991c-4472-b2c4-6fd70c512719';

function fakeInternal(overrides: Record<string, unknown> = {}) {
  return {
    id: INTERNAL_ID,
    legal_name: 'Grupo Cashea Ve C.A.',
    rif: 'J-50154179-5',
    kind: 'internal',
    status: 'active',
    ...overrides,
  };
}

function fakeOrder(id: string, sum: string, dueDays: number, merchantId?: string) {
  const dueDate = new Date('2026-05-15');
  dueDate.setUTCDate(dueDate.getUTCDate() + dueDays);
  return {
    id,
    external_order_id: `ORD-${id}`,
    installments_sum: D(sum),
    merchant_id: merchantId ?? `merch-${id}`,
    num_installments: 3,
    max_due_date: dueDate,
    purchase_date: new Date('2026-04-01'),
  };
}

function makePrismaForSimulate() {
  return {
    investor: { findFirst: vi.fn() },
    setting: { findUnique: vi.fn() },
    order: { findMany: vi.fn().mockResolvedValue([]) },
    merchant: { findMany: vi.fn().mockResolvedValue([]) },
    installment: { findMany: vi.fn().mockResolvedValue([]) },
  } as unknown as PrismaService;
}

function makeAudit() {
  return { recordChange: vi.fn().mockResolvedValue(undefined) } as unknown as AuditService;
}

function setupHappyPathMocks(prisma: PrismaService) {
  (prisma.investor.findFirst as ReturnType<typeof vi.fn>).mockResolvedValueOnce(fakeInternal());
  (prisma.setting.findUnique as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
    id: 1,
    default_sweep_rate: D('0.08'),
  });
  (prisma.order.findMany as ReturnType<typeof vi.fn>).mockResolvedValueOnce([
    fakeOrder('a', '60', 7),
    fakeOrder('b', '40', 14),
  ]);
  (prisma.merchant.findMany as ReturnType<typeof vi.fn>).mockResolvedValueOnce([
    { id: 'merch-a', current_name: 'A C.A.', rif: 'J-1' },
    { id: 'merch-b', current_name: 'B C.A.', rif: 'J-2' },
  ]);
  (prisma.installment.findMany as ReturnType<typeof vi.fn>).mockResolvedValueOnce([
    { order_id: 'a', amount: D('20'), due_date: new Date('2026-05-22') },
    { order_id: 'a', amount: D('20'), due_date: new Date('2026-05-29') },
    { order_id: 'a', amount: D('20'), due_date: new Date('2026-06-05') },
    { order_id: 'b', amount: D('20'), due_date: new Date('2026-05-29') },
    { order_id: 'b', amount: D('20'), due_date: new Date('2026-06-05') },
  ]);
}

describe('SweepService.simulateSweep', () => {
  it('happy path: derives capital, target=actual, shortfall=0, payload_hash format', async () => {
    const prisma = makePrismaForSimulate();
    setupHappyPathMocks(prisma);
    const svc = new SweepService(prisma, makeAudit());
    const r = (await svc.simulateSweep({
      term_days: 14,
      issue_date: new Date('2026-05-15'), // Friday
    })) as Record<string, Record<string, unknown>>;

    expect(r.rules_check).toEqual({
      maturity_boundary: true,
      order_indivisibility: true,
      round_down: true,
    });
    expect(r.pool!.order_count).toBe(2);
    expect(r.payouts!.nominal_actual).toBe('100.0000');
    // capital = 100 × price(0.08, 14d) = 100 × 0.996889 = 99.6889
    expect(r.payouts!.investor_capital).toBe('99.6889');
    expect(r.payouts!.investor_returned).toBe('0.0000');
    expect(r.payouts!.shortfall_pct).toBe('0.000000');
    expect(r.payload_hash).toMatch(/^[a-f0-9]{64}$/);
    expect(r.warnings).toBeUndefined(); // 2026-05-15 is a Friday
  });

  it('throws 422 when no eligible orders fit', async () => {
    const prisma = makePrismaForSimulate();
    (prisma.investor.findFirst as ReturnType<typeof vi.fn>).mockResolvedValueOnce(fakeInternal());
    (prisma.setting.findUnique as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
      id: 1,
      default_sweep_rate: D('0.08'),
    });
    (prisma.order.findMany as ReturnType<typeof vi.fn>).mockResolvedValueOnce([]);
    const svc = new SweepService(prisma, makeAudit());
    await expect(
      svc.simulateSweep({ term_days: 14, issue_date: new Date('2026-05-15') }),
    ).rejects.toBeInstanceOf(UnprocessableEntityException);
  });

  it('adds warnings: ["not_friday"] when issue_date is not a Friday', async () => {
    const prisma = makePrismaForSimulate();
    setupHappyPathMocks(prisma);
    const svc = new SweepService(prisma, makeAudit());
    const r = (await svc.simulateSweep({
      term_days: 14,
      issue_date: new Date('2026-05-14'), // Thursday
    })) as Record<string, unknown>;
    expect(r.warnings).toEqual(['not_friday']);
  });

  it('uses settings.default_sweep_rate when rate omitted', async () => {
    const prisma = makePrismaForSimulate();
    setupHappyPathMocks(prisma);
    const svc = new SweepService(prisma, makeAudit());
    const r = (await svc.simulateSweep({
      term_days: 14,
      issue_date: new Date('2026-05-15'),
    })) as Record<string, Record<string, unknown>>;
    expect(r.inputs!.rate).toBe('0.080000');
    expect(r.inputs!.rate_source).toBe('settings_default');
  });

  it('honors operator rate override', async () => {
    const prisma = makePrismaForSimulate();
    setupHappyPathMocks(prisma);
    const svc = new SweepService(prisma, makeAudit());
    const r = (await svc.simulateSweep({
      term_days: 14,
      issue_date: new Date('2026-05-15'),
      rate: 0.1,
    })) as Record<string, Record<string, unknown>>;
    expect(r.inputs!.rate).toBe('0.100000');
    expect(r.inputs!.rate_source).toBe('override');
  });

  it('payload_hash is deterministic across two simulate calls with same inputs', async () => {
    const prisma = makePrismaForSimulate();
    setupHappyPathMocks(prisma);
    const svc = new SweepService(prisma, makeAudit());
    const r1 = (await svc.simulateSweep({
      term_days: 14,
      issue_date: new Date('2026-05-15'),
    })) as Record<string, unknown>;
    setupHappyPathMocks(prisma);
    const r2 = (await svc.simulateSweep({
      term_days: 14,
      issue_date: new Date('2026-05-15'),
    })) as Record<string, unknown>;
    expect(r1.payload_hash).toBe(r2.payload_hash);
  });

  it('throws 400 when internal investor missing', async () => {
    const prisma = makePrismaForSimulate();
    (prisma.investor.findFirst as ReturnType<typeof vi.fn>).mockResolvedValueOnce(null);
    const svc = new SweepService(prisma, makeAudit());
    await expect(
      svc.simulateSweep({ term_days: 14, issue_date: new Date('2026-05-15') }),
    ).rejects.toBeInstanceOf(BadRequestException);
  });
});
```

- [ ] **Step 2: Run, expect fail (module not found)**

```bash
pnpm vitest run src/modules/issuance/sweep/sweep.service.test.ts
```

- [ ] **Step 3: Implement service skeleton + simulateSweep**

```ts
// src/modules/issuance/sweep/sweep.service.ts
import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
  UnprocessableEntityException,
} from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../../../prisma/prisma.service';
import { AuditService } from '../../audit/audit.service';
import { computePricing } from '../certificates/pricing/pricing';
import {
  computePayloadHash,
  buildHashPayload,
} from '../certificates/payload-hash/payload-hash';
import { isoWeek } from '../certificates/helpers/iso-week';
import { toSweepSimulationResult } from './responses/sweep-simulation-result.mapper';
import type { SweepSimulate, SweepIssue } from './sweep.dto';

const D = Prisma.Decimal;
const TOP_N = 5;
const MS_PER_DAY = 86_400_000;
const FRIDAY_DAY_NUM = 5;

type EligibleSweepOrder = {
  id: string;
  external_order_id: string;
  installments_sum: Prisma.Decimal;
  merchant_id: string;
  num_installments: number;
  max_due_date: Date;
  purchase_date: Date;
};

@Injectable()
export class SweepService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
  ) {}

  async simulateSweep(input: SweepSimulate) {
    const investor = await this.prisma.investor.findFirst({ where: { kind: 'internal' } });
    if (!investor) throw new BadRequestException('Inversor interno no configurado');
    if (investor.status !== 'active') {
      throw new BadRequestException('Inversor interno inactivo');
    }

    const settings = await this.prisma.setting.findUnique({ where: { id: 1 } });
    if (!settings) throw new BadRequestException('Configuración del sistema no encontrada');

    const rateSource: 'settings_default' | 'override' =
      input.rate === undefined ? 'settings_default' : 'override';
    const rate =
      input.rate === undefined ? new D(settings.default_sweep_rate) : new D(input.rate);

    const maturityDate = new Date(input.issue_date);
    maturityDate.setUTCDate(maturityDate.getUTCDate() + input.term_days);

    const eligible = (await this.prisma.order.findMany({
      where: { status: 'available', max_due_date: { lte: maturityDate } },
      select: {
        id: true,
        external_order_id: true,
        installments_sum: true,
        merchant_id: true,
        num_installments: true,
        max_due_date: true,
        purchase_date: true,
      },
    })) as EligibleSweepOrder[];

    if (eligible.length === 0) {
      throw new UnprocessableEntityException('No hay stock disponible para barrido');
    }

    const selected = [...eligible].sort((a, b) => {
      const cmp = b.installments_sum.comparedTo(a.installments_sum);
      return cmp !== 0 ? cmp : a.external_order_id.localeCompare(b.external_order_id);
    });

    const nominalActual = selected.reduce(
      (acc, o) => acc.plus(o.installments_sum),
      new D(0),
    );

    // Reuse computePricing for `price`; nominalTarget is discarded (sweep sets target = actual).
    const { price } = computePricing({
      capital: nominalActual,
      rate,
      termDays: input.term_days,
    });

    const investorCapital = nominalActual.mul(price).toDecimalPlaces(4, D.ROUND_HALF_UP);
    const nominalTarget = nominalActual; // sweep invariant
    const investorPaid = investorCapital;
    const investorReturned = new D(0);
    const investorYield = nominalActual.minus(investorCapital);
    const shortfallPct = new D(0);

    const merchantIds = [...new Set(selected.map((o) => o.merchant_id))];
    const merchants = await this.prisma.merchant.findMany({
      where: { id: { in: merchantIds } },
      select: { id: true, current_name: true, rif: true },
    });
    const merchantMap = new Map(merchants.map((m) => [m.id, m]));

    // Concentration aggregation
    const byMerchantSum = new Map<string, Prisma.Decimal>();
    for (const o of selected) {
      byMerchantSum.set(
        o.merchant_id,
        (byMerchantSum.get(o.merchant_id) ?? new D(0)).plus(o.installments_sum),
      );
    }
    const concentrationTop = Array.from(byMerchantSum.entries())
      .sort((a, b) => b[1].comparedTo(a[1]))
      .slice(0, TOP_N)
      .map(([merchant_id, amount]) => {
        const m = merchantMap.get(merchant_id)!;
        return {
          merchant_id,
          current_name: m.current_name,
          rif: m.rif,
          amount,
          pct: nominalActual.isZero()
            ? new D(0)
            : amount.div(nominalActual).toDecimalPlaces(6, D.ROUND_HALF_UP),
        };
      });

    // Installment plazo days range
    let minPlazo = Number.MAX_SAFE_INTEGER;
    let maxPlazo = 0;
    const issueTime = input.issue_date.getTime();
    for (const o of selected) {
      const days = Math.round((o.max_due_date.getTime() - issueTime) / MS_PER_DAY);
      if (days < minPlazo) minPlazo = days;
      if (days > maxPlazo) maxPlazo = days;
    }

    // Due-date distribution
    const installments = await this.prisma.installment.findMany({
      where: { order_id: { in: selected.map((o) => o.id) } },
      select: { order_id: true, amount: true, due_date: true },
    });
    const byDate = new Map<string, Prisma.Decimal>();
    for (const i of installments) {
      const k = i.due_date.toISOString().slice(0, 10);
      byDate.set(k, (byDate.get(k) ?? new D(0)).plus(i.amount));
    }
    const dueDateDistribution = Array.from(byDate.entries())
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([k, amount]) => ({ date: new Date(`${k}T00:00:00Z`), amount }));

    const payloadHash = computePayloadHash(
      buildHashPayload({
        capital: investorCapital,
        rate,
        termDays: input.term_days,
        issueDate: input.issue_date,
        investorId: investor.id,
        price,
        nominalTarget,
        nominalActual,
        payouts: { investorPaid, investorReturned, investorYield, shortfallPct },
        selectedOrderIds: selected.map((o) => o.id),
      }),
    );

    const warnings: string[] = [];
    if (input.issue_date.getUTCDay() !== FRIDAY_DAY_NUM) warnings.push('not_friday');

    return toSweepSimulationResult({
      investor: { id: investor.id, legal_name: investor.legal_name, rif: investor.rif },
      rate,
      rate_source: rateSource,
      term_days: input.term_days,
      issue_date: input.issue_date,
      maturity_date: maturityDate,
      cycle_week: isoWeek(input.issue_date),
      price,
      nominal_actual: nominalActual,
      investor_capital: investorCapital,
      investor_paid: investorPaid,
      investor_returned: investorReturned,
      investor_yield: investorYield,
      shortfall_pct: shortfallPct,
      selected_orders: selected.map((s) => ({
        id: s.id,
        installments_sum: s.installments_sum,
        merchant_id: s.merchant_id,
        num_installments: s.num_installments,
        max_due_date: s.max_due_date,
      })),
      installment_plazo_days: { min: minPlazo, max: maxPlazo },
      concentration_top: concentrationTop,
      total_distinct_merchants: new Set(selected.map((o) => o.merchant_id)).size,
      due_date_distribution: dueDateDistribution,
      payload_hash: payloadHash,
      warnings,
    });
  }

  // issueSweep is filled in Task 5
  async issueSweep(_input: SweepIssue, _actorId: string): Promise<unknown> {
    throw new Error('not implemented');
  }
}
```

- [ ] **Step 4: Run simulate tests, expect 7 pass**

```bash
pnpm vitest run src/modules/issuance/sweep/sweep.service.test.ts -t "simulateSweep"
```

Expected: 7 passed.

- [ ] **Step 5: TS check + commit**

```bash
pnpm exec tsc --noEmit
git add src/modules/issuance/sweep/sweep.service.ts src/modules/issuance/sweep/sweep.service.test.ts
git commit -m "feat(sweep): SweepService.simulateSweep with full pool + warnings (TDD)"
```

---

## Task 5: SweepService.issueSweep (TDD)

**Files:**
- Modify: `src/modules/issuance/sweep/sweep.service.ts`
- Modify: `src/modules/issuance/sweep/sweep.service.test.ts`

- [ ] **Step 1: Append issue tests to `sweep.service.test.ts`**

After the existing `describe('SweepService.simulateSweep', ...)` block, append:

```ts
function makePrismaForIssue(opts: {
  internal?: Record<string, unknown> | null;
  defaultSweepRate?: Prisma.Decimal;
  lockedOrders?: Array<{
    id: string;
    installments_sum: Prisma.Decimal;
    max_due_date: Date;
    merchant_id: string;
    status: string;
    external_order_id: string;
  }>;
  eligibleNow?: Array<{
    id: string;
    external_order_id: string;
    installments_sum: Prisma.Decimal;
    merchant_id: string;
    num_installments: number;
    max_due_date: Date;
    purchase_date: Date;
  }>;
  certificateCode?: string;
  certificateCreateError?: Error;
} = {}) {
  const tx = {
    $queryRaw: vi.fn().mockImplementation(async (template: unknown) => {
      const sql = Array.isArray((template as { strings?: string[] }).strings)
        ? (template as { strings: string[] }).strings.join('?')
        : Array.isArray(template)
          ? (template as string[]).join('?')
          : String(template);
      if (sql.includes('FOR UPDATE')) return opts.lockedOrders ?? [];
      if (sql.includes('next_certificate_code')) {
        return [{ code: opts.certificateCode ?? 'C9999A' }];
      }
      return [];
    }),
    investor: {
      findFirst: vi.fn().mockResolvedValue(opts.internal ?? fakeInternal()),
    },
    setting: {
      findUnique: vi
        .fn()
        .mockResolvedValue({ id: 1, default_sweep_rate: opts.defaultSweepRate ?? D('0.08') }),
    },
    order: {
      findMany: vi.fn().mockResolvedValue(opts.eligibleNow ?? []),
      updateMany: vi.fn().mockResolvedValue({ count: opts.lockedOrders?.length ?? 0 }),
    },
    merchant: { findMany: vi.fn().mockResolvedValue([]) },
    installment: { findMany: vi.fn().mockResolvedValue([]) },
    certificate: {
      create: opts.certificateCreateError
        ? vi.fn().mockRejectedValue(opts.certificateCreateError)
        : vi.fn().mockImplementation(async ({ data }: { data: unknown }) => ({
            id: 'cert-sweep-1',
            ...(data as object),
          })),
    },
    certificateOrder: {
      createMany: vi.fn().mockResolvedValue({ count: opts.lockedOrders?.length ?? 0 }),
    },
    certificateEvent: { create: vi.fn().mockResolvedValue({ id: 'evt-1' }) },
  };
  const prisma = {
    $transaction: vi.fn(async (cb: (t: typeof tx) => Promise<unknown>) => cb(tx)),
    ...tx,
  } as unknown as PrismaService;
  (prisma as unknown as { _tx: typeof tx })._tx = tx;
  return prisma;
}

describe('SweepService.issueSweep', () => {
  it('happy path: locks orders, inserts sweep cert, updates orders, audits', async () => {
    const lockedOrders = [
      {
        id: 'o-a',
        installments_sum: D('60'),
        max_due_date: new Date('2026-05-22'),
        merchant_id: 'm-a',
        status: 'available',
        external_order_id: 'ORD-a',
      },
      {
        id: 'o-b',
        installments_sum: D('40'),
        max_due_date: new Date('2026-05-29'),
        merchant_id: 'm-b',
        status: 'available',
        external_order_id: 'ORD-b',
      },
    ];
    const eligibleNow = lockedOrders.map((o) => ({
      ...o,
      num_installments: 3,
      purchase_date: new Date('2026-04-01'),
    }));
    const prisma = makePrismaForIssue({ lockedOrders, eligibleNow });
    const audit = makeAudit();
    const svc = new SweepService(prisma, audit);

    // Pre-run simulate to obtain the deterministic payload_hash.
    setupHappyPathMocks(prisma);
    // Override findMany to return the same orders simulate will see.
    (prisma.order.findMany as ReturnType<typeof vi.fn>).mockReset();
    (prisma.order.findMany as ReturnType<typeof vi.fn>).mockResolvedValueOnce(eligibleNow);
    (prisma.merchant.findMany as ReturnType<typeof vi.fn>).mockResolvedValueOnce([
      { id: 'm-a', current_name: 'A', rif: 'J-1' },
      { id: 'm-b', current_name: 'B', rif: 'J-2' },
    ]);
    (prisma.installment.findMany as ReturnType<typeof vi.fn>).mockResolvedValueOnce([]);
    const sim = (await svc.simulateSweep({
      term_days: 14,
      issue_date: new Date('2026-05-15'),
    })) as Record<string, Record<string, unknown>>;

    const result = await svc.issueSweep(
      {
        term_days: 14,
        issue_date: new Date('2026-05-15'),
        order_ids: sim.pool!.order_ids as string[],
        expected_payload_hash: sim.payload_hash as string,
      },
      'actor-1',
    );

    const tx = (
      prisma as unknown as {
        _tx: {
          certificate: { create: ReturnType<typeof vi.fn> };
          certificateOrder: { createMany: ReturnType<typeof vi.fn> };
          order: { updateMany: ReturnType<typeof vi.fn> };
          certificateEvent: { create: ReturnType<typeof vi.fn> };
        };
      }
    )._tx;
    expect(tx.certificate.create).toHaveBeenCalledOnce();
    const createArg = tx.certificate.create.mock.calls[0]![0] as {
      data: { certificate_type: string; investor_id: string };
    };
    expect(createArg.data.certificate_type).toBe('sweep');
    expect(createArg.data.investor_id).toBe(INTERNAL_ID);
    expect(tx.certificateOrder.createMany).toHaveBeenCalledOnce();
    expect(tx.order.updateMany).toHaveBeenCalledOnce();
    expect(tx.certificateEvent.create).toHaveBeenCalledOnce();
    expect(audit.recordChange).toHaveBeenCalledOnce();
    expect((result as { id: string; certificate_code: string }).id).toBe('cert-sweep-1');
  });

  it('throws 422 when locked set differs from current eligible set', async () => {
    const lockedOrders = [
      {
        id: 'o-a',
        installments_sum: D('60'),
        max_due_date: new Date('2026-05-22'),
        merchant_id: 'm-a',
        status: 'available',
        external_order_id: 'ORD-a',
      },
    ];
    // eligibleNow contains an EXTRA order ingested between simulate and issue
    const eligibleNow = [
      ...lockedOrders.map((o) => ({
        ...o,
        num_installments: 3,
        purchase_date: new Date('2026-04-01'),
      })),
      {
        id: 'o-new',
        external_order_id: 'ORD-new',
        installments_sum: D('25'),
        merchant_id: 'm-c',
        num_installments: 2,
        max_due_date: new Date('2026-05-22'),
        purchase_date: new Date('2026-05-10'),
      },
    ];
    const prisma = makePrismaForIssue({ lockedOrders, eligibleNow });
    const svc = new SweepService(prisma, makeAudit());
    await expect(
      svc.issueSweep(
        {
          term_days: 14,
          issue_date: new Date('2026-05-15'),
          order_ids: ['o-a'],
          expected_payload_hash: 'a'.repeat(64),
        },
        'actor-1',
      ),
    ).rejects.toBeInstanceOf(UnprocessableEntityException);
  });

  it('throws 409 with cycle_week when Prisma P2002 fires (sweep already exists this week)', async () => {
    const lockedOrders = [
      {
        id: 'o-a',
        installments_sum: D('60'),
        max_due_date: new Date('2026-05-22'),
        merchant_id: 'm-a',
        status: 'available',
        external_order_id: 'ORD-a',
      },
    ];
    const eligibleNow = lockedOrders.map((o) => ({
      ...o,
      num_installments: 3,
      purchase_date: new Date('2026-04-01'),
    }));
    const p2002 = new Prisma.PrismaClientKnownRequestError(
      'Unique constraint failed on uq_certs_one_sweep_per_cycle',
      { code: 'P2002', clientVersion: 'test', meta: { target: ['cycle_week'] } },
    );
    const prisma = makePrismaForIssue({
      lockedOrders,
      eligibleNow,
      certificateCreateError: p2002,
    });
    const svc = new SweepService(prisma, makeAudit());

    // Pre-run simulate so we have a real payload_hash for this scenario
    setupHappyPathMocksForP2002(prisma, eligibleNow);
    const sim = (await svc.simulateSweep({
      term_days: 14,
      issue_date: new Date('2026-05-15'),
    })) as Record<string, Record<string, unknown>>;

    await expect(
      svc.issueSweep(
        {
          term_days: 14,
          issue_date: new Date('2026-05-15'),
          order_ids: sim.pool!.order_ids as string[],
          expected_payload_hash: sim.payload_hash as string,
        },
        'actor-1',
      ),
    ).rejects.toBeInstanceOf(ConflictException);
  });
});

function setupHappyPathMocksForP2002(
  prisma: PrismaService,
  eligibleNow: Array<{ id: string; external_order_id: string; installments_sum: Prisma.Decimal; merchant_id: string; num_installments: number; max_due_date: Date; purchase_date: Date }>,
) {
  (prisma.investor.findFirst as ReturnType<typeof vi.fn>).mockResolvedValueOnce(fakeInternal());
  (prisma.setting.findUnique as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
    id: 1,
    default_sweep_rate: D('0.08'),
  });
  (prisma.order.findMany as ReturnType<typeof vi.fn>).mockReset();
  (prisma.order.findMany as ReturnType<typeof vi.fn>).mockResolvedValueOnce(eligibleNow);
  (prisma.merchant.findMany as ReturnType<typeof vi.fn>).mockResolvedValueOnce([
    { id: 'm-a', current_name: 'A', rif: 'J-1' },
  ]);
  (prisma.installment.findMany as ReturnType<typeof vi.fn>).mockResolvedValueOnce([]);
}
```

- [ ] **Step 2: Run, expect fail**

```bash
pnpm vitest run src/modules/issuance/sweep/sweep.service.test.ts -t "issueSweep"
```

- [ ] **Step 3: Replace the `issueSweep` stub**

In `src/modules/issuance/sweep/sweep.service.ts`, replace the existing:

```ts
async issueSweep(_input: SweepIssue, _actorId: string): Promise<unknown> {
  throw new Error('not implemented');
}
```

with:

```ts
async issueSweep(input: SweepIssue, actorId: string) {
  return await this.prisma.$transaction(
    async (tx) => {
      const investor = await tx.investor.findFirst({ where: { kind: 'internal' } });
      if (!investor) throw new BadRequestException('Inversor interno no configurado');
      if (investor.status !== 'active') {
        throw new BadRequestException('Inversor interno inactivo');
      }

      const settings = await tx.setting.findUnique({ where: { id: 1 } });
      if (!settings) throw new BadRequestException('Configuración del sistema no encontrada');

      const rate =
        input.rate === undefined ? new D(settings.default_sweep_rate) : new D(input.rate);

      const maturityDate = new Date(input.issue_date);
      maturityDate.setUTCDate(maturityDate.getUTCDate() + input.term_days);

      const lockedOrders = await tx.$queryRaw<
        Array<{
          id: string;
          external_order_id: string;
          installments_sum: Prisma.Decimal;
          max_due_date: Date;
          merchant_id: string;
          status: string;
        }>
      >(
        Prisma.sql`SELECT id, external_order_id, installments_sum, max_due_date, merchant_id, status
                   FROM cfb.orders
                   WHERE id = ANY(${input.order_ids}::uuid[])
                   FOR UPDATE`,
      );

      if (lockedOrders.length !== input.order_ids.length) {
        throw new ConflictException({
          message: 'Una o más órdenes no existen',
          missing_count: input.order_ids.length - lockedOrders.length,
        });
      }

      const conflicting = lockedOrders.filter((o) => o.status !== 'available');
      if (conflicting.length > 0) {
        throw new ConflictException({
          message: 'Orden(es) ya asignada(s) a otro certificado',
          conflicting_order_ids: conflicting.map((o) => o.id),
        });
      }

      const maxDue = lockedOrders.reduce(
        (m, o) => (o.max_due_date > m ? o.max_due_date : m),
        new Date(0),
      );
      if (maxDue > maturityDate) {
        throw new UnprocessableEntityException(
          'Una orden tiene cuotas que vencen después del vencimiento del certificado',
        );
      }

      // Defense-in-depth: compare locked claim vs current eligible set.
      const eligibleNow = (await tx.order.findMany({
        where: { status: 'available', max_due_date: { lte: maturityDate } },
        select: {
          id: true,
          external_order_id: true,
          installments_sum: true,
          merchant_id: true,
          num_installments: true,
          max_due_date: true,
          purchase_date: true,
        },
      })) as EligibleSweepOrder[];

      const eligibleIds = new Set(eligibleNow.map((o) => o.id));
      const claimedIds = new Set(input.order_ids);
      if (
        eligibleIds.size !== claimedIds.size ||
        ![...eligibleIds].every((id) => claimedIds.has(id))
      ) {
        throw new UnprocessableEntityException(
          'Pool inválido — el conjunto elegible cambió. Re-corra /simulate',
        );
      }

      // Deterministic sort matching simulate
      const selected = [...eligibleNow].sort((a, b) => {
        const cmp = b.installments_sum.comparedTo(a.installments_sum);
        return cmp !== 0 ? cmp : a.external_order_id.localeCompare(b.external_order_id);
      });

      const nominalActual = selected.reduce(
        (acc, o) => acc.plus(o.installments_sum),
        new D(0),
      );
      const { price } = computePricing({
        capital: nominalActual,
        rate,
        termDays: input.term_days,
      });
      const investorCapital = nominalActual.mul(price).toDecimalPlaces(4, D.ROUND_HALF_UP);
      const nominalTarget = nominalActual;
      const investorPaid = investorCapital;
      const investorReturned = new D(0);
      const investorYield = nominalActual.minus(investorCapital);
      const shortfallPct = new D(0);

      const recomputedHash = computePayloadHash(
        buildHashPayload({
          capital: investorCapital,
          rate,
          termDays: input.term_days,
          issueDate: input.issue_date,
          investorId: investor.id,
          price,
          nominalTarget,
          nominalActual,
          payouts: { investorPaid, investorReturned, investorYield, shortfallPct },
          selectedOrderIds: selected.map((o) => o.id),
        }),
      );

      if (recomputedHash !== input.expected_payload_hash) {
        throw new UnprocessableEntityException('Payload mismatch — re-corra /simulate');
      }

      const cycleWeek = isoWeek(input.issue_date);
      const codeRows = await tx.$queryRaw<[{ code: string }]>(
        Prisma.sql`SELECT cfb.next_certificate_code() AS code`,
      );
      const certificateCode = codeRows[0].code;

      try {
        const cert = await tx.certificate.create({
          data: {
            certificate_code: certificateCode,
            certificate_type: 'sweep',
            status: 'issued',
            investor_id: investor.id,
            investor_capital: investorCapital,
            annual_rate: rate,
            rate_basis: 'ACT/360',
            term_days: input.term_days,
            price,
            nominal_target: nominalTarget,
            nominal_actual: nominalActual,
            investor_paid: investorPaid,
            investor_returned: investorReturned,
            investor_yield: investorYield,
            shortfall_pct: shortfallPct,
            issue_date: input.issue_date,
            maturity_date: maturityDate,
            cycle_week: cycleWeek,
            payload_hash: recomputedHash,
            issued_by_id: actorId,
          },
        });

        await tx.certificateOrder.createMany({
          data: selected.map((o) => ({
            certificate_id: cert.id,
            order_id: o.id,
            installments_sum_snapshot: o.installments_sum,
            assigned_by_id: actorId,
          })),
        });

        await tx.order.updateMany({
          where: { id: { in: selected.map((o) => o.id) } },
          data: { status: 'assigned' },
        });

        await tx.certificateEvent.create({
          data: {
            certificate_id: cert.id,
            event_type: 'created',
            payload: {
              certificate_type: 'sweep',
              certificate_code: certificateCode,
              cycle_week: cycleWeek,
              order_count: selected.length,
              nominal_actual: nominalActual.toFixed(4),
              investor_capital: investorCapital.toFixed(4),
            } as Prisma.InputJsonValue,
            actor_id: actorId,
          },
        });

        await this.audit.recordChange({
          entityType: 'certificate',
          entityId: cert.id,
          action: 'create',
          actorId,
          payload: {
            certificate_type: 'sweep',
            certificate_code: certificateCode,
            cycle_week: cycleWeek,
            inputs: {
              rate: rate.toFixed(6),
              term_days: input.term_days,
              issue_date: input.issue_date.toISOString().slice(0, 10),
              investor_id: investor.id,
            },
            order_count: selected.length,
            payload_hash: recomputedHash,
          },
          tx,
        });

        return { id: cert.id, certificate_code: certificateCode };
      } catch (e) {
        if (
          e instanceof Prisma.PrismaClientKnownRequestError &&
          e.code === 'P2002'
        ) {
          throw new ConflictException({
            message: 'Ya existe un sweep para esta semana',
            cycle_week: cycleWeek,
          });
        }
        throw e;
      }
    },
    { timeout: 30_000 },
  );
}
```

- [ ] **Step 4: Run issue tests, expect 3 pass**

```bash
pnpm vitest run src/modules/issuance/sweep/sweep.service.test.ts -t "issueSweep"
```

Expected: 3 passed.

- [ ] **Step 5: Run all sweep service tests, expect 10 pass**

```bash
pnpm vitest run src/modules/issuance/sweep/sweep.service.test.ts
```

Expected: 10 passed (7 simulate + 3 issue).

- [ ] **Step 6: TS check + commit**

```bash
pnpm exec tsc --noEmit
git add src/modules/issuance/sweep/sweep.service.ts src/modules/issuance/sweep/sweep.service.test.ts
git commit -m "feat(sweep): SweepService.issueSweep with FOR UPDATE + P2002 conflict translation (TDD)"
```

---

## Task 6: SweepController + integration tests (TDD)

**Files:**
- Create: `src/modules/issuance/sweep/sweep.controller.ts`
- Create: `src/modules/issuance/sweep/sweep.controller.test.ts`

- [ ] **Step 1: Write the failing controller test**

```ts
// src/modules/issuance/sweep/sweep.controller.test.ts
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { Test } from '@nestjs/testing';
import { ConflictException, INestApplication } from '@nestjs/common';
import { APP_GUARD } from '@nestjs/core';
import { ConfigService } from '@nestjs/config';
import request from 'supertest';
import { SweepController } from './sweep.controller';
import { SweepService } from './sweep.service';
import { JwtService } from '../../auth/jwt.service';
import { UserLookupService } from '../../auth/user-lookup.service';
import { JwtAuthGuard } from '../../auth/jwt-auth.guard';
import { PermissionsGuard } from '../../auth/permissions.guard';
import { PrismaService } from '../../../prisma/prisma.service';
import { mintTestJwt, TEST_SECRET } from '../../../../test/helpers/jwt.helper';
import { mockAuthUser } from '../../../../test/helpers/auth-user.helper';

describe('SweepController', () => {
  let app: INestApplication;
  let svc: {
    simulateSweep: ReturnType<typeof vi.fn>;
    issueSweep: ReturnType<typeof vi.fn>;
  };
  let prismaPerms: ReturnType<typeof vi.fn>;

  beforeEach(async () => {
    svc = { simulateSweep: vi.fn(), issueSweep: vi.fn() };
    prismaPerms = vi.fn().mockResolvedValue([{ permission: { key: 'certificate.sweep' } }]);
    const config = {
      get: (k: string) => (k === 'SUPABASE_JWT_SECRET' ? TEST_SECRET : undefined),
    } as unknown as ConfigService;

    const moduleRef = await Test.createTestingModule({
      controllers: [SweepController],
      providers: [
        { provide: SweepService, useValue: svc },
        { provide: ConfigService, useValue: config },
        JwtService,
        {
          provide: UserLookupService,
          useValue: {
            findByAuthId: vi
              .fn()
              .mockResolvedValue({ kind: 'found', user: mockAuthUser({ role: 'operator' }) }),
          },
        },
        { provide: PrismaService, useValue: { rolePermission: { findMany: prismaPerms } } },
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

  const futureDate = () => {
    const d = new Date();
    d.setUTCDate(d.getUTCDate() + 7);
    return d.toISOString().slice(0, 10);
  };

  it('POST /api/certificates/sweep/simulate → 401 without token', async () => {
    await request(app.getHttpServer())
      .post('/api/certificates/sweep/simulate')
      .send({})
      .expect(401);
  });

  it('POST /api/certificates/sweep/simulate → 403 when role lacks certificate.sweep', async () => {
    prismaPerms.mockResolvedValueOnce([{ permission: { key: 'certificate.read' } }]);
    const t = await mintTestJwt({ sub: 'auth-uuid' });
    await request(app.getHttpServer())
      .post('/api/certificates/sweep/simulate')
      .set('Authorization', `Bearer ${t}`)
      .send({ term_days: 14, issue_date: futureDate() })
      .expect(403);
  });

  it('POST /api/certificates/sweep/simulate → 200 happy', async () => {
    svc.simulateSweep.mockResolvedValueOnce({
      rules_check: { maturity_boundary: true, order_indivisibility: true, round_down: true },
      payload_hash: 'a'.repeat(64),
    });
    const t = await mintTestJwt({ sub: 'auth-uuid' });
    const res = await request(app.getHttpServer())
      .post('/api/certificates/sweep/simulate')
      .set('Authorization', `Bearer ${t}`)
      .send({ term_days: 14, issue_date: futureDate() })
      .expect(200);
    expect(res.body.payload_hash).toMatch(/^[a-f0-9]{64}$/);
  });

  it('POST /api/certificates/sweep → 401 without token', async () => {
    await request(app.getHttpServer())
      .post('/api/certificates/sweep')
      .send({})
      .expect(401);
  });

  it('POST /api/certificates/sweep → 201 happy', async () => {
    svc.issueSweep.mockResolvedValueOnce({ id: 'cert-1', certificate_code: 'C4575A' });
    const t = await mintTestJwt({ sub: 'auth-uuid' });
    const res = await request(app.getHttpServer())
      .post('/api/certificates/sweep')
      .set('Authorization', `Bearer ${t}`)
      .send({
        term_days: 14,
        issue_date: futureDate(),
        order_ids: ['00000000-0000-4000-8000-000000000010'],
        expected_payload_hash: 'a'.repeat(64),
      })
      .expect(201);
    expect(res.body.certificate_code).toBe('C4575A');
  });

  it('POST /api/certificates/sweep → 409 when service throws ConflictException', async () => {
    svc.issueSweep.mockRejectedValueOnce(
      new ConflictException({
        message: 'Ya existe un sweep para esta semana',
        cycle_week: '2026-W20',
      }),
    );
    const t = await mintTestJwt({ sub: 'auth-uuid' });
    const res = await request(app.getHttpServer())
      .post('/api/certificates/sweep')
      .set('Authorization', `Bearer ${t}`)
      .send({
        term_days: 14,
        issue_date: futureDate(),
        order_ids: ['00000000-0000-4000-8000-000000000010'],
        expected_payload_hash: 'a'.repeat(64),
      })
      .expect(409);
    expect(res.body.cycle_week).toBe('2026-W20');
  });
});
```

- [ ] **Step 2: Run, expect fail**

```bash
pnpm vitest run src/modules/issuance/sweep/sweep.controller.test.ts
```

- [ ] **Step 3: Implement controller**

```ts
// src/modules/issuance/sweep/sweep.controller.ts
import { Body, Controller, HttpCode, HttpStatus, Post } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { CurrentUser } from '../../auth/decorators/current-user.decorator';
import { RequirePermission } from '../../auth/decorators/require-permission.decorator';
import type { AuthUser } from '../../auth/types';
import { ZodValidationPipe } from '../../../common/pipes/zod-validation.pipe';
import { SweepService } from './sweep.service';
import {
  SweepSimulateSchema,
  SweepIssueSchema,
  type SweepSimulate,
  type SweepIssue,
} from './sweep.dto';

@ApiTags('certificates')
@ApiBearerAuth()
@Controller('certificates/sweep')
export class SweepController {
  constructor(private readonly sweep: SweepService) {}

  @Post('simulate')
  @HttpCode(HttpStatus.OK)
  @RequirePermission('certificate.sweep')
  simulate(@Body(new ZodValidationPipe(SweepSimulateSchema)) body: SweepSimulate) {
    return this.sweep.simulateSweep(body);
  }

  @Post()
  @HttpCode(HttpStatus.CREATED)
  @RequirePermission('certificate.sweep')
  issue(
    @Body(new ZodValidationPipe(SweepIssueSchema)) body: SweepIssue,
    @CurrentUser() user: AuthUser,
  ) {
    return this.sweep.issueSweep(body, user.id);
  }
}
```

- [ ] **Step 4: Run controller tests, expect 6 pass**

```bash
pnpm vitest run src/modules/issuance/sweep/sweep.controller.test.ts
```

Expected: 6 passed.

- [ ] **Step 5: TS check + commit**

```bash
pnpm exec tsc --noEmit
git add src/modules/issuance/sweep/sweep.controller.ts src/modules/issuance/sweep/sweep.controller.test.ts
git commit -m "feat(sweep): SweepController with 2 endpoints (TDD)"
```

---

## Task 7: Wire into IssuanceModule + smoke + openapi

**Files:**
- Modify: `src/modules/issuance/issuance.module.ts`
- Generate + force-add: `openapi.json`

- [ ] **Step 1: Wire SweepController + SweepService into IssuanceModule**

Read `src/modules/issuance/issuance.module.ts`. The current file imports investors and certificates pieces; add:

```ts
import { SweepController } from './sweep/sweep.controller';
import { SweepService } from './sweep/sweep.service';
```

And extend the `controllers` and `providers` arrays in the `@Module({ ... })` decorator:

```ts
@Module({
  controllers: [InvestorsController, CertificatesController, SweepController],
  providers: [InvestorsService, CertificatesService, SweepService],
})
export class IssuanceModule {}
```

- [ ] **Step 2: TS + full suite**

```bash
pnpm exec tsc --noEmit && pnpm test 2>&1 | tail -10
```

Expected: zero TS errors, ~216 tests passing (200 from Slices 0-4a + 16 from Slice 4b: 7 simulate + 3 issue + 6 controller).

- [ ] **Step 3: Commit wiring**

```bash
git add src/modules/issuance/issuance.module.ts
git commit -m "feat(sweep): wire SweepModule into IssuanceModule"
```

- [ ] **Step 4: Smoke test against real Supabase**

The 2 ORD-SMOKE orders from Slice 2 are now `assigned` to C4572A. To smoke sweep we need fresh `available` orders. Use Supabase MCP to insert two test orders; then run the smoke flow.

First verify migration 007 has been applied (Task 1 step 2). If not, apply it now via SQL Editor.

Insert 2 fresh test orders via Supabase MCP `execute_sql`:

```sql
-- One-time test order seed for sweep smoke. Pick a merchant + end_user that already exist.
INSERT INTO cfb.orders (
  external_order_id, merchant_id, end_user_id, batch_id,
  status, num_installments, installments_sum,
  purchase_date, max_due_date
)
SELECT
  'ORD-SMOKE-SWEEP-' || g, m.id, eu.id, b.id,
  'available', 3, 60.00,
  CURRENT_DATE - INTERVAL '5 days', CURRENT_DATE + INTERVAL '10 days'
FROM
  (SELECT generate_series(1, 2) AS g) gen,
  (SELECT id FROM cfb.merchants LIMIT 1) m,
  (SELECT id FROM cfb.end_users LIMIT 1) eu,
  (SELECT id FROM cfb.batches LIMIT 1) b
RETURNING id, external_order_id, installments_sum, max_due_date, status;
```

Boot dev server:

```bash
lsof -ti:3001 | xargs -r kill -9 2>/dev/null; sleep 1
pnpm dev > /tmp/araguaney-dev.log 2>&1 &
DEV_PID=$!
sleep 7
tail -20 /tmp/araguaney-dev.log
```

Smoke script:

```bash
cat > scripts/smoke-slice4b.ts <<'TSEOF'
import 'dotenv/config';
import { SignJWT } from 'jose';
import { request as httpRequest } from 'node:http';
import { URL } from 'node:url';
import { Buffer } from 'node:buffer';

const BASE = 'http://localhost:3001';
const SUB = '4bba7f81-443c-47b2-9bec-bc5a502380cc';

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

function nextFridayISO(): string {
  const d = new Date();
  const dayNum = d.getUTCDay();
  const offset = (5 - dayNum + 7) % 7 || 7; // next Friday (skip today if already Friday)
  d.setUTCDate(d.getUTCDate() + offset);
  return d.toISOString().slice(0, 10);
}

async function main() {
  const t = await token();
  const friday = nextFridayISO();

  const sim = await call('POST', '/api/certificates/sweep/simulate', t, {
    term_days: 14, issue_date: friday,
  });
  console.log(`${sim.status} POST /sweep/simulate\n${sim.body.slice(0, 600)}\n---`);
  if (sim.status !== 200) return;
  const simData = JSON.parse(sim.body);

  const iss = await call('POST', '/api/certificates/sweep', t, {
    term_days: 14, issue_date: friday,
    order_ids: simData.pool.order_ids,
    expected_payload_hash: simData.payload_hash,
  });
  console.log(`${iss.status} POST /sweep\n${iss.body.slice(0, 400)}\n---`);

  if (iss.status === 201) {
    // Idempotency: re-issue with same week → 409 (P2002 translated)
    const dup = await call('POST', '/api/certificates/sweep', t, {
      term_days: 14, issue_date: friday,
      order_ids: simData.pool.order_ids,
      expected_payload_hash: simData.payload_hash,
    });
    console.log(`${dup.status} POST /sweep (re-emit, expect 409)\n${dup.body.slice(0, 240)}\n---`);
  }
}
main().catch((e) => { console.error(e); process.exit(1); });
TSEOF
pnpm exec tsx scripts/smoke-slice4b.ts 2>&1 | head -120
rm -f scripts/smoke-slice4b.ts
```

Expected:
- POST /sweep/simulate → 200, pool order_count=2, `payouts.nominal_actual="120.0000"`, `payouts.investor_capital="119.6267"` (= 120 × 0.996889) approximately
- POST /sweep → 201, certificate_code starting with `C` (e.g. `C4575A`)
- Re-emit → 409 with `cycle_week`

Verify in Supabase MCP:

```sql
SELECT count(*) FROM cfb.certificates WHERE certificate_type='sweep';
-- Expected: 1 (or more if re-tested)
SELECT count(*) FROM cfb.orders WHERE status='assigned';
-- Expected: previous count + 2
SELECT count(*) FROM cfb.audit_log WHERE entity_type='certificate' AND payload->>'certificate_type' = 'sweep';
-- Expected: 1 (or more)
```

Stop server:

```bash
kill $DEV_PID 2>/dev/null; wait $DEV_PID 2>/dev/null
lsof -ti:3001 | xargs -r kill -9 2>/dev/null
```

- [ ] **Step 5: Regenerate openapi.json**

```bash
pnpm openapi:export
node -e "const d = require('./openapi.json'); const ks = Object.keys(d.paths).sort(); console.log(ks); console.log('paths count:', ks.length); console.log('has sweep:', ks.filter(k => k.includes('sweep')));"
```

Expected paths to include the 2 new sweep paths: `/api/certificates/sweep`, `/api/certificates/sweep/simulate`. Total ~20 paths.

- [ ] **Step 6: Force-add and commit openapi**

```bash
git add -f openapi.json
git commit -m "feat(openapi): regenerate with sweep endpoints (simulate + issue)"
```

---

## Self-review

**1. Spec coverage:**

| Spec section | Implemented in task |
|---|---|
| §3 Architecture (sweep/ folder, IssuanceModule reg) | Tasks 4-7 |
| §4.1 POST /sweep/simulate (Zod schema, response shape, warnings) | Tasks 3, 4, 6 |
| §4.2 POST /sweep (Zod schema, response shape) | Tasks 3, 5, 6 |
| §4.3 Error matrix (401/403/409/422/400) | Tasks 4, 5, 6 |
| §5.1 Pool selection (sort, all-eligible, empty=422) | Task 4 |
| §5.2 Math (price, derived capital, target=actual, shortfall=0) | Tasks 4, 5 |
| §5.3 payload_hash via shared buildHashPayload | Tasks 2, 4, 5 |
| §6 issueSweep transaction with FOR UPDATE + re-fetch + P2002 catch | Task 5 |
| §7 SQL migration 007_sweep_permission.sql | Task 1 |
| §8 Audit log row with certificate_type='sweep' | Task 5 |
| §9.1 Service tests (10) | Tasks 4 (7) + 5 (3) |
| §9.2 Controller tests (6) | Task 6 |
| §9.3 Smoke real | Task 7 step 4 |
| §10 Acceptance criteria (lint, typecheck, openapi, smoke) | Tasks 5/6/7 |

**2. Placeholder scan:**

No "TBD", "TODO", "implement later" patterns. The single `throw new Error('not implemented')` stub for `issueSweep` in Task 4 is explicit scaffolding replaced in Task 5 — not a plan failure.

**3. Type/name consistency:**

- `EligibleSweepOrder` defined in Task 4, reused in Task 5. ✓
- `SweepSimulate`, `SweepIssue` defined in Task 3, used in Tasks 4/5/6. ✓
- `BuildHashPayloadInput` defined in Task 2, used in Tasks 4/5. ✓
- `toSweepSimulationResult` defined in Task 3, used in Task 4. ✓
- `D = Prisma.Decimal`, `TOP_N = 5`, `MS_PER_DAY = 86_400_000`, `FRIDAY_DAY_NUM = 5` — defined in Task 4 service module. ✓
- Prisma model accessors: `setting` (singular, matches `model Setting` in schema.prisma), `investor.findFirst`, `certificate.create`, `certificateOrder.createMany`, `certificateEvent.create` — all match Slice 0 conventions verified during Slice 4a. ✓
- `AuditService.recordChange({ entityType, entityId, action, actorId, payload, tx })` — same signature used in 4a. ✓

No issues found.

---

## Execution

Plan complete and saved to `docs/superpowers/plans/2026-05-06-slice-4b-sweep.md`. Two execution options:

1. **Subagent-Driven (recommended)** — fresh subagent per task, two-stage review.
2. **Inline Execution** — execute tasks in this session with checkpoints.

Which approach?

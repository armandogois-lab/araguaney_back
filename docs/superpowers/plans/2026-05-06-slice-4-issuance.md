# Slice 4a — Emisión (core) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build the certificate issuance core: investor CRUD-light (list/detail/create), `POST /api/certificates/simulate` (greedy descending pool selection + pricing preview, no DB writes), `POST /api/certificates` (atomic transactional issue with `SELECT FOR UPDATE`, `cfb.next_certificate_code()`, audit log), and read endpoints.

**Architecture:** Pure-function libs (`pricing.ts`, `pool-builder.ts`, `payload-hash.ts`, `iso-week.ts`) hold all financial math and are unit-tested without Prisma — reusable for Slice 4b sweep. `IssuanceModule` aggregates `investors/` and `certificates/` sub-features with their own controllers/services/DTOs/mappers. `CertificatesService.issue` runs everything in `prisma.$transaction({ timeout: 30_000 })`: lock orders with raw SQL `SELECT ... FOR UPDATE`, recompute pool + payload_hash and reject 409/422 on any divergence, INSERT certificate (`certificate_code` from `cfb.next_certificate_code()` raw SQL), INSERT certificate_orders, UPDATE orders.status='assigned' (DB trigger logs events), INSERT certificate_events 'created', AuditService.recordChange.

**Tech Stack:** NestJS 10, TypeScript 5 strict, Prisma 5 (Decimal arithmetic + raw SQL for FOR UPDATE and next_certificate_code), Zod, Vitest, supertest. Reuses jose / nestjs-pino / RIF normalizer / AuditService / xlsx-helper-not-needed-here from prior slices. **No new dependencies, no new SQL migrations.**

---

## Spec reference

`docs/superpowers/specs/2026-05-06-slice-4-issuance-design.md`. Read first if you need product context (the 3 hard rules, the screenshot of the "Vista previa del pool" wizard, the algorithm declaration, etc.).

## File structure

```
src/modules/issuance/
  issuance.module.ts                          CREATE
  investors/
    investors.controller.ts                   CREATE: GET list, GET :id, POST
    investors.service.ts                      CREATE
    investors.service.test.ts                 CREATE: 6 tests
    investors.controller.test.ts              CREATE: 7 tests
    investors.dto.ts                          CREATE: list query + create body Zod
    responses/
      investor-summary.mapper.ts              CREATE
      investor-detail.mapper.ts               CREATE
  certificates/
    certificates.controller.ts                CREATE: 4 endpoints
    certificates.service.ts                   CREATE
    certificates.service.test.ts              CREATE: 17 tests
    certificates.controller.test.ts           CREATE: 9 tests
    certificates.dto.ts                       CREATE: SimulateSchema, IssueSchema, list query
    responses/
      certificate-summary.mapper.ts           CREATE
      certificate-detail.mapper.ts            CREATE
      simulation-result.mapper.ts             CREATE: simulate response shape
    pricing/
      pricing.ts                              CREATE: computePricing, computePayouts (pure)
      pricing.test.ts                         CREATE: 7 tests
    pool-builder/
      pool-builder.ts                         CREATE: fillPool (pure)
      pool-builder.test.ts                    CREATE: 8 tests
    payload-hash/
      payload-hash.ts                         CREATE: computePayloadHash (pure)
      payload-hash.test.ts                    CREATE: 4 tests
    helpers/
      iso-week.ts                             CREATE: isoWeek pure fn
      iso-week.test.ts                        CREATE: 4 tests

src/app.module.ts                             MODIFY: import IssuanceModule

openapi.json                                  REGENERATE + COMMIT
```

---

## Task 1: Pricing + Pool builder (pure functions, TDD)

**Files:**
- Create: `src/modules/issuance/certificates/pricing/pricing.ts`
- Create: `src/modules/issuance/certificates/pricing/pricing.test.ts`
- Create: `src/modules/issuance/certificates/pool-builder/pool-builder.ts`
- Create: `src/modules/issuance/certificates/pool-builder/pool-builder.test.ts`

- [ ] **Step 1: Write pricing tests**

```ts
// src/modules/issuance/certificates/pricing/pricing.test.ts
import { describe, it, expect } from 'vitest';
import { Prisma } from '@prisma/client';
import { computePricing, computePayouts } from './pricing';

const D = (s: string) => new Prisma.Decimal(s);

describe('computePricing', () => {
  it('computes price for 13% × 42d as 0.984833', () => {
    const r = computePricing({ capital: D('100000'), rate: D('0.13'), termDays: 42 });
    expect(r.price.toFixed(6)).toBe('0.984833');
  });

  it('computes price for 8% × 14d as 0.996889', () => {
    const r = computePricing({ capital: D('100000'), rate: D('0.08'), termDays: 14 });
    expect(r.price.toFixed(6)).toBe('0.996889');
  });

  it('computes nominal_target = capital / price (HALF_UP to 4 decimals)', () => {
    const r = computePricing({ capital: D('100000'), rate: D('0.13'), termDays: 42 });
    expect(r.nominalTarget.toFixed(4)).toBe('101540.6028');
  });

  it('handles zero rate → price = 1, target = capital', () => {
    const r = computePricing({ capital: D('1000'), rate: D('0'), termDays: 14 });
    expect(r.price.toFixed(6)).toBe('1.000000');
    expect(r.nominalTarget.toFixed(4)).toBe('1000.0000');
  });
});

describe('computePayouts', () => {
  it('investor_paid = nominal_actual × price (HALF_UP to 4 decimals)', () => {
    const r = computePayouts({
      capital: D('100000'),
      price: D('0.984833'),
      nominalTarget: D('101540.6028'),
      nominalActual: D('101540.0034'),
    });
    expect(r.investorPaid.toFixed(4)).toBe('99999.4093');
  });

  it('investor_returned = capital − investor_paid', () => {
    const r = computePayouts({
      capital: D('100000'),
      price: D('0.984833'),
      nominalTarget: D('101540.6028'),
      nominalActual: D('101540.0034'),
    });
    // investor_paid = 99999.4093, returned = 100000 - 99999.4093 = 0.5907
    expect(r.investorReturned.toFixed(4)).toBe('0.5907');
  });

  it('shortfall_pct is zero when nominal_actual == target', () => {
    const r = computePayouts({
      capital: D('100000'),
      price: D('0.984833'),
      nominalTarget: D('101540.6028'),
      nominalActual: D('101540.6028'),
    });
    expect(r.shortfallPct.toFixed(6)).toBe('0.000000');
  });
});
```

- [ ] **Step 2: Run tests, expect fail**

```bash
pnpm vitest run src/modules/issuance/certificates/pricing/pricing.test.ts
```

Expected: FAIL — module not found.

- [ ] **Step 3: Implement pricing**

```ts
// src/modules/issuance/certificates/pricing/pricing.ts
import { Prisma } from '@prisma/client';

const D = Prisma.Decimal;

export type PricingInputs = {
  capital: Prisma.Decimal;
  rate: Prisma.Decimal;
  termDays: 14 | 42;
};

export type Pricing = {
  price: Prisma.Decimal;
  nominalTarget: Prisma.Decimal;
};

export function computePricing(i: PricingInputs): Pricing {
  const ratio = i.rate.mul(i.termDays).div(360);
  const price = new D(1).minus(ratio).toDecimalPlaces(6, D.ROUND_HALF_UP);
  const nominalTarget = i.capital.div(price).toDecimalPlaces(4, D.ROUND_HALF_UP);
  return { price, nominalTarget };
}

export type Payouts = {
  investorPaid: Prisma.Decimal;
  investorReturned: Prisma.Decimal;
  investorYield: Prisma.Decimal;
  shortfallPct: Prisma.Decimal;
};

export function computePayouts(opts: {
  capital: Prisma.Decimal;
  price: Prisma.Decimal;
  nominalTarget: Prisma.Decimal;
  nominalActual: Prisma.Decimal;
}): Payouts {
  const investorPaid = opts.nominalActual.mul(opts.price).toDecimalPlaces(4, D.ROUND_HALF_UP);
  const investorReturned = opts.capital.minus(investorPaid);
  const investorYield = opts.nominalActual.minus(investorPaid);
  const shortfallPct = opts.nominalTarget.isZero()
    ? new D(0)
    : opts.nominalTarget.minus(opts.nominalActual).div(opts.nominalTarget)
        .toDecimalPlaces(6, D.ROUND_HALF_UP);
  return { investorPaid, investorReturned, investorYield, shortfallPct };
}
```

- [ ] **Step 4: Run pricing tests, expect pass (7)**

```bash
pnpm vitest run src/modules/issuance/certificates/pricing/pricing.test.ts
```

- [ ] **Step 5: Write pool-builder tests**

```ts
// src/modules/issuance/certificates/pool-builder/pool-builder.test.ts
import { describe, it, expect } from 'vitest';
import { Prisma } from '@prisma/client';
import { fillPool, type EligibleOrder } from './pool-builder';

const D = (s: string) => new Prisma.Decimal(s);

function order(id: string, sum: string, externalId?: string): EligibleOrder {
  return {
    id,
    external_order_id: externalId ?? id,
    installments_sum: D(sum),
    merchant_id: 'm-1',
    num_installments: 3,
    max_due_date: new Date('2026-06-12'),
  };
}

describe('fillPool', () => {
  it('returns empty when eligible is empty', () => {
    const r = fillPool([], D('100'));
    expect(r.selected).toEqual([]);
    expect(r.nominalActual.toFixed(4)).toBe('0.0000');
  });

  it('adopts all when total fits target', () => {
    const r = fillPool([order('a', '50'), order('b', '40')], D('100'));
    expect(r.selected.map((o) => o.id)).toEqual(['a', 'b']);
    expect(r.nominalActual.toFixed(4)).toBe('90.0000');
  });

  it('skips a single oversized order and ends empty', () => {
    const r = fillPool([order('a', '500')], D('100'));
    expect(r.selected).toEqual([]);
    expect(r.nominalActual.toFixed(4)).toBe('0.0000');
  });

  it('respects greedy descending sort by installments_sum', () => {
    const r = fillPool([order('s', '10'), order('m', '40'), order('l', '90')], D('100'));
    // sorted DESC: l(90), m(40), s(10). l fits → 90. m: 90+40=130 > 100 → skip. s: 90+10=100 ≤ 100 → fit.
    expect(r.selected.map((o) => o.id)).toEqual(['l', 's']);
    expect(r.nominalActual.toFixed(4)).toBe('100.0000');
  });

  it('tie-breaks equal installments_sum by external_order_id ASC', () => {
    const r = fillPool(
      [order('id-1', '50', 'ORD-Z'), order('id-2', '50', 'ORD-A')],
      D('200'),
    );
    expect(r.selected.map((o) => o.external_order_id)).toEqual(['ORD-A', 'ORD-Z']);
  });

  it('exact fill: last order completes target', () => {
    const r = fillPool([order('a', '60'), order('b', '40')], D('100'));
    expect(r.nominalActual.toFixed(4)).toBe('100.0000');
    expect(r.selected.map((o) => o.id)).toEqual(['a', 'b']);
  });

  it('skip-and-continue: bigger does not fit, smaller does', () => {
    const r = fillPool([order('big', '70'), order('small', '20'), order('tiny', '5')], D('30'));
    // sorted: big(70) skip, small(20) fit → 20, tiny(5) → 25. Both small + tiny.
    expect(r.selected.map((o) => o.id)).toEqual(['small', 'tiny']);
    expect(r.nominalActual.toFixed(4)).toBe('25.0000');
  });

  it('is deterministic: same input → same output across runs', () => {
    const inputs = [order('a', '50'), order('b', '40'), order('c', '30')];
    const r1 = fillPool(inputs, D('100'));
    const r2 = fillPool(inputs, D('100'));
    expect(r1.selected.map((o) => o.id)).toEqual(r2.selected.map((o) => o.id));
  });
});
```

- [ ] **Step 6: Run pool-builder, expect fail**

```bash
pnpm vitest run src/modules/issuance/certificates/pool-builder/pool-builder.test.ts
```

- [ ] **Step 7: Implement pool-builder**

```ts
// src/modules/issuance/certificates/pool-builder/pool-builder.ts
import { Prisma } from '@prisma/client';

export type EligibleOrder = {
  id: string;
  external_order_id: string;
  installments_sum: Prisma.Decimal;
  merchant_id: string;
  num_installments: number;
  max_due_date: Date;
};

export type FillResult = {
  selected: EligibleOrder[];
  nominalActual: Prisma.Decimal;
};

export function fillPool(eligible: EligibleOrder[], target: Prisma.Decimal): FillResult {
  const sorted = [...eligible].sort((a, b) => {
    const cmp = b.installments_sum.comparedTo(a.installments_sum);
    if (cmp !== 0) return cmp;
    return a.external_order_id.localeCompare(b.external_order_id);
  });
  const selected: EligibleOrder[] = [];
  let nominalActual = new Prisma.Decimal(0);
  for (const o of sorted) {
    const tentative = nominalActual.plus(o.installments_sum);
    if (tentative.lessThanOrEqualTo(target)) {
      selected.push(o);
      nominalActual = tentative;
    }
  }
  return { selected, nominalActual };
}
```

- [ ] **Step 8: Run pool-builder, expect pass (8)**

```bash
pnpm vitest run src/modules/issuance/certificates/pool-builder/pool-builder.test.ts
```

- [ ] **Step 9: TS check + commit**

```bash
pnpm exec tsc --noEmit
git add src/modules/issuance/certificates/pricing/ src/modules/issuance/certificates/pool-builder/
git commit -m "feat(issuance): pure pricing + pool-builder libs (TDD)"
```

---

## Task 2: Payload-hash + ISO-week (pure helpers, TDD)

**Files:**
- Create: `src/modules/issuance/certificates/payload-hash/payload-hash.ts`
- Create: `src/modules/issuance/certificates/payload-hash/payload-hash.test.ts`
- Create: `src/modules/issuance/certificates/helpers/iso-week.ts`
- Create: `src/modules/issuance/certificates/helpers/iso-week.test.ts`

- [ ] **Step 1: Write payload-hash tests**

```ts
// src/modules/issuance/certificates/payload-hash/payload-hash.test.ts
import { describe, it, expect } from 'vitest';
import { computePayloadHash, type PayloadHashInput } from './payload-hash';

function input(overrides: Partial<PayloadHashInput> = {}): PayloadHashInput {
  return {
    inputs: {
      capital: '100000.0000',
      rate: '0.130000',
      term_days: 42,
      issue_date: '2026-04-27',
      investor_id: '00000000-0000-4000-8000-000000000001',
    },
    outputs: {
      price: '0.984833',
      nominal_target: '101540.6028',
      nominal_actual: '101540.0034',
      investor_paid: '99999.4093',
      investor_returned: '0.5907',
      investor_yield: '1540.5941',
      shortfall_pct: '0.000006',
    },
    order_ids: ['11111111-1111-4111-8111-111111111111', '22222222-2222-4222-8222-222222222222'],
    ...overrides,
  };
}

describe('computePayloadHash', () => {
  it('returns 64-char lowercase hex', () => {
    const h = computePayloadHash(input());
    expect(h).toMatch(/^[a-f0-9]{64}$/);
  });

  it('is deterministic across runs', () => {
    const a = computePayloadHash(input());
    const b = computePayloadHash(input());
    expect(a).toBe(b);
  });

  it('canonicalizes order_ids by sorting before hashing', () => {
    const reversed: PayloadHashInput = {
      ...input(),
      order_ids: ['22222222-2222-4222-8222-222222222222', '11111111-1111-4111-8111-111111111111'],
    };
    expect(computePayloadHash(input())).toBe(computePayloadHash(reversed));
  });

  it('produces different hashes when inputs.capital changes', () => {
    const changed = input({ inputs: { ...input().inputs, capital: '200000.0000' } });
    expect(computePayloadHash(input())).not.toBe(computePayloadHash(changed));
  });
});
```

- [ ] **Step 2: Run, expect fail**

```bash
pnpm vitest run src/modules/issuance/certificates/payload-hash/payload-hash.test.ts
```

- [ ] **Step 3: Implement**

```ts
// src/modules/issuance/certificates/payload-hash/payload-hash.ts
import { createHash } from 'node:crypto';

export type PayloadHashInput = {
  inputs: {
    capital: string;
    rate: string;
    term_days: 14 | 42;
    issue_date: string;
    investor_id: string;
  };
  outputs: {
    price: string;
    nominal_target: string;
    nominal_actual: string;
    investor_paid: string;
    investor_returned: string;
    investor_yield: string;
    shortfall_pct: string;
  };
  order_ids: string[];
};

export function computePayloadHash(p: PayloadHashInput): string {
  const canonical = JSON.stringify({
    inputs: sortKeys(p.inputs),
    outputs: sortKeys(p.outputs),
    order_ids: [...p.order_ids].sort(),
  });
  return createHash('sha256').update(canonical, 'utf8').digest('hex');
}

function sortKeys<T extends Record<string, unknown>>(obj: T): Record<string, unknown> {
  const sorted: Record<string, unknown> = {};
  for (const k of Object.keys(obj).sort()) sorted[k] = obj[k];
  return sorted;
}
```

- [ ] **Step 4: Run, expect pass (4)**

```bash
pnpm vitest run src/modules/issuance/certificates/payload-hash/payload-hash.test.ts
```

- [ ] **Step 5: Write iso-week tests**

```ts
// src/modules/issuance/certificates/helpers/iso-week.test.ts
import { describe, it, expect } from 'vitest';
import { isoWeek } from './iso-week';

describe('isoWeek', () => {
  it('returns 2026-W18 for 2026-04-27 (Monday)', () => {
    expect(isoWeek(new Date(Date.UTC(2026, 3, 27)))).toBe('2026-W18');
  });

  it('returns 2026-W23 for 2026-06-08 (the maturity in the screenshot)', () => {
    expect(isoWeek(new Date(Date.UTC(2026, 5, 8)))).toBe('2026-W24');
  });

  it('handles year-boundary: 2024-12-30 (Mon) is week 2025-W01', () => {
    expect(isoWeek(new Date(Date.UTC(2024, 11, 30)))).toBe('2025-W01');
  });

  it('handles year-boundary: 2027-01-03 (Sun) belongs to 2026-W53', () => {
    expect(isoWeek(new Date(Date.UTC(2027, 0, 3)))).toBe('2026-W53');
  });
});
```

Note: 2026 has 53 ISO weeks because Jan 1 2026 is a Thursday (week 1) and Dec 31 2026 is a Thursday (week 53).

- [ ] **Step 6: Run, expect fail**

```bash
pnpm vitest run src/modules/issuance/certificates/helpers/iso-week.test.ts
```

- [ ] **Step 7: Implement iso-week**

```ts
// src/modules/issuance/certificates/helpers/iso-week.ts

/**
 * Returns the ISO 8601 week of `d` in `YYYY-Www` format.
 * Weeks start Monday; week 1 contains the year's first Thursday.
 * The returned year may differ from `d.getUTCFullYear()` near year boundaries.
 */
export function isoWeek(d: Date): string {
  // Move to Thursday of the same ISO week, which determines the ISO week year.
  const target = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()));
  const dayNum = (target.getUTCDay() + 6) % 7; // Mon=0..Sun=6
  target.setUTCDate(target.getUTCDate() - dayNum + 3);

  const isoYear = target.getUTCFullYear();
  // First Thursday of ISO year: Jan 4 + offset to Thursday.
  const firstThursday = new Date(Date.UTC(isoYear, 0, 4));
  const firstThursdayDayNum = (firstThursday.getUTCDay() + 6) % 7;
  firstThursday.setUTCDate(firstThursday.getUTCDate() - firstThursdayDayNum + 3);

  const weekNum = 1 + Math.round((target.getTime() - firstThursday.getTime()) / (7 * 86400 * 1000));
  return `${isoYear}-W${weekNum.toString().padStart(2, '0')}`;
}
```

- [ ] **Step 8: Run, expect pass (4)**

```bash
pnpm vitest run src/modules/issuance/certificates/helpers/iso-week.test.ts
```

If the second test (2026-06-08 → W24) fails because June 8 2026 is a Monday and falls in W24, adjust your expectation. Verify against an external ISO week calendar if needed; the helper itself is canonical ISO 8601 so trust it and update the test value to match.

- [ ] **Step 9: TS check + commit**

```bash
pnpm exec tsc --noEmit
git add src/modules/issuance/certificates/payload-hash/ src/modules/issuance/certificates/helpers/
git commit -m "feat(issuance): payload-hash + iso-week helpers (TDD)"
```

---

## Task 3: Investors module (DTO + mappers + service + controller, TDD)

**Files:**
- Create: `src/modules/issuance/investors/investors.dto.ts`
- Create: `src/modules/issuance/investors/responses/investor-summary.mapper.ts`
- Create: `src/modules/issuance/investors/responses/investor-detail.mapper.ts`
- Create: `src/modules/issuance/investors/investors.service.ts`
- Create: `src/modules/issuance/investors/investors.service.test.ts`
- Create: `src/modules/issuance/investors/investors.controller.ts`
- Create: `src/modules/issuance/investors/investors.controller.test.ts`

- [ ] **Step 1: Create DTO**

```ts
// src/modules/issuance/investors/investors.dto.ts
import { z } from 'zod';
import { PaginationSchema } from '../../../common/dto/pagination.schema';

export const InvestorsListQuerySchema = PaginationSchema.extend({
  q: z.string().min(1).max(100).optional(),
  kind: z.enum(['juridica', 'natural', 'internal']).optional(),
  status: z.enum(['active', 'inactive']).optional(),
  sort: z.enum(['name_asc', 'name_desc', 'created_desc']).default('name_asc'),
});

export const InvestorCreateSchema = z.object({
  legal_name: z.string().min(1).max(255),
  rif: z.string().min(1).max(50),
  kind: z.enum(['juridica', 'natural']),
  email: z.string().email().max(255).nullable().optional(),
  phone: z.string().min(1).max(50).nullable().optional(),
  notes: z.string().max(1000).nullable().optional(),
});

export type InvestorsListQuery = z.infer<typeof InvestorsListQuerySchema>;
export type InvestorCreate = z.infer<typeof InvestorCreateSchema>;
```

- [ ] **Step 2: Create mappers**

```ts
// src/modules/issuance/investors/responses/investor-summary.mapper.ts
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

```ts
// src/modules/issuance/investors/responses/investor-detail.mapper.ts
export { toInvestorSummary as toInvestorDetail } from './investor-summary.mapper';
```

(Detail and summary share the same shape in Slice 4a. The re-export keeps the import alias clean for future divergence.)

- [ ] **Step 3: Write service test**

```ts
// src/modules/issuance/investors/investors.service.test.ts
import { describe, it, expect, vi } from 'vitest';
import { ConflictException, NotFoundException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { InvestorsService } from './investors.service';
import { PrismaService } from '../../../prisma/prisma.service';
import { AuditService } from '../../audit/audit.service';

function makePrisma() {
  return {
    investor: {
      findMany: vi.fn().mockResolvedValue([]),
      count: vi.fn().mockResolvedValue(0),
      findUnique: vi.fn(),
      create: vi.fn(),
    },
    certificate: {
      groupBy: vi.fn().mockResolvedValue([]),
      aggregate: vi.fn().mockResolvedValue({ _sum: { investor_capital: null } }),
    },
  } as unknown as PrismaService;
}

function makeAudit() {
  return { recordChange: vi.fn().mockResolvedValue(undefined) } as unknown as AuditService;
}

describe('InvestorsService.list', () => {
  it('returns paginated mapped investors with active_cert_count and total_invested', async () => {
    const prisma = makePrisma();
    (prisma.investor.findMany as ReturnType<typeof vi.fn>).mockResolvedValueOnce([
      {
        id: 'i-1', legal_name: 'Inversora Alpha', rif: 'J-12345678-9',
        kind: 'juridica', status: 'active', email: null, phone: null, notes: null,
        created_at: new Date('2026-04-15'),
      },
    ]);
    (prisma.investor.count as ReturnType<typeof vi.fn>).mockResolvedValueOnce(1);
    (prisma.certificate.groupBy as ReturnType<typeof vi.fn>).mockResolvedValueOnce([
      { investor_id: 'i-1', _count: { _all: 2 } },
    ]);
    (prisma.certificate.aggregate as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
      _sum: { investor_capital: new Prisma.Decimal('285000.00') },
    });

    const svc = new InvestorsService(prisma, makeAudit());
    const r = await svc.list({ limit: 50, offset: 0, sort: 'name_asc' });
    expect(r.total).toBe(1);
    expect(r.data[0]!.active_cert_count).toBe(2);
    expect(r.data[0]!.total_invested).toBe('285000.0000');
  });

  it('passes q-search across legal_name and rif (case-insensitive)', async () => {
    const prisma = makePrisma();
    const svc = new InvestorsService(prisma, makeAudit());
    await svc.list({ limit: 50, offset: 0, sort: 'name_asc', q: 'Alpha' });
    const call = (prisma.investor.findMany as ReturnType<typeof vi.fn>).mock.calls[0]![0];
    expect(call.where.OR).toEqual([
      { legal_name: { contains: 'Alpha', mode: 'insensitive' } },
      { rif: { contains: 'Alpha', mode: 'insensitive' } },
    ]);
  });
});

describe('InvestorsService.detail', () => {
  it('returns mapped investor', async () => {
    const prisma = makePrisma();
    (prisma.investor.findUnique as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
      id: 'i-1', legal_name: 'Inversora Alpha', rif: 'J-12345678-9',
      kind: 'juridica', status: 'active', email: null, phone: null, notes: null,
      created_at: new Date('2026-04-15'),
    });
    (prisma.certificate.aggregate as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
      _sum: { investor_capital: new Prisma.Decimal('100000.00') },
    });

    const svc = new InvestorsService(prisma, makeAudit());
    const r = await svc.detail('i-1');
    expect(r.legal_name).toBe('Inversora Alpha');
    expect(r.total_invested).toBe('100000.0000');
  });

  it('throws NotFoundException when investor missing', async () => {
    const prisma = makePrisma();
    (prisma.investor.findUnique as ReturnType<typeof vi.fn>).mockResolvedValueOnce(null);
    const svc = new InvestorsService(prisma, makeAudit());
    await expect(svc.detail('missing')).rejects.toBeInstanceOf(NotFoundException);
  });
});

describe('InvestorsService.create', () => {
  it('normalizes RIF, persists, records audit', async () => {
    const prisma = makePrisma();
    (prisma.investor.findUnique as ReturnType<typeof vi.fn>).mockResolvedValueOnce(null);
    (prisma.investor.create as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
      id: 'i-2', legal_name: 'Nueva Inversora', rif: 'J-30123456-7',
      kind: 'juridica', status: 'active', email: null, phone: null, notes: null,
      created_at: new Date(),
    });
    const audit = makeAudit();
    const svc = new InvestorsService(prisma, audit);

    const r = await svc.create({
      input: { legal_name: 'Nueva Inversora', rif: 'j-30123456-7', kind: 'juridica' },
      actorId: 'a-1',
    });
    expect(r.rif).toBe('J-30123456-7');
    const createCall = (prisma.investor.create as ReturnType<typeof vi.fn>).mock.calls[0]![0];
    expect(createCall.data.rif).toBe('J-30123456-7');
    expect(audit.recordChange).toHaveBeenCalledOnce();
  });

  it('throws ConflictException when RIF already exists', async () => {
    const prisma = makePrisma();
    (prisma.investor.findUnique as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
      id: 'existing-1',
    });
    const svc = new InvestorsService(prisma, makeAudit());
    await expect(
      svc.create({
        input: { legal_name: 'X', rif: 'J-12345678-9', kind: 'juridica' },
        actorId: 'a-1',
      }),
    ).rejects.toBeInstanceOf(ConflictException);
  });
});
```

- [ ] **Step 4: Run, expect fail**

```bash
pnpm vitest run src/modules/issuance/investors/investors.service.test.ts
```

- [ ] **Step 5: Implement service**

```ts
// src/modules/issuance/investors/investors.service.ts
import { BadRequestException, ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../../../prisma/prisma.service';
import { AuditService } from '../../audit/audit.service';
import { normalizeRif } from '../../batches/rif-normalizer';
import { toInvestorSummary, type InvestorSummaryRow } from './responses/investor-summary.mapper';
import { toInvestorDetail } from './responses/investor-detail.mapper';
import type { InvestorsListQuery, InvestorCreate } from './investors.dto';

const SORT_MAP = {
  name_asc: [{ legal_name: 'asc' as const }],
  name_desc: [{ legal_name: 'desc' as const }],
  created_desc: [{ created_at: 'desc' as const }],
};

@Injectable()
export class InvestorsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
  ) {}

  async list(query: InvestorsListQuery) {
    const where: Prisma.InvestorWhereInput = {};
    if (query.q) {
      where.OR = [
        { legal_name: { contains: query.q, mode: 'insensitive' } },
        { rif: { contains: query.q, mode: 'insensitive' } },
      ];
    }
    if (query.kind) where.kind = query.kind;
    if (query.status) where.status = query.status;

    const [rows, total] = await Promise.all([
      this.prisma.investor.findMany({
        where,
        orderBy: SORT_MAP[query.sort],
        take: query.limit,
        skip: query.offset,
      }),
      this.prisma.investor.count({ where }),
    ]);

    if (rows.length === 0) {
      return { data: [], total, limit: query.limit, offset: query.offset };
    }

    const ids = rows.map((r) => r.id);
    const counts = await this.prisma.certificate.groupBy({
      by: ['investor_id'],
      where: { investor_id: { in: ids }, status: { in: ['issued', 'matured'] }, deleted_at: null },
      _count: { _all: true },
    });
    const countMap = new Map(counts.map((c) => [c.investor_id, c._count._all]));

    const enriched = await Promise.all(
      rows.map(async (r) => {
        const agg = await this.prisma.certificate.aggregate({
          where: { investor_id: r.id, status: { in: ['issued', 'matured'] }, deleted_at: null },
          _sum: { investor_capital: true },
        });
        return toInvestorSummary({
          ...(r as InvestorSummaryRow),
          active_cert_count: countMap.get(r.id) ?? 0,
          total_invested: agg._sum.investor_capital ?? new Prisma.Decimal(0),
        });
      }),
    );

    return { data: enriched, total, limit: query.limit, offset: query.offset };
  }

  async detail(id: string) {
    const i = await this.prisma.investor.findUnique({ where: { id } });
    if (!i) throw new NotFoundException('Inversor no encontrado');

    const [count, agg] = await Promise.all([
      this.prisma.certificate.count({
        where: { investor_id: id, status: { in: ['issued', 'matured'] }, deleted_at: null },
      }),
      this.prisma.certificate.aggregate({
        where: { investor_id: id, status: { in: ['issued', 'matured'] }, deleted_at: null },
        _sum: { investor_capital: true },
      }),
    ]);

    return toInvestorDetail({
      ...(i as InvestorSummaryRow),
      active_cert_count: count,
      total_invested: agg._sum.investor_capital ?? new Prisma.Decimal(0),
    });
  }

  async create(opts: { input: InvestorCreate; actorId: string }) {
    const canonicalRif = normalizeRif(opts.input.rif);
    if (!canonicalRif) {
      throw new BadRequestException('RIF inválido');
    }

    const existing = await this.prisma.investor.findUnique({ where: { rif: canonicalRif } });
    if (existing) {
      throw new ConflictException({
        message: 'Inversor con ese RIF ya existe',
        existing_id: existing.id,
      });
    }

    const created = await this.prisma.investor.create({
      data: {
        legal_name: opts.input.legal_name,
        rif: canonicalRif,
        kind: opts.input.kind,
        status: 'active',
        email: opts.input.email ?? null,
        phone: opts.input.phone ?? null,
        notes: opts.input.notes ?? null,
        created_by_id: opts.actorId,
      },
    });

    await this.audit.recordChange({
      entityType: 'investor',
      entityId: created.id,
      action: 'create',
      actorId: opts.actorId,
      payload: {
        legal_name: created.legal_name,
        rif: created.rif,
        kind: created.kind,
        email: created.email,
        phone: created.phone,
      },
    });

    return toInvestorSummary({
      ...(created as InvestorSummaryRow),
      active_cert_count: 0,
      total_invested: new Prisma.Decimal(0),
    });
  }
}
```

- [ ] **Step 6: Run service tests, expect pass (6)**

```bash
pnpm vitest run src/modules/issuance/investors/investors.service.test.ts
```

- [ ] **Step 7: Write controller test**

```ts
// src/modules/issuance/investors/investors.controller.test.ts
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { Test } from '@nestjs/testing';
import { BadRequestException, ConflictException, INestApplication, NotFoundException } from '@nestjs/common';
import { APP_GUARD } from '@nestjs/core';
import { ConfigService } from '@nestjs/config';
import request from 'supertest';
import { InvestorsController } from './investors.controller';
import { InvestorsService } from './investors.service';
import { JwtService } from '../../auth/jwt.service';
import { UserLookupService } from '../../auth/user-lookup.service';
import { JwtAuthGuard } from '../../auth/jwt-auth.guard';
import { PermissionsGuard } from '../../auth/permissions.guard';
import { PrismaService } from '../../../prisma/prisma.service';
import { mintTestJwt, TEST_SECRET } from '../../../../test/helpers/jwt.helper';
import { mockAuthUser } from '../../../../test/helpers/auth-user.helper';

describe('InvestorsController', () => {
  let app: INestApplication;
  let svc: { list: ReturnType<typeof vi.fn>; detail: ReturnType<typeof vi.fn>; create: ReturnType<typeof vi.fn> };
  let prismaPerms: ReturnType<typeof vi.fn>;

  beforeEach(async () => {
    svc = { list: vi.fn(), detail: vi.fn(), create: vi.fn() };
    prismaPerms = vi.fn().mockResolvedValue([
      { permission: { key: 'investor.read' } },
      { permission: { key: 'investor.create' } },
    ]);
    const config = { get: (k: string) => (k === 'SUPABASE_JWT_SECRET' ? TEST_SECRET : undefined) } as unknown as ConfigService;

    const moduleRef = await Test.createTestingModule({
      controllers: [InvestorsController],
      providers: [
        { provide: InvestorsService, useValue: svc },
        { provide: ConfigService, useValue: config },
        JwtService,
        { provide: UserLookupService, useValue: { findByAuthId: vi.fn().mockResolvedValue({ kind: 'found', user: mockAuthUser({ role: 'admin' }) }) } },
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

  it('GET /api/investors → 401 without token', async () => {
    await request(app.getHttpServer()).get('/api/investors').expect(401);
  });

  it('GET /api/investors → 200 with list', async () => {
    svc.list.mockResolvedValueOnce({ data: [], total: 0, limit: 50, offset: 0 });
    const t = await mintTestJwt({ sub: 'auth-uuid' });
    await request(app.getHttpServer()).get('/api/investors').set('Authorization', `Bearer ${t}`).expect(200);
  });

  it('GET /api/investors/:id → 404 when service throws', async () => {
    svc.detail.mockRejectedValueOnce(new NotFoundException('Inversor no encontrado'));
    const t = await mintTestJwt({ sub: 'auth-uuid' });
    await request(app.getHttpServer())
      .get('/api/investors/00000000-0000-4000-8000-000000000099')
      .set('Authorization', `Bearer ${t}`)
      .expect(404);
  });

  it('POST /api/investors → 401 without token', async () => {
    await request(app.getHttpServer()).post('/api/investors').send({}).expect(401);
  });

  it('POST /api/investors → 403 when role lacks investor.create', async () => {
    prismaPerms.mockResolvedValueOnce([{ permission: { key: 'investor.read' } }]);
    const t = await mintTestJwt({ sub: 'auth-uuid' });
    await request(app.getHttpServer())
      .post('/api/investors')
      .set('Authorization', `Bearer ${t}`)
      .send({ legal_name: 'X', rif: 'J-12345678-9', kind: 'juridica' })
      .expect(403);
  });

  it('POST /api/investors → 400 when RIF malformed (service throws BadRequest)', async () => {
    svc.create.mockRejectedValueOnce(new BadRequestException('RIF inválido'));
    const t = await mintTestJwt({ sub: 'auth-uuid' });
    await request(app.getHttpServer())
      .post('/api/investors')
      .set('Authorization', `Bearer ${t}`)
      .send({ legal_name: 'X', rif: 'foo', kind: 'juridica' })
      .expect(400);
  });

  it('POST /api/investors → 201 happy path', async () => {
    svc.create.mockResolvedValueOnce({
      id: 'i-1', legal_name: 'Nueva', rif: 'J-30123456-7', kind: 'juridica', status: 'active',
      email: null, phone: null, notes: null,
      created_at: new Date().toISOString(), active_cert_count: 0, total_invested: '0.0000',
    });
    const t = await mintTestJwt({ sub: 'auth-uuid' });
    const res = await request(app.getHttpServer())
      .post('/api/investors')
      .set('Authorization', `Bearer ${t}`)
      .send({ legal_name: 'Nueva', rif: 'J-30123456-7', kind: 'juridica' })
      .expect(201);
    expect(res.body.rif).toBe('J-30123456-7');
  });
});
```

- [ ] **Step 8: Implement controller**

```ts
// src/modules/issuance/investors/investors.controller.ts
import { Body, Controller, Get, HttpCode, HttpStatus, Param, ParseUUIDPipe, Post, Query, UsePipes } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { CurrentUser } from '../../auth/decorators/current-user.decorator';
import { RequirePermission } from '../../auth/decorators/require-permission.decorator';
import type { AuthUser } from '../../auth/types';
import { ZodValidationPipe } from '../../../common/pipes/zod-validation.pipe';
import { InvestorsService } from './investors.service';
import {
  InvestorsListQuerySchema,
  InvestorCreateSchema,
  type InvestorsListQuery,
  type InvestorCreate,
} from './investors.dto';

@ApiTags('investors')
@ApiBearerAuth()
@Controller('investors')
export class InvestorsController {
  constructor(private readonly investors: InvestorsService) {}

  @Get()
  @RequirePermission('investor.read')
  @UsePipes(new ZodValidationPipe(InvestorsListQuerySchema))
  list(@Query() query: InvestorsListQuery) {
    return this.investors.list(query);
  }

  @Get(':id')
  @RequirePermission('investor.read')
  detail(@Param('id', ParseUUIDPipe) id: string) {
    return this.investors.detail(id);
  }

  @Post()
  @HttpCode(HttpStatus.CREATED)
  @RequirePermission('investor.create')
  create(
    @Body(new ZodValidationPipe(InvestorCreateSchema)) body: InvestorCreate,
    @CurrentUser() user: AuthUser,
  ) {
    return this.investors.create({ input: body, actorId: user.id });
  }
}
```

- [ ] **Step 9: Run controller tests, expect pass (7)**

```bash
pnpm vitest run src/modules/issuance/investors/investors.controller.test.ts
```

- [ ] **Step 10: TS check + commit**

```bash
pnpm exec tsc --noEmit
git add src/modules/issuance/investors/
git commit -m "feat(issuance): InvestorsModule (DTO + mappers + service + controller, TDD)"
```

---

## Task 4: Certificates DTOs + 3 mappers

**Files:**
- Create: `src/modules/issuance/certificates/certificates.dto.ts`
- Create: `src/modules/issuance/certificates/responses/certificate-summary.mapper.ts`
- Create: `src/modules/issuance/certificates/responses/certificate-detail.mapper.ts`
- Create: `src/modules/issuance/certificates/responses/simulation-result.mapper.ts`

- [ ] **Step 1: Create DTO**

```ts
// src/modules/issuance/certificates/certificates.dto.ts
import { z } from 'zod';
import { PaginationSchema } from '../../../common/dto/pagination.schema';

function startOfTodayUTC(): Date {
  const now = new Date();
  return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));
}

const SimulateBase = z.object({
  investor_id: z.string().uuid(),
  capital: z.coerce.number().positive(),
  rate: z.coerce.number().min(0).max(0.999999),
  term_days: z.union([z.literal(14), z.literal(42)]),
  issue_date: z.coerce.date(),
});

export const CertificateSimulateSchema = SimulateBase.refine(
  (d) => d.issue_date.getTime() >= startOfTodayUTC().getTime(),
  { message: 'La fecha de emisión no puede ser anterior a hoy' },
);

export const CertificateIssueSchema = SimulateBase.extend({
  order_ids: z.array(z.string().uuid()).min(1).max(2000),
  expected_payload_hash: z.string().regex(/^[a-f0-9]{64}$/),
}).refine(
  (d) => d.issue_date.getTime() >= startOfTodayUTC().getTime(),
  { message: 'La fecha de emisión no puede ser anterior a hoy' },
);

export const CertificatesListQuerySchema = PaginationSchema.extend({
  status: z.enum(['draft', 'issued', 'matured', 'cancelled']).optional(),
  certificate_type: z.enum(['standard', 'sweep']).optional(),
  investor_id: z.string().uuid().optional(),
  issue_date_from: z.coerce.date().optional(),
  issue_date_to: z.coerce.date().optional(),
  q: z.string().min(1).max(100).optional(),
  sort: z.enum(['issue_date_desc', 'issue_date_asc', 'code_asc']).default('issue_date_desc'),
});

export type CertificateSimulate = z.infer<typeof CertificateSimulateSchema>;
export type CertificateIssue = z.infer<typeof CertificateIssueSchema>;
export type CertificatesListQuery = z.infer<typeof CertificatesListQuerySchema>;
```

- [ ] **Step 2: Create certificate-summary.mapper.ts**

```ts
// src/modules/issuance/certificates/responses/certificate-summary.mapper.ts
import type { Decimal } from '@prisma/client/runtime/library';

export type CertificateSummaryRow = {
  id: string;
  certificate_code: string;
  certificate_type: string;
  status: string;
  investor: { id: string; legal_name: string; rif: string };
  investor_capital: Decimal;
  annual_rate: Decimal;
  term_days: number;
  price: Decimal;
  nominal_target: Decimal;
  nominal_actual: Decimal;
  investor_paid: Decimal;
  investor_yield: Decimal;
  shortfall_pct: Decimal;
  issue_date: Date;
  maturity_date: Date;
  cycle_week: string;
  issued_by: { id: string; email: string; full_name: string };
  created_at: Date;
};

export function toCertificateSummary(c: CertificateSummaryRow) {
  return {
    id: c.id,
    certificate_code: c.certificate_code,
    certificate_type: c.certificate_type,
    status: c.status,
    investor: { id: c.investor.id, legal_name: c.investor.legal_name, rif: c.investor.rif },
    investor_capital: c.investor_capital.toFixed(4),
    annual_rate: c.annual_rate.toFixed(6),
    term_days: c.term_days,
    price: c.price.toFixed(6),
    nominal_target: c.nominal_target.toFixed(4),
    nominal_actual: c.nominal_actual.toFixed(4),
    investor_paid: c.investor_paid.toFixed(4),
    investor_yield: c.investor_yield.toFixed(4),
    shortfall_pct: c.shortfall_pct.toFixed(6),
    issue_date: c.issue_date.toISOString().slice(0, 10),
    maturity_date: c.maturity_date.toISOString().slice(0, 10),
    cycle_week: c.cycle_week,
    issued_by: { id: c.issued_by.id, email: c.issued_by.email, full_name: c.issued_by.full_name },
    created_at: c.created_at.toISOString(),
  };
}
```

- [ ] **Step 3: Create certificate-detail.mapper.ts**

```ts
// src/modules/issuance/certificates/responses/certificate-detail.mapper.ts
import type { Decimal } from '@prisma/client/runtime/library';
import { toCertificateSummary, type CertificateSummaryRow } from './certificate-summary.mapper';

export type CertificateDetailRow = CertificateSummaryRow & {
  investor_returned: Decimal;
  payload_hash: string;
  certificate_orders: Array<{
    order: {
      id: string;
      external_order_id: string;
      merchant: { id: string; current_name: string; rif: string };
      purchase_date: Date;
      max_due_date: Date;
      installments: Array<{
        installment_number: number;
        amount: Decimal;
        due_date: Date;
        status: string;
      }>;
    };
    installments_sum_snapshot: Decimal;
    assigned_at: Date;
  }>;
  certificate_events: Array<{
    id: string;
    event_type: string;
    occurred_at: Date;
    payload: unknown;
    actor_id: string | null;
  }>;
};

export function toCertificateDetail(c: CertificateDetailRow) {
  return {
    ...toCertificateSummary(c),
    investor_returned: c.investor_returned.toFixed(4),
    payload_hash: c.payload_hash,
    orders: c.certificate_orders.map((co) => ({
      id: co.order.id,
      external_order_id: co.order.external_order_id,
      merchant: {
        id: co.order.merchant.id,
        current_name: co.order.merchant.current_name,
        rif: co.order.merchant.rif,
      },
      purchase_date: co.order.purchase_date.toISOString().slice(0, 10),
      max_due_date: co.order.max_due_date.toISOString().slice(0, 10),
      installments_sum_snapshot: co.installments_sum_snapshot.toFixed(4),
      assigned_at: co.assigned_at.toISOString(),
      installments: co.order.installments.map((i) => ({
        installment_number: i.installment_number,
        amount: i.amount.toFixed(4),
        due_date: i.due_date.toISOString().slice(0, 10),
        status: i.status,
      })),
    })),
    events: c.certificate_events.map((e) => ({
      id: e.id,
      event_type: e.event_type,
      occurred_at: e.occurred_at.toISOString(),
      payload: e.payload,
      actor_id: e.actor_id,
    })),
  };
}
```

- [ ] **Step 4: Create simulation-result.mapper.ts**

```ts
// src/modules/issuance/certificates/responses/simulation-result.mapper.ts
import type { Decimal } from '@prisma/client/runtime/library';

export type SimulationResultInput = {
  investor: { id: string; legal_name: string; rif: string };
  capital: Decimal;
  rate: Decimal;
  term_days: 14 | 42;
  issue_date: Date;
  maturity_date: Date;
  price: Decimal;
  nominal_target: Decimal;
  nominal_actual: Decimal;
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
  total_eligible_merchants: number;
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
};

export function toSimulationResult(s: SimulationResultInput) {
  const installment_count = s.selected_orders.reduce((acc, o) => acc + o.num_installments, 0);
  const merchant_count = new Set(s.selected_orders.map((o) => o.merchant_id)).size;

  return {
    rules_check: { maturity_boundary: true, order_indivisibility: true, round_down: true },
    inputs: {
      investor_id: s.investor.id,
      investor: { id: s.investor.id, legal_name: s.investor.legal_name, rif: s.investor.rif },
      capital: s.capital.toFixed(4),
      rate: s.rate.toFixed(6),
      term_days: s.term_days,
      issue_date: s.issue_date.toISOString().slice(0, 10),
      maturity_date: s.maturity_date.toISOString().slice(0, 10),
    },
    pricing: {
      price: s.price.toFixed(6),
      nominal_target: s.nominal_target.toFixed(4),
    },
    pool: {
      order_ids: s.selected_orders.map((o) => o.id),
      order_count: s.selected_orders.length,
      merchant_count,
      installment_count,
      installment_plazo_days: s.installment_plazo_days,
    },
    payouts: {
      nominal_actual: s.nominal_actual.toFixed(4),
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
}
```

- [ ] **Step 5: TS check + commit**

```bash
pnpm exec tsc --noEmit
git add src/modules/issuance/certificates/certificates.dto.ts src/modules/issuance/certificates/responses/
git commit -m "feat(issuance): certificates DTOs + summary/detail/simulation mappers"
```

---

## Task 5: CertificatesService.simulate (TDD)

**Files:**
- Create: `src/modules/issuance/certificates/certificates.service.ts`
- Create: `src/modules/issuance/certificates/certificates.service.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
// src/modules/issuance/certificates/certificates.service.test.ts
import { describe, it, expect, vi } from 'vitest';
import { BadRequestException, NotFoundException, UnprocessableEntityException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { CertificatesService } from './certificates.service';
import { PrismaService } from '../../../prisma/prisma.service';
import { AuditService } from '../../audit/audit.service';

const D = (s: string) => new Prisma.Decimal(s);

function fakeInvestor(overrides: Record<string, unknown> = {}) {
  return {
    id: 'inv-1', legal_name: 'Inversora Alpha', rif: 'J-12345678-9',
    kind: 'juridica', status: 'active',
    ...overrides,
  };
}

function fakeOrder(id: string, sum: string, dueDays: number) {
  const dueDate = new Date('2026-05-15');
  dueDate.setUTCDate(dueDate.getUTCDate() + dueDays);
  return {
    id,
    external_order_id: `ORD-${id}`,
    installments_sum: D(sum),
    merchant_id: `merch-${id}`,
    num_installments: 3,
    max_due_date: dueDate,
    purchase_date: new Date('2026-04-01'),
  };
}

function makePrismaForSimulate() {
  return {
    investor: { findUnique: vi.fn() },
    order: { findMany: vi.fn().mockResolvedValue([]) },
    merchant: { findMany: vi.fn().mockResolvedValue([]) },
    installment: { findMany: vi.fn().mockResolvedValue([]) },
  } as unknown as PrismaService;
}

function makeAudit() {
  return { recordChange: vi.fn().mockResolvedValue(undefined) } as unknown as AuditService;
}

describe('CertificatesService.simulate', () => {
  it('happy path: returns full simulation with rules_check all true', async () => {
    const prisma = makePrismaForSimulate();
    (prisma.investor.findUnique as ReturnType<typeof vi.fn>).mockResolvedValueOnce(fakeInvestor());
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

    const svc = new CertificatesService(prisma, makeAudit());
    const r = await svc.simulate({
      investor_id: 'inv-1', capital: 100, rate: 0.13, term_days: 42,
      issue_date: new Date('2026-05-15'),
    });

    expect(r.rules_check).toEqual({ maturity_boundary: true, order_indivisibility: true, round_down: true });
    expect(r.pool.order_count).toBe(2);
    expect(r.payouts.nominal_actual).toBe('100.0000');
    expect(r.payload_hash).toMatch(/^[a-f0-9]{64}$/);
  });

  it('throws 404 when investor not found', async () => {
    const prisma = makePrismaForSimulate();
    (prisma.investor.findUnique as ReturnType<typeof vi.fn>).mockResolvedValueOnce(null);
    const svc = new CertificatesService(prisma, makeAudit());
    await expect(svc.simulate({
      investor_id: 'missing', capital: 100, rate: 0.13, term_days: 42,
      issue_date: new Date('2026-05-15'),
    })).rejects.toBeInstanceOf(NotFoundException);
  });

  it('throws 400 when investor.kind=internal', async () => {
    const prisma = makePrismaForSimulate();
    (prisma.investor.findUnique as ReturnType<typeof vi.fn>).mockResolvedValueOnce(fakeInvestor({ kind: 'internal' }));
    const svc = new CertificatesService(prisma, makeAudit());
    await expect(svc.simulate({
      investor_id: 'inv-1', capital: 100, rate: 0.13, term_days: 42,
      issue_date: new Date('2026-05-15'),
    })).rejects.toBeInstanceOf(BadRequestException);
  });

  it('throws 400 when investor.status=inactive', async () => {
    const prisma = makePrismaForSimulate();
    (prisma.investor.findUnique as ReturnType<typeof vi.fn>).mockResolvedValueOnce(fakeInvestor({ status: 'inactive' }));
    const svc = new CertificatesService(prisma, makeAudit());
    await expect(svc.simulate({
      investor_id: 'inv-1', capital: 100, rate: 0.13, term_days: 42,
      issue_date: new Date('2026-05-15'),
    })).rejects.toBeInstanceOf(BadRequestException);
  });

  it('throws 422 when no eligible orders fit', async () => {
    const prisma = makePrismaForSimulate();
    (prisma.investor.findUnique as ReturnType<typeof vi.fn>).mockResolvedValueOnce(fakeInvestor());
    (prisma.order.findMany as ReturnType<typeof vi.fn>).mockResolvedValueOnce([]);
    const svc = new CertificatesService(prisma, makeAudit());
    await expect(svc.simulate({
      investor_id: 'inv-1', capital: 100, rate: 0.13, term_days: 42,
      issue_date: new Date('2026-05-15'),
    })).rejects.toBeInstanceOf(UnprocessableEntityException);
  });

  it('payload_hash is deterministic across two simulate calls with same inputs', async () => {
    const prisma = makePrismaForSimulate();
    const setup = () => {
      (prisma.investor.findUnique as ReturnType<typeof vi.fn>).mockResolvedValueOnce(fakeInvestor());
      (prisma.order.findMany as ReturnType<typeof vi.fn>).mockResolvedValueOnce([fakeOrder('a', '60', 7)]);
      (prisma.merchant.findMany as ReturnType<typeof vi.fn>).mockResolvedValueOnce([
        { id: 'merch-a', current_name: 'A', rif: 'J-1' },
      ]);
      (prisma.installment.findMany as ReturnType<typeof vi.fn>).mockResolvedValueOnce([
        { order_id: 'a', amount: D('60'), due_date: new Date('2026-05-22') },
      ]);
    };
    const svc = new CertificatesService(prisma, makeAudit());
    setup();
    const r1 = await svc.simulate({
      investor_id: 'inv-1', capital: 100, rate: 0.13, term_days: 42,
      issue_date: new Date('2026-05-15'),
    });
    setup();
    const r2 = await svc.simulate({
      investor_id: 'inv-1', capital: 100, rate: 0.13, term_days: 42,
      issue_date: new Date('2026-05-15'),
    });
    expect(r1.payload_hash).toBe(r2.payload_hash);
  });

  it('aggregates concentration_top and total_distinct_merchants', async () => {
    const prisma = makePrismaForSimulate();
    (prisma.investor.findUnique as ReturnType<typeof vi.fn>).mockResolvedValueOnce(fakeInvestor());
    (prisma.order.findMany as ReturnType<typeof vi.fn>).mockResolvedValueOnce([
      { ...fakeOrder('a', '70', 7), merchant_id: 'big' },
      { ...fakeOrder('b', '30', 14), merchant_id: 'small' },
    ]);
    (prisma.merchant.findMany as ReturnType<typeof vi.fn>).mockResolvedValueOnce([
      { id: 'big', current_name: 'Big Merchant', rif: 'J-BIG' },
      { id: 'small', current_name: 'Small Merchant', rif: 'J-SML' },
    ]);
    (prisma.installment.findMany as ReturnType<typeof vi.fn>).mockResolvedValueOnce([]);
    const svc = new CertificatesService(prisma, makeAudit());
    const r = await svc.simulate({
      investor_id: 'inv-1', capital: 100, rate: 0.13, term_days: 42,
      issue_date: new Date('2026-05-15'),
    });
    expect(r.concentration.total_distinct_merchants).toBe(2);
    expect(r.concentration.top[0]!.merchant_id).toBe('big');
    expect(r.concentration.top[0]!.amount).toBe('70.0000');
  });
});
```

- [ ] **Step 2: Run, expect fail**

```bash
pnpm vitest run src/modules/issuance/certificates/certificates.service.test.ts
```

- [ ] **Step 3: Implement service skeleton + simulate**

```ts
// src/modules/issuance/certificates/certificates.service.ts
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
import { computePricing, computePayouts } from './pricing/pricing';
import { fillPool, type EligibleOrder } from './pool-builder/pool-builder';
import { computePayloadHash } from './payload-hash/payload-hash';
import { isoWeek } from './helpers/iso-week';
import { toSimulationResult } from './responses/simulation-result.mapper';
import { toCertificateSummary, type CertificateSummaryRow } from './responses/certificate-summary.mapper';
import { toCertificateDetail, type CertificateDetailRow } from './responses/certificate-detail.mapper';
import type { CertificateSimulate, CertificateIssue, CertificatesListQuery } from './certificates.dto';

const D = Prisma.Decimal;
const TOP_N = 5;

@Injectable()
export class CertificatesService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
  ) {}

  async simulate(input: CertificateSimulate) {
    const investor = await this.prisma.investor.findUnique({ where: { id: input.investor_id } });
    if (!investor) throw new NotFoundException('Inversor no encontrado');
    if (investor.kind === 'internal') {
      throw new BadRequestException('Inversor interno reservado para certificados sweep');
    }
    if (investor.status !== 'active') {
      throw new BadRequestException('Inversor inactivo');
    }

    const capital = new D(input.capital);
    const rate = new D(input.rate);
    const { price, nominalTarget } = computePricing({ capital, rate, termDays: input.term_days });

    const maturityDate = new Date(input.issue_date);
    maturityDate.setUTCDate(maturityDate.getUTCDate() + input.term_days);

    const eligible = await this.prisma.order.findMany({
      where: { status: 'available', max_due_date: { lte: maturityDate } },
      select: {
        id: true, external_order_id: true, installments_sum: true,
        merchant_id: true, num_installments: true, max_due_date: true,
        purchase_date: true,
      },
    });

    const eligibleForPool: EligibleOrder[] = eligible.map((o) => ({
      id: o.id,
      external_order_id: o.external_order_id,
      installments_sum: o.installments_sum,
      merchant_id: o.merchant_id,
      num_installments: o.num_installments,
      max_due_date: o.max_due_date,
    }));

    const { selected, nominalActual } = fillPool(eligibleForPool, nominalTarget);
    if (selected.length === 0) {
      throw new UnprocessableEntityException('No hay órdenes elegibles para los parámetros');
    }

    const payouts = computePayouts({ capital, price, nominalTarget, nominalActual });

    const merchantIds = [...new Set(selected.map((o) => o.merchant_id))];
    const merchants = await this.prisma.merchant.findMany({
      where: { id: { in: merchantIds } },
      select: { id: true, current_name: true, rif: true },
    });
    const merchantMap = new Map(merchants.map((m) => [m.id, m]));

    // Concentration aggregation
    const byMerchantSum = new Map<string, Prisma.Decimal>();
    for (const o of selected) {
      byMerchantSum.set(o.merchant_id, (byMerchantSum.get(o.merchant_id) ?? new D(0)).plus(o.installments_sum));
    }
    const concentration_top = Array.from(byMerchantSum.entries())
      .sort((a, b) => b[1].comparedTo(a[1]))
      .slice(0, TOP_N)
      .map(([merchant_id, amount]) => {
        const m = merchantMap.get(merchant_id)!;
        return {
          merchant_id,
          current_name: m.current_name,
          rif: m.rif,
          amount,
          pct: nominalActual.isZero() ? new D(0) : amount.div(nominalActual).toDecimalPlaces(6, D.ROUND_HALF_UP),
        };
      });

    // Installment plazo days range
    let minPlazo = Number.MAX_SAFE_INTEGER;
    let maxPlazo = 0;
    const issueTime = input.issue_date.getTime();
    for (const o of selected) {
      const days = Math.round((o.max_due_date.getTime() - issueTime) / 86400_000);
      if (days < minPlazo) minPlazo = days;
      if (days > maxPlazo) maxPlazo = days;
    }
    if (selected.length === 0) { minPlazo = 0; maxPlazo = 0; }

    // Due-date distribution from installments of selected orders
    const installments = await this.prisma.installment.findMany({
      where: { order_id: { in: selected.map((o) => o.id) } },
      select: { order_id: true, amount: true, due_date: true },
    });
    const byDate = new Map<string, Prisma.Decimal>();
    for (const i of installments) {
      const k = i.due_date.toISOString().slice(0, 10);
      byDate.set(k, (byDate.get(k) ?? new D(0)).plus(i.amount));
    }
    const due_date_distribution = Array.from(byDate.entries())
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([k, amount]) => ({ date: new Date(`${k}T00:00:00Z`), amount }));

    // Payload hash
    const payload_hash = computePayloadHash({
      inputs: {
        capital: capital.toFixed(4),
        rate: rate.toFixed(6),
        term_days: input.term_days,
        issue_date: input.issue_date.toISOString().slice(0, 10),
        investor_id: input.investor_id,
      },
      outputs: {
        price: price.toFixed(6),
        nominal_target: nominalTarget.toFixed(4),
        nominal_actual: nominalActual.toFixed(4),
        investor_paid: payouts.investorPaid.toFixed(4),
        investor_returned: payouts.investorReturned.toFixed(4),
        investor_yield: payouts.investorYield.toFixed(4),
        shortfall_pct: payouts.shortfallPct.toFixed(6),
      },
      order_ids: selected.map((o) => o.id),
    });

    return toSimulationResult({
      investor: { id: investor.id, legal_name: investor.legal_name, rif: investor.rif },
      capital,
      rate,
      term_days: input.term_days,
      issue_date: input.issue_date,
      maturity_date: maturityDate,
      price,
      nominal_target: nominalTarget,
      nominal_actual: nominalActual,
      investor_paid: payouts.investorPaid,
      investor_returned: payouts.investorReturned,
      investor_yield: payouts.investorYield,
      shortfall_pct: payouts.shortfallPct,
      selected_orders: selected.map((s) => ({
        id: s.id,
        installments_sum: s.installments_sum,
        merchant_id: s.merchant_id,
        num_installments: s.num_installments,
        max_due_date: s.max_due_date,
      })),
      total_eligible_merchants: merchantIds.length,
      installment_plazo_days: { min: minPlazo, max: maxPlazo },
      concentration_top,
      total_distinct_merchants: new Set(selected.map((o) => o.merchant_id)).size,
      due_date_distribution,
      payload_hash,
    });
  }

  // issue, list, detail filled in next tasks
  async issue(_input: CertificateIssue, _actorId: string): Promise<unknown> {
    throw new Error('not implemented');
  }
  async list(_query: CertificatesListQuery): Promise<unknown> {
    throw new Error('not implemented');
  }
  async detail(_id: string): Promise<unknown> {
    throw new Error('not implemented');
  }
}
```

- [ ] **Step 4: Run simulate tests, expect 7 pass**

```bash
pnpm vitest run src/modules/issuance/certificates/certificates.service.test.ts -t "simulate"
```

- [ ] **Step 5: TS check + commit**

```bash
pnpm exec tsc --noEmit
git add src/modules/issuance/certificates/certificates.service.ts src/modules/issuance/certificates/certificates.service.test.ts
git commit -m "feat(issuance): CertificatesService.simulate with greedy fill + concentration aggregates (TDD)"
```

---

## Task 6: CertificatesService.issue (TDD)

**Files:**
- Modify: `src/modules/issuance/certificates/certificates.service.ts`
- Modify: `src/modules/issuance/certificates/certificates.service.test.ts`

- [ ] **Step 1: Add issue tests to existing test file**

Append to `certificates.service.test.ts` (after the simulate tests):

```ts
function makePrismaForIssue(opts: {
  investor?: Record<string, unknown> | null;
  lockedOrders?: Array<{ id: string; installments_sum: Prisma.Decimal; max_due_date: Date; merchant_id: string; status: string }>;
  certificateCode?: string;
} = {}) {
  const tx = {
    $queryRaw: vi.fn().mockImplementation(async (strings: TemplateStringsArray) => {
      const sql = strings.join('?');
      if (sql.includes('FOR UPDATE')) {
        return opts.lockedOrders ?? [];
      }
      if (sql.includes('next_certificate_code')) {
        return [{ code: opts.certificateCode ?? 'C9999A' }];
      }
      return [];
    }),
    investor: { findUnique: vi.fn().mockResolvedValue(opts.investor ?? fakeInvestor()) },
    order: {
      findMany: vi.fn().mockResolvedValue([]),
      updateMany: vi.fn().mockResolvedValue({ count: opts.lockedOrders?.length ?? 0 }),
    },
    merchant: { findMany: vi.fn().mockResolvedValue([]) },
    installment: { findMany: vi.fn().mockResolvedValue([]) },
    certificate: {
      create: vi.fn().mockImplementation(async ({ data }: { data: unknown }) => ({
        id: 'cert-1', ...(data as object),
      })),
    },
    certificateOrder: { createMany: vi.fn().mockResolvedValue({ count: opts.lockedOrders?.length ?? 0 }) },
    certificateEvent: { create: vi.fn().mockResolvedValue({ id: 'evt-1' }) },
  };
  const prisma = {
    $transaction: vi.fn(async (cb: (t: typeof tx) => Promise<unknown>) => cb(tx)),
    ...tx,
  } as unknown as PrismaService;
  (prisma as unknown as { _tx: typeof tx })._tx = tx;
  return prisma;
}

describe('CertificatesService.issue', () => {
  it('happy path: locks orders, inserts cert+orders+events, updates orders, records audit', async () => {
    const lockedOrders = [
      { id: 'o-a', installments_sum: D('60'), max_due_date: new Date('2026-05-22'), merchant_id: 'm-a', status: 'available' },
      { id: 'o-b', installments_sum: D('40'), max_due_date: new Date('2026-05-29'), merchant_id: 'm-b', status: 'available' },
    ];
    const prisma = makePrismaForIssue({ lockedOrders });

    // Need to compute expected hash same way the service will
    const audit = makeAudit();
    const svc = new CertificatesService(prisma, audit);
    // Pre-run simulate to get expected_payload_hash
    (prisma.investor.findUnique as ReturnType<typeof vi.fn>).mockResolvedValueOnce(fakeInvestor());
    (prisma.order.findMany as ReturnType<typeof vi.fn>).mockResolvedValueOnce(
      lockedOrders.map((o) => ({ ...o, external_order_id: `ORD-${o.id}`, num_installments: 3, purchase_date: new Date('2026-04-01') })),
    );
    (prisma.merchant.findMany as ReturnType<typeof vi.fn>).mockResolvedValueOnce([
      { id: 'm-a', current_name: 'A', rif: 'J-1' }, { id: 'm-b', current_name: 'B', rif: 'J-2' },
    ]);
    (prisma.installment.findMany as ReturnType<typeof vi.fn>).mockResolvedValueOnce([]);
    const sim = await svc.simulate({
      investor_id: 'inv-1', capital: 100, rate: 0.13, term_days: 42,
      issue_date: new Date('2026-05-15'),
    });
    const expectedHash = sim.payload_hash;
    const orderIds = sim.pool.order_ids;

    const result = await svc.issue({
      investor_id: 'inv-1', capital: 100, rate: 0.13, term_days: 42,
      issue_date: new Date('2026-05-15'),
      order_ids: orderIds,
      expected_payload_hash: expectedHash,
    }, 'actor-1');

    const tx = (prisma as unknown as { _tx: { certificate: { create: ReturnType<typeof vi.fn> }; certificateOrder: { createMany: ReturnType<typeof vi.fn> }; order: { updateMany: ReturnType<typeof vi.fn> }; certificateEvent: { create: ReturnType<typeof vi.fn> } } })._tx;
    expect(tx.certificate.create).toHaveBeenCalledOnce();
    expect(tx.certificateOrder.createMany).toHaveBeenCalledOnce();
    expect(tx.order.updateMany).toHaveBeenCalledOnce();
    expect(tx.certificateEvent.create).toHaveBeenCalledOnce();
    expect(audit.recordChange).toHaveBeenCalledOnce();
    expect((result as { id: string }).id).toBe('cert-1');
  });

  it('throws 409 when one of the locked orders has status != available', async () => {
    const lockedOrders = [
      { id: 'o-a', installments_sum: D('60'), max_due_date: new Date('2026-05-22'), merchant_id: 'm-a', status: 'assigned' },
    ];
    const prisma = makePrismaForIssue({ lockedOrders });
    const svc = new CertificatesService(prisma, makeAudit());
    await expect(svc.issue({
      investor_id: 'inv-1', capital: 100, rate: 0.13, term_days: 42,
      issue_date: new Date('2026-05-15'),
      order_ids: ['o-a'],
      expected_payload_hash: 'a'.repeat(64),
    }, 'actor-1')).rejects.toBeInstanceOf(ConflictException);
  });

  it('throws 409 when one of the order_ids does not exist', async () => {
    const prisma = makePrismaForIssue({ lockedOrders: [] });
    const svc = new CertificatesService(prisma, makeAudit());
    await expect(svc.issue({
      investor_id: 'inv-1', capital: 100, rate: 0.13, term_days: 42,
      issue_date: new Date('2026-05-15'),
      order_ids: ['ghost'],
      expected_payload_hash: 'a'.repeat(64),
    }, 'actor-1')).rejects.toBeInstanceOf(ConflictException);
  });

  it('throws 422 when expected_payload_hash does not match recomputed', async () => {
    const lockedOrders = [
      { id: 'o-a', installments_sum: D('60'), max_due_date: new Date('2026-05-22'), merchant_id: 'm-a', status: 'available' },
    ];
    const prisma = makePrismaForIssue({ lockedOrders });
    const svc = new CertificatesService(prisma, makeAudit());
    await expect(svc.issue({
      investor_id: 'inv-1', capital: 100, rate: 0.13, term_days: 42,
      issue_date: new Date('2026-05-15'),
      order_ids: ['o-a'],
      expected_payload_hash: 'b'.repeat(64),
    }, 'actor-1')).rejects.toBeInstanceOf(UnprocessableEntityException);
  });

  it('throws 422 when client order_ids do not match recomputed pool', async () => {
    // Locked has one order; client claims a different set
    const lockedOrders = [
      { id: 'o-a', installments_sum: D('500'), max_due_date: new Date('2026-05-22'), merchant_id: 'm-a', status: 'available' },
    ];
    const prisma = makePrismaForIssue({ lockedOrders });
    const svc = new CertificatesService(prisma, makeAudit());
    await expect(svc.issue({
      investor_id: 'inv-1', capital: 100, rate: 0.13, term_days: 42,
      issue_date: new Date('2026-05-15'),
      order_ids: ['o-a'],   // 500 > target ~101.54 → recomputed pool would be empty, mismatch
      expected_payload_hash: 'a'.repeat(64),
    }, 'actor-1')).rejects.toBeInstanceOf(UnprocessableEntityException);
  });

  it('throws 422 when MAX(max_due_date) > maturity_date', async () => {
    const lockedOrders = [
      { id: 'o-a', installments_sum: D('60'), max_due_date: new Date('2027-12-31'), merchant_id: 'm-a', status: 'available' },
    ];
    const prisma = makePrismaForIssue({ lockedOrders });
    const svc = new CertificatesService(prisma, makeAudit());
    await expect(svc.issue({
      investor_id: 'inv-1', capital: 100, rate: 0.13, term_days: 42,
      issue_date: new Date('2026-05-15'),
      order_ids: ['o-a'],
      expected_payload_hash: 'a'.repeat(64),
    }, 'actor-1')).rejects.toBeInstanceOf(UnprocessableEntityException);
  });

  it('inserts certificate_event with event_type=created and updates orders to assigned', async () => {
    const lockedOrders = [
      { id: 'o-a', installments_sum: D('60'), max_due_date: new Date('2026-05-22'), merchant_id: 'm-a', status: 'available' },
    ];
    const prisma = makePrismaForIssue({ lockedOrders });
    const audit = makeAudit();
    const svc = new CertificatesService(prisma, audit);
    // Pre-simulate to get hash
    (prisma.investor.findUnique as ReturnType<typeof vi.fn>).mockResolvedValueOnce(fakeInvestor());
    (prisma.order.findMany as ReturnType<typeof vi.fn>).mockResolvedValueOnce(
      lockedOrders.map((o) => ({ ...o, external_order_id: `ORD-${o.id}`, num_installments: 3, purchase_date: new Date('2026-04-01') })),
    );
    (prisma.merchant.findMany as ReturnType<typeof vi.fn>).mockResolvedValueOnce([
      { id: 'm-a', current_name: 'A', rif: 'J-1' },
    ]);
    (prisma.installment.findMany as ReturnType<typeof vi.fn>).mockResolvedValueOnce([]);
    const sim = await svc.simulate({
      investor_id: 'inv-1', capital: 100, rate: 0.13, term_days: 42,
      issue_date: new Date('2026-05-15'),
    });

    await svc.issue({
      investor_id: 'inv-1', capital: 100, rate: 0.13, term_days: 42,
      issue_date: new Date('2026-05-15'),
      order_ids: sim.pool.order_ids,
      expected_payload_hash: sim.payload_hash,
    }, 'actor-1');

    const tx = (prisma as unknown as { _tx: { certificateEvent: { create: ReturnType<typeof vi.fn> }; order: { updateMany: ReturnType<typeof vi.fn> } } })._tx;
    const evtCall = tx.certificateEvent.create.mock.calls[0]![0] as { data: { event_type: string; payload: unknown } };
    expect(evtCall.data.event_type).toBe('created');
    const updCall = tx.order.updateMany.mock.calls[0]![0] as { where: { id: { in: string[] } }; data: { status: string } };
    expect(updCall.data.status).toBe('assigned');
    expect(updCall.where.id.in).toEqual(['o-a']);
  });
});
```

- [ ] **Step 2: Run, expect fail**

```bash
pnpm vitest run src/modules/issuance/certificates/certificates.service.test.ts -t "issue"
```

- [ ] **Step 3: Implement issue method (replace the throw stub)**

Replace the `async issue(...)` stub in `certificates.service.ts` with:

```ts
  async issue(input: CertificateIssue, actorId: string) {
    return await this.prisma.$transaction(
      async (tx) => {
        const investor = await tx.investor.findUnique({ where: { id: input.investor_id } });
        if (!investor) throw new NotFoundException('Inversor no encontrado');
        if (investor.kind === 'internal') {
          throw new BadRequestException('Inversor interno reservado para certificados sweep');
        }
        if (investor.status !== 'active') {
          throw new BadRequestException('Inversor inactivo');
        }

        const capital = new D(input.capital);
        const rate = new D(input.rate);
        const { price, nominalTarget } = computePricing({ capital, rate, termDays: input.term_days });
        const maturityDate = new Date(input.issue_date);
        maturityDate.setUTCDate(maturityDate.getUTCDate() + input.term_days);

        const lockedOrders = await tx.$queryRaw<
          Array<{ id: string; installments_sum: Prisma.Decimal; max_due_date: Date; merchant_id: string; status: string; external_order_id: string }>
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

        const eligibleForPool: EligibleOrder[] = lockedOrders.map((o) => ({
          id: o.id,
          external_order_id: o.external_order_id,
          installments_sum: o.installments_sum,
          merchant_id: o.merchant_id,
          num_installments: 0,
          max_due_date: o.max_due_date,
        }));
        const { selected, nominalActual } = fillPool(eligibleForPool, nominalTarget);

        const recomputedIds = new Set(selected.map((o) => o.id));
        const clientIds = new Set(input.order_ids);
        if (recomputedIds.size !== clientIds.size || ![...recomputedIds].every((id) => clientIds.has(id))) {
          throw new UnprocessableEntityException('Pool inválido — re-corra /simulate');
        }

        const payouts = computePayouts({ capital, price, nominalTarget, nominalActual });

        const recomputedHash = computePayloadHash({
          inputs: {
            capital: capital.toFixed(4),
            rate: rate.toFixed(6),
            term_days: input.term_days,
            issue_date: input.issue_date.toISOString().slice(0, 10),
            investor_id: input.investor_id,
          },
          outputs: {
            price: price.toFixed(6),
            nominal_target: nominalTarget.toFixed(4),
            nominal_actual: nominalActual.toFixed(4),
            investor_paid: payouts.investorPaid.toFixed(4),
            investor_returned: payouts.investorReturned.toFixed(4),
            investor_yield: payouts.investorYield.toFixed(4),
            shortfall_pct: payouts.shortfallPct.toFixed(6),
          },
          order_ids: selected.map((o) => o.id),
        });

        if (recomputedHash !== input.expected_payload_hash) {
          throw new UnprocessableEntityException('Payload mismatch — re-corra /simulate');
        }

        const cycleWeek = isoWeek(input.issue_date);
        const codeRows = await tx.$queryRaw<[{ code: string }]>(
          Prisma.sql`SELECT cfb.next_certificate_code() AS code`,
        );
        const certificate_code = codeRows[0].code;

        const cert = await tx.certificate.create({
          data: {
            certificate_code,
            certificate_type: 'standard',
            status: 'issued',
            investor_id: input.investor_id,
            investor_capital: capital,
            annual_rate: rate,
            rate_basis: '360',
            term_days: input.term_days,
            price,
            nominal_target: nominalTarget,
            nominal_actual: nominalActual,
            investor_paid: payouts.investorPaid,
            investor_returned: payouts.investorReturned,
            investor_yield: payouts.investorYield,
            shortfall_pct: payouts.shortfallPct,
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
              certificate_code,
              order_count: selected.length,
              nominal_actual: nominalActual.toFixed(4),
              investor_paid: payouts.investorPaid.toFixed(4),
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
            certificate_code,
            inputs: {
              capital: capital.toFixed(4),
              rate: rate.toFixed(6),
              term_days: input.term_days,
              issue_date: input.issue_date.toISOString().slice(0, 10),
              investor_id: input.investor_id,
            },
            order_count: selected.length,
            payload_hash: recomputedHash,
          },
          tx,
        });

        return { id: cert.id, certificate_code };
      },
      { timeout: 30_000 },
    );
  }
```

- [ ] **Step 4: Run issue tests, expect 7 pass**

```bash
pnpm vitest run src/modules/issuance/certificates/certificates.service.test.ts -t "issue"
```

If a test fails because of mock-DB query subtleties (e.g. `tx.$queryRaw` mock not matching the exact Prisma.sql template), inspect the failure — adjust the mock implementation to match each `Prisma.sql` template's identifying substring.

- [ ] **Step 5: TS check + commit**

```bash
pnpm exec tsc --noEmit
git add src/modules/issuance/certificates/certificates.service.ts src/modules/issuance/certificates/certificates.service.test.ts
git commit -m "feat(issuance): CertificatesService.issue with FOR UPDATE + payload_hash check + audit (TDD)"
```

---

## Task 7: CertificatesService.list + detail (TDD)

**Files:**
- Modify: `src/modules/issuance/certificates/certificates.service.ts`
- Modify: `src/modules/issuance/certificates/certificates.service.test.ts`

- [ ] **Step 1: Add list/detail tests**

Append to `certificates.service.test.ts`:

```ts
function makePrismaForListDetail() {
  return {
    certificate: {
      findMany: vi.fn().mockResolvedValue([]),
      count: vi.fn().mockResolvedValue(0),
      findUnique: vi.fn(),
    },
  } as unknown as PrismaService;
}

function fakeCertRow(): Record<string, unknown> {
  return {
    id: 'cert-1',
    certificate_code: 'C4572A',
    certificate_type: 'standard',
    status: 'issued',
    investor: { id: 'inv-1', legal_name: 'Inversora Alpha', rif: 'J-12345678-9' },
    investor_capital: D('100000'),
    annual_rate: D('0.13'),
    term_days: 42,
    price: D('0.984833'),
    nominal_target: D('101540.6028'),
    nominal_actual: D('101540'),
    investor_paid: D('99999.4093'),
    investor_returned: D('0.5907'),
    investor_yield: D('1540.5907'),
    shortfall_pct: D('0.000006'),
    issue_date: new Date('2026-04-27'),
    maturity_date: new Date('2026-06-08'),
    cycle_week: '2026-W18',
    issued_by: { id: 'user-1', email: 'op@cashea.app', full_name: 'Op' },
    created_at: new Date('2026-04-27T10:00:00Z'),
    payload_hash: 'a'.repeat(64),
    deleted_at: null,
  };
}

describe('CertificatesService.list', () => {
  it('returns paginated mapped certificates filtering deleted_at IS NULL', async () => {
    const prisma = makePrismaForListDetail();
    (prisma.certificate.findMany as ReturnType<typeof vi.fn>).mockResolvedValueOnce([fakeCertRow()]);
    (prisma.certificate.count as ReturnType<typeof vi.fn>).mockResolvedValueOnce(1);
    const svc = new CertificatesService(prisma, makeAudit());
    const r = await svc.list({ limit: 50, offset: 0, sort: 'issue_date_desc' });
    expect(r.total).toBe(1);
    expect(r.data[0]!.certificate_code).toBe('C4572A');
    expect(r.data[0]!.investor_capital).toBe('100000.0000');
    const call = (prisma.certificate.findMany as ReturnType<typeof vi.fn>).mock.calls[0]![0];
    expect(call.where.deleted_at).toBeNull();
  });
});

describe('CertificatesService.detail', () => {
  it('returns mapped detail with orders and events', async () => {
    const prisma = makePrismaForListDetail();
    (prisma.certificate.findUnique as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
      ...fakeCertRow(),
      certificate_orders: [
        {
          installments_sum_snapshot: D('300'),
          assigned_at: new Date('2026-04-27T10:00:00Z'),
          order: {
            id: 'o-1',
            external_order_id: 'ORD-1',
            merchant: { id: 'm-1', current_name: 'A', rif: 'J-1' },
            purchase_date: new Date('2026-04-01'),
            max_due_date: new Date('2026-05-15'),
            installments: [
              { installment_number: 1, amount: D('100'), due_date: new Date('2026-05-01'), status: 'pending' },
            ],
          },
        },
      ],
      certificate_events: [
        { id: 'evt-1', event_type: 'created', occurred_at: new Date(), payload: {}, actor_id: 'a-1' },
      ],
    });
    const svc = new CertificatesService(prisma, makeAudit());
    const r = await svc.detail('cert-1');
    expect(r.orders).toHaveLength(1);
    expect(r.orders[0]!.installments).toHaveLength(1);
    expect(r.events[0]!.event_type).toBe('created');
  });

  it('throws 404 when not found or deleted', async () => {
    const prisma = makePrismaForListDetail();
    (prisma.certificate.findUnique as ReturnType<typeof vi.fn>).mockResolvedValueOnce(null);
    const svc = new CertificatesService(prisma, makeAudit());
    await expect(svc.detail('missing')).rejects.toBeInstanceOf(NotFoundException);
  });
});
```

- [ ] **Step 2: Run, expect fail**

```bash
pnpm vitest run src/modules/issuance/certificates/certificates.service.test.ts -t "list|detail"
```

- [ ] **Step 3: Implement list + detail**

Replace the two stub methods in `certificates.service.ts`:

```ts
  async list(query: CertificatesListQuery) {
    const SORT_MAP = {
      issue_date_desc: [{ issue_date: 'desc' as const }],
      issue_date_asc: [{ issue_date: 'asc' as const }],
      code_asc: [{ certificate_code: 'asc' as const }],
    };

    const where: Prisma.CertificateWhereInput = { deleted_at: null };
    if (query.status) where.status = query.status;
    if (query.certificate_type) where.certificate_type = query.certificate_type;
    if (query.investor_id) where.investor_id = query.investor_id;
    if (query.issue_date_from || query.issue_date_to) {
      where.issue_date = {};
      if (query.issue_date_from) (where.issue_date as Record<string, Date>).gte = query.issue_date_from;
      if (query.issue_date_to) (where.issue_date as Record<string, Date>).lte = query.issue_date_to;
    }
    if (query.q) {
      where.certificate_code = { contains: query.q, mode: 'insensitive' };
    }

    const [rows, total] = await Promise.all([
      this.prisma.certificate.findMany({
        where,
        include: { investor: true, issued_by: true },
        orderBy: SORT_MAP[query.sort],
        take: query.limit,
        skip: query.offset,
      }),
      this.prisma.certificate.count({ where }),
    ]);

    return {
      data: rows.map((c) => toCertificateSummary(c as unknown as CertificateSummaryRow)),
      total,
      limit: query.limit,
      offset: query.offset,
    };
  }

  async detail(id: string) {
    const c = await this.prisma.certificate.findUnique({
      where: { id },
      include: {
        investor: true,
        issued_by: true,
        certificate_orders: {
          include: {
            order: {
              include: {
                merchant: true,
                installments: { orderBy: { installment_number: 'asc' } },
              },
            },
          },
          orderBy: { assigned_at: 'asc' },
        },
        certificate_events: { orderBy: { occurred_at: 'desc' }, take: 50 },
      },
    });
    if (!c || c.deleted_at !== null) {
      throw new NotFoundException('Certificado no encontrado');
    }
    return toCertificateDetail(c as unknown as CertificateDetailRow);
  }
```

- [ ] **Step 4: Run list/detail tests, expect 3 pass**

```bash
pnpm vitest run src/modules/issuance/certificates/certificates.service.test.ts -t "list|detail"
```

- [ ] **Step 5: Run all certificates.service tests (17 total)**

```bash
pnpm vitest run src/modules/issuance/certificates/certificates.service.test.ts
```

Expected: 17 passed.

- [ ] **Step 6: TS check + commit**

```bash
pnpm exec tsc --noEmit
git add src/modules/issuance/certificates/certificates.service.ts src/modules/issuance/certificates/certificates.service.test.ts
git commit -m "feat(issuance): CertificatesService.list + detail with deleted_at filter (TDD)"
```

---

## Task 8: CertificatesController + integration tests (TDD)

**Files:**
- Create: `src/modules/issuance/certificates/certificates.controller.ts`
- Create: `src/modules/issuance/certificates/certificates.controller.test.ts`

- [ ] **Step 1: Write the failing controller test**

```ts
// src/modules/issuance/certificates/certificates.controller.test.ts
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { Test } from '@nestjs/testing';
import { ConflictException, INestApplication, NotFoundException, UnprocessableEntityException } from '@nestjs/common';
import { APP_GUARD } from '@nestjs/core';
import { ConfigService } from '@nestjs/config';
import request from 'supertest';
import { CertificatesController } from './certificates.controller';
import { CertificatesService } from './certificates.service';
import { JwtService } from '../../auth/jwt.service';
import { UserLookupService } from '../../auth/user-lookup.service';
import { JwtAuthGuard } from '../../auth/jwt-auth.guard';
import { PermissionsGuard } from '../../auth/permissions.guard';
import { PrismaService } from '../../../prisma/prisma.service';
import { mintTestJwt, TEST_SECRET } from '../../../../test/helpers/jwt.helper';
import { mockAuthUser } from '../../../../test/helpers/auth-user.helper';

describe('CertificatesController', () => {
  let app: INestApplication;
  let svc: { simulate: ReturnType<typeof vi.fn>; issue: ReturnType<typeof vi.fn>; list: ReturnType<typeof vi.fn>; detail: ReturnType<typeof vi.fn> };
  let prismaPerms: ReturnType<typeof vi.fn>;

  beforeEach(async () => {
    svc = { simulate: vi.fn(), issue: vi.fn(), list: vi.fn(), detail: vi.fn() };
    prismaPerms = vi.fn().mockResolvedValue([
      { permission: { key: 'certificate.simulate' } },
      { permission: { key: 'certificate.issue' } },
      { permission: { key: 'certificate.read' } },
    ]);
    const config = { get: (k: string) => (k === 'SUPABASE_JWT_SECRET' ? TEST_SECRET : undefined) } as unknown as ConfigService;

    const moduleRef = await Test.createTestingModule({
      controllers: [CertificatesController],
      providers: [
        { provide: CertificatesService, useValue: svc },
        { provide: ConfigService, useValue: config },
        JwtService,
        { provide: UserLookupService, useValue: { findByAuthId: vi.fn().mockResolvedValue({ kind: 'found', user: mockAuthUser({ role: 'operator' }) }) } },
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

  it('POST /api/certificates/simulate → 401 without token', async () => {
    await request(app.getHttpServer()).post('/api/certificates/simulate').send({}).expect(401);
  });

  it('POST /api/certificates/simulate → 403 when role lacks certificate.simulate', async () => {
    prismaPerms.mockResolvedValueOnce([{ permission: { key: 'certificate.read' } }]);
    const t = await mintTestJwt({ sub: 'auth-uuid' });
    await request(app.getHttpServer())
      .post('/api/certificates/simulate')
      .set('Authorization', `Bearer ${t}`)
      .send({ investor_id: '00000000-0000-4000-8000-000000000001', capital: 100, rate: 0.13, term_days: 42, issue_date: futureDate() })
      .expect(403);
  });

  it('POST /api/certificates/simulate → 200 happy', async () => {
    svc.simulate.mockResolvedValueOnce({ rules_check: { maturity_boundary: true, order_indivisibility: true, round_down: true }, payload_hash: 'a'.repeat(64) });
    const t = await mintTestJwt({ sub: 'auth-uuid' });
    const res = await request(app.getHttpServer())
      .post('/api/certificates/simulate')
      .set('Authorization', `Bearer ${t}`)
      .send({ investor_id: '00000000-0000-4000-8000-000000000001', capital: 100, rate: 0.13, term_days: 42, issue_date: futureDate() })
      .expect(200);
    expect(res.body.payload_hash).toMatch(/^[a-f0-9]{64}$/);
  });

  it('POST /api/certificates → 401 without token', async () => {
    await request(app.getHttpServer()).post('/api/certificates').send({}).expect(401);
  });

  it('POST /api/certificates → 403 when role lacks certificate.issue', async () => {
    prismaPerms.mockResolvedValueOnce([{ permission: { key: 'certificate.simulate' } }]);
    const t = await mintTestJwt({ sub: 'auth-uuid' });
    await request(app.getHttpServer())
      .post('/api/certificates')
      .set('Authorization', `Bearer ${t}`)
      .send({
        investor_id: '00000000-0000-4000-8000-000000000001', capital: 100, rate: 0.13, term_days: 42,
        issue_date: futureDate(),
        order_ids: ['00000000-0000-4000-8000-000000000010'],
        expected_payload_hash: 'a'.repeat(64),
      })
      .expect(403);
  });

  it('POST /api/certificates → 201 happy', async () => {
    svc.issue.mockResolvedValueOnce({ id: 'cert-1', certificate_code: 'C4572A' });
    const t = await mintTestJwt({ sub: 'auth-uuid' });
    const res = await request(app.getHttpServer())
      .post('/api/certificates')
      .set('Authorization', `Bearer ${t}`)
      .send({
        investor_id: '00000000-0000-4000-8000-000000000001', capital: 100, rate: 0.13, term_days: 42,
        issue_date: futureDate(),
        order_ids: ['00000000-0000-4000-8000-000000000010'],
        expected_payload_hash: 'a'.repeat(64),
      })
      .expect(201);
    expect(res.body.certificate_code).toBe('C4572A');
  });

  it('POST /api/certificates → 409 when service throws ConflictException', async () => {
    svc.issue.mockRejectedValueOnce(new ConflictException({ message: 'Orden(es) ya asignada(s)', conflicting_order_ids: ['x'] }));
    const t = await mintTestJwt({ sub: 'auth-uuid' });
    const res = await request(app.getHttpServer())
      .post('/api/certificates')
      .set('Authorization', `Bearer ${t}`)
      .send({
        investor_id: '00000000-0000-4000-8000-000000000001', capital: 100, rate: 0.13, term_days: 42,
        issue_date: futureDate(),
        order_ids: ['00000000-0000-4000-8000-000000000010'],
        expected_payload_hash: 'a'.repeat(64),
      })
      .expect(409);
    expect(res.body.conflicting_order_ids).toEqual(['x']);
  });

  it('GET /api/certificates → 200 with paginated list', async () => {
    svc.list.mockResolvedValueOnce({ data: [], total: 0, limit: 50, offset: 0 });
    const t = await mintTestJwt({ sub: 'auth-uuid' });
    await request(app.getHttpServer())
      .get('/api/certificates')
      .set('Authorization', `Bearer ${t}`)
      .expect(200);
  });

  it('GET /api/certificates/:id → 404 when service throws', async () => {
    svc.detail.mockRejectedValueOnce(new NotFoundException('Certificado no encontrado'));
    const t = await mintTestJwt({ sub: 'auth-uuid' });
    await request(app.getHttpServer())
      .get('/api/certificates/00000000-0000-4000-8000-000000000099')
      .set('Authorization', `Bearer ${t}`)
      .expect(404);
  });
});
```

- [ ] **Step 2: Run, expect fail**

```bash
pnpm vitest run src/modules/issuance/certificates/certificates.controller.test.ts
```

- [ ] **Step 3: Implement controller**

```ts
// src/modules/issuance/certificates/certificates.controller.ts
import {
  Body, Controller, Get, HttpCode, HttpStatus, Param, ParseUUIDPipe, Post, Query, UsePipes,
} from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { CurrentUser } from '../../auth/decorators/current-user.decorator';
import { RequirePermission } from '../../auth/decorators/require-permission.decorator';
import type { AuthUser } from '../../auth/types';
import { ZodValidationPipe } from '../../../common/pipes/zod-validation.pipe';
import { CertificatesService } from './certificates.service';
import {
  CertificateSimulateSchema,
  CertificateIssueSchema,
  CertificatesListQuerySchema,
  type CertificateSimulate,
  type CertificateIssue,
  type CertificatesListQuery,
} from './certificates.dto';

@ApiTags('certificates')
@ApiBearerAuth()
@Controller('certificates')
export class CertificatesController {
  constructor(private readonly certificates: CertificatesService) {}

  @Post('simulate')
  @HttpCode(HttpStatus.OK)
  @RequirePermission('certificate.simulate')
  simulate(@Body(new ZodValidationPipe(CertificateSimulateSchema)) body: CertificateSimulate) {
    return this.certificates.simulate(body);
  }

  @Post()
  @HttpCode(HttpStatus.CREATED)
  @RequirePermission('certificate.issue')
  issue(
    @Body(new ZodValidationPipe(CertificateIssueSchema)) body: CertificateIssue,
    @CurrentUser() user: AuthUser,
  ) {
    return this.certificates.issue(body, user.id);
  }

  @Get()
  @RequirePermission('certificate.read')
  @UsePipes(new ZodValidationPipe(CertificatesListQuerySchema))
  list(@Query() query: CertificatesListQuery) {
    return this.certificates.list(query);
  }

  @Get(':id')
  @RequirePermission('certificate.read')
  detail(@Param('id', ParseUUIDPipe) id: string) {
    return this.certificates.detail(id);
  }
}
```

- [ ] **Step 4: Run controller tests, expect 9 pass**

```bash
pnpm vitest run src/modules/issuance/certificates/certificates.controller.test.ts
```

- [ ] **Step 5: TS check + commit**

```bash
pnpm exec tsc --noEmit
git add src/modules/issuance/certificates/certificates.controller.ts src/modules/issuance/certificates/certificates.controller.test.ts
git commit -m "feat(issuance): CertificatesController with 4 endpoints (TDD)"
```

---

## Task 9: IssuanceModule + AppModule wiring + smoke + openapi

**Files:**
- Create: `src/modules/issuance/issuance.module.ts`
- Modify: `src/app.module.ts`
- Generate + force-add: `openapi.json`

- [ ] **Step 1: Create IssuanceModule**

```ts
// src/modules/issuance/issuance.module.ts
import { Module } from '@nestjs/common';
import { InvestorsController } from './investors/investors.controller';
import { InvestorsService } from './investors/investors.service';
import { CertificatesController } from './certificates/certificates.controller';
import { CertificatesService } from './certificates/certificates.service';

@Module({
  controllers: [InvestorsController, CertificatesController],
  providers: [InvestorsService, CertificatesService],
})
export class IssuanceModule {}
```

- [ ] **Step 2: Wire into AppModule**

Read `src/app.module.ts` and add:

```ts
import { IssuanceModule } from './modules/issuance/issuance.module';

// In imports array, after PortfolioModule:
imports: [
  ConfigModule.forRoot({ isGlobal: true, validate: validateEnv }),
  LoggerModule,
  PrismaModule,
  AuditModule,
  AuthModule,
  HealthModule,
  MeModule,
  BatchesModule,
  PortfolioModule,
  IssuanceModule,
],
```

- [ ] **Step 3: TS + full suite**

```bash
pnpm exec tsc --noEmit && pnpm test 2>&1 | tail -8
```

Expected: zero TS errors, 136 (Slices 0-3) + ~62 (Slice 4a) ≈ ~198 tests passing.

- [ ] **Step 4: Commit wiring**

```bash
git add src/modules/issuance/issuance.module.ts src/app.module.ts
git commit -m "feat(issuance): wire IssuanceModule into AppModule"
```

- [ ] **Step 5: Smoke test against real Supabase**

The two existing orders from Slice 2 (`ORD-SMOKE-1` and `ORD-SMOKE-2`, total `installments_sum = $400`) are still `available` and eligible for emission. Their `max_due_date` values are 2026-06-12 and 2026-04-30 respectively.

Boot dev server:

```bash
lsof -ti:3001 | xargs -r kill -9 2>/dev/null; sleep 1
pnpm dev > /tmp/araguaney-dev.log 2>&1 &
DEV_PID=$!
sleep 7
```

Smoke script (move to project for `node_modules` resolution):

```bash
cat > scripts/smoke-slice4.ts <<'TSEOF'
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

async function main() {
  const t = await token();

  // 1. Create new investor (different RIF from any merchant to keep things tidy)
  const inv = await call('POST', '/api/investors', t, {
    legal_name: 'Inversora Alpha (smoke)',
    rif: 'J-30123456-7',
    kind: 'juridica',
  });
  console.log(`${inv.status} POST /api/investors\n${inv.body.slice(0, 240)}\n---`);
  let investorId = '';
  if (inv.status === 201) investorId = JSON.parse(inv.body).id;
  else if (inv.status === 409) investorId = JSON.parse(inv.body).existing_id;

  // 2. Simulate
  const issueDate = new Date();
  issueDate.setUTCDate(issueDate.getUTCDate() + 1);
  const issueDateStr = issueDate.toISOString().slice(0, 10);
  const sim = await call('POST', '/api/certificates/simulate', t, {
    investor_id: investorId, capital: 400, rate: 0.13, term_days: 42, issue_date: issueDateStr,
  });
  console.log(`${sim.status} POST /api/certificates/simulate\n${sim.body.slice(0, 600)}\n---`);
  if (sim.status !== 200) return;
  const simData = JSON.parse(sim.body);

  // 3. Issue
  const iss = await call('POST', '/api/certificates', t, {
    investor_id: investorId, capital: 400, rate: 0.13, term_days: 42, issue_date: issueDateStr,
    order_ids: simData.pool.order_ids,
    expected_payload_hash: simData.payload_hash,
  });
  console.log(`${iss.status} POST /api/certificates\n${iss.body.slice(0, 400)}\n---`);

  // 4. List
  const list = await call('GET', '/api/certificates', t);
  console.log(`${list.status} GET /api/certificates\n${list.body.slice(0, 400)}\n---`);

  // 5. Detail
  if (iss.status === 201) {
    const certId = JSON.parse(iss.body).id;
    const det = await call('GET', `/api/certificates/${certId}`, t);
    console.log(`${det.status} GET /api/certificates/${certId}\n${det.body.slice(0, 600)}\n---`);

    // 6. Idempotency: re-issue should 409
    const dup = await call('POST', '/api/certificates', t, {
      investor_id: investorId, capital: 400, rate: 0.13, term_days: 42, issue_date: issueDateStr,
      order_ids: simData.pool.order_ids,
      expected_payload_hash: simData.payload_hash,
    });
    console.log(`${dup.status} POST /api/certificates (re-issue, expect 409)\n${dup.body.slice(0, 240)}\n---`);
  }
}
main().catch((e) => { console.error(e); process.exit(1); });
TSEOF
pnpm exec tsx scripts/smoke-slice4.ts 2>&1 | head -120
rm -f scripts/smoke-slice4.ts
```

Expected:
- POST /api/investors → 201 (or 409 if already exists from a previous run)
- POST /api/certificates/simulate → 200, `pool.order_count=2`, `payouts.nominal_actual="400.0000"`
- POST /api/certificates → 201, `certificate_code` starting with `C` (e.g. `C4572A` or next in sequence)
- GET /api/certificates → 200, list contains 1 cert
- GET /api/certificates/:id → 200, `orders[2]`, `events[≥1]`
- Re-issue → 409 with `conflicting_order_ids`

Verify in Supabase via MCP:

```sql
SELECT count(*) AS cert_rows FROM cfb.certificates;
SELECT count(*) AS cert_orders FROM cfb.certificate_orders;
SELECT count(*) FROM cfb.orders WHERE status='assigned';
SELECT count(*) FROM cfb.audit_log WHERE entity_type='certificate' AND action='create';
```

Expected counts: 1 / 2 / 2 / 1.

Stop server:

```bash
kill $DEV_PID 2>/dev/null; wait $DEV_PID 2>/dev/null
lsof -ti:3001 | xargs -r kill -9 2>/dev/null
```

- [ ] **Step 6: Regenerate openapi.json**

```bash
pnpm openapi:export
node -e "const d = require('./openapi.json'); console.log(Object.keys(d.paths)); console.log('paths count:', Object.keys(d.paths).length);"
```

Expected paths to include all 13 from previous slices plus 7 new:
`/api/investors`, `/api/investors/{id}`, `/api/certificates`, `/api/certificates/{id}`, `/api/certificates/simulate`. That's 20 paths total.

- [ ] **Step 7: Force-add and commit**

```bash
git add -f openapi.json
git commit -m "feat(openapi): regenerate with issuance endpoints (investors + certificates simulate/issue/list/detail)"
```

---

## Self-review

**1. Spec coverage:**

| Spec section | Implemented in task |
|---|---|
| §3 Architecture (IssuanceModule + sub-features) | Tasks 3, 8, 9 |
| §4.1 Pricing (computePricing, computePayouts) | Task 1 |
| §4.2 Pool builder (greedy descending) | Task 1 |
| §4.3 Edge cases (empty pool, oversized, exact fit) | Task 5 (simulate 422), Task 1 (pure tests) |
| §4.4 Payload hash | Task 2 |
| §4.5 ISO week | Task 2 |
| §5 Investor endpoints (list/detail/create) | Task 3 |
| §6.1 POST /simulate | Task 5 |
| §6.2 POST / (issue) | Task 6 |
| §6.3 GET / (list) | Task 7 |
| §6.4 GET /:id (detail) | Task 7 |
| §7 Error handling matrix | Tested across service + controller tests |
| §8 Observability (logs + audit rows) | Audit row in Task 6 implementation; explicit Pino info-log lines in spec are NOT added in implementation tasks (gap, deferred — non-blocking, matches Slice 3 policy) |
| §9 Tests (~62) | Sum: T1 (15) + T2 (8) + T3 (13) + T5 (7) + T6 (7) + T7 (3) + T8 (9) = **62** |
| §10 No new deps / migrations | Confirmed across all tasks |
| §11 Acceptance criteria | T9 step 5 (smoke), step 6/7 (openapi), step 3 (test count) |

**2. Placeholder scan:**

No `TODO`, `TBD`, `implement later`, `fill in details` patterns. The two `throw new Error('not implemented')` stubs in Task 5's service are explicit placeholders that get replaced in Tasks 6 and 7 — they're scaffolding, not plan failures.

**3. Type/name consistency:**

- `EligibleOrder` defined in Task 1 (pool-builder), used in Task 5/6 service. ✓
- `Pricing`, `Payouts` types defined in Task 1, used in Tasks 5/6. ✓
- `PayloadHashInput` defined in Task 2, used in Tasks 5/6. ✓
- `isoWeek` defined in Task 2, used in Task 6. ✓
- `InvestorCreate`, `InvestorsListQuery` defined in Task 3, used in Task 3. ✓
- `CertificateSimulate`, `CertificateIssue`, `CertificatesListQuery` defined in Task 4, used in Tasks 5/6/7/8. ✓
- `CertificateSummaryRow`, `CertificateDetailRow`, `SimulationResultInput` defined in Task 4, used in Tasks 5/6/7. ✓
- Prisma model accessors used: `investor`, `certificate`, `certificateOrder`, `certificateEvent`, `order`, `installment`, `merchant` — all match Slice 0 conventions. The relation field `certificate_orders` (snake_case, plural) on Certificate, `order_events` on Order, etc. — verified in Slice 3.
- `AuditService.recordChange` signature stable since Slice 3. ✓

No issues found.

---

## Execution

Plan complete and saved to `docs/superpowers/plans/2026-05-06-slice-4-issuance.md`. Two execution options:

1. **Subagent-Driven (recommended)** — fresh subagent per task, two-stage review.
2. **Inline Execution** — execute tasks in this session with checkpoints.

Which approach?

# Slice 3 — Cartera Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build the read-mostly portfolio API for Cashea CFB: 8 GET endpoints across orders / merchants / end-users / installments with paginated lists, detail views, and an aggregation `GET /api/orders/stats`. Add `PATCH /api/end-users/:id` to enrich end-user identity post-ingestion, with every change recorded into `cfb.audit_log` via a new `@Global` `AuditService` reusable across slices.

**Architecture:** A `PortfolioModule` groups four sub-controllers (orders, merchants, end-users, installments). Each sub-feature has its own service + DTO file (Zod) + response mapper. A separate `@Global() AuditModule` exposes `AuditService.recordChange()` accepting an optional `Prisma.TransactionClient` so callers (the end-user PATCH) can include the audit row in the same transaction as the entity update. All Prisma queries lean on the existing indices from Slice 0 (`idx_orders_eligibility`, `idx_orders_purchase`, `idx_merchants_name`, `idx_installments_due_status`, `idx_audit_*`). Decimal monetary fields serialize as strings.

**Tech Stack:** NestJS 10, TypeScript 5 strict, Prisma 5, Zod, Vitest, supertest. No new dependencies. No new SQL migrations.

---

## Spec reference

`docs/superpowers/specs/2026-05-06-slice-3-portfolio-design.md`. Read first if you need product context.

## File structure

```
src/common/dto/
  pagination.schema.ts                       CREATE: shared Zod helper (limit, offset)
  pagination.schema.test.ts                  CREATE: 3 tests

src/modules/audit/
  audit.module.ts                            CREATE: @Global module
  audit.service.ts                           CREATE: recordChange()
  audit.service.test.ts                      CREATE: 2 tests
  types.ts                                   CREATE: AuditOptions, EntityType

src/modules/portfolio/
  portfolio.module.ts                        CREATE: groups 4 sub-modules' controllers/services
  orders/
    orders.controller.ts                     CREATE: GET list, GET stats, GET :id
    orders.service.ts                        CREATE
    orders.service.test.ts                   CREATE: 6 tests
    orders.controller.test.ts                CREATE: 5 integration tests
    orders.dto.ts                            CREATE: list query, stats query Zod
    responses/
      order-summary.mapper.ts                CREATE: list row → API
      order-detail.mapper.ts                 CREATE: detail row → API (with installments+events)
      order-stats.mapper.ts                  CREATE: groupBy result → stats payload
  merchants/
    merchants.controller.ts                  CREATE: GET list, GET :id
    merchants.service.ts                     CREATE
    merchants.service.test.ts                CREATE: 4 tests
    merchants.controller.test.ts             CREATE: 3 integration tests
    merchants.dto.ts                         CREATE
    responses/
      merchant-summary.mapper.ts             CREATE
      merchant-detail.mapper.ts              CREATE
  end-users/
    end-users.controller.ts                  CREATE: GET list, GET :id, PATCH :id
    end-users.service.ts                     CREATE: list/detail + update with audit
    end-users.service.test.ts                CREATE: 8 tests
    end-users.controller.test.ts             CREATE: 6 integration tests
    end-users.dto.ts                         CREATE: list query + EndUserUpdateSchema
    responses/
      end-user-summary.mapper.ts             CREATE
      end-user-detail.mapper.ts              CREATE
  installments/
    installments.controller.ts               CREATE: GET list
    installments.service.ts                  CREATE
    installments.service.test.ts             CREATE: 3 tests
    installments.controller.test.ts          CREATE: 2 integration tests
    installments.dto.ts                      CREATE
    responses/
      installment-summary.mapper.ts          CREATE

src/app.module.ts                            MODIFY: import AuditModule + PortfolioModule

openapi.json                                 REGENERATE + COMMIT
```

---

## Task 1: Pagination schema (TDD)

**Files:**
- Create: `src/common/dto/pagination.schema.ts`
- Create: `src/common/dto/pagination.schema.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
// src/common/dto/pagination.schema.test.ts
import { describe, it, expect } from 'vitest';
import { PaginationSchema } from './pagination.schema';

describe('PaginationSchema', () => {
  it('applies defaults limit=50, offset=0 when empty', () => {
    expect(PaginationSchema.parse({})).toEqual({ limit: 50, offset: 0 });
  });

  it('coerces string numbers from query params', () => {
    expect(PaginationSchema.parse({ limit: '25', offset: '100' })).toEqual({ limit: 25, offset: 100 });
  });

  it('rejects limit > 200', () => {
    expect(() => PaginationSchema.parse({ limit: 201 })).toThrow();
  });

  it('rejects negative offset', () => {
    expect(() => PaginationSchema.parse({ offset: -1 })).toThrow();
  });

  it('rejects limit < 1', () => {
    expect(() => PaginationSchema.parse({ limit: 0 })).toThrow();
  });
});
```

- [ ] **Step 2: Run, expect fail**

```bash
pnpm vitest run src/common/dto/pagination.schema.test.ts
```

Expected: FAIL — module not found.

- [ ] **Step 3: Implement**

```ts
// src/common/dto/pagination.schema.ts
import { z } from 'zod';

export const PaginationSchema = z.object({
  limit: z.coerce.number().int().min(1).max(200).default(50),
  offset: z.coerce.number().int().min(0).default(0),
});

export type Pagination = z.infer<typeof PaginationSchema>;
```

- [ ] **Step 4: Run, expect pass (5 tests)**

```bash
pnpm vitest run src/common/dto/pagination.schema.test.ts
```

- [ ] **Step 5: Commit**

```bash
git add src/common/dto/pagination.schema.ts src/common/dto/pagination.schema.test.ts
git commit -m "feat(common): shared PaginationSchema (TDD)"
```

---

## Task 2: AuditModule + AuditService (TDD)

**Files:**
- Create: `src/modules/audit/types.ts`
- Create: `src/modules/audit/audit.service.ts`
- Create: `src/modules/audit/audit.service.test.ts`
- Create: `src/modules/audit/audit.module.ts`

- [ ] **Step 1: Create `types.ts`**

```ts
// src/modules/audit/types.ts
import type { Prisma } from '@prisma/client';

export type AuditEntityType =
  | 'batch'
  | 'order'
  | 'installment'
  | 'certificate'
  | 'certificate_order'
  | 'investor'
  | 'merchant'
  | 'end_user'
  | 'user'
  | 'setting'
  | 'system';

export type AuditOptions = {
  entityType: AuditEntityType;
  entityId: string;
  action: string;
  actorId: string;
  payload: Record<string, unknown>;
  tx?: Prisma.TransactionClient;
};
```

- [ ] **Step 2: Write the failing test**

```ts
// src/modules/audit/audit.service.test.ts
import { describe, it, expect, vi } from 'vitest';
import { AuditService } from './audit.service';
import { PrismaService } from '../../prisma/prisma.service';

describe('AuditService.recordChange', () => {
  it('inserts an audit_log row using the global prisma client when no tx is provided', async () => {
    const create = vi.fn().mockResolvedValue({ id: 'audit-1' });
    const prisma = { auditLog: { create } } as unknown as PrismaService;
    const svc = new AuditService(prisma);

    await svc.recordChange({
      entityType: 'end_user',
      entityId: '00000000-0000-4000-8000-000000000001',
      action: 'update',
      actorId: '00000000-0000-4000-8000-000000000002',
      payload: { before: { email: null }, after: { email: 'x@y.com' } },
    });

    expect(create).toHaveBeenCalledWith({
      data: {
        entity_type: 'end_user',
        entity_id: '00000000-0000-4000-8000-000000000001',
        action: 'update',
        actor_id: '00000000-0000-4000-8000-000000000002',
        payload: { before: { email: null }, after: { email: 'x@y.com' } },
      },
    });
  });

  it('uses the caller-provided tx instead of the global prisma client', async () => {
    const globalCreate = vi.fn();
    const txCreate = vi.fn().mockResolvedValue({ id: 'audit-2' });
    const prisma = { auditLog: { create: globalCreate } } as unknown as PrismaService;
    const tx = { auditLog: { create: txCreate } } as unknown as Parameters<AuditService['recordChange']>[0]['tx'];
    const svc = new AuditService(prisma);

    await svc.recordChange({
      entityType: 'end_user',
      entityId: 'id',
      action: 'update',
      actorId: 'actor',
      payload: {},
      tx,
    });

    expect(txCreate).toHaveBeenCalledOnce();
    expect(globalCreate).not.toHaveBeenCalled();
  });
});
```

- [ ] **Step 3: Run, expect fail**

```bash
pnpm vitest run src/modules/audit/audit.service.test.ts
```

- [ ] **Step 4: Implement service**

```ts
// src/modules/audit/audit.service.ts
import { Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import type { AuditOptions } from './types';

@Injectable()
export class AuditService {
  constructor(private readonly prisma: PrismaService) {}

  async recordChange(opts: AuditOptions): Promise<void> {
    const client = opts.tx ?? this.prisma;
    await client.auditLog.create({
      data: {
        entity_type: opts.entityType,
        entity_id: opts.entityId,
        action: opts.action,
        actor_id: opts.actorId,
        payload: opts.payload as Prisma.InputJsonValue,
      },
    });
  }
}
```

- [ ] **Step 5: Run, expect pass (2 tests)**

```bash
pnpm vitest run src/modules/audit/audit.service.test.ts
```

- [ ] **Step 6: Implement module**

```ts
// src/modules/audit/audit.module.ts
import { Global, Module } from '@nestjs/common';
import { AuditService } from './audit.service';

@Global()
@Module({
  providers: [AuditService],
  exports: [AuditService],
})
export class AuditModule {}
```

- [ ] **Step 7: TS check**

```bash
pnpm exec tsc --noEmit
```

Zero errors.

- [ ] **Step 8: Commit**

```bash
git add src/modules/audit/
git commit -m "feat(audit): @Global AuditModule + AuditService.recordChange (TDD)"
```

---

## Task 3: Orders DTOs + mappers

**Files:**
- Create: `src/modules/portfolio/orders/orders.dto.ts`
- Create: `src/modules/portfolio/orders/responses/order-summary.mapper.ts`
- Create: `src/modules/portfolio/orders/responses/order-detail.mapper.ts`
- Create: `src/modules/portfolio/orders/responses/order-stats.mapper.ts`

- [ ] **Step 1: Create `orders.dto.ts`**

```ts
// src/modules/portfolio/orders/orders.dto.ts
import { z } from 'zod';
import { PaginationSchema } from '../../../common/dto/pagination.schema';

export const OrderStatusEnum = z.enum(['available', 'assigned', 'matured', 'defaulted']);

const OrdersFiltersBase = z.object({
  status: OrderStatusEnum.optional(),
  merchant_id: z.string().uuid().optional(),
  end_user_id: z.string().uuid().optional(),
  batch_id: z.string().uuid().optional(),
  purchase_date_from: z.coerce.date().optional(),
  purchase_date_to: z.coerce.date().optional(),
  max_due_date_lte: z.coerce.date().optional(),
});

export const OrdersListQuerySchema = PaginationSchema.extend({
  ...OrdersFiltersBase.shape,
  q: z.string().min(1).max(100).optional(),
  sort: z
    .enum(['purchase_date_desc', 'purchase_date_asc', 'max_due_date_asc', 'max_due_date_desc'])
    .default('purchase_date_desc'),
});

export const OrdersStatsQuerySchema = OrdersFiltersBase;

export type OrdersListQuery = z.infer<typeof OrdersListQuerySchema>;
export type OrdersStatsQuery = z.infer<typeof OrdersStatsQuerySchema>;
```

- [ ] **Step 2: Create `order-summary.mapper.ts`**

```ts
// src/modules/portfolio/orders/responses/order-summary.mapper.ts
import type { Decimal } from '@prisma/client/runtime/library';

export type OrderSummaryRow = {
  id: string;
  external_order_id: string;
  status: string;
  purchase_date: Date;
  max_due_date: Date;
  total_amount: Decimal;
  installments_sum: Decimal;
  num_installments: number;
  imported_at: Date;
  merchant: { id: string; current_name: string; rif: string };
  end_user: { id: string; external_hash: string; national_id: string | null; full_name: string | null };
  batches: { id: string; external_code: string };
};

export function toOrderSummary(o: OrderSummaryRow) {
  return {
    id: o.id,
    external_order_id: o.external_order_id,
    status: o.status,
    purchase_date: o.purchase_date.toISOString().slice(0, 10),
    max_due_date: o.max_due_date.toISOString().slice(0, 10),
    total_amount: o.total_amount.toFixed(4),
    installments_sum: o.installments_sum.toFixed(4),
    num_installments: o.num_installments,
    imported_at: o.imported_at.toISOString(),
    merchant: { id: o.merchant.id, current_name: o.merchant.current_name, rif: o.merchant.rif },
    end_user: {
      id: o.end_user.id,
      external_hash: o.end_user.external_hash,
      national_id: o.end_user.national_id,
      full_name: o.end_user.full_name,
    },
    batch: { id: o.batches.id, external_code: o.batches.external_code },
  };
}
```

- [ ] **Step 3: Create `order-detail.mapper.ts`**

```ts
// src/modules/portfolio/orders/responses/order-detail.mapper.ts
import type { Decimal } from '@prisma/client/runtime/library';
import { toOrderSummary, type OrderSummaryRow } from './order-summary.mapper';

export type OrderDetailRow = OrderSummaryRow & {
  installments: Array<{
    id: string;
    external_installment_id: string;
    installment_number: number;
    amount: Decimal;
    due_date: Date;
    status: string;
    paid_amount: Decimal | null;
  }>;
  order_events: Array<{
    id: string;
    event_type: string;
    occurred_at: Date;
    payload: unknown;
    actor_id: string | null;
  }>;
};

export function toOrderDetail(o: OrderDetailRow) {
  return {
    ...toOrderSummary(o),
    installments: o.installments.map((i) => ({
      id: i.id,
      external_installment_id: i.external_installment_id,
      installment_number: i.installment_number,
      amount: i.amount.toFixed(4),
      due_date: i.due_date.toISOString().slice(0, 10),
      status: i.status,
      paid_amount: i.paid_amount?.toFixed(4) ?? null,
    })),
    events: o.order_events.map((e) => ({
      id: e.id,
      event_type: e.event_type,
      occurred_at: e.occurred_at.toISOString(),
      payload: e.payload,
      actor_id: e.actor_id,
    })),
  };
}
```

- [ ] **Step 4: Create `order-stats.mapper.ts`**

```ts
// src/modules/portfolio/orders/responses/order-stats.mapper.ts
import type { Decimal } from '@prisma/client/runtime/library';

export type StatsGroupRow = {
  status: string;
  _count: { _all: number };
  _sum: { total_amount: Decimal | null; installments_sum: Decimal | null };
};

const STATUSES = ['available', 'assigned', 'matured', 'defaulted'] as const;

export function toOrderStats(rows: StatsGroupRow[]) {
  const by_status: Record<string, { count: number; total_amount: string; total_installments_amount: string }> = {};
  for (const s of STATUSES) {
    by_status[s] = { count: 0, total_amount: '0.0000', total_installments_amount: '0.0000' };
  }
  let total_orders = 0;
  for (const row of rows) {
    by_status[row.status] = {
      count: row._count._all,
      total_amount: (row._sum.total_amount ?? toDecimalZero()).toFixed(4),
      total_installments_amount: (row._sum.installments_sum ?? toDecimalZero()).toFixed(4),
    };
    total_orders += row._count._all;
  }
  return {
    by_status,
    total_orders,
    available_capital: by_status.available!.total_installments_amount,
  };
}

function toDecimalZero(): { toFixed: (n: number) => string } {
  return { toFixed: () => '0.0000' };
}
```

- [ ] **Step 5: TS check**

```bash
pnpm exec tsc --noEmit
```

Zero errors.

- [ ] **Step 6: Commit**

```bash
git add src/modules/portfolio/orders/orders.dto.ts src/modules/portfolio/orders/responses/
git commit -m "feat(portfolio): orders DTOs + summary/detail/stats mappers"
```

---

## Task 4: OrdersService (TDD)

**Files:**
- Create: `src/modules/portfolio/orders/orders.service.ts`
- Create: `src/modules/portfolio/orders/orders.service.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
// src/modules/portfolio/orders/orders.service.test.ts
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { NotFoundException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { OrdersService } from './orders.service';
import { PrismaService } from '../../../prisma/prisma.service';

function fakeRow(overrides: Record<string, unknown> = {}) {
  return {
    id: 'order-1',
    external_order_id: 'ORD-1',
    status: 'available',
    purchase_date: new Date('2026-04-01'),
    max_due_date: new Date('2026-05-13'),
    total_amount: new Prisma.Decimal('300.00'),
    installments_sum: new Prisma.Decimal('300.00'),
    num_installments: 3,
    imported_at: new Date('2026-05-06T12:59:47Z'),
    merchant: { id: 'm-1', current_name: 'Mercantil C.A.', rif: 'J-12345678-9' },
    end_user: { id: 'u-1', external_hash: 'smoke-user-1', national_id: null, full_name: null },
    batches: { id: 'b-1', external_code: 'B-20260506-125940' },
    ...overrides,
  };
}

function makePrisma() {
  return {
    order: {
      findMany: vi.fn().mockResolvedValue([]),
      count: vi.fn().mockResolvedValue(0),
      findUnique: vi.fn(),
      groupBy: vi.fn().mockResolvedValue([]),
    },
  } as unknown as PrismaService;
}

describe('OrdersService.list', () => {
  it('returns paginated data with mapped summary rows', async () => {
    const prisma = makePrisma();
    (prisma.order.findMany as ReturnType<typeof vi.fn>).mockResolvedValueOnce([fakeRow()]);
    (prisma.order.count as ReturnType<typeof vi.fn>).mockResolvedValueOnce(1);
    const svc = new OrdersService(prisma);

    const result = await svc.list({ limit: 50, offset: 0, sort: 'purchase_date_desc' });

    expect(result.total).toBe(1);
    expect(result.data).toHaveLength(1);
    expect(result.data[0]!.external_order_id).toBe('ORD-1');
    expect(result.data[0]!.total_amount).toBe('300.0000');
  });

  it('passes filters through to prisma where clause (status + max_due_date_lte + merchant_id)', async () => {
    const prisma = makePrisma();
    const svc = new OrdersService(prisma);

    await svc.list({
      limit: 50,
      offset: 0,
      sort: 'max_due_date_asc',
      status: 'available',
      max_due_date_lte: new Date('2026-06-01'),
      merchant_id: 'm-xx',
    });

    const call = (prisma.order.findMany as ReturnType<typeof vi.fn>).mock.calls[0]![0];
    expect(call.where).toEqual({
      status: 'available',
      merchant_id: 'm-xx',
      max_due_date: { lte: new Date('2026-06-01') },
    });
    expect(call.orderBy).toEqual([{ max_due_date: 'asc' }]);
  });

  it('combines purchase_date_from/to into a range', async () => {
    const prisma = makePrisma();
    const svc = new OrdersService(prisma);
    await svc.list({
      limit: 50, offset: 0, sort: 'purchase_date_desc',
      purchase_date_from: new Date('2026-04-01'),
      purchase_date_to: new Date('2026-04-30'),
    });
    const call = (prisma.order.findMany as ReturnType<typeof vi.fn>).mock.calls[0]![0];
    expect(call.where.purchase_date).toEqual({
      gte: new Date('2026-04-01'),
      lte: new Date('2026-04-30'),
    });
  });
});

describe('OrdersService.detail', () => {
  it('returns order with installments + events', async () => {
    const prisma = makePrisma();
    (prisma.order.findUnique as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
      ...fakeRow(),
      installments: [
        { id: 'i-1', external_installment_id: 'I-1', installment_number: 1, amount: new Prisma.Decimal('75.00'), due_date: new Date('2026-04-15'), status: 'pending', paid_amount: null },
      ],
      order_events: [],
    });
    const svc = new OrdersService(prisma);
    const r = await svc.detail('order-1');
    expect(r.installments).toHaveLength(1);
    expect(r.installments[0]!.amount).toBe('75.0000');
    expect(r.events).toHaveLength(0);
  });

  it('throws NotFoundException when order not found', async () => {
    const prisma = makePrisma();
    (prisma.order.findUnique as ReturnType<typeof vi.fn>).mockResolvedValueOnce(null);
    const svc = new OrdersService(prisma);
    await expect(svc.detail('missing')).rejects.toBeInstanceOf(NotFoundException);
  });
});

describe('OrdersService.stats', () => {
  it('aggregates groupBy result with available_capital from available bucket', async () => {
    const prisma = makePrisma();
    (prisma.order.groupBy as ReturnType<typeof vi.fn>).mockResolvedValueOnce([
      { status: 'available', _count: { _all: 2 }, _sum: { total_amount: new Prisma.Decimal('400.00'), installments_sum: new Prisma.Decimal('400.00') } },
      { status: 'assigned', _count: { _all: 1 }, _sum: { total_amount: new Prisma.Decimal('100.00'), installments_sum: new Prisma.Decimal('75.00') } },
    ]);
    const svc = new OrdersService(prisma);
    const r = await svc.stats({});
    expect(r.total_orders).toBe(3);
    expect(r.by_status.available.count).toBe(2);
    expect(r.by_status.matured.count).toBe(0);
    expect(r.available_capital).toBe('400.0000');
  });
});
```

- [ ] **Step 2: Run, expect fail**

```bash
pnpm vitest run src/modules/portfolio/orders/orders.service.test.ts
```

- [ ] **Step 3: Implement**

```ts
// src/modules/portfolio/orders/orders.service.ts
import { Injectable, NotFoundException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../../../prisma/prisma.service';
import type { OrdersListQuery, OrdersStatsQuery } from './orders.dto';
import { toOrderSummary } from './responses/order-summary.mapper';
import { toOrderDetail } from './responses/order-detail.mapper';
import { toOrderStats, type StatsGroupRow } from './responses/order-stats.mapper';

const SORT_MAP = {
  purchase_date_desc: [{ purchase_date: 'desc' as const }],
  purchase_date_asc: [{ purchase_date: 'asc' as const }],
  max_due_date_asc: [{ max_due_date: 'asc' as const }],
  max_due_date_desc: [{ max_due_date: 'desc' as const }],
};

@Injectable()
export class OrdersService {
  constructor(private readonly prisma: PrismaService) {}

  async list(query: OrdersListQuery) {
    const where = this.buildWhere(query);
    if (query.q) {
      where.external_order_id = { contains: query.q, mode: 'insensitive' };
    }
    const orderBy = SORT_MAP[query.sort];
    const [rows, total] = await Promise.all([
      this.prisma.order.findMany({
        where,
        include: { merchant: true, end_user: true, batches: true },
        orderBy,
        take: query.limit,
        skip: query.offset,
      }),
      this.prisma.order.count({ where }),
    ]);
    return {
      data: rows.map((r) => toOrderSummary(r as never)),
      total,
      limit: query.limit,
      offset: query.offset,
    };
  }

  async detail(id: string) {
    const row = await this.prisma.order.findUnique({
      where: { id },
      include: {
        merchant: true,
        end_user: true,
        batches: true,
        installments: { orderBy: { installment_number: 'asc' } },
        order_events: { orderBy: { occurred_at: 'desc' }, take: 50 },
      },
    });
    if (!row) throw new NotFoundException('Orden no encontrada');
    return toOrderDetail(row as never);
  }

  async stats(query: OrdersStatsQuery) {
    const where = this.buildWhere(query);
    const rows = await this.prisma.order.groupBy({
      by: ['status'],
      where,
      _count: { _all: true },
      _sum: { total_amount: true, installments_sum: true },
    });
    return toOrderStats(rows as unknown as StatsGroupRow[]);
  }

  private buildWhere(q: OrdersStatsQuery): Prisma.OrderWhereInput {
    const where: Prisma.OrderWhereInput = {};
    if (q.status) where.status = q.status;
    if (q.merchant_id) where.merchant_id = q.merchant_id;
    if (q.end_user_id) where.end_user_id = q.end_user_id;
    if (q.batch_id) where.batch_id = q.batch_id;
    if (q.purchase_date_from || q.purchase_date_to) {
      where.purchase_date = {};
      if (q.purchase_date_from) (where.purchase_date as Record<string, Date>).gte = q.purchase_date_from;
      if (q.purchase_date_to) (where.purchase_date as Record<string, Date>).lte = q.purchase_date_to;
    }
    if (q.max_due_date_lte) where.max_due_date = { lte: q.max_due_date_lte };
    return where;
  }
}
```

- [ ] **Step 4: Run, expect pass (6 tests)**

```bash
pnpm vitest run src/modules/portfolio/orders/orders.service.test.ts
```

If tests fail because Prisma model relation names differ from `merchant`/`end_user`/`batches`, inspect `prisma/schema.prisma` near the `Order` model to see the actual relation names and adjust both the service and the mapper types. (As of Slice 0 the conventions are `merchant`, `end_user`, `batches`.)

- [ ] **Step 5: TS check**

```bash
pnpm exec tsc --noEmit
```

- [ ] **Step 6: Commit**

```bash
git add src/modules/portfolio/orders/orders.service.ts src/modules/portfolio/orders/orders.service.test.ts
git commit -m "feat(portfolio): OrdersService list/detail/stats with filter composition (TDD)"
```

---

## Task 5: OrdersController + integration tests

**Files:**
- Create: `src/modules/portfolio/orders/orders.controller.ts`
- Create: `src/modules/portfolio/orders/orders.controller.test.ts`

- [ ] **Step 1: Write the failing integration test**

```ts
// src/modules/portfolio/orders/orders.controller.test.ts
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { Test } from '@nestjs/testing';
import { INestApplication } from '@nestjs/common';
import { APP_GUARD } from '@nestjs/core';
import { ConfigService } from '@nestjs/config';
import request from 'supertest';
import { OrdersController } from './orders.controller';
import { OrdersService } from './orders.service';
import { JwtService } from '../../auth/jwt.service';
import { UserLookupService } from '../../auth/user-lookup.service';
import { JwtAuthGuard } from '../../auth/jwt-auth.guard';
import { PermissionsGuard } from '../../auth/permissions.guard';
import { PrismaService } from '../../../prisma/prisma.service';
import { mintTestJwt, TEST_SECRET } from '../../../../test/helpers/jwt.helper';
import { mockAuthUser } from '../../../../test/helpers/auth-user.helper';

describe('OrdersController', () => {
  let app: INestApplication;
  let svc: { list: ReturnType<typeof vi.fn>; detail: ReturnType<typeof vi.fn>; stats: ReturnType<typeof vi.fn> };
  let prismaPerms: ReturnType<typeof vi.fn>;
  let lookup: { findByAuthId: ReturnType<typeof vi.fn> };

  beforeEach(async () => {
    svc = { list: vi.fn(), detail: vi.fn(), stats: vi.fn() };
    prismaPerms = vi.fn().mockResolvedValue([{ permission: { key: 'portfolio.read' } }]);
    lookup = { findByAuthId: vi.fn().mockResolvedValue({ kind: 'found', user: mockAuthUser({ role: 'operator' }) }) };

    const config = { get: (k: string) => (k === 'SUPABASE_JWT_SECRET' ? TEST_SECRET : undefined) } as unknown as ConfigService;

    const moduleRef = await Test.createTestingModule({
      controllers: [OrdersController],
      providers: [
        { provide: OrdersService, useValue: svc },
        { provide: ConfigService, useValue: config },
        JwtService,
        { provide: UserLookupService, useValue: lookup },
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

  it('GET /api/orders → 401 without Authorization', async () => {
    await request(app.getHttpServer()).get('/api/orders').expect(401);
  });

  it('GET /api/orders → 403 when role lacks portfolio.read', async () => {
    prismaPerms.mockResolvedValueOnce([]);
    const token = await mintTestJwt({ sub: 'auth-uuid' });
    await request(app.getHttpServer())
      .get('/api/orders')
      .set('Authorization', `Bearer ${token}`)
      .expect(403);
  });

  it('GET /api/orders → 200 with paginated body', async () => {
    svc.list.mockResolvedValueOnce({ data: [], total: 0, limit: 50, offset: 0 });
    const token = await mintTestJwt({ sub: 'auth-uuid' });
    const res = await request(app.getHttpServer())
      .get('/api/orders')
      .set('Authorization', `Bearer ${token}`)
      .expect(200);
    expect(res.body).toEqual({ data: [], total: 0, limit: 50, offset: 0 });
  });

  it('GET /api/orders/stats → 200 with by_status and available_capital', async () => {
    svc.stats.mockResolvedValueOnce({
      by_status: {
        available: { count: 2, total_amount: '400.0000', total_installments_amount: '400.0000' },
        assigned: { count: 0, total_amount: '0.0000', total_installments_amount: '0.0000' },
        matured: { count: 0, total_amount: '0.0000', total_installments_amount: '0.0000' },
        defaulted: { count: 0, total_amount: '0.0000', total_installments_amount: '0.0000' },
      },
      total_orders: 2,
      available_capital: '400.0000',
    });
    const token = await mintTestJwt({ sub: 'auth-uuid' });
    const res = await request(app.getHttpServer())
      .get('/api/orders/stats')
      .set('Authorization', `Bearer ${token}`)
      .expect(200);
    expect(res.body.available_capital).toBe('400.0000');
    expect(res.body.total_orders).toBe(2);
  });

  it('GET /api/orders/:id → 404 when service throws NotFoundException', async () => {
    const { NotFoundException } = await import('@nestjs/common');
    svc.detail.mockRejectedValueOnce(new NotFoundException('Orden no encontrada'));
    const token = await mintTestJwt({ sub: 'auth-uuid' });
    await request(app.getHttpServer())
      .get('/api/orders/00000000-0000-4000-8000-000000000099')
      .set('Authorization', `Bearer ${token}`)
      .expect(404);
  });
});
```

- [ ] **Step 2: Run, expect fail**

```bash
pnpm vitest run src/modules/portfolio/orders/orders.controller.test.ts
```

- [ ] **Step 3: Implement controller**

```ts
// src/modules/portfolio/orders/orders.controller.ts
import { Controller, Get, Param, ParseUUIDPipe, Query, UsePipes } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { RequirePermission } from '../../auth/decorators/require-permission.decorator';
import { ZodValidationPipe } from '../../../common/pipes/zod-validation.pipe';
import { OrdersService } from './orders.service';
import {
  OrdersListQuerySchema,
  OrdersStatsQuerySchema,
  type OrdersListQuery,
  type OrdersStatsQuery,
} from './orders.dto';

@ApiTags('orders')
@ApiBearerAuth()
@Controller('orders')
export class OrdersController {
  constructor(private readonly orders: OrdersService) {}

  @Get()
  @RequirePermission('portfolio.read')
  @UsePipes(new ZodValidationPipe(OrdersListQuerySchema))
  list(@Query() query: OrdersListQuery) {
    return this.orders.list(query);
  }

  @Get('stats')
  @RequirePermission('portfolio.read')
  @UsePipes(new ZodValidationPipe(OrdersStatsQuerySchema))
  stats(@Query() query: OrdersStatsQuery) {
    return this.orders.stats(query);
  }

  @Get(':id')
  @RequirePermission('portfolio.read')
  detail(@Param('id', ParseUUIDPipe) id: string) {
    return this.orders.detail(id);
  }
}
```

Note the route order: `@Get('stats')` MUST be declared before `@Get(':id')` so Nest's route matcher doesn't try to interpret "stats" as a UUID. Verify by re-running the test — if `GET /stats` returns 400 from `ParseUUIDPipe`, the order is wrong.

- [ ] **Step 4: Run, expect pass (5 tests)**

```bash
pnpm vitest run src/modules/portfolio/orders/orders.controller.test.ts
```

- [ ] **Step 5: Commit**

```bash
git add src/modules/portfolio/orders/orders.controller.ts src/modules/portfolio/orders/orders.controller.test.ts
git commit -m "feat(portfolio): OrdersController list/stats/detail with auth guards (TDD)"
```

---

## Task 6: Merchants module (DTO + mappers + service + controller, TDD)

**Files:**
- Create: `src/modules/portfolio/merchants/merchants.dto.ts`
- Create: `src/modules/portfolio/merchants/responses/merchant-summary.mapper.ts`
- Create: `src/modules/portfolio/merchants/responses/merchant-detail.mapper.ts`
- Create: `src/modules/portfolio/merchants/merchants.service.ts`
- Create: `src/modules/portfolio/merchants/merchants.service.test.ts`
- Create: `src/modules/portfolio/merchants/merchants.controller.ts`
- Create: `src/modules/portfolio/merchants/merchants.controller.test.ts`

- [ ] **Step 1: Create `merchants.dto.ts`**

```ts
// src/modules/portfolio/merchants/merchants.dto.ts
import { z } from 'zod';
import { PaginationSchema } from '../../../common/dto/pagination.schema';

export const MerchantsListQuerySchema = PaginationSchema.extend({
  q: z.string().min(1).max(100).optional(),
  sort: z.enum(['name_asc', 'name_desc', 'last_seen_desc']).default('name_asc'),
});

export type MerchantsListQuery = z.infer<typeof MerchantsListQuerySchema>;
```

- [ ] **Step 2: Create mappers**

```ts
// src/modules/portfolio/merchants/responses/merchant-summary.mapper.ts
import type { Decimal } from '@prisma/client/runtime/library';

export type MerchantSummaryRow = {
  id: string;
  rif: string;
  current_name: string;
  first_seen_at: Date;
  last_seen_at: Date;
  _count: { orders: number };
  ordersAggregateAmount: Decimal | null;
};

export function toMerchantSummary(m: MerchantSummaryRow) {
  return {
    id: m.id,
    rif: m.rif,
    current_name: m.current_name,
    first_seen_at: m.first_seen_at.toISOString(),
    last_seen_at: m.last_seen_at.toISOString(),
    order_count: m._count.orders,
    total_orders_amount: (m.ordersAggregateAmount ?? toDecimalZero()).toFixed(4),
  };
}

function toDecimalZero(): { toFixed: (n: number) => string } {
  return { toFixed: () => '0.0000' };
}
```

```ts
// src/modules/portfolio/merchants/responses/merchant-detail.mapper.ts
import { toMerchantSummary, type MerchantSummaryRow } from './merchant-summary.mapper';

export type MerchantDetailRow = MerchantSummaryRow & {
  merchant_name_history: Array<{ id: string; name: string; effective_from: Date; effective_to: Date | null }>;
  ordersByStatus: Record<string, number>;
};

export function toMerchantDetail(m: MerchantDetailRow) {
  const summary = toMerchantSummary(m);
  return {
    ...summary,
    name_history: m.merchant_name_history
      .slice()
      .sort((a, b) => b.effective_from.getTime() - a.effective_from.getTime())
      .map((h) => ({
        id: h.id,
        name: h.name,
        effective_from: h.effective_from.toISOString().slice(0, 10),
        effective_to: h.effective_to?.toISOString().slice(0, 10) ?? null,
      })),
    orders_summary: {
      total_count: summary.order_count,
      total_amount: summary.total_orders_amount,
      by_status: {
        available: m.ordersByStatus.available ?? 0,
        assigned: m.ordersByStatus.assigned ?? 0,
        matured: m.ordersByStatus.matured ?? 0,
        defaulted: m.ordersByStatus.defaulted ?? 0,
      },
    },
  };
}
```

- [ ] **Step 3: Write service test**

```ts
// src/modules/portfolio/merchants/merchants.service.test.ts
import { describe, it, expect, vi } from 'vitest';
import { NotFoundException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { MerchantsService } from './merchants.service';
import { PrismaService } from '../../../prisma/prisma.service';

function makePrisma() {
  return {
    merchant: {
      findMany: vi.fn().mockResolvedValue([]),
      count: vi.fn().mockResolvedValue(0),
      findUnique: vi.fn(),
    },
    order: {
      groupBy: vi.fn().mockResolvedValue([]),
      aggregate: vi.fn().mockResolvedValue({ _sum: { total_amount: null } }),
    },
  } as unknown as PrismaService;
}

describe('MerchantsService.list', () => {
  it('returns paginated mapped merchants with order_count', async () => {
    const prisma = makePrisma();
    (prisma.merchant.findMany as ReturnType<typeof vi.fn>).mockResolvedValueOnce([
      {
        id: 'm-1', rif: 'J-12345678-9', current_name: 'Mercantil',
        first_seen_at: new Date('2026-04-01'), last_seen_at: new Date('2026-05-06'),
        _count: { orders: 1 },
      },
    ]);
    (prisma.merchant.count as ReturnType<typeof vi.fn>).mockResolvedValueOnce(1);
    (prisma.order.aggregate as ReturnType<typeof vi.fn>).mockResolvedValueOnce({ _sum: { total_amount: new Prisma.Decimal('300.00') } });

    const svc = new MerchantsService(prisma);
    const r = await svc.list({ limit: 50, offset: 0, sort: 'name_asc' });
    expect(r.total).toBe(1);
    expect(r.data[0]!.order_count).toBe(1);
    expect(r.data[0]!.total_orders_amount).toBe('300.0000');
  });

  it('passes q-search across current_name and rif (case-insensitive)', async () => {
    const prisma = makePrisma();
    const svc = new MerchantsService(prisma);
    await svc.list({ limit: 50, offset: 0, sort: 'name_asc', q: 'Bodeg' });
    const call = (prisma.merchant.findMany as ReturnType<typeof vi.fn>).mock.calls[0]![0];
    expect(call.where).toEqual({
      OR: [
        { current_name: { contains: 'Bodeg', mode: 'insensitive' } },
        { rif: { contains: 'Bodeg', mode: 'insensitive' } },
      ],
    });
  });
});

describe('MerchantsService.detail', () => {
  it('returns merchant with name_history and orders_summary', async () => {
    const prisma = makePrisma();
    (prisma.merchant.findUnique as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
      id: 'm-1', rif: 'J-12345678-9', current_name: 'Mercantil',
      first_seen_at: new Date('2026-04-01'), last_seen_at: new Date('2026-05-06'),
      _count: { orders: 1 },
      merchant_name_history: [
        { id: 'h-1', name: 'Mercantil', effective_from: new Date('2026-04-01'), effective_to: null },
      ],
    });
    (prisma.order.groupBy as ReturnType<typeof vi.fn>).mockResolvedValueOnce([
      { status: 'available', _count: { _all: 1 } },
    ]);
    (prisma.order.aggregate as ReturnType<typeof vi.fn>).mockResolvedValueOnce({ _sum: { total_amount: new Prisma.Decimal('300.00') } });

    const svc = new MerchantsService(prisma);
    const r = await svc.detail('m-1');
    expect(r.name_history).toHaveLength(1);
    expect(r.orders_summary.by_status.available).toBe(1);
    expect(r.orders_summary.total_amount).toBe('300.0000');
  });

  it('throws NotFoundException when merchant not found', async () => {
    const prisma = makePrisma();
    (prisma.merchant.findUnique as ReturnType<typeof vi.fn>).mockResolvedValueOnce(null);
    const svc = new MerchantsService(prisma);
    await expect(svc.detail('missing')).rejects.toBeInstanceOf(NotFoundException);
  });
});
```

- [ ] **Step 4: Run, expect fail**

```bash
pnpm vitest run src/modules/portfolio/merchants/merchants.service.test.ts
```

- [ ] **Step 5: Implement service**

```ts
// src/modules/portfolio/merchants/merchants.service.ts
import { Injectable, NotFoundException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../../../prisma/prisma.service';
import type { MerchantsListQuery } from './merchants.dto';
import { toMerchantSummary } from './responses/merchant-summary.mapper';
import { toMerchantDetail } from './responses/merchant-detail.mapper';

const SORT_MAP = {
  name_asc: [{ current_name: 'asc' as const }],
  name_desc: [{ current_name: 'desc' as const }],
  last_seen_desc: [{ last_seen_at: 'desc' as const }],
};

@Injectable()
export class MerchantsService {
  constructor(private readonly prisma: PrismaService) {}

  async list(query: MerchantsListQuery) {
    const where: Prisma.MerchantWhereInput = {};
    if (query.q) {
      where.OR = [
        { current_name: { contains: query.q, mode: 'insensitive' } },
        { rif: { contains: query.q, mode: 'insensitive' } },
      ];
    }
    const [rows, total] = await Promise.all([
      this.prisma.merchant.findMany({
        where,
        include: { _count: { select: { orders: true } } },
        orderBy: SORT_MAP[query.sort],
        take: query.limit,
        skip: query.offset,
      }),
      this.prisma.merchant.count({ where }),
    ]);

    const enriched = await Promise.all(
      rows.map(async (m) => {
        const agg = await this.prisma.order.aggregate({
          where: { merchant_id: m.id },
          _sum: { total_amount: true },
        });
        return toMerchantSummary({ ...m, ordersAggregateAmount: agg._sum.total_amount });
      }),
    );
    return { data: enriched, total, limit: query.limit, offset: query.offset };
  }

  async detail(id: string) {
    const m = await this.prisma.merchant.findUnique({
      where: { id },
      include: {
        _count: { select: { orders: true } },
        merchant_name_history: true,
      },
    });
    if (!m) throw new NotFoundException('Comercio no encontrado');

    const [statuses, agg] = await Promise.all([
      this.prisma.order.groupBy({ by: ['status'], where: { merchant_id: id }, _count: { _all: true } }),
      this.prisma.order.aggregate({ where: { merchant_id: id }, _sum: { total_amount: true } }),
    ]);
    const ordersByStatus: Record<string, number> = {};
    for (const s of statuses) ordersByStatus[s.status] = s._count._all;

    return toMerchantDetail({
      ...m,
      ordersAggregateAmount: agg._sum.total_amount,
      ordersByStatus,
    } as never);
  }
}
```

- [ ] **Step 6: Run, expect pass (4 tests)**

```bash
pnpm vitest run src/modules/portfolio/merchants/merchants.service.test.ts
```

- [ ] **Step 7: Write controller test**

```ts
// src/modules/portfolio/merchants/merchants.controller.test.ts
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { Test } from '@nestjs/testing';
import { INestApplication, NotFoundException } from '@nestjs/common';
import { APP_GUARD } from '@nestjs/core';
import { ConfigService } from '@nestjs/config';
import request from 'supertest';
import { MerchantsController } from './merchants.controller';
import { MerchantsService } from './merchants.service';
import { JwtService } from '../../auth/jwt.service';
import { UserLookupService } from '../../auth/user-lookup.service';
import { JwtAuthGuard } from '../../auth/jwt-auth.guard';
import { PermissionsGuard } from '../../auth/permissions.guard';
import { PrismaService } from '../../../prisma/prisma.service';
import { mintTestJwt, TEST_SECRET } from '../../../../test/helpers/jwt.helper';
import { mockAuthUser } from '../../../../test/helpers/auth-user.helper';

describe('MerchantsController', () => {
  let app: INestApplication;
  let svc: { list: ReturnType<typeof vi.fn>; detail: ReturnType<typeof vi.fn> };

  beforeEach(async () => {
    svc = { list: vi.fn(), detail: vi.fn() };
    const config = { get: (k: string) => (k === 'SUPABASE_JWT_SECRET' ? TEST_SECRET : undefined) } as unknown as ConfigService;
    const moduleRef = await Test.createTestingModule({
      controllers: [MerchantsController],
      providers: [
        { provide: MerchantsService, useValue: svc },
        { provide: ConfigService, useValue: config },
        JwtService,
        { provide: UserLookupService, useValue: { findByAuthId: vi.fn().mockResolvedValue({ kind: 'found', user: mockAuthUser({ role: 'operator' }) }) } },
        { provide: PrismaService, useValue: { rolePermission: { findMany: vi.fn().mockResolvedValue([{ permission: { key: 'portfolio.read' } }]) } } },
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

  it('GET /api/merchants → 401 without Authorization', async () => {
    await request(app.getHttpServer()).get('/api/merchants').expect(401);
  });

  it('GET /api/merchants → 200 with list', async () => {
    svc.list.mockResolvedValueOnce({ data: [], total: 0, limit: 50, offset: 0 });
    const token = await mintTestJwt({ sub: 'auth-uuid' });
    const res = await request(app.getHttpServer())
      .get('/api/merchants')
      .set('Authorization', `Bearer ${token}`)
      .expect(200);
    expect(res.body.total).toBe(0);
  });

  it('GET /api/merchants/:id → 404 when service throws', async () => {
    svc.detail.mockRejectedValueOnce(new NotFoundException('Comercio no encontrado'));
    const token = await mintTestJwt({ sub: 'auth-uuid' });
    await request(app.getHttpServer())
      .get('/api/merchants/00000000-0000-4000-8000-000000000099')
      .set('Authorization', `Bearer ${token}`)
      .expect(404);
  });
});
```

- [ ] **Step 8: Implement controller**

```ts
// src/modules/portfolio/merchants/merchants.controller.ts
import { Controller, Get, Param, ParseUUIDPipe, Query, UsePipes } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { RequirePermission } from '../../auth/decorators/require-permission.decorator';
import { ZodValidationPipe } from '../../../common/pipes/zod-validation.pipe';
import { MerchantsService } from './merchants.service';
import { MerchantsListQuerySchema, type MerchantsListQuery } from './merchants.dto';

@ApiTags('merchants')
@ApiBearerAuth()
@Controller('merchants')
export class MerchantsController {
  constructor(private readonly merchants: MerchantsService) {}

  @Get()
  @RequirePermission('portfolio.read')
  @UsePipes(new ZodValidationPipe(MerchantsListQuerySchema))
  list(@Query() query: MerchantsListQuery) {
    return this.merchants.list(query);
  }

  @Get(':id')
  @RequirePermission('portfolio.read')
  detail(@Param('id', ParseUUIDPipe) id: string) {
    return this.merchants.detail(id);
  }
}
```

- [ ] **Step 9: Run, expect pass (3 tests)**

```bash
pnpm vitest run src/modules/portfolio/merchants/merchants.controller.test.ts
```

- [ ] **Step 10: Commit**

```bash
git add src/modules/portfolio/merchants/
git commit -m "feat(portfolio): MerchantsModule (DTO + mappers + service + controller, TDD)"
```

---

## Task 7: End-Users DTOs + mappers

**Files:**
- Create: `src/modules/portfolio/end-users/end-users.dto.ts`
- Create: `src/modules/portfolio/end-users/responses/end-user-summary.mapper.ts`
- Create: `src/modules/portfolio/end-users/responses/end-user-detail.mapper.ts`

- [ ] **Step 1: Create `end-users.dto.ts`**

```ts
// src/modules/portfolio/end-users/end-users.dto.ts
import { z } from 'zod';
import { PaginationSchema } from '../../../common/dto/pagination.schema';

export const EndUsersListQuerySchema = PaginationSchema.extend({
  q: z.string().min(1).max(100).optional(),
  has_national_id: z.coerce.boolean().optional(),
  sort: z.enum(['last_seen_desc', 'first_seen_desc', 'external_hash_asc']).default('last_seen_desc'),
});

export const EndUserUpdateSchema = z
  .object({
    full_name: z.string().min(1).max(255).nullable().optional(),
    national_id: z.string().min(1).max(255).nullable().optional(),
    email: z.string().email().max(255).nullable().optional(),
    phone: z.string().min(1).max(255).nullable().optional(),
  })
  .refine((d) => Object.keys(d).length > 0, { message: 'Al menos un campo debe ser provisto' });

export type EndUsersListQuery = z.infer<typeof EndUsersListQuerySchema>;
export type EndUserUpdate = z.infer<typeof EndUserUpdateSchema>;
```

- [ ] **Step 2: Create mappers**

```ts
// src/modules/portfolio/end-users/responses/end-user-summary.mapper.ts
export type EndUserSummaryRow = {
  id: string;
  external_hash: string;
  full_name: string | null;
  national_id: string | null;
  email: string | null;
  phone: string | null;
  enriched_at: Date | null;
  first_seen_at: Date;
  last_seen_at: Date;
  _count: { orders: number };
};

export function toEndUserSummary(u: EndUserSummaryRow) {
  return {
    id: u.id,
    external_hash: u.external_hash,
    full_name: u.full_name,
    national_id: u.national_id,
    email: u.email,
    phone: u.phone,
    enriched_at: u.enriched_at?.toISOString() ?? null,
    first_seen_at: u.first_seen_at.toISOString(),
    last_seen_at: u.last_seen_at.toISOString(),
    order_count: u._count.orders,
  };
}
```

```ts
// src/modules/portfolio/end-users/responses/end-user-detail.mapper.ts
import { toEndUserSummary, type EndUserSummaryRow } from './end-user-summary.mapper';

export type EndUserDetailRow = EndUserSummaryRow & {
  ordersTotalAmount: string;
  ordersByStatus: Record<string, number>;
};

export function toEndUserDetail(u: EndUserDetailRow) {
  const summary = toEndUserSummary(u);
  return {
    ...summary,
    orders_summary: {
      total_count: summary.order_count,
      total_amount: u.ordersTotalAmount,
      by_status: {
        available: u.ordersByStatus.available ?? 0,
        assigned: u.ordersByStatus.assigned ?? 0,
        matured: u.ordersByStatus.matured ?? 0,
        defaulted: u.ordersByStatus.defaulted ?? 0,
      },
    },
  };
}
```

- [ ] **Step 3: TS check**

```bash
pnpm exec tsc --noEmit
```

- [ ] **Step 4: Commit**

```bash
git add src/modules/portfolio/end-users/end-users.dto.ts src/modules/portfolio/end-users/responses/
git commit -m "feat(portfolio): end-users DTOs (list query + update body) + mappers"
```

---

## Task 8: EndUsersService (TDD, includes update + audit)

**Files:**
- Create: `src/modules/portfolio/end-users/end-users.service.ts`
- Create: `src/modules/portfolio/end-users/end-users.service.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
// src/modules/portfolio/end-users/end-users.service.test.ts
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { NotFoundException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { EndUsersService } from './end-users.service';
import { PrismaService } from '../../../prisma/prisma.service';
import { AuditService } from '../../audit/audit.service';

function fakeUser(overrides: Record<string, unknown> = {}) {
  return {
    id: 'u-1',
    external_hash: 'smoke-user-1',
    full_name: null as string | null,
    national_id: null as string | null,
    email: null as string | null,
    phone: null as string | null,
    enriched_at: null as Date | null,
    first_seen_at: new Date('2026-04-01'),
    last_seen_at: new Date('2026-05-06'),
    _count: { orders: 1 },
    ...overrides,
  };
}

function makePrismaWithTx(tx: unknown) {
  return {
    $transaction: vi.fn(async (cb: (t: unknown) => Promise<unknown>) => cb(tx)),
    endUser: {
      findMany: vi.fn().mockResolvedValue([]),
      count: vi.fn().mockResolvedValue(0),
      findUnique: vi.fn(),
    },
    order: {
      groupBy: vi.fn().mockResolvedValue([]),
      aggregate: vi.fn().mockResolvedValue({ _sum: { total_amount: null } }),
    },
  };
}

function makeAudit() {
  return { recordChange: vi.fn().mockResolvedValue(undefined) } as unknown as AuditService;
}

describe('EndUsersService.list', () => {
  it('returns paginated mapped users', async () => {
    const tx = {};
    const prisma = makePrismaWithTx(tx);
    (prisma.endUser.findMany as ReturnType<typeof vi.fn>).mockResolvedValueOnce([fakeUser()]);
    (prisma.endUser.count as ReturnType<typeof vi.fn>).mockResolvedValueOnce(1);
    const svc = new EndUsersService(prisma as unknown as PrismaService, makeAudit());
    const r = await svc.list({ limit: 50, offset: 0, sort: 'last_seen_desc' });
    expect(r.total).toBe(1);
    expect(r.data[0]!.external_hash).toBe('smoke-user-1');
  });

  it('passes q-search across the 5 textual fields', async () => {
    const prisma = makePrismaWithTx({});
    const svc = new EndUsersService(prisma as unknown as PrismaService, makeAudit());
    await svc.list({ limit: 50, offset: 0, sort: 'last_seen_desc', q: 'pedro' });
    const call = (prisma.endUser.findMany as ReturnType<typeof vi.fn>).mock.calls[0]![0];
    expect(call.where.OR).toEqual([
      { external_hash: { contains: 'pedro', mode: 'insensitive' } },
      { full_name: { contains: 'pedro', mode: 'insensitive' } },
      { national_id: { contains: 'pedro', mode: 'insensitive' } },
      { email: { contains: 'pedro', mode: 'insensitive' } },
      { phone: { contains: 'pedro', mode: 'insensitive' } },
    ]);
  });

  it('filters by has_national_id=true', async () => {
    const prisma = makePrismaWithTx({});
    const svc = new EndUsersService(prisma as unknown as PrismaService, makeAudit());
    await svc.list({ limit: 50, offset: 0, sort: 'last_seen_desc', has_national_id: true });
    const call = (prisma.endUser.findMany as ReturnType<typeof vi.fn>).mock.calls[0]![0];
    expect(call.where.national_id).toEqual({ not: null });
  });
});

describe('EndUsersService.detail', () => {
  it('returns user with orders_summary', async () => {
    const tx = { endUser: { findUnique: vi.fn() }, order: { groupBy: vi.fn(), aggregate: vi.fn() } };
    const prisma = makePrismaWithTx(tx);
    (prisma.endUser.findUnique as ReturnType<typeof vi.fn>).mockResolvedValueOnce(fakeUser());
    (prisma.order.groupBy as ReturnType<typeof vi.fn>).mockResolvedValueOnce([{ status: 'available', _count: { _all: 1 } }]);
    (prisma.order.aggregate as ReturnType<typeof vi.fn>).mockResolvedValueOnce({ _sum: { total_amount: new Prisma.Decimal('300.00') } });
    const svc = new EndUsersService(prisma as unknown as PrismaService, makeAudit());
    const r = await svc.detail('u-1');
    expect(r.orders_summary.total_amount).toBe('300.0000');
    expect(r.orders_summary.by_status.available).toBe(1);
  });

  it('throws NotFoundException when not found', async () => {
    const prisma = makePrismaWithTx({});
    (prisma.endUser.findUnique as ReturnType<typeof vi.fn>).mockResolvedValueOnce(null);
    const svc = new EndUsersService(prisma as unknown as PrismaService, makeAudit());
    await expect(svc.detail('missing')).rejects.toBeInstanceOf(NotFoundException);
  });
});

describe('EndUsersService.update', () => {
  it('throws 404 when end_user missing', async () => {
    const tx = {
      endUser: { findUnique: vi.fn().mockResolvedValueOnce(null), update: vi.fn() },
      order: { groupBy: vi.fn().mockResolvedValue([]), aggregate: vi.fn().mockResolvedValue({ _sum: { total_amount: null } }) },
    };
    const prisma = makePrismaWithTx(tx);
    const audit = makeAudit();
    const svc = new EndUsersService(prisma as unknown as PrismaService, audit);
    await expect(
      svc.update({ id: 'missing', patch: { email: 'x@y.com' }, actorId: 'a-1' }),
    ).rejects.toBeInstanceOf(NotFoundException);
  });

  it('updates fields, sets enriched_at, records audit row with diff', async () => {
    const before = fakeUser({ email: null, full_name: null });
    const after = fakeUser({ email: 'x@y.com', full_name: 'Pedro', enriched_at: new Date() });
    const tx = {
      endUser: {
        findUnique: vi.fn().mockResolvedValueOnce(before),
        update: vi.fn().mockResolvedValueOnce(after),
      },
      order: {
        groupBy: vi.fn().mockResolvedValue([]),
        aggregate: vi.fn().mockResolvedValue({ _sum: { total_amount: null } }),
      },
    };
    const prisma = makePrismaWithTx(tx);
    const audit = makeAudit();
    const svc = new EndUsersService(prisma as unknown as PrismaService, audit);

    const r = await svc.update({
      id: 'u-1',
      patch: { email: 'x@y.com', full_name: 'Pedro' },
      actorId: 'a-1',
    });

    expect(tx.endUser.update).toHaveBeenCalledOnce();
    const updateCall = (tx.endUser.update as ReturnType<typeof vi.fn>).mock.calls[0]![0];
    expect(updateCall.data.email).toBe('x@y.com');
    expect(updateCall.data.full_name).toBe('Pedro');
    expect(updateCall.data.enriched_at).toBeInstanceOf(Date);

    expect(audit.recordChange).toHaveBeenCalledOnce();
    const auditCall = (audit.recordChange as ReturnType<typeof vi.fn>).mock.calls[0]![0];
    expect(auditCall.entityType).toBe('end_user');
    expect(auditCall.entityId).toBe('u-1');
    expect(auditCall.action).toBe('update');
    expect(auditCall.payload.before).toEqual({ email: null, full_name: null });
    expect(auditCall.payload.after).toEqual({ email: 'x@y.com', full_name: 'Pedro' });
    expect(r.email).toBe('x@y.com');
  });

  it('is no-op when patch matches current values: no update, no audit', async () => {
    const before = fakeUser({ email: 'x@y.com' });
    const tx = {
      endUser: { findUnique: vi.fn().mockResolvedValueOnce(before), update: vi.fn() },
      order: { groupBy: vi.fn().mockResolvedValue([]), aggregate: vi.fn().mockResolvedValue({ _sum: { total_amount: null } }) },
    };
    const prisma = makePrismaWithTx(tx);
    const audit = makeAudit();
    const svc = new EndUsersService(prisma as unknown as PrismaService, audit);
    await svc.update({ id: 'u-1', patch: { email: 'x@y.com' }, actorId: 'a-1' });
    expect(tx.endUser.update).not.toHaveBeenCalled();
    expect(audit.recordChange).not.toHaveBeenCalled();
  });

  it('clears a field when patch sends null', async () => {
    const before = fakeUser({ email: 'old@y.com' });
    const after = fakeUser({ email: null });
    const tx = {
      endUser: {
        findUnique: vi.fn().mockResolvedValueOnce(before),
        update: vi.fn().mockResolvedValueOnce(after),
      },
      order: { groupBy: vi.fn().mockResolvedValue([]), aggregate: vi.fn().mockResolvedValue({ _sum: { total_amount: null } }) },
    };
    const prisma = makePrismaWithTx(tx);
    const audit = makeAudit();
    const svc = new EndUsersService(prisma as unknown as PrismaService, audit);
    await svc.update({ id: 'u-1', patch: { email: null }, actorId: 'a-1' });
    const updateCall = (tx.endUser.update as ReturnType<typeof vi.fn>).mock.calls[0]![0];
    expect(updateCall.data.email).toBeNull();
  });
});
```

- [ ] **Step 2: Run, expect fail**

```bash
pnpm vitest run src/modules/portfolio/end-users/end-users.service.test.ts
```

- [ ] **Step 3: Implement service**

```ts
// src/modules/portfolio/end-users/end-users.service.ts
import { Injectable, NotFoundException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../../../prisma/prisma.service';
import { AuditService } from '../../audit/audit.service';
import type { EndUsersListQuery, EndUserUpdate } from './end-users.dto';
import { toEndUserSummary } from './responses/end-user-summary.mapper';
import { toEndUserDetail } from './responses/end-user-detail.mapper';

const SORT_MAP = {
  last_seen_desc: [{ last_seen_at: 'desc' as const }],
  first_seen_desc: [{ first_seen_at: 'desc' as const }],
  external_hash_asc: [{ external_hash: 'asc' as const }],
};

const EDITABLE = ['full_name', 'national_id', 'email', 'phone'] as const;

@Injectable()
export class EndUsersService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
  ) {}

  async list(query: EndUsersListQuery) {
    const where: Prisma.EndUserWhereInput = {};
    if (query.q) {
      where.OR = [
        { external_hash: { contains: query.q, mode: 'insensitive' } },
        { full_name: { contains: query.q, mode: 'insensitive' } },
        { national_id: { contains: query.q, mode: 'insensitive' } },
        { email: { contains: query.q, mode: 'insensitive' } },
        { phone: { contains: query.q, mode: 'insensitive' } },
      ];
    }
    if (query.has_national_id !== undefined) {
      where.national_id = query.has_national_id ? { not: null } : null;
    }
    const [rows, total] = await Promise.all([
      this.prisma.endUser.findMany({
        where,
        include: { _count: { select: { orders: true } } },
        orderBy: SORT_MAP[query.sort],
        take: query.limit,
        skip: query.offset,
      }),
      this.prisma.endUser.count({ where }),
    ]);
    return {
      data: rows.map((r) => toEndUserSummary(r as never)),
      total,
      limit: query.limit,
      offset: query.offset,
    };
  }

  async detail(id: string) {
    return await this.prisma.$transaction(async (tx) => this.detailIn(tx, id));
  }

  async update(opts: { id: string; patch: EndUserUpdate; actorId: string }) {
    return await this.prisma.$transaction(async (tx) => {
      const before = await tx.endUser.findUnique({
        where: { id: opts.id },
        include: { _count: { select: { orders: true } } },
      });
      if (!before) throw new NotFoundException('End user no encontrado');

      const diff: Record<string, string | null> = {};
      for (const k of EDITABLE) {
        if (k in opts.patch) {
          const next = opts.patch[k] ?? null;
          if (next !== (before as Record<string, unknown>)[k]) {
            diff[k] = next;
          }
        }
      }
      if (Object.keys(diff).length === 0) {
        return await this.detailIn(tx, opts.id);
      }

      const updated = await tx.endUser.update({
        where: { id: opts.id },
        data: { ...diff, enriched_at: new Date() },
        include: { _count: { select: { orders: true } } },
      });

      const beforeSlice: Record<string, unknown> = {};
      const afterSlice: Record<string, unknown> = {};
      for (const k of Object.keys(diff)) {
        beforeSlice[k] = (before as Record<string, unknown>)[k];
        afterSlice[k] = (updated as Record<string, unknown>)[k];
      }

      await this.audit.recordChange({
        entityType: 'end_user',
        entityId: opts.id,
        action: 'update',
        actorId: opts.actorId,
        payload: { before: beforeSlice, after: afterSlice },
        tx,
      });

      return await this.detailIn(tx, opts.id);
    });
  }

  private async detailIn(tx: Prisma.TransactionClient, id: string) {
    const u = await tx.endUser.findUnique({
      where: { id },
      include: { _count: { select: { orders: true } } },
    });
    if (!u) throw new NotFoundException('End user no encontrado');

    const [statuses, agg] = await Promise.all([
      tx.order.groupBy({ by: ['status'], where: { end_user_id: id }, _count: { _all: true } }),
      tx.order.aggregate({ where: { end_user_id: id }, _sum: { total_amount: true } }),
    ]);
    const ordersByStatus: Record<string, number> = {};
    for (const s of statuses) ordersByStatus[s.status] = s._count._all;
    const ordersTotalAmount = (agg._sum.total_amount ?? new Prisma.Decimal(0)).toFixed(4);

    return toEndUserDetail({ ...u, ordersByStatus, ordersTotalAmount } as never);
  }
}
```

- [ ] **Step 4: Run, expect pass (8 tests)**

```bash
pnpm vitest run src/modules/portfolio/end-users/end-users.service.test.ts
```

- [ ] **Step 5: TS check**

```bash
pnpm exec tsc --noEmit
```

- [ ] **Step 6: Commit**

```bash
git add src/modules/portfolio/end-users/end-users.service.ts src/modules/portfolio/end-users/end-users.service.test.ts
git commit -m "feat(portfolio): EndUsersService list/detail/update with audit (TDD)"
```

---

## Task 9: EndUsersController (TDD with PATCH integration)

**Files:**
- Create: `src/modules/portfolio/end-users/end-users.controller.ts`
- Create: `src/modules/portfolio/end-users/end-users.controller.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
// src/modules/portfolio/end-users/end-users.controller.test.ts
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { Test } from '@nestjs/testing';
import { INestApplication, NotFoundException } from '@nestjs/common';
import { APP_GUARD } from '@nestjs/core';
import { ConfigService } from '@nestjs/config';
import request from 'supertest';
import { EndUsersController } from './end-users.controller';
import { EndUsersService } from './end-users.service';
import { JwtService } from '../../auth/jwt.service';
import { UserLookupService } from '../../auth/user-lookup.service';
import { JwtAuthGuard } from '../../auth/jwt-auth.guard';
import { PermissionsGuard } from '../../auth/permissions.guard';
import { PrismaService } from '../../../prisma/prisma.service';
import { mintTestJwt, TEST_SECRET } from '../../../../test/helpers/jwt.helper';
import { mockAuthUser } from '../../../../test/helpers/auth-user.helper';

describe('EndUsersController', () => {
  let app: INestApplication;
  let svc: { list: ReturnType<typeof vi.fn>; detail: ReturnType<typeof vi.fn>; update: ReturnType<typeof vi.fn> };
  let prismaPerms: ReturnType<typeof vi.fn>;

  beforeEach(async () => {
    svc = { list: vi.fn(), detail: vi.fn(), update: vi.fn() };
    prismaPerms = vi.fn().mockResolvedValue([
      { permission: { key: 'portfolio.read' } },
      { permission: { key: 'portfolio.write' } },
    ]);
    const config = { get: (k: string) => (k === 'SUPABASE_JWT_SECRET' ? TEST_SECRET : undefined) } as unknown as ConfigService;
    const moduleRef = await Test.createTestingModule({
      controllers: [EndUsersController],
      providers: [
        { provide: EndUsersService, useValue: svc },
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

  it('GET /api/end-users → 401 without Authorization', async () => {
    await request(app.getHttpServer()).get('/api/end-users').expect(401);
  });

  it('GET /api/end-users → 200 with empty list', async () => {
    svc.list.mockResolvedValueOnce({ data: [], total: 0, limit: 50, offset: 0 });
    const token = await mintTestJwt({ sub: 'auth-uuid' });
    await request(app.getHttpServer())
      .get('/api/end-users')
      .set('Authorization', `Bearer ${token}`)
      .expect(200);
  });

  it('PATCH /api/end-users/:id → 401 without Authorization', async () => {
    await request(app.getHttpServer())
      .patch('/api/end-users/00000000-0000-4000-8000-000000000001')
      .send({ email: 'x@y.com' })
      .expect(401);
  });

  it('PATCH /api/end-users/:id → 403 when role lacks portfolio.write', async () => {
    prismaPerms.mockResolvedValueOnce([{ permission: { key: 'portfolio.read' } }]);
    const token = await mintTestJwt({ sub: 'auth-uuid' });
    await request(app.getHttpServer())
      .patch('/api/end-users/00000000-0000-4000-8000-000000000001')
      .set('Authorization', `Bearer ${token}`)
      .send({ email: 'x@y.com' })
      .expect(403);
  });

  it('PATCH /api/end-users/:id → 400 when email is malformed', async () => {
    const token = await mintTestJwt({ sub: 'auth-uuid' });
    await request(app.getHttpServer())
      .patch('/api/end-users/00000000-0000-4000-8000-000000000001')
      .set('Authorization', `Bearer ${token}`)
      .send({ email: 'not-an-email' })
      .expect(400);
  });

  it('PATCH /api/end-users/:id → 200 happy path', async () => {
    svc.update.mockResolvedValueOnce({
      id: '00000000-0000-4000-8000-000000000001',
      external_hash: 'h',
      full_name: 'Pedro',
      national_id: 'V-12345678',
      email: 'pedro@cashea.app',
      phone: null,
      enriched_at: new Date().toISOString(),
      first_seen_at: new Date().toISOString(),
      last_seen_at: new Date().toISOString(),
      order_count: 1,
      orders_summary: { total_count: 1, total_amount: '300.0000', by_status: { available: 1, assigned: 0, matured: 0, defaulted: 0 } },
    });
    const token = await mintTestJwt({ sub: 'auth-uuid' });
    const res = await request(app.getHttpServer())
      .patch('/api/end-users/00000000-0000-4000-8000-000000000001')
      .set('Authorization', `Bearer ${token}`)
      .send({ full_name: 'Pedro', email: 'pedro@cashea.app' })
      .expect(200);
    expect(res.body.full_name).toBe('Pedro');
    expect(res.body.email).toBe('pedro@cashea.app');
  });
});
```

- [ ] **Step 2: Run, expect fail**

```bash
pnpm vitest run src/modules/portfolio/end-users/end-users.controller.test.ts
```

- [ ] **Step 3: Implement controller**

```ts
// src/modules/portfolio/end-users/end-users.controller.ts
import { Body, Controller, Get, HttpCode, HttpStatus, Param, ParseUUIDPipe, Patch, Query, UsePipes } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { CurrentUser } from '../../auth/decorators/current-user.decorator';
import { RequirePermission } from '../../auth/decorators/require-permission.decorator';
import type { AuthUser } from '../../auth/types';
import { ZodValidationPipe } from '../../../common/pipes/zod-validation.pipe';
import { EndUsersService } from './end-users.service';
import {
  EndUsersListQuerySchema,
  EndUserUpdateSchema,
  type EndUsersListQuery,
  type EndUserUpdate,
} from './end-users.dto';

@ApiTags('end-users')
@ApiBearerAuth()
@Controller('end-users')
export class EndUsersController {
  constructor(private readonly endUsers: EndUsersService) {}

  @Get()
  @RequirePermission('portfolio.read')
  @UsePipes(new ZodValidationPipe(EndUsersListQuerySchema))
  list(@Query() query: EndUsersListQuery) {
    return this.endUsers.list(query);
  }

  @Get(':id')
  @RequirePermission('portfolio.read')
  detail(@Param('id', ParseUUIDPipe) id: string) {
    return this.endUsers.detail(id);
  }

  @Patch(':id')
  @HttpCode(HttpStatus.OK)
  @RequirePermission('portfolio.write')
  update(
    @Param('id', ParseUUIDPipe) id: string,
    @Body(new ZodValidationPipe(EndUserUpdateSchema)) body: EndUserUpdate,
    @CurrentUser() user: AuthUser,
  ) {
    return this.endUsers.update({ id, patch: body, actorId: user.id });
  }
}
```

- [ ] **Step 4: Run, expect pass (6 tests)**

```bash
pnpm vitest run src/modules/portfolio/end-users/end-users.controller.test.ts
```

- [ ] **Step 5: Commit**

```bash
git add src/modules/portfolio/end-users/end-users.controller.ts src/modules/portfolio/end-users/end-users.controller.test.ts
git commit -m "feat(portfolio): EndUsersController list/detail/PATCH with audit (TDD)"
```

---

## Task 10: Installments module (DTO + mapper + service + controller, TDD)

**Files:**
- Create: `src/modules/portfolio/installments/installments.dto.ts`
- Create: `src/modules/portfolio/installments/responses/installment-summary.mapper.ts`
- Create: `src/modules/portfolio/installments/installments.service.ts`
- Create: `src/modules/portfolio/installments/installments.service.test.ts`
- Create: `src/modules/portfolio/installments/installments.controller.ts`
- Create: `src/modules/portfolio/installments/installments.controller.test.ts`

- [ ] **Step 1: Create DTO**

```ts
// src/modules/portfolio/installments/installments.dto.ts
import { z } from 'zod';
import { PaginationSchema } from '../../../common/dto/pagination.schema';

export const InstallmentsListQuerySchema = PaginationSchema.extend({
  status: z.enum(['pending', 'due', 'paid', 'overdue']).optional(),
  order_id: z.string().uuid().optional(),
  due_date_from: z.coerce.date().optional(),
  due_date_to: z.coerce.date().optional(),
  sort: z.enum(['due_date_asc', 'due_date_desc', 'amount_desc']).default('due_date_asc'),
});

export type InstallmentsListQuery = z.infer<typeof InstallmentsListQuerySchema>;
```

- [ ] **Step 2: Create mapper**

```ts
// src/modules/portfolio/installments/responses/installment-summary.mapper.ts
import type { Decimal } from '@prisma/client/runtime/library';

export type InstallmentSummaryRow = {
  id: string;
  external_installment_id: string;
  order_id: string;
  installment_number: number;
  amount: Decimal;
  due_date: Date;
  status: string;
  paid_amount: Decimal | null;
  order: {
    external_order_id: string;
    merchant: { current_name: string; rif: string };
  };
};

export function toInstallmentSummary(i: InstallmentSummaryRow) {
  return {
    id: i.id,
    external_installment_id: i.external_installment_id,
    order_id: i.order_id,
    installment_number: i.installment_number,
    amount: i.amount.toFixed(4),
    due_date: i.due_date.toISOString().slice(0, 10),
    status: i.status,
    paid_amount: i.paid_amount?.toFixed(4) ?? null,
    order: {
      external_order_id: i.order.external_order_id,
      merchant: { current_name: i.order.merchant.current_name, rif: i.order.merchant.rif },
    },
  };
}
```

- [ ] **Step 3: Write service test**

```ts
// src/modules/portfolio/installments/installments.service.test.ts
import { describe, it, expect, vi } from 'vitest';
import { Prisma } from '@prisma/client';
import { InstallmentsService } from './installments.service';
import { PrismaService } from '../../../prisma/prisma.service';

function makePrisma() {
  return {
    installment: {
      findMany: vi.fn().mockResolvedValue([]),
      count: vi.fn().mockResolvedValue(0),
    },
  } as unknown as PrismaService;
}

describe('InstallmentsService.list', () => {
  it('returns paginated mapped installments', async () => {
    const prisma = makePrisma();
    (prisma.installment.findMany as ReturnType<typeof vi.fn>).mockResolvedValueOnce([
      {
        id: 'i-1',
        external_installment_id: 'I-1',
        order_id: 'o-1',
        installment_number: 1,
        amount: new Prisma.Decimal('75.00'),
        due_date: new Date('2026-04-15'),
        status: 'pending',
        paid_amount: null,
        order: { external_order_id: 'ORD-1', merchant: { current_name: 'Mercantil', rif: 'J-1' } },
      },
    ]);
    (prisma.installment.count as ReturnType<typeof vi.fn>).mockResolvedValueOnce(1);
    const svc = new InstallmentsService(prisma);
    const r = await svc.list({ limit: 50, offset: 0, sort: 'due_date_asc' });
    expect(r.total).toBe(1);
    expect(r.data[0]!.amount).toBe('75.0000');
    expect(r.data[0]!.order.external_order_id).toBe('ORD-1');
  });

  it('passes status + due_date range filters', async () => {
    const prisma = makePrisma();
    const svc = new InstallmentsService(prisma);
    await svc.list({
      limit: 50, offset: 0, sort: 'due_date_asc',
      status: 'pending',
      due_date_from: new Date('2026-04-01'),
      due_date_to: new Date('2026-05-01'),
    });
    const call = (prisma.installment.findMany as ReturnType<typeof vi.fn>).mock.calls[0]![0];
    expect(call.where).toEqual({
      status: 'pending',
      due_date: { gte: new Date('2026-04-01'), lte: new Date('2026-05-01') },
    });
  });

  it('honors amount_desc sort', async () => {
    const prisma = makePrisma();
    const svc = new InstallmentsService(prisma);
    await svc.list({ limit: 50, offset: 0, sort: 'amount_desc' });
    const call = (prisma.installment.findMany as ReturnType<typeof vi.fn>).mock.calls[0]![0];
    expect(call.orderBy).toEqual([{ amount: 'desc' }]);
  });
});
```

- [ ] **Step 4: Run, expect fail**

```bash
pnpm vitest run src/modules/portfolio/installments/installments.service.test.ts
```

- [ ] **Step 5: Implement service**

```ts
// src/modules/portfolio/installments/installments.service.ts
import { Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../../../prisma/prisma.service';
import type { InstallmentsListQuery } from './installments.dto';
import { toInstallmentSummary } from './responses/installment-summary.mapper';

const SORT_MAP = {
  due_date_asc: [{ due_date: 'asc' as const }],
  due_date_desc: [{ due_date: 'desc' as const }],
  amount_desc: [{ amount: 'desc' as const }],
};

@Injectable()
export class InstallmentsService {
  constructor(private readonly prisma: PrismaService) {}

  async list(query: InstallmentsListQuery) {
    const where: Prisma.InstallmentWhereInput = {};
    if (query.status) where.status = query.status;
    if (query.order_id) where.order_id = query.order_id;
    if (query.due_date_from || query.due_date_to) {
      where.due_date = {};
      if (query.due_date_from) (where.due_date as Record<string, Date>).gte = query.due_date_from;
      if (query.due_date_to) (where.due_date as Record<string, Date>).lte = query.due_date_to;
    }
    const [rows, total] = await Promise.all([
      this.prisma.installment.findMany({
        where,
        include: { order: { include: { merchant: true } } },
        orderBy: SORT_MAP[query.sort],
        take: query.limit,
        skip: query.offset,
      }),
      this.prisma.installment.count({ where }),
    ]);
    return {
      data: rows.map((r) => toInstallmentSummary(r as never)),
      total,
      limit: query.limit,
      offset: query.offset,
    };
  }
}
```

- [ ] **Step 6: Run, expect pass (3 tests)**

```bash
pnpm vitest run src/modules/portfolio/installments/installments.service.test.ts
```

- [ ] **Step 7: Write controller test**

```ts
// src/modules/portfolio/installments/installments.controller.test.ts
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { Test } from '@nestjs/testing';
import { INestApplication } from '@nestjs/common';
import { APP_GUARD } from '@nestjs/core';
import { ConfigService } from '@nestjs/config';
import request from 'supertest';
import { InstallmentsController } from './installments.controller';
import { InstallmentsService } from './installments.service';
import { JwtService } from '../../auth/jwt.service';
import { UserLookupService } from '../../auth/user-lookup.service';
import { JwtAuthGuard } from '../../auth/jwt-auth.guard';
import { PermissionsGuard } from '../../auth/permissions.guard';
import { PrismaService } from '../../../prisma/prisma.service';
import { mintTestJwt, TEST_SECRET } from '../../../../test/helpers/jwt.helper';
import { mockAuthUser } from '../../../../test/helpers/auth-user.helper';

describe('InstallmentsController', () => {
  let app: INestApplication;
  let svc: { list: ReturnType<typeof vi.fn> };

  beforeEach(async () => {
    svc = { list: vi.fn() };
    const config = { get: (k: string) => (k === 'SUPABASE_JWT_SECRET' ? TEST_SECRET : undefined) } as unknown as ConfigService;
    const moduleRef = await Test.createTestingModule({
      controllers: [InstallmentsController],
      providers: [
        { provide: InstallmentsService, useValue: svc },
        { provide: ConfigService, useValue: config },
        JwtService,
        { provide: UserLookupService, useValue: { findByAuthId: vi.fn().mockResolvedValue({ kind: 'found', user: mockAuthUser({ role: 'operator' }) }) } },
        { provide: PrismaService, useValue: { rolePermission: { findMany: vi.fn().mockResolvedValue([{ permission: { key: 'portfolio.read' } }]) } } },
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

  it('GET /api/installments → 401 without Authorization', async () => {
    await request(app.getHttpServer()).get('/api/installments').expect(401);
  });

  it('GET /api/installments → 200 with empty list', async () => {
    svc.list.mockResolvedValueOnce({ data: [], total: 0, limit: 50, offset: 0 });
    const token = await mintTestJwt({ sub: 'auth-uuid' });
    await request(app.getHttpServer())
      .get('/api/installments?status=pending')
      .set('Authorization', `Bearer ${token}`)
      .expect(200);
  });
});
```

- [ ] **Step 8: Implement controller**

```ts
// src/modules/portfolio/installments/installments.controller.ts
import { Controller, Get, Query, UsePipes } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { RequirePermission } from '../../auth/decorators/require-permission.decorator';
import { ZodValidationPipe } from '../../../common/pipes/zod-validation.pipe';
import { InstallmentsService } from './installments.service';
import { InstallmentsListQuerySchema, type InstallmentsListQuery } from './installments.dto';

@ApiTags('installments')
@ApiBearerAuth()
@Controller('installments')
export class InstallmentsController {
  constructor(private readonly installments: InstallmentsService) {}

  @Get()
  @RequirePermission('portfolio.read')
  @UsePipes(new ZodValidationPipe(InstallmentsListQuerySchema))
  list(@Query() query: InstallmentsListQuery) {
    return this.installments.list(query);
  }
}
```

- [ ] **Step 9: Run, expect pass (2 tests)**

```bash
pnpm vitest run src/modules/portfolio/installments/installments.controller.test.ts
```

- [ ] **Step 10: Commit**

```bash
git add src/modules/portfolio/installments/
git commit -m "feat(portfolio): InstallmentsModule (list with filters, TDD)"
```

---

## Task 11: PortfolioModule + AppModule wiring + smoke + openapi.json

**Files:**
- Create: `src/modules/portfolio/portfolio.module.ts`
- Modify: `src/app.module.ts`
- Generate + Force-add: `openapi.json`

- [ ] **Step 1: Create PortfolioModule**

```ts
// src/modules/portfolio/portfolio.module.ts
import { Module } from '@nestjs/common';
import { OrdersController } from './orders/orders.controller';
import { OrdersService } from './orders/orders.service';
import { MerchantsController } from './merchants/merchants.controller';
import { MerchantsService } from './merchants/merchants.service';
import { EndUsersController } from './end-users/end-users.controller';
import { EndUsersService } from './end-users/end-users.service';
import { InstallmentsController } from './installments/installments.controller';
import { InstallmentsService } from './installments/installments.service';

@Module({
  controllers: [OrdersController, MerchantsController, EndUsersController, InstallmentsController],
  providers: [OrdersService, MerchantsService, EndUsersService, InstallmentsService],
})
export class PortfolioModule {}
```

- [ ] **Step 2: Wire AppModule**

Read current `src/app.module.ts`. Add imports for `AuditModule` and `PortfolioModule`, and append both to the `imports` array (Audit first because @Global must load before consumers, then Portfolio):

```ts
import { AuditModule } from './modules/audit/audit.module';
import { PortfolioModule } from './modules/portfolio/portfolio.module';

// imports array:
imports: [
  ConfigModule.forRoot({ isGlobal: true, validate: validateEnv }),
  LoggerModule,
  PrismaModule,
  AuditModule,                              // ← @Global, before consumers
  AuthModule,
  HealthModule,
  MeModule,
  BatchesModule,
  PortfolioModule,                          // ← new
],
```

- [ ] **Step 3: Verify TS + full test suite green**

```bash
pnpm exec tsc --noEmit && pnpm test 2>&1 | tail -8
```

Expected: zero TS errors, 91 (Slices 0-2) + ~42 new = ~133 tests passing.

- [ ] **Step 4: Commit module wiring**

```bash
git add src/modules/portfolio/portfolio.module.ts src/app.module.ts
git commit -m "feat(portfolio): wire PortfolioModule + @Global AuditModule into AppModule"
```

- [ ] **Step 5: Smoke test against real Supabase**

Boot dev server:

```bash
lsof -ti:3001 | xargs -r kill -9 2>/dev/null; sleep 1
pnpm dev > /tmp/araguaney-dev.log 2>&1 &
DEV_PID=$!
sleep 7
```

The smoke user from Slice 2 (auth_user_id `4bba7f81-443c-47b2-9bec-bc5a502380cc`, cfb.users.id `05c4eebb-0eee-460a-bc8c-a1f876d5a6d0`) should still be in DB. Mint a JWT for that auth user and exercise the new endpoints. Use a small inline script (move into project dir for `node_modules` resolution):

```bash
cat > scripts/smoke-slice3.ts <<'TSEOF'
import 'dotenv/config';
import { SignJWT } from 'jose';
import { request as httpRequest } from 'node:http';
import { URL } from 'node:url';

const BASE = 'http://localhost:3001';
const SUB = '4bba7f81-443c-47b2-9bec-bc5a502380cc';

async function token(): Promise<string> {
  const secret = new TextEncoder().encode(process.env.SUPABASE_JWT_SECRET!);
  return await new SignJWT({ sub: SUB }).setProtectedHeader({ alg: 'HS256' }).setIssuedAt().setExpirationTime(Math.floor(Date.now()/1000)+3600).sign(secret);
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
      res.on('data', c => chunks.push(c as Buffer));
      res.on('end', () => resolve({ status: res.statusCode ?? 0, body: Buffer.concat(chunks).toString('utf8') }));
    });
    req.on('error', reject);
    if (data) req.write(data);
    req.end();
  });
}

async function main() {
  const t = await token();
  for (const p of [
    '/api/orders',
    '/api/orders?status=available',
    '/api/orders/stats',
    '/api/merchants',
    '/api/merchants?q=Bodeg',
    '/api/end-users',
    '/api/end-users?q=smoke-user-1',
    '/api/installments?status=pending',
  ]) {
    const r = await call('GET', p, t);
    console.log(`${r.status}  GET ${p}\n${r.body.slice(0, 240)}\n---`);
  }
  // PATCH end-user: pick the first id from the list
  const list = JSON.parse((await call('GET', '/api/end-users', t)).body);
  const id = list.data?.[0]?.id;
  if (id) {
    const r = await call('PATCH', `/api/end-users/${id}`, t, { full_name: 'Pedro Pérez (smoke)', national_id: 'V-12345678' });
    console.log(`${r.status}  PATCH /api/end-users/${id}\n${r.body.slice(0, 400)}\n---`);
  }
}
main().catch(e => { console.error(e); process.exit(1); });
TSEOF
pnpm exec tsx scripts/smoke-slice3.ts 2>&1 | head -120
rm -f scripts/smoke-slice3.ts
```

Expected output:
- `200 GET /api/orders` with `total: 2`
- `200 GET /api/orders?status=available` with `total: 2`
- `200 GET /api/orders/stats` with `available_capital: "400.0000"` and `total_orders: 2`
- `200 GET /api/merchants` with `total: 2`
- `200 GET /api/merchants?q=Bodeg` with `total: 1`
- `200 GET /api/end-users` with `total: 2`
- `200 GET /api/end-users?q=smoke-user-1` with `total: 1`
- `200 GET /api/installments?status=pending` with `total: 5`
- `200 PATCH /api/end-users/{id}` with body reflecting `full_name: "Pedro Pérez (smoke)"` and `national_id: "V-12345678"`

Verify the audit row was inserted:

```bash
# Run via supabase MCP — equivalent SQL:
# SELECT count(*) FROM cfb.audit_log WHERE entity_type='end_user' AND action='update';
# Expected: at least 1
```

Stop dev server:

```bash
kill $DEV_PID 2>/dev/null; wait $DEV_PID 2>/dev/null
lsof -ti:3001 | xargs -r kill -9 2>/dev/null
```

- [ ] **Step 6: Regenerate openapi.json**

```bash
pnpm openapi:export 2>&1 | tail -3
node -e "const d = require('./openapi.json'); console.log(Object.keys(d.paths));"
```

Expected paths to include all 5 from previous slices plus:
`/api/orders`, `/api/orders/stats`, `/api/orders/{id}`, `/api/merchants`, `/api/merchants/{id}`, `/api/end-users`, `/api/end-users/{id}` (with PATCH), `/api/installments`.

- [ ] **Step 7: Force-add openapi.json and commit**

```bash
git add -f openapi.json
git commit -m "feat(openapi): regenerate with portfolio endpoints (orders/merchants/end-users/installments)"
```

---

## Self-review

**1. Spec coverage:**

| Spec section | Implemented in task |
|---|---|
| §3 Architecture (PortfolioModule + AuditModule) | Tasks 2, 11 |
| §4 Orders endpoints (list, detail, stats) | Tasks 3, 4, 5 |
| §5 Merchants endpoints | Task 6 |
| §6 End-users endpoints (list, detail, PATCH) | Tasks 7, 8, 9 |
| §7 Installments endpoint | Task 10 |
| §8 AuditService | Task 2 |
| §9 Error handling (status code matrix) | Tested across controller tests |
| §10 Observability (`audit recorded` log, no PII) | Implementation in Task 2 (basic) — explicit `info` log line for `end_user enriched` listed in spec is **not** added in Task 8 (gap, deferred — non-blocking, matches Slice 2 policy of skipping ancillary observability lines until they're needed for ops) |
| §11 Tests (~42) | Sum: Task 1 (5) + Task 2 (2) + Task 4 (6) + Task 5 (5) + Task 6 (4+3=7) + Task 8 (8) + Task 9 (6) + Task 10 (3+2=5) = **44** |
| §13 No new SQL migrations | Confirmed — no migrations in any task |
| §14 Acceptance criteria | Task 11 step 5 (smoke), step 6/7 (openapi), Task 11 step 3 (test count) |

**Gap notes**:
- The `end_user enriched` info log explicitly listed in spec §10 is not implemented (Task 8 only writes the audit row, no extra log line). This is deferred — operationally non-blocking, can land as a 3-line follow-up commit if needed.
- The `recordChange` test has 2 cases (spec said 2): provides own prisma vs uses caller-tx. Spec is met.

**2. Placeholder scan:**

- No "TBD", "TODO", "implement later", or "fill in details" anywhere.
- `Task 6` has multiple sub-tests in one task — that's intentional (small entity).
- All code blocks contain runnable code, no placeholders.

**3. Type/name consistency:**

- `PaginationSchema` (Task 1) used by Tasks 3, 6, 7, 10. ✓
- `AuditService.recordChange` signature (Task 2) used by Task 8. ✓ Same `entityType`, `entityId`, `action`, `actorId`, `payload`, `tx` shape.
- `OrderSummaryRow`, `OrderDetailRow`, `StatsGroupRow` defined in Task 3, used by Task 4. ✓
- `MerchantSummaryRow`, `MerchantDetailRow` defined in Task 6 step 2, used in Task 6 service. ✓
- `EndUserSummaryRow`, `EndUserDetailRow`, `EndUserUpdate`, `EndUsersListQuery` defined in Task 7, used in Task 8 + Task 9. ✓
- `InstallmentSummaryRow`, `InstallmentsListQuery` defined in Task 10 steps 1-2, used by service/controller. ✓
- Prisma model accessors used: `order`, `endUser`, `merchant`, `installment`, `merchantNameHistory`, `auditLog`, `rolePermission`. All match Slice 0 conventions (camelCase model names from PascalCase models).
- Prisma relation names referenced: `merchant`, `end_user`, `batches`, `installments`, `order_events`, `merchant_name_history`, `orders`. Per Slice 0 audit, these match `schema.prisma`. If a discrepancy surfaces during implementation (e.g., `batches` vs `batch`), the implementer adjusts in the relevant test + service + mapper triple — flagged as "Common Issues" in Task 4 step 4.

No issues found.

---

## Execution

Plan complete and saved to `docs/superpowers/plans/2026-05-06-slice-3-portfolio.md`. Two execution options:

1. **Subagent-Driven (recommended)** — fresh subagent per task, two-stage review.
2. **Inline Execution** — execute tasks in this session with checkpoints.

Which approach?

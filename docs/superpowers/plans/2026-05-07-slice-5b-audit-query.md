# Slice 5b — Audit log query API Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build the read-only paginated audit log endpoint: `GET /api/audit` (gated by `audit.read` for operator + admin + auditor) with 5 filters (`entity_type`, `entity_id`, `actor_id`, `action`, `occurred_at_from`/`_to`) and a fixed `occurred_at DESC` sort. Each response row expands the actor relation inline and passes the JSON `payload` through unmodified.

**Architecture:** New sub-feature `src/modules/admin/audit/` (controller, service, DTO, mapper) registered in the existing `AdminModule` from Slice 5a. The new service is named `AuditQueryService` to avoid colliding with the existing write-side `AuditService` in `src/modules/audit/`. Filters mirror the 4 existing audit_log indexes; the Prisma planner picks the right one. A Zod refine forces `entity_id` to be paired with `entity_type` so we don't degrade to a table scan. No SQL migration, no new dependencies.

**Tech Stack:** NestJS 10, TypeScript 5 strict, Prisma 5, Zod, Vitest, supertest. Reuses `PaginationSchema`, the parameter-level `@Query(new ZodValidationPipe(...))` pattern (post-Slice-4c), and the `Promise.all([findMany, count])` pagination pattern from prior list endpoints.

---

## Spec reference

`docs/superpowers/specs/2026-05-07-slice-5b-audit-query-design.md`. Read first for the 9 decisions table, error matrix, and smoke recipe.

## File structure

```
src/modules/admin/                              (existing, from Slice 5a)
  audit/                                         NEW SUB-FEATURE
    audit.controller.ts                          CREATE: GET /api/audit
    audit.controller.test.ts                     CREATE: 5 supertest
    audit.service.ts                             CREATE: AuditQueryService.list
    audit.service.test.ts                        CREATE: 5 unit tests
    audit.dto.ts                                 CREATE: AuditListQuerySchema
    responses/
      audit-entry.mapper.ts                      CREATE: row → response shape
  admin.module.ts                                MODIFY: register AuditController + AuditQueryService

openapi.json                                     REGENERATE + COMMIT
```

---

## Task 1: DTO + mapper

**Files:**
- Create: `src/modules/admin/audit/audit.dto.ts`
- Create: `src/modules/admin/audit/responses/audit-entry.mapper.ts`

This task scaffolds the Zod schema and the response mapper. No tests — they get exercised in Tasks 2 and 3.

- [ ] **Step 1: Create the DTO**

`src/modules/admin/audit/audit.dto.ts`:

```ts
import { z } from 'zod';
import { PaginationSchema } from '../../../common/dto/pagination.schema';

const AUDIT_ENTITY_TYPES = [
  'batch',
  'order',
  'installment',
  'certificate',
  'certificate_order',
  'investor',
  'merchant',
  'end_user',
  'user',
  'setting',
  'system',
] as const;

export const AuditListQuerySchema = PaginationSchema.extend({
  entity_type: z.enum(AUDIT_ENTITY_TYPES).optional(),
  entity_id: z.string().min(1).max(50).optional(),
  actor_id: z.string().uuid().optional(),
  action: z.string().min(1).max(50).optional(),
  occurred_at_from: z.coerce.date().optional(),
  occurred_at_to: z.coerce.date().optional(),
}).refine(
  (d) => !d.entity_id || d.entity_type !== undefined,
  { message: 'entity_id requiere entity_type', path: ['entity_id'] },
);

export type AuditListQuery = z.infer<typeof AuditListQuerySchema>;
```

- [ ] **Step 2: Create the mapper**

`src/modules/admin/audit/responses/audit-entry.mapper.ts`:

```ts
export type AuditEntryRow = {
  id: string;
  occurred_at: Date;
  actor_id: string | null;
  actor: { id: string; email: string; full_name: string } | null;
  action: string;
  entity_type: string;
  entity_id: string | null;
  ip_address: string | null;
  user_agent: string | null;
  payload: unknown;
};

export function toAuditEntry(r: AuditEntryRow) {
  return {
    id: r.id,
    occurred_at: r.occurred_at.toISOString(),
    actor: r.actor
      ? { id: r.actor.id, email: r.actor.email, full_name: r.actor.full_name }
      : null,
    action: r.action,
    entity_type: r.entity_type,
    entity_id: r.entity_id,
    ip_address: r.ip_address,
    user_agent: r.user_agent,
    payload: r.payload,
  };
}
```

(`actor_id` field deliberately not exposed in the output — `actor.id` carries the same info.)

- [ ] **Step 3: TS check + commit**

```bash
pnpm exec tsc --noEmit
git add src/modules/admin/audit/
git commit -m "feat(audit): scaffold AuditListQuerySchema + audit-entry mapper"
```

---

## Task 2: AuditQueryService (TDD)

**Files:**
- Create: `src/modules/admin/audit/audit.service.ts`
- Create: `src/modules/admin/audit/audit.service.test.ts`

`AuditQueryService.list` builds a `Prisma.AuditLogWhereInput` from the query, runs `Promise.all([findMany, count])`, maps results.

- [ ] **Step 1: Write the failing tests**

`src/modules/admin/audit/audit.service.test.ts`:

```ts
import { describe, it, expect, vi } from 'vitest';
import { AuditQueryService } from './audit.service';
import { PrismaService } from '../../../prisma/prisma.service';

function fakeAuditRow(overrides: Record<string, unknown> = {}) {
  return {
    id: 'audit-1',
    occurred_at: new Date('2026-05-07T12:00:00.000Z'),
    actor_id: 'u-1',
    actor: { id: 'u-1', email: 'op@cashea.app', full_name: 'Operator' },
    action: 'update',
    entity_type: 'investor',
    entity_id: 'inv-1',
    ip_address: null,
    user_agent: null,
    payload: { changed: { email: { from: 'a@x.com', to: 'b@y.com' } } },
    ...overrides,
  };
}

function makePrismaForAudit(opts: {
  rows?: Array<Record<string, unknown>>;
  total?: number;
} = {}) {
  return {
    auditLog: {
      findMany: vi.fn().mockResolvedValue(opts.rows ?? []),
      count: vi.fn().mockResolvedValue(opts.total ?? 0),
    },
  } as unknown as PrismaService;
}

describe('AuditQueryService.list', () => {
  it('returns paginated rows mapped via toAuditEntry (actor expanded, payload pass-through)', async () => {
    const prisma = makePrismaForAudit({ rows: [fakeAuditRow()], total: 1 });
    const svc = new AuditQueryService(prisma);
    const r = await svc.list({ limit: 50, offset: 0 });
    expect(r.total).toBe(1);
    expect(r.data[0]!.actor).toEqual({ id: 'u-1', email: 'op@cashea.app', full_name: 'Operator' });
    expect(r.data[0]!.payload).toEqual({ changed: { email: { from: 'a@x.com', to: 'b@y.com' } } });
    expect(r.data[0]!.occurred_at).toBe('2026-05-07T12:00:00.000Z');
  });

  it('with no filters: where is empty, orderBy occurred_at desc', async () => {
    const prisma = makePrismaForAudit();
    const svc = new AuditQueryService(prisma);
    await svc.list({ limit: 50, offset: 0 });
    const findManyArg = (prisma.auditLog.findMany as ReturnType<typeof vi.fn>).mock.calls[0]![0];
    expect(findManyArg.where).toEqual({});
    expect(findManyArg.orderBy).toEqual({ occurred_at: 'desc' });
    expect(findManyArg.take).toBe(50);
    expect(findManyArg.skip).toBe(0);
    expect(findManyArg.include).toEqual({ actor: true });
  });

  it('with entity_type=setting + entity_id=1: where has both', async () => {
    const prisma = makePrismaForAudit();
    const svc = new AuditQueryService(prisma);
    await svc.list({ limit: 50, offset: 0, entity_type: 'setting', entity_id: '1' });
    const findManyArg = (prisma.auditLog.findMany as ReturnType<typeof vi.fn>).mock.calls[0]![0];
    expect(findManyArg.where).toEqual({ entity_type: 'setting', entity_id: '1' });
  });

  it('with actor_id and date range: where has actor_id and occurred_at gte/lte', async () => {
    const prisma = makePrismaForAudit();
    const svc = new AuditQueryService(prisma);
    const from = new Date('2026-05-01T00:00:00.000Z');
    const to = new Date('2026-05-31T23:59:59.000Z');
    await svc.list({
      limit: 50, offset: 0,
      actor_id: '00000000-0000-4000-8000-000000000001',
      occurred_at_from: from,
      occurred_at_to: to,
    });
    const findManyArg = (prisma.auditLog.findMany as ReturnType<typeof vi.fn>).mock.calls[0]![0];
    expect(findManyArg.where).toEqual({
      actor_id: '00000000-0000-4000-8000-000000000001',
      occurred_at: { gte: from, lte: to },
    });
  });

  it('returns empty data: [] when count is 0', async () => {
    const prisma = makePrismaForAudit({ rows: [], total: 0 });
    const svc = new AuditQueryService(prisma);
    const r = await svc.list({ limit: 50, offset: 0 });
    expect(r.data).toEqual([]);
    expect(r.total).toBe(0);
  });
});
```

- [ ] **Step 2: Run, expect fail (service doesn't exist yet)**

```bash
pnpm vitest run src/modules/admin/audit/audit.service.test.ts
```

- [ ] **Step 3: Implement AuditQueryService**

`src/modules/admin/audit/audit.service.ts`:

```ts
import { Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../../../prisma/prisma.service';
import { toAuditEntry, type AuditEntryRow } from './responses/audit-entry.mapper';
import type { AuditListQuery } from './audit.dto';

@Injectable()
export class AuditQueryService {
  constructor(private readonly prisma: PrismaService) {}

  async list(query: AuditListQuery) {
    const where: Prisma.AuditLogWhereInput = {};
    if (query.entity_type) where.entity_type = query.entity_type;
    if (query.entity_id) where.entity_id = query.entity_id;
    if (query.actor_id) where.actor_id = query.actor_id;
    if (query.action) where.action = query.action;
    if (query.occurred_at_from || query.occurred_at_to) {
      where.occurred_at = {};
      if (query.occurred_at_from) (where.occurred_at as Record<string, Date>).gte = query.occurred_at_from;
      if (query.occurred_at_to) (where.occurred_at as Record<string, Date>).lte = query.occurred_at_to;
    }

    const [rows, total] = await Promise.all([
      this.prisma.auditLog.findMany({
        where,
        include: { actor: true },
        orderBy: { occurred_at: 'desc' },
        take: query.limit,
        skip: query.offset,
      }),
      this.prisma.auditLog.count({ where }),
    ]);

    return {
      data: rows.map((r) => toAuditEntry(r as unknown as AuditEntryRow)),
      total,
      limit: query.limit,
      offset: query.offset,
    };
  }
}
```

- [ ] **Step 4: Run service tests, expect 5 pass**

```bash
pnpm vitest run src/modules/admin/audit/audit.service.test.ts
```

Expected: 5 passed.

- [ ] **Step 5: TS check + commit**

```bash
pnpm exec tsc --noEmit
git add src/modules/admin/audit/audit.service.ts src/modules/admin/audit/audit.service.test.ts
git commit -m "feat(audit): AuditQueryService.list with filter matrix (TDD)"
```

---

## Task 3: AuditController + AdminModule wire (TDD)

**Files:**
- Create: `src/modules/admin/audit/audit.controller.ts`
- Create: `src/modules/admin/audit/audit.controller.test.ts`
- Modify: `src/modules/admin/admin.module.ts`

- [ ] **Step 1: Write the failing controller tests**

`src/modules/admin/audit/audit.controller.test.ts`:

```ts
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { Test } from '@nestjs/testing';
import { INestApplication } from '@nestjs/common';
import { APP_GUARD } from '@nestjs/core';
import { ConfigService } from '@nestjs/config';
import request from 'supertest';
import { AuditController } from './audit.controller';
import { AuditQueryService } from './audit.service';
import { JwtService } from '../../auth/jwt.service';
import { UserLookupService } from '../../auth/user-lookup.service';
import { JwtAuthGuard } from '../../auth/jwt-auth.guard';
import { PermissionsGuard } from '../../auth/permissions.guard';
import { PrismaService } from '../../../prisma/prisma.service';
import { mintTestJwt, TEST_SECRET } from '../../../../test/helpers/jwt.helper';
import { mockAuthUser } from '../../../../test/helpers/auth-user.helper';

describe('AuditController', () => {
  let app: INestApplication;
  let svc: { list: ReturnType<typeof vi.fn> };
  let prismaPerms: ReturnType<typeof vi.fn>;

  beforeEach(async () => {
    svc = { list: vi.fn() };
    prismaPerms = vi.fn().mockResolvedValue([]);
    const config = {
      get: (k: string) => (k === 'SUPABASE_JWT_SECRET' ? TEST_SECRET : undefined),
    } as unknown as ConfigService;

    const moduleRef = await Test.createTestingModule({
      controllers: [AuditController],
      providers: [
        { provide: AuditQueryService, useValue: svc },
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

  it('GET /api/audit → 401 without token', async () => {
    await request(app.getHttpServer()).get('/api/audit').expect(401);
  });

  it('GET /api/audit → 403 when role lacks audit.read', async () => {
    prismaPerms.mockResolvedValueOnce([{ permission: { key: 'investor.read' } }]);
    const t = await mintTestJwt({ sub: 'auth-uuid' });
    await request(app.getHttpServer())
      .get('/api/audit')
      .set('Authorization', `Bearer ${t}`)
      .expect(403);
  });

  it('GET /api/audit → 200 happy', async () => {
    prismaPerms.mockResolvedValueOnce([{ permission: { key: 'audit.read' } }]);
    svc.list.mockResolvedValueOnce({ data: [], total: 0, limit: 50, offset: 0 });
    const t = await mintTestJwt({ sub: 'auth-uuid' });
    const res = await request(app.getHttpServer())
      .get('/api/audit')
      .set('Authorization', `Bearer ${t}`)
      .expect(200);
    expect(res.body.total).toBe(0);
  });

  it('GET /api/audit?entity_id=foo → 400 (refine: entity_id without entity_type)', async () => {
    prismaPerms.mockResolvedValueOnce([{ permission: { key: 'audit.read' } }]);
    const t = await mintTestJwt({ sub: 'auth-uuid' });
    await request(app.getHttpServer())
      .get('/api/audit?entity_id=foo')
      .set('Authorization', `Bearer ${t}`)
      .expect(400);
  });

  it('GET /api/audit?entity_type=settings_typo → 400 (Zod enum)', async () => {
    prismaPerms.mockResolvedValueOnce([{ permission: { key: 'audit.read' } }]);
    const t = await mintTestJwt({ sub: 'auth-uuid' });
    await request(app.getHttpServer())
      .get('/api/audit?entity_type=settings_typo')
      .set('Authorization', `Bearer ${t}`)
      .expect(400);
  });
});
```

- [ ] **Step 2: Run, expect fail (controller doesn't exist yet)**

```bash
pnpm vitest run src/modules/admin/audit/audit.controller.test.ts
```

- [ ] **Step 3: Implement the controller**

`src/modules/admin/audit/audit.controller.ts`:

```ts
import { Controller, Get, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { RequirePermission } from '../../auth/decorators/require-permission.decorator';
import { ZodValidationPipe } from '../../../common/pipes/zod-validation.pipe';
import { AuditQueryService } from './audit.service';
import { AuditListQuerySchema, type AuditListQuery } from './audit.dto';

@ApiTags('audit')
@ApiBearerAuth()
@Controller('audit')
export class AuditController {
  constructor(private readonly audit: AuditQueryService) {}

  @Get()
  @RequirePermission('audit.read')
  list(@Query(new ZodValidationPipe(AuditListQuerySchema)) query: AuditListQuery) {
    return this.audit.list(query);
  }
}
```

- [ ] **Step 4: Wire into AdminModule**

Read `src/modules/admin/admin.module.ts` (currently has only Settings). Replace its contents:

```ts
import { Module } from '@nestjs/common';
import { SettingsController } from './settings/settings.controller';
import { SettingsService } from './settings/settings.service';
import { AuditController } from './audit/audit.controller';
import { AuditQueryService } from './audit/audit.service';

@Module({
  controllers: [SettingsController, AuditController],
  providers: [SettingsService, AuditQueryService],
})
export class AdminModule {}
```

- [ ] **Step 5: Run controller tests, expect 5 pass**

```bash
pnpm vitest run src/modules/admin/audit/audit.controller.test.ts
```

Expected: 5 passed.

- [ ] **Step 6: TS check + commit**

```bash
pnpm exec tsc --noEmit
git add src/modules/admin/audit/audit.controller.ts src/modules/admin/audit/audit.controller.test.ts src/modules/admin/admin.module.ts
git commit -m "feat(audit): controller + AdminModule wiring (TDD)"
```

---

## Task 4: Smoke + openapi

**Files:**
- Generate + force-add: `openapi.json`

- [ ] **Step 1: Run full test suite + TS + lint**

```bash
pnpm exec tsc --noEmit && pnpm test 2>&1 | tail -10 && pnpm lint 2>&1 | tail -5
```

Expected: zero TS errors, ~260 tests passing total (250 from prior slices + ~10 new). Lint clean.

- [ ] **Step 2: Look up the test user's id for actor filter test**

Via Supabase MCP `mcp__plugin_supabase_supabase__execute_sql` (project ref `esobivqsddwrbxlytfsn`):

```sql
SELECT id FROM cfb.users WHERE auth_user_id = '4bba7f81-443c-47b2-9bec-bc5a502380cc';
-- Note the returned id; we'll use it in the smoke script as ACTOR_ID.
```

- [ ] **Step 3: Boot dev server**

```bash
lsof -ti:3001 | xargs -r kill -9 2>/dev/null; sleep 1
pnpm dev > /tmp/araguaney-dev.log 2>&1 &
DEV_PID=$!
sleep 7
tail -20 /tmp/araguaney-dev.log
```

- [ ] **Step 4: Run smoke**

The test user's `role='operator'` already has `audit.read` seeded. No promotion needed. The audit_log has data from prior slice smokes (4b/4c/4d/5a).

```bash
cat > scripts/smoke-slice5b.ts <<'TSEOF'
import 'dotenv/config';
import { SignJWT } from 'jose';
import { request as httpRequest } from 'node:http';
import { URL } from 'node:url';
import { Buffer } from 'node:buffer';

const BASE = 'http://localhost:3001';
const SUB = '4bba7f81-443c-47b2-9bec-bc5a502380cc';
const ACTOR_ID = process.env.SMOKE_ACTOR_ID!;

async function token(): Promise<string> {
  const secret = new TextEncoder().encode(process.env.SUPABASE_JWT_SECRET!);
  return await new SignJWT({ sub: SUB })
    .setProtectedHeader({ alg: 'HS256' })
    .setIssuedAt()
    .setExpirationTime(Math.floor(Date.now() / 1000) + 3600)
    .sign(secret);
}

function call(method: string, path: string, t: string): Promise<{ status: number; body: string }> {
  return new Promise((resolve, reject) => {
    const u = new URL(BASE + path);
    const req = httpRequest({
      method, hostname: u.hostname, port: u.port, path: u.pathname + u.search,
      headers: { Authorization: `Bearer ${t}` },
    }, (res) => {
      const chunks: Buffer[] = [];
      res.on('data', (c) => chunks.push(c as Buffer));
      res.on('end', () => resolve({ status: res.statusCode ?? 0, body: Buffer.concat(chunks).toString('utf8') }));
    });
    req.on('error', reject);
    req.end();
  });
}

async function main() {
  const t = await token();

  // 1. List with no filters.
  const list1 = await call('GET', '/api/audit', t);
  console.log(`${list1.status} GET /api/audit (no filters)\n${list1.body.slice(0, 600)}\n---`);

  // 2. Filter by entity_type=setting + entity_id=1 (Slice 5a smoke).
  const filt1 = await call('GET', '/api/audit?entity_type=setting&entity_id=1', t);
  console.log(`${filt1.status} GET /api/audit?entity_type=setting&entity_id=1\n${filt1.body.slice(0, 400)}\n---`);

  // 3. Filter by entity_type=investor + action=update (Slice 4d smoke).
  const filt2 = await call('GET', '/api/audit?entity_type=investor&action=update', t);
  console.log(`${filt2.status} GET /api/audit?entity_type=investor&action=update\n${filt2.body.slice(0, 400)}\n---`);

  // 4. Filter by actor_id (test user).
  const filt3 = await call('GET', `/api/audit?actor_id=${ACTOR_ID}`, t);
  console.log(`${filt3.status} GET /api/audit?actor_id=...\n${filt3.body.slice(0, 400)}\n---`);

  // 5. Date range — last 7 days.
  const now = new Date();
  const weekAgo = new Date(now.getTime() - 7 * 24 * 3600 * 1000);
  const dr = await call(
    'GET',
    `/api/audit?occurred_at_from=${weekAgo.toISOString()}&occurred_at_to=${now.toISOString()}`,
    t,
  );
  console.log(`${dr.status} GET /api/audit (date range last 7d)\n${dr.body.slice(0, 400)}\n---`);

  // 6. 400: entity_id without entity_type.
  const bad1 = await call('GET', '/api/audit?entity_id=foo', t);
  console.log(`${bad1.status} GET /api/audit?entity_id=foo (should 400)\n${bad1.body.slice(0, 240)}\n---`);

  // 7. 400: invalid entity_type enum.
  const bad2 = await call('GET', '/api/audit?entity_type=settings_typo', t);
  console.log(`${bad2.status} GET /api/audit?entity_type=settings_typo (should 400)\n${bad2.body.slice(0, 240)}\n---`);

  // 8. limit=5 + offset=0.
  const page = await call('GET', '/api/audit?limit=5&offset=0', t);
  console.log(`${page.status} GET /api/audit?limit=5&offset=0\n${page.body.slice(0, 400)}\n---`);
}
main().catch((e) => { console.error(e); process.exit(1); });
TSEOF
SMOKE_ACTOR_ID=<id-from-step-2> pnpm exec tsx scripts/smoke-slice5b.ts 2>&1 | head -200
rm -f scripts/smoke-slice5b.ts
```

Expected:
- Call 1 (no filters): **200** with `total > 0`, latest rows by occurred_at DESC. Verify `actor: { id, email, full_name }` is populated for at least one row.
- Call 2 (entity setting/1): **200** with 2 rows (set 0.09, revert 0.08).
- Call 3 (investor+update): **200** with 3 rows (Slice 4d smoke).
- Call 4 (actor_id): **200** with multiple rows where the test user was actor.
- Call 5 (date range): **200** with recent rows.
- Call 6: **400** "entity_id requiere entity_type".
- Call 7: **400** Zod enum error mentioning `entity_type`.
- Call 8 (paginated): **200** with `data.length <= 5` and `total` reflecting unfiltered count.

If any call fails, check `/tmp/araguaney-dev.log`.

- [ ] **Step 5: Stop server**

```bash
kill $DEV_PID 2>/dev/null; wait $DEV_PID 2>/dev/null
lsof -ti:3001 | xargs -r kill -9 2>/dev/null
```

- [ ] **Step 6: Regenerate openapi.json**

```bash
pnpm openapi:export
node -e "const d = require('./openapi.json'); const ks = Object.keys(d.paths).sort(); console.log(ks); console.log('count:', ks.length); console.log('audit methods:', Object.keys(d.paths['/api/audit'] ?? {}));"
```

Expected: 23 paths total (was 22). New path `/api/audit` with method `['get']`.

- [ ] **Step 7: Force-add and commit openapi**

```bash
git add -f openapi.json
git commit -m "feat(openapi): regenerate with /api/audit GET"
```

---

## Self-review

**1. Spec coverage:**

| Spec section | Implemented in task |
|---|---|
| §3 Architecture (admin/audit/, AuditQueryService naming) | Tasks 1-3 |
| §4.1 GET /api/audit (perm, query schema, response shape) | Tasks 1 (DTO), 2 (service), 3 (controller) |
| §4.2 Error matrix (400/401/403) | Tasks 2 (validation), 3 (controller tests) |
| §5 Service list (where construction, Promise.all, include actor) | Task 2 |
| §6 Mapper (actor expansion, payload pass-through) | Task 1 |
| §7 Controller (parameter-level pipe, RequirePermission audit.read) | Task 3 |
| §8 AdminModule wiring (extends Slice 5a's module) | Task 3 |
| §9.1 Service tests (~5) | Task 2 |
| §9.2 Controller tests (~5) | Task 3 |
| §9.3 Smoke real | Task 4 |
| §10 Observability (no audit row written; deferred Pino) | Implicit — service is read-only |
| §11 Acceptance criteria | Task 4 |

**2. Placeholder scan:**

No "TBD", "TODO", "implement later" patterns. The smoke script's `<id-from-step-2>` is an explicit env var injected by the operator at runtime — that's a parameter, not a placeholder.

**3. Type/name consistency:**

- `AuditListQuerySchema`, `AuditListQuery` defined in Task 1, used in Tasks 2 (service) and 3 (controller). ✓
- `AuditEntryRow`, `toAuditEntry` defined in Task 1, used in Task 2 (service). ✓
- `AuditQueryService.list(query)` — single arg signature consistent between Tasks 2 (service) and 3 (controller). ✓
- `AUDIT_ENTITY_TYPES` Zod enum in DTO matches the `AuditEntityType` union in `src/modules/audit/types.ts` (verified by inspection — `['batch','order','installment','certificate','certificate_order','investor','merchant','end_user','user','setting','system']`). ✓
- Prisma model accessor `prisma.auditLog` (camelCase, matches `model AuditLog { @@map("audit_log") }` in schema). ✓
- `Prisma.AuditLogWhereInput` typed, no Decimal involved. ✓
- Permission `audit.read` (already seeded for operator + admin + auditor in `006_seeds.sql`). ✓
- Pipe placement: parameter-level `@Query(new ZodValidationPipe(...))` — consistent with post-Slice-4c pattern. ✓
- AdminModule extends Slice 5a's existing module (controllers + providers grow from 1 to 2 each). ✓

No issues found.

---

## Execution

Plan complete and saved to `docs/superpowers/plans/2026-05-07-slice-5b-audit-query.md`. Two execution options:

1. **Subagent-Driven (recommended)** — fresh subagent per task, two-stage review.
2. **Inline Execution** — execute tasks in this session with checkpoints.

Which approach?

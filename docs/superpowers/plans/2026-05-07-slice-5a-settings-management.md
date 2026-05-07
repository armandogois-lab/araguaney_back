# Slice 5a — Settings management Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build the admin endpoints for the singleton `cfb.settings` row: `GET /api/settings` (open to any authenticated user) and `PATCH /api/settings` (admin-only via `settings.manage`). PATCH writes only changed fields, bumps `updated_at`/`updated_by_id`, and records a diff-format audit row inside the same `prisma.$transaction`. Establishes the new `src/modules/admin/` module home that Slices 5b/5c will share.

**Architecture:** New `src/modules/admin/` module with a `settings/` sub-feature (controller, service, DTO, mapper). Service mirrors the Slice 4d pattern: transactional UPDATE + audit, no-op detection, diff-format audit. Decimal comparison via `prev.equals(next)` (Decimal API), values stringified with `.toFixed(6)` in the audit payload to preserve precision. `GET` carries no permission decorator (open to authenticated users); `PATCH` is gated by `@RequirePermission('settings.manage')` (admin-only via the seeded permission).

**Tech Stack:** NestJS 10, TypeScript 5 strict, Prisma 5 (Decimal arithmetic), Zod, Vitest, supertest. Reuses `AuditService` (Slice 3) and the `prisma.$transaction` + `audit.recordChange({ tx })` pattern from Slices 4a-4d. **No SQL migration. No new dependencies.**

---

## Spec reference

`docs/superpowers/specs/2026-05-07-slice-5a-settings-management-design.md`. Read first for the 10 decisions table, error matrix, and smoke recipe.

## File structure

```
src/modules/admin/                              NEW MODULE
  admin.module.ts                                CREATE
  settings/
    settings.controller.ts                       CREATE: GET + PATCH
    settings.controller.test.ts                  CREATE: 6 supertest
    settings.service.ts                          CREATE: get + update
    settings.service.test.ts                     CREATE: 4 unit tests
    settings.dto.ts                              CREATE: SettingsUpdateSchema (.strict.refine)
    responses/
      settings.mapper.ts                         CREATE: Decimal → fixed string

src/app.module.ts                                MODIFY: import AdminModule

openapi.json                                     REGENERATE + COMMIT
```

---

## Task 1: DTO + mapper + AdminModule shell

**Files:**
- Create: `src/modules/admin/settings/settings.dto.ts`
- Create: `src/modules/admin/settings/responses/settings.mapper.ts`
- Create: `src/modules/admin/admin.module.ts`

This task scaffolds the module skeleton, DTO, and response mapper. No tests — they get exercised in Tasks 2 and 3.

- [ ] **Step 1: Create the DTO**

`src/modules/admin/settings/settings.dto.ts`:

```ts
import { z } from 'zod';

export const SettingsUpdateSchema = z
  .object({
    default_sweep_rate: z.coerce.number().min(0).max(0.999999).optional(),
    shortfall_warning_threshold: z.coerce.number().min(0).max(1).optional(),
    concentration_warning_threshold: z.coerce.number().min(0).max(1).optional(),
  })
  .strict()
  .refine((d) => Object.keys(d).length > 0, {
    message: 'Debe enviar al menos un campo a actualizar',
  });

export type SettingsUpdate = z.infer<typeof SettingsUpdateSchema>;
```

- [ ] **Step 2: Create the mapper**

`src/modules/admin/settings/responses/settings.mapper.ts`:

```ts
import type { Decimal } from '@prisma/client/runtime/library';

export type SettingsRow = {
  id: number;
  default_sweep_rate: Decimal;
  shortfall_warning_threshold: Decimal;
  concentration_warning_threshold: Decimal;
  updated_at: Date;
  updated_by: { id: string; email: string; full_name: string } | null;
};

export function toSettings(s: SettingsRow) {
  return {
    default_sweep_rate: s.default_sweep_rate.toFixed(6),
    shortfall_warning_threshold: s.shortfall_warning_threshold.toFixed(6),
    concentration_warning_threshold: s.concentration_warning_threshold.toFixed(6),
    updated_at: s.updated_at.toISOString(),
    updated_by: s.updated_by
      ? { id: s.updated_by.id, email: s.updated_by.email, full_name: s.updated_by.full_name }
      : null,
  };
}
```

(`id` deliberately not exposed — singleton; the frontend doesn't need it.)

- [ ] **Step 3: Create the module shell (no providers/controllers yet — they're added in Tasks 2 + 3)**

`src/modules/admin/admin.module.ts`:

```ts
import { Module } from '@nestjs/common';

@Module({
  controllers: [],
  providers: [],
})
export class AdminModule {}
```

(Empty arrays now; we'll fill them in Task 3 once the controller and service exist. Creating the module shell here keeps the file tree intentional.)

- [ ] **Step 4: TS check + commit**

```bash
pnpm exec tsc --noEmit
git add src/modules/admin/
git commit -m "feat(admin): scaffold AdminModule + settings DTO/mapper"
```

---

## Task 2: SettingsService (TDD)

**Files:**
- Create: `src/modules/admin/settings/settings.service.ts`
- Create: `src/modules/admin/settings/settings.service.test.ts`

Service implements `get` (singleton fetch with relation) and `update` (transactional, diff-format audit, no-op detection).

- [ ] **Step 1: Write the failing tests**

`src/modules/admin/settings/settings.service.test.ts`:

```ts
import { describe, it, expect, vi } from 'vitest';
import { NotFoundException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { SettingsService } from './settings.service';
import { PrismaService } from '../../../prisma/prisma.service';
import { AuditService } from '../../audit/audit.service';

const D = (s: string) => new Prisma.Decimal(s);

function fakeSettingsRow(overrides: Record<string, unknown> = {}) {
  return {
    id: 1,
    default_sweep_rate: D('0.080000'),
    shortfall_warning_threshold: D('0.005000'),
    concentration_warning_threshold: D('0.150000'),
    updated_at: new Date('2026-04-15T00:00:00.000Z'),
    updated_by: null,
    ...overrides,
  };
}

function makeAudit() {
  return { recordChange: vi.fn().mockResolvedValue(undefined) } as unknown as AuditService;
}

function makePrismaForSettings(opts: {
  existing?: Record<string, unknown> | null;
} = {}) {
  const tx = {
    setting: {
      findUnique: vi.fn().mockResolvedValue(opts.existing === null ? null : (opts.existing ?? fakeSettingsRow())),
      update: vi.fn().mockImplementation(async ({ data, where }: { data: Record<string, unknown>; where: { id: number } }) => ({
        ...(opts.existing ?? fakeSettingsRow()),
        ...data,
        id: where.id,
      })),
    },
  };
  const prisma = {
    $transaction: vi.fn(async (cb: (t: typeof tx) => Promise<unknown>) => cb(tx)),
    setting: {
      findUnique: tx.setting.findUnique,
      update: tx.setting.update,
    },
  } as unknown as PrismaService;
  (prisma as unknown as { _tx: typeof tx })._tx = tx;
  return prisma;
}

describe('SettingsService.get', () => {
  it('returns the singleton row mapped via toSettings', async () => {
    const prisma = makePrismaForSettings();
    const svc = new SettingsService(prisma, makeAudit());
    const r = await svc.get();
    expect(r.default_sweep_rate).toBe('0.080000');
    expect(r.shortfall_warning_threshold).toBe('0.005000');
    expect(r.concentration_warning_threshold).toBe('0.150000');
    expect(r.updated_by).toBeNull();
  });

  it('throws 404 when settings row missing', async () => {
    const prisma = makePrismaForSettings({ existing: null });
    const svc = new SettingsService(prisma, makeAudit());
    await expect(svc.get()).rejects.toBeInstanceOf(NotFoundException);
  });
});

describe('SettingsService.update', () => {
  it('happy path: writes only changed fields, bumps updated_at + updated_by_id, audits with diff (stringified)', async () => {
    const existing = fakeSettingsRow();
    const prisma = makePrismaForSettings({ existing });
    const audit = makeAudit();
    const svc = new SettingsService(prisma, audit);

    const r = await svc.update(
      { default_sweep_rate: 0.09, concentration_warning_threshold: 0.2 },
      'actor-1',
    );

    const tx = (prisma as unknown as {
      _tx: { setting: { update: ReturnType<typeof vi.fn> } };
    })._tx;
    expect(tx.setting.update).toHaveBeenCalledOnce();
    const updateArg = tx.setting.update.mock.calls[0]![0] as {
      where: { id: number };
      data: Record<string, unknown>;
    };
    expect(updateArg.where.id).toBe(1);
    // Decimal comparisons — values converted to Prisma.Decimal
    expect((updateArg.data.default_sweep_rate as Prisma.Decimal).equals(D('0.09'))).toBe(true);
    expect((updateArg.data.concentration_warning_threshold as Prisma.Decimal).equals(D('0.2'))).toBe(true);
    expect(updateArg.data.shortfall_warning_threshold).toBeUndefined();
    expect(updateArg.data.updated_by_id).toBe('actor-1');
    expect(updateArg.data.updated_at).toBeInstanceOf(Date);

    expect(audit.recordChange).toHaveBeenCalledOnce();
    const auditArg = (audit.recordChange as ReturnType<typeof vi.fn>).mock.calls[0]![0] as {
      entityType: string;
      entityId: string;
      action: string;
      payload: { changed: Record<string, { from: string; to: string }> };
    };
    expect(auditArg.entityType).toBe('setting');
    expect(auditArg.entityId).toBe('1');
    expect(auditArg.action).toBe('update');
    expect(auditArg.payload.changed.default_sweep_rate).toEqual({ from: '0.080000', to: '0.090000' });
    expect(auditArg.payload.changed.concentration_warning_threshold).toEqual({ from: '0.150000', to: '0.200000' });
    expect(auditArg.payload.changed.shortfall_warning_threshold).toBeUndefined();

    expect(r.default_sweep_rate).toBe('0.090000');
  });

  it('no-op: client sends value identical to current → no write, no audit, returns current shape', async () => {
    const existing = fakeSettingsRow();
    const prisma = makePrismaForSettings({ existing });
    const audit = makeAudit();
    const svc = new SettingsService(prisma, audit);

    const r = await svc.update({ default_sweep_rate: 0.08 }, 'actor-1');

    const tx = (prisma as unknown as {
      _tx: { setting: { update: ReturnType<typeof vi.fn> } };
    })._tx;
    expect(tx.setting.update).not.toHaveBeenCalled();
    expect(audit.recordChange).not.toHaveBeenCalled();
    expect(r.default_sweep_rate).toBe('0.080000');
  });

  it('throws 404 when settings row missing', async () => {
    const prisma = makePrismaForSettings({ existing: null });
    const svc = new SettingsService(prisma, makeAudit());
    await expect(
      svc.update({ default_sweep_rate: 0.09 }, 'actor-1'),
    ).rejects.toBeInstanceOf(NotFoundException);
  });
});
```

- [ ] **Step 2: Run, expect fail (service doesn't exist yet)**

```bash
pnpm vitest run src/modules/admin/settings/settings.service.test.ts
```

- [ ] **Step 3: Implement SettingsService**

`src/modules/admin/settings/settings.service.ts`:

```ts
import { Injectable, NotFoundException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../../../prisma/prisma.service';
import { AuditService } from '../../audit/audit.service';
import { toSettings, type SettingsRow } from './responses/settings.mapper';
import type { SettingsUpdate } from './settings.dto';

@Injectable()
export class SettingsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
  ) {}

  async get() {
    const row = await this.prisma.setting.findUnique({
      where: { id: 1 },
      include: { updated_by: true },
    });
    if (!row) throw new NotFoundException('Configuración del sistema no encontrada');
    return toSettings(row as unknown as SettingsRow);
  }

  async update(input: SettingsUpdate, actorId: string) {
    return await this.prisma.$transaction(async (tx) => {
      const existing = await tx.setting.findUnique({
        where: { id: 1 },
        include: { updated_by: true },
      });
      if (!existing) throw new NotFoundException('Configuración del sistema no encontrada');

      const editableFields: Array<keyof SettingsUpdate> = [
        'default_sweep_rate',
        'shortfall_warning_threshold',
        'concentration_warning_threshold',
      ];

      const changed: Record<string, { from: string; to: string }> = {};
      const data: Prisma.SettingUncheckedUpdateInput = {};
      for (const k of editableFields) {
        if (!(k in input)) continue;
        const next = new Prisma.Decimal(input[k] as number);
        const prev = (existing as Record<string, unknown>)[k] as Prisma.Decimal;
        if (!prev.equals(next)) {
          changed[k] = { from: prev.toFixed(6), to: next.toFixed(6) };
          (data as Record<string, unknown>)[k] = next;
        }
      }

      if (Object.keys(changed).length === 0) {
        return toSettings(existing as unknown as SettingsRow);
      }

      const updated = await tx.setting.update({
        where: { id: 1 },
        data: {
          ...data,
          updated_at: new Date(),
          updated_by_id: actorId,
        },
        include: { updated_by: true },
      });

      await this.audit.recordChange({
        entityType: 'setting',
        entityId: '1',
        action: 'update',
        actorId,
        payload: { changed },
        tx,
      });

      return toSettings(updated as unknown as SettingsRow);
    });
  }
}
```

Note: `entityType: 'setting'` (singular) matches the existing `AuditEntityType` union in `src/modules/audit/types.ts`. The audit log's `entity_type` column is a string; the typed union just enumerates known values.

- [ ] **Step 4: Run service tests, expect 4 pass**

```bash
pnpm vitest run src/modules/admin/settings/settings.service.test.ts
```

Expected: 4 passed.

- [ ] **Step 5: TS check + commit**

```bash
pnpm exec tsc --noEmit
git add src/modules/admin/settings/settings.service.ts src/modules/admin/settings/settings.service.test.ts
git commit -m "feat(settings): SettingsService with diff audit + no-op detection (TDD)"
```

---

## Task 3: SettingsController + AdminModule wire (TDD)

**Files:**
- Create: `src/modules/admin/settings/settings.controller.ts`
- Create: `src/modules/admin/settings/settings.controller.test.ts`
- Modify: `src/modules/admin/admin.module.ts`

- [ ] **Step 1: Write the failing controller tests**

`src/modules/admin/settings/settings.controller.test.ts`:

```ts
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { Test } from '@nestjs/testing';
import { INestApplication } from '@nestjs/common';
import { APP_GUARD } from '@nestjs/core';
import { ConfigService } from '@nestjs/config';
import request from 'supertest';
import { SettingsController } from './settings.controller';
import { SettingsService } from './settings.service';
import { JwtService } from '../../auth/jwt.service';
import { UserLookupService } from '../../auth/user-lookup.service';
import { JwtAuthGuard } from '../../auth/jwt-auth.guard';
import { PermissionsGuard } from '../../auth/permissions.guard';
import { PrismaService } from '../../../prisma/prisma.service';
import { mintTestJwt, TEST_SECRET } from '../../../../test/helpers/jwt.helper';
import { mockAuthUser } from '../../../../test/helpers/auth-user.helper';

describe('SettingsController', () => {
  let app: INestApplication;
  let svc: { get: ReturnType<typeof vi.fn>; update: ReturnType<typeof vi.fn> };
  let prismaPerms: ReturnType<typeof vi.fn>;

  beforeEach(async () => {
    svc = { get: vi.fn(), update: vi.fn() };
    // Default: caller has no admin perms (operator-shaped). Tests opt in to specific perms.
    prismaPerms = vi.fn().mockResolvedValue([]);
    const config = {
      get: (k: string) => (k === 'SUPABASE_JWT_SECRET' ? TEST_SECRET : undefined),
    } as unknown as ConfigService;

    const moduleRef = await Test.createTestingModule({
      controllers: [SettingsController],
      providers: [
        { provide: SettingsService, useValue: svc },
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

  it('GET /api/settings → 401 without token', async () => {
    await request(app.getHttpServer()).get('/api/settings').expect(401);
  });

  it('GET /api/settings → 200 happy (any authenticated user; no perm decorator)', async () => {
    svc.get.mockResolvedValueOnce({
      default_sweep_rate: '0.080000',
      shortfall_warning_threshold: '0.005000',
      concentration_warning_threshold: '0.150000',
      updated_at: '2026-04-15T00:00:00.000Z',
      updated_by: null,
    });
    const t = await mintTestJwt({ sub: 'auth-uuid' });
    const res = await request(app.getHttpServer())
      .get('/api/settings')
      .set('Authorization', `Bearer ${t}`)
      .expect(200);
    expect(res.body.default_sweep_rate).toBe('0.080000');
  });

  it('PATCH /api/settings → 401 without token', async () => {
    await request(app.getHttpServer())
      .patch('/api/settings')
      .send({ default_sweep_rate: 0.09 })
      .expect(401);
  });

  it('PATCH /api/settings → 403 when role lacks settings.manage', async () => {
    prismaPerms.mockResolvedValueOnce([{ permission: { key: 'audit.read' } }]);
    const t = await mintTestJwt({ sub: 'auth-uuid' });
    await request(app.getHttpServer())
      .patch('/api/settings')
      .set('Authorization', `Bearer ${t}`)
      .send({ default_sweep_rate: 0.09 })
      .expect(403);
  });

  it('PATCH /api/settings → 200 happy (admin)', async () => {
    prismaPerms.mockResolvedValueOnce([{ permission: { key: 'settings.manage' } }]);
    svc.update.mockResolvedValueOnce({
      default_sweep_rate: '0.090000',
      shortfall_warning_threshold: '0.005000',
      concentration_warning_threshold: '0.150000',
      updated_at: '2026-05-07T12:00:00.000Z',
      updated_by: { id: 'u-1', email: 'op@cashea.app', full_name: 'Operator' },
    });
    const t = await mintTestJwt({ sub: 'auth-uuid' });
    const res = await request(app.getHttpServer())
      .patch('/api/settings')
      .set('Authorization', `Bearer ${t}`)
      .send({ default_sweep_rate: 0.09 })
      .expect(200);
    expect(res.body.default_sweep_rate).toBe('0.090000');
    expect(res.body.updated_by.email).toBe('op@cashea.app');
  });

  it('PATCH /api/settings → 400 when body has unknown key (Zod strict)', async () => {
    prismaPerms.mockResolvedValueOnce([{ permission: { key: 'settings.manage' } }]);
    const t = await mintTestJwt({ sub: 'auth-uuid' });
    await request(app.getHttpServer())
      .patch('/api/settings')
      .set('Authorization', `Bearer ${t}`)
      .send({ id: 99, default_sweep_rate: 0.09 })
      .expect(400);
  });
});
```

- [ ] **Step 2: Run, expect fail (controller doesn't exist yet)**

```bash
pnpm vitest run src/modules/admin/settings/settings.controller.test.ts
```

- [ ] **Step 3: Implement the controller**

`src/modules/admin/settings/settings.controller.ts`:

```ts
import { Body, Controller, Get, HttpCode, HttpStatus, Patch } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { CurrentUser } from '../../auth/decorators/current-user.decorator';
import { RequirePermission } from '../../auth/decorators/require-permission.decorator';
import type { AuthUser } from '../../auth/types';
import { ZodValidationPipe } from '../../../common/pipes/zod-validation.pipe';
import { SettingsService } from './settings.service';
import { SettingsUpdateSchema, type SettingsUpdate } from './settings.dto';

@ApiTags('settings')
@ApiBearerAuth()
@Controller('settings')
export class SettingsController {
  constructor(private readonly settings: SettingsService) {}

  @Get()
  @HttpCode(HttpStatus.OK)
  get() {
    return this.settings.get();
  }

  @Patch()
  @HttpCode(HttpStatus.OK)
  @RequirePermission('settings.manage')
  update(
    @Body(new ZodValidationPipe(SettingsUpdateSchema)) body: SettingsUpdate,
    @CurrentUser() user: AuthUser,
  ) {
    return this.settings.update(body, user.id);
  }
}
```

- [ ] **Step 4: Wire SettingsController + SettingsService into AdminModule**

Replace the contents of `src/modules/admin/admin.module.ts`:

```ts
import { Module } from '@nestjs/common';
import { SettingsController } from './settings/settings.controller';
import { SettingsService } from './settings/settings.service';

@Module({
  controllers: [SettingsController],
  providers: [SettingsService],
})
export class AdminModule {}
```

- [ ] **Step 5: Run controller tests, expect 6 pass**

```bash
pnpm vitest run src/modules/admin/settings/settings.controller.test.ts
```

Expected: 6 passed.

- [ ] **Step 6: TS check + commit**

```bash
pnpm exec tsc --noEmit
git add src/modules/admin/settings/settings.controller.ts src/modules/admin/settings/settings.controller.test.ts src/modules/admin/admin.module.ts
git commit -m "feat(settings): controller + AdminModule wiring (TDD)"
```

---

## Task 4: AppModule wire + smoke + openapi

**Files:**
- Modify: `src/app.module.ts`
- Generate + force-add: `openapi.json`

- [ ] **Step 1: Wire AdminModule into AppModule**

Read `src/app.module.ts`. Add the import at the top (next to other module imports):

```ts
import { AdminModule } from './modules/admin/admin.module';
```

Add `AdminModule` to the `imports` array of the `@Module({ ... })` decorator (after `IssuanceModule`, alphabetical order isn't critical — match the project's existing convention of "domain order" if there is one):

```ts
@Module({
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
    AdminModule,
  ],
})
```

- [ ] **Step 2: Run full test suite + TS + lint**

```bash
pnpm exec tsc --noEmit && pnpm test 2>&1 | tail -10 && pnpm lint 2>&1 | tail -5
```

Expected: zero TS errors, ~249 tests passing total (239 from prior slices + 10 new). Lint clean.

- [ ] **Step 3: Commit AppModule wiring**

```bash
git add src/app.module.ts
git commit -m "feat(admin): wire AdminModule into AppModule"
```

- [ ] **Step 4: Smoke against real Supabase**

The settings row exists (seeded). The test user is `operator`; we promote to admin temporarily to test PATCH.

Promote test user via Supabase MCP `mcp__plugin_supabase_supabase__execute_sql` (project ref `esobivqsddwrbxlytfsn`):

```sql
UPDATE cfb.users SET role='admin' WHERE auth_user_id='4bba7f81-443c-47b2-9bec-bc5a502380cc' RETURNING id, role;
```

Boot dev server:

```bash
lsof -ti:3001 | xargs -r kill -9 2>/dev/null; sleep 1
pnpm dev > /tmp/araguaney-dev.log 2>&1 &
DEV_PID=$!
sleep 7
tail -20 /tmp/araguaney-dev.log
```

Confirm boot succeeded.

Smoke script:

```bash
cat > scripts/smoke-slice5a.ts <<'TSEOF'
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
  const offset = (5 - dayNum + 7) % 7 || 7;
  d.setUTCDate(d.getUTCDate() + offset);
  return d.toISOString().slice(0, 10);
}

async function main() {
  const t = await token();

  // 1. GET — check current values.
  const get1 = await call('GET', '/api/settings', t);
  console.log(`${get1.status} GET /api/settings\n${get1.body.slice(0, 400)}\n---`);

  // 2. PATCH default_sweep_rate to 0.09.
  const patch1 = await call('PATCH', '/api/settings', t, { default_sweep_rate: 0.09 });
  console.log(`${patch1.status} PATCH /api/settings (set 0.09)\n${patch1.body.slice(0, 400)}\n---`);

  // 3. Run sweep simulate to confirm new rate is used.
  const sim = await call('POST', '/api/certificates/sweep/simulate', t, {
    term_days: 14,
    issue_date: nextFridayISO(),
  });
  console.log(`${sim.status} POST /sweep/simulate (rate should be 0.090000)\n${sim.body.slice(0, 400)}\n---`);

  // 4. Revert default_sweep_rate to 0.08.
  const patch2 = await call('PATCH', '/api/settings', t, { default_sweep_rate: 0.08 });
  console.log(`${patch2.status} PATCH /api/settings (revert 0.08)\n${patch2.body.slice(0, 240)}\n---`);

  // 5. PATCH out-of-range rate → 400.
  const oob = await call('PATCH', '/api/settings', t, { default_sweep_rate: 1.5 });
  console.log(`${oob.status} PATCH /api/settings (rate 1.5 — should 400)\n${oob.body.slice(0, 240)}\n---`);

  // 6. PATCH unknown key → 400.
  const unknown = await call('PATCH', '/api/settings', t, { id: 99 });
  console.log(`${unknown.status} PATCH /api/settings (unknown key id — should 400)\n${unknown.body.slice(0, 240)}\n---`);

  // 7. PATCH empty body → 400.
  const empty = await call('PATCH', '/api/settings', t, {});
  console.log(`${empty.status} PATCH /api/settings (empty body — should 400)\n${empty.body.slice(0, 240)}\n---`);
}
main().catch((e) => { console.error(e); process.exit(1); });
TSEOF
pnpm exec tsx scripts/smoke-slice5a.ts 2>&1 | head -120
rm -f scripts/smoke-slice5a.ts
```

Expected:
- Call 1 (GET): **200** with `default_sweep_rate: "0.080000"`, both thresholds at default.
- Call 2 (PATCH set 0.09): **200**, response shows `default_sweep_rate: "0.090000"`, `updated_by` populated.
- Call 3 (sweep simulate): **200** (or 422 if no eligible orders — that's fine), response shows `inputs.rate: "0.090000"` (new default picked up).
- Call 4 (PATCH revert 0.08): **200**, back to `0.080000`.
- Call 5 (PATCH 1.5): **400** (Zod range).
- Call 6 (PATCH unknown key): **400** (Zod strict).
- Call 7 (PATCH empty): **400** (Zod refine).

If any call fails, check `/tmp/araguaney-dev.log`.

- [ ] **Step 5: Verify audit_log entries**

Via Supabase MCP `execute_sql`:

```sql
SELECT entity_type, entity_id, action, payload->'changed' AS changed, occurred_at
FROM cfb.audit_log
WHERE entity_type = 'setting' AND action = 'update'
ORDER BY occurred_at DESC
LIMIT 5;
-- Expected: 2 rows (set 0.09, revert 0.08).
-- Each `changed.default_sweep_rate` = { from: "...", to: "..." } with stringified Decimal values.
```

- [ ] **Step 6: Demote test user back to operator**

```sql
UPDATE cfb.users SET role='operator' WHERE auth_user_id='4bba7f81-443c-47b2-9bec-bc5a502380cc' RETURNING id, role;
```

- [ ] **Step 7: Stop server**

```bash
kill $DEV_PID 2>/dev/null; wait $DEV_PID 2>/dev/null
lsof -ti:3001 | xargs -r kill -9 2>/dev/null
```

- [ ] **Step 8: Regenerate openapi.json**

```bash
pnpm openapi:export
node -e "const d = require('./openapi.json'); const ks = Object.keys(d.paths).sort(); console.log(ks); console.log('count:', ks.length); console.log('settings:', Object.keys(d.paths['/api/settings'] ?? {}));"
```

Expected: 22 paths total (was 21). New path `/api/settings` with methods `['get', 'patch']`.

- [ ] **Step 9: Force-add and commit openapi**

```bash
git add -f openapi.json
git commit -m "feat(openapi): regenerate with /api/settings (GET + PATCH)"
```

---

## Self-review

**1. Spec coverage:**

| Spec section | Implemented in task |
|---|---|
| §3 Architecture (new admin/ module, settings/ sub-feature) | Tasks 1-3 |
| §4.1 GET /api/settings (no perm decorator) | Tasks 2 (service), 3 (controller) |
| §4.2 PATCH /api/settings (settings.manage) | Tasks 2 (service), 3 (controller) |
| §4.3 Error matrix (400/401/403/404) | Tasks 2 (service 404), 3 (controller 401/403/400) |
| §5 Service get + update (tx, diff, no-op, audit) | Task 2 |
| §6 DTO `.strict.refine` + Mapper `.toFixed(6)` | Task 1 |
| §7 Controller (Get + Patch with @CurrentUser, @RequirePermission, ZodValidationPipe) | Task 3 |
| §8 AdminModule wiring | Tasks 1 (shell), 3 (fill controllers/providers), 4 (AppModule import) |
| §9.1 Service tests (~4) | Task 2 |
| §9.2 Controller tests (~6) | Task 3 |
| §9.3 Smoke real | Task 4 |
| §10 Observability (audit row, no Pino) | Task 2 (audit), nothing for Pino (deferred) |
| §11 Acceptance criteria | Task 4 |

**2. Placeholder scan:**

No "TBD", "TODO", "implement later" patterns. Every step shows actual code or actual commands.

**3. Type/name consistency:**

- `SettingsUpdateSchema`, `SettingsUpdate` defined in Task 1, used in Tasks 2 (service) and 3 (controller). ✓
- `SettingsRow`, `toSettings` defined in Task 1, used in Task 2 (service). ✓
- `SettingsService.get()` and `SettingsService.update(input, actorId)` — signatures consistent between Tasks 2 (service) and 3 (controller). ✓
- Audit `entityType: 'setting'` matches the `AuditEntityType` union in `src/modules/audit/types.ts` (verified — singular not plural). ✓
- Audit `entityId: '1'` (string-coerced from int singleton). ✓
- Permission `settings.manage` (already seeded for admin in `006_seeds.sql`). ✓
- Prisma model accessor `prisma.setting` (singular, matches `model Setting { @@map("settings") }` in schema). ✓
- `Prisma.SettingUncheckedUpdateInput` matches the existing `create`-pattern in Slice 4d (FK as `_id` field rather than `connect`). ✓

No issues found.

---

## Execution

Plan complete and saved to `docs/superpowers/plans/2026-05-07-slice-5a-settings-management.md`. Two execution options:

1. **Subagent-Driven (recommended)** — fresh subagent per task, two-stage review.
2. **Inline Execution** — execute tasks in this session with checkpoints.

Which approach?

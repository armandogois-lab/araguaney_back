# Slice 1 — Auth: diseño

**Fecha**: 2026-05-05
**Autor**: armandogois@cashea.app + Claude (brainstorming)
**Estado**: en revisión
**Próximo paso**: tras aprobación, invocar writing-plans para producir el plan de implementación
**Depende de**: Slice 0 (Foundation) — mergeado a `main` en commit `ac9bec1`

---

## 1. Objetivo

Construir la maquinaria de auth del backend: verificar el JWT que llega del frontend (firmado por Supabase Auth), mapearlo al registro `cfb.users` correspondiente, exponer guards globales de NestJS para que cualquier endpoint requiera autenticación por default y opcionalmente requiera permisos específicos. Cerrar el slice con un endpoint trivial `GET /api/me` que ejercita el flujo end-to-end.

### Por qué importa

- Slice 0 dejó la app booteada y sirviendo `/api/health` público. Sin auth, ningún endpoint de dominio (ingestión, certificados) puede salir a producción.
- CLAUDE.md ya define la decisión: "El backend verifica el JWT de Supabase Auth y mapea al usuario en `cfb.users`. Para transacciones atómicas que requieren bypass de RLS, el backend usa `SUPABASE_SERVICE_ROLE_KEY`. Esa key NUNCA va al frontend."
- La DB tiene la matriz `cfb.role_permissions` ya seedeada (40 filas, 3 roles × 20 permisos) y la función `cfb.has_permission(key)`. Slice 1 expone eso a la capa HTTP.

### Fuera de alcance

- Sign in / sign out / refresh — eso lo hace el frontend con la SDK de Supabase. El backend solo recibe JWTs ya emitidos.
- CRUD de usuarios (`POST /api/users`, `PATCH /api/users/:id/role`, etc.) — Slice 2.
- Endpoint que devuelve la lista de permisos del usuario actual (`GET /api/me/permissions`) — Slice 2 si el frontend lo necesita.
- Service-to-service tokens, API keys, webhooks de Supabase Auth — no aplica al producto.

---

## 2. Decisiones tomadas

1. **Verificación local del JWT** con `jose.jwtVerify(token, secret, { algorithms: ['HS256'] })`. El secret es `SUPABASE_JWT_SECRET` (ya en env, validado por Zod). Funciona igual en Railway que local — el secret está en `process.env`.
2. **Sin cache** del lookup `auth_user_id → cfb.users`. 3 operadores, lookup de ~5ms por request. Si crece, agregamos LRU TTL después.
3. **Mensajes de error en inglés** para esta capa (auth), no en español. Override deliberado de la regla general de CLAUDE.md, registrado en memoria del proyecto.
4. **Decorador `@RequirePermission(...keys)` con AND implícito**. Multiple keys → todas requeridas. Si alguna vez surge OR, agregamos `@RequireAnyPermission(...)` separado. YAGNI.
5. **Guards globales** vía `APP_GUARD`. Por default, todos los endpoints requieren JWT. Excepciones (`/api/health`) usan `@Public()`.
6. **Distinción 401 vs 403**: 401 = "no sé quién sos" (token ausente / inválido / expirado). 403 = "sé quién sos pero no podés" (no estás en `cfb.users`, desactivado, faltan permisos). El frontend usa esta distinción para decidir entre redirigir a login (401) o mostrar página "no autorizado" (403).
7. **Tests minted JWTs locally** con el mismo `SUPABASE_JWT_SECRET`. Sin red, sin Supabase real.
8. **Slice mínimo**: maquinaria + `GET /api/me`. Sin endpoints custodiados por permisos en este slice (esos llegan en Slice 2+).

---

## 3. Arquitectura general

```
HTTP Request
    │ Authorization: Bearer <jwt>
    ▼
┌─────────────────────────────┐
│ JwtAuthGuard (global)        │
│  • si @Public() → pasa       │
│  • parsea Bearer header       │
│  • jose.jwtVerify HS256       │
│  • UserLookupService.findByAuthId(claims.sub)
│  • adjunta req.user (AuthUser)│
└──────────┬──────────────────┘
           │ (req.user disponible o 401/403)
           ▼
┌─────────────────────────────┐
│ PermissionsGuard (global)    │
│  • lee @RequirePermission(...)│
│  • si vacío → pasa            │
│  • query role_permissions     │
│  • si faltan keys → 403       │
└──────────┬──────────────────┘
           │
           ▼
       Controller
       (@CurrentUser() user → req.user)
```

**Principios:**
- Dos guards globales en orden: `JwtAuthGuard` → `PermissionsGuard`.
- `APP_GUARD` registrados en orden = NestJS los ejecuta en orden.
- `PermissionsGuard` solo entra si el handler tiene `@RequirePermission(...)`.
- El backend conecta con `SERVICE_ROLE_KEY` (bypass de RLS); el enforcement de permisos lo hace el `PermissionsGuard` en la app. RLS sigue siendo segunda red de seguridad si en algún flujo se conecta con `anon`.

---

## 4. Componentes

### Estructura de archivos

```
src/modules/auth/
  auth.module.ts                          ← wires guards globally + providers
  jwt.service.ts                          ← jose.jwtVerify
  jwt.service.test.ts
  user-lookup.service.ts                  ← Prisma: auth_user_id → cfb.users
  user-lookup.service.test.ts
  jwt-auth.guard.ts                       ← header → verify → lookup → req.user
  jwt-auth.guard.test.ts
  permissions.guard.ts                    ← reads @RequirePermission, queries role_permissions
  permissions.guard.test.ts
  types.ts                                ← AuthUser, JwtClaims, LookupResult
  decorators/
    require-permission.decorator.ts       ← @RequirePermission('a', 'b')
    current-user.decorator.ts             ← @CurrentUser() user
    public.decorator.ts                   ← @Public() (skip JwtAuthGuard)

src/modules/me/
  me.module.ts
  me.controller.ts                        ← GET /api/me
  me.controller.test.ts                   ← integration

test/helpers/
  jwt.helper.ts                           ← mintTestJwt({ sub, exp? })
  auth-user.helper.ts                     ← mockAuthUser(overrides?)
```

### Tipos (`auth/types.ts`)

```ts
export type AuthUser = {
  id: string;          // cfb.users.id (UUID)
  email: string;
  full_name: string;
  role: 'operator' | 'admin' | 'auditor';
  is_active: boolean;  // always true once past JwtAuthGuard
};

export type JwtClaims = {
  sub: string;         // auth.users.id (UUID Supabase)
  email?: string;
  role?: string;       // Supabase: 'authenticated' for normal users
  exp: number;
  iat: number;
};

export type LookupResult =
  | { kind: 'found'; user: AuthUser }
  | { kind: 'not_registered' }
  | { kind: 'deactivated' };
```

### `JwtService`

```ts
@Injectable()
export class JwtService {
  private readonly secret: Uint8Array;

  constructor(config: ConfigService<EnvConfig, true>) {
    this.secret = new TextEncoder().encode(
      config.get('SUPABASE_JWT_SECRET', { infer: true }),
    );
  }

  async verify(token: string): Promise<JwtClaims> {
    try {
      const { payload } = await jwtVerify(token, this.secret, {
        algorithms: ['HS256'],
      });
      return payload as JwtClaims;
    } catch {
      throw new UnauthorizedException('Invalid or expired token');
    }
  }
}
```

### `UserLookupService`

```ts
@Injectable()
export class UserLookupService {
  constructor(private readonly prisma: PrismaService) {}

  async findByAuthId(authUserId: string): Promise<LookupResult> {
    const row = await this.prisma.user.findUnique({
      where: { auth_user_id: authUserId },
      select: { id: true, email: true, full_name: true, role: true, is_active: true },
    });
    if (!row) return { kind: 'not_registered' };
    if (!row.is_active) return { kind: 'deactivated' };
    return { kind: 'found', user: row };
  }
}
```

### `JwtAuthGuard`

```ts
@Injectable()
export class JwtAuthGuard implements CanActivate {
  constructor(
    private readonly reflector: Reflector,
    private readonly jwt: JwtService,
    private readonly users: UserLookupService,
  ) {}

  async canActivate(ctx: ExecutionContext): Promise<boolean> {
    const isPublic = this.reflector.getAllAndOverride<boolean>(IS_PUBLIC_KEY, [
      ctx.getHandler(),
      ctx.getClass(),
    ]);
    if (isPublic) return true;

    const req = ctx.switchToHttp().getRequest<Request>();
    const auth = req.headers['authorization'];
    if (!auth || typeof auth !== 'string' || !auth.startsWith('Bearer ')) {
      throw new UnauthorizedException('Missing or malformed Authorization header');
    }
    const token = auth.slice(7).trim();
    if (!token) {
      throw new UnauthorizedException('Missing or malformed Authorization header');
    }

    const claims = await this.jwt.verify(token);
    if (!claims.sub) {
      throw new UnauthorizedException('Token missing subject');
    }

    const result = await this.users.findByAuthId(claims.sub);
    switch (result.kind) {
      case 'not_registered':
        throw new ForbiddenException('User not registered in the system');
      case 'deactivated':
        throw new ForbiddenException('User account is deactivated');
      case 'found':
        (req as Request & { user: AuthUser }).user = result.user;
        return true;
    }
  }
}
```

### `PermissionsGuard`

```ts
@Injectable()
export class PermissionsGuard implements CanActivate {
  constructor(
    private readonly reflector: Reflector,
    private readonly prisma: PrismaService,
  ) {}

  async canActivate(ctx: ExecutionContext): Promise<boolean> {
    const required = this.reflector.getAllAndOverride<string[]>(REQUIRE_PERMISSION_KEY, [
      ctx.getHandler(),
      ctx.getClass(),
    ]);
    if (!required || required.length === 0) return true;

    const req = ctx.switchToHttp().getRequest<Request & { user?: AuthUser }>();
    const user = req.user;
    if (!user) {
      throw new UnauthorizedException('Not authenticated');
    }

    const granted = await this.prisma.rolePermission.findMany({
      where: { role: user.role, permission: { key: { in: required } } },
      select: { permission: { select: { key: true } } },
    });
    const grantedKeys = new Set(granted.map((g) => g.permission.key));
    const missing = required.filter((k) => !grantedKeys.has(k));
    if (missing.length > 0) {
      throw new ForbiddenException(`Permission denied: ${missing.join(', ')}`);
    }
    return true;
  }
}
```

Prisma client accessors: model is `prisma.rolePermission` (camelCase of `RolePermission`), relation field is `permission` (singular, as introspected in `schema.prisma` line ~182), nested filter `permission: { key: { in: required } }` works because Prisma traverses the relation defined by `RolePermission.permission`.

### Decoradores

```ts
// require-permission.decorator.ts
export const REQUIRE_PERMISSION_KEY = 'require_permission';
export const RequirePermission = (...keys: string[]) =>
  SetMetadata(REQUIRE_PERMISSION_KEY, keys);

// current-user.decorator.ts
export const CurrentUser = createParamDecorator(
  (_data: unknown, ctx: ExecutionContext): AuthUser =>
    (ctx.switchToHttp().getRequest() as Request & { user: AuthUser }).user,
);

// public.decorator.ts
export const IS_PUBLIC_KEY = 'is_public';
export const Public = () => SetMetadata(IS_PUBLIC_KEY, true);
```

### `AuthModule`

```ts
@Module({
  providers: [
    JwtService,
    UserLookupService,
    { provide: APP_GUARD, useClass: JwtAuthGuard },
    { provide: APP_GUARD, useClass: PermissionsGuard },
  ],
  exports: [JwtService, UserLookupService],
})
export class AuthModule {}
```

### `MeController` (`/api/me`)

```ts
@ApiTags('me')
@ApiBearerAuth()
@Controller('me')
export class MeController {
  @Get()
  me(@CurrentUser() user: AuthUser): AuthUser {
    return user;
  }
}
```

### Cambios en `HealthController` y `AppModule`

`HealthController.health()` recibe `@Public()` decorator (sino el guard global lo bloquea con 401).

`AppModule.imports` agrega `AuthModule` y `MeModule`:

```ts
imports: [
  ConfigModule.forRoot({ isGlobal: true, validate: validateEnv }),
  LoggerModule,
  PrismaModule,
  AuthModule,        // ← nuevo
  HealthModule,
  MeModule,          // ← nuevo
]
```

---

## 5. Manejo de errores

Toda la auth lanza `HttpException` standard de NestJS. El `AllExceptionsFilter` de Slice 0 ya las captura y devuelve la forma estándar:

```json
{ "statusCode": 401|403, "message": "...", "error": "Unauthorized|Forbidden" }
```

Mensajes en **inglés** para esta capa (override de CLAUDE.md, decisión registrada en memoria).

| Caso | Status | Message |
|---|---|---|
| Header `Authorization` ausente / no-Bearer / vacío | 401 | `Missing or malformed Authorization header` |
| JWT firma inválida / expirado / alg incorrecto | 401 | `Invalid or expired token` |
| JWT sin claim `sub` | 401 | `Token missing subject` |
| `sub` no existe en `cfb.users` | 403 | `User not registered in the system` |
| `cfb.users.is_active = false` | 403 | `User account is deactivated` |
| Falta `req.user` en `PermissionsGuard` (no debería pasar) | 401 | `Not authenticated` |
| Usuario tiene rol pero le faltan permisos | 403 | `Permission denied: <comma-separated keys>` |

---

## 6. Observabilidad

### Logger context enriquecido

Después de que `JwtAuthGuard` resuelve `req.user`, se enriquece el child logger del request con `userId`. Implementación: en el guard, justo antes de `return true`, hacer:

```ts
if (req.log) {
  req.log = req.log.child({ userId: result.user.id, role: result.user.role });
}
```

Esto hace que cualquier `req.log.info(...)` posterior incluya esos campos automáticamente.

### Eventos auth-específicos

Los siguientes eventos se loguean explícitamente con `info` level:

- `{ msg: 'auth attempt failed', reason: 'missing_header' | 'invalid_token' | 'not_registered' | 'deactivated' | 'token_no_subject', ip, userAgent }`.
- `{ msg: 'permission denied', userId, role, requiredKeys, missingKeys }`.

A nivel `debug` (no `info` por ruido):
- `{ msg: 'auth resolved', userId, role }`.

### Lo que NO se loguea

- El JWT crudo (Pino redact ya cubre `Authorization` header).
- Las claims completas (pueden contener email, otros campos).
- El email o full_name del usuario en logs operacionales — solo `userId` y `role`.

---

## 7. Tests (Vitest)

### Unit (mocks puros)

| Archivo | Casos |
|---|---|
| `jwt.service.test.ts` | (1) valid token → returns claims · (2) expired token → 401 · (3) wrong signature → 401 · (4) `alg: none` → 401 |
| `user-lookup.service.test.ts` | (1) found+active → `{ kind: 'found' }` · (2) not in users → `{ kind: 'not_registered' }` · (3) is_active=false → `{ kind: 'deactivated' }` |
| `jwt-auth.guard.test.ts` | (1) `@Public()` → passes · (2) missing header → 401 · (3) malformed Bearer → 401 · (4) invalid token → 401 · (5) lookup not_registered → 403 with correct message · (6) lookup deactivated → 403 with correct message · (7) found → req.user set, returns true |
| `permissions.guard.test.ts` | (1) no decorator → passes · (2) all keys granted → passes · (3) one missing → 403 listing missing · (4) all missing → 403 |

### Integration (NestJS Testing module)

| Archivo | Casos |
|---|---|
| `me.controller.test.ts` | (1) sin token → 401 · (2) token expirado → 401 · (3) lookup not_registered → 403 · (4) usuario activo → 200 con `{ id, email, full_name, role, is_active }` |

### Helpers

```ts
// test/helpers/jwt.helper.ts
import { SignJWT } from 'jose';

export async function mintTestJwt(opts: { sub: string; exp?: number; secret?: string }): Promise<string> {
  const secret = new TextEncoder().encode(opts.secret ?? process.env.SUPABASE_JWT_SECRET ?? 'test-secret');
  const exp = opts.exp ?? Math.floor(Date.now() / 1000) + 3600;
  return await new SignJWT({ sub: opts.sub })
    .setProtectedHeader({ alg: 'HS256' })
    .setIssuedAt()
    .setExpirationTime(exp)
    .sign(secret);
}

// test/helpers/auth-user.helper.ts
export function mockAuthUser(overrides: Partial<AuthUser> = {}): AuthUser {
  return {
    id: '00000000-0000-4000-8000-000000000001',
    email: 'test@cashea.app',
    full_name: 'Test Operator',
    role: 'operator',
    is_active: true,
    ...overrides,
  };
}
```

**Total estimado: ~22 tests nuevos**, todos sin red ni DB real.

---

## 8. Dependencias nuevas

- `jose` (production) — JWT verification.
- TypeScript module augmentation para Express `Request` para que `req.user: AuthUser` esté tipado globalmente sin casts. Archivo `src/types/express.d.ts` con:
  ```ts
  import type { AuthUser } from '../modules/auth/types';
  declare global {
    namespace Express {
      interface Request {
        user?: AuthUser;
      }
    }
  }
  export {};
  ```
- Nada más; `nestjs-pino`, `@nestjs/swagger`, Prisma client, Vitest, etc. ya están desde Slice 0.

---

## 9. Criterios de aceptación

Slice 1 está listo cuando:

1. `pnpm test` pasa con ~22 tests nuevos verdes.
2. `GET /api/health` sigue público y devuelve 200 sin token (regresión).
3. `GET /api/me` sin token → 401.
4. `GET /api/me` con token válido y usuario en `cfb.users` activo → 200 con `{ id, email, full_name, role, is_active }`.
5. `GET /api/me` con token válido pero sub no existe en `cfb.users` → 403 `User not registered in the system`.
6. Si insertamos un usuario de test con `is_active=false`, `GET /api/me` con su token → 403 `User account is deactivated`.
7. Swagger UI en `/api/docs` muestra `/api/me` con `BearerAuth` security indicator.
8. `pnpm openapi:export` regenera `openapi.json` y el archivo incluye el endpoint `/api/me` con su esquema de respuesta.
9. `pnpm typecheck` y `pnpm lint` corren limpio.
10. CLAUDE.md no requiere cambios (Slice 1 implementa lo que ya describe — el `@RequirePermission` decorator).

---

## 10. Riesgos y mitigaciones

| Riesgo | Mitigación |
|---|---|
| `SUPABASE_JWT_SECRET` rota en Supabase y el backend deja de aceptar tokens | Evento conocido y de bajo riesgo: Supabase no rota automáticamente. Si pasa, actualizamos `.env` (local) y Railway Variables (prod) y reiniciamos. Loguear claramente "invalid signature" ayuda a diagnosticar. |
| Operador hace login pero su email no fue registrado en `cfb.users` por un admin previo | 403 `User not registered`. Operador contacta a un admin. Admin crea el row vía CRUD de Slice 2 (no existe aún). Mientras Slice 2 no esté, se puede insertar manualmente vía Supabase SQL editor. Aceptable para 3 operadores. |
| `PermissionsGuard` hace 1 query DB por request — overhead | 5-15ms con Prisma + pooler. Aceptable. Si se vuelve cuello, agregar cache LRU TTL en una iteración futura — no en este slice. |
| Test `mintTestJwt` usa el mismo secret que prod (si tests corren con `.env` cargado) | Test secret es solo verificación; los JWTs minted son inocuos (no acceden a Supabase, solo al backend en tests). Pero por higiene, `mintTestJwt` acepta `secret` opcional y los tests pueden inyectar `'test-secret'` para evitar usar el real. |
| Race entre dos guards globales si NestJS cambia el orden de ejecución | Mitigación: tests integration verifican el orden (`me.controller.test.ts` con token expirado → 401 antes de chequear permisos). |

---

## 11. Siguiente paso

Tras la aprobación del usuario sobre este spec → invocar `superpowers:writing-plans` para producir el plan paso-a-paso.

# Araguaney Backend

Backend (NestJS) for **Cashea CFB**, the internal back-office system for
packaging Cashea BNPL installments into Bolsa de Valores de Caracas
certificates (CFB).

**Frontend repo**: [`araguaney_front`](https://github.com/armandogois-lab/araguaney_front)

**For project context, conventions, and architectural decisions,
read [`CLAUDE.md`](./CLAUDE.md) first.**

## Quick start

```bash
nvm use
npm install
cp .env.example .env  # fill in Supabase credentials
npm run db:generate
npm run dev           # API on :3001 — Swagger UI on /api/docs
```

## Stack

Node 20 · NestJS 10 · Prisma 5 · TypeScript strict · Zod · Supabase · Vitest.

## OpenAPI contract

The OpenAPI spec is auto-generated from controllers and DTOs. Two ways to consume it:

- **Live**: `GET /api/docs/json` while the API is running
- **File**: `npm run openapi:export` writes `./openapi.json` for the frontend to consume

The frontend (`araguaney_front`) generates TypeScript types from this spec.

## Repository structure

- `src/` — application code
- `prisma/` — Prisma schema (single source of truth for DB types)
- `infra/sql/` — Idempotent SQL migrations for Supabase (apply in order 001 → 006)
- `scripts/` — Tooling, including OpenAPI exporter
- `docs/` — Product constitution and decision records

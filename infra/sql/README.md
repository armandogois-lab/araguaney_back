# Migraciones SQL para Supabase

Este directorio contiene las migraciones SQL idempotentes que definen el schema
`cfb` de la base de datos Postgres en Supabase.

## Estado actual

El usuario debe **copiar manualmente** los 6 archivos SQL que ya tiene preparados:

```
infra/sql/
├── 001_extensions_and_schema.sql
├── 002_tables_ingestion.sql
├── 003_tables_portfolio.sql
├── 004_tables_issuance.sql
├── 005_tables_crosscutting.sql
└── 006_rls_and_policies.sql
```

(Los nombres exactos pueden variar; se respeta el orden numérico 001 → 006).

## Cómo aplicar las migraciones

Estas migraciones **no se aplican con `prisma migrate`**. La fuente de verdad
para el schema físico de Postgres es este directorio; el `schema.prisma` se
mantiene sincronizado a mano y solo se usa para generar tipos TypeScript en el
backend.

Pasos para aplicar:

1. Abrir [Supabase Studio](https://supabase.com/dashboard) → tu proyecto
2. Ir a **SQL Editor**
3. Pegar el contenido de cada archivo en orden numérico (001 primero, luego 002, etc.)
4. Ejecutar cada uno y verificar que no haya errores
5. Las migraciones son idempotentes — si necesitas re-ejecutar alguna, es seguro

## Verificación

Tras aplicar las 6 migraciones, en el SQL Editor:

```sql
-- Verificar que el schema cfb existe y tiene 19 tablas
SELECT table_name
FROM information_schema.tables
WHERE table_schema = 'cfb'
ORDER BY table_name;
```

Debe devolver 19 tablas.

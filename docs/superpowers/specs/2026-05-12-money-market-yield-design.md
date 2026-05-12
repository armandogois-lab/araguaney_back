# Money Market Yield convention for CFB pricing

**Date:** 2026-05-12
**Status:** Draft for implementation
**Scope:** Back-end pricing formula change + docs + tests
**No data migration:** the database is currently empty of certificates (cleared 2026-05-11). The change applies to all future emissions.

## Goal

Switch the `price` formula for Certificados de Financiamiento Bursátil from **Bank Discount Yield (BDY)** to **Money Market Yield (MMY)** to align with how the estructurador (Mercantil Merinvest) computes and reports the same instrument.

**Before (BDY):**
```
price = 1 − (rate × days / 360)
```

**After (MMY):**
```
price = 1 / (1 + rate × days / 360)
```

The contracted "tasa anual" now represents the **simple-interest annualized yield the investor actually earns on their invested capital** (Actual/360 day count), not a discount applied to the face value. This is the convention Mercantil uses internally and reports back to the investor.

## Why

Two screenshots compared on 2026-05-12 (a real cert C4572A: $150k capital, 13% × 42 days):

| Field | Cashea (BDY) | Mercantil (MMY) |
|---|---:|---:|
| Investor paid | $149,999.71 | $149,999.71 |
| Price | 0.984833 | 0.985060 |
| Nominal | $152,309.79 | ~$152,275 |
| Yield (cash) | $2,310.08 | ~$2,275 |
| Annual rate label | 13% (discount on face) | 13% (yield on capital) |

The investor-paid and rate label match, but downstream nominal/yield diverge by ~$35 on a $150k cert. Mercantil's "Retorno efectivo (42 días) 1.52%" and "Descuento 1.49%" are unambiguous MMY language ("retorno sobre lo invertido"), and that is the convention the estructurador uses for the SUNAVAL filing. Aligning means we don't have to reconcile reports each cycle.

Both formulas are valid in finance — BDY is what U.S. Treasury Bills quote; MMY is what Eurodollar/LIBOR/money-market deposits and most privately structured short-term instruments use. For a private-placement BNPL securitization where the contract talks about "yield the investor earns", MMY is the more natural reading.

## What changes

### Math (one line)

`src/modules/issuance/certificates/pricing/pricing.ts` — `computePricing` function:

```diff
- const ratio = i.rate.mul(i.termDays).div(360);
- const price = new D(1).minus(ratio).toDecimalPlaces(6, D.ROUND_HALF_UP);
+ const ratio = i.rate.mul(i.termDays).div(360);
+ const price = new D(1)
+   .div(new D(1).plus(ratio))
+   .toDecimalPlaces(6, D.ROUND_HALF_UP);
  const nominalTarget = i.capital.div(price).toDecimalPlaces(4, D.ROUND_HALF_UP);
```

Everything else stays:
- `computePayouts` already expresses everything in terms of `price`; multiplication by the new price gives the right MMY downstream values.
- `nominalTarget = capital / price` stays.
- `investor_paid = nominal_actual × price` stays.
- `investor_yield = nominal_actual − investor_paid` stays.
- `investor_returned = capital − investor_paid` stays.
- `shortfall_pct = (target − actual) / target` stays.
- `rate_basis: 'ACT/360'` stays — day-count convention is independent of the discount formula.

### Test fixtures

Recompute every pinned price value. New canonical references:

| Rate × Term | Old (BDY) | New (MMY) |
|---|---|---|
| 13% × 42 días | `0.984833` | `0.985060` |
| 8% × 14 días | `0.996889` | `0.996899` |
| 0% (any term) | `1.000000` | `1.000000` |

Files that pin these values (recompute the dependent `nominal_target`, `investor_paid`, `investor_yield`, etc. for each fixture):

- `src/modules/issuance/certificates/pricing/pricing.test.ts`
- `src/modules/issuance/certificates/payload-hash/payload-hash.test.ts`
- `src/modules/issuance/certificates/certificates.service.test.ts`
- `src/modules/issuance/sweep/sweep.service.test.ts`

Implementer must run the actual `computePricing` and `computePayouts` to get the exact 4/6-decimal values to pin — manual arithmetic risks rounding drift.

### Documentation

**`CLAUDE.md`** — three edits:

1. Section **"Producto en 1 página"** → replace `Modalidad: A descuento (price = 1 - rate × days / 360)` with `Modalidad: Money market yield (price = 1 / (1 + rate × days / 360))`. The "tasa anual" represents the simple-interest annualized yield the investor earns on their invested capital.

2. Section **"Cálculos"** → update the `price` line to match the new formula.

3. Section **"Decisiones ya tomadas (no re-discutir)"** → add: `Money market yield para price (1 / (1 + r×d/360)) en vez de bank discount yield (1 − r×d/360) per acuerdo con Mercantil Merinvest, 2026-05-12. Ver docs/DECISIONS/2026-05-12-money-market-yield.md.`

**`docs/DECISIONS/2026-05-12-money-market-yield.md`** (new ADR) — full reasoning for future contributors. Includes:
- The two conventions side-by-side with formulas and example numbers.
- Why MMY (estructurador alignment + retorno-real semantics).
- Why not BDY (would diverge from Mercantil's reports every cycle).
- Note that BDY is what U.S. T-Bills use, so it's reasonable to assume — hence this ADR exists.

### What does NOT change

- `infra/sql/004_issuance.sql`: the `price numeric(10,8)` column and the `(price > 0 AND price ≤ 1)` CHECK constraint are valid under both formulas. No migration.
- `openapi.json`: wire shape unchanged — `price` is still a string. Values shipped to clients are different, but no schema change. **Do not regenerate.**
- Frontend code: does not compute price; only displays whatever the back returns. No front change.
- Database data: the DB is empty of certificates today. No backfill needed. If we ever need to re-emit a cert with the old contract, that's a one-off and not covered here.
- `payload_hash`: the hash function is unchanged. Hashes for new simulations will be different (because `price` is part of the hashed payload), which is the correct behavior — different inputs → different hashes.
- Sweep service: reuses `computePricing` from the standard module, so it picks up the change automatically. No separate edit.

## File map

| Path | Action |
|---|---|
| `src/modules/issuance/certificates/pricing/pricing.ts` | modify (1 line in `computePricing`) |
| `src/modules/issuance/certificates/pricing/pricing.test.ts` | modify (recompute fixtures) |
| `src/modules/issuance/certificates/payload-hash/payload-hash.test.ts` | modify (1 pinned price) |
| `src/modules/issuance/certificates/certificates.service.test.ts` | modify (pinned price + downstream values) |
| `src/modules/issuance/sweep/sweep.service.test.ts` | modify (pinned price + downstream values) |
| `CLAUDE.md` | modify (3 small edits) |
| `docs/DECISIONS/2026-05-12-money-market-yield.md` | create (ADR) |

**Total:** 1 new file + 6 modifications. No new tests — same test count, just updated fixtures.

## Verification

After the change, the canonical example from the brainstorm should round-trip cleanly:

- Capital = $150,000
- Rate = 13%
- Term = 42 days
- Expected `price` = `0.985060`
- Expected `nominal_target` = `$152,274.99` (= 150,000 / 0.985060 rounded HALF_UP to 4 decimals — implementer to confirm exact value)
- With `nominal_actual = nominal_target` (no round-down): `investor_paid` ≈ `$150,000.00`, `investor_yield` ≈ `$2,274.99`, `investor_returned` ≈ `$0.00`.

The investor literally earns ≈$2,275 on $150k over 42 days = **1.5167%** = **13.00% annualized (Actual/360)**, exactly as advertised.

## Out-of-scope

- **Migration of historical certs.** None exist today; if any are emitted between this design and the implementation merge, they'll have BDY prices and would need a follow-up. Confirm with `SELECT count(*) FROM cfb.certificates` before merging.
- **Other day-count conventions (Actual/365, 30/360).** Stays at Actual/360 per regulation.
- **Compound vs simple interest variants of MMY.** We use simple interest (the standard MMY). Compound is only relevant for longer-than-1-year instruments; CFB max is 42 days.
- **Front-end label changes.** The fields are still `precio`, `nominal`, `descuento`, etc. Only the underlying numbers change. If we want to rename labels (e.g., "Precio" → "Factor de descuento (MMY)"), that's a separate UX decision.

## Risk register

| Risk | Likelihood | Impact | Mitigation |
|---|---|---|---|
| Implementer pins approximated values instead of computed | Medium | Test drift | Plan instructs to compute via `computePricing()`, not by hand |
| Someone re-emits a cert with the old formula because they didn't read the ADR | Low | Audit confusion | ADR + CLAUDE.md update + commit message linking to ADR |
| Mercantil later changes their mind and reverts to BDY | Very low | Re-flip a one-liner | Pricing function is centralized in one file; flipping back is a one-line revert |

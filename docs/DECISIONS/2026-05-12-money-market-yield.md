# ADR: Money Market Yield convention for CFB pricing

**Date:** 2026-05-12
**Status:** Accepted
**Supersedes:** Initial bank-discount-yield convention from bootstrap

## Decision

The `price` of a Certificado de Financiamiento Bursátil is computed as:

```
price = 1 / (1 + annual_rate × term_days / 360)
```

This is the **Money Market Yield (MMY)** convention. The contracted "tasa anual" represents the simple-interest annualized yield (Actual/360 day count) that the investor earns on their invested capital.

## Context

The bootstrap docs specified Bank Discount Yield (BDY):

```
price = 1 − (annual_rate × term_days / 360)   ← Bank Discount Yield (former)
```

BDY is the standard convention for U.S. Treasury Bills, U.S. commercial paper, CETES (Mexico), Letras del Tesoro (Spain), and most short-term "letras a descuento" worldwide. It's a defensible default for a Venezuelan bursátil instrument.

However, on 2026-05-12 the operations team compared a real emission (cert C4572A) side-by-side with the estructurador's (Mercantil Merinvest Casa de Bolsa) own report. The two systems agreed on the cash the investor pays but disagreed on the implied price, nominal, and yield:

| Field | Cashea (BDY) | Mercantil (MMY) |
|---|---:|---:|
| Investor paid | $149,999.71 | $149,999.71 |
| Price | 0.984833 | 0.985060 |
| Nominal | $152,309.79 | ~$152,275 |
| "Descuento" | 1.5167% | 1.49% |
| "Retorno efectivo (42d)" | (not shown) | 1.52% |

Mercantil's spreadsheet labels — "Retorno efectivo (42 días)", "Descuento", "Nominal" — are unambiguous MMY language. They compute the price as the present value that delivers exactly the contracted rate as the investor's yield-on-invested-capital, not as a discount applied to face value.

Aligning the formulas eliminates a recurring reconciliation step on every emission and makes the contract semantically cleaner: "tasa 13%" really does mean "13% annualized yield on what you put in", not "13% discount on face value (effective yield is slightly higher)".

## Comparison

For a $150k cert at 13% × 42 days:

**Bank Discount Yield (former):**
- `price = 1 − (0.13 × 42/360) = 0.984833`
- Discount/face = 1.5167% (BDY annualized = 13.00% by construction)
- Effective return on capital = $2,310 / $149,999 × 360/42 = 13.20% (the actual yield the investor earns is higher than 13%)

**Money Market Yield (chosen):**
- `price = 1 / (1 + 0.13 × 42/360) = 0.985060`
- Discount/face = 1.4940%
- Effective return on capital = $2,275 / $149,999 × 360/42 = 13.00% (exactly the contracted rate)

In short: BDY makes the **face value** the calibration target with the rate as the discount; MMY makes the **investor's yield** the calibration target with the rate as the return. The numbers differ by ~$35 on $150k — small in absolute terms but not zero, and it's the source of the reconciliation friction.

## Consequences

**What changes**

- `src/modules/issuance/certificates/pricing/pricing.ts` — one-line change in `computePricing`.
- Test fixtures across 4 files (recomputed with the new price).
- `CLAUDE.md` (3 small edits).
- This ADR.

**What does NOT change**

- Day-count convention stays Actual/360 (`rate_basis: 'ACT/360'`).
- Database schema: `price numeric(10, 8)` and the `CHECK (price > 0 AND price ≤ 1)` constraint hold for both formulas.
- OpenAPI wire shape: unchanged. The `price` field is still a string; only its computed value differs.
- Frontend: doesn't compute pricing, only displays back values.
- Round-down behavior, payload-hash structure, and audit-log payloads are unchanged.

**What we'd watch for**

- If Mercantil ever changes their reporting convention again, this is a one-line revert in `computePricing`.
- If we need to keep BDY-priced legacy certs side-by-side with new MMY certs (which would require knowing which formula was used at issue time), we'd need to add a `rate_basis_method` column. Not needed today (the database is empty of certs at the time of this change).
- The investor's effective yield (annualized on capital) is now exactly equal to the contracted rate. Operators should be aware that quoting "13%" no longer carries the BDY's implicit upward adjustment.

## References

- Spec: `docs/superpowers/specs/2026-05-12-money-market-yield-design.md`
- Plan: `docs/superpowers/plans/2026-05-12-money-market-yield.md`
- Project context: `CLAUDE.md` ("Producto en 1 página" / "Cálculos")
- Regulatory framework: Circular SUNAVAL DSNV/GCI/00014 (does not mandate a specific discount-formula convention; both BDY and MMY are compliant)

# Money Market Yield convention Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Switch CFB price formula from Bank Discount Yield (`1 − r×d/360`) to Money Market Yield (`1 / (1 + r×d/360)`) so values align with Mercantil Merinvest's reports.

**Architecture:** One-line math change in the centralized `computePricing` function. Test fixtures recomputed across 4 files. Docs updated (CLAUDE.md + new ADR). No DB migration, no front change, no OpenAPI regeneration.

**Tech Stack:** NestJS 10, Prisma 5 Decimal arithmetic, Vitest.

**Spec:** `/Users/llam/dev/araguaney_back/docs/superpowers/specs/2026-05-12-money-market-yield-design.md`

**Working directory note:** all code is in `/Users/llam/dev/araguaney_back/`. The branch `chore/money-market-yield` already exists from the brainstorming step (Task 1 verifies it).

---

## File Structure

| Path | Action | Responsibility |
|---|---|---|
| `src/modules/issuance/certificates/pricing/pricing.ts` | modify | One-line change inside `computePricing` |
| `src/modules/issuance/certificates/pricing/pricing.test.ts` | modify | Recompute 3 pinned price/nominalTarget values + 3 payout fixtures |
| `src/modules/issuance/certificates/certificates.service.test.ts` | modify | Update the `mockCert()` fixture (price + downstream values) |
| `src/modules/issuance/certificates/payload-hash/payload-hash.test.ts` | modify | Cosmetic: update fixture to MMY values for consistency |
| `src/modules/issuance/sweep/sweep.service.test.ts` | modify | Update one pinned value: `investor_capital = '99.6899'` |
| `CLAUDE.md` | modify | 3 edits: Modalidad line, Cálculos block, Decisiones list |
| `docs/DECISIONS/2026-05-12-money-market-yield.md` | create | ADR with full rationale |

**Total:** 1 new file + 6 modifications. No new tests added — same count, recomputed fixtures.

---

## Pre-flight: canonical MMY values (computed)

For the implementer's reference. These come from `Prisma.Decimal` arithmetic with `HALF_UP` rounding:

| Input | New value |
|---|---|
| `computePricing({ rate: 0.13, termDays: 42 }).price` | `0.985060` |
| `computePricing({ rate: 0.08, termDays: 14 }).price` | `0.996899` |
| `computePricing({ rate: 0, ... }).price` | `1.000000` (unchanged) |
| `computePricing({ capital: 100000, rate: 0.13, termDays: 42 }).nominalTarget` | `101516.6589` |

If your `Prisma.Decimal` output differs from these by ±1 at the last decimal due to rounding edge cases, the test failure message will tell you the actual value — pin that. Don't fight the math; trust the library.

---

## Task 1: Verify branch + baseline tests

**Why:** Confirm we're on the right branch and that the test suite is green BEFORE making changes — so we can attribute any future failure to our edits.

**Files:** none

- [ ] **Step 1: Verify branch**

```bash
cd /Users/llam/dev/araguaney_back
git status
```

Expected: `On branch chore/money-market-yield`, clean working tree. If you're on `main`, run:

```bash
git fetch origin --prune
git checkout chore/money-market-yield 2>/dev/null || git checkout -b chore/money-market-yield
```

- [ ] **Step 2: Baseline suite**

```bash
cd /Users/llam/dev/araguaney_back
npm run lint && npm run typecheck && npm test
```

Expected: all green. Note the test count for later comparison.

- [ ] **Step 3: Confirm DB state (no historical certs to migrate)**

The spec assumes 0 certificates in production. If you have DB access, verify:

```sql
SELECT count(*) FROM cfb.certificates;
```

Expected: `0`. If non-zero, **STOP** and surface to the controller — there are emitted certs with BDY prices that would need a separate migration decision. Do not proceed with code changes until that's resolved.

If you don't have DB access, mark this step as deferred and surface it in the final PR description so the user verifies before merging.

- [ ] **Step 4: No commit**

This is verification only.

---

## Task 2: Switch `computePricing` formula

**Why:** The core change. Single line in one function.

**Files:**
- Modify: `src/modules/issuance/certificates/pricing/pricing.ts`

- [ ] **Step 1: Edit the price formula**

Open `/Users/llam/dev/araguaney_back/src/modules/issuance/certificates/pricing/pricing.ts`. Find this block in `computePricing`:

```ts
export function computePricing(i: PricingInputs): Pricing {
  const ratio = i.rate.mul(i.termDays).div(360);
  const price = new D(1).minus(ratio).toDecimalPlaces(6, D.ROUND_HALF_UP);
  const nominalTarget = i.capital.div(price).toDecimalPlaces(4, D.ROUND_HALF_UP);
  return { price, nominalTarget };
}
```

Replace with:

```ts
export function computePricing(i: PricingInputs): Pricing {
  // Money Market Yield: price = 1 / (1 + rate × days / 360).
  // The "rate" is the simple-interest annualized yield the investor earns on
  // their invested capital (Actual/360). See docs/DECISIONS/2026-05-12-money-market-yield.md.
  const ratio = i.rate.mul(i.termDays).div(360);
  const price = new D(1)
    .div(new D(1).plus(ratio))
    .toDecimalPlaces(6, D.ROUND_HALF_UP);
  const nominalTarget = i.capital.div(price).toDecimalPlaces(4, D.ROUND_HALF_UP);
  return { price, nominalTarget };
}
```

- [ ] **Step 2: Run pricing tests — expect failures**

```bash
cd /Users/llam/dev/araguaney_back
npm test src/modules/issuance/certificates/pricing/pricing.test.ts
```

Expected: at least 2 failures (`computes price for 13% × 42d as 0.984833` and `computes price for 8% × 14d as 0.996889` — they assert the old BDY values).

Note the **actual** values reported by the test runner. They should match: `'0.985060'` and `'0.996899'` respectively. If they don't, surface the discrepancy before proceeding (don't pin "whatever the runner outputs" without verifying it).

- [ ] **Step 3: No commit yet**

The next task updates the tests; we'll commit code + tests together so each commit is a passing state.

---

## Task 3: Update `pricing.test.ts` fixtures

**Why:** Pin the new MMY values so future regressions to BDY get caught.

**Files:**
- Modify: `src/modules/issuance/certificates/pricing/pricing.test.ts`

- [ ] **Step 1: Update test 1 (13% × 42d price)**

Find:

```ts
  it('computes price for 13% × 42d as 0.984833', () => {
    const r = computePricing({ capital: D('100000'), rate: D('0.13'), termDays: 42 });
    expect(r.price.toFixed(6)).toBe('0.984833');
  });
```

Replace with:

```ts
  it('computes price for 13% × 42d as 0.985060 (MMY)', () => {
    const r = computePricing({ capital: D('100000'), rate: D('0.13'), termDays: 42 });
    expect(r.price.toFixed(6)).toBe('0.985060');
  });
```

- [ ] **Step 2: Update test 2 (8% × 14d price)**

Find:

```ts
  it('computes price for 8% × 14d as 0.996889', () => {
    const r = computePricing({ capital: D('100000'), rate: D('0.08'), termDays: 14 });
    expect(r.price.toFixed(6)).toBe('0.996889');
  });
```

Replace with:

```ts
  it('computes price for 8% × 14d as 0.996899 (MMY)', () => {
    const r = computePricing({ capital: D('100000'), rate: D('0.08'), termDays: 14 });
    expect(r.price.toFixed(6)).toBe('0.996899');
  });
```

- [ ] **Step 3: Update test 3 (nominal_target)**

Find:

```ts
  it('computes nominal_target = capital / price (HALF_UP to 4 decimals)', () => {
    const r = computePricing({ capital: D('100000'), rate: D('0.13'), termDays: 42 });
    expect(r.nominalTarget.toFixed(4)).toBe('101540.0581');
  });
```

Replace with:

```ts
  it('computes nominal_target = capital / price (HALF_UP to 4 decimals)', () => {
    const r = computePricing({ capital: D('100000'), rate: D('0.13'), termDays: 42 });
    expect(r.nominalTarget.toFixed(4)).toBe('101516.6589');
  });
```

- [ ] **Step 4: Test 4 (zero rate) is unchanged**

```ts
  it('handles zero rate → price = 1, target = capital', () => {
    const r = computePricing({ capital: D('1000'), rate: D('0'), termDays: 14 });
    expect(r.price.toFixed(6)).toBe('1.000000');
    expect(r.nominalTarget.toFixed(4)).toBe('1000.0000');
  });
```

Both assertions are still correct (1/(1+0) = 1). Leave untouched.

- [ ] **Step 5: Update the three `computePayouts` fixtures**

Find each of the three `computePayouts` tests that pin `price: D('0.984833')` and update the fixture inputs + assertions:

Test "investor_paid = nominal_actual × price (HALF_UP to 4 decimals)":

```ts
  it('investor_paid = nominal_actual × price (HALF_UP to 4 decimals)', () => {
    const r = computePayouts({
      capital: D('100000'),
      price: D('0.985060'),
      nominalTarget: D('101516.6589'),
      nominalActual: D('101516.0034'),
    });
    expect(r.investorPaid.toFixed(4)).toBe('99999.3543');
  });
```

Test "investor_returned = capital − investor_paid":

```ts
  it('investor_returned = capital − investor_paid', () => {
    const r = computePayouts({
      capital: D('100000'),
      price: D('0.985060'),
      nominalTarget: D('101516.6589'),
      nominalActual: D('101516.0034'),
    });
    // investor_paid = 99999.3543, returned = 100000 - 99999.3543 = 0.6457
    expect(r.investorReturned.toFixed(4)).toBe('0.6457');
  });
```

Test "shortfall_pct is zero when nominal_actual == target":

```ts
  it('shortfall_pct is zero when nominal_actual == target', () => {
    const r = computePayouts({
      capital: D('100000'),
      price: D('0.985060'),
      nominalTarget: D('101516.6589'),
      nominalActual: D('101516.6589'),
    });
    expect(r.shortfallPct.toFixed(6)).toBe('0.000000');
  });
```

The last test ("shortfall_pct returns 0 when nominalTarget is zero") is purely a divide-by-zero guard — no MMY-specific values. Leave untouched.

- [ ] **Step 6: Run tests + verify**

```bash
cd /Users/llam/dev/araguaney_back
npm test src/modules/issuance/certificates/pricing/pricing.test.ts
```

Expected: all green. If `investor_paid` or `investor_returned` fail with values like `99999.3542` vs `99999.3543`, that's a 1-cent rounding edge case — pin whatever the runner reports as the **actual** output and re-run.

- [ ] **Step 7: Commit code + pricing tests together**

```bash
cd /Users/llam/dev/araguaney_back
git add src/modules/issuance/certificates/pricing/pricing.ts \
        src/modules/issuance/certificates/pricing/pricing.test.ts
git commit -m "$(cat <<'EOF'
feat(pricing): switch CFB price formula to Money Market Yield

Change `price = 1 - r×d/360` (Bank Discount Yield) to
`price = 1 / (1 + r×d/360)` (Money Market Yield). The annual rate now
represents the simple-interest yield the investor earns on invested
capital (Actual/360) — matching Mercantil's reports.

13% × 42d: 0.984833 → 0.985060
 8% × 14d: 0.996889 → 0.996899

See docs/DECISIONS/2026-05-12-money-market-yield.md for the rationale.

Co-Authored-By: Claude Opus 4.7 <noreply@anthropic.com>
EOF
)"
```

---

## Task 4: Update `certificates.service.test.ts` fixture

**Why:** The mock cert in this test pins BDY values that downstream assertions might depend on.

**Files:**
- Modify: `src/modules/issuance/certificates/certificates.service.test.ts`

- [ ] **Step 1: Locate the fixture**

Open the file. Around line 580, find this block:

```ts
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
    nominal_target: D('101540.0581'),
    nominal_actual: D('101540'),
    investor_paid: D('99999.9462'),
    investor_returned: D('0.0538'),
    investor_yield: D('1540.0538'),
    shortfall_pct: D('0.000001'),
    issue_date: new Date('2026-04-27'),
    ...
```

- [ ] **Step 2: Update the financial fields**

Replace the 7 financial lines (`price` through `shortfall_pct`):

```ts
    price: D('0.985060'),
    nominal_target: D('101516.6589'),
    nominal_actual: D('101516'),
    investor_paid: D('99999.3510'),
    investor_returned: D('0.6490'),
    investor_yield: D('1516.6490'),
    shortfall_pct: D('0.000006'),
```

(Math sanity: `101516 × 0.985060 = 99999.35096 → 99999.3510 HALF_UP at 4 decimals`. `100000 − 99999.3510 = 0.6490`. `101516 − 99999.3510 = 1516.6490`. `(101516.6589 − 101516) / 101516.6589 = 0.6589/101516.6589 = 6.49×10⁻⁶ → 0.000006 HALF_UP at 6 decimals`.)

- [ ] **Step 3: Run the file's tests**

```bash
cd /Users/llam/dev/araguaney_back
npm test src/modules/issuance/certificates/certificates.service.test.ts
```

Expected: green. If any test asserts on the specific fields (`price`, `nominal_target`, etc.) downstream, you'll see those tests fail and need to update their pinned strings to match the new fixture. Update them.

Look in particular for tests that do something like:

```ts
expect(mapped.price).toBe('0.984833')
```

Update to `'0.985060'` and similar across all the dependent values.

- [ ] **Step 4: Commit**

```bash
cd /Users/llam/dev/araguaney_back
git add src/modules/issuance/certificates/certificates.service.test.ts
git commit -m "$(cat <<'EOF'
test(certificates): update service-level fixture to MMY values

Mirror the pricing change from the previous commit. The mock cert
fixture now matches what computePricing+computePayouts would actually
produce under MMY.

Co-Authored-By: Claude Opus 4.7 <noreply@anthropic.com>
EOF
)"
```

---

## Task 5: Update `payload-hash.test.ts` fixture

**Why:** Cosmetic alignment. The hash tests don't pin specific hash values, so the fixture values don't affect test outcomes — but keeping the fixture realistic helps future readers understand the test.

**Files:**
- Modify: `src/modules/issuance/certificates/payload-hash/payload-hash.test.ts`

- [ ] **Step 1: Update the fixture**

Open the file. The `input()` function at the top has BDY values. Replace the `outputs` block:

```ts
    outputs: {
      price: '0.985060',
      nominal_target: '101516.6589',
      nominal_actual: '101516.0034',
      investor_paid: '99999.3543',
      investor_returned: '0.6457',
      investor_yield: '1516.6491',
      shortfall_pct: '0.000006',
    },
```

(Math sanity: same as Task 3 Step 5's payouts test — `101516.0034 × 0.985060 = 99999.3543`. `investor_yield = 101516.0034 − 99999.3543 = 1516.6491`. `investor_returned = 100000 − 99999.3543 = 0.6457`. Shortfall same.)

- [ ] **Step 2: Run + verify**

```bash
cd /Users/llam/dev/araguaney_back
npm test src/modules/issuance/certificates/payload-hash/payload-hash.test.ts
```

Expected: all 4 tests green. They check structural properties (regex, determinism, sort canonicalization, sensitivity to capital change) — none pin a specific hash.

- [ ] **Step 3: Commit**

```bash
cd /Users/llam/dev/araguaney_back
git add src/modules/issuance/certificates/payload-hash/payload-hash.test.ts
git commit -m "$(cat <<'EOF'
test(payload-hash): refresh fixture to MMY values

Cosmetic only — payload-hash tests don't pin specific hash values, so
the fixture math doesn't change test outcomes. Updated for readability.

Co-Authored-By: Claude Opus 4.7 <noreply@anthropic.com>
EOF
)"
```

---

## Task 6: Update `sweep.service.test.ts` pinned value

**Why:** One test asserts the precise capital from a sweep with 8% × 14d pricing.

**Files:**
- Modify: `src/modules/issuance/sweep/sweep.service.test.ts`

- [ ] **Step 1: Update the pinned value**

Around line 94, find:

```ts
    // capital = 100 × price(0.08, 14d) = 100 × 0.996889 = 99.6889
    expect(r.payouts!.investor_capital).toBe('99.6889');
```

Replace with:

```ts
    // capital = 100 × price(0.08, 14d) = 100 × 0.996899 = 99.6899
    expect(r.payouts!.investor_capital).toBe('99.6899');
```

- [ ] **Step 2: Run + verify**

```bash
cd /Users/llam/dev/araguaney_back
npm test src/modules/issuance/sweep/sweep.service.test.ts
```

Expected: all tests green. If other sweep tests pin downstream MMY-affected values (look for grepable strings like `0.996889`, `99.6889`, etc.), update them too. Use `grep -n '0\.9968\|99\.6889' src/modules/issuance/sweep/sweep.service.test.ts` to find any others.

- [ ] **Step 3: Commit**

```bash
cd /Users/llam/dev/araguaney_back
git add src/modules/issuance/sweep/sweep.service.test.ts
git commit -m "$(cat <<'EOF'
test(sweep): update pinned capital to MMY (99.6889 → 99.6899)

Co-Authored-By: Claude Opus 4.7 <noreply@anthropic.com>
EOF
)"
```

---

## Task 7: Update `CLAUDE.md`

**Why:** The project context file documents the formula. Future agents reading it must see the current convention.

**Files:**
- Modify: `CLAUDE.md`

- [ ] **Step 1: Edit "Modalidad" line**

Find (around line 41):

```markdown
- **Modalidad**: A descuento (`price = 1 - rate × days / 360`)
```

Replace with:

```markdown
- **Modalidad**: Money market yield (`price = 1 / (1 + rate × days / 360)`). La "tasa anual" representa el **rendimiento simple anualizado** que recibe el inversor sobre su capital invertido (Actual/360), no un descuento sobre el nominal. Ver `docs/DECISIONS/2026-05-12-money-market-yield.md`.
```

- [ ] **Step 2: Edit "Cálculos" block**

Find (around line 47-55):

```markdown
```
price             = 1 − (annual_rate × term_days / 360)
nominal_target    = investor_capital / price
nominal_actual    = Σ installments_sum de orders asignadas (≤ target)
investor_paid     = nominal_actual × price
investor_returned = investor_capital − investor_paid    (cash refund)
investor_yield    = nominal_actual − investor_paid      (paid at maturity)
shortfall_pct     = (nominal_target − nominal_actual) / nominal_target
```
```

Replace only the `price` line. The rest is unchanged because everything downstream is expressed in terms of `price`:

```markdown
```
price             = 1 / (1 + annual_rate × term_days / 360)
nominal_target    = investor_capital / price
nominal_actual    = Σ installments_sum de orders asignadas (≤ target)
investor_paid     = nominal_actual × price
investor_returned = investor_capital − investor_paid    (cash refund)
investor_yield    = nominal_actual − investor_paid      (paid at maturity)
shortfall_pct     = (nominal_target − nominal_actual) / nominal_target
```
```

- [ ] **Step 3: Edit "Decisiones ya tomadas" list**

Find the bulleted list (around line 196-206) and append at the end (before the closing `## Glosario` section):

```markdown
- Money market yield para `price` (`1 / (1 + r × d / 360)`) en vez de bank discount yield (`1 − r × d / 360`) — convención de Mercantil Merinvest, 2026-05-12. Ver `docs/DECISIONS/2026-05-12-money-market-yield.md`.
```

- [ ] **Step 4: Verify the edits**

```bash
cd /Users/llam/dev/araguaney_back
grep -n "Modalidad\|1 / (1 +\|money market yield\|Money market yield" CLAUDE.md
```

Expected: three matches showing the new formula references.

- [ ] **Step 5: Commit**

```bash
cd /Users/llam/dev/araguaney_back
git add CLAUDE.md
git commit -m "$(cat <<'EOF'
docs(claude): update CFB pricing formula to MMY

Reflect the BDY→MMY change in the project context file:
- Modalidad line: new formula
- Cálculos block: price line updated
- Decisiones list: append entry pointing to ADR

Co-Authored-By: Claude Opus 4.7 <noreply@anthropic.com>
EOF
)"
```

---

## Task 8: Create the ADR

**Why:** Future contributors need to understand why we don't use the "obvious" BDY formula that's standard in U.S. T-Bills, CETES, and most "letras del Tesoro" worldwide.

**Files:**
- Create: `docs/DECISIONS/2026-05-12-money-market-yield.md`

- [ ] **Step 1: Verify directory exists**

```bash
cd /Users/llam/dev/araguaney_back
ls -d docs/DECISIONS
```

If missing: `mkdir -p docs/DECISIONS`.

- [ ] **Step 2: Write the ADR**

Create `/Users/llam/dev/araguaney_back/docs/DECISIONS/2026-05-12-money-market-yield.md` with this content:

```markdown
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
```

- [ ] **Step 3: Commit**

```bash
cd /Users/llam/dev/araguaney_back
git add docs/DECISIONS/2026-05-12-money-market-yield.md
git commit -m "$(cat <<'EOF'
docs(adr): money market yield for CFB pricing

Capture the BDY→MMY decision with full rationale, side-by-side math,
and what does/doesn't change. Future contributors who see
1/(1+r×d/360) instead of the "obvious" 1−r×d/360 should land here.

Co-Authored-By: Claude Opus 4.7 <noreply@anthropic.com>
EOF
)"
```

---

## Task 9: Full-suite verification + OpenAPI guard

**Why:** Belt-and-braces. Confirm the entire test suite is green and that we haven't accidentally drifted the OpenAPI contract.

**Files:** none.

- [ ] **Step 1: Run the full suite**

```bash
cd /Users/llam/dev/araguaney_back
npm run lint && npm run typecheck && npm test
```

Expected: all green. Test count should match the baseline from Task 1 (no tests added or removed).

- [ ] **Step 2: Regenerate OpenAPI and confirm no schema drift**

```bash
cd /Users/llam/dev/araguaney_back
npm run openapi:export
git diff openapi.json
```

Expected: **no output from `git diff`**. The wire shape didn't change (only computed values did, which aren't part of the schema). If `openapi.json` did change, surface the diff to the controller before committing — it likely means an unrelated change snuck in.

If the diff is empty: nothing to commit. Move on.

- [ ] **Step 3: Verify all 7 commits landed**

```bash
cd /Users/llam/dev/araguaney_back
git log --oneline main..HEAD
```

Expected: 7 commits, all signed with the Co-Authored-By line. Approximate titles:

```
docs(adr): money market yield for CFB pricing
docs(claude): update CFB pricing formula to MMY
test(sweep): update pinned capital to MMY (99.6889 → 99.6899)
test(payload-hash): refresh fixture to MMY values
test(certificates): update service-level fixture to MMY values
feat(pricing): switch CFB price formula to Money Market Yield
docs(spec): MMY pricing convention for CFB
```

(The spec doc was already committed during the brainstorming phase — it's the first commit on the branch.)

- [ ] **Step 4: No commit**

This is verification only.

---

## Task 10: Push branch + open PR

**Files:** none.

- [ ] **Step 1: Push**

```bash
cd /Users/llam/dev/araguaney_back
git push -u origin chore/money-market-yield
```

If the branch is already pushed (from the spec commit), this is a no-op force-update for the new commits.

- [ ] **Step 2: Open PR**

```bash
gh pr create --title "chore: switch CFB pricing from BDY to MMY" --body "$(cat <<'EOF'
## Summary

Switch the CFB \`price\` formula from Bank Discount Yield to Money Market Yield to align with how the estructurador (Mercantil Merinvest) computes and reports the same instrument.

- **Before**: \`price = 1 − rate × days / 360\` (BDY — same convention as U.S. T-Bills, CETES)
- **After**: \`price = 1 / (1 + rate × days / 360)\` (MMY — Eurodollar / money-market / private placements)

The contracted annual rate now means "simple-interest yield the investor earns on invested capital (Actual/360)" instead of "discount applied to face value". Day-count convention (Actual/360) is unchanged.

## Trigger

Comparing cert C4572A side-by-side with Mercantil's spreadsheet showed Mercantil uses MMY (their labels "Retorno efectivo (42 días) 1.52%" and "Descuento 1.49%" are MMY language). Aligning eliminates a per-emission reconciliation step.

## What changes

- \`src/modules/issuance/certificates/pricing/pricing.ts\` — one line inside \`computePricing\`
- Test fixtures across 4 files (recomputed with MMY: 13%×42d \`0.984833\` → \`0.985060\`, 8%×14d \`0.996889\` → \`0.996899\`)
- \`CLAUDE.md\` — 3 small edits documenting the new formula
- New ADR at \`docs/DECISIONS/2026-05-12-money-market-yield.md\` with full reasoning

## What does NOT change

- DB schema (\`price numeric(10,8)\` and the CHECK constraint are valid for both formulas)
- OpenAPI wire shape (no schema drift — verified)
- Frontend code (doesn't compute pricing, only displays)
- \`payload_hash\` structure (new sims will have different hashes; that's correct)
- Day-count convention (stays Actual/360)
- No DB migration: the \`cfb.certificates\` table is empty at merge time

## Test Plan

- [x] \`npm run lint && npm run typecheck && npm test\` — todo verde, mismo count que baseline
- [x] \`git diff openapi.json\` después de regen — vacío
- [ ] Verificar pre-merge: \`SELECT count(*) FROM cfb.certificates\` = 0 en prod
- [ ] Post-deploy: emitir un cert de prueba ($1000, 13%, 42d) y comparar con la planilla de Mercantil — los números deben cuadrar

## Files

- \`src/modules/issuance/certificates/pricing/pricing.ts\` (formula)
- \`src/modules/issuance/certificates/pricing/pricing.test.ts\` (fixtures)
- \`src/modules/issuance/certificates/certificates.service.test.ts\` (mock cert)
- \`src/modules/issuance/certificates/payload-hash/payload-hash.test.ts\` (cosmetic fixture)
- \`src/modules/issuance/sweep/sweep.service.test.ts\` (pinned capital)
- \`CLAUDE.md\` (docs)
- \`docs/DECISIONS/2026-05-12-money-market-yield.md\` (new ADR)
- \`docs/superpowers/specs/2026-05-12-money-market-yield-design.md\` (spec, already committed)
- \`docs/superpowers/plans/2026-05-12-money-market-yield.md\` (this plan, already committed)

🤖 Generated with [Claude Code](https://claude.com/claude-code)
EOF
)"
```

If `gh` fails on "must be a collaborator", surface the URL and let the user open the PR manually.

- [ ] **Step 3: Watch CI**

```bash
until gh run list --repo armandogois-lab/araguaney_back --limit 1 --json status -q '.[0].status' | grep -q completed; do sleep 5; done
gh run list --repo armandogois-lab/araguaney_back --limit 1
```

Expected: green ✓.

---

## Summary

**What changes**

- One-line math change in `computePricing`.
- Test fixtures across 4 files (recomputed for MMY).
- `CLAUDE.md` (3 edits) + new ADR.

**Test Plan**

- [x] `npm run lint && npm run typecheck && npm test` — all clean
- [x] `git diff openapi.json` after regen — empty (no schema drift)

**Notes**

- No DB migration (certs table empty at merge time — verify with `SELECT count(*) FROM cfb.certificates` before merging).
- No front change. No OpenAPI regen needed.
- This is a one-line revert if Mercantil ever changes their mind.

---

## Self-Review

**Spec coverage:**

- ✅ Math change in `pricing.ts` — Task 2
- ✅ Test fixture updates in `pricing.test.ts` — Task 3
- ✅ Test fixture updates in `certificates.service.test.ts` — Task 4
- ✅ Test fixture updates in `payload-hash.test.ts` — Task 5
- ✅ Test fixture updates in `sweep.service.test.ts` — Task 6
- ✅ `CLAUDE.md` 3 edits — Task 7
- ✅ ADR creation — Task 8
- ✅ OpenAPI no-drift verification — Task 9
- ✅ DB-empty precondition check — Task 1 step 3 + PR test plan
- ✅ Full-suite green — Tasks 1 (baseline) and 9 (final)
- ✅ Push + PR — Task 10

**Placeholder scan:**

- "If non-zero, **STOP**" (Task 1) — instruction, not a placeholder.
- "Use `grep -n` to find any others" (Task 6) — concrete command, not vague.
- "Pin whatever the runner reports as the actual output" (Task 3) — has explicit guard ("if values differ by ±1 at the last decimal due to rounding edge cases"). This is a known feature of Decimal math, documented up front in the Pre-flight section.
- No TODOs, no TBDs, no "implement later".

**Type/value consistency:**

- `0.985060` consistently used across pricing.test.ts (Task 3), certificates.service.test.ts (Task 4), payload-hash.test.ts (Task 5), and the ADR (Task 8).
- `0.996899` consistently used in pricing.test.ts (Task 3) and sweep.service.test.ts (Task 6).
- `101516.6589` consistently used in pricing.test.ts (Task 3) and certificates.service.test.ts (Task 4) and payload-hash.test.ts (Task 5).
- The illustrative `$152,275` in the ADR/PR refers to a $150k cert (the screenshot example), not the $100k canonical test fixture — intentional, not an inconsistency.
- `computePricing` and `computePayouts` function signatures unchanged.
- `nominal_actual` is `D('101516')` in Task 4's mock (whole number, mirroring the original style which used `D('101540')`) and `D('101516.0034')` in Task 3's payouts test + Task 5's payload-hash fixture (decimal value). Both are valid — they represent different "round-down" scenarios; not a contradiction.

---

**Plan complete and saved to `docs/superpowers/plans/2026-05-12-money-market-yield.md`. Two execution options:**

**1. Subagent-Driven (recommended)** — Fresh subagent per task + two-stage review.

**2. Inline Execution** — Same session with batch checkpoints.

**Which approach?**

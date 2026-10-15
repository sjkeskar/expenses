# BUG-008: Floating-point money maths rejects exact amounts (e.g. 0.30 − 0.10)

| Field | Value |
|---|---|
| Status | Open |
| Severity | Medium |
| Area | Bills / Transactions API (`src/routes/bills.js`, `src/routes/transactions.js`, `src/routes/companies.js`) |
| Reported | 2026-10-15 |
| Found by | Code review; confirmed by E2E `billing/create-bill.spec.js` › D21b, `billing/record-payment.spec.js` › E10 |
| Assignee | — |
| Resolution | — |
| Verified by | — |

## Summary

Money is stored as `Decimal(12,2)`, but every calculation and comparison is
done with JavaScript `Number` (binary floating point). Some exact paisa
amounts are then judged "too much" and rejected:

- Create Bill: MRP 0.30, discount 0.10, collect 0.20 now →
  **"Amount collected now cannot exceed the bill's net amount."**
  (0.30 − 0.10 = 0.19999999999999998).
- Record Payment: balance 0.30, pay 0.10 with 0.20 discount →
  **"amountCollected + discountAmount (0.30000000000000004) exceeds the
  remaining balance (0.3)."** The internal float also shows up in the user's
  error message.

The same pattern can leave a balance of a fraction of a paisa (e.g.
`5.000000000000001e-17`), keeping a bill "pending" after it was paid in
full.

## Steps to reproduce

See summary; both cases are reproducible from the UI.

## Expected

Exact amounts (to 2 decimal places) are accepted, and error messages show
2-decimal values.

## Actual

They're rejected as shown above.

## Root cause

- `src/routes/bills.js:143` (`const netAmount = original - discount`) and
  `:153` (`initialAmount > netAmount`).
- `src/routes/transactions.js:67-68` (`amount + discount` then
  `total > Number(bill.balance)`), and the same pattern in PATCH and DELETE.

## Suggested fix

Do money maths in integer paise (`Math.round(x * 100)`) or with
`Prisma.Decimal`, and compare the resulting integers/Decimals. Format any
amounts in messages with `toFixed(2)`.

## Linked tests

- `e2e/specs/billing/create-bill.spec.js` › `D21b: collecting exactly the net amount on a fractional bill is accepted` (operator & admin): `knownBug("BUG-008")`
- `e2e/specs/billing/record-payment.spec.js` › `E10: amount + discount that exactly equals a fractional balance is accepted` (operator & admin): `knownBug("BUG-008")`

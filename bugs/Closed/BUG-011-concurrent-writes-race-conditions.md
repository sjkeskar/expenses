# BUG-011: Concurrent payments/settlements overpay bills; concurrent reassignments corrupt the audit trail

| Field | Value |
|---|---|
| Status | Closed |
| Severity | Critical |
| Area | Bills / Transactions / Settlement API |
| Reported | 2026-10-15 |
| Found by | E2E `robustness/concurrency.spec.js` › L2, L5, L6 (reproduced in 3/3 runs) |
| Assignee | — |
| Resolution | Batch 1 of `bugs/FIX-PLAN.md` — `SELECT ... FOR UPDATE` row lock taken before the read in all five write transactions, settlement locking ids one at a time in sorted order |
| Verified by | `robustness/concurrency.spec.js` › L2, L5, L6, green in a full `npm run test:e2e` run on 2026-10-15 |

## Summary

Every write that reads a bill and then updates it does so inside a Prisma
`$transaction` at Postgres's default **READ COMMITTED** isolation, without
locking the bill row. Two requests for the same bill both read the same
starting balance, both pass validation, and both write. With 6+ operators
working at once, this happens in practice:

| Scenario (test) | Result observed |
|---|---|
| Two operators each pay ₹60 on a ₹100 bill at the same moment (L2) | **Both accepted: ₹120 collected** on a ₹100 bill; the stored balance ignores one payment |
| A company settlement and a ₹40 payment hit the same bill (L5) | **₹140 collected** on a ₹100 bill |
| Two admins reassign the same bill at the same moment (L6) | The append-only `bill_reassignments` chain no longer matches `Bill.createdById`: the "from" operator of a move isn't the previous move's "to" |

The "Record Payment can top up any bill" design makes the payment race
realistic: two operators can easily be serving the same client.

## Steps to reproduce

Run `E2E_SHOW_BUGS=1 npx playwright test e2e/specs/robustness/concurrency.spec.js`.
Or send two `POST /api/transactions` requests for the same bill at once, with
amounts that each fit the balance but together exceed it.

## Expected

The second write sees the first one's result: it's rejected ("exceeds the
remaining balance" / "not pending"), or it applies on top of the updated
balance. The audit trail always forms an unbroken chain.

## Actual

Both writes succeed against stale data.

## Root cause

Read-then-write without a row lock:
- `src/routes/transactions.js:60` (POST), and the same in PATCH/DELETE
- `src/routes/companies.js:87` (settle)
- `src/routes/bills.js:275` (refund) and `:343` (reassign-operator)

## Suggested fix

Lock the bill row(s) at the start of each transaction:
`await tx.$queryRaw\`SELECT 1 FROM "bills" WHERE "id" = ${id} FOR UPDATE\``
(for settlement, lock every selected id in a stable order). Alternatively,
make the update conditional and atomic, e.g.
`UPDATE bills SET balance = balance - $1 WHERE id = $2 AND balance >= $1`,
and check the affected row count. Running these transactions at
`Serializable` isolation, with a retry on a serialization failure, also
works.

## Linked tests

- `e2e/specs/robustness/concurrency.spec.js` › `L2`, `L5`, `L6`: `knownBug("BUG-011")`
- `L4` (refund vs payment) is a passing guard test; it didn't reproduce, but
  the same fix covers it.

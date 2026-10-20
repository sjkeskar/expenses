# BUG-020: After a failed settlement, the settle list can't be refreshed by re-picking the company

| Field | Value |
|---|---|
| Status | Closed |
| Severity | Low |
| Area | Operator / Admin UI: Settle Company Balance (`public/js/common.js` `attachCombobox`, settle click handler in `public/js/operator.js` / `public/js/admin.js`) |
| Reported | 2026-10-16 |
| Found by | Re-test after the BUG-019 fix; confirmed by E2E `billing/settle.spec.js` › F17 (operator and admin) |
| Assignee | — |
| Resolution | The settle click handler's `catch` in `public/js/operator.js` and `public/js/admin.js` now calls `loadSettleBillsList(companyId)` after showing the error, so the list drops bills that are no longer pending and keeps the ticks on those that are (via the BUG-019 tick carry-over). `attachCombobox` is unchanged, so BUG-019's de-duplication stays intact |
| Verified by | `billing/settle.spec.js` › F17 (operator and admin), 3/3 repeats; full `npm run test:e2e` green on 2026-10-21 |

## Summary

A side effect of the BUG-019 fix. That fix made `attachCombobox()` fire
`onSelect` only when the selected item **changes**, and its own code comment
notes the trade-off: "re-picking the item that is already selected no longer
forces a refresh".

This bites when a settlement fails because one of the ticked bills was paid
elsewhere in the meantime (another operator took the payment):

1. **Settle Selected Bills** correctly refuses: "Bill X is not pending
   (already fully paid)." Nothing is settled.
2. The list isn't refreshed after the error, so bill X stays on screen,
   **still ticked**.
3. The operator's natural recovery is to re-pick the company from the
   dropdown, which reloaded the list before the BUG-019 fix. It now does
   nothing, because that company is already the selected one.
4. Pressing Settle again fails with the same error, until the operator
   spots and unticks bill X themselves, or clears and retypes the company
   name.

No wrong data can result (the server rejects the whole settlement), but the
operator is stuck with an error they can't clear the obvious way.

## Steps to reproduce

1. Settle Company Balance › pick a company with two pending bills. Tick both.
2. Elsewhere (another session or the API), pay off one of them in full.
3. Click **Settle Selected Bills**. You get "Bill X is not pending (already
   fully paid)."
4. Click the Company field and choose the same company from the dropdown.

## Expected

The list shows only bills still pending (X is gone). The other bill stays
ticked, and Settle succeeds.

## Actual

Re-picking makes no request. Bill X is still listed and ticked, and Settle
fails again.

## Root cause

- `public/js/common.js:201`: `notifySelection()` returns early when the item
  is the one already selected (`item.id === notifiedId`), so the settle
  picker's `onSelect` → `loadSettleBillsList()` isn't called.
- The settle click handler (`public/js/operator.js:437`, `public/js/admin.js:585`)
  only shows the error in its `catch` and doesn't reload the list.

## Suggested fix

In the settle handler's `catch`, call
`loadSettleBillsList(companyId)` after showing the error. The BUG-019 fix
already carries ticks across reloads and drops bills that are no longer
pending, so the operator is left with just the still-owed bills, ticked, and
can press Settle again. This keeps the BUG-019 de-duplication intact (no
change to `attachCombobox`). Optionally, add a small "Refresh" button next to
the list.

## Linked tests

- `e2e/specs/billing/settle.spec.js` › `F17: after a settlement fails on a bill paid elsewhere, the operator can get a fresh list` (operator and admin): now a normal regression test (its `knownBug` marker was removed when this was fixed).

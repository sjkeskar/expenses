# BUG-019: Picking a settlement company loads its bills twice; the second load wipes ticked bills

| Field | Value |
|---|---|
| Status | Open |
| Severity | Medium |
| Area | Operator / Admin UI: Settle Company Balance (`public/js/common.js` `attachCombobox`, `loadSettleBillsList` in `public/js/operator.js` / `public/js/admin.js`) |
| Reported | 2026-10-16 |
| Found by | E2E `accessibility/keyboard.spec.js` › M3d, which failed intermittently; confirmed deterministically by `billing/settle.spec.js` › F14 |
| Assignee | — |
| Resolution | — |
| Verified by | — |

## Summary

On **Settle Company Balance**, typing a company's full name and pressing
Enter (the natural keyboard flow) fetches that company's outstanding bills
**twice**:

1. as the last character is typed, the combobox finds an exact match and
   calls `onSelect` → `loadSettleBillsList()`;
2. Enter then commits the same company and calls `onSelect` →
   `loadSettleBillsList()` again.

Each load re-renders the checklist from scratch. If the second response
arrives after the operator has started ticking bills, the ticks are silently
cleared and "Total selected" drops back to ₹0.00. Pressing **Settle
Selected Bills** then fails with "Check at least one bill to settle." The
operator sees a tick vanish, or gets an error for a selection they made a
moment ago.

There's a related stale-response risk with the same cause: the loads aren't
sequenced. If the operator switches from company A to company B quickly, a
late response for A can overwrite B's list, though the server's "does not
belong to this company" check still blocks any wrong settlement.

## Steps to reproduce

1. Operator page › Settle Company Balance.
2. Type a company's full name and press Enter.
3. Tick a bill straight away (on a slow LAN or a busy server the window is
   bigger; the test widens it by delaying the second response by 800 ms).

## Expected

One load per company pick. A tick stays ticked until the operator changes
it.

## Actual

Two `GET /api/companies/:id/outstanding` requests. When the second one
lands, the tick is gone and the total resets.

## Root cause

- `public/js/common.js:227`: the `input` handler calls `onSelect(exact)` on
  every exact match, and `:186` (`commit`) calls `onSelect(item)` again for
  the same item.
- `loadSettleBillsList()` (`public/js/operator.js:122`, `public/js/admin.js:217`)
  re-renders unconditionally and ignores whether a newer load has already
  started.

## Suggested fix

Either or both:

- In `attachCombobox()`, skip `onSelect` when the item is already the
  selected one (`hiddenInput.value === item.id` before assigning).
- In `loadSettleBillsList()`, ignore stale or duplicate responses: keep a
  request counter (or the company id last requested), and discard a response
  that isn't the latest. When the same company's list is reloaded, carry the
  ticked ids over to the new render.

## Linked tests

- `e2e/specs/billing/settle.spec.js` › `F14: picking a company loads its bill list once, so ticked bills are never wiped`: `knownBug("BUG-019")`
- `e2e/specs/accessibility/keyboard.spec.js` › M3d types a unique prefix (not the full name) to stay out of this bug's way; switch it back to the full name once this is fixed.

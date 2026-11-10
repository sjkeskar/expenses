# BUG-025: After "already collected", the bill and the revisit list keep showing the sample as pending

| Field | Value |
|---|---|
| Status | Closed |
| Severity | Low |
| Area | Bill detail, Sample revisits |
| Reported | 2026-11-10 |
| Found by | E2E `ui/journey-samples.spec.js` › The revisit list |
| Assignee | — |
| Resolution | Fixed 2026-11-10 (uncommitted): both screens reload after a refused collection too, and the bill clears its ticks (`BillDetailPage.tsx`, `RevisitsPage.tsx`). |
| Verified by | `npm run test:e2e`, 2026-11-10: the linked tests pass as ordinary tests |

## Summary

When another desk has collected a sample meanwhile, recording it again is
correctly refused ("Some of those samples are already collected."), but the
screen isn't refreshed: the sample still reads Pending and can be tried
again, until the page is reloaded by hand.

## Steps to reproduce

1. Open a bill with a pending sample at two desks (or the bill at one and
   **Sample revisits** at the other).
2. Record the collection at the first desk.
3. Record it at the second.

## Expected

After the message, the second desk shows the sample as collected (and the
revisit row is gone), as BUG-020 settled for the settlement list.

## Actual

The row stays Pending, its tick stays, and the revisit row stays listed.
Nothing is recorded twice: only the display is stale.

## Root cause

`collect` in `client/src/features/billing/BillDetailPage.tsx` and in
`client/src/features/revisits/RevisitsPage.tsx` reloads only after a
successful request; a refused one throws before the reload.

## Suggested fix

Reload in a `finally`, clearing the ticks, in both places.

## Linked tests

- `e2e/specs/ui/journey-samples.spec.js` › "after 'already collected', the bill and the revisit list show the sample as it now is, without a reload"

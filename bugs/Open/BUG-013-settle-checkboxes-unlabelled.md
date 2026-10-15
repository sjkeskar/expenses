# BUG-013: Settle Company Balance checkboxes have no accessible name

| Field | Value |
|---|---|
| Status | Open |
| Severity | Medium |
| Area | Operator / Admin UI: Settle Company Balance (`public/js/operator.js`, `public/js/admin.js`, `public/operator.html`, `public/admin.html`) |
| Reported | 2026-10-15 |
| Found by | E2E `accessibility/axe.spec.js` › M2/BUG-013 (axe rules `label` [critical], `empty-table-header` [minor]) |
| Assignee | — |
| Resolution | — |
| Verified by | — |

## Summary

Each pending bill in the settle list has a checkbox with no label, no
`aria-label` and no `aria-labelledby`. A screen reader only announces
"checkbox, not checked", with no hint of which bill or amount it settles.
The checkbox column's `<th>` is also empty.

## Steps to reproduce

1. Operator page › Settle Company Balance › pick a company with pending bills.
2. Inspect a checkbox, or Tab to it with a screen reader running.

## Expected

Each checkbox is announced with its bill, e.g. "Settle bill 0126100003,
Asha Traders, ₹400.00". The header column is named (e.g. "Select").

## Actual

Unnamed checkboxes, and an empty header cell.

## Root cause

- `loadSettleBillsList()` in `public/js/operator.js` (and its copy in
  `admin.js`) renders `<input type="checkbox" class="settle-bill-checkbox" …>`
  with no label.
- `public/operator.html:131` and `public/admin.html:142`: `<th></th>`.

## Suggested fix

Add `aria-label="Settle bill ${b.billNumber} — ${b.client.name}"` to each
checkbox (escaped; see BUG-004). Make the header
`<th><span class="visually-hidden">Select</span></th>`, or similar.

## Linked tests

- `e2e/specs/accessibility/axe.spec.js` › `M2/BUG-013: settle-list checkboxes and table headers have accessible names`: `knownBug("BUG-013")`

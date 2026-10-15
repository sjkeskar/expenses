# BUG-014: Search dropdowns (comboboxes) use incomplete ARIA

| Field | Value |
|---|---|
| Status | Closed |
| Severity | Medium |
| Area | Shared UI (`public/js/common.js`, `attachCombobox`) |
| Reported | 2026-10-15 |
| Found by | E2E `accessibility/axe.spec.js` › M2/BUG-014 (axe rules `aria-required-attr`, `aria-required-parent`, both critical) |
| Assignee | — |
| Resolution | Batch 4 of `bugs/FIX-PLAN.md` — `attachCombobox()` sets `role="listbox"` on the list and `aria-controls` on the input |
| Verified by | `accessibility/axe.spec.js` › M2/BUG-014, green in three full `npm run test:e2e` runs (4 and 8 workers) on 2026-10-16 |

## Summary

`attachCombobox()` gives the text input `role="combobox"` and each
suggestion `role="option"`, but:

- the input has no `aria-controls` pointing at its suggestion list
  (a required attribute for `role="combobox"`);
- the suggestion container (`.combobox-list`) has no `role="listbox"`, so
  the options have no valid parent.

Assistive technology therefore can't connect the field to its suggestions,
or announce how many there are and which is highlighted. This affects
every search field: Client, Category, Location, Bill (Record Payment and
Reassign), Company (Settle, Add Category) and the analytics client picker.

## Steps to reproduce

Focus any combobox field so its list opens, then run axe (or inspect the
accessibility tree).

## Expected

The input has `aria-controls="<dropdown id>"` and the dropdown has
`role="listbox"`, matching the ARIA 1.2 combobox pattern.
(`aria-activedescendant` and `aria-expanded` are already handled.)

## Actual

`aria-required-attr` on the input, and `aria-required-parent` on every
option.

## Root cause

`public/js/common.js`, `attachCombobox()`: the `input.setAttribute("role", "combobox")`
block never sets `aria-controls`, and `dropdown` never gets a role.

## Suggested fix

In `attachCombobox()`:
`dropdown.setAttribute("role", "listbox"); input.setAttribute("aria-controls", dropdown.id);`.

## Linked tests

- `e2e/specs/accessibility/axe.spec.js` › `M2/BUG-014: an open combobox exposes valid listbox/option ARIA`: `knownBug("BUG-014")`

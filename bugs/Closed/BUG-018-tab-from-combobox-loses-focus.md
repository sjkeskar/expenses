# BUG-018: Tabbing out of a search field with a long list loses keyboard focus

| Field | Value |
|---|---|
| Status | Closed |
| Severity | Medium |
| Area | Shared UI (`public/js/common.js` `attachCombobox`, `public/css/style.css` `.combobox-list`) |
| Reported | 2026-10-15 |
| Found by | E2E `accessibility/keyboard.spec.js` › M3b (it only showed up once the test database held many clients) |
| Assignee | — |
| Resolution | Batch 4 of `bugs/FIX-PLAN.md` — `attachCombobox()` sets `tabIndex = -1` on the list and hides it immediately on Tab |
| Verified by | `accessibility/keyboard.spec.js` › M3b, now tabbing at full speed with 25 clients, green in three full `npm run test:e2e` runs (4 and 8 workers) on 2026-10-16 |

## Summary

Focusing a search field (e.g. **Client** on Create Bill) opens its
suggestion list, showing up to 20 entries. Once there are more than about 5
suggestions, the list scrolls (`max-height: 200px; overflow-y: auto`), and
Chrome makes scrollable boxes **keyboard-focusable**. Pressing Tab in the
Client field therefore moves focus *into the list*. The field's blur timer
then hides the list (BUG-009's 150 ms timer) while it holds focus, and
focus falls back to `<body>`.

For the user, the Tab press is lost: nothing on the page is focused, and the
next Tab continues to Category. Every shop with more than a handful of
clients hits this on every bill entered from the keyboard. The same applies
to the Bill, Company and analytics Client search fields.

## Steps to reproduce

1. Have 6 or more clients.
2. Click into **Client** on Create Bill (without typing) and press Tab.
3. Check `document.activeElement`.

## Expected

Focus moves to **Category**.

## Actual

Focus moves to the suggestion list, then to `<body>`. The tab sequence is
Client → (nothing) → Category → …

## Root cause

- `.combobox-list` is a scroll container (`public/css/style.css:275-288`),
  which Chrome includes in the Tab order.
- `attachCombobox()` doesn't take the list out of the Tab order, and only
  hides it 150 ms after blur (`public/js/common.js:197`).

## Suggested fix

Set `dropdown.tabIndex = -1` in `attachCombobox()` so the list is never a
Tab stop (mouse scrolling still works). Also hide the list immediately when
Tab is pressed (the delayed hide is only needed for mouse clicks on a
suggestion; see BUG-009).

## Linked tests

- `e2e/specs/accessibility/keyboard.spec.js` › `M3b: Create Bill tab order follows the visual order (with a realistic client list)`: `knownBug("BUG-018")`

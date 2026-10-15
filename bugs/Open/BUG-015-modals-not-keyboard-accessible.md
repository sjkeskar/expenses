# BUG-015: Modals (Change Password, Confirm Refund) don't manage keyboard focus

| Field | Value |
|---|---|
| Status | Open |
| Severity | Medium |
| Area | Shared UI (`public/js/common.js` `setupChangePasswordModal`; `setupRefundModal` in operator.js / admin.js; modal markup in all role pages) |
| Reported | 2026-10-15 |
| Found by | E2E `accessibility/keyboard.spec.js` › M3h (both modals) |
| Assignee | — |
| Resolution | — |
| Verified by | — |

## Summary

Both modal dialogs are plain `<div>`s shown with `display: flex`. A
keyboard (or screen-reader) user:

1. **isn't moved into the dialog** when it opens: focus stays on the button
   behind the overlay, so they have to Tab through the whole page to reach
   it;
2. **can Tab out of the dialog** into the dimmed page behind it;
3. **can't close it with Escape**;
4. **loses their place** on close: focus isn't returned to the button that
   opened it;
5. gets no dialog semantics: there's no `role="dialog"`, `aria-modal` or
   `aria-labelledby`, so screen readers don't announce a dialog.

For the refund confirmation, which is a destructive action, this also makes
it easy to lose track of an open confirmation.

## Steps to reproduce

1. Tab to **Change Password** (or a **Refund** button) and press Enter.
2. Note where focus is, press Tab a few times, then press Escape.

## Expected

Focus moves to the first field (or the Cancel button for Refund), Tab
cycles inside the dialog, Escape closes it, and focus returns to the
opener. The dialog is announced as a dialog with its heading as its name.

## Actual

None of the above.

## Root cause

- Markup: `<div id="…-modal" class="modal-overlay"><div class="modal-box">`
  in each role page (e.g. `public/operator.html:169`, `:182`).
- `setupChangePasswordModal()` in `public/js/common.js` and
  `setupRefundModal()` only toggle `style.display`.

## Suggested fix

Use the native `<dialog>` element with `showModal()`. It provides the focus
move, focus trap, Escape and top-layer stacking for free, and Escape fires
`cancel`. Otherwise, add `role="dialog" aria-modal="true" aria-labelledby`
to `.modal-box`, focus the first control on open, trap Tab, handle Escape,
and restore focus to the opener on close.

## Linked tests

- `e2e/specs/accessibility/keyboard.spec.js` › `M3h: change-password modal — …` and `M3h: refund modal — …`: `knownBug("BUG-015")`

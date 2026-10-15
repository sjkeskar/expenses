# BUG-001: Developer page: Change Password reads the Create User password field

| Field | Value |
|---|---|
| Status | Open |
| Severity | Medium |
| Area | Developer UI (`public/developer.html`, `public/js/common.js`) |
| Reported | 2026-10-15 |
| Found by | Code review; confirmed by E2E `auth/change-password.spec.js` › B1, B2 (developer) |
| Assignee | — |
| Resolution | — |
| Verified by | — |

## Summary

`developer.html` has two inputs with `id="new-password"`: one in the
Create User form and one in the Change Password modal. The shared modal code
reads `document.getElementById("new-password")`, which returns the
**first** one (Create User). A developer therefore can't change their own
password from the UI. Worse, if the Create User field holds text that
matches the confirmation, their password is set to that text.

## Steps to reproduce

1. Log in as a developer.
2. Click **Change Password**. Enter the correct current password, then
   `Changed#42` as both the new password and the confirmation.
3. Click **Change Password**.

## Expected

"Password changed. Redirecting you to log in again with it...", followed by
a redirect to login.

## Actual

"New password and confirmation do not match." Every attempt fails the same
way, including one with a wrong current password (B2), because the
mismatch check runs first.

## Root cause

- Duplicate id: `public/developer.html:33` and `public/developer.html:76`.
- `public/js/common.js:301`: `document.getElementById("new-password")`
  resolves to the Create User field.
- `public/js/developer.js:84` and `:92` rely on the same id.

## Suggested fix

Rename the Create User field (e.g. `id="create-user-password"`) and update
`developer.js`. Or, better, have `setupChangePasswordModal()` look up its
fields inside the modal (`modal.querySelector("#new-password")`), so no other
page can collide with it again.

## Linked tests

- `e2e/specs/auth/change-password.spec.js` › `B1: developer changes password…`: `knownBug("BUG-001")`
- `e2e/specs/auth/change-password.spec.js` › `B2: developer gets an error for a wrong current password`: `knownBug("BUG-001")`

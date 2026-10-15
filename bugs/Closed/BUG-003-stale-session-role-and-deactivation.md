# BUG-003: Deactivated users and demoted admins keep their access until the session expires

| Field | Value |
|---|---|
| Status | Closed |
| Severity | High |
| Area | Auth / sessions (`src/middleware/auth.js`, `src/routes/auth.js`) |
| Reported | 2026-10-15 |
| Found by | Code review; confirmed by E2E `auth/session.spec.js` › C9a, C9b |
| Assignee | — |
| Resolution | Batch 2 of `bugs/FIX-PLAN.md` — `requireAuth` in `src/middleware/auth.js` re-reads the user on every request |
| Verified by | `auth/session.spec.js` › C9a, C9b, green in a full `npm run test:e2e` run on 2026-10-15 |

## Summary

The user's `role` is copied into the session at login, and `requireAuth` /
`requireRole` trust that copy for the session's whole lifetime (4 hours),
never re-reading the database. As a result:

- A user the developer **deactivates** keeps full access in every browser
  where they're already logged in.
- An admin the developer **demotes** keeps admin rights (reassigning bills,
  managing locations and categories, promoting users, analytics) until they
  log out.

## Steps to reproduce

1. Log in as operator X in browser A.
2. In browser B, a developer deactivates X.
3. In browser A, keep working: create bills, record payments, and so on.

(Same with an admin who gets demoted: they can still open the admin-only
endpoints, such as `GET /api/users/reassign-targets`.)

## Expected

The next request from browser A gets `401` (deactivated) or `403` (no longer
admin), and the UI sends the user back to login.

## Actual

`200` on every request until the 4-hour session expires or the user logs
out.

## Root cause

- `src/routes/auth.js:33` stores `{ id, name, role }` in the session.
- `src/middleware/auth.js:2` (`requireAuth`) only checks that
  `req.session.user` exists, and `:17` (`requireRole`) checks the cached
  role.

## Suggested fix

In `requireAuth`, load the user by `req.session.user.id` (a cheap primary-key
lookup). If they're missing or `isDeleted`, destroy the session and return
401. Otherwise refresh `req.session.user.role` from the database, so
`requireRole` sees the current role. Alternatively, keep a per-user "session
version" that promote, demote and deactivate bump.

## Linked tests

- `e2e/specs/auth/session.spec.js` › `C9a: a deactivated user's existing session stops working`: `knownBug("BUG-003")`
- `e2e/specs/auth/session.spec.js` › `C9b: a demoted admin loses admin rights in their existing session`: `knownBug("BUG-003")`

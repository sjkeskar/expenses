# BUG-007: Back button after logout shows a half-working role page

| Field | Value |
|---|---|
| Status | Open |
| Severity | Low |
| Area | Auth / HTTP caching (`src/server.js`) |
| Reported | 2026-10-15 |
| Found by | E2E `auth/login.spec.js` › A8b (all four roles) |
| Assignee | — |
| Resolution | — |
| Verified by | — |

## Summary

After **Log out**, pressing the browser's Back button reloads the role page.
For a history navigation, Chrome serves `GET /api/auth/me` from its HTTP
cache: the old `200` with the user's name and role. The page guard
therefore doesn't redirect to login. The page shows the logged-out user's
name and all the controls, while every data call fails with `401` in the
background (empty tables, no error shown). On a shared shop PC this is
confusing, and it reveals who was last logged in.

## Steps to reproduce

1. Log in as any role.
2. Click **Log out** (you land on login.html).
3. Press the browser's Back button.

## Expected

The login page (the role page's guard detects there's no session).

## Actual

The role page (e.g. `admin.html`) stays open, showing
"e2e-admin (admin)", with empty tables. Network log: `/api/auth/me` 200
(from cache), `/api/clients` 401.

## Root cause

API responses carry no `Cache-Control` header, so the browser may reuse
them. Express only sends an `ETag`. See `src/server.js:64` onward, where
the `/api/*` routers are mounted without any cache headers.

## Suggested fix

Add middleware before the API routes:
`app.use("/api", (req, res, next) => { res.set("Cache-Control", "no-store"); next(); });`.
Optionally, also redirect to login from `api()` in `common.js` on any
`401`.

## Linked tests

- `e2e/specs/auth/login.spec.js` › `A8b: <role> pressing Back after logout is sent to the login page` (×4): `knownBug("BUG-007")`

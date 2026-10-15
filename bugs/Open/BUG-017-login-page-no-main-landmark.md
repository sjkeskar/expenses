# BUG-017: Login page has no main landmark

| Field | Value |
|---|---|
| Status | Open |
| Severity | Low |
| Area | `public/login.html` |
| Reported | 2026-10-15 |
| Found by | E2E `accessibility/axe.spec.js` › M2/BUG-017 (axe best-practice rules `landmark-one-main`, `region`) |
| Assignee | — |
| Resolution | — |
| Verified by | — |

## Summary

The login page's content (heading, name and password fields, message) sits
in plain `<div>`s with no `<main>` element, unlike every role page. Screen
reader users can't jump straight to the content via landmarks. This is an
axe best-practice finding, not a WCAG A/AA failure.

## Steps to reproduce

Open `/login.html` and run axe, or list the page's landmarks.

## Expected

The login box is inside `<main>`.

## Actual

No landmarks at all.

## Root cause

`public/login.html`: `<div class="login-wrapper">` is the top-level
container.

## Suggested fix

Change `<div class="login-wrapper">` to `<main class="login-wrapper">`
(no style change needed).

## Linked tests

- `e2e/specs/accessibility/axe.spec.js` › `M2/BUG-017: the login page has a main landmark containing its content`: `knownBug("BUG-017")`

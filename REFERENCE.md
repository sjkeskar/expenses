# Payment Tracking System — Reference & Change-Impact Guide

_As of 2026-10-10_

This is the engineering map of the codebase: what each file is responsible for, how the design got here, who is allowed to do what, and — most usefully — which files a given kind of change will touch, so you can scope work here without re-reading everything first.

---

## 1. System architecture

```
Browser (role page)
        │
        ▼
   Express app  ───────▶  Session store (in-memory)
 (src/server.js)
        │
        ▼
  Auth middleware
 (requireAuth / requireRole)
        │
        ▼
  Route handler
 (src/routes/*)
        │
        ▼
  Prisma Client
        │
        ▼
   PostgreSQL
```

Every request from a role page hits the same Express app, passes through `requireAuth`/`requireRole` before any route logic runs, and only a route handler ever talks to Prisma. There is no other path to the database — which is exactly why `src/middleware/auth.js` is the single source of truth for the whole permission matrix (see §4).

---

## 2. File-by-file reference

### Backend

| File | Responsibility |
| --- | --- |
| `src/server.js` | App entrypoint. Wires every route under `/api/*`, serves `public/` as static files, redirects `/` to login, and holds the two process-level safety nets (`unhandledRejection`, `uncaughtException`) that keep one bad request from crashing the whole server. |
| `src/config/prisma.js` | One shared Prisma client instance, imported everywhere data is read or written. |
| `src/config/session.js` | Session middleware config: in-memory store, 4-hour cookie, `secure: false` (plain HTTP on LAN). |
| `src/middleware/auth.js` | `requireAuth` and `requireRole(...roles)` — the single source of truth for the permission matrix. Every route file imports these. |
| `src/routes/auth.js` | Login, logout, `/me`, and self-service password change. |
| `src/routes/users.js` | Developer-only user lifecycle: create, promote, demote, deactivate (soft delete). Also `GET /reassign-targets` (admin-only — any active operator/admin, feeds the Reassign Operator tab). |
| `src/routes/clients.js` | List/create clients. Name-only records, find-or-create pattern used elsewhere too. |
| `src/routes/locations.js` | Admin-managed location list (soft delete via `isActive`), each with a 2-digit code used in bill numbers. |
| `src/routes/categories.js` | Admin-managed category list. A category's `type` (`standard`/`credit`) drives bill-creation behavior; a credit category auto-creates/reuses a Company. |
| `src/routes/companies.js` | Lists companies, shows a company's outstanding bills, and settles a hand-picked set of them in full. |
| `src/routes/bills.js` | Bill creation (with find-or-create client + atomic bill-number generation), the refund route (`PATCH /:id/refund`), and the reassign-operator route (`PATCH /:id/reassign-operator`, admin only). `GET /:id` includes the bill's full `reassignments` audit trail. |
| `src/routes/transactions.js` | Records payments against a bill, and lets a transaction be corrected (`PATCH`) or soft-deleted (`DELETE`), recalculating the parent bill's balance/discount/status each time. |
| `src/routes/analytics.js` | All reporting endpoints: day-wise, operator-wise, location-wise, category-wise, client-outstanding, client-daily, client-ledger. |
| `src/utils/billNumber.js` | Atomic bill-number sequence generator (`{locationCode}{YY}{MM}{seq}`), scoped per location code + month via `BillCounter`. |
| `src/utils/istDate.js` | All IST (Asia/Kolkata) date/time helpers — bill-number date keys, display defaults, backdating support. |
| `src/utils/dateRange.js` | Parses `?startDate/&endDate` query params into IST-correct `[from, to)` instants for analytics filtering. |
| `src/utils/paymentModes.js` | The one list of valid payment modes (`cash`, `credit_card`, `upi`) — imported wherever a mode is validated. |
| `src/utils/passwordPolicy.js` | Password rule (6+ chars, 1 number, 1 special character) — used by both signup and self-service password change. |
| `prisma/schema.prisma` | Source of truth for the database: every model, enum, and relation. Any new field or status starts here. |

### Frontend

| File | Responsibility |
| --- | --- |
| `public/login.html` / `public/js/login.js` | Login page and its logic; redirects straight to the right role page if already logged in. |
| `public/operator.html` / `public/js/operator.js` | Operator's page: create bill, record payment, settle company balance, My Bills table (with refund action). |
| `public/admin.html` / `public/js/admin.js` | Admin's page: everything operator has, plus the full Analytics tab, Promote, Reassign Operator, Locations, and Categories management. |
| `public/developer.html` / `public/js/developer.js` | Developer's page: user list and lifecycle actions (create/promote/demote/deactivate). |
| `public/accountant.html` / `public/js/accountant.js` | Accountant's page: read-only Analytics tab (same views as admin) plus PDF export, no billing. |
| `public/js/common.js` | Shared across every role page: `api()` fetch wrapper, `guardPage()` role check, date/currency formatters, the typeable combobox widget, the Change Password modal, and `downloadPdfReport()`. |
| `public/css/style.css` | All styling, including the status badges (`.badge.pending` / `.fully_paid` / `.refunded`). |
| `public/vendor/*` | Self-hosted jsPDF + autotable, used by every "Download PDF" button. No CDN dependency. |

### Scripts & docs

| File | Responsibility |
| --- | --- |
| `scripts/create-first-developer.sql` | One-time bootstrap: inserts the very first developer account directly via SQL (nothing else can create the first user, since only a developer can create users through the app). |
| `scripts/generate-password-hash.js` | Produces the argon2 hash pasted into the script above. |
| `scripts/reset-test-data.sql` | Wipes business data (clients/bills/transactions/categories/companies/locations) but keeps user accounts — for resetting a test environment. |
| `scripts/consolidate-migrations.ps1` | Collapses accumulated Prisma migration history into one migration for a clean go-live or fresh test device. |
| `scripts/backup.bat` | Nightly `pg_dump` script, scheduled via Windows Task Scheduler. |
| `README.md` | Setup instructions and locked-in design decisions. |
| `SETUP_GUIDE.md` | Extended setup detail, including the full-reset/migration-consolidation procedure. |

---

## 3. Project journey

The system was built in one continuous build-out against a confirmed spec, then refined through several rounds of real decisions — some reversed once their consequences became clear. Knowing this history matters for impact analysis: a pattern that looks arbitrary in the code usually exists because an earlier, simpler version of it broke something.

- **Core build.** Backend (Node/Express/Prisma/Postgres), auth, bill creation, payments, and a first pass at analytics were built against the locked-in decisions in `README.md` (UUID keys, argon2 hashing, IST-only timestamps, one page per role, no build step on the frontend).
- **Timezone correctness was hardened after a real bug.** An early version used naive `+ interval '5:30'` arithmetic to shift timestamps into IST, which double-offset under certain conditions and caused bills to appear under the wrong day in analytics. The fix: every timestamp column became `timestamptz` (Postgres always stores the true UTC instant regardless of what timezone wrote it), and IST is now applied only at read/display time via `AT TIME ZONE 'Asia/Kolkata'` (SQL) or `Intl.DateTimeFormat` (JS) — see `src/utils/istDate.js` and the header comment in `src/routes/analytics.js`.
- **A crash bug led to a standing safety net.** An unhandled promise rejection (payment exceeding a bill's balance, not caught properly) used to take the entire Node process down — every operator's session with it. `src/server.js` now has `unhandledRejection`/`uncaughtException` handlers that log and keep the server alive, as a backstop behind each route's own try/catch.
- **A missing redirect was fixed.** The root path (`/`) had no `index.html` and returned a blank 404; it now redirects straight to `/login.html`.
- **Company settlement moved from automatic FIFO to hand-picked.** The original design settled a company's oldest bills first, automatically, for a lump sum. In practice some bills are disputed and need to be skippable individually, so `POST /api/companies/:id/settle` was redesigned to take an explicit list of bill IDs — the person settling sees the company's actual outstanding bills (with client names) and checks off exactly which ones to close. **Note:** `README.md` still describes this as FIFO in one place — that line is stale; the code in `src/routes/companies.js` is the source of truth (see §6).
- **Payment-time discounts were added as a tracked, auditable adjustment.** Rather than silently reducing a bill's balance, an additional discount given at payment time is stored on the `Transaction` row itself (`discountAmount`) and folded into the bill's running totals — so editing or deleting that transaction correctly reverses both the amount *and* the discount.
- **Analytics evolved under direct feedback.** A standalone "Company Outstanding Balances" view was removed entirely; Operator-wise and Category-wise summaries gained an Outstanding Balance column instead, and a combined "Download All (PDF)" button was added to the Analytics tab.
- **Bill refunds.** Added so a bill that was fully or partially paid and later refunded can be marked as such from the UI (with a confirmation step showing the exact amount collected), without that money continuing to count in daily totals. This touched the schema (new `refunded` status + four new `Bill` fields), the refund route, every analytics aggregate, and both operator/admin billing pages. See §5 and §6 for the full shape of it, and §7 for one loose end it left behind.
- **Most recent addition: reassign a bill's operator, with a full audit trail.** Admin can move a bill to a different operator (correcting a mistaken attribution, reassigning after an operator leaves, etc.). Built deliberately as an **append-only log**, not flat "last reassigned by/at" columns on `Bill`: a flat pair can only ever show the most recent move, silently destroying the record of every prior operator a bill passed through. The new `BillReassignment` table (schema) records one row per move — `fromOperatorId` (nullable, for a legacy bill with no operator yet), `toOperatorId`, `reassignedById`, `reassignedAt` — written inside the same `$transaction` as the `Bill.createdById` update, so the two can never drift apart. `Bill.createdById` stays the single source of truth for "current operator," so every existing query (My Bills, Operator-wise analytics) keeps working unchanged; the audit trail is purely additive. Scope matches the refund feature's own boundary: `Transaction.operatorId` is never touched, so payments already taken stay attributed to whoever actually collected them. See §5, §6, and §7.

---

## 4. Roles & responsibilities

Enforced entirely server-side by `requireRole(...)` in every route file — the frontend's page-per-role split is a convenience, not the security boundary. `src/middleware/auth.js` is the one file that defines what's possible for each role.

| Action | Operator | Admin | Developer | Accountant |
| --- | --- | --- | --- | --- |
| Create bill / record payment | Yes | Yes | No | No |
| Refund a bill | Yes | Yes | No | No |
| Correct / delete a transaction | Yes | Yes | No | No |
| Settle a company's bills | Yes | Yes | No | No |
| Reassign a bill's operator | No | Yes | No | No |
| View Analytics tab | No | Yes | No | Yes (read-only) |
| Download Analytics PDFs | No | Yes | No | Yes |
| Manage locations / categories | No | Yes | No | No |
| Promote operator → admin | No | Yes | Yes | No |
| Demote admin → operator | No | No | Yes | No |
| Create / deactivate any user | No | No | Yes | No |
| Change own password | Yes | Yes | Yes | Yes |

A few things worth knowing about this matrix:

- **Promotion is one-way for admin, two-way for developer.** Admin can promote an operator but can't demote anyone back — only a developer can reverse it.
- **Accountant is deliberately narrow.** It reuses the exact same analytics endpoints as admin (`requireRole("admin", "accountant")` throughout `analytics.js`), so accountant never needs its own reporting logic — but it has zero billing or management access.
- **Developer never touches money.** It can create/promote/demote/deactivate users, but has no route access to bills, transactions, or analytics at all — by omission, not an explicit deny.
- **A user's own password change doesn't need a role check**, only `requireAuth` — it always acts on `req.session.user.id`, never a body-supplied id, so there's no way to use it to change someone else's password.

---

## 5. Feature inventory

| Feature | Backend | Frontend | Key behavior |
| --- | --- | --- | --- |
| Auth & sessions | `routes/auth.js`, `config/session.js`, `middleware/auth.js` | `login.html/js`, `guardPage()` in `common.js` | `name` is the login identifier; 4-hour in-memory session; password change force-logs-out. |
| Bill creation | `routes/bills.js` (`POST /`) | operator.html/js, admin.html/js | Find-or-create client; location/category required and admin-managed; company copied from category, not chosen independently; optional initial payment in the same transaction; backdatable via `billDate`. |
| Bill numbering | `utils/billNumber.js`, `utils/istDate.js` | — | `{locationCode}{YY}{MM}{seq}`, atomic per-location-code-and-month counter, 0000–9999. |
| Record payment | `routes/transactions.js` (`POST /`) | operator.html/js, admin.html/js | Validates against remaining balance; supports an extra payment-time discount; updates bill balance/status. |
| Correct / delete payment | `routes/transactions.js` (`PATCH`/`DELETE /:id`) | not exposed in current UI (API only) | Un-applies the old amount+discount, re-applies the new one; soft delete restores the bill's balance. |
| Company credit billing | `routes/categories.js`, `routes/companies.js` | admin.html/js (Add Category, Settle Company Balance) | A "credit" category auto-creates/reuses a Company; settlement is a hand-picked set of that company's pending bills, each paid in full. |
| **Bill refunds** | `routes/bills.js` (`PATCH /:id/refund`), `schema.prisma` (`refunded` status + 4 fields) | operator.js/admin.js (`openRefundModal`, `loadBills`), `.badge.refunded` in `style.css` | Refundable at any status as long as money was collected; confirmation popup shows the exact amount; balance zeroed, `refundedAmount` snapshots what was collected; bill stays visible with a Refunded badge but drops out of every analytics total. |
| **Reassign bill operator (with audit trail)** | `routes/bills.js` (`PATCH /:id/reassign-operator`, `GET /:id` reassignments include), `routes/users.js` (`GET /reassign-targets`), `schema.prisma` (`BillReassignment` model + 3 `User` relations) | admin.html/js (Reassign Operator tab: bill combobox, target select, reassignment-history table) | Admin only. Moves `Bill.createdById` to a new operator/admin inside a `$transaction` that also writes a `BillReassignment` row (`fromOperatorId`, `toOperatorId`, `reassignedById`, `reassignedAt`) — one row per move, never updated or deleted, so the full A→B→C chain is always reconstructible. `Transaction.operatorId` is untouched. The UI surfaces the full history for any selected bill, not just the latest move. |
| Locations / categories management | `routes/locations.js`, `routes/categories.js` | admin.html/js (Locations / Categories tabs) | Soft delete only (`isActive`) — historical bills keep showing the retired value. |
| User management | `routes/users.js` | developer.html/js | Create any role, promote/demote operator↔admin, soft-delete (deactivate) any user except self. |
| Analytics — Day-wise | `routes/analytics.js` (`/day-wise`) | admin.js/accountant.js | Collections by IST calendar day + payment-mode breakdown; refunded-bill count/amount shown separately, not netted in. |
| Analytics — Operator-wise | `routes/analytics.js` (`/operator-wise`) | admin.js/accountant.js | Billed/discount/pending from bills created; collected from payments taken — two different groupings merged per operator. |
| Analytics — Location-wise / Category-wise | `routes/analytics.js` | admin.js/accountant.js | Billed/discount/outstanding for bills created in the selected date range. |
| Analytics — Client Outstanding | `routes/analytics.js` (`/client-outstanding`) | admin.js/accountant.js | Current-state snapshot, not date-filtered. |
| Analytics — Per-Client Detail | `routes/analytics.js` (`/client-daily`, `/client-ledger`) | admin.js/accountant.js | Daily collection summary (date-filtered) + full bill-by-bill ledger (not date-filtered, not refund-filtered — deliberate audit view). |
| PDF export | `common.js` (`downloadPdfReport`), `public/vendor/*` | every role page with a "Download PDF" button | Entirely client-side via self-hosted jsPDF + autotable — no server round-trip, no CDN dependency. |
| "My Bills" view | `routes/bills.js` (`GET /`, filtered client-side) | operator.html/js, admin.html/js | Bills table scoped to the logged-in user's own created bills, with a bold total row (refunded bills excluded from the total, shown individually above it). |

---

## 6. Change-impact playbook

For each kind of change, the files it touches and the thing most likely to get missed.

| If you want to… | Files to touch | Watch out for |
| --- | --- | --- |
| Add a new bill status (e.g. "cancelled", like refund) | `schema.prisma` (enum + any new fields) → `routes/bills.js` (new route or status transition) → `routes/analytics.js` (exclude/include in every one of the 6 aggregate queries, not just one) → `routes/transactions.js` (should payment edit/delete be blocked on this status? see §7) → `style.css` (`.badge.<status>`) → every role page's JS that renders `b.status` or computes "collected" | Analytics has **six separate queries** (day-wise, operator-wise, location-wise, category-wise, client-outstanding, client-daily) — missing even one silently re-includes the new status in a total. Day-wise is the trickiest: it's two merged queries, not one. |
| Add a new field to `Bill` | `schema.prisma` → the `include`/`select` blocks in `routes/bills.js` (2 places: `GET /`, `GET /:id`) and anywhere else the bill is fetched → frontend table rendering in `operator.js`/`admin.js` (`loadBills()`, both nearly-identical copies) → PDF export row-builders in the same files | `operator.js` and `admin.js` duplicate almost all billing-page logic — changes made in one are easy to forget in the other. There is no shared module between them; `common.js` only holds truly page-agnostic helpers. |
| Add a new role | `schema.prisma` (`Role` enum) → every `requireRole(...)` call that should include it → a new `public/<role>.html` + `public/js/<role>.js` → `guardPage()` redirect logic in `common.js` already handles unknown roles generically, but double-check → `routes/users.js` (`VALID` role list in `POST /`) | Permissions are enforced per-route, not centrally — there's no single permission table to edit. Expect to touch most files under `src/routes/`. |
| Add a new payment mode | `schema.prisma` (`PaymentMode` enum) → `utils/paymentModes.js` (`VALID_MODES`) → `schema.prisma` migration → any hardcoded mode dropdowns in operator.html/admin.html | `VALID_MODES` is the single source of truth for validation — the enum and this array must stay in sync, nothing checks that automatically. |
| Add a new analytics breakdown (e.g. "Company-wise") | `routes/analytics.js` (new endpoint, decide if refund-filtered) → `admin.js` + `accountant.js` (nearly-identical `loadAnalytics()` and PDF export sections) → new `<table>` in `admin.html` + `accountant.html` | Decide explicitly whether refunded bills should be excluded (most aggregates are) or included (only `client-ledger` isn't) — this is a per-endpoint decision, not inherited automatically. |
| Change the bill numbering scheme | `utils/billNumber.js`, `utils/istDate.js` (`buildBillCounterKey`), `BillCounter` model in `schema.prisma` | The counter key intentionally mixes location code + year + month so that two locations sharing a code never collide — changing the key shape without understanding this can silently cause duplicate bill numbers. |
| Change session length / auth behavior | `config/session.js`, `.env` (`SESSION_MAX_AGE_MS`) | Sessions are in-memory — a Node restart logs everyone out. This is a documented, accepted trade-off, not a bug to "fix" without discussion. |
| Change the password policy | `utils/passwordPolicy.js` | Used in exactly two places (`routes/users.js` create, `routes/auth.js` password change) — both call the same function, so this is a low-risk, single-file change. |
| Add a new admin-managed lookup list (like locations/categories) | New `routes/<thing>.js` following the soft-delete (`isActive`) pattern → `server.js` (mount the route) → `schema.prisma` → admin.html/js (new tab + table) | Existing bills reference the old value by id, so soft-delete (not hard delete) is what keeps historical bills displaying correctly — this pattern is deliberate and repeated three times already (locations, categories, companies via categories). |
| Change timezone handling | `utils/istDate.js`, `utils/dateRange.js`, `routes/analytics.js` (`AT TIME ZONE` SQL), `common.js` (display formatters) | All four must agree — this was the source of a real production bug once (see §3). Never reintroduce naive `+ interval` arithmetic. |
| Modify the refund feature further | `routes/bills.js` (refund route), `routes/analytics.js` (all 6 aggregates + day-wise merge), `routes/transactions.js` (currently does **not** know about refunded bills — see §7), `operator.js`/`admin.js` (`getCollectedAmount`, `statusLabel`, `loadBills`, PDF export), `accountant.js` (day-wise rendering only, no billing actions) | This is one of the most cross-cutting features in the app — touches more files than most other single changes. Use the Feature Inventory (§5) row above as the checklist. |
| Modify the reassign-operator feature further | `routes/bills.js` (reassign route + `GET /:id` include), `routes/users.js` (`/reassign-targets`), `schema.prisma` (`BillReassignment`), `admin.js`/`admin.html` (Reassign Operator tab) | The audit log is append-only by design — never add an `UPDATE`/`DELETE` path for `BillReassignment` rows, even for "fixing a mistake"; a correction should be a new reassignment row, not an edit to history. Operator-wise analytics buckets a bill under its **current** `createdById` for its **entire** lifetime (via `b."createdAt"`, not the reassignment date) — reassigning a bill does not retroactively split its past contribution between the old and new operator. See §7. |

---

## 7. Known gaps & risks

- **Transaction edit/delete doesn't know about refunds.** `PATCH /api/transactions/:id` and `DELETE /api/transactions/:id` recompute the parent bill's balance from scratch (undo old amount, reapply new) with no check for `bill.status === "refunded"`. If a transaction belonging to a refunded bill is ever edited or deleted — currently possible only by calling the API directly, since no frontend UI exposes editing a specific transaction — it would un-zero the bill's balance and likely flip its status back to `pending`/`fully_paid`, silently undoing the refund's intent. **If transaction-level editing is ever added to the UI, this needs a guard first.**
- **`README.md`'s settlement description is stale.** It still says company settlement is "applied oldest-bill-first (FIFO)". The actual behavior (`routes/companies.js`) is hand-picked bill selection — the person settling checks off exactly which bills to close. Trust the code over this one README line until it's corrected.
- **`operator.js` and `admin.js` are near-duplicates for billing-page logic**, by design (no shared frontend module beyond `common.js`). Any billing-related change needs to be made in both files — there's no build step or import system to enforce this, only discipline and this document.
- **No automated tests.** Every verification pass in this project has been manual: `node --check` for syntax, HTML tag-balance checks, and ID cross-checks between JS and HTML. A change that passes those checks can still be logically wrong — there's no test suite to catch a regression in, say, the day-wise analytics merge logic.
- **Reassigning a bill's operator does not retroactively reattribute analytics.** Operator-wise analytics groups a bill by its *current* `createdById`, for the bill's entire history, regardless of when a reassignment happened — reassigning a bill today moves ALL of its past billed/collected totals to the new operator's figures, not just activity going forward. This is a deliberate, unchanged design choice (not a bug): the audit trail (`BillReassignment`) records exactly who held the bill and when, so the underlying truth is fully recoverable, but no analytics view currently reads that table to split a bill's contribution across operators by date range. If operator-wise reporting ever needs to reflect "who actually had this bill at the time," that reporting logic — not the audit trail itself — is what would need to change.
- **Prisma couldn't be validated in the build sandbox** (no network access to `binaries.prisma.sh`). Schema changes made here are checked for balanced braces and read carefully against the existing patterns, but `npx prisma validate` and `npx prisma migrate dev` have only ever been run for real on the server PC — always do that first after pulling a schema change, before assuming it's correct.

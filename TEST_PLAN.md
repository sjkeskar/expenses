# Test Plan — Payment Tracking System

Scope: what to test, and why. This document is the agreed scenario
catalogue; the automated suite itself is a follow-up phase (see
[Phasing](#phasing)).

## Current state

There is **no test tooling in the repo today** — no `test` script in
`package.json`, no runner installed, no test files. Everything below is
greenfield. Verified present on this machine and usable by an
integration suite: generated Prisma client (`node_modules/.prisma/client`),
Prisma query + schema engines, and a reachable local Postgres
(`payment_tracking`, currently 0 users).

## Confirmed decisions this plan follows

| Decision | Choice |
| --- | --- |
| Deliverable | Scenario catalogue now; automated suite as an explicit later phase |
| Layers | API/HTTP integration + browser E2E (UI flows) |
| Analytics verification | Independent oracle **and** UI cross-check |
| Tooling | `node:test` (built-in runner) + `supertest` + Playwright |
| Test database | Dedicated throwaway Postgres, separate from dev |
| DB reset | `TRUNCATE ... CASCADE` helper, per test file, with per-file seeding |
| Unit tests for pure utils | **Not** written separately — `istDate`, `billNumber`, `dateRange`, `passwordPolicy` are covered indirectly through the API |
| Depth | Core paths + edge cases. Explicitly **out of scope**: concurrency/load testing, systematic security probing, performance benchmarking |

Because unit tests were deliberately excluded, the date/bill-number edge
cases that would normally live there (IST midnight boundaries, month
rollover, the 9999 sequence cap, inclusive end-date) are folded into the
API scenarios below — marked **[util-via-API]**. These are the trickiest
logic in the codebase, so they are not dropped, just relocated.

## Suite architecture

```
tests/
  helpers/
    server.js        Boots the Express app in-process against TEST_DATABASE_URL
    db.js            truncateAll(), raw pg/Prisma access for seeding + assertions
    session.js       login(name, password) -> supertest agent with cookie jar
    seed.js          Named fixture builders (users, locations, categories, bills)
    oracle.js        Recomputes every analytics figure in plain JS from seeded records
  api/
    auth.test.js  roles.test.js  users.test.js  locations.test.js
    categories.test.js  clients.test.js  bills.test.js
    transactions.test.js  settlement.test.js  analytics.test.js
    errors.test.js
  e2e/
    login.spec.js  operator.spec.js  admin-billing.spec.js
    admin-analytics.spec.js  accountant.spec.js  developer.spec.js
```

Key structural points:

- **`src/server.js` currently calls `app.listen()` at module load and
  `process.exit(1)` on missing env vars.** To test it in-process it must
  export `app` separately from starting the listener. This is a
  prerequisite refactor, not optional — note it as Phase 0 work.
- **Env**: tests read `TEST_DATABASE_URL`, never `DATABASE_URL`. The
  helper should hard-fail if the two are equal, so a misconfigured run
  can't truncate the dev database.
- **Schema setup**: `prisma migrate deploy` against the test DB once per
  run; `truncateAll()` between files.
- **Seeding**: users must be created with real argon2 hashes (the login
  path verifies them), so the seed helper hashes rather than inserting
  literals.
- **Timezone**: the server pins `TZ=UTC`. Tests should run under a
  *different* OS timezone in at least one CI variant (e.g. `TZ=America/New_York`)
  to prove IST handling doesn't depend on the host clock — the whole
  point of the `timestamptz` + `AT TIME ZONE 'Asia/Kolkata'` design.

### The analytics oracle

`helpers/oracle.js` takes the seeded bills/transactions as plain JS
objects and independently derives:

- day-wise totals and per-mode counts/amounts, bucketed by IST calendar day
- operator-wise `totalBilled` / `totalDiscount` / `totalCollected`
  (noting these come from two *different* groupings — bills by
  `createdById`, collections by `operatorId`)
- location-wise billed/discount/pending
- category-wise bill counts and billed totals
- client-outstanding and company-outstanding snapshots

Tests assert `API response === oracle output`. This catches drift in the
hand-written `$queryRaw` SQL that golden numbers would not, and it stays
correct when the fixture data changes.

The E2E layer then asserts the **rendered table cells** match the same
API JSON, so a correct backend with a broken renderer still fails.

---

## Scenario catalogue

Priority: **P1** = must pass before any release. **P2** = important edge
case. **P3** = nice to have.

### AUTH — authentication and session

| ID | Scenario | Expected | Pri |
| --- | --- | --- | --- |
| AUTH-01 | Login with correct name + password | 200, user `{id,name,role}`, session cookie set | P1 |
| AUTH-02 | Login with wrong password | 401 `Invalid name or password.` | P1 |
| AUTH-03 | Login with a name that doesn't exist | 401, **identical** message to AUTH-02 (no account-existence leak) | P1 |
| AUTH-04 | Login as a soft-deleted (deactivated) user | 401, identical message again | P1 |
| AUTH-05 | Login with missing `name` or `password` | 400 | P2 |
| AUTH-06 | `GET /auth/me` with no cookie | 401 `Not logged in.` | P1 |
| AUTH-07 | `GET /auth/me` with valid session | 200, echoes session user | P1 |
| AUTH-08 | `POST /auth/logout`, then `/auth/me` | logout 200; subsequent `/me` 401 | P1 |
| AUTH-09 | Login name is matched case-**sensitively** (`name` is the unique login id) | Confirm and pin whichever behavior is intended — `findUnique` on `name` means `"Ravi"` ≠ `"ravi"`. Worth an explicit decision, since client/category/company/location lookups elsewhere in the app *are* case-insensitive | P2 |
| AUTH-10 | Change own password with correct current password | 200 `{forceRelogin:true}`; old session dead (`/me` → 401); login works with new password only | P1 |
| AUTH-11 | Change password with wrong current password | 401, password unchanged | P1 |
| AUTH-12 | New password violates policy (<6 chars / no digit / no special char) — one case each | 400 with the specific message; password unchanged | P1 |
| AUTH-13 | Password change always acts on the session user, never a body-supplied id | Passing `{userId: someoneElse}` in the body has no effect on that user | P2 |
| AUTH-14 | Session survives across requests for the configured lifetime | Multiple sequential requests reuse the cookie | P2 |
| AUTH-15 | **User deactivated mid-session** — developer deactivates an operator who is already logged in | Document and pin actual behavior: `requireAuth` only checks the session, not `isDeleted`, so the operator can keep creating bills until the 4-hour session expires. If that's unacceptable, it's a code change; either way the test should encode the decision | P2 |

### ROLE — permission matrix

One test per (endpoint × role) cell. The matrix as implemented:

| Endpoint | operator | admin | developer | accountant | anon |
| --- | --- | --- | --- | --- | --- |
| `GET /bills`, `GET /bills/:id`, `POST /bills` | ✅ | ✅ | ❌ | ❌ | ❌ |
| `GET/POST/PATCH/DELETE /transactions` | ✅ | ✅ | ❌ | ❌ | ❌ |
| `GET /clients` | ✅ | ✅ | ❌ | ✅ | ❌ |
| `POST /clients` | ✅ | ✅ | ❌ | ❌ | ❌ |
| `GET /locations`, `GET /categories`, `GET /companies` | ✅ | ✅ | ❌ | ❌ | ❌ |
| `POST/DELETE /locations`, `POST/DELETE /categories` | ❌ | ✅ | ❌ | ❌ | ❌ |
| `GET /companies/:id/outstanding`, `POST /companies/:id/settle` | ✅ | ✅ | ❌ | ❌ | ❌ |
| all `/analytics/*` | ❌ | ✅ | ❌ | ✅ | ❌ |
| `GET /users` | ❌ | ❌ | ✅ | ❌ | ❌ |
| `GET /users/operators` | ❌ | ✅ | ✅ | ❌ | ❌ |
| `POST /users`, `PATCH /users/:id/demote`, `DELETE /users/:id` | ❌ | ❌ | ✅ | ❌ | ❌ |
| `PATCH /users/:id/promote` | ❌ | ✅ | ✅ | ❌ | ❌ |

| ID | Scenario | Expected | Pri |
| --- | --- | --- | --- |
| ROLE-01 | Table-driven sweep of every cell above | Allowed → not 401/403. Denied-but-logged-in → **403** `Not permitted for this role.` Anonymous → **401** | P1 |
| ROLE-02 | Accountant is genuinely read-only | Every write endpoint returns 403 for accountant; the only non-analytics read it gets is `GET /clients` | P1 |
| ROLE-03 | Developer cannot touch business data | `POST /bills`, `POST /transactions`, analytics all 403 for developer | P1 |
| ROLE-04 | Unknown `/api/*` path | 404 JSON `Not found.` | P3 |

### USER — user lifecycle (developer-managed)

| ID | Scenario | Expected | Pri |
| --- | --- | --- | --- |
| USER-01 | Create one user of each role (operator/admin/developer/accountant) | 201; each can then log in and lands on its own page | P1 |
| USER-02 | Create user with an invalid role string | 400 listing valid roles | P1 |
| USER-03 | Create user with a duplicate name | 409 | P1 |
| USER-04 | Create user with a duplicate name differing only in case | Pin the behavior — `findUnique` is case-sensitive, so `"ravi"` alongside `"Ravi"` succeeds and creates two logins. Related to AUTH-09 | P2 |
| USER-05 | Create user with a policy-violating password | 400; no user created | P1 |
| USER-06 | Create user with missing field(s) | 400 | P2 |
| USER-07 | Promote operator → admin (as admin, and as developer) | 200, role `admin`; the promoted user now reaches admin-only endpoints | P1 |
| USER-08 | Promote a non-operator (admin / developer / accountant) | 400 `Only an operator can be promoted to admin.` | P1 |
| USER-09 | Promote a deactivated user | 404 | P2 |
| USER-10 | Promote a non-existent id | 404 | P2 |
| USER-11 | Demote admin → operator (developer only) | 200, role `operator`; admin-only endpoints now 403 for them | P1 |
| USER-12 | Demote a non-admin | 400 | P1 |
| USER-13 | Deactivate a user | 200, `isDeleted` true, `deletedAt`/`deletedById` recorded; that user can no longer log in | P1 |
| USER-14 | Deactivate own account | 400 `You cannot deactivate your own account.` | P1 |
| USER-15 | Deactivate an already-deactivated user | 404 | P2 |
| USER-16 | Deactivating the last remaining developer | Currently permitted (only self-deactivation is blocked) — a developer can deactivate the *other* developer and be locked out of user management if they then lose their own password. Test documents this; whether to guard it is a product call | P2 |
| USER-17 | `GET /users/operators` returns only active operators, id+name only | No `passwordHash`, no deactivated rows, no non-operators | P1 |
| USER-18 | `GET /users` never exposes `passwordHash` | Field absent from every row | P1 |

### LOC — locations (admin-managed)

| ID | Scenario | Expected | Pri |
| --- | --- | --- | --- |
| LOC-01 | Add location with name + 2-digit code | 201 | P1 |
| LOC-02 | Code not exactly 2 digits: `"4"`, `"004"`, `"ab"`, `""`, `"0 4"` | 400 each | P1 |
| LOC-03 | Empty / whitespace-only name | 400 | P1 |
| LOC-04 | Duplicate active name (exact, and case-differing) | 409 both — lookup is case-insensitive here | P1 |
| LOC-05 | **Two different locations sharing the same code** | Both created — this is a confirmed design decision, not an error | P1 |
| LOC-06 | Soft-delete a location | 200, `isActive` false; gone from `GET /locations` | P1 |
| LOC-07 | Bills at a deleted location still resolve | `GET /bills` still shows the location name for historical bills | P1 |
| LOC-08 | Creating a new bill at a deleted location (by id, bypassing the picker) | 400 `Select a valid location from the list.` | P1 |
| LOC-09 | Re-adding a deleted location by the same name | Revived (`isActive` true), same row id, code updated to the newly submitted value — not a duplicate row | P2 |
| LOC-10 | Delete an already-deleted / non-existent location | 404 | P2 |

### CAT — categories and implicit companies

| ID | Scenario | Expected | Pri |
| --- | --- | --- | --- |
| CAT-01 | Add a `standard` category | 201, `companyId` null | P1 |
| CAT-02 | Add a `credit` category with a new `companyName` | 201; company created implicitly (find-or-create) and linked | P1 |
| CAT-03 | Add a `credit` category with an existing `companyId` | 201, links to that company; no new company row | P1 |
| CAT-04 | Add a `credit` category with a company name matching an existing one in different case | Reuses the existing company (case-insensitive find), does not create a second | P1 |
| CAT-05 | `credit` category with neither `companyId` nor `companyName` | 400 `A credit category requires a company name.` | P1 |
| CAT-06 | `credit` category with an inactive/non-existent `companyId` | 400 | P2 |
| CAT-07 | `credit` category whose named company exists but is inactive | Company reactivated, then linked | P2 |
| CAT-08 | Invalid `type` value | 400 listing valid types | P1 |
| CAT-09 | Empty / whitespace-only name | 400 | P1 |
| CAT-10 | Duplicate active category name (exact + case-differing) | 409 both | P1 |
| CAT-11 | Re-adding a soft-deleted category name with a *different* type/company | Revived and **overwritten** with the newly submitted type/company — verify that bills already attached to the old incarnation keep their own stored `companyId` and are not retroactively re-pointed | P2 |
| CAT-12 | Soft-delete a category | 200; gone from `GET /categories`; its linked company **stays active** (may still have bills to settle) | P1 |
| CAT-13 | Bills under a deleted category still display it | `GET /bills` still resolves the category name | P1 |
| CAT-14 | `GET /categories` returns `type` + nested `company` for credit categories | Needed by the bill form's picker subtitle | P1 |
| CAT-15 | A `standard` category submitted *with* a company name | Company is ignored, `companyId` stays null | P3 |

### CLI — clients

| ID | Scenario | Expected | Pri |
| --- | --- | --- | --- |
| CLI-01 | `POST /clients` with a name | 201 | P1 |
| CLI-02 | `POST /clients` with empty/whitespace name | 400 | P1 |
| CLI-03 | Bill creation with `clientName` matching an existing client (exact, different case, surrounding whitespace) | Reuses the existing client; **no** new client row | P1 |
| CLI-04 | Bill creation with a brand-new `clientName` | Client created, bill attached to it | P1 |
| CLI-05 | Bill creation with `clientId` for a non-existent client | 404 `Client not found.` | P1 |
| CLI-06 | Bill creation with neither `clientId` nor `clientName` | 400 | P1 |
| CLI-07 | Bill creation with `clientName` that is whitespace only | 400 `Client name cannot be empty.` | P2 |
| CLI-08 | **Duplicate clients via the direct endpoint** | `Client.name` is *not* unique in the schema and `POST /clients` does no duplicate check, while bill creation *is* case-insensitively de-duplicating. Two "Ravi" rows are therefore reachable, and would split that person's outstanding balance across two rows in analytics. Test should demonstrate it so the inconsistency is a conscious choice | P2 |
| CLI-09 | `GET /clients` ordering is alphabetical by name | Powers the combobox | P3 |

### BILL — bill creation, numbering, amounts

| ID | Scenario | Expected | Pri |
| --- | --- | --- | --- |
| BILL-01 | Create a bill, no discount, no initial payment | 201; `netAmount == originalAmount`, `balance == netAmount`, status `pending` | P1 |
| BILL-02 | Create with a discount | `netAmount == original - discount`, `balance == netAmount` | P1 |
| BILL-03 | Create with an initial payment < net | One transaction created **in the same DB transaction**; `balance == net - paid`, status `pending` | P1 |
| BILL-04 | Create with initial payment == net | `balance == 0`, status `fully_paid` | P1 |
| BILL-05 | `discount == original` (net 0), no payment | `balance == 0`, status `fully_paid` immediately, zero transactions | P2 |
| BILL-06 | `originalAmount` zero, negative, `"abc"`, `null`, missing | 400 `must be a positive number.` in each case | P1 |
| BILL-07 | Negative discount | 400 | P1 |
| BILL-08 | `discount > original` | 400 `cannot exceed originalAmount.` | P1 |
| BILL-09 | Initial payment > net | 400 `cannot exceed the bill's net amount.` | P1 |
| BILL-10 | Initial payment negative | 400 | P1 |
| BILL-11 | Initial payment > 0 with a missing or invalid `mode` | 400 listing valid modes | P1 |
| BILL-12 | Initial payment == 0 with no mode | Accepted; no transaction row created | P2 |
| BILL-13 | Missing `locationId` / `categoryId` | 400 each | P1 |
| BILL-14 | `credit` category → bill's `companyId` copied from the category | Never taken from the request body — confirm a body-supplied `companyId` is ignored | P1 |
| BILL-15 | `standard` category → bill's `companyId` is null | P1 |
| BILL-16 | Credit category with a null `companyId` (misconfigured) | 400 with the "contact an admin" message | P2 |
| BILL-17 | **[util-via-API]** First bill of the month at a location | Bill number `{code}{YY}{MM}0000` — sequence starts at **0000**, not 0001 | P1 |
| BILL-18 | **[util-via-API]** Several bills in a row at one location | Sequences increment `0000, 0001, 0002 …` | P1 |
| BILL-19 | **[util-via-API]** Bills at two locations that **share** a code | They draw from the **same** counter — no duplicate bill numbers | P1 |
| BILL-20 | **[util-via-API]** Bills at two locations with different codes | Independent sequences, both starting at `0000` | P1 |
| BILL-21 | **[util-via-API]** Month rollover, same location | Sequence resets to `0000` for the new `{YY}{MM}` | P1 |
| BILL-22 | **[util-via-API]** Sequence cap: pre-seed the counter at 9999, then create two bills | The 10000th bill gets `9999`; the next is rejected. Verify the counter row is **rolled back** (not left bumped) after the failure, since the increment happens inside the same transaction as the throw | P2 |
| BILL-23 | Bill number is unique across the whole table | DB unique constraint holds | P1 |
| BILL-24 | **[util-via-API]** Backdated bill (`billDate` in a past month) | Bill number uses the *backdated* month's prefix and counter; `createdAt` falls on that IST calendar day, carrying the current IST wall-clock time | P1 |
| BILL-25 | **[util-via-API]** `billDate` omitted | Defaults to today in IST — assert against IST, not the host timezone | P1 |
| BILL-26 | **[util-via-API]** Invalid `billDate`: `"2026-02-30"`, `"26-09-13"`, `"abc"`, `""` | 400 `must be a valid date in YYYY-MM-DD format.` — the round-trip check must reject calendar-invalid dates, not just malformed ones | P1 |
| BILL-27 | **[util-via-API]** Leap-day `billDate` (`2028-02-29`) | Accepted | P3 |
| BILL-28 | **[util-via-API]** `billDate` in the **future** | Currently accepted with no upper bound. Critically, `parseDateRange` defaults its upper bound to *now + 24h*, so a bill dated next week is **silently invisible** in unfiltered analytics. Test must assert whichever behavior is intended — this is the single most likely source of "my numbers don't add up" | P1 |
| BILL-29 | Bill's initial payment inherits the bill's timestamp | A backdated bill's initial transaction buckets on the bill's day, not today | P1 |
| BILL-30 | `createdById` recorded as the logged-in user | Drives operator-wise analytics | P1 |
| BILL-31 | Any failure inside bill creation leaves **nothing** behind | e.g. invalid location after a new client name was supplied → no orphan client, no bill, no counter bump. Verify by row counts | P1 |
| BILL-32 | `GET /bills` ordering and includes | Newest first; client/location/category/company/createdBy all resolved | P2 |
| BILL-33 | `GET /bills/:id` includes the transaction ledger, oldest-first, **excluding** soft-deleted transactions | P1 |
| BILL-34 | `GET /bills/:id` with a non-existent (but well-formed uuid) id | 404 | P2 |
| BILL-35 | Money precision: amounts like `0.01`, `999999999.99`, `10.005`, `1e3` | Decide and pin the rounding behavior. `Decimal(12,2)` columns are read back into JS `Number` for all the arithmetic in `bills.js`/`transactions.js`, so third-decimal inputs and very large values are where a rupee can silently appear or vanish | P1 |

### TXN — payments, edits, deletions

| ID | Scenario | Expected | Pri |
| --- | --- | --- | --- |
| TXN-01 | Partial payment | `balance` reduced by the amount, status stays `pending` | P1 |
| TXN-02 | Payment for the exact remaining balance | `balance` 0, status `fully_paid` | P1 |
| TXN-03 | Payment exceeding the remaining balance | 400 quoting the total and the balance; nothing written | P1 |
| TXN-04 | Payment against an already fully-paid bill | 400 `This bill is already fully paid.` | P1 |
| TXN-05 | Payment with an additional discount, `amount + discount < balance` | `balance -= (amount + discount)`; bill `discountAmount += discount`; bill `netAmount == original - newDiscount`; transaction row stores its own `discountAmount` | P1 |
| TXN-06 | `amount + discount == balance` exactly | `balance` 0, `fully_paid` | P1 |
| TXN-07 | `amount + discount > balance` | 400; nothing written | P1 |
| TXN-08 | Discount-only intent (`amount` 0, `discount` > 0) | Currently **rejected** — `amountCollected` must be > 0. Confirm that's intended; writing off a residual balance purely as discount is otherwise impossible through this endpoint | P2 |
| TXN-09 | Zero / negative / non-numeric `amountCollected` | 400 | P1 |
| TXN-10 | Negative `discountAmount` | 400 | P1 |
| TXN-11 | Invalid / missing `mode` | 400 listing valid modes | P1 |
| TXN-12 | Missing `billId`, or a non-existent one | 400 / 404 | P1 |
| TXN-13 | `operatorId` and `createdById` both set to the logged-in user | P1 |
| TXN-14 | Multiple sequential payments on one bill | Balance walks down correctly; ledger lists all of them | P1 |
| TXN-15 | Edit a transaction's amount upward / downward | Bill balance recomputed by undoing the old contribution then applying the new — not by naive delta | P1 |
| TXN-16 | Edit only the `mode` | Amounts untouched, balance unchanged | P1 |
| TXN-17 | Edit a transaction that **had** a discount, changing the discount | Bill's `discountAmount` and `netAmount` end up correct — old discount fully removed, new one applied | P1 |
| TXN-18 | Edit that would push the bill's total over its balance | 400 `would exceed the bill's balance.`; bill untouched | P1 |
| TXN-19 | Edit that brings the balance to exactly 0 | Status flips to `fully_paid` | P1 |
| TXN-20 | Edit a transaction on a `fully_paid` bill, reducing the amount | Status flips **back** to `pending` | P1 |
| TXN-21 | Edit with no updatable fields supplied | 400 | P2 |
| TXN-22 | Edit records `updatedById` and bumps `updatedAt` | P2 |
| TXN-23 | Edit a soft-deleted or non-existent transaction | 404 | P1 |
| TXN-24 | Delete (soft) a plain transaction | `isDeleted` true; amount restored to the bill's balance; status back to `pending` if it was paid off | P1 |
| TXN-25 | Delete a transaction that included a discount | **Both** the amount and the discount are reversed — bill `discountAmount` drops, `netAmount` rises, balance restored by amount+discount | P1 |
| TXN-26 | Deleted transactions disappear from `GET /transactions`, `GET /bills/:id` ledger, and all analytics | P1 |
| TXN-27 | Delete an already-deleted transaction | 404 | P2 |
| TXN-28 | Delete, then create a fresh payment on the same bill | Works against the restored balance | P2 |
| TXN-29 | Full round trip: create bill → several payments with discounts → edit one → delete another | Final `balance == netAmount - Σ(live amounts)`; `discountAmount == creation discount + Σ(live transaction discounts)`; `netAmount == original - discountAmount`. **This is the single most important invariant in the app** — assert all three after every mutation | P1 |
| TXN-30 | `GET /transactions?billId=` filter | Only that bill's live transactions | P2 |
| TXN-31 | Edit/delete a transaction created by **another** operator | Currently permitted for any operator/admin. Test pins it — there is no ownership check | P2 |

### SET — company settlement

| ID | Scenario | Expected | Pri |
| --- | --- | --- | --- |
| SET-01 | `GET /companies/:id/outstanding` | Only that company's `pending` bills, oldest-first, each with client name + balance; `totalOutstanding` == Σ balances; `pendingBillCount` correct | P1 |
| SET-02 | Outstanding for a company with no pending bills | Empty list, total 0 | P1 |
| SET-03 | Outstanding for a non-existent company | 404 | P2 |
| SET-04 | Settle a hand-picked subset of bills | Only the checked bills go to `balance` 0 / `fully_paid`; **unchecked bills are untouched** (the disputed-bill requirement) | P1 |
| SET-05 | One full-balance transaction created per settled bill | Correct `billId`, `clientId`, amount == prior balance, chosen mode, settling user as operator+creator | P1 |
| SET-06 | Settle a bill belonging to a **different** company | 400 naming the bill; **entire settlement rejected**, nothing applied | P1 |
| SET-07 | Settle a list containing an already-`fully_paid` bill (stale UI selection) | 400; nothing applied — assert balances of the *other* selected bills are unchanged | P1 |
| SET-08 | Settle with a non-existent bill id in the list | 404; nothing applied | P1 |
| SET-09 | `billIds` empty, not an array, or missing | 400 | P1 |
| SET-10 | Invalid / missing `mode` | 400 | P1 |
| SET-11 | Settlement transactions' `createdAt` is **now**, not the bills' dates | So settling old bills lands in *today's* day-wise bucket. Intended, but must be asserted — it's a common reporting surprise | P1 |
| SET-12 | Settlement amounts flow into analytics | Day-wise total, operator-wise `totalCollected`, and company-outstanding all move by the settled amount | P1 |
| SET-13 | Settling a partially-paid bill | Only the *remaining* balance is charged, not the full net | P1 |
| SET-14 | Delete a settlement transaction afterwards | Bill returns to `pending` with its balance restored; company outstanding rises again | P2 |
| SET-15 | Settled bills vanish from that company's outstanding list | P2 |

### ANL — analytics, against the oracle

Every scenario here asserts the endpoint's JSON equals
`helpers/oracle.js`'s independent computation over the same seeded data.

| ID | Scenario | Expected | Pri |
| --- | --- | --- | --- |
| ANL-01 | Day-wise over a mixed dataset | Per-day `total_collected`, `transaction_count`, and per-mode count+total for cash/credit_card/upi all match the oracle; modes with no activity report 0, not null | P1 |
| ANL-02 | Day-wise excludes soft-deleted transactions | P1 |
| ANL-03 | **IST day boundary** — transactions at 18:25 UTC and 18:35 UTC on the same UTC day (= 23:55 and 00:05 IST) | They land on **two different** IST days. The highest-value timezone test in the suite | P1 |
| ANL-04 | Day-wise with the host OS in a non-IST timezone | Identical results to the IST-host run | P1 |
| ANL-05 | **[util-via-API]** `endDate` is **inclusive** | A transaction at 23:59 IST on `endDate` is included | P1 |
| ANL-06 | **[util-via-API]** `startDate` is inclusive from 00:00 IST | A transaction at 00:00:01 IST on `startDate` is included; one at 23:59 IST the day before is not | P1 |
| ANL-07 | **[util-via-API]** Both dates omitted | Lower bound = epoch, upper bound = now + 24h — so **future-dated records are excluded**. Pair with BILL-28 | P1 |
| ANL-08 | `startDate` only / `endDate` only | Open-ended on the missing side | P2 |
| ANL-09 | `startDate` after `endDate` | Empty result, no error | P2 |
| ANL-10 | Operator-wise: bills and collections by the **same** operator | One row with correct `totalBilled`, `totalDiscount`, `totalCollected`, `billsCreated`, `transactionCount` | P1 |
| ANL-11 | Operator-wise: operator A raises the bill, operator B collects | A gets the billed/discount figures, B gets the collected figure — two rows, no double counting | P1 |
| ANL-12 | Operator-wise: an operator who collected but raised no bills | Row present with `totalBilled`/`totalDiscount`/`billsCreated` = 0, not undefined | P1 |
| ANL-13 | Operator-wise: an operator who raised bills but collected nothing | Row present with `totalCollected`/`transactionCount` = 0 | P1 |
| ANL-14 | Operator-wise with a legacy bill (`createdById` null) | Grouped as `Unattributed (legacy bills)`; seed by direct SQL insert since the API always sets it | P2 |
| ANL-15 | Operator-wise for a **deactivated** operator with historical activity | Still appears with their name; deactivation doesn't erase history | P2 |
| ANL-16 | Operator-wise `totalDiscount` includes payment-time discounts | A discount given via `POST /transactions` shows up here, because it was folded into `Bill.discountAmount` — the documented design | P1 |
| ANL-17 | Location-wise: billed/discount/pending per location | Matches oracle; grouped by the bill's location | P1 |
| ANL-18 | Location-wise `total_pending` is **current** balance, not as-of-range | A bill raised in-range and since fully paid contributes to billed but shows 0 pending | P1 |
| ANL-19 | Location-wise with two locations sharing a code | Reported **separately** by location, even though they share a bill-number counter | P1 |
| ANL-20 | Location-wise with a null-location legacy bill | `Unspecified (legacy bills)` | P2 |
| ANL-21 | Category-wise counts **bills**, not clients | One client with bills in two categories appears in both rows | P1 |
| ANL-22 | Category-wise includes `category_type` and survives a soft-deleted category | Deleted categories still report their historical bills | P1 |
| ANL-23 | Category-wise with a null-category legacy bill | `Unspecified (legacy bills)` | P2 |
| ANL-24 | Client-outstanding ignores the date range entirely | Same result with and without date params — it's a current-state snapshot | P1 |
| ANL-25 | Client-outstanding excludes fully-settled clients | `HAVING SUM(balance) > 0` — a client whose every bill is paid is absent | P1 |
| ANL-26 | Client-outstanding sums across multiple bills per client | Matches oracle; `pending_bill_count` counts only `pending` bills | P1 |
| ANL-27 | Company-outstanding, same three properties as ANL-24/25/26 | P1 |
| ANL-28 | Company-outstanding after a settlement | Company drops off the list once every bill is closed | P1 |
| ANL-29 | Company-outstanding only counts bills actually linked to a company | Standard-category bills never appear | P1 |
| ANL-30 | Client-daily for one client | Per-IST-day totals for that client only; excludes deleted transactions; respects the range | P1 |
| ANL-31 | Client-ledger for one client | Every bill (any date), newest-first, each with its live transactions oldest-first and the operator resolved | P1 |
| ANL-32 | Client-ledger is **not** date-filtered | Passing a narrow range changes nothing | P2 |
| ANL-33 | Cross-endpoint reconciliation on one seeded dataset | Σ day-wise collected == Σ operator-wise collected == Σ (netAmount − balance) across all bills. Σ client-outstanding == Σ bill balances. Σ location-wise billed == Σ bill `originalAmount` in range. **The end-to-end "do the dashboard numbers make sense" check** | P1 |
| ANL-34 | Empty database | Every endpoint returns an empty array, not null or a 500 | P1 |
| ANL-35 | Analytics after a transaction edit and after a delete | Totals move to match the new state — no stale aggregation | P1 |

### ERR — malformed input and error handling

These target a specific structural gap: **`analytics.js`, `clients.js`,
`users.js` and `auth.js` have route handlers with no `try/catch`.** Express 4
does not catch rejected promises from async handlers, so a thrown Prisma
error there hits the `unhandledRejection` hook in `server.js` — which logs
and keeps the process alive, but **never sends a response**, leaving the
request hanging until the client times out. Each scenario below should
assert *a response arrives* with a sane status.

| ID | Scenario | Expected | Pri |
| --- | --- | --- | --- |
| ERR-01 | `GET /analytics/client-daily/not-a-uuid` | A 4xx response, promptly. Expected to **fail** today (hang) — confirm and report | P1 |
| ERR-02 | `GET /analytics/client-ledger/not-a-uuid` | Same | P1 |
| ERR-03 | `GET /analytics/day-wise?startDate=garbage` | `new Date("garbageT00:00:00+05:30")` is an Invalid Date reaching the SQL query. Assert a 4xx, not a hang | P1 |
| ERR-04 | `GET /analytics/day-wise?endDate=2026-13-45` | Same | P1 |
| ERR-05 | `GET /bills/not-a-uuid` | Wrapped in try/catch? Verify a response arrives | P1 |
| ERR-06 | `PATCH /transactions/not-a-uuid` | Response arrives (route has try/catch — should be 404/500) | P2 |
| ERR-07 | Request body is not valid JSON | 400 from `express.json()`, handled by the final error middleware | P2 |
| ERR-08 | Request body absent entirely on a POST | 400 field-validation error, not a crash on destructuring `undefined` | P2 |
| ERR-09 | Enormously long strings in name fields | Either accepted or a clean 400 — never a 500 | P3 |
| ERR-10 | Unicode / emoji in client and category names | Stored and returned intact; case-insensitive matching still behaves | P3 |
| ERR-11 | Server responds after an error in a prior request | Process stays up and serves the next request (the `unhandledRejection` guard's actual purpose) | P2 |

### E2E — browser flows (Playwright)

Each E2E test seeds via the API/DB helpers, then drives the UI. All
assertions on money use the `en-IN` two-decimal format the app renders.

**Login and routing**

| ID | Scenario | Expected | Pri |
| --- | --- | --- | --- |
| E2E-01 | Log in as each role | Redirected to `operator.html` / `admin.html` / `developer.html` / `accountant.html` respectively | P1 |
| E2E-02 | Bad credentials | Error message rendered; stays on the login page | P1 |
| E2E-03 | Visit `login.html` while already logged in | Auto-redirected to the role page | P2 |
| E2E-04 | Visit a role page you're not entitled to (e.g. operator opens `admin.html`) | `guardPage` bounces to the user's own role page | P1 |
| E2E-05 | Visit any role page with no session | Redirected to `login.html` | P1 |
| E2E-06 | `/` root path | Redirects to `login.html` | P3 |
| E2E-07 | Session reminder banner appears once after login | Shown on the role page (carried via `sessionStorage`), not on re-navigation | P2 |
| E2E-08 | Logout | Back to login; the back button doesn't restore a working session | P1 |

**Operator page**

| ID | Scenario | Expected | Pri |
| --- | --- | --- | --- |
| E2E-09 | Create bill: type a **new** client name, pick location + category from the dropdowns, submit | Success message quotes the generated bill number and balance; the form resets with bill date back to today (IST) and discount/initial back to `0` | P1 |
| E2E-10 | Combobox filtering and keyboard selection | Typing narrows the list; arrow keys + Enter select; the hidden id is populated | P1 |
| E2E-11 | Submit with location typed but **not** selected from the list | Client-side error `Select a valid location from the suggestions list.`; no request sent | P1 |
| E2E-12 | Same for a non-selected category | Client-side error | P1 |
| E2E-13 | Submit with an empty client input | Client-side error `Enter a client name.` | P1 |
| E2E-14 | Select a **credit** category | Info line reads `Credit bill — will be billed to <Company>.`; success message includes `(billed to …)` | P1 |
| E2E-15 | Clear the category input after selecting | Info line clears (the `input` listener path) | P2 |
| E2E-16 | Create bill with an initial payment | Bill appears in My Bills with the correct Collected and Balance columns | P1 |
| E2E-17 | My Bills shows **only bills you created** | A bill created by another operator is absent from the table, even though `GET /bills` returns it | P1 |
| E2E-18 | My Bills summary line | Bills count, Billed, Collected, Discount, Outstanding all match the rendered rows | P1 |
| E2E-19 | Record Payment on a bill created by someone else | Permitted — the picker lists **all** pending bills, not just your own | P1 |
| E2E-20 | Record Payment with a discount | Message mentions both the collected amount and the discount; My Bills balance and discount update | P1 |
| E2E-21 | Record Payment exceeding the balance | Server error surfaced in the message area; nothing changes | P1 |
| E2E-22 | Fully paying a bill | Badge flips to `Fully Paid`; the bill leaves the Record Payment picker | P1 |
| E2E-23 | Settle Company Balance: pick a company | Outstanding bills table appears with checkboxes, client names, balances, dates | P1 |
| E2E-24 | Check/uncheck bills | "Total selected" running total and bill count update live | P1 |
| E2E-25 | Submit with nothing checked | `Check at least one bill to settle.` | P1 |
| E2E-26 | Submit a partial selection | Success message lists the per-bill breakdown; unchecked bills remain pending in My Bills | P1 |
| E2E-27 | Pick a company with no outstanding bills | `This company has no outstanding bills.` | P2 |
| E2E-28 | Timestamps render in IST with the **browser** set to a non-IST timezone | Playwright `timezoneId: 'America/New_York'` — dates still show IST | P1 |
| E2E-29 | Bill date picker defaults to today in IST under a non-IST browser timezone | P1 |
| E2E-30 | Change Password modal: open, mismatched confirmation | `New password and confirmation do not match.`; no request sent | P1 |
| E2E-31 | Change Password success | Confirmation shown, redirected to login after ~1.2s, and the login page displays the one-time "password was changed" notice | P1 |
| E2E-32 | Change Password with a policy violation | Server message rendered in the modal | P1 |
| E2E-33 | Close the modal via Cancel and via the backdrop | Closes and resets the form | P2 |

**Admin page**

| ID | Scenario | Expected | Pri |
| --- | --- | --- | --- |
| E2E-34 | Tab switching across Billing / Analytics / Promote / Locations / Categories | Exactly one section visible at a time; each tab's data loads on activation | P1 |
| E2E-35 | Admin billing mirrors the operator flows | Spot-check create bill, record payment, settle — same widgets | P1 |
| E2E-36 | Promote an operator | Picker lists active operators; after promoting, the user is gone from the picker and shows as admin | P1 |
| E2E-37 | Add a location with a valid code | Appears in the table and in the bill form's location picker | P1 |
| E2E-38 | Add a location with an invalid code | Error message rendered | P1 |
| E2E-39 | Delete a location | Leaves the table and the picker; existing bills still display it | P1 |
| E2E-40 | Add a standard category | Appears in the table and the picker with subtitle `Standard` | P1 |
| E2E-41 | Add a credit category with a new company name | Company field appears only when type is `credit`; category subtitle shows `Credit — <Company>`; the company becomes selectable in Settle | P1 |
| E2E-42 | Add a credit category with no company | Error message | P1 |
| E2E-43 | Delete a category | Leaves the picker; its company remains available for settlement | P1 |

**Analytics dashboard (admin + accountant) — the UI cross-check**

| ID | Scenario | Expected | Pri |
| --- | --- | --- | --- |
| E2E-44 | With a known seeded dataset, every analytics table's rendered cells match the API JSON *and* the oracle | Day-wise, operator-wise, location-wise, category-wise, company-outstanding, client-outstanding — cell by cell | P1 |
| E2E-45 | Apply a date range | Every range-sensitive table refilters; the range label updates | P1 |
| E2E-46 | Clear the date range | Back to unfiltered figures | P1 |
| E2E-47 | Outstanding tables **ignore** the date range | Unchanged when a narrow range is applied — the snapshot semantics, visible in the UI | P1 |
| E2E-48 | Per-Client Detail: pick a client | Per-day summary respects the range; bill ledger shows full history regardless | P1 |
| E2E-49 | Currency formatting | Two decimals, `en-IN` grouping, everywhere | P2 |
| E2E-50 | Empty dataset / empty range | Tables render empty without JS errors; assert no console errors | P1 |
| E2E-51 | Download PDF on each of the 7 tables | A file downloads, non-empty, with a sensible filename | P1 |
| E2E-52 | PDF content matches the table | Extract text from the downloaded PDF and assert the row values match the rendered table — otherwise a silently truncated export passes | P2 |
| E2E-53 | Per-Client Detail PDF stacks **both** sections in one file | P2 |
| E2E-54 | Accountant sees the analytics tabs and PDF buttons but **no** billing/promote/locations/categories UI | P1 |
| E2E-55 | jsPDF loads from `public/vendor/` with **all external network blocked** | Playwright route-blocks everything off-origin; PDF export still works (the offline requirement) | P1 |

**Developer page**

| ID | Scenario | Expected | Pri |
| --- | --- | --- | --- |
| E2E-56 | Create a user of each role | Appears in the All Users table with the right role badge | P1 |
| E2E-57 | Action buttons are role-appropriate | Promote only on operators, Demote only on admins, no Deactivate on your own row | P1 |
| E2E-58 | Promote / Demote / Deactivate from the table | Table refreshes with the new state; deactivated rows show `Deactivated` with no action buttons | P1 |
| E2E-59 | Duplicate name / weak password on create | Error surfaced in the message area | P1 |
| E2E-60 | A deactivated user can no longer log in | Verified through the login page | P1 |

---

## Phasing

**Phase 0 — make the app testable** (blocking prerequisite)
- Split `src/server.js`: export `app`, move `listen()` behind a
  `require.main === module` guard or into a `src/index.js`.
- Add `TEST_DATABASE_URL` handling plus the guard that refuses to run when
  it equals `DATABASE_URL`.
- Add `npm test`, `npm run test:api`, `npm run test:e2e`.
- Install `supertest` and `@playwright/test` as dev dependencies.

**Phase 1 — harness**
`helpers/` (server boot, truncate, login/session, seed builders). Prove it
with a single smoke test: log in, create a bill, assert the row.

**Phase 2 — API integration**
AUTH, ROLE, USER, LOC, CAT, CLI, BILL, TXN, SET. Highest defect-catching
value per line of test code, and where the money invariants live
(TXN-29 above all).

**Phase 3 — analytics oracle**
`helpers/oracle.js` plus the ANL block, including the cross-endpoint
reconciliation (ANL-33) and the IST boundary tests.

**Phase 4 — E2E**
Playwright, in the E2E order listed: login/routing → operator → admin →
analytics dashboard + PDF → developer.

**Phase 5 — ERR**
Deliberately last: several of these are expected to fail against the
current code, so they should land once the suite is otherwise green and
the failures are unambiguous.

## Risk areas this plan deliberately targets

Read while writing the scenarios above; each has a scenario ID attached
so the suite either confirms the behavior is intended or surfaces it as a
defect.

1. **Async handlers without `try/catch`** in `analytics.js`, `clients.js`,
   `users.js`, `auth.js` — Express 4 leaves the request hanging rather
   than erroring. (ERR-01…05)
2. **Future-dated bills are invisible in unfiltered analytics** —
   `parseDateRange` caps the upper bound at now + 24h while bill creation
   accepts any future `billDate`. (BILL-28, ANL-07)
3. **`Decimal` → JS `Number` arithmetic** throughout bill and transaction
   math; no rounding or precision guard on input. (BILL-35)
4. **Duplicate clients are reachable** — `Client.name` isn't unique and
   `POST /clients` doesn't check, while bill creation de-duplicates
   case-insensitively. Splits a client's outstanding balance. (CLI-08)
5. **Deactivation doesn't revoke a live session** — `requireAuth` never
   re-checks `isDeleted`. (AUTH-15)
6. **Case sensitivity is inconsistent** — login/user names are
   case-sensitive; clients, categories, companies and locations are
   case-insensitive. (AUTH-09, USER-04)
7. **Bill-number counter under a rejected bill** — the counter is
   incremented before the 9999 check throws; relies on transaction
   rollback. (BILL-22)
8. **Category revival overwrites type and company** for a name that was
   previously soft-deleted. (CAT-11)
9. **No ownership check on transaction edit/delete** — any operator can
   modify any operator's payment. (TXN-31)
10. **Settlement timestamps are "now"**, so settling old bills reports in
    today's bucket. (SET-11)

## Out of scope (per the agreed depth)

Not covered by this plan; listed so the gaps are explicit rather than
forgotten:

- Concurrency — 6+ simultaneous operators, parallel bill creation racing
  the bill-number counter, two operators paying one bill at once.
  `generateBillNumber`'s atomicity is the app's central concurrency claim
  and is **untested** by this plan.
- Load and performance — analytics query cost at thousands of bills,
  PDF export on large tables, response times.
- Security probing beyond the role matrix — IDOR sweeps, session fixation,
  the `secure: false` cookie over LAN HTTP, CSRF (there is no CSRF
  protection and the session cookie has no `sameSite` setting).
- Operational — LAN access from other PCs, Windows service wrapping,
  `pg_dump` backup/restore, in-memory session loss on process restart.
- Migration correctness — replaying the 9 existing migrations against a
  populated database, and the nullable legacy columns (`createdById`,
  `locationId`, `categoryId`) that only real legacy data exercises.

## Open questions

None of these block writing the suite, but each changes what a test
asserts:

1. **Case sensitivity**: should login names be case-insensitive to match
   every other lookup in the app? (AUTH-09, USER-04)
2. **Future-dated bills**: should `billDate` be capped at today, or should
   the analytics upper bound be extended to include them? Right now
   neither, and the two disagree. (BILL-28)
3. **Discount-only write-offs**: should `POST /transactions` accept
   `amountCollected: 0` with a discount, to close out a residual balance?
   (TXN-08)
4. **Deactivation vs. live sessions**: should deactivating a user kill
   their session immediately? (AUTH-15)
5. **Transaction ownership**: should editing or deleting a payment be
   restricted to its creator, or to admins? (TXN-31)
6. **Rounding**: what should happen to an amount with three decimal
   places — reject, or round half-up? (BILL-35)
7. **CI**: will these run anywhere other than the dev machine? If a
   Windows server or GitHub Actions is in play, the Postgres provisioning
   and Playwright browser install steps need to be planned for it.

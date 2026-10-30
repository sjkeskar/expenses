# Fix plan for the open bugs

> Historical: this plan was for the pre-pivot app and is complete. The
> files and tests it names were retired with the old frontend (`pivot.md` §13).

Written 2026-10-15, from a read of all 18 files in `Open/` checked against the
code. Every report's root-cause line numbers were verified as accurate.

**Status: complete.** All seven batches are implemented, verified and closed
(batches 1-3 on 2026-10-15, batches 4-7 on 2026-10-16). Seventeen of the 18
bugs are in `Closed/`; BUG-006 stays open as a product decision (see "Not in
this plan").

Finishing batches 4-7 (2026-10-16): the developer page driver selector was
updated to `#create-user-password`, the `knownBug` lines for the ten bugs were
removed, the BUG-009 workarounds (retry in `Combobox.pick()`, `toPass` in
admin-tabs H5, slow tabbing in M3b) were deleted, new regression tests were
added (B6, K4c, K4d, K7, K8, M3i, M3j), and six visual baselines were
re-recorded after review. Visual tolerance was also tightened, because the old
one let the BUG-012 badge colour change pass unnoticed. `npm run test:e2e` is
green: 319 tests, in three full runs.

Re-testing found one new bug, **BUG-019** (Settle list loaded twice, wiping
ticked bills). It predates these fixes and is filed in `Open/`, outside this
plan.

## How the 18 bugs group

Most of them are one defect repeated across files. Five shared pieces account
for ten of the bugs:

| Shared piece | Closes |
|---|---|
| `src/utils/money.js` — integer-paise maths | BUG-008 (3 route files) |
| `FOR UPDATE` row lock at the top of each write transaction | BUG-011 (5 endpoints) |
| `escapeHtml()` in `common.js` + a CSP header | BUG-004 (31 interpolation sites) |
| One rewrite of `attachCombobox()` | BUG-009, BUG-014, BUG-018 |
| A `setupModal()` focus-management helper | BUG-015, and the recurrence half of BUG-001 |

## Batch order and dependencies

| Batch | Scope | Bugs | Severity covered |
|---|---|---|---|
| 1 | Money and data integrity (backend) | 008, 002, 005, 011 | 1 Critical, 1 High |
| 2 | Session freshness and HTTP caching | 003, 007 | 1 High |
| 3 | Stored XSS | 004 | 1 Critical |
| 4 | Combobox | 009, 014, 018 | — |
| 5 | Modals and the password-field collision | 001, 015 | — |
| 6 | Form submission | 010, 013 | — |
| 7 | CSS and markup polish | 012, 016, 017 | — |

Hard dependencies:

- **Within batch 1:** money helper → refunded guards → row locks. The locks
  wrap the same blocks the first two edit, so doing them last avoids
  re-resolving the same conflicts three times.
- **Batch 3 before batch 6.** BUG-013's `aria-label` interpolates a client
  name, so it needs `escapeHtml()` to already exist.
- **Batch 7 last.** BUG-012, BUG-016 and (to a lesser extent) BUG-013/015 all
  change the visual baselines. Run
  `npm run test:e2e:update-snapshots` **once**, at the end of batch 7, rather
  than three times.

Batches 1 and 2 are backend-only and cover both Critical and both High bugs.
They are the useful stopping point if the work has to be split.

---

## Batch 1 — Money and data integrity

### BUG-008 — floating-point money

Add `src/utils/money.js`:

```js
const toPaise = (v) => Math.round(Number(v) * 100);   // 0.30 -> 30
const fromPaise = (p) => (p / 100).toFixed(2);        // Prisma accepts the string as a Decimal
```

`Math.round(Number(v) * 100)` is safe at `Decimal(12,2)` magnitudes: the
binary error in `0.30 * 100` is many orders of magnitude below 0.5, so it
rounds to 30 correctly. The bug is entirely in *comparing* unrounded floats,
not in the multiplication.

Convert at the boundary — read a Decimal, go to paise immediately, compare
integers, write back `fromPaise(...)`:

- `src/routes/bills.js:143` (`netAmount = original - discount`) and `:153`
  (`initialAmount > netAmount`)
- `src/routes/transactions.js:67-68` (POST), `:158-169` (PATCH),
  `:225-228` (DELETE)
- `src/routes/companies.js` — the settle loop's `totalSettled` accumulation

Format every amount that appears in an error message with `fromPaise`, so
`0.30000000000000004` can never reach a user again.

Optional hardening, worth considering while in here: reject inputs with more
than two decimal places instead of silently rounding sub-paisa away.

### BUG-002 — payments on a refunded bill

In `src/routes/transactions.js`, right after the bill is loaded in PATCH
(`:144`) and DELETE (`:224`):

```js
if (bill.status === "refunded") {
  throw { status: 400, message: "This bill has been refunded; its payments can no longer be changed." };
}
```

### BUG-005 — duplicate bill ids in a settlement

`src/routes/companies.js:87`. De-duplicate up front and **reject** rather than
silently carrying on with the unique set — a client sending the same bill id
twice has a bug of its own, and hiding it isn't a kindness:

```js
const uniqueIds = [...new Set(billIds)];
if (uniqueIds.length !== billIds.length) {
  return res.status(400).json({ error: "Each bill can only be selected once." });
}
```

### BUG-011 — concurrent writes

Lock first, read second. Under READ COMMITTED each statement takes a fresh
snapshot, so the `findUnique` *after* the lock is granted sees the other
transaction's committed write — which is exactly what the current code misses:

```js
await tx.$queryRaw`SELECT 1 FROM "bills" WHERE "id" = ${billId} FOR UPDATE`;
const bill = await tx.bill.findUnique({ where: { id: billId } });   // now fresh
```

Five sites:

| File | Endpoint |
|---|---|
| `src/routes/transactions.js` | POST (`:59`), PATCH (`:138`), DELETE (`:218`) |
| `src/routes/companies.js:87` | settle |
| `src/routes/bills.js:275` | refund |
| `src/routes/bills.js:343` | reassign-operator |

Two details that matter:

- **Settlement locks ids one at a time, in sorted order** — not a single
  `WHERE id IN (...) FOR UPDATE`. Postgres does not guarantee the order in
  which rows are locked by such a statement (the sort may be applied after the
  fetch), and deterministic lock ordering is the whole point: it is what stops
  two overlapping settlements deadlocking each other.
- **Raise the transaction timeout.** The default interactive-transaction
  timeout is 5s, which now has to absorb lock waits as well as the work:
  `prisma.$transaction(fn, { timeout: 10000 })`.

For `reassign-operator` the lock is what keeps the append-only
`bill_reassignments` chain intact (L6): it serialises the two admins, so the
second move's `fromOperatorId` is the first move's `toOperatorId`.

### Verify

```
E2E_SHOW_BUGS=1 npx playwright test e2e/specs/robustness/concurrency.spec.js
npx playwright test e2e/specs/billing/
```

`knownBug` lines to delete: BUG-008 (`create-bill` D21b, `record-payment` E10),
BUG-002 (`record-payment` E14, E15), BUG-005 (`settle` F12), BUG-011
(`concurrency` L2, L5, L6).

---

## Batch 2 — Session freshness and HTTP caching

### BUG-003 — stale session role and deactivation

Make `requireAuth` in `src/middleware/auth.js:2` async and re-read the user on
every request (a primary-key lookup, cheap):

```js
async function requireAuth(req, res, next) {
  if (!req.session || !req.session.user) {
    return res.status(401).json({ error: "Not logged in." });
  }
  try {
    const user = await prisma.user.findUnique({
      where: { id: req.session.user.id },
      select: { id: true, name: true, role: true, isDeleted: true },
    });
    if (!user || user.isDeleted) {
      return req.session.destroy(() =>
        res.status(401).json({ error: "Your session is no longer valid. Please log in again." })
      );
    }
    req.session.user = { id: user.id, name: user.name, role: user.role };
    next();
  } catch (err) {
    next(err);
  }
}
```

`requireRole` needs no change: it reads `req.session.user.role`, which
`requireAuth` has just refreshed. All four `requireRole` call sites in
`src/routes/users.js` (`:15`, `:32`, `:94`, `:117`) were checked and every one
has `requireAuth` immediately before it, so the refresh is universal.

Two things to handle:

- **Express 4 does not catch a rejected async middleware.** Hence the
  try/catch and `next(err)` above — without it, a transient DB error would
  hang the request rather than returning the backstop 500 from `server.js:95`.
- **`logout` now 401s for a just-deactivated user** (`routes/auth.js:50` uses
  `requireAuth`). Harmless — the session is destroyed either way — but if it
  bothers anyone, let logout skip the freshness check.

If the extra per-request query ever shows up in practice, the alternative in
the bug report (a per-user session-version counter bumped by
promote/demote/deactivate) is the drop-in replacement.

### BUG-007 — Back after logout

One middleware in `src/server.js`, inserted *above* the `/api/*` route mounts
at `:64`:

```js
app.use("/api", (req, res, next) => { res.set("Cache-Control", "no-store"); next(); });
```

**Deliberately skipping** the report's second suggestion (redirect to login
from `api()` on any 401). See "Divergences" below.

With the header in place, the Back navigation re-requests `/api/auth/me`,
gets a real 401, and `guardPage()` in `common.js:29` already redirects. No
frontend change needed.

If the page ever turns out to come back from Chrome's bfcache instead (in
which case no JS re-runs at all and no request is made), the follow-up is a
`pageshow` listener that re-runs `guardPage` on a persisted restore. The
reported network log shows a real request, so that isn't needed now.

### Verify

```
npx playwright test e2e/specs/auth/
```

`knownBug` lines to delete: BUG-003 (`session` C9a, C9b), BUG-007 (`login`
A8b).

---

## Batch 3 — Stored XSS (BUG-004)

Add to `public/js/common.js`:

```js
function escapeHtml(value) {
  return String(value ?? "").replace(/[&<>"']/g, (c) => ({
    "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;",
  })[c]);
}
```

Then wrap every interpolated free-text value across the 31 `innerHTML`
assignments: `admin.js` (17), `accountant.js` (7), `operator.js` (4),
`common.js` (2), `developer.js` (1). Amounts already go through
`formatCurrency` and are safe; the values that need wrapping are the name
fields (client, location, category, company, user) and anything else a user
can type.

One useful finding: every `renderLabel` / `renderSub` passed to
`attachCombobox` returns plain text (checked all 13 call sites across
operator.js, admin.js and accountant.js). So escaping inside `attachCombobox`
at `common.js:130-131` covers *every* combobox in the app in one place — no
per-caller work.

### Content-Security-Policy

Add as defence in depth, in `src/server.js`:

```js
"default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline' https://fonts.googleapis.com; font-src https://fonts.gstatic.com; img-src 'self' data:"
```

- `script-src 'self'` is safe to add as-is: there are no inline `<script>`
  blocks and no `on*=` handler attributes anywhere in `public/*.html`
  (verified). This is what neutralises an injected `onerror=`.
- `style-src` **needs `'unsafe-inline'`**: the pages carry 68 inline
  `style="..."` attributes (admin.html 37, operator.html 16, accountant.html
  11, developer.html 4), and CSP's `style-src` governs style attributes too.
  Note this in the commit message so a later "tightening" doesn't silently
  break every modal and collapsed panel.

### Verify

```
npx playwright test e2e/specs/robustness/security-inputs.spec.js
```

`knownBug` lines to delete: BUG-004 (K1a, K1b, K1c, K1d).

---

## Batch 4 — Combobox (BUG-009, BUG-014, BUG-018)

All three are one function: `attachCombobox()` in `public/js/common.js:105`.

1. **BUG-009** — store the blur timer and cancel it:
   `let hideTimer;` → `clearTimeout(hideTimer)` at the top of the `focus`
   (`:191`) and `input` (`:177`) handlers, and
   `hideTimer = setTimeout(...)` at `:197`. Belt and braces: check
   `document.activeElement !== input` inside the callback before hiding.
2. **BUG-018** — `dropdown.tabIndex = -1`, so Chrome stops treating the
   scrollable list as a Tab stop. Mouse scrolling is unaffected.
3. **BUG-009/018** — hide the list *immediately* in the `Tab` branch of the
   keydown handler (`:230`). The 150 ms delay exists only so a mouse click on
   a suggestion registers before the list disappears; a Tab press needs no
   grace period.
4. **BUG-014** — `dropdown.setAttribute("role", "listbox")` and
   `input.setAttribute("aria-controls", dropdown.id)` alongside the existing
   role/aria-expanded/aria-autocomplete block at `:173-175`. (`aria-expanded`
   and `aria-activedescendant` are already handled correctly.)

### Verify

BUG-009 has no expected-failure test — it is a timing race the harness was
working around. Once fixed, remove both workarounds and confirm:

- the retry inside `Combobox.pick()` in `e2e/pages/components.js`
- the `toPass` wrapper in admin-tabs H5

```
npx playwright test --repeat-each=5 e2e/specs/billing/create-bill.spec.js
npx playwright test e2e/specs/accessibility/
```

`knownBug` lines to delete: BUG-014 (`axe` M2/BUG-014), BUG-018 (`keyboard`
M3b).

---

## Batch 5 — Modals and the password-field collision

### BUG-001 — Change Password reads the Create User field

Do **both** halves. The rename fixes today's bug; the scoped lookup stops it
recurring on the next page that reuses a field name.

1. `public/developer.html:33` — `id="new-password"` → `id="create-user-password"`,
   and update `public/js/developer.js:84` and `:92`.
2. `setupChangePasswordModal()` in `common.js:298-302` — look fields up inside
   the modal: `modal.querySelector("#new-password")`, and likewise for
   `#current-password` and `#confirm-new-password`.

### BUG-015 — modal keyboard accessibility

Add a shared `setupModal(modal, { onClose })` helper to `common.js` returning
`{ open(opener), close() }`, which:

- sets `role="dialog"`, `aria-modal="true"` and `aria-labelledby` (pointing at
  the box's `<h2>`) on `.modal-box`
- focuses the first focusable control on open
- traps Tab within the dialog
- closes on Escape
- restores focus to the element that opened it

Wire it into `setupChangePasswordModal()` (`common.js:269`) and both copies of
`setupRefundModal()` (`operator.js`, `admin.js`). Markup touched:
`operator.html:169,182`, `admin.html:425,438`, `accountant.html:153`,
`developer.html:66`.

Native `<dialog>` + `showModal()` would be more correct by construction — see
"Divergences" for why this plan doesn't take it.

### Verify

```
npx playwright test e2e/specs/auth/change-password.spec.js e2e/specs/accessibility/keyboard.spec.js
```

`knownBug` lines to delete: BUG-001 (`change-password` B1, B2), BUG-015
(`keyboard` M3h × 2).

---

## Batch 6 — Form submission

### BUG-010 — double-submit

Re-entry guard at the top of each handler:

```js
const btn = e.submitter;           // the forms have no submit-button id
if (btn.disabled) return;
btn.disabled = true;
try { /* ... existing body ... */ } finally { btn.disabled = false; }
```

Six handlers: `bill-form`, `transaction-form` and `settle-submit-btn` in
`public/js/operator.js`, and their copies in `public/js/admin.js`.
(`settle-submit-btn` is a `type="button"` click handler, so use the element
directly rather than `e.submitter`.)

The idempotency-key option in the report is deferred. The button guard is what
the tests assert, and batch 1's row locks already close the server-side window
for a duplicated payment.

### BUG-013 — unlabelled settle checkboxes

- `loadSettleBillsList()` in `public/js/operator.js:141` and the `admin.js`
  copy: add
  `aria-label="Settle bill ${escapeHtml(b.billNumber)} — ${escapeHtml(b.client.name)}"`.
  **Needs batch 3 first.**
- `public/operator.html:131` and `public/admin.html:142`:
  `<th><span class="visually-hidden">Select</span></th>`.
- `.visually-hidden` does not exist in `style.css` yet — add the usual
  clip-rect rule.

### Verify

```
npx playwright test e2e/specs/robustness/security-inputs.spec.js e2e/specs/accessibility/axe.spec.js
```

`knownBug` lines to delete: BUG-010 (K4a, K4b), BUG-013 (`axe` M2/BUG-013).

---

## Batch 7 — CSS and markup polish

### BUG-012 — badge contrast

`public/css/style.css`:

```css
.badge { white-space: nowrap; }                      /* also fixes the two-line wrap */
.badge.fully_paid { color: #256b42; }                /* was var(--success), 4.37:1 */
.badge.role-admin { color: #8a5a12; }                /* was var(--accent),  2.56:1 */
```

Re-check the ratios with the axe test rather than by eye — both are close
enough to the 4.5:1 line to be worth confirming.

### BUG-016 — focus ring

Don't delete `outline: none` from `style.css:147`; scope it, so mouse focus
keeps the soft shadow and keyboard focus gets the intended ring:

```css
input:focus:not(:focus-visible),
select:focus:not(:focus-visible) {
  outline: none;
  border-color: var(--primary);
  box-shadow: 0 0 0 3px rgba(31, 110, 92, 0.12);
}
```

The `:focus-visible` block at `:69-73` then applies as originally intended.

### BUG-017 — login landmark

`public/login.html` — `<div class="login-wrapper">` → `<main class="login-wrapper">`.
No style change needed.

### Verify

```
npm run test:e2e:update-snapshots      # once, for batches 3-7 together
npm run test:e2e                       # must be fully green before closing anything
```

`knownBug` lines to delete: BUG-012 (`axe` M2/BUG-012), BUG-016 (`keyboard`
M3g), BUG-017 (`axe` M2/BUG-017).

---

## Divergences found while implementing

**Batch 1, BUG-008 — two test expectations had to change.** `record-payment`
E4 and E5b pinned the exact overpayment message with bare integers
("…(150) exceeds the remaining balance (100)."). Formatting those amounts
with `fromPaise`, which this plan requires so `0.30000000000000004` can never
reach an operator, necessarily makes them "(150.00)" and "(100.00)" — which
also matches `formatCurrency`'s two-decimal output everywhere else in the UI.
Both assertions were updated. No other passing test's expectations were
touched.

**Batch 1 — two extra float sites fixed while in the same functions.** The
plan lists `bills.js:143/:153`, `transactions.js` and the `companies.js`
settle loop. `bills.js`'s refund (`collected = netAmount - balance`) and
`companies.js`'s `GET /:id/outstanding` total are the same class of defect and
sit inside functions batch 1 already rewrites, so both now go through paise
too. `GET /:id/outstanding` still returns `totalOutstanding` as a JSON number,
so the API shape is unchanged.

**Batch 3 — the PDF export builders are deliberately left unescaped.** The
per-client payments string appears three times each in `admin.js` and
`accountant.js`: once into `innerHTML` (escaped) and twice into
`downloadPdfReport`, which hands plain text to jsPDF. Escaping those would
print `&amp;` in the exported report.

## Divergences from the bug reports

Three places where this plan deliberately does something other than what the
report's "Suggested fix" says. Each is a judgement call worth re-examining
before implementing.

**BUG-007 — only half the suggested fix.** The report also suggests
redirecting to login from `api()` on any 401. Don't: `public/js/login.js`
depends on 401s from both `/auth/login` (to show "Invalid name or password")
and `/auth/me` (its already-logged-in check). A blanket redirect would swallow
the login error message and reload the page in a loop. The `no-store` header
alone makes the test pass.

**BUG-015 — shared helper, not native `<dialog>`.** The report suggests
`<dialog>` + `showModal()`, which is genuinely more correct: it provides the
focus move, the trap, Escape and top-layer stacking for free, with no
hand-written trap to get subtly wrong. The cost is reworking
`.modal-overlay` / `.modal-box` (`style.css:315-340`) onto `::backdrop`,
changing the `style.display` toggling in three JS files, and re-baselining
every modal screenshot. The helper is roughly 40 lines, needs no CSS change,
and keeps backdrop-click-to-close working as it does today. `<dialog>` remains
the better long-term shape if the modals ever get touched again.

**BUG-011 settlement — sequential sorted locks, not one `IN (...)`.** The
report suggests locking "every selected id in a stable order". A single
`WHERE id IN (...) ORDER BY id FOR UPDATE` does not reliably give that:
Postgres may apply the sort after fetching and locking. Locking each id in
turn, in sorted order, is what actually guarantees a consistent order across
concurrent settlements and so prevents deadlock.

## Not in this plan

**BUG-006 (no UI to edit or delete payments)** stays in `Open/` with its
`knownBug` marker. It is a product decision, not a defect to fix: who may edit
or delete a payment, whether edits are blocked after a day closes, and whether
there should be an audit view of edits. Its prerequisite, BUG-002, is fixed in
batch 1, so the backend will be safe whenever the UI question is settled.

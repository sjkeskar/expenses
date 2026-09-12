# Payment Tracking System

Implementation of the confirmed spec: Node.js/Express backend, Prisma ORM,
PostgreSQL, server-side sessions, plain HTML/CSS/JS frontend (one page per
role).

## Locked-in decisions this build follows

- Backend: Node.js + Express
- ORM: Prisma
- Frontend: plain HTML/CSS/vanilla JS, separate page per role (no build step)
- Auth: express-session, in-memory store, 4-hour session, cookie is `secure: false` (plain HTTP on LAN)
- Login identifier: `name` (must be unique) — no separate username field
- Password hashing: argon2
- Password policy: min 6 characters, at least 1 number, at least 1 special character
- Primary keys: UUID on every table
- Bill numbers: `{locationCode}{YY}{MM}{seq}` — 2-digit admin-assigned location code + 2-digit year + 2-digit month + 4-digit sequence (0000-9999), no separator (e.g. `0426090042`). Resets to `0000` at the start of each calendar month, scoped per location code — NOT per individual location, since multiple locations can share the same code by design. Every location must have a code; there is no nullable fallback for this field (unlike locationId/categoryId on Bill, which stayed nullable for backward compatibility)
- **Timezone: the system operates exclusively in India Standard Time (Asia/Kolkata, fixed UTC+5:30, no DST) — never the server's or browser's local timezone.** All timestamp columns (`createdAt`, `updatedAt`, `deletedAt`) are `timestamptz` in Postgres (see `prisma/schema.prisma`), so Postgres always stores the true UTC instant internally regardless of what timezone wrote it — there's no ambiguity to manage at the storage layer. IST enters the picture only at read/display time, via the standard `AT TIME ZONE 'Asia/Kolkata'` SQL conversion (analytics day-bucketing in `src/routes/analytics.js`) or explicit `Intl.DateTimeFormat({ timeZone: 'Asia/Kolkata' })` calls (bill number dates in `src/utils/istDate.js`, frontend display in `public/js/common.js`). If this system is ever deployed for a business outside India, those are the places to change — they must all agree with each other.
- The Node process is still pinned to `TZ=UTC` (first line of `src/server.js`) as a defensive best practice, but this is no longer load-bearing for correctness now that columns are `timestamptz` — it's just a guard against some other future date-handling code accidentally depending on the server PC's own OS timezone.
- First developer account: created manually via SQL script (not an auto-seed)
- Roles: operator, admin, developer, and accountant (read-only — same analytics as admin plus PDF export, no billing/promotion/lookup-list management)
- Categories are chosen PER BILL, not stored on the client — the same client can have bills under different categories over time. Companies are never managed on their own screen — a company is created automatically (find-or-create by name) as a side effect of adding a "credit" category, and a bill's company is copied from its category, not chosen independently on the bill form
- Bulk settlement for a company is hand-picked, not FIFO — the person settling sees that company's actual outstanding bills (with client names) and checks off exactly which ones to close in full; anything disputed is simply left unchecked
- Record Payment supports an optional additional discount on top of whatever discount the bill already had at creation. This is tracked per-transaction (`Transaction.discountAmount`) for audit purposes, and folds into `Bill.discountAmount`/`netAmount`/`balance` so existing analytics (which read those bill-level totals) pick it up with no separate reporting logic. Editing or deleting a transaction correctly reverses/reapplies both its amount AND its discount, not just the amount
- Credit-category bills require a Company; the company's running balance across all its bills is settled via one lump-sum "Settle Company Balance" action, applied oldest-bill-first (FIFO)
- Port: 8080

## One-time setup on the server PC

1. **Install prerequisites** (on the Windows server PC): Node.js (LTS) and PostgreSQL.

2. **Create the database and a DB user**, e.g. in psql:
   ```sql
   CREATE DATABASE payment_tracking;
   CREATE USER ptsuser WITH PASSWORD 'changeme';
   GRANT ALL PRIVILEGES ON DATABASE payment_tracking TO ptsuser;
   ALTER USER ptsuser CREATEDB;
   ```
   Then connect to the new database and grant schema-level access (Postgres
   15+ doesn't give non-owner roles `CREATE` on `public` by default):
   ```sql
   \c payment_tracking
   GRANT ALL ON SCHEMA public TO ptsuser;
   ```
   Without these two grants you'll hit a `P3014` error and a
   `permission denied for schema public` error respectively during migration.

3. **Install project dependencies**:
   ```
   npm install
   ```
   This sandbox could not reach `binaries.prisma.sh` to download Prisma's
   query engine, so `prisma generate`/`migrate` were not run here — run them
   on the actual server PC, which will have normal internet access.

4. **Configure environment**: copy `.env.example` to `.env` and fill in:
   - `DATABASE_URL` — your real Postgres connection string
   - `SESSION_SECRET` — a long random string (a command to generate one is in the file)
   - `PORT` — leave as 8080 unless you want to change it
   - `SESSION_MAX_AGE_MS` — leave as 14400000 (4 hours) unless you want to change it

5. **Run the migration** (creates all tables from `prisma/schema.prisma`):
   ```
   npx prisma migrate dev --name init
   ```

6. **Create the first developer account** (only a developer can create other
   users, so this one has to be inserted directly):
   ```
   node scripts/generate-password-hash.js "YourChosenPassword1!"
   ```
   Copy the printed hash into `scripts/create-first-developer.sql`
   (replace `PASTE_ARGON2_HASH_HERE`), set the login name you want, then run:
   ```
   psql -U ptsuser -d payment_tracking -f scripts/create-first-developer.sql
   ```

7. **Start the server**:
   ```
   npm start
   ```
   You should see: `Payment Tracking System listening on http://0.0.0.0:8080`

8. **Log in** at `http://localhost:8080/login.html` on the server PC with the
   developer account you just created, then use the Developer page to create
   your real operator and admin accounts.

## Running from other PCs on the LAN

- Give the server PC a static local IP (DHCP reservation on your router).
- Allow inbound TCP on port 8080 through Windows Firewall on the server PC.
- From any client PC, browse to `http://<server-LAN-IP>:8080/login.html`.

## Keeping it running after logout / reboot

Wrap `npm start` (or `node src/server.js`) as a Windows Service using NSSM
or Task Scheduler, per Section 4 of the spec, so the app survives logout and
restarts on reboot.

## Resetting test data

To wipe all business data (clients, bills, transactions, categories,
companies, locations) and start a fresh testing session — while keeping
every user account intact — run:
```
psql -U ptsuser -d payment_tracking -f scripts/reset-test-data.sql
```
This is destructive and has no undo except restoring a backup. Only run
it against test/staging data, never production.

## Backups

Per the spec: schedule a nightly `pg_dump` via Windows Task Scheduler and
sync the dump folder to a cloud drive (OneDrive/Google Drive). This isn't
automated by this codebase — set it up as an OS-level scheduled task
pointing at your Postgres install.

## PDF export (Analytics tab)

Every table on the Analytics tab has a "Download PDF" button. This runs
entirely in the browser — no server round-trip, no internet dependency —
using [jsPDF](https://github.com/parallax/jsPDF) and its `autotable`
plugin. Both are **self-hosted** under `public/vendor/` (not loaded from
a CDN) specifically so this keeps working even if a client PC's internet
connection is unreliable — this app only ever needs the LAN connection to
the server. Both libraries are MIT-licensed; their minified browser
builds were copied from the published npm packages and aren't part of
this project's own server-side dependencies (`package.json` is
untouched).

## Project structure

```
prisma/schema.prisma        Database schema (source of truth)
src/server.js                Express app entrypoint
src/config/                  Prisma client + session middleware
src/middleware/auth.js       requireAuth / requireRole guards
src/routes/                  auth, users, clients, bills, transactions, analytics
src/utils/                   bill number generator, password policy
public/                      login.html, operator.html, admin.html, developer.html, accountant.html + shared css/js
scripts/                     one-time helpers for creating the first developer account
```

## What was verified in this environment

- All JavaScript files pass `node --check` (syntax-valid).
- `npm install` completed successfully.
- Prisma schema was authored carefully against the confirmed decisions, but
  `npx prisma validate` could not run here because this sandbox's network
  allowlist blocks `binaries.prisma.sh` (where Prisma downloads its query
  engine). Run `npx prisma validate` yourself right after `npm install` on
  the server PC as a first check — if anything's off in the schema, it'll
  fail fast and loudly there, before you run the migration.

# Setup Guide — Phases 0 through 8

Run these on the **server PC** (the one Windows PC that will host the app),
in order. Each phase has an "exit criteria" line — don't move to the next
phase until that's true.

---

## Phase 0 — Prerequisites

1. Install **Node.js LTS** for Windows: https://nodejs.org (download the LTS installer, run it, accept defaults).
2. Install **PostgreSQL** for Windows: https://www.postgresql.org/download/windows/ (the installer bundles pgAdmin and the `psql` CLI). During install, set and remember the `postgres` superuser password.
3. Copy the `payment-tracking-system` folder onto the server PC, e.g. to `C:\PTS\payment-tracking-system`.
4. Open a terminal (PowerShell) and confirm:
   ```
   node -v
   psql --version
   ```

**Exit criteria:** both commands print a version number with no errors.

---

## Phase 1 — Database Setup

1. Open a terminal and connect as the postgres superuser:
   ```
   psql -U postgres
   ```
2. Run these SQL commands (replace `changeme` with a real password):
   ```sql
   CREATE DATABASE payment_tracking;
   CREATE USER ptsuser WITH PASSWORD 'changeme';
   GRANT ALL PRIVILEGES ON DATABASE payment_tracking TO ptsuser;
   ALTER USER ptsuser CREATEDB;
   \c payment_tracking
   GRANT ALL ON SCHEMA public TO ptsuser;
   CREATE EXTENSION IF NOT EXISTS pgcrypto;
   \q
   ```
   Two things matter here beyond the basic grants:
   - `ALTER USER ... CREATEDB` — Prisma's `migrate dev` creates a temporary
     shadow database to detect schema drift, which needs this privilege.
     Skipping it causes a `P3014` error.
   - `GRANT ALL ON SCHEMA public TO ptsuser` — on Postgres 15+, only the
     database *owner* (here, `postgres`, since it ran `CREATE DATABASE`)
     automatically gets `CREATE` rights inside the `public` schema. Without
     this grant, `ptsuser` can connect and see the database but can't
     create tables in it, causing a `permission denied for schema public`
     error during migration.

**Exit criteria:** `psql -U ptsuser -d payment_tracking` connects successfully (it'll prompt for the password you set).

---

## Phase 2 — Application Configuration

1. Open a terminal in the project folder:
   ```
   cd C:\PTS\payment-tracking-system
   npm install
   ```
2. Copy the env template:
   ```
   copy .env.example .env
   ```
3. Open `.env` in Notepad and set:
   - `DATABASE_URL="postgresql://ptsuser:changeme@localhost:5432/payment_tracking"` (use your real password from Phase 1)
   - `SESSION_SECRET` — generate one with:
     ```
     node -e "console.log(require('crypto').randomBytes(48).toString('hex'))"
     ```
     and paste the output in as the value.
   - Leave `PORT=8080` and `SESSION_MAX_AGE_MS=14400000` as-is.
4. Validate the schema:
   ```
   npx prisma validate
   ```
5. Run the migration (creates all tables):
   ```
   npx prisma migrate dev --name init
   ```

**Exit criteria:** migration reports success. Confirm tables exist:
```
psql -U ptsuser -d payment_tracking -c "\dt"
```
You should see `users`, `clients`, `bills`, `bill_counters`, `transactions`.

---

## Phase 3 — First Developer Account

1. Generate a password hash for your chosen developer password (must meet policy: 6+ chars, 1 number, 1 special character):
   ```
   node scripts/generate-password-hash.js "YourChosenPassword1!"
   ```
2. Copy the printed hash.
3. Open `scripts/create-first-developer.sql` in Notepad:
   - Replace `'admin_dev'` with the login name you want.
   - Replace `'PASTE_ARGON2_HASH_HERE'` with the hash you copied.
4. Run it:
   ```
   psql -U ptsuser -d payment_tracking -f scripts/create-first-developer.sql
   ```

**Exit criteria:**
```
psql -U ptsuser -d payment_tracking -c "SELECT name, role FROM users;"
```
shows your one developer row.

---

## Phase 4 — First Run & Smoke Test

1. Start the app:
   ```
   npm start
   ```
   You should see: `Payment Tracking System listening on http://0.0.0.0:8080`
2. On the server PC, open a browser to `http://localhost:8080/login.html`.
3. Log in with the developer account from Phase 3.
4. On the Developer page, create one test operator and one test admin.
5. Log out, log back in as the test operator: add a client, create a bill, record a partial payment, confirm the balance drops correctly, then pay the remainder and confirm it flips to "Fully Paid."
6. Log in as the test admin: check the Analytics tab shows that transaction, and confirm the Promote tab lists the test operator.
7. Leave the terminal running `npm start` open for now — stop it with `Ctrl+C` once you're ready to move to Phase 6 (running it as a service).

**Exit criteria:** the full bill → payment → analytics cycle works with no errors, before touching the network.

---

## Phase 5 — LAN & Network Setup

1. **Static IP:** log into your router's admin page and set a DHCP reservation for the server PC's MAC address (steps vary by router — look for "DHCP reservation" or "static lease").
2. **Firewall rule** — run this in an elevated (Administrator) PowerShell:
   ```powershell
   New-NetFirewallRule -DisplayName "Payment Tracking System" -Direction Inbound -Protocol TCP -LocalPort 8080 -Action Allow
   ```
3. Find the server's LAN IP:
   ```
   ipconfig
   ```
   (look for "IPv4 Address" under your active network adapter)
4. With `npm start` still running, from a **different PC** on the same LAN, open `http://<server-LAN-IP>:8080/login.html` and repeat a quick version of the Phase 4 smoke test.

**Exit criteria:** a client PC can log in and use the app over the LAN.

---

## Phase 6 — Run as a Windows Service (NSSM)

1. Download NSSM: https://nssm.cc/download — extract it, e.g. to `C:\nssm`.
2. In an elevated PowerShell:
   ```
   C:\nssm\win64\nssm.exe install PaymentTrackingSystem "C:\Program Files\nodejs\node.exe" "C:\PTS\payment-tracking-system\src\server.js"
   C:\nssm\win64\nssm.exe set PaymentTrackingSystem AppDirectory "C:\PTS\payment-tracking-system"
   C:\nssm\win64\nssm.exe set PaymentTrackingSystem Start SERVICE_AUTO_START
   ```
3. Stop the manually-running `npm start` (Ctrl+C in that terminal) so the port is free.
4. Start the service:
   ```
   C:\nssm\win64\nssm.exe start PaymentTrackingSystem
   ```
5. Reboot the server PC and confirm the app is reachable again with no manual steps — check `http://localhost:8080/login.html` after reboot.

**Exit criteria:** app survives a full reboot with zero manual intervention.

---

## Phase 7 — Backup Automation

A ready-to-use script is at `scripts/backup.bat`.

1. Open `scripts/backup.bat` in Notepad and edit the 4 values at the top:
   - `PGPASSWORD` — your `ptsuser` password
   - `PG_BIN` — path to `pg_dump.exe` (adjust the PostgreSQL version number in the path if needed)
   - `BACKUP_DIR` — a folder that your cloud drive (OneDrive/Google Drive) is already syncing
2. Test it manually first:
   ```
   scripts\backup.bat
   ```
   Confirm a `.dump` file appears in `BACKUP_DIR`.
3. Schedule it nightly at 2 AM (elevated PowerShell or Command Prompt):
   ```
   schtasks /create /tn "PTS Nightly Backup" /tr "C:\PTS\payment-tracking-system\scripts\backup.bat" /sc daily /st 02:00
   ```
4. **Test a restore** into a throwaway database before relying on this — don't skip this step:
   ```
   psql -U postgres -c "CREATE DATABASE pts_restore_test;"
   pg_restore -U postgres -d pts_restore_test "C:\PTS_Backups\payment_tracking_<timestamp>.dump"
   psql -U postgres -d pts_restore_test -c "SELECT count(*) FROM users;"
   psql -U postgres -c "DROP DATABASE pts_restore_test;"
   ```

**Exit criteria:** at least one automated backup exists, and you've proven a restore from it actually works.

---

## Phase 8 — Real Account Creation

1. Log in as developer.
2. On the Developer page, create real accounts for all 6 operators and any admins — use their real names as the login name, and passwords meeting the policy (6+ chars, 1 number, 1 special character).
3. Share each person's login name and initial password with them directly, not over an insecure channel (e.g. hand it to them in person or a private message, not a group chat).
4. Have each person log in once to confirm their account works.

**Exit criteria:** every real user has logged in successfully at least once.

---

## If Something Breaks

- **`migrate dev` fails with `permission denied for schema public`:** on Postgres 15+, only the database owner gets `CREATE` rights on the `public` schema by default. Fix:
  ```
  psql -U postgres -d payment_tracking -c "GRANT ALL ON SCHEMA public TO ptsuser;"
  ```
  Then re-run `npx prisma migrate dev --name init`.
- **`migrate dev` fails with `P3014: permission denied to create database`:** the `ptsuser` role is missing `CREATEDB` (needed for Prisma's temporary shadow database, separate from your real DB). Fix:
  ```
  psql -U postgres -c "ALTER USER ptsuser CREATEDB;"
  ```
  Then re-run `npx prisma migrate dev --name init`.
- **`npx prisma validate` or `migrate` fails with a network/checksum error:** this means the server PC's internet connection can't reach `binaries.prisma.sh`. Check firewall/proxy settings; Prisma needs outbound internet access once, to download its query engine.
- **App won't start / port already in use:** something else is using port 8080, or a previous `npm start` / NSSM service is already running. Check with `netstat -ano | findstr :8080`.
- **Can't connect from a client PC but localhost works:** almost always the firewall rule from Phase 5 — double check it was created and the port matches your `.env` `PORT` value.
- **Session/login issues after a server restart:** expected — sessions are stored in memory (confirmed decision), so a server restart logs everyone out. Not a bug.

Once Phases 0–8 are done and stable, the next step is Phase 9 (migrating your Excel/CSV data) — that's a separate task once you share the file structure.

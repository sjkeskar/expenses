# Setup Guide

Run these steps on the **server PC**, the one Windows PC that hosts the app,
in order. Each phase ends with a check. Don't move on until it passes.

Commands are for PowerShell unless they say otherwise. Paths assume the
project lives in `C:\LMS\lab-management-system`; use your own.

---

## Phase 0: Prerequisites

1. Install **Node.js 24 LTS** for Windows from https://nodejs.org, accepting
   the defaults.
2. Install **PostgreSQL 18** for Windows from
   https://www.postgresql.org/download/windows/. The installer includes
   pgAdmin and the `psql` command line. Set the `postgres` superuser
   password during the install, and keep it.
3. Install **Git** (https://git-scm.com) and clone the project, e.g. into
   `C:\LMS\lab-management-system`. Deploys pull updates with Git.
4. Install **Google Chrome** on every PC that will print. Printing is set up
   for Chrome (Phase 7).

**Check:**

```
node -v
psql --version
git --version
```

Each prints a version number.

---

## Phase 1: Database

1. Connect as the superuser:
   ```
   psql -U postgres
   ```
2. Create the application's user and a database it owns (replace
   `changeme` with a real password):
   ```sql
   CREATE USER ptsuser WITH PASSWORD 'changeme';
   CREATE DATABASE lab_management OWNER ptsuser;
   \c lab_management
   GRANT ALL ON SCHEMA public TO ptsuser;
   CREATE EXTENSION IF NOT EXISTS pgcrypto;
   \q
   ```
   Why each line matters:
   - `OWNER ptsuser` lets the app's own user create and change the tables.
   - `GRANT ALL ON SCHEMA public` is needed on PostgreSQL 15 and later,
     where only the schema's owner may create tables in `public`. Without
     it, migrations fail with `permission denied for schema public`.
   - `pgcrypto` provides `gen_random_uuid()`, used by
     `scripts/create-first-developer.sql`.

**Check:** `psql -U ptsuser -d lab_management` connects with the password
you set.

---

## Phase 2: Install, configure, build

1. In the project folder:
   ```
   cd C:\LMS\lab-management-system
   npm ci --include=dev
   ```
   If npm lists install scripts that need approval, approve the ones the app
   needs, then run `npm ci --include=dev` again:
   ```
   npm install-scripts approve argon2 prisma @prisma/client @prisma/engines
   ```
2. Create the configuration file:
   ```
   copy .env.example .env
   ```
3. Edit `.env` in Notepad:
   - `DATABASE_URL="postgresql://ptsuser:changeme@localhost:5432/lab_management"`,
     using your password from Phase 1.
   - `SESSION_SECRET`: a long random string. Generate one with:
     ```
     node -e "console.log(require('crypto').randomBytes(48).toString('hex'))"
     ```
   - Leave `PORT=8080` and `SESSION_MAX_AGE_MS=14400000` (4 hours) as they are.

   `.env` holds secrets and is read only by the server. Never put a secret in
   a `VITE_` variable: those are built into the browser app, where anyone can
   read them.
4. Create the tables and build the browser app:
   ```
   npx prisma generate
   npx prisma migrate deploy
   npm run build
   ```

**Check:** `migrate deploy` reports the migrations applied, `npm run build`
ends without errors, and this lists about 30 tables (`users`, `patients`,
`bills`, `quotations`, `catalog_items`, …):

```
psql -U ptsuser -d lab_management -c "\dt"
```

---

## Phase 3: The first developer account

Only the developer account is created by hand. The app creates everyone
else's.

1. Generate a password hash. The password needs at least 6 characters, a
   number and a special character:
   ```
   node scripts/generate-password-hash.js "YourChosenPassword1!"
   ```
2. Open `scripts/create-first-developer.sql` in Notepad. Set the login name
   (`'admin_dev'`) and paste the hash in place of the one there.
3. Run it:
   ```
   psql -U ptsuser -d lab_management -f scripts/create-first-developer.sql
   ```

**Check:**

```
psql -U ptsuser -d lab_management -c "SELECT name, role FROM users;"
```

This shows your one developer.

---

## Phase 4: First run and lab setup

1. Start the app:
   ```
   npm start
   ```
   It prints `Laboratory Management System listening on http://0.0.0.0:8080`.
2. On the server PC, open http://localhost:8080 in Chrome and sign in as the
   developer.
3. Open **Lab setup** and fill it in once: the lab's name, phone, email and
   address (they head every print), and the **lead pathologist's** login name
   and password. Only the lead can create accounts from here on.
4. Sign out and sign in as the lead. Set the lab up in this order:
   1. **Branches & centres:** each with its unique 2-digit code (it starts
      every bill number raised there), address and phone (printed on bills
      and quotations), and the minimum home-visit charge for those that
      offer home visits. A collection centre names the branch that processes
      its samples.
   2. **Machines:** the machine types tests need (e.g. "Haematology
      analyser"), and the machines at each branch.
   3. **Tests & profiles → Add items:** the catalog. Paste rows straight
      from Excel; the dialog shows the column order. Tests come before the
      profiles that include them.
   4. **Panels & camps:** corporate, TPA and insurer panels, with any
      standing rates; camps with their dates and rates.
   5. **Referring doctors**, and **Users**: an account for every
      pathologist, technician and accountant.
5. Run a smoke test as a technician: register a patient, create a bill with
   a payment, print it, and check the **Day sheet** shows the money. Then
   sign in as a pathologist and approve something in the **Approval queue**.

Leave the `npm start` window open until Phase 6.

**Check:** a bill goes from creation to payment to the day sheet without
errors.

---

## Phase 5: The LAN

1. **Fixed address:** in the router's admin page, set a DHCP reservation for
   the server PC (look for "DHCP reservation" or "static lease").
2. **Firewall:** in an Administrator PowerShell:
   ```powershell
   New-NetFirewallRule -DisplayName "Laboratory Management System" -Direction Inbound -Protocol TCP -LocalPort 8080 -Action Allow
   ```
3. Find the server's address with `ipconfig` ("IPv4 Address").
4. From another PC, open `http://<server address>:8080` and sign in.

**Check:** a reception PC can sign in and open a bill.

---

## Phase 6: Run as a Windows service (NSSM)

1. Download NSSM from https://nssm.cc/download and extract it, e.g. to
   `C:\nssm`.
2. In an Administrator PowerShell:
   ```
   C:\nssm\win64\nssm.exe install LabManagementSystem "C:\Program Files\nodejs\node.exe" "C:\LMS\lab-management-system\src\server.js"
   C:\nssm\win64\nssm.exe set LabManagementSystem AppDirectory "C:\LMS\lab-management-system"
   C:\nssm\win64\nssm.exe set LabManagementSystem Start SERVICE_AUTO_START
   ```
   `scripts\deploy.ps1` restarts the service by this name
   (`LabManagementSystem`). If you choose another name, change it at the top
   of the script too.
3. Stop the `npm start` from Phase 4 (Ctrl+C), then start the service:
   ```
   C:\nssm\win64\nssm.exe start LabManagementSystem
   ```
4. Reboot the server PC and open http://localhost:8080 again.

**Check:** the app is back after a reboot with no manual steps.

Sessions are kept in memory, so restarting the service (or the PC) signs
everyone out. That's expected.

---

## Phase 7: Printers and barcode scanners

Printing goes through Chrome's print dialog. Each print opens its own view
and the print dialog opens by itself.

### HP printers (A4): bills, day sheets, revisit lists

In the print dialog: paper **A4**, margins **Default**, scale **100%**, and
**Headers and footers** unticked. Chrome remembers these per printer.

### Zebra GT820 (thermal): quotations

The quotation is a receipt-style page **104 mm wide and as long as the
quotation**. The page sets its own length each time, so the driver must
accept any length:

1. Install Zebra's **ZDesigner** Windows driver for the GT820, and share the
   printer on the LAN if the reception PCs print through the server.
2. On each PC that prints quotations, open the printer's **Printing
   Preferences**:
   - **Paper size:** a width of **104 mm**. The height is set by each
     quotation.
   - **Media type:** continuous (not labels with gaps), thermal transfer
     with the ribbon.
3. In Chrome's print dialog for a quotation: the GT820 as the printer,
   margins **None**, scale **100%**, and headers and footers unticked.

A wrong paper width makes Chrome shrink or stretch the page. If the
quotation prints narrow, wide or cut off, check the width in Printing
Preferences first.

**Test before go-live:** print a quotation on the real GT820, then scan its
barcode on the **Verify document** screen. The quotation should come up.
If the driver won't accept a page of any length, tell the developer. The
fallback is a fixed page length, with the totals, validity and barcode kept
together on the last page.

Staff pick the printer in the dialog: the GT820 for quotations, an HP for
everything else. Chrome remembers the last printer used, and the two layouts
look nothing alike, so a document sent to the wrong printer shows at once.

### Barcode scanners

Any USB scanner that types what it reads (keyboard mode) and then presses
**Enter** works. On the **Verify document** screen the cursor starts in the
code box, so scanning a printed barcode looks the document up at once. The
code is also printed under the barcode, so it can be typed if a scan fails.

**Check:** a bill printed on an HP and a quotation printed on the GT820 both
verify when scanned.

---

## Phase 8: Backups

`scripts/backup.bat` takes a nightly `pg_dump` of `lab_management`.

1. Edit the values at the top of `scripts/backup.bat`: the `ptsuser`
   password, the path to `pg_dump.exe` (it includes the PostgreSQL version),
   and a backup folder that OneDrive or Google Drive syncs.
2. Run it once by hand and check a `.dump` file appears:
   ```
   scripts\backup.bat
   ```
3. Schedule it for 2 AM every night:
   ```
   schtasks /create /tn "LMS Nightly Backup" /tr "C:\LMS\lab-management-system\scripts\backup.bat" /sc daily /st 02:00
   ```
4. **Test a restore** into a throwaway database before relying on it:
   ```
   psql -U postgres -c "CREATE DATABASE lms_restore_test;"
   pg_restore -U postgres -d lms_restore_test "<backup folder>\lab_management_<timestamp>.dump"
   psql -U postgres -d lms_restore_test -c "SELECT count(*) FROM bills;"
   psql -U postgres -c "DROP DATABASE lms_restore_test;"
   ```

**Check:** an automatic backup exists, and a restore from it works.

---

## Updating to a new version

In an Administrator PowerShell, from the project folder:

```
powershell -ExecutionPolicy Bypass -File scripts\deploy.ps1
```

It pulls the latest code, installs dependencies, applies database migrations,
rebuilds the browser app and restarts the service. Everyone is signed out
by the restart, so deploy outside reception hours.

---

## Resetting data

Both of these destroy data and can't be undone except from a backup. Never
run them on a live lab's database.

- **Clear patients and billing, keep the setup:**
  ```
  psql -U ptsuser -d lab_management -f scripts/reset-test-data.sql
  ```
  This removes patients, quotations, bills, payments, approvals and the
  number counters. Users, lab settings, branches, the catalog, machines,
  panels, camps and doctors stay.
- **Start completely fresh** (e.g. before go-live, after testing on the same
  PC): `.\scripts\consolidate-migrations.ps1`. It drops every table
  (accounts included), folds the migration history into a single migration
  and creates a new developer account. Afterwards, redo Phase 4 from step 2.

---

## If something goes wrong

- **`permission denied for schema public` during migration:** the grant
  from Phase 1 is missing. As the superuser:
  ```
  psql -U postgres -d lab_management -c "GRANT ALL ON SCHEMA public TO ptsuser;"
  ```
  Then run `npx prisma migrate deploy` again.
- **`No migration found in prisma/migrations`:** the `prisma\migrations`
  folder is missing or was deleted. Restore it from Git
  (`git checkout -- prisma/migrations`); never delete it on a server.
- **The page says the app isn't built, or shows a blank page:** run
  `npm run build` (or the deploy script) and restart the service. The server
  warns at start-up when `client\dist` is missing.
- **Port 8080 already in use:** another copy is running, e.g. a manual
  `npm start` beside the service. `netstat -ano | findstr :8080` shows which
  process.
- **Other PCs can't connect but the server PC can:** check the firewall rule
  from Phase 5, and that its port matches `PORT` in `.env`.
- **Everyone was signed out:** the service restarted (a deploy, a reboot, or
  a crash logged in the service's output). Sessions live in memory, so this
  is expected after a restart.
- **A quotation prints at the wrong size:** see Phase 7: the ZDesigner paper
  width must be 104 mm, and Chrome's scale 100%.

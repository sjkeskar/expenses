# Full reset + migration consolidation, for GO-LIVE DAY only.
#
# DESTRUCTIVE — wipes the ENTIRE database, including every user account,
# and deletes the accumulated migration history. Only run this once,
# right before real (non-test) data entry begins — not something to run
# routinely.
#
# What it does, in order:
#   1. Drops and recreates the database schema (wipes everything)
#   2. Deletes the old prisma/migrations folder
#   3. Generates and applies ONE consolidated migration from schema.prisma
#   4. Creates your first developer account, so you're not locked out
#
# Run from the project root in PowerShell:
#   .\scripts\consolidate-migrations.ps1

$ErrorActionPreference = "Stop"

Write-Host ""
Write-Host "==================================================================" -ForegroundColor Yellow
Write-Host "  WARNING: This wipes your ENTIRE database, including all users." -ForegroundColor Yellow
Write-Host "  Only run this once, right before go-live." -ForegroundColor Yellow
Write-Host "==================================================================" -ForegroundColor Yellow
Write-Host ""
$confirm = Read-Host "Type YES (all caps) to continue, anything else to abort"
if ($confirm -ne "YES") {
    Write-Host "Aborted. Nothing was changed."
    exit 0
}

$dbName = Read-Host "Database name [payment_tracking]"
if ([string]::IsNullOrWhiteSpace($dbName)) { $dbName = "payment_tracking" }

$dbUser = Read-Host "Application DB user [ptsuser]"
if ([string]::IsNullOrWhiteSpace($dbUser)) { $dbUser = "ptsuser" }

Write-Host ""
Write-Host "Step 1/4: Dropping and recreating the schema (connects as postgres superuser — you'll be prompted for its password)..."
psql -U postgres -d $dbName -c "DROP SCHEMA public CASCADE; CREATE SCHEMA public; GRANT ALL ON SCHEMA public TO $dbUser; CREATE EXTENSION IF NOT EXISTS pgcrypto;"
if ($LASTEXITCODE -ne 0) { throw "Schema reset failed - check the error above." }

Write-Host ""
Write-Host "Step 2/4: Deleting old migration history..."
if (Test-Path "prisma\migrations") {
    Remove-Item -Recurse -Force "prisma\migrations"
    Write-Host "  Removed prisma\migrations"
} else {
    Write-Host "  No existing migrations folder found - skipping."
}

Write-Host ""
Write-Host "Step 3/4: Generating and applying one consolidated migration..."
npx prisma migrate dev --name init
if ($LASTEXITCODE -ne 0) { throw "Migration failed - check the error above." }

Write-Host ""
Write-Host "Step 4/4: Create the first developer account"
$devName = Read-Host "Login name for the first developer account"
$devPassword = Read-Host "Password (min 6 chars, 1 number, 1 special character)"

$hashOutput = node scripts/generate-password-hash.js "$devPassword" 2>&1
$hashLine = $hashOutput | Select-String -Pattern '^\$argon2'
if (-not $hashLine) {
    Write-Host ($hashOutput -join "`n")
    throw "Could not generate a password hash - see output above (did the password meet the policy?)."
}
$hash = $hashLine.ToString().Trim()

# Escape single quotes for safe inline SQL (name/hash shouldn't normally
# contain them, but this avoids a broken command if one ever does).
$escapedName = $devName.Replace("'", "''")
$escapedHash = $hash.Replace("'", "''")

psql -U $dbUser -d $dbName -c "INSERT INTO ""users"" (""id"", ""name"", ""passwordHash"", ""role"", ""isDeleted"", ""createdAt"") VALUES (gen_random_uuid(), '$escapedName', '$escapedHash', 'developer', false, now());"
if ($LASTEXITCODE -ne 0) { throw "Could not create the first developer account - check the error above." }

Write-Host ""
Write-Host "Done." -ForegroundColor Green
Write-Host "  - Migration history is now a single 'init' migration." -ForegroundColor Green
Write-Host "  - Developer account '$devName' is ready to log in with." -ForegroundColor Green
Write-Host "  - Start the app, log in, and re-add real operator/admin/accountant" -ForegroundColor Green
Write-Host "    accounts, Locations (with their 2-digit codes), Categories, and" -ForegroundColor Green
Write-Host "    Companies through the app as usual." -ForegroundColor Green

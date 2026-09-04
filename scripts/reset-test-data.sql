-- Resets all business data for a fresh testing session, while keeping
-- every user account (operators/admins/developers) fully intact — you
-- won't need to recreate logins after running this.
--
-- Clears: transactions, bills, bill_counters (so bill numbering restarts
-- at 00001), clients, categories, companies, locations.
-- Keeps:  users.
--
-- WARNING: this is destructive and cannot be undone except by restoring
-- from a backup. Do not run this against real production data — only
-- against a test/staging database, or before a genuine go-live reset.
--
-- Run with:
--   psql -U ptsuser -d payment_tracking -f scripts/reset-test-data.sql

BEGIN;

TRUNCATE TABLE
  "transactions",
  "bills",
  "bill_counters",
  "clients",
  "categories",
  "companies",
  "locations"
CASCADE;

COMMIT;

-- Quick sanity check after running: this should show 0 rows in every
-- table below except "users".
--   SELECT 'users' AS table_name, count(*) FROM "users"
--   UNION ALL SELECT 'clients', count(*) FROM "clients"
--   UNION ALL SELECT 'bills', count(*) FROM "bills"
--   UNION ALL SELECT 'bill_counters', count(*) FROM "bill_counters"
--   UNION ALL SELECT 'transactions', count(*) FROM "transactions"
--   UNION ALL SELECT 'categories', count(*) FROM "categories"
--   UNION ALL SELECT 'companies', count(*) FROM "companies"
--   UNION ALL SELECT 'locations', count(*) FROM "locations";

-- Resets all patient and billing data for a fresh testing session, while
-- keeping the lab's setup intact: user accounts, lab settings, the lead's
-- history, locations, the catalog, machines, panels, camps and doctors.
--
-- Clears: patients (and their old numbers and corrections), quotations,
-- bills with their lines, samples, payments, cancellations, refunds,
-- reassignments and history, every approval, and the bill/quote number
-- counters (so numbering restarts at 0000).
--
-- WARNING: this is destructive and cannot be undone except by restoring
-- from a backup. Do not run this against real production data — only
-- against a test/staging database, or before a genuine go-live reset.
--
-- Run with:
--   psql -U ptsuser -d lab_management -f scripts/reset-test-data.sql

BEGIN;

TRUNCATE TABLE
  "approvals",
  "bill_events",
  "bill_reassignments",
  "sample_collections",
  "refunds",
  "cancellations",
  "transactions",
  "bill_items",
  "bills",
  "quotation_items",
  "quotations",
  "bill_counters",
  "patient_changes",
  "patient_number_aliases",
  "patients"
CASCADE;

COMMIT;

-- Quick sanity check after running: every count should be 0.
--   SELECT 'patients', count(*) FROM "patients"
--   UNION ALL SELECT 'bills', count(*) FROM "bills"
--   UNION ALL SELECT 'transactions', count(*) FROM "transactions"
--   UNION ALL SELECT 'approvals', count(*) FROM "approvals";

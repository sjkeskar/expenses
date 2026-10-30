-- Run this manually in psql, once, after `prisma migrate deploy` has
-- created the tables. This is the ONLY way a developer account gets
-- created. The developer then runs first-run setup (POST /api/settings/setup:
-- lab name, contact and the first lead pathologist); from then on the lead
-- creates every other account.
--
-- Steps:
--   1. Run:  node scripts/generate-password-hash.js "YourChosenPassword1!"
--   2. Copy the printed hash and paste it below in place of
--      'PASTE_ARGON2_HASH_HERE'.
--   3. Set the login name below (this is what will be typed into the
--      login screen — it must be unique).
--   4. Run this file:  psql -U ptsuser -d lab_management -f scripts/create-first-developer.sql

INSERT INTO "users" ("id", "name", "passwordHash", "role", "isDeleted", "createdAt")
VALUES (
  gen_random_uuid(),          -- requires the pgcrypto extension; see note below
  'admin_dev',                 -- <-- change to the login name you want
  '$argon2id$v=19$m=65536,t=3,p=4$WkELJxv5jiG9JqI+jRaZtw$KqrpLt6CuN3eGU+obGkjiqFabjO0Fmq39LKgp29v40I',    -- <-- paste the hash from generate-password-hash.js
  'developer',
  false,
  now()
);

-- Note: gen_random_uuid() requires the pgcrypto extension. If it errors,
-- run this once first (as a superuser):
--   CREATE EXTENSION IF NOT EXISTS pgcrypto;

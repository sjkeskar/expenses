-- Run this manually in psql, once, after `prisma migrate dev` has created
-- the tables. This is the ONLY way the first developer account gets
-- created, since normally only an existing developer can create users.
--
-- Steps:
--   1. Run:  node scripts/generate-password-hash.js "YourChosenPassword1!"
--   2. Copy the printed hash and paste it below in place of
--      'PASTE_ARGON2_HASH_HERE'.
--   3. Set the login name below (this is what will be typed into the
--      login screen — it must be unique).
--   4. Run this file:  psql -U ptsuser -d payment_tracking -f scripts/create-first-developer.sql

INSERT INTO "users" ("id", "name", "passwordHash", "role", "isDeleted", "createdAt")
VALUES (
  gen_random_uuid(),          -- requires the pgcrypto extension; see note below
  'admin_dev',                 -- <-- change to the login name you want
  'PASTE_ARGON2_HASH_HERE',    -- <-- paste the hash from generate-password-hash.js
  'developer',
  false,
  now()
);

-- Note: gen_random_uuid() requires the pgcrypto extension. If it errors,
-- run this once first (as a superuser):
--   CREATE EXTENSION IF NOT EXISTS pgcrypto;

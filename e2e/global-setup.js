// Runs once per `playwright test` invocation, before any spec:
//   1. Refuses to run against anything but a *_test database.
//   2. Drops every table and enum type, then applies the migrations from
//      scratch — so the test DB always matches prisma/migrations exactly,
//      even after the migration history itself was squashed.
//   3. Seeds the fixed baseline (see e2e/helpers/seed.js).
const { execSync } = require("child_process");
const path = require("path");
const { PrismaClient } = require("@prisma/client");
const { seedBaseline } = require("./helpers/seed");

const DROP_EVERYTHING = `
DO $$ DECLARE r record; BEGIN
  FOR r IN SELECT tablename FROM pg_tables WHERE schemaname = 'public' LOOP
    EXECUTE 'DROP TABLE IF EXISTS public.' || quote_ident(r.tablename) || ' CASCADE';
  END LOOP;
  FOR r IN SELECT t.typname FROM pg_type t JOIN pg_namespace n ON n.oid = t.typnamespace
           WHERE n.nspname = 'public' AND t.typtype = 'e' LOOP
    EXECUTE 'DROP TYPE IF EXISTS public.' || quote_ident(r.typname) || ' CASCADE';
  END LOOP;
END $$;`;

module.exports = async () => {
  const url = process.env.DATABASE_URL;
  if (!url) throw new Error("DATABASE_URL is not set — is .env.test present?");
  const dbName = new URL(url).pathname.replace(/^\//, "");
  if (!dbName.endsWith("_test")) {
    throw new Error(`Refusing to run E2E tests against database "${dbName}" — its name must end in _test.`);
  }

  const prisma = new PrismaClient();
  try {
    await prisma.$executeRawUnsafe(DROP_EVERYTHING);
    try {
      execSync("npx prisma migrate deploy", { cwd: path.join(__dirname, ".."), env: process.env, stdio: "pipe" });
    } catch (err) {
      throw new Error(`prisma migrate deploy failed:\n${err.stdout}\n${err.stderr}`);
    }
    await seedBaseline(prisma);
  } finally {
    await prisma.$disconnect();
  }
};

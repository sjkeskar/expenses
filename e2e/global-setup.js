// Runs once per `playwright test` invocation, before any spec:
//   1. Refuses to run against anything but a *_test database.
//   2. Applies pending migrations (idempotent).
//   3. Wipes every table and seeds the fixed baseline (see e2e/helpers/seed.js).
const { execSync } = require("child_process");
const path = require("path");
const { PrismaClient } = require("@prisma/client");
const { seedBaseline } = require("./helpers/seed");

module.exports = async () => {
  const url = process.env.DATABASE_URL;
  if (!url) throw new Error("DATABASE_URL is not set — is .env.test present?");
  const dbName = new URL(url).pathname.replace(/^\//, "");
  if (!dbName.endsWith("_test")) {
    throw new Error(`Refusing to run E2E tests against database "${dbName}" — its name must end in _test.`);
  }

  try {
    execSync("npx prisma migrate deploy", {
      cwd: path.join(__dirname, ".."),
      env: process.env,
      stdio: "pipe",
    });
  } catch (err) {
    throw new Error(`prisma migrate deploy failed:\n${err.stdout}\n${err.stderr}`);
  }

  const prisma = new PrismaClient();
  try {
    await prisma.$executeRawUnsafe(
      `TRUNCATE TABLE "bill_reassignments", "transactions", "bills", "bill_counters",
        "categories", "companies", "locations", "clients", "users" RESTART IDENTITY CASCADE`
    );
    await seedBaseline(prisma);
  } finally {
    await prisma.$disconnect();
  }
};

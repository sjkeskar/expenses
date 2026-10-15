// Fixed baseline data every spec can rely on. Specs must never delete,
// deactivate, demote, or change the password of anything listed here —
// tests that need to do that create their own throwaway records instead
// (see createUser in db.js and the uid() helper).
const argon2 = require("argon2");

const PASSWORD = "Test@123";

const USERS = {
  dev: { name: "e2e-dev", role: "developer" },
  admin: { name: "e2e-admin", role: "admin" },
  op1: { name: "e2e-op1", role: "operator" },
  op2: { name: "e2e-op2", role: "operator" },
  acct: { name: "e2e-acct", role: "accountant" },
};

const BASELINE = {
  location: { name: "E2E Main Store", locationCode: "01" },
  standardCategory: { name: "E2E Walk-in" },
  creditCategory: { name: "E2E Acme Credit", company: "E2E Acme Corp" },
};

async function seedBaseline(prisma) {
  const passwordHash = await argon2.hash(PASSWORD);
  for (const u of Object.values(USERS)) {
    await prisma.user.create({ data: { name: u.name, role: u.role, passwordHash } });
  }

  await prisma.location.create({ data: BASELINE.location });
  await prisma.category.create({ data: { name: BASELINE.standardCategory.name, type: "standard" } });
  const company = await prisma.company.create({ data: { name: BASELINE.creditCategory.company } });
  await prisma.category.create({
    data: { name: BASELINE.creditCategory.name, type: "credit", companyId: company.id },
  });
}

module.exports = { seedBaseline, USERS, BASELINE, PASSWORD };

// Fixed baseline data every spec can rely on. Specs must never delete,
// deactivate, retire or change anything listed here — tests that need to
// create their own throwaway records instead (createUser in db.js, uid()).
// The one exception is the lead, which only the serial "lead" project
// (specs/lead/) may hand over, and always hands back.
const argon2 = require("argon2");

const PASSWORD = "Test@123";

const USERS = {
  dev: { name: "e2e-dev", role: "developer" },
  lead: { name: "e2e-lead", role: "lead_pathologist" },
  path1: { name: "e2e-path1", role: "pathologist" },
  path2: { name: "e2e-path2", role: "pathologist" },
  tech1: { name: "e2e-tech1", role: "technician" },
  tech2: { name: "e2e-tech2", role: "technician" },
  acct: { name: "e2e-acct", role: "accountant" },
};

const BASELINE = {
  settings: { labName: "E2E Diagnostics", phone: "0200000000", email: "lab@e2e.test", address: "1 Lab Road" },
  branch: { name: "E2E Main Branch", locationCode: "01", homeVisitCharge: "200.00" },
  centre: { name: "E2E Centre", locationCode: "02" },
  noVisitBranch: { name: "E2E No-Visit Branch", locationCode: "03" },
  machineType: "E2E Haematology analyser",
  doctor: "E2E Dr. Approved",
  panel: "E2E Acme Corp", // no special rates
  insurer: "E2E Star Insurance", // standing price list: CBC 250, 10% off everything else
  // code -> [name, price, draws]
  tests: {
    CBC: ["Complete blood count", "300.00", ["Single"]],
    GLUF: ["Glucose fasting", "100.00", ["Single"]],
    GTT: ["Glucose tolerance", "500.00", ["Fasting", "1 h", "2 h"]],
    CHOL: ["Cholesterol", "150.00", ["Single"]],
    TG: ["Triglycerides", "150.00", ["Single"]],
  },
  profile: { code: "LIPID", name: "Lipid profile", price: "250.00", components: ["CHOL", "TG"] },
};

async function seedBaseline(prisma) {
  const passwordHash = await argon2.hash(PASSWORD);
  const users = {};
  for (const [key, u] of Object.entries(USERS)) {
    users[key] = await prisma.user.create({ data: { name: u.name, role: u.role, passwordHash } });
  }
  await prisma.labSettings.create({ data: { id: 1, ...BASELINE.settings } });
  await prisma.leadTerm.create({ data: { userId: users.lead.id, reason: "first_run", appointedById: users.dev.id } });

  const branch = await prisma.location.create({ data: { ...BASELINE.branch, type: "branch", address: "1 Lab Road" } });
  await prisma.location.create({
    data: { ...BASELINE.centre, type: "collection_centre", address: "2 Centre Road", processingBranchId: branch.id },
  });
  await prisma.location.create({ data: { ...BASELINE.noVisitBranch, type: "branch", address: "3 Quiet Road" } });

  const machineType = await prisma.machineType.create({ data: { name: BASELINE.machineType } });
  await prisma.machine.create({ data: { name: "E2E HA-1", machineTypeId: machineType.id, branchId: branch.id } });

  const tests = {};
  for (const [code, [name, price, draws]] of Object.entries(BASELINE.tests)) {
    tests[code] = await prisma.catalogItem.create({
      data: {
        code,
        name,
        price,
        kind: "test",
        sampleType: "Blood",
        draws: { create: draws.map((label, i) => ({ sequence: i + 1, label })) },
        machineSteps: { create: [{ sequence: 1, machineTypeId: machineType.id }] },
      },
    });
  }
  const { profile } = BASELINE;
  await prisma.catalogItem.create({
    data: {
      code: profile.code,
      name: profile.name,
      price: profile.price,
      kind: "profile",
      components: { create: profile.components.map((code) => ({ testId: tests[code].id })) },
    },
  });

  await prisma.referringDoctor.create({ data: { name: BASELINE.doctor, status: "approved", createdById: users.lead.id } });
  await prisma.panel.create({ data: { name: BASELINE.panel, type: "corporate" } });
  const priceList = await prisma.priceList.create({
    data: { discountPercent: "10", items: { create: [{ catalogItemId: tests.CBC.id, price: "250.00" }] } },
  });
  await prisma.panel.create({ data: { name: BASELINE.insurer, type: "insurer", priceListId: priceList.id } });
}

module.exports = { seedBaseline, USERS, BASELINE, PASSWORD };

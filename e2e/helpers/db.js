// Direct database access for test setup the API can't express (exact
// timestamps, processing states that arrive in a later phase) and for
// asserting persisted state.
const argon2 = require("argon2");
const { PrismaClient } = require("@prisma/client");
const { PASSWORD, BASELINE } = require("./seed");
const { uid } = require("./data");

let prisma;
function db() {
  if (!prisma) prisma = new PrismaClient();
  return prisma;
}

let cachedHash;
async function defaultHash() {
  if (!cachedHash) cachedHash = await argon2.hash(PASSWORD);
  return cachedHash;
}

// Creates a throwaway user. Use this (not the seeded users) for any test
// that deactivates, resets, or otherwise changes a user.
async function createUser(role, { name, password } = {}) {
  const passwordHash = password ? await argon2.hash(password) : await defaultHash();
  const user = await db().user.create({ data: { name: name || uid(role), role, passwordHash } });
  return { ...user, password: password || PASSWORD };
}

// Baseline lookups, by the names in seed.js.
const baseline = {
  branch: () => db().location.findUnique({ where: { name: BASELINE.branch.name } }),
  centre: () => db().location.findUnique({ where: { name: BASELINE.centre.name } }),
  noVisitBranch: () => db().location.findUnique({ where: { name: BASELINE.noVisitBranch.name } }),
  item: (code) => db().catalogItem.findUnique({ where: { code }, include: { draws: true } }),
  doctor: () => db().referringDoctor.findFirst({ where: { name: BASELINE.doctor } }),
  panel: () => db().panel.findUnique({ where: { name: BASELINE.panel } }),
  insurer: () => db().panel.findUnique({ where: { name: BASELINE.insurer } }),
  machineType: () => db().machineType.findUnique({ where: { name: BASELINE.machineType } }),
};

module.exports = { db, createUser, baseline };

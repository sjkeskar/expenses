// Direct database access for test setup that the API can't express (legacy
// rows, exact timestamps) and for asserting persisted state after a UI action.
const argon2 = require("argon2");
const { PrismaClient } = require("@prisma/client");
const { PASSWORD } = require("./seed");
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
// that deactivates, promotes, demotes, or changes the password of a user.
async function createUser(role, { name, password } = {}) {
  const passwordHash = password ? await argon2.hash(password) : await defaultHash();
  const user = await db().user.create({
    data: { name: name || uid(role), role, passwordHash },
  });
  return { ...user, password: password || PASSWORD };
}

async function findBillByNumber(billNumber) {
  return db().bill.findUnique({
    where: { billNumber },
    include: { transactions: true, reassignments: true },
  });
}

module.exports = { db, createUser, findBillByNumber };

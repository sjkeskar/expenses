const { PrismaClient } = require("@prisma/client");

// Single shared Prisma client for the whole app (recommended pattern —
// avoids exhausting Postgres connections under concurrent requests).
const prisma = new PrismaClient();

module.exports = prisma;

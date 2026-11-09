// Docker-only replacement for scripts/create-first-developer.sql: creates the
// developer account from DEV_USERNAME / DEV_PASSWORD, but only when the
// users table is empty, so restarts never touch existing accounts.
const argon2 = require("argon2");
const { PrismaClient } = require("@prisma/client");
const { validatePassword } = require("../src/utils/passwordPolicy");

async function main() {
  const prisma = new PrismaClient();
  try {
    if ((await prisma.user.count()) > 0) return;
    const name = process.env.DEV_USERNAME || "admin_dev";
    const password = process.env.DEV_PASSWORD;
    if (!password) {
      console.error("No users exist and DEV_PASSWORD is not set; cannot create the first developer.");
      process.exit(1);
    }
    const policyError = validatePassword(password);
    if (policyError) {
      console.error(`DEV_PASSWORD does not meet policy: ${policyError}`);
      process.exit(1);
    }
    await prisma.user.create({
      data: { name, passwordHash: await argon2.hash(password), role: "developer" },
    });
    console.log(`Created first developer account "${name}".`);
  } finally {
    await prisma.$disconnect();
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});

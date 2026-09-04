// Standalone helper — NOT an npm seed script (confirmed decision was a
// manual SQL script, not an automatic seeder). This just does the one
// thing SQL can't do on its own: compute an argon2 hash.
//
// Usage:
//   node scripts/generate-password-hash.js "YourChosenPassword1!"
//
// Copy the printed hash into scripts/create-first-developer.sql before
// running that SQL file in psql.

const argon2 = require("argon2");
const { validatePassword } = require("../src/utils/passwordPolicy");

async function main() {
  const password = process.argv[2];
  if (!password) {
    console.error('Usage: node scripts/generate-password-hash.js "YourPassword1!"');
    process.exit(1);
  }

  const policyError = validatePassword(password);
  if (policyError) {
    console.error(`Password does not meet policy: ${policyError}`);
    process.exit(1);
  }

  const hash = await argon2.hash(password);
  console.log("\nArgon2 hash (paste this into create-first-developer.sql):\n");
  console.log(hash);
  console.log("");
}

main();

import "dotenv/config";

import { pool } from "../src/db/client";
import { anonymizeUserByEmail } from "../src/server/user-anonymization";

async function main() {
  const emailFlagIndex = process.argv.indexOf("--email");
  const email = process.argv[emailFlagIndex + 1];

  if (emailFlagIndex === -1 || !email?.trim()) {
    throw new Error("Usage: pnpm db:anonymize-user --email <account-email>");
  }

  try {
    const result = await anonymizeUserByEmail(email);
    console.log(`Application user ${result.userId} was anonymized.`);
  } finally {
    await pool.end();
  }
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : "Anonymization failed.");
  process.exitCode = 1;
});

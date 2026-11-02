import "dotenv/config";

import { pool } from "../src/db/client";
import {
  anonymizeUserByEmail,
  anonymizeUserByWallet,
  UserNotFoundError,
} from "../src/server/user-anonymization";

function flagValue(flag: string) {
  const index = process.argv.indexOf(flag);
  return index === -1 ? undefined : process.argv[index + 1]?.trim();
}

async function main() {
  const email = flagValue("--email");
  const wallet = flagValue("--wallet");

  if (!email === !wallet) {
    throw new Error(
      "Usage: pnpm db:anonymize-user --email <account-email> | --wallet <0x-address>",
    );
  }

  try {
    const result = email
      ? await anonymizeUserByEmail(email)
      : await anonymizeUserByWallet(wallet!);
    console.log(`Application user ${result.userId} was anonymized.`);
  } finally {
    await pool.end();
  }
}

// Database errors can echo the supplied email or wallet, so only known
// messages are printed.
main().catch((error: unknown) => {
  console.error(
    error instanceof UserNotFoundError ||
      (error instanceof Error && error.message.startsWith("Usage:"))
      ? error.message
      : "Anonymization failed.",
  );
  process.exitCode = 1;
});

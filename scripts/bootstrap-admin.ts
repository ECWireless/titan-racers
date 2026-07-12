import "dotenv/config";

import { eq, sql } from "drizzle-orm";

import { db, pool } from "../src/db/client";
import { accounts, userRoles, users } from "../src/db/schema";

async function main() {
  const emailFlagIndex = process.argv.indexOf("--email");
  const email = process.argv[emailFlagIndex + 1]?.trim().toLowerCase();

  if (emailFlagIndex === -1 || !email) {
    throw new Error("Usage: pnpm db:bootstrap-admin --email <google-account>");
  }

  try {
    const [user] = await db
      .select({ id: users.id })
      .from(users)
      .innerJoin(accounts, eq(accounts.userId, users.id))
      .where(
        sql`${accounts.providerId} = 'google' and lower(${users.email}) = ${email}`,
      )
      .limit(1);

    if (!user) {
      throw new Error(
        "No Google-linked application user exists for that email. Complete Google sign-in first.",
      );
    }

    await db
      .insert(userRoles)
      .values([
        { role: "player", userId: user.id },
        { role: "admin", userId: user.id },
      ])
      .onConflictDoNothing();

    console.log(`Admin role granted to application user ${user.id}.`);
  } finally {
    await pool.end();
  }
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : "Admin bootstrap failed.");
  process.exitCode = 1;
});

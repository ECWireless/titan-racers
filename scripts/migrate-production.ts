import "dotenv/config";

import { migrate } from "drizzle-orm/node-postgres/migrator";
import { drizzle } from "drizzle-orm/node-postgres";
import { Pool } from "pg";

async function main() {
  const connectionString = process.env.DATABASE_MIGRATION_URL;

  if (!connectionString) {
    throw new Error(
      "DATABASE_MIGRATION_URL is required for a production migration.",
    );
  }

  const pool = new Pool({ connectionString, max: 1 });

  try {
    await migrate(drizzle(pool), { migrationsFolder: "./drizzle" });
  } finally {
    await pool.end();
  }
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : "Migration failed.");
  process.exitCode = 1;
});

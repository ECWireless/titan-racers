import { drizzle } from "drizzle-orm/node-postgres";
import { Pool } from "pg";

import * as schema from "./schema";

const unavailableDatabaseUrl =
  "postgresql://unavailable:unavailable@127.0.0.1:1/unavailable";

const globalDatabase = globalThis as typeof globalThis & {
  titanRacersPool?: Pool;
};

export const pool =
  globalDatabase.titanRacersPool ??
  new Pool({
    connectionString: process.env.DATABASE_URL ?? unavailableDatabaseUrl,
    max: 10,
  });

if (process.env.NODE_ENV !== "production") {
  globalDatabase.titanRacersPool = pool;
}

export const db = drizzle(pool, { schema });

import { drizzleAdapter } from "@better-auth/drizzle-adapter";
import { betterAuth } from "better-auth";
import { testUtils } from "better-auth/plugins";

import { db } from "../../src/db/client";
import { authSchema } from "../../src/db/schema";

export const testAuth = betterAuth({
  baseURL: process.env.BETTER_AUTH_URL ?? "http://127.0.0.1:3873",
  secret:
    process.env.BETTER_AUTH_SECRET ??
    "0123456789abcdef0123456789abcdef",
  database: drizzleAdapter(db, {
    provider: "pg",
    schema: authSchema,
    usePlural: true,
  }),
  plugins: [testUtils()],
});

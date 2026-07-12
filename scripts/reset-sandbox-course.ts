import "dotenv/config";

import { and, eq, sql } from "drizzle-orm";

import { db, pool } from "../src/db/client";
import { userRoles, users } from "../src/db/schema";
import { ROUGH_COURSE_DOCUMENT } from "../src/game/course/course-document";
import {
  loadLatestCourseRevision,
  saveCourseRevision,
} from "../src/server/course-repository";

const SANDBOX_COURSE_ID = "rough-course";

function readRequiredFlag(flag: string) {
  const index = process.argv.indexOf(flag);
  const value = process.argv[index + 1]?.trim();
  if (index === -1 || !value) {
    return null;
  }
  return value;
}

async function main() {
  const email = readRequiredFlag("--email")?.toLowerCase();
  const confirmation = readRequiredFlag("--confirm");

  if (!email || confirmation !== SANDBOX_COURSE_ID) {
    throw new Error(
      "Usage: pnpm db:reset-sandbox-course --email <admin-account> --confirm rough-course",
    );
  }

  try {
    const [admin] = await db
      .select({ id: users.id })
      .from(users)
      .innerJoin(
        userRoles,
        and(eq(userRoles.userId, users.id), eq(userRoles.role, "admin")),
      )
      .where(sql`lower(${users.email}) = ${email}`)
      .limit(1);

    if (!admin) {
      throw new Error(
        "No application admin exists for that email. Sign in and bootstrap the admin role first.",
      );
    }

    const latest = await loadLatestCourseRevision(SANDBOX_COURSE_ID);
    const reset = await saveCourseRevision({
      authorUserId: admin.id,
      document: ROUGH_COURSE_DOCUMENT,
      expectedRevision: latest?.revision ?? null,
    });

    console.log(
      `Sandbox course restored from the source-controlled seed at revision ${reset.revision}.`,
    );
  } finally {
    await pool.end();
  }
}

main().catch((error: unknown) => {
  console.error(
    error instanceof Error ? error.message : "Sandbox course reset failed.",
  );
  process.exitCode = 1;
});

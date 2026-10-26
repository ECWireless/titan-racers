import "dotenv/config";

import { and, eq, sql } from "drizzle-orm";

import { db, pool } from "../src/db/client";
import { userRoles, users } from "../src/db/schema";
import { BUNDLED_COURSE_DOCUMENTS } from "../src/game/course/course-document";
import { isOfficialCourseId } from "../src/game/course/course-ids";
import {
  loadLatestCourseRevision,
  saveCourseRevision,
} from "../src/server/course-repository";

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
  // The course ID doubles as the confirmation of which course to reset.
  const courseId = readRequiredFlag("--confirm");

  if (!email || !isOfficialCourseId(courseId)) {
    throw new Error(
      "Usage: pnpm db:reset-course-seed --email <admin-account> --confirm <rough-course|falls-view-park>",
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

    const latest = await loadLatestCourseRevision(courseId);
    const reset = await saveCourseRevision({
      authorUserId: admin.id,
      document: BUNDLED_COURSE_DOCUMENTS[courseId],
      expectedRevision: latest?.revision ?? null,
    });

    console.log(
      `${courseId} restored from its source-controlled seed as draft revision ${reset.revision}. Publish it in the course editor.`,
    );
  } finally {
    await pool.end();
  }
}

main().catch((error: unknown) => {
  console.error(
    error instanceof Error ? error.message : "Course seed reset failed.",
  );
  process.exitCode = 1;
});

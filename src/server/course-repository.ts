import { randomUUID } from "node:crypto";

import { and, eq } from "drizzle-orm";

import { db } from "@/db/client";
import { courseRevisions, courses } from "@/db/schema";
import {
  type CourseDocument,
  parseCourseDocument,
} from "@/game/course/course-document";

export class CourseConflictError extends Error {
  constructor() {
    super("The persisted course changed after the requested base revision.");
    this.name = "CourseConflictError";
  }
}

export type PersistedCourseRevision = {
  authorUserId: string;
  courseId: string;
  createdAt: Date;
  document: CourseDocument;
  revision: number;
  schemaVersion: number;
};

export async function loadLatestCourseRevision(
  courseId: string,
): Promise<PersistedCourseRevision | null> {
  const [row] = await db
    .select({
      authorUserId: courseRevisions.authorUserId,
      courseId: courseRevisions.courseId,
      createdAt: courseRevisions.createdAt,
      document: courseRevisions.document,
      revision: courseRevisions.revision,
      schemaVersion: courseRevisions.schemaVersion,
    })
    .from(courses)
    .innerJoin(
      courseRevisions,
      and(
        eq(courseRevisions.courseId, courses.id),
        eq(courseRevisions.revision, courses.currentRevision),
      ),
    )
    .where(eq(courses.id, courseId))
    .limit(1);

  if (!row) {
    return null;
  }

  return { ...row, document: parseCourseDocument(row.document) };
}

export async function saveCourseRevision(input: {
  authorUserId: string;
  document: unknown;
  expectedRevision: number | null;
}): Promise<PersistedCourseRevision> {
  const document = parseCourseDocument(input.document);
  const nextRevision = (input.expectedRevision ?? 0) + 1;

  return db.transaction(async (transaction) => {
    if (input.expectedRevision === null) {
      const inserted = await transaction
        .insert(courses)
        .values({
          createdByUserId: input.authorUserId,
          currentRevision: nextRevision,
          id: document.courseId,
        })
        .onConflictDoNothing()
        .returning({ id: courses.id });

      if (inserted.length === 0) {
        throw new CourseConflictError();
      }
    } else {
      const advanced = await transaction
        .update(courses)
        .set({ currentRevision: nextRevision })
        .where(
          and(
            eq(courses.id, document.courseId),
            eq(courses.currentRevision, input.expectedRevision),
          ),
        )
        .returning({ id: courses.id });

      if (advanced.length === 0) {
        throw new CourseConflictError();
      }
    }

    const [revision] = await transaction
      .insert(courseRevisions)
      .values({
        authorUserId: input.authorUserId,
        courseId: document.courseId,
        document,
        id: randomUUID(),
        revision: nextRevision,
        schemaVersion: document.schemaVersion,
      })
      .returning({
        authorUserId: courseRevisions.authorUserId,
        courseId: courseRevisions.courseId,
        createdAt: courseRevisions.createdAt,
        revision: courseRevisions.revision,
        schemaVersion: courseRevisions.schemaVersion,
      });

    return { ...revision, document };
  });
}

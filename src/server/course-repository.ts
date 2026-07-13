import { randomUUID } from "node:crypto";

import { and, desc, eq } from "drizzle-orm";

import { db } from "@/db/client";
import { coursePublications, courseRevisions, courses } from "@/db/schema";
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

export class CoursePublicationConflictError extends Error {
  constructor() {
    super("The published course changed after the requested publication base.");
    this.name = "CoursePublicationConflictError";
  }
}

export class CoursePublicationTargetError extends Error {
  constructor() {
    super("The requested course or saved revision does not exist.");
    this.name = "CoursePublicationTargetError";
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

export type PersistedCoursePublication = PersistedCourseRevision & {
  publicationId: number;
  publishedAt: Date;
  publishedByUserId: string;
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

export async function loadLatestCoursePublication(
  courseId: string,
): Promise<PersistedCoursePublication | null> {
  const [row] = await db
    .select({
      authorUserId: courseRevisions.authorUserId,
      courseId: courseRevisions.courseId,
      createdAt: courseRevisions.createdAt,
      document: courseRevisions.document,
      publicationId: coursePublications.id,
      publishedAt: coursePublications.createdAt,
      publishedByUserId: coursePublications.publishedByUserId,
      revision: courseRevisions.revision,
      schemaVersion: courseRevisions.schemaVersion,
    })
    .from(coursePublications)
    .innerJoin(
      courseRevisions,
      and(
        eq(courseRevisions.courseId, coursePublications.courseId),
        eq(courseRevisions.revision, coursePublications.revision),
      ),
    )
    .where(eq(coursePublications.courseId, courseId))
    .orderBy(desc(coursePublications.id))
    .limit(1);

  if (!row) {
    return null;
  }

  return { ...row, document: parseCourseDocument(row.document) };
}

export async function publishCourseRevision(input: {
  courseId: string;
  expectedPublicationId: number | null;
  publishedByUserId: string;
  revision: number;
}): Promise<PersistedCoursePublication> {
  return db.transaction(async (transaction) => {
    const [course] = await transaction
      .select({ id: courses.id })
      .from(courses)
      .where(eq(courses.id, input.courseId))
      .for("update")
      .limit(1);
    if (!course) {
      throw new CoursePublicationTargetError();
    }

    const [latestPublication] = await transaction
      .select({
        publicationId: coursePublications.id,
        publishedAt: coursePublications.createdAt,
        publishedByUserId: coursePublications.publishedByUserId,
        revision: coursePublications.revision,
      })
      .from(coursePublications)
      .where(eq(coursePublications.courseId, input.courseId))
      .orderBy(desc(coursePublications.id))
      .limit(1);
    if (
      (latestPublication?.publicationId ?? null) !==
      input.expectedPublicationId
    ) {
      throw new CoursePublicationConflictError();
    }

    const [revision] = await transaction
      .select({
        authorUserId: courseRevisions.authorUserId,
        courseId: courseRevisions.courseId,
        createdAt: courseRevisions.createdAt,
        document: courseRevisions.document,
        revision: courseRevisions.revision,
        schemaVersion: courseRevisions.schemaVersion,
      })
      .from(courseRevisions)
      .where(
        and(
          eq(courseRevisions.courseId, input.courseId),
          eq(courseRevisions.revision, input.revision),
        ),
      )
      .limit(1);
    if (!revision) {
      throw new CoursePublicationTargetError();
    }

    if (latestPublication?.revision === input.revision) {
      return {
        ...revision,
        ...latestPublication,
        document: parseCourseDocument(revision.document),
      };
    }

    const [publication] = await transaction
      .insert(coursePublications)
      .values({
        courseId: input.courseId,
        publishedByUserId: input.publishedByUserId,
        revision: input.revision,
      })
      .returning({
        publicationId: coursePublications.id,
        publishedAt: coursePublications.createdAt,
        publishedByUserId: coursePublications.publishedByUserId,
      });

    return {
      ...revision,
      ...publication,
      document: parseCourseDocument(revision.document),
    };
  });
}

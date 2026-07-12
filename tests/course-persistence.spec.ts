import { randomUUID } from "node:crypto";

import { expect, test } from "@playwright/test";
import { eq, sql } from "drizzle-orm";

import {
  GET as getPersistedCourse,
  PUT as putPersistedCourse,
} from "../src/app/api/admin/courses/[courseId]/route";
import { db } from "../src/db/client";
import {
  accounts,
  courseRevisions,
  courses,
  sessions,
  userRoles,
  users,
} from "../src/db/schema";
import { ROUGH_COURSE_DOCUMENT } from "../src/game/course/course-document";
import { auth } from "../src/lib/auth";
import { authorizeRole } from "../src/server/authorization";
import {
  CourseConflictError,
  loadLatestCourseRevision,
  saveCourseRevision,
} from "../src/server/course-repository";
import { anonymizeUserByEmail } from "../src/server/user-anonymization";
import { testAuth } from "./support/test-auth";

const requiredIntegrationVariables = [
  "DATABASE_URL",
  "BETTER_AUTH_SECRET",
  "BETTER_AUTH_URL",
  "GOOGLE_CLIENT_ID",
  "GOOGLE_CLIENT_SECRET",
] as const;

test.describe("course persistence and authorization", () => {
  test.describe.configure({ mode: "serial" });

  test.beforeEach(async ({}, testInfo) => {
    test.skip(
      testInfo.project.name !== "desktop",
      "Database integration runs once in the desktop project.",
    );
    test.skip(
      requiredIntegrationVariables.some((name) => !process.env[name]?.trim()),
      "Database and auth environment variables are required for persistence integration tests.",
    );
  });

  test("stores immutable attributed revisions and rejects stale saves", async () => {
    const userId = randomUUID();
    const courseId = `persistence-${randomUUID()}`;
    const document = structuredClone(ROUGH_COURSE_DOCUMENT);
    document.courseId = courseId;

    await db.insert(users).values({
      email: `${userId}@example.invalid`,
      emailVerified: true,
      id: userId,
      name: "Persistence Test",
    });

    const first = await saveCourseRevision({
      authorUserId: userId,
      document,
      expectedRevision: null,
    });

    expect(first).toMatchObject({
      authorUserId: userId,
      courseId,
      revision: 1,
      schemaVersion: 1,
    });

    const secondDocument = structuredClone(document);
    secondDocument.name = "Persistence Test Revision Two";

    const second = await saveCourseRevision({
      authorUserId: userId,
      document: secondDocument,
      expectedRevision: 1,
    });
    expect(second.revision).toBe(2);

    const competingDocuments = ["Three A", "Three B"].map((name) => ({
      ...structuredClone(secondDocument),
      name,
    }));
    const competingSaves = await Promise.allSettled(
      competingDocuments.map((competingDocument) =>
        saveCourseRevision({
          authorUserId: userId,
          document: competingDocument,
          expectedRevision: 2,
        }),
      ),
    );

    expect(competingSaves.filter(({ status }) => status === "fulfilled")).toHaveLength(1);
    const rejected = competingSaves.find(({ status }) => status === "rejected");
    expect(rejected).toMatchObject({
      status: "rejected",
      reason: expect.any(CourseConflictError),
    });

    const latest = await loadLatestCourseRevision(courseId);
    expect(latest).toMatchObject({
      authorUserId: userId,
      courseId,
      revision: 3,
      schemaVersion: 1,
    });

    let immutableRevisionError: unknown;
    try {
      await db.execute(
        sql`update ${courseRevisions} set "revision" = 99 where ${courseRevisions.courseId} = ${courseId}`,
      );
    } catch (error) {
      immutableRevisionError = error;
    }

    expect(immutableRevisionError).toBeInstanceOf(Error);
    expect(
      (immutableRevisionError as Error & { cause?: Error }).cause?.message,
    ).toMatch(/course revisions are immutable/);
  });

  test("requires a database-backed admin role", async () => {
    const userId = randomUUID();
    await db.insert(users).values({
      email: `${userId}@example.invalid`,
      emailVerified: true,
      id: userId,
      name: "Authorization Test",
    });
    await expect(
      db
        .select({ role: userRoles.role })
        .from(userRoles)
        .where(sql`${userRoles.userId} = ${userId}`),
    ).resolves.toEqual([{ role: "player" }]);

    const request = new Request("http://localhost/api/admin/courses/test");
    const resolveUser = async () => ({ user: { id: userId } });

    await expect(authorizeRole(request, "admin", async () => null)).resolves.toEqual({
      authorized: false,
      status: 401,
    });
    await expect(authorizeRole(request, "admin", resolveUser)).resolves.toEqual({
      authorized: false,
      status: 403,
    });

    await db.insert(userRoles).values({ role: "admin", userId });

    await expect(authorizeRole(request, "admin", resolveUser)).resolves.toEqual({
      authorized: true,
      userId,
    });
  });

  test("rejects unauthorized course initialization without creating rows", async () => {
    const authContext = await testAuth.$context;
    const savedUser = await authContext.test.saveUser(
      authContext.test.createUser({
        email: `${randomUUID()}@example.invalid`,
        name: "Non Admin Initialization Test",
      }),
    );
    const courseId = `unauthorized-initialization-${randomUUID()}`;
    const document = structuredClone(ROUGH_COURSE_DOCUMENT);
    document.courseId = courseId;
    const makeRequest = (headers?: Headers) =>
      new Request(`http://127.0.0.1:3873/api/admin/courses/${courseId}`, {
        body: JSON.stringify({ document, expectedRevision: null }),
        headers: new Headers([
          ...(headers?.entries() ?? []),
          ["content-type", "application/json"],
        ]),
        method: "PUT",
      });

    const unauthenticatedResponse = await putPersistedCourse(makeRequest(), {
      params: Promise.resolve({ courseId }),
    });
    expect(unauthenticatedResponse.status).toBe(401);

    const { headers } = await authContext.test.login({ userId: savedUser.id });
    const nonAdminResponse = await putPersistedCourse(makeRequest(headers), {
      params: Promise.resolve({ courseId }),
    });
    expect(nonAdminResponse.status).toBe(403);

    await expect(
      db.select().from(courses).where(eq(courses.id, courseId)),
    ).resolves.toEqual([]);
    await expect(
      db
        .select()
        .from(courseRevisions)
        .where(eq(courseRevisions.courseId, courseId)),
    ).resolves.toEqual([]);
  });

  test("allows exactly one competing first revision", async () => {
    const userId = randomUUID();
    const courseId = `first-revision-race-${randomUUID()}`;
    const document = structuredClone(ROUGH_COURSE_DOCUMENT);
    document.courseId = courseId;

    await db.insert(users).values({
      email: `${userId}@example.invalid`,
      emailVerified: true,
      id: userId,
      name: "First Revision Race Test",
    });

    const saves = await Promise.allSettled(
      ["First A", "First B"].map((name) =>
        saveCourseRevision({
          authorUserId: userId,
          document: { ...structuredClone(document), name },
          expectedRevision: null,
        }),
      ),
    );

    expect(saves.filter(({ status }) => status === "fulfilled")).toHaveLength(1);
    expect(saves.filter(({ status }) => status === "rejected")).toHaveLength(1);
    expect(
      saves.find(({ status }) => status === "rejected"),
    ).toMatchObject({
      status: "rejected",
      reason: expect.any(CourseConflictError),
    });
    await expect(
      db
        .select({ revision: courseRevisions.revision })
        .from(courseRevisions)
        .where(eq(courseRevisions.courseId, courseId)),
    ).resolves.toEqual([{ revision: 1 }]);
    await expect(
      db
        .select({ currentRevision: courses.currentRevision })
        .from(courses)
        .where(eq(courses.id, courseId)),
    ).resolves.toEqual([{ currentRevision: 1 }]);
  });

  test("loads a course through a real Better Auth session and protected API", async () => {
    const authContext = await testAuth.$context;
    const savedUser = await authContext.test.saveUser(
      authContext.test.createUser({
        email: `${randomUUID()}@example.invalid`,
        name: "Protected API Test",
      }),
    );
    await db.insert(userRoles).values({ role: "admin", userId: savedUser.id });

    const courseId = `protected-api-${randomUUID()}`;
    const document = structuredClone(ROUGH_COURSE_DOCUMENT);
    document.courseId = courseId;
    await saveCourseRevision({
      authorUserId: savedUser.id,
      document,
      expectedRevision: null,
    });

    const { headers } = await authContext.test.login({ userId: savedUser.id });
    const response = await getPersistedCourse(
      new Request(`http://127.0.0.1:3873/api/admin/courses/${courseId}`, {
        headers,
      }),
      { params: Promise.resolve({ courseId }) },
    );

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({
      authorUserId: savedUser.id,
      courseId,
      revision: 1,
    });

    const updatedDocument = structuredClone(document);
    updatedDocument.name = "Protected API Revision Two";
    const saveRequest = () =>
      new Request(`http://127.0.0.1:3873/api/admin/courses/${courseId}`, {
        body: JSON.stringify({
          document: updatedDocument,
          expectedRevision: 1,
        }),
        headers: new Headers([
          ...headers.entries(),
          ["content-type", "application/json"],
        ]),
        method: "PUT",
      });

    const saveResponse = await putPersistedCourse(saveRequest(), {
      params: Promise.resolve({ courseId }),
    });
    expect(saveResponse.status).toBe(200);
    await expect(saveResponse.json()).resolves.toMatchObject({ revision: 2 });

    const staleSaveResponse = await putPersistedCourse(saveRequest(), {
      params: Promise.resolve({ courseId }),
    });
    expect(staleSaveResponse.status).toBe(409);
  });

  test("initiates Google login through the mounted Better Auth handler", async ({
    request,
  }) => {
    const response = await request.post("/api/auth/sign-in/social", {
      data: { callbackURL: "/", provider: "google" },
    });
    expect(response.status()).toBe(200);

    const body = (await response.json()) as { url: string };
    const authorizationUrl = new URL(body.url);
    expect(authorizationUrl.hostname).toBe("accounts.google.com");
    expect(authorizationUrl.searchParams.get("client_id")).toBe(
      process.env.GOOGLE_CLIENT_ID,
    );
    expect(authorizationUrl.searchParams.has("client_secret")).toBe(false);
  });

  test("disables account linking and never retains Google token material", async () => {
    expect(auth.options.account?.accountLinking).toMatchObject({
      disableImplicitLinking: true,
      enabled: false,
    });

    const userId = randomUUID();
    await db.insert(users).values({
      email: `${userId}@example.invalid`,
      emailVerified: true,
      id: userId,
      name: "Token Retention Test",
    });

    const authContext = await auth.$context;
    await authContext.internalAdapter.createAccount({
      accessToken: "access-token-must-not-persist",
      accessTokenExpiresAt: new Date(Date.now() + 60_000),
      accountId: `google-${userId}`,
      idToken: "id-token-must-not-persist",
      providerId: "google",
      refreshToken: "refresh-token-must-not-persist",
      refreshTokenExpiresAt: new Date(Date.now() + 120_000),
      userId,
    });

    await expect(
      db
        .select({
          accessToken: accounts.accessToken,
          accessTokenExpiresAt: accounts.accessTokenExpiresAt,
          idToken: accounts.idToken,
          refreshToken: accounts.refreshToken,
          refreshTokenExpiresAt: accounts.refreshTokenExpiresAt,
        })
        .from(accounts)
        .where(sql`${accounts.userId} = ${userId}`),
    ).resolves.toEqual([
      {
        accessToken: null,
        accessTokenExpiresAt: null,
        idToken: null,
        refreshToken: null,
        refreshTokenExpiresAt: null,
      },
    ]);
  });

  test("scrubs identity PII while preserving opaque course attribution", async () => {
    const userId = randomUUID();
    const email = `${userId}@example.invalid`;
    await db.insert(users).values({
      email,
      emailVerified: true,
      id: userId,
      image: "https://example.invalid/private-avatar.png",
      name: "Personal Name",
    });
    await db.insert(userRoles).values({ role: "admin", userId });
    await db.insert(sessions).values({
      expiresAt: new Date(Date.now() + 60_000),
      id: randomUUID(),
      token: randomUUID(),
      userId,
    });
    await db.insert(accounts).values({
      accountId: `google-${userId}`,
      id: randomUUID(),
      idToken: "stored-token",
      providerId: "google",
      userId,
    });

    const courseId = `anonymized-author-${randomUUID()}`;
    const document = structuredClone(ROUGH_COURSE_DOCUMENT);
    document.courseId = courseId;
    await saveCourseRevision({
      authorUserId: userId,
      document,
      expectedRevision: null,
    });

    await expect(anonymizeUserByEmail(email)).resolves.toEqual({ userId });

    const [anonymizedUser] = await db
      .select()
      .from(users)
      .where(sql`${users.id} = ${userId}`);
    expect(anonymizedUser).toMatchObject({
      email: `${userId}@deleted.invalid`,
      emailVerified: false,
      image: null,
      name: "Deleted racer",
    });
    expect(anonymizedUser.anonymizedAt).toBeInstanceOf(Date);

    await expect(
      db.select().from(accounts).where(sql`${accounts.userId} = ${userId}`),
    ).resolves.toEqual([]);
    await expect(
      db.select().from(sessions).where(sql`${sessions.userId} = ${userId}`),
    ).resolves.toEqual([]);
    await expect(
      db
        .select({ role: userRoles.role })
        .from(userRoles)
        .where(sql`${userRoles.userId} = ${userId}`),
    ).resolves.toEqual([{ role: "player" }]);

    await expect(loadLatestCourseRevision(courseId)).resolves.toMatchObject({
      authorUserId: userId,
      revision: 1,
    });
  });
});

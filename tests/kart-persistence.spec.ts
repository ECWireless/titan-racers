import { randomUUID } from "node:crypto";

import { expect, test } from "@playwright/test";
import { eq, sql } from "drizzle-orm";

import {
  GET as getPersistedKart,
  PUT as putPersistedKart,
} from "../src/app/api/admin/karts/[kartId]/route";
import {
  GET as getKartPublication,
  POST as postKartPublication,
} from "../src/app/api/admin/karts/[kartId]/publication/route";
import { GET as getPublishedKart } from "../src/app/api/karts/[kartId]/published/route";
import { db } from "../src/db/client";
import {
  kartPublicationEvents,
  kartRevisions,
  karts,
  userRoles,
  users,
} from "../src/db/schema";
import {
  deriveKartSnapshot,
  hashResolvedKartSnapshot,
  parseResolvedKartSnapshot,
  type ResolvedKartSnapshot,
  type ResolvedKartSnapshotV1,
} from "../src/game/kart/kart-derivation";
import {
  KartConflictError,
  KartPublicationConflictError,
  loadLatestKartPublicationEvent,
  loadLatestKartRevision,
  loadPublishedKartRevision,
  publishKartRevision,
  saveKartRevision,
  unpublishKart,
} from "../src/server/kart-repository";
import { createValidKartAssembly } from "./support/kart-assembly";
import { testAuth } from "./support/test-auth";

const requiredIntegrationVariables = [
  "DATABASE_URL",
  "BETTER_AUTH_SECRET",
  "BETTER_AUTH_URL",
  "GOOGLE_CLIENT_ID",
  "GOOGLE_CLIENT_SECRET",
] as const;
const TEST_ORIGIN = "http://127.0.0.1:3873";
const CONFIGURED_ORIGIN =
  process.env.NEXT_PUBLIC_APP_URL ?? process.env.BETTER_AUTH_URL ?? TEST_ORIGIN;

function createLegacyResolvedSnapshot(document: ReturnType<typeof createValidKartAssembly>) {
  const current = structuredClone(
    deriveKartSnapshot(document),
  ) as unknown as ResolvedKartSnapshot;
  return {
    ...current,
    derivationVersion: 1,
    registryReferences: {
      ...current.registryReferences,
      surfaceMaterial: { id: "surface.standard-course", version: 1 },
      tireSurfaceInteractionDerivationVersion: 1,
    },
    snapshotVersion: 1,
    tireSurfaceInteraction: {
      peakGripCoefficient: 1.42,
      peakSlipAngleDegrees: 5,
      rollingResistanceCoefficient: 0.025,
      slidingGripCoefficient: 0.98,
      slidingSlipAngleDegrees: 18,
    },
  } satisfies ResolvedKartSnapshotV1;
}

test.describe("kart persistence and authorization", () => {
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

  test("stores immutable source and derived revisions with stable ownership", async () => {
    const ownerUserId = randomUUID();
    const secondAdminId = randomUUID();
    const kartId = `persistence-${randomUUID()}`;
    await db.insert(users).values([
      {
        email: `${ownerUserId}@example.invalid`,
        emailVerified: true,
        id: ownerUserId,
        name: "Kart Owner",
      },
      {
        email: `${secondAdminId}@example.invalid`,
        emailVerified: true,
        id: secondAdminId,
        name: "Second Kart Admin",
      },
    ]);

    const firstDocument = createValidKartAssembly({ kartId });
    const first = await saveKartRevision({
      authorUserId: ownerUserId,
      document: firstDocument,
      expectedRevision: null,
      ownerUserId,
    });
    expect(first).toMatchObject({
      authorUserId: ownerUserId,
      derivationVersion: 2,
      kartId,
      ownerUserId,
      revision: 1,
      schemaVersion: 1,
    });
    expect(first.resolvedSnapshotHash).toMatch(/^[0-9a-f]{64}$/);
    await expect(hashResolvedKartSnapshot(first.resolvedSnapshot)).resolves.toBe(
      first.resolvedSnapshotHash,
    );

    const secondDocument = structuredClone(firstDocument);
    secondDocument.name = "Persistence Revision Two";
    const second = await saveKartRevision({
      authorUserId: secondAdminId,
      document: secondDocument,
      expectedRevision: 1,
      ownerUserId: secondAdminId,
    });
    expect(second).toMatchObject({
      authorUserId: secondAdminId,
      ownerUserId,
      revision: 2,
    });

    const competing = await Promise.allSettled(
      ["Three A", "Three B"].map((name) =>
        saveKartRevision({
          authorUserId: ownerUserId,
          document: { ...structuredClone(secondDocument), name },
          expectedRevision: 2,
          ownerUserId,
        }),
      ),
    );
    expect(competing.filter(({ status }) => status === "fulfilled")).toHaveLength(1);
    expect(competing.find(({ status }) => status === "rejected")).toMatchObject({
      reason: expect.any(KartConflictError),
      status: "rejected",
    });

    const latest = await loadLatestKartRevision(kartId);
    expect(latest).toMatchObject({ kartId, ownerUserId, revision: 3 });

    let immutableRevisionError: unknown;
    try {
      await db.execute(
        sql`update ${kartRevisions} set "revision" = 99 where ${kartRevisions.kartId} = ${kartId}`,
      );
    } catch (error) {
      immutableRevisionError = error;
    }
    expect(immutableRevisionError).toBeInstanceOf(Error);
    expect(
      (immutableRevisionError as Error & { cause?: Error }).cause?.message,
    ).toMatch(/kart revisions are immutable/);
  });

  test("rejects malformed or hash-mismatched persisted derivation evidence", async () => {
    const userId = randomUUID();
    const malformedKartId = `malformed-snapshot-${randomUUID()}`;
    const mismatchedKartId = `mismatched-snapshot-${randomUUID()}`;
    await db.insert(users).values({
      email: `${userId}@example.invalid`,
      emailVerified: true,
      id: userId,
      name: "Snapshot Integrity Test",
    });

    const malformedDocument = createValidKartAssembly({ kartId: malformedKartId });
    const malformedSnapshot = {
      ...deriveKartSnapshot(malformedDocument),
      snapshotVersion: 99,
    };
    const mismatchedDocument = createValidKartAssembly({ kartId: mismatchedKartId });
    const mismatchedSnapshot = deriveKartSnapshot(mismatchedDocument);
    await db.insert(karts).values([
      {
        createdByUserId: userId,
        currentRevision: 1,
        id: malformedKartId,
        ownerUserId: userId,
      },
      {
        createdByUserId: userId,
        currentRevision: 1,
        id: mismatchedKartId,
        ownerUserId: userId,
      },
    ]);
    await db.insert(kartRevisions).values([
      {
        authorUserId: userId,
        derivationVersion: 2,
        document: malformedDocument,
        id: randomUUID(),
        kartId: malformedKartId,
        resolvedSnapshot: malformedSnapshot,
        resolvedSnapshotHash: "0".repeat(64),
        revision: 1,
        schemaVersion: 1,
      },
      {
        authorUserId: userId,
        derivationVersion: 2,
        document: mismatchedDocument,
        id: randomUUID(),
        kartId: mismatchedKartId,
        resolvedSnapshot: mismatchedSnapshot,
        resolvedSnapshotHash: "0".repeat(64),
        revision: 1,
        schemaVersion: 1,
      },
    ]);

    await expect(loadLatestKartRevision(malformedKartId)).rejects.toThrow();
    await expect(loadLatestKartRevision(mismatchedKartId)).rejects.toThrow(
      "Persisted kart derivation evidence hash does not match.",
    );
  });

  test("requires admins and rejects unsafe or invalid saves before mutation", async () => {
    const authContext = await testAuth.$context;
    const savedUser = await authContext.test.saveUser(
      authContext.test.createUser({
        email: `${randomUUID()}@example.invalid`,
        name: "Kart Assembler",
      }),
    );
    await db.insert(userRoles).values({ role: "assembler", userId: savedUser.id });
    const kartId = `protected-${randomUUID()}`;
    const document = createValidKartAssembly({ kartId });
    const context = { params: Promise.resolve({ kartId }) };
    const { headers } = await authContext.test.login({ userId: savedUser.id });
    const makeRequest = (
      requestDocument: unknown = document,
      origin = CONFIGURED_ORIGIN,
      contentType = "application/json",
    ) =>
      new Request(`${TEST_ORIGIN}/api/admin/karts/${kartId}`, {
        body: JSON.stringify({ document: requestDocument, expectedRevision: null }),
        headers: new Headers([
          ...headers.entries(),
          ["content-type", contentType],
          ["origin", origin],
        ]),
        method: "PUT",
      });

    const unauthenticated = await putPersistedKart(
      new Request(`${TEST_ORIGIN}/api/admin/karts/${kartId}`, {
        body: JSON.stringify({ document, expectedRevision: null }),
        headers: { "content-type": "application/json", origin: CONFIGURED_ORIGIN },
        method: "PUT",
      }),
      context,
    );
    expect(unauthenticated.status).toBe(401);
    expect((await putPersistedKart(makeRequest(), context)).status).toBe(403);

    await db.insert(userRoles).values({ role: "admin", userId: savedUser.id });
    const injectedSnapshotResponse = await putPersistedKart(
      new Request(`${TEST_ORIGIN}/api/admin/karts/${kartId}`, {
        body: JSON.stringify({
          document,
          expectedRevision: null,
          resolvedSnapshot: { playerStats: { speed: 100 } },
        }),
        headers: new Headers([
          ...headers.entries(),
          ["content-type", "application/json"],
          ["origin", CONFIGURED_ORIGIN],
        ]),
        method: "PUT",
      }),
      context,
    );
    expect(injectedSnapshotResponse.status).toBe(400);
    expect(
      (await putPersistedKart(makeRequest(document, "https://malicious.example"), context))
        .status,
    ).toBe(403);
    expect((await putPersistedKart(makeRequest(document, CONFIGURED_ORIGIN, "text/plain"), context)).status).toBe(415);

    const invalidDocument = structuredClone(document);
    invalidDocument.connections = [];
    const invalidResponse = await putPersistedKart(
      makeRequest(invalidDocument),
      context,
    );
    expect(invalidResponse.status).toBe(400);
    await expect(invalidResponse.json()).resolves.toMatchObject({
      error: "Kart assembly validation failed.",
      issues: expect.any(Array),
    });

    await expect(db.select().from(karts).where(eq(karts.id, kartId))).resolves.toEqual([]);
    const created = await putPersistedKart(makeRequest(), context);
    expect(created.status).toBe(201);
    await expect(created.json()).resolves.toMatchObject({
      ownerUserId: savedUser.id,
      publication: null,
      revision: 1,
    });

    const loaded = await getPersistedKart(
      new Request(`${TEST_ORIGIN}/api/admin/karts/${kartId}`, { headers }),
      context,
    );
    expect(loaded.status).toBe(200);
    await expect(loaded.json()).resolves.toMatchObject({ kartId, revision: 1 });
  });

  test("publishes and unpublishes through immutable optimistic events", async () => {
    const authContext = await testAuth.$context;
    const savedUser = await authContext.test.saveUser(
      authContext.test.createUser({
        email: `${randomUUID()}@example.invalid`,
        name: "Kart Publisher",
      }),
    );
    await db.insert(userRoles).values({ role: "admin", userId: savedUser.id });
    const kartId = `publication-${randomUUID()}`;
    const firstDocument = createValidKartAssembly({ kartId });
    await saveKartRevision({
      authorUserId: savedUser.id,
      document: firstDocument,
      expectedRevision: null,
      ownerUserId: savedUser.id,
    });
    await saveKartRevision({
      authorUserId: savedUser.id,
      document: { ...structuredClone(firstDocument), name: "Second Draft" },
      expectedRevision: 1,
      ownerUserId: savedUser.id,
    });

    const nonAdmin = await authContext.test.saveUser(
      authContext.test.createUser({
        email: `${randomUUID()}@example.invalid`,
        name: "Non Admin Kart Publisher",
      }),
    );
    const { headers: nonAdminHeaders } = await authContext.test.login({
      userId: nonAdmin.id,
    });
    const { headers } = await authContext.test.login({ userId: savedUser.id });
    const context = { params: Promise.resolve({ kartId }) };
    const request = (
      payload: unknown,
      requestHeaders: Headers = headers,
      origin = CONFIGURED_ORIGIN,
      contentType = "application/json",
    ) =>
      new Request(`${TEST_ORIGIN}/api/admin/karts/${kartId}/publication`, {
        body: JSON.stringify(payload),
        headers: new Headers([
          ...requestHeaders.entries(),
          ["content-type", contentType],
          ["origin", origin],
        ]),
        method: "POST",
      });
    const publishPayload = {
      action: "publish",
      expectedPublicationEventId: null,
      revision: 1,
    };

    const initialStatus = await getKartPublication(
      new Request(`${TEST_ORIGIN}/api/admin/karts/${kartId}/publication`, { headers }),
      context,
    );
    await expect(initialStatus.json()).resolves.toEqual({ publication: null });
    expect(
      (await getPublishedKart(new Request(`${TEST_ORIGIN}/api/karts/${kartId}/published`), context)).status,
    ).toBe(404);

    expect(
      (await postKartPublication(request(publishPayload, new Headers()), context))
        .status,
    ).toBe(401);
    expect(
      (await postKartPublication(request(publishPayload, nonAdminHeaders), context))
        .status,
    ).toBe(403);
    expect(
      (
        await postKartPublication(
          request(publishPayload, headers, "https://malicious.example"),
          context,
        )
      ).status,
    ).toBe(403);
    expect(
      (
        await postKartPublication(
          request(publishPayload, headers, CONFIGURED_ORIGIN, "text/plain"),
          context,
        )
      ).status,
    ).toBe(415);
    await expect(
      db
        .select()
        .from(kartPublicationEvents)
        .where(eq(kartPublicationEvents.kartId, kartId)),
    ).resolves.toEqual([]);

    const firstResponse = await postKartPublication(
      request(publishPayload),
      context,
    );
    expect(firstResponse.status).toBe(201);
    const firstEvent = (await firstResponse.json()) as { eventId: number };

    const publishedResponse = await getPublishedKart(
      new Request(`${TEST_ORIGIN}/api/karts/${kartId}/published`),
      context,
    );
    expect(publishedResponse.status).toBe(200);
    expect(publishedResponse.headers.get("cache-control")).toBe("no-store");
    const publishedPayload = await publishedResponse.json();
    expect(publishedPayload).toMatchObject({
      document: { name: firstDocument.name },
      kartId,
      revision: 1,
    });
    expect(publishedPayload).not.toHaveProperty("authorUserId");
    expect(publishedPayload).not.toHaveProperty("ownerUserId");
    expect(publishedPayload).not.toHaveProperty("actorUserId");

    const competing = await Promise.allSettled([
      publishKartRevision({
        actorUserId: savedUser.id,
        expectedPublicationEventId: firstEvent.eventId,
        kartId,
        revision: 2,
      }),
      unpublishKart({
        actorUserId: savedUser.id,
        expectedPublicationEventId: firstEvent.eventId,
        kartId,
      }),
    ]);
    expect(competing.filter(({ status }) => status === "fulfilled")).toHaveLength(1);
    expect(competing.find(({ status }) => status === "rejected")).toMatchObject({
      reason: expect.any(KartPublicationConflictError),
      status: "rejected",
    });

    const latest = await loadLatestKartPublicationEvent(kartId);
    expect(latest?.eventId).toBeGreaterThan(firstEvent.eventId);
    if (latest?.action === "publish") {
      await unpublishKart({
        actorUserId: savedUser.id,
        expectedPublicationEventId: latest.eventId,
        kartId,
      });
    }
    await expect(loadPublishedKartRevision(kartId)).resolves.toBeNull();

    let immutableEventError: unknown;
    try {
      await db.execute(
        sql`delete from ${kartPublicationEvents} where ${kartPublicationEvents.kartId} = ${kartId}`,
      );
    } catch (error) {
      immutableEventError = error;
    }
    expect(immutableEventError).toBeInstanceOf(Error);
    expect(
      (immutableEventError as Error & { cause?: Error }).cause?.message,
    ).toMatch(/kart publication events are immutable/);
  });

  test("publishes intact version-one evidence with a verifiable hash", async () => {
    const userId = randomUUID();
    const kartId = `legacy-publication-${randomUUID()}`;
    const document = createValidKartAssembly({ kartId });
    const resolvedSnapshot = createLegacyResolvedSnapshot(document);
    const resolvedSnapshotHash = await hashResolvedKartSnapshot(resolvedSnapshot);
    await db.insert(users).values({
      email: `${userId}@example.invalid`,
      emailVerified: true,
      id: userId,
      name: "Legacy Kart Publisher",
    });
    await db.insert(karts).values({
      createdByUserId: userId,
      currentRevision: 1,
      id: kartId,
      ownerUserId: userId,
    });
    await db.insert(kartRevisions).values({
      authorUserId: userId,
      derivationVersion: 1,
      document,
      id: randomUUID(),
      kartId,
      resolvedSnapshot,
      resolvedSnapshotHash,
      revision: 1,
      schemaVersion: document.schemaVersion,
    });
    await db.insert(kartPublicationEvents).values({
      action: "publish",
      actorUserId: userId,
      kartId,
      revision: 1,
    });

    const response = await getPublishedKart(
      new Request(`${TEST_ORIGIN}/api/karts/${kartId}/published`),
      { params: Promise.resolve({ kartId }) },
    );
    expect(response.status).toBe(200);
    const payload = await response.json();
    expect(parseResolvedKartSnapshot(payload.resolvedSnapshot)).toEqual(
      resolvedSnapshot,
    );
    expect(payload.resolvedSnapshotHash).toBe(resolvedSnapshotHash);
    await expect(
      hashResolvedKartSnapshot(payload.resolvedSnapshot),
    ).resolves.toBe(payload.resolvedSnapshotHash);
  });
});

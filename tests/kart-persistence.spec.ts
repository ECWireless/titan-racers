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
import {
  GET as getAdminKartThumbnail,
  PUT as putAdminKartThumbnail,
} from "../src/app/api/admin/karts/[kartId]/revisions/[revision]/thumbnail/route";
import { GET as getPublishedKart } from "../src/app/api/karts/[kartId]/published/route";
import { GET as getPublishedKartThumbnail } from "../src/app/api/karts/[kartId]/thumbnail/route";
import { db } from "../src/db/client";
import {
  kartPublicationEvents,
  kartRevisionThumbnails,
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
import { createBalancedKartDocument } from "../src/game/kart/balanced-kart-document";
import { kartAssemblyDocumentV1Schema } from "../src/game/kart/kart-assembly-document";
import {
  KartConflictError,
  KartPublicationConflictError,
  KartThumbnailConflictError,
  loadKartRevisionThumbnail,
  loadLatestKartPublicationEvent,
  loadLatestKartRevision,
  loadPublishedKartRevision,
  publishKartRevision,
  saveKartRevision,
  saveKartRevisionThumbnail,
  unpublishKart,
} from "../src/server/kart-repository";
import { createValidKartAssembly } from "./support/kart-assembly";
import { createTestPng } from "./support/png";
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

function createLegacyKartAssemblyDocument(
  document: ReturnType<typeof createValidKartAssembly>,
) {
  return kartAssemblyDocumentV1Schema.parse({
    ...document,
    componentInstances: document.componentInstances.map(
      ({ visualColor, ...instance }) => {
        void visualColor;
        return instance;
      },
    ),
    primitiveInstances: document.primitiveInstances.map(
      ({ visualColor, ...instance }) => {
        void visualColor;
        return instance;
      },
    ),
    schemaVersion: 1,
  });
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
      schemaVersion: 2,
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
        schemaVersion: 2,
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
        schemaVersion: 2,
      },
    ]);

    await expect(loadLatestKartRevision(malformedKartId)).rejects.toThrow();
    await expect(loadLatestKartRevision(mismatchedKartId)).rejects.toThrow(
      "Persisted kart derivation evidence hash does not match.",
    );
  });

  test("binds immutable thumbnails to saved and published revisions", async () => {
    const userId = randomUUID();
    const kartId = `thumbnail-${randomUUID()}`;
    await db.insert(users).values({
      email: `${userId}@example.invalid`,
      emailVerified: true,
      id: userId,
      name: "Thumbnail Test",
    });
    const firstDocument = createValidKartAssembly({ kartId });
    const firstRevision = await saveKartRevision({
      authorUserId: userId,
      document: firstDocument,
      expectedRevision: null,
      ownerUserId: userId,
    });
    expect(firstRevision.thumbnailAvailable).toBe(false);
    const firstImage = createTestPng({ marker: 1 });
    const firstThumbnail = await saveKartRevisionThumbnail({
      contentType: "image/png",
      generatedByUserId: userId,
      imageData: firstImage,
      kartId,
      renderVersion: 1,
      revision: 1,
    });
    expect(firstThumbnail.imageSha256).toMatch(/^[0-9a-f]{64}$/);
    await expect(
      saveKartRevisionThumbnail({
        contentType: "image/png",
        generatedByUserId: userId,
        imageData: firstImage,
        kartId,
        renderVersion: 1,
        revision: 1,
      }),
    ).resolves.toMatchObject({ imageSha256: firstThumbnail.imageSha256 });
    await expect(
      saveKartRevisionThumbnail({
        contentType: "image/png",
        generatedByUserId: userId,
        imageData: createTestPng({ marker: 9 }),
        kartId,
        renderVersion: 1,
        revision: 1,
      }),
    ).rejects.toBeInstanceOf(KartThumbnailConflictError);

    const secondDocument = structuredClone(firstDocument);
    secondDocument.name = "Thumbnail Revision Two";
    await saveKartRevision({
      authorUserId: userId,
      document: secondDocument,
      expectedRevision: 1,
      ownerUserId: userId,
    });
    const secondImage = createTestPng({ marker: 2 });
    await saveKartRevisionThumbnail({
      contentType: "image/png",
      generatedByUserId: userId,
      imageData: secondImage,
      kartId,
      renderVersion: 1,
      revision: 2,
    });
    await expect(loadLatestKartRevision(kartId)).resolves.toMatchObject({
      revision: 2,
      thumbnailAvailable: true,
    });
    await expect(loadKartRevisionThumbnail(kartId, 1)).resolves.toMatchObject({
      imageData: firstImage,
      revision: 1,
    });

    const firstPublication = await publishKartRevision({
      actorUserId: userId,
      expectedPublicationEventId: null,
      kartId,
      revision: 1,
    });
    const firstResponse = await getPublishedKartThumbnail(
      new Request(`${TEST_ORIGIN}/api/karts/${kartId}/thumbnail?revision=1`),
      { params: Promise.resolve({ kartId }) },
    );
    expect(Buffer.from(await firstResponse.arrayBuffer())).toEqual(firstImage);

    await publishKartRevision({
      actorUserId: userId,
      expectedPublicationEventId: firstPublication.eventId,
      kartId,
      revision: 2,
    });
    const staleResponse = await getPublishedKartThumbnail(
      new Request(`${TEST_ORIGIN}/api/karts/${kartId}/thumbnail?revision=1`),
      { params: Promise.resolve({ kartId }) },
    );
    expect(staleResponse.status).toBe(404);
    const secondResponse = await getPublishedKartThumbnail(
      new Request(`${TEST_ORIGIN}/api/karts/${kartId}/thumbnail?revision=2`),
      { params: Promise.resolve({ kartId }) },
    );
    expect(Buffer.from(await secondResponse.arrayBuffer())).toEqual(secondImage);

    let immutableThumbnailError: unknown;
    try {
      await db.execute(
        sql`update ${kartRevisionThumbnails} set "render_version" = 2 where ${kartRevisionThumbnails.imageSha256} = ${firstThumbnail.imageSha256}`,
      );
    } catch (error) {
      immutableThumbnailError = error;
    }
    expect(immutableThumbnailError).toBeInstanceOf(Error);
    expect(
      (immutableThumbnailError as Error & { cause?: Error }).cause?.message,
    ).toMatch(/kart revision thumbnails are immutable/);
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
      expectedRevision: number | null = null,
    ) =>
      new Request(`${TEST_ORIGIN}/api/admin/karts/${kartId}`, {
        body: JSON.stringify({
          document: requestDocument,
          expectedRevision,
        }),
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
    expect(
      (
        await putPersistedKart(
          makeRequest(document, CONFIGURED_ORIGIN, "application/json", 0),
          context,
        )
      ).status,
    ).toBe(400);

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
    const firstDocument = createBalancedKartDocument(kartId);
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
    const asymmetricDocument = structuredClone(firstDocument);
    const upperHousing = asymmetricDocument.primitiveInstances.find(
      ({ id }) => id === "upper-housing",
    );
    const upperHousingMount = asymmetricDocument.structuralAttachments.find(
      ({ child }) => child.instanceId === "upper-housing",
    );
    if (!upperHousing || !upperHousingMount) {
      throw new Error("Kart publication fixture is missing its upper housing.");
    }
    upperHousing.transform.position.x += 0.01;
    upperHousingMount.parent.anchor.x += 0.01;
    expect(
      deriveKartSnapshot(asymmetricDocument).massProperties.inertiaTensor.xy,
    ).not.toBe(0);
    await saveKartRevision({
      authorUserId: savedUser.id,
      document: asymmetricDocument,
      expectedRevision: 2,
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
      request({ ...publishPayload, revision: 3 }),
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
      document: { name: asymmetricDocument.name },
      kartId,
      revision: 3,
    });
    expect(publishedPayload).not.toHaveProperty("authorUserId");
    expect(publishedPayload).not.toHaveProperty("ownerUserId");
    expect(publishedPayload).not.toHaveProperty("actorUserId");
    await expect(loadPublishedKartRevision(kartId)).resolves.toMatchObject({
      authorUsername: expect.stringMatching(/^test_/),
    });

    const incompleteAuthorId = randomUUID();
    const fallbackKartId = `unclaimed-author-${randomUUID()}`;
    await db.insert(users).values({
      email: `${incompleteAuthorId}@example.invalid`,
      emailVerified: true,
      id: incompleteAuthorId,
      name: "unclaimed_author",
    });
    await saveKartRevision({
      authorUserId: incompleteAuthorId,
      document: createBalancedKartDocument(fallbackKartId),
      expectedRevision: null,
      ownerUserId: savedUser.id,
    });
    await publishKartRevision({
      actorUserId: savedUser.id,
      expectedPublicationEventId: null,
      kartId: fallbackKartId,
      revision: 1,
    });
    await expect(loadPublishedKartRevision(fallbackKartId)).resolves.toMatchObject({
      authorUsername: null,
    });

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

  test("protects bounded revision thumbnail upload and retrieval", async () => {
    const authContext = await testAuth.$context;
    const savedUser = await authContext.test.saveUser(
      authContext.test.createUser({
        email: `${randomUUID()}@example.invalid`,
        name: "Kart Thumbnail Admin",
      }),
    );
    await db.insert(userRoles).values({ role: "admin", userId: savedUser.id });
    const { headers } = await authContext.test.login({ userId: savedUser.id });
    const kartId = `thumbnail-api-${randomUUID()}`;
    await saveKartRevision({
      authorUserId: savedUser.id,
      document: createValidKartAssembly({ kartId }),
      expectedRevision: null,
      ownerUserId: savedUser.id,
    });
    const context = {
      params: Promise.resolve({ kartId, revision: "1" }),
    };
    const imageData = createTestPng({ marker: 7 });
    const body = JSON.stringify({
      contentType: "image/png",
      data: imageData.toString("base64"),
      renderVersion: 1,
    });
    const request = (
      requestHeaders: HeadersInit,
      requestBody = body,
      contentType = "application/json",
    ) =>
      new Request(
        `${TEST_ORIGIN}/api/admin/karts/${kartId}/revisions/1/thumbnail`,
        {
          body: requestBody,
          headers: new Headers([
            ...new Headers(requestHeaders).entries(),
            ["content-type", contentType],
            ["origin", CONFIGURED_ORIGIN],
          ]),
          method: "PUT",
        },
      );

    const unauthorizedUpload = await putAdminKartThumbnail(
      request({}),
      context,
    );
    expect(unauthorizedUpload.status).toBe(401);
    expect(unauthorizedUpload.headers.get("cache-control")).toBe("no-store");

    const missingThumbnail = await getAdminKartThumbnail(
      new Request(
        `${TEST_ORIGIN}/api/admin/karts/${kartId}/revisions/1/thumbnail`,
        { headers },
      ),
      context,
    );
    expect(missingThumbnail.status).toBe(404);
    expect(missingThumbnail.headers.get("cache-control")).toBe("no-store");

    const invalidTarget = await getAdminKartThumbnail(
      new Request(
        `${TEST_ORIGIN}/api/admin/karts/${kartId}/revisions/invalid/thumbnail`,
        { headers },
      ),
      {
        params: Promise.resolve({ kartId, revision: "invalid" }),
      },
    );
    expect(invalidTarget.status).toBe(400);
    expect(invalidTarget.headers.get("cache-control")).toBe("no-store");
    const foreignOriginHeaders = new Headers([
      ...headers.entries(),
      ["content-type", "application/json"],
      ["origin", "https://malicious.example"],
    ]);
    const foreignOriginUpload = await putAdminKartThumbnail(
      new Request(
        `${TEST_ORIGIN}/api/admin/karts/${kartId}/revisions/1/thumbnail`,
        { body, headers: foreignOriginHeaders, method: "PUT" },
      ),
      context,
    );
    expect(foreignOriginUpload.status).toBe(403);
    expect(foreignOriginUpload.headers.get("cache-control")).toBe("no-store");

    const unsupportedMediaUpload = await putAdminKartThumbnail(
      request(headers, body, "text/plain"),
      context,
    );
    expect(unsupportedMediaUpload.status).toBe(415);
    expect(unsupportedMediaUpload.headers.get("cache-control")).toBe(
      "no-store",
    );
    const invalidUpload = await putAdminKartThumbnail(
      request(
        headers,
        JSON.stringify({
          contentType: "image/png",
          data: createTestPng({
            height: 180,
            marker: 8,
            width: 320,
          }).toString("base64"),
          renderVersion: 1,
        }),
      ),
      context,
    );
    expect(invalidUpload.status).toBe(400);
    expect(invalidUpload.headers.get("cache-control")).toBe("no-store");

    const missingRevisionUpload = await putAdminKartThumbnail(
      request(headers),
      {
        params: Promise.resolve({ kartId, revision: "2" }),
      },
    );
    expect(missingRevisionUpload.status).toBe(404);
    expect(missingRevisionUpload.headers.get("cache-control")).toBe("no-store");

    const created = await putAdminKartThumbnail(request(headers), context);
    expect(created.status).toBe(201);
    expect(created.headers.get("cache-control")).toBe("no-store");
    const conflict = await putAdminKartThumbnail(
      request(
        headers,
        JSON.stringify({
          contentType: "image/png",
          data: createTestPng({ marker: 9 }).toString("base64"),
          renderVersion: 1,
        }),
      ),
      context,
    );
    expect(conflict.status).toBe(409);
    expect(conflict.headers.get("cache-control")).toBe("no-store");
    const loaded = await getAdminKartThumbnail(
      new Request(
        `${TEST_ORIGIN}/api/admin/karts/${kartId}/revisions/1/thumbnail`,
        { headers },
      ),
      context,
    );
    expect(loaded.status).toBe(200);
    expect(loaded.headers.get("cache-control")).toBe("no-store");
    expect(Buffer.from(await loaded.arrayBuffer())).toEqual(imageData);
    const unauthorizedLoad = await getAdminKartThumbnail(
      new Request(
        `${TEST_ORIGIN}/api/admin/karts/${kartId}/revisions/1/thumbnail`,
      ),
      context,
    );
    expect(unauthorizedLoad.status).toBe(401);
    expect(unauthorizedLoad.headers.get("cache-control")).toBe("no-store");
  });

  test("migrates a version-one document while preserving verifiable evidence", async () => {
    const userId = randomUUID();
    const kartId = `legacy-publication-${randomUUID()}`;
    const currentDocument = createValidKartAssembly({ kartId });
    const document = createLegacyKartAssemblyDocument(currentDocument);
    const resolvedSnapshot = createLegacyResolvedSnapshot(currentDocument);
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
      schemaVersion: 1,
    });
    await db.insert(kartPublicationEvents).values({
      action: "publish",
      actorUserId: userId,
      kartId,
      revision: 1,
    });

    const latestRevision = await loadLatestKartRevision(kartId);
    expect(latestRevision?.schemaVersion).toBe(2);
    expect(latestRevision?.document.schemaVersion).toBe(2);
    expect(
      latestRevision?.document.componentInstances.find(
        ({ id }) => id === "wheel-front-left",
      )?.visualColor,
    ).toBe("#203040");
    expect(
      latestRevision?.document.componentInstances.find(
        ({ id }) => id === "suspension-front-left",
      )?.visualColor,
    ).toBe("#ff9e14");
    expect(
      latestRevision?.document.primitiveInstances.find(
        ({ id }) => id === "upper-housing",
      )?.visualColor,
    ).toBe("#203040");
    const response = await getPublishedKart(
      new Request(`${TEST_ORIGIN}/api/karts/${kartId}/published`),
      { params: Promise.resolve({ kartId }) },
    );
    expect(response.status).toBe(200);
    const payload = await response.json();
    expect(payload.schemaVersion).toBe(2);
    expect(payload.document.schemaVersion).toBe(2);
    expect(
      payload.document.componentInstances.find(
        ({ id }: { id: string }) => id === "battery-main",
      ).visualColor,
    ).toBe("#475763");
    expect(parseResolvedKartSnapshot(payload.resolvedSnapshot)).toEqual(
      resolvedSnapshot,
    );
    expect(payload.resolvedSnapshotHash).toBe(resolvedSnapshotHash);
    await expect(
      hashResolvedKartSnapshot(payload.resolvedSnapshot),
    ).resolves.toBe(payload.resolvedSnapshotHash);
  });
});

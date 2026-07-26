import { expect, test } from "@playwright/test";

import { createOfficialKartRosterResponse } from "../src/app/api/karts/official/route";
import { createBalancedKartDocument } from "../src/game/kart/balanced-kart-document";
import { createHandlingKartDocument } from "../src/game/kart/handling-kart-document";
import {
  deriveKartSnapshot,
  hashResolvedKartSnapshot,
} from "../src/game/kart/kart-derivation";
import {
  createOfficialKartRosterDocuments,
  OFFICIAL_KART_FALLBACK_ASSEMBLER_CREDIT,
  OFFICIAL_KART_IDS,
  officialKartRosterSchema,
  type OfficialKartId,
} from "../src/game/kart/official-kart-roster";
import type { PersistedPublishedKartRevision } from "../src/server/kart-repository";
import {
  loadOfficialKartRoster,
  type OfficialKartPublicationLoader,
} from "../src/server/official-kart-roster";

async function createPublishedRevision(
  document:
    | ReturnType<typeof createBalancedKartDocument>
    | ReturnType<typeof createHandlingKartDocument>,
  authorName: string,
): Promise<PersistedPublishedKartRevision> {
  const resolvedSnapshot = deriveKartSnapshot(document);
  return {
    authorName,
    authorUserId: "private-author-id",
    createdAt: new Date("2026-07-26T12:00:00.000Z"),
    derivationVersion: resolvedSnapshot.derivationVersion,
    document,
    kartId: document.kartId,
    ownerUserId: "private-owner-id",
    publication: {
      action: "publish",
      actorUserId: "private-actor-id",
      eventId: 7,
      kartId: document.kartId,
      occurredAt: new Date("2026-07-26T12:30:00.000Z"),
      revision: 1,
    },
    resolvedSnapshot,
    resolvedSnapshotHash: await hashResolvedKartSnapshot(resolvedSnapshot),
    revision: 1,
    schemaVersion: document.schemaVersion,
  };
}

test("exposes only published official revisions in stable roster order", async () => {
  const balanced = await createPublishedRevision(
    createBalancedKartDocument(),
    "  Kart Assembler  ",
  );
  const handling = await createPublishedRevision(
    createHandlingKartDocument(),
    "H".repeat(100),
  );
  const publications = new Map<OfficialKartId, PersistedPublishedKartRevision>([
    [balanced.kartId as OfficialKartId, balanced],
    [handling.kartId as OfficialKartId, handling],
  ]);

  const roster = await loadOfficialKartRoster(async (kartId) => {
    return publications.get(kartId) ?? null;
  });

  expect(roster.source).toBe("published");
  if (roster.source !== "published") {
    throw new Error("Expected a persistence-backed official roster.");
  }
  expect(roster.karts.map(({ runtime }) => runtime.kartId)).toEqual([
    "balanced-kart",
    "handling-kart",
  ]);
  expect(roster.karts.map(({ assemblerCredit }) => assemblerCredit)).toEqual([
    "Kart Assembler",
    "H".repeat(80),
  ]);
  expect(roster.karts[0].runtime.publishedAt).toBe(
    "2026-07-26T12:30:00.000Z",
  );
  expect(JSON.stringify(roster)).not.toContain("private-author-id");
  expect(JSON.stringify(roster)).not.toContain("private-owner-id");
  expect(JSON.stringify(roster)).not.toContain("private-actor-id");

  const blankCreditRoster = await loadOfficialKartRoster(async (kartId) =>
    kartId === "balanced-kart" ? { ...balanced, authorName: "   " } : null,
  );
  expect(blankCreditRoster.source).toBe("published");
  if (blankCreditRoster.source !== "published") {
    throw new Error("Expected a published official roster.");
  }
  expect(blankCreditRoster.karts[0].assemblerCredit).toBe(
    OFFICIAL_KART_FALLBACK_ASSEMBLER_CREDIT,
  );
});

test("does not restore intentionally unpublished entries from fallback", async () => {
  const loader: OfficialKartPublicationLoader = async () => null;
  const roster = await loadOfficialKartRoster(loader);

  expect(roster).toEqual({ karts: [], source: "published" });
});

test("returns the validated bundled roster when persistence is unavailable", async () => {
  const roster = await loadOfficialKartRoster(async () => {
    throw new Error("Persistence unavailable.");
  });

  expect(roster.source).toBe("bundled-fallback");
  if (roster.source !== "bundled-fallback") {
    throw new Error("Expected the bundled official roster.");
  }
  expect(roster.karts.map(({ kartId }) => kartId)).toEqual(OFFICIAL_KART_IDS);
  expect(
    roster.karts.every(
      ({ assemblerCredit }) =>
        assemblerCredit === OFFICIAL_KART_FALLBACK_ASSEMBLER_CREDIT,
    ),
  ).toBe(true);
  expect(roster.karts.map(({ document }) => document)).toEqual(
    createOfficialKartRosterDocuments(),
  );
  for (const entry of roster.karts) {
    expect(entry.resolvedSnapshot).toEqual(deriveKartSnapshot(entry.document));
  }
  expect(officialKartRosterSchema.parse(roster)).toEqual(roster);
});

test("serves the roster without caching", async () => {
  const roster = await loadOfficialKartRoster(async () => null);
  const response = await createOfficialKartRosterResponse(async () => roster);

  expect(response.status).toBe(200);
  expect(response.headers.get("cache-control")).toBe("no-store");
  await expect(response.json()).resolves.toEqual(roster);
});

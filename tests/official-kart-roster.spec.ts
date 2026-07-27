import { expect, test } from "@playwright/test";

import {
  BALANCED_KART_ID,
  createBalancedKartDocument,
} from "../src/game/kart/balanced-kart-document";
import {
  createHandlingKartDocument,
  HANDLING_KART_ID,
} from "../src/game/kart/handling-kart-document";
import { validateKartAssembly } from "../src/game/kart/kart-assembly-validation";
import { deriveKartSnapshot } from "../src/game/kart/kart-derivation";
import {
  createOfficialKartDocument,
  createOfficialKartRosterDocuments,
  OFFICIAL_KART_IDS,
  type OfficialKartId,
} from "../src/game/kart/official-kart-roster";
import {
  createSpeedKartDocument,
  SPEED_KART_ID,
} from "../src/game/kart/speed-kart-document";

const expectedSpecialization = {
  [BALANCED_KART_ID]: {
    suspension: "suspension.firm-short",
    transmission: "transmission.balanced-5to1",
    wheel: "wheel-tire.small-standard",
  },
  [HANDLING_KART_ID]: {
    suspension: "suspension.compliant-long",
    transmission: "transmission.short-8to1",
    wheel: "wheel-tire.small-standard",
  },
  [SPEED_KART_ID]: {
    suspension: "suspension.firm-short",
    transmission: "transmission.tall-4to1",
    wheel: "wheel-tire.large-standard",
  },
} as const;

function componentDefinition(
  document: ReturnType<typeof createBalancedKartDocument>,
  instanceId: string,
) {
  return document.componentInstances.find(({ id }) => id === instanceId)
    ?.definition.id;
}

test("ships three fresh deterministic official kart assemblies", () => {
  const first = createOfficialKartRosterDocuments();
  const second = createOfficialKartRosterDocuments();

  expect(OFFICIAL_KART_IDS).toEqual([
    BALANCED_KART_ID,
    SPEED_KART_ID,
    HANDLING_KART_ID,
  ]);
  expect(Object.isFrozen(OFFICIAL_KART_IDS)).toBe(true);
  expect(first.map(({ kartId }) => kartId)).toEqual(OFFICIAL_KART_IDS);
  expect(new Set(first.map(({ name }) => name))).toHaveProperty("size", 3);
  expect(new Set(first.map(({ practicalDescriptor }) => practicalDescriptor)))
    .toHaveProperty("size", 3);
  expect(new Set(first.map(({ visualIdentity }) => visualIdentity.primaryColor)))
    .toHaveProperty("size", 3);
  expect(first).toEqual(second);
  expect(first).not.toBe(second);
  first.forEach((document, index) => {
    expect(document).not.toBe(second[index]);
    const validation = validateKartAssembly(document);
    expect(
      validation.success,
      validation.success
        ? undefined
        : `${document.kartId}: ${JSON.stringify(validation.issues)}`,
    ).toBe(true);
    expect(() => deriveKartSnapshot(document)).not.toThrow();
    expect(document).not.toHaveProperty("massProperties");
    expect(document).not.toHaveProperty("physicalProfile");
    expect(document).not.toHaveProperty("playerStats");
  });
});

test("constructs each specialization from approved component revisions", () => {
  for (const document of createOfficialKartRosterDocuments()) {
    const expected =
      expectedSpecialization[document.kartId as OfficialKartId];
    expect(componentDefinition(document, "transmission-main")).toBe(
      expected.transmission,
    );
    expect(componentDefinition(document, "suspension-front-left")).toBe(
      expected.suspension,
    );
    expect(componentDefinition(document, "wheel-front-left")).toBe(
      expected.wheel,
    );
    expect(
      new Set(
        document.componentInstances
          .filter(({ id }) => id.startsWith("suspension-"))
          .map(({ definition }) => definition.id),
      ),
    ).toEqual(new Set([expected.suspension]));
    expect(
      new Set(
        document.componentInstances
          .filter(({ id }) => id.startsWith("wheel-"))
          .map(({ definition }) => definition.id),
      ),
    ).toEqual(new Set([expected.wheel]));
    for (const instance of document.componentInstances) {
      expect(instance.definition.version).toBe(
        document.kartId === HANDLING_KART_ID &&
          instance.definition.id === "suspension.compliant-long"
          ? 2
          : 1,
      );
    }
  }
});

test("derives the intended official kart tradeoffs without stat overrides", () => {
  const balanced = deriveKartSnapshot(createBalancedKartDocument());
  const handling = deriveKartSnapshot(createHandlingKartDocument());
  const speed = deriveKartSnapshot(createSpeedKartDocument());
  const acceleration = (snapshot: typeof balanced) =>
    snapshot.physicalProfile.drivetrain.maximumDriveForce /
    snapshot.massProperties.totalMass;

  expect({
    balanced: balanced.playerStats,
    handling: handling.playerStats,
    speed: speed.playerStats,
  }).toEqual({
    balanced: { acceleration: 42, handling: 57, speed: 41, stability: 42 },
    handling: { acceleration: 92, handling: 81, speed: 10, stability: 52 },
    speed: { acceleration: 13, handling: 1, speed: 88, stability: 20 },
  });
  expect({
    balanced: {
      trackWidth: balanced.geometry.trackWidth,
      wheelbase: balanced.geometry.wheelbase,
      wheelRadius: balanced.geometry.wheelStations[0].radius,
    },
    handling: {
      trackWidth: handling.geometry.trackWidth,
      wheelbase: handling.geometry.wheelbase,
      wheelRadius: handling.geometry.wheelStations[0].radius,
    },
    speed: {
      trackWidth: speed.geometry.trackWidth,
      wheelbase: speed.geometry.wheelbase,
      wheelRadius: speed.geometry.wheelStations[0].radius,
    },
  }).toEqual({
    balanced: { trackWidth: 0.39, wheelbase: 0.3, wheelRadius: 0.058 },
    handling: { trackWidth: 0.42, wheelbase: 0.28, wheelRadius: 0.058 },
    speed: { trackWidth: 0.36, wheelbase: 0.34, wheelRadius: 0.0725 },
  });
  expect(
    new Set(
      [balanced, handling, speed].map(
        ({ massProperties }) => massProperties.totalMass,
      ),
    ),
  ).toHaveProperty("size", 3);
  for (const snapshot of [balanced, handling, speed]) {
    for (const station of snapshot.geometry.wheelStations) {
      expect(station.suspension.restWheelCompression).toBeLessThan(
        station.suspension.bumpStartWheelCompression,
      );
      expect(
        station.suspension.maximumWheelTravel -
          station.suspension.restWheelCompression,
      ).toBeGreaterThan(0.01);
    }
  }

  expect(acceleration(handling)).toBeGreaterThan(acceleration(balanced));
  expect(acceleration(balanced)).toBeGreaterThan(acceleration(speed));
  expect(speed.physicalProfile.drivetrain.noLoadSpeed).toBeGreaterThan(
    balanced.physicalProfile.drivetrain.noLoadSpeed,
  );
  expect(balanced.physicalProfile.drivetrain.noLoadSpeed).toBeGreaterThan(
    handling.physicalProfile.drivetrain.noLoadSpeed,
  );
  expect(handling.playerStats.handling).toBeGreaterThan(
    balanced.playerStats.handling,
  );
  expect(balanced.playerStats.handling).toBeGreaterThan(
    speed.playerStats.handling,
  );
  expect(handling.playerStats.stability).toBeGreaterThan(
    balanced.playerStats.stability,
  );
  expect(handling.physicalProfile.suspension.damperRate).toBe(12);
  expect(balanced.playerStats.stability).toBeGreaterThan(
    speed.playerStats.stability,
  );
});

test("supports protected draft IDs without changing official construction", () => {
  const cases = [
    [createBalancedKartDocument, BALANCED_KART_ID],
    [createSpeedKartDocument, SPEED_KART_ID],
    [createHandlingKartDocument, HANDLING_KART_ID],
  ] as const;

  for (const [createDocument, officialId] of cases) {
    const draft = createDocument(`${officialId}.draft`);
    const official = createDocument();
    expect(draft.kartId).toBe(`${officialId}.draft`);
    expect({ ...draft, kartId: officialId }).toEqual(official);
  }
});

test("selects the matching starting assembly for every official ID", () => {
  for (const kartId of OFFICIAL_KART_IDS) {
    const document = createOfficialKartDocument(kartId);
    expect(document.kartId).toBe(kartId);
    expect(document).toEqual(
      createOfficialKartRosterDocuments().find(
        (candidate) => candidate.kartId === kartId,
      ),
    );
  }
});

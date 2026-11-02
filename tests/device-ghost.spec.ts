import { expect, test } from "@playwright/test";

import {
  type DeviceGhost,
  keepDeviceGhostIfBest,
  readDeviceGhost,
} from "../src/game/ghost/device-ghost";
import { createBalancedKartDocument } from "../src/game/kart/balanced-kart-document";
import { CURRENT_PHYSICS_VERSION } from "../src/game/physics/physics-version";

class MemoryStorage {
  private readonly items = new Map<string, string>();
  get length() {
    return this.items.size;
  }
  key(index: number) {
    return [...this.items.keys()][index] ?? null;
  }
  getItem(key: string) {
    return this.items.get(key) ?? null;
  }
  setItem(key: string, value: string) {
    this.items.set(key, value);
  }
  removeItem(key: string) {
    this.items.delete(key);
  }
  keys() {
    return [...this.items.keys()].sort();
  }
}

let storage: MemoryStorage;

test.beforeEach(() => {
  storage = new MemoryStorage();
  (globalThis as { window?: unknown }).window = { localStorage: storage };
});

test.afterEach(() => {
  delete (globalThis as { window?: unknown }).window;
});

function ghost(courseRevision: number | null, timeMicroseconds: number): DeviceGhost {
  return {
    courseId: "falls-view-park",
    courseRevision,
    kart: {
      centerOfMass: { x: 0, y: 0.05, z: 0.01 },
      document: createBalancedKartDocument(),
      wheels: [{ id: "wheel-front-left", radius: 0.055, steered: true }],
    },
    samples: [
      {
        gate: false,
        position: { x: 30, y: 0, z: -45 },
        reset: false,
        rotation: { w: 1, x: 0, y: 0, z: 0 },
        steerDegrees: 0,
        timeMicroseconds: 0,
      },
      {
        gate: true,
        position: { x: 31, y: 0, z: -45 },
        reset: false,
        rotation: { w: 1, x: 0, y: 0, z: 0 },
        steerDegrees: 4,
        timeMicroseconds,
      },
    ],
    timeMicroseconds,
  };
}

const key = (revision: string, physics: string = CURRENT_PHYSICS_VERSION) =>
  `titan-racers.ghost.v1:falls-view-park:${revision}:${physics}`;

test("keeps only a faster ghost and reads it back for its own revision", () => {
  expect(readDeviceGhost("falls-view-park", 10)).toBeNull();
  expect(keepDeviceGhostIfBest(ghost(10, 90_000_000))).toBe(true);
  expect(keepDeviceGhostIfBest(ghost(10, 95_000_000))).toBe(false);
  expect(keepDeviceGhostIfBest(ghost(10, 85_000_000))).toBe(true);

  const stored = readDeviceGhost("falls-view-park", 10);
  expect(stored?.timeMicroseconds).toBe(85_000_000);
  expect(stored?.samples.at(-1)).toMatchObject({ gate: true, steerDegrees: expect.closeTo(4, 0) });
  expect(stored?.kart.document.kartId).toBe("balanced-kart");
  expect(readDeviceGhost("falls-view-park", 9)).toBeNull();
  expect(readDeviceGhost("rough-course", 10)).toBeNull();
});

test("a new revision drops older ghosts, but an offline seed race drops none", () => {
  keepDeviceGhostIfBest(ghost(9, 80_000_000));
  keepDeviceGhostIfBest(ghost(null, 99_000_000));
  storage.setItem(key("10", "older-physics-v0"), "{}");
  storage.setItem("titan-racers.ghost.v1:rough-course:3:" + CURRENT_PHYSICS_VERSION, "{}");
  expect(storage.keys()).toHaveLength(4);

  // A best raced on the bundled seed (offline) displaces nothing published.
  keepDeviceGhostIfBest(ghost(null, 70_000_000));
  expect(storage.keys()).toContain(key("9"));
  // ...but other physics never fit.
  expect(storage.keys()).not.toContain(key("10", "older-physics-v0"));

  keepDeviceGhostIfBest(ghost(10, 90_000_000));
  expect(storage.keys()).toEqual(
    [key("10"), "titan-racers.ghost.v1:rough-course:3:" + CURRENT_PHYSICS_VERSION].sort(),
  );
});

test("ignores records that are malformed, tampered, or for another course", () => {
  keepDeviceGhostIfBest(ghost(10, 90_000_000));
  const original = storage.getItem(key("10"))!;
  const tamper = (edit: (record: Record<string, unknown>) => void) => {
    const record = JSON.parse(original);
    edit(record);
    storage.setItem(key("10"), JSON.stringify(record));
    return readDeviceGhost("falls-view-park", 10);
  };

  expect(tamper((record) => (record.timeMicroseconds = 1))).toBeNull();
  expect(tamper((record) => (record.trace = "not a ghost"))).toBeNull();
  expect(tamper((record) => (record.courseRevision = 11))).toBeNull();
  expect(tamper((record) => (record.extra = true))).toBeNull();
  expect(
    tamper((record) => ((record.kart as { document: unknown }).document = { kartId: "x" })),
  ).toBeNull();
  storage.setItem(key("10"), "{not json");
  expect(readDeviceGhost("falls-view-park", 10)).toBeNull();
});

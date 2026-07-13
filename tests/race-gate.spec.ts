import { expect, test } from "@playwright/test";

import {
  crossesDirectedRaceGate,
  type DirectedRaceGate,
} from "../src/game/race/race-gate";

const IDENTITY_GATE: DirectedRaceGate = {
  center: { x: 0, y: 1, z: 0 },
  forward: { x: 1, y: 0, z: 0 },
  halfExtents: { x: 0.5, y: 1, z: 2 },
  id: "gate",
  worldToLocalRotation: { w: 1, x: 0, y: 0, z: 0 },
};

test.describe("directed race gate crossing", () => {
  test.beforeEach(async ({}, testInfo) => {
    test.skip(
      testInfo.project.name !== "desktop",
      "Pure gate coverage only needs to run once.",
    );
  });

  test("accepts a forward swept crossing through the bounded gate", () => {
    expect(
      crossesDirectedRaceGate(
        IDENTITY_GATE,
        { x: -10, y: 1.5, z: 1.5 },
        { x: 10, y: 1.5, z: 1.5 },
      ),
    ).toBe(true);
  });

  test("rejects reverse, same-side, and plane-spawn movement", () => {
    expect(
      crossesDirectedRaceGate(
        IDENTITY_GATE,
        { x: 1, y: 1, z: 0 },
        { x: -1, y: 1, z: 0 },
      ),
    ).toBe(false);
    expect(
      crossesDirectedRaceGate(
        IDENTITY_GATE,
        { x: -2, y: 1, z: 0 },
        { x: -1, y: 1, z: 0 },
      ),
    ).toBe(false);
    expect(
      crossesDirectedRaceGate(
        IDENTITY_GATE,
        { x: 0, y: 1, z: 0 },
        { x: 1, y: 1, z: 0 },
      ),
    ).toBe(false);
  });

  test("rejects crossings outside the finite gate bounds", () => {
    expect(
      crossesDirectedRaceGate(
        IDENTITY_GATE,
        { x: -1, y: 2.1, z: 0 },
        { x: 1, y: 2.1, z: 0 },
      ),
    ).toBe(false);
    expect(
      crossesDirectedRaceGate(
        IDENTITY_GATE,
        { x: -1, y: 1, z: 2.1 },
        { x: 1, y: 1, z: 2.1 },
      ),
    ).toBe(false);
  });

  test("applies the gate rotation before checking bounds", () => {
    const halfSqrt = Math.SQRT1_2;
    const rotatedGate: DirectedRaceGate = {
      ...IDENTITY_GATE,
      forward: { x: 0, y: 0, z: -1 },
      halfExtents: { x: 0.5, y: 1, z: 2 },
      worldToLocalRotation: { w: halfSqrt, x: 0, y: -halfSqrt, z: 0 },
    };

    expect(
      crossesDirectedRaceGate(
        rotatedGate,
        { x: 1.5, y: 1, z: 1 },
        { x: 1.5, y: 1, z: -1 },
      ),
    ).toBe(true);
    expect(
      crossesDirectedRaceGate(
        rotatedGate,
        { x: 2.1, y: 1, z: 1 },
        { x: 2.1, y: 1, z: -1 },
      ),
    ).toBe(false);
  });

  test("rejects non-finite movement samples", () => {
    expect(
      crossesDirectedRaceGate(
        IDENTITY_GATE,
        { x: Number.NaN, y: 1, z: 0 },
        { x: 1, y: 1, z: 0 },
      ),
    ).toBe(false);
  });
});

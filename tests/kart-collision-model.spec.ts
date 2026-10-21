import { expect, test } from "@playwright/test";

import {
  DEFAULT_KART_COLLISION_CONSTRUCTION,
  deriveKartCcdConfiguration,
  KART_COLLISION_SOLVER_POLICY,
  KART_SUBSTEP_POLICY,
  selectKartPhysicsSubsteps,
} from "../src/game/collision/kart-collision-model";

test("derives the accepted CCD configuration from the default envelope", () => {
  expect(
    deriveKartCcdConfiguration(DEFAULT_KART_COLLISION_CONSTRUCTION.envelope),
  ).toEqual({
    motionThreshold: 0.03,
    sweptSphereRadius: 0.04,
  });
});

test("scales the CCD sweep with collision-envelope construction", () => {
  expect(
    deriveKartCcdConfiguration({ smallestRelevantCrossSection: 0.64 }),
  ).toEqual({
    motionThreshold: 0.24,
    sweptSphereRadius: 0.32,
  });
});

test("keeps numerical damping and CCD activation ratios in shared policy", () => {
  expect(KART_COLLISION_SOLVER_POLICY.angularDamping).toBe(0.08);
  expect(
    KART_COLLISION_SOLVER_POLICY.ccdMotionThresholdToRadiusRatio,
  ).toBe(0.75);
});

test("rejects invalid collision-envelope derivation inputs", () => {
  expect(() =>
    deriveKartCcdConfiguration({ smallestRelevantCrossSection: 0 }),
  ).toThrow(/positive cross-section/);
});

test("selects power-of-two substeps that bound per-substep point travel", () => {
  const substepsAt = (linearSpeed: number, angularSpeed = 0) =>
    selectKartPhysicsSubsteps({
      angularSpeed,
      linearSpeed,
      reach: 0.25,
      stepSeconds: 1 / 120,
    });

  expect(substepsAt(0)).toBe(1);
  expect(substepsAt(6)).toBe(1);
  expect(substepsAt(6.1)).toBe(2);
  expect(substepsAt(12)).toBe(2);
  expect(substepsAt(20.4)).toBe(4);
  expect(substepsAt(24.1)).toBe(8);
  expect(substepsAt(500)).toBe(KART_SUBSTEP_POLICY.maximumSubsteps);
  expect(substepsAt(Number.NaN)).toBe(KART_SUBSTEP_POLICY.maximumSubsteps);
  // Spin adds the rim speed of the farthest collider point.
  expect(substepsAt(5, 8)).toBe(2);
});

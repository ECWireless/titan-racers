import { expect, test } from "@playwright/test";

import {
  DEFAULT_KART_COLLISION_CONSTRUCTION,
  deriveKartCcdConfiguration,
  KART_COLLISION_SOLVER_POLICY,
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

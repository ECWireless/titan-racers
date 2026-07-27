import { expect, test } from "@playwright/test";

import {
  calculateCameraStabilizationTarget,
  calculateImpactStrength,
  calculatePlanarHeadingStep,
  calculateSignedSlipDegrees,
  selectStrongerImpact,
  smoothCameraStabilizationBlend,
  smoothFactor,
} from "../src/game/camera/chase-camera";

test("engages camera stabilization for violent spin and severe tilt", () => {
  expect(calculateCameraStabilizationTarget(1, 0)).toBe(0);
  expect(calculateCameraStabilizationTarget(1, 2.5)).toBe(0);
  expect(calculateCameraStabilizationTarget(1, 7)).toBe(1);
  expect(calculateCameraStabilizationTarget(0.7, 0)).toBe(0);
  expect(calculateCameraStabilizationTarget(0.1, 0)).toBe(1);
  expect(calculateCameraStabilizationTarget(-1, 0)).toBe(1);
});

test("caps chase-heading slew across wraparound", () => {
  const almostLeft = {
    x: Math.sin((-179 * Math.PI) / 180),
    y: 0,
    z: -Math.cos((-179 * Math.PI) / 180),
  };
  const almostRight = {
    x: Math.sin((179 * Math.PI) / 180),
    y: 0,
    z: -Math.cos((179 * Math.PI) / 180),
  };

  expect(
    calculatePlanarHeadingStep(almostLeft, almostRight, Math.PI),
  ).toBeCloseTo((-2 * Math.PI) / 180);
  expect(
    calculatePlanarHeadingStep(
      { x: 0, y: 0, z: -1 },
      { x: 1, y: 0, z: 0 },
      Math.PI / 12,
    ),
  ).toBeCloseTo(Math.PI / 12);
  expect(
    calculatePlanarHeadingStep(
      { x: 0, y: 0, z: -1 },
      { x: 1, y: 0, z: 0 },
      -1,
    ),
  ).toBe(0);
});

test("engages stabilization faster than it releases", () => {
  const engaged = smoothCameraStabilizationBlend(0, 1, 0.1);
  const released = smoothCameraStabilizationBlend(1, 0, 0.1);

  expect(engaged).toBeGreaterThan(0.6);
  expect(released).toBeGreaterThan(0.75);
  expect(
    smoothCameraStabilizationBlend(
      smoothCameraStabilizationBlend(0, 1, 1 / 60),
      1,
      1 / 60,
    ),
  ).toBeCloseTo(smoothCameraStabilizationBlend(0, 1, 1 / 30), 10);
});

test("calculates signed planar slip only above the reliable speed", () => {
  expect(
    calculateSignedSlipDegrees(
      { x: 0, y: 0, z: -1 },
      { x: 0.1, y: 0, z: -0.1 },
    ),
  ).toBe(0);
  expect(
    calculateSignedSlipDegrees(
      { x: 0, y: 0, z: -1 },
      { x: 4, y: 0, z: -4 },
    ),
  ).toBeCloseTo(-45);
  expect(
    calculateSignedSlipDegrees(
      { x: 0, y: 0, z: -1 },
      { x: -4, y: 0, z: -4 },
    ),
  ).toBeCloseTo(45);
  expect(
    calculateSignedSlipDegrees(
      { x: 1, y: 0, z: 0 },
      { x: -4, y: 0, z: 0.1 },
    ),
  ).toBe(0);
  expect(
    calculateSignedSlipDegrees(
      { x: 1, y: 0, z: 0 },
      { x: -4, y: 0, z: -0.1 },
    ),
  ).toBe(0);
});

test("bounds impact strength and ignores low-energy contact", () => {
  expect(calculateImpactStrength(3)).toBe(0);
  expect(calculateImpactStrength(8.25)).toBeCloseTo(0.5);
  expect(calculateImpactStrength(30)).toBe(1);
});

test("retains the strongest impact until the render boundary", () => {
  const weaker = {
    approachSpeed: 5,
    id: 2,
    normal: { x: 1, y: 0, z: 0 },
  };
  const stronger = {
    approachSpeed: 12,
    id: 1,
    normal: { x: 0, y: 0, z: 1 },
  };

  expect(selectStrongerImpact(stronger, weaker)).toBe(stronger);
  expect(selectStrongerImpact(weaker, stronger)).toBe(stronger);
  expect(selectStrongerImpact(null, weaker)).toBe(weaker);
});

test("uses delta-time-aware exponential smoothing", () => {
  const oneFrame = smoothFactor(5, 1 / 60);
  const twoFrames = 1 - (1 - oneFrame) ** 2;

  expect(twoFrames).toBeCloseTo(smoothFactor(5, 1 / 30), 10);
  expect(smoothFactor(5, -1)).toBe(0);
});

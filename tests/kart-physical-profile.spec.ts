import { expect, test } from "@playwright/test";

import {
  BALANCED_KART_CONSTRUCTION,
  type KartConstructionDocument,
} from "../src/game/kart/kart-construction";
import { deriveKartPhysicalProfile } from "../src/game/kart/kart-physical-profile";

function cloneBalancedKart(): KartConstructionDocument {
  return structuredClone(
    BALANCED_KART_CONSTRUCTION,
  ) as KartConstructionDocument;
}

test("derives the Balanced Kart baseline deterministically", () => {
  const first = deriveKartPhysicalProfile(BALANCED_KART_CONSTRUCTION);
  const second = deriveKartPhysicalProfile(cloneBalancedKart());

  expect(second).toEqual(first);
  expect(first).toMatchObject({
    derivationVersion: 1,
    drive: {
      acceleration: 9.5,
      brakeDeceleration: 14,
      driveForceNewtons: 1140,
      maximumForwardSpeed: 17,
      maximumReverseSpeed: 17,
      serviceBrakeForceNewtons: 1680,
    },
    grip: {
      peakCoefficient: 1.42,
      rearMultiplier: 1.15,
      slidingCoefficient: 0.98,
    },
    kartId: "balanced-kart",
    mass: { totalKg: 120 },
    statBars: {
      acceleration: 50,
      handling: 50,
      speed: 50,
      stability: 50,
    },
    steering: {
      maximumAngleDegrees: 18,
      minimumHighSpeedAngleDegrees: 6,
    },
    wheels: {
      radius: 0.29,
      trackWidth: 1.56,
      wheelbase: 1.2,
      width: 0.3,
    },
  });
  expect(first.mass.centerOfMass).toEqual({
    x: expect.closeTo(0, 10),
    y: expect.closeTo(-0.005, 10),
    z: expect.closeTo(0.2, 10),
  });
  expect(first.mass.inertiaTensor).toEqual({
    xx: expect.closeTo(37.25, 10),
    xy: expect.closeTo(0, 10),
    xz: expect.closeTo(0, 10),
    yy: expect.closeTo(49.85, 10),
    yz: expect.closeTo(0, 10),
    zz: expect.closeTo(18.65, 10),
  });
  expect(first.bounds).toEqual({
    dimensions: {
      x: 1.86,
      y: expect.closeTo(0.9079120705, 8),
      z: expect.closeTo(1.78, 10),
    },
    maximum: {
      x: 0.93,
      y: expect.closeTo(0.4479120705, 8),
      z: expect.closeTo(0.91, 10),
    },
    minimum: {
      x: -0.93,
      y: expect.closeTo(-0.46, 8),
      z: expect.closeTo(-0.87, 10),
    },
  });
  expect(first.suspension).toEqual({
    bumpRate: 62000,
    bumpStart: 0.17,
    damperRate: 540,
    maximumCompressionY: 0.06,
    maximumLoad: 2500,
    restTravel: 0.23,
    springRate: 9500,
    travel: 0.42,
  });
  expect(first.wheels.mounts).toEqual([
    {
      axle: "front",
      id: "front-left",
      position: { x: -0.78, y: -0.17, z: -0.58 },
      side: "left",
    },
    {
      axle: "front",
      id: "front-right",
      position: { x: 0.78, y: -0.17, z: -0.58 },
      side: "right",
    },
    {
      axle: "rear",
      id: "rear-left",
      position: { x: -0.78, y: -0.17, z: 0.62 },
      side: "left",
    },
    {
      axle: "rear",
      id: "rear-right",
      position: { x: 0.78, y: -0.17, z: 0.62 },
      side: "right",
    },
  ]);
  expect(first.collisionPrimitives).toHaveLength(6);
  expect(first.collisionPrimitives[1]).toMatchObject({
    componentInstanceId: "balanced-body",
    componentTransform: {
      position: { x: 0, y: 0.24, z: 0.48 },
      rotation: { x: 0, y: 0, z: 0 },
    },
    primitive: { id: "body-collision", shape: "box" },
  });
  expect(first.sourceComponents).toHaveLength(7);
});

test("normalizes component order before deterministic derivation", () => {
  const reordered = cloneBalancedKart();
  reordered.components.reverse();

  expect(deriveKartPhysicalProfile(reordered)).toEqual(
    deriveKartPhysicalProfile(BALANCED_KART_CONSTRUCTION),
  );
});

test("derives a positive compound inertia tensor around the combined center", () => {
  const { inertiaTensor } =
    deriveKartPhysicalProfile(BALANCED_KART_CONSTRUCTION).mass;

  expect(inertiaTensor.xx).toBeGreaterThan(0);
  expect(inertiaTensor.yy).toBeGreaterThan(0);
  expect(inertiaTensor.zz).toBeGreaterThan(0);
  expect(inertiaTensor.xx * inertiaTensor.yy).toBeGreaterThan(
    inertiaTensor.xy ** 2,
  );
  expect(inertiaTensor.xx * inertiaTensor.zz).toBeGreaterThan(
    inertiaTensor.xz ** 2,
  );
  expect(inertiaTensor.yy * inertiaTensor.zz).toBeGreaterThan(
    inertiaTensor.yz ** 2,
  );
});

test("moves a component and changes only causally related physical values", () => {
  const baseline = deriveKartPhysicalProfile(BALANCED_KART_CONSTRUCTION);
  const shifted = cloneBalancedKart();
  shifted.components[3].transformAdjustment.position.x = 0.12;
  const profile = deriveKartPhysicalProfile(shifted);

  expect(profile.mass.centerOfMass).toEqual({
    x: expect.closeTo(0.015, 10),
    y: expect.closeTo(baseline.mass.centerOfMass.y, 10),
    z: expect.closeTo(baseline.mass.centerOfMass.z, 10),
  });
  expect(profile.mass.inertiaTensor.yy).not.toBeCloseTo(
    baseline.mass.inertiaTensor.yy,
    8,
  );
  expect(profile.drive).toEqual(baseline.drive);
  expect(profile.grip).toEqual(baseline.grip);
});

test("rotates a component and changes its tensor, bounds, and collision recipe", () => {
  const baseline = deriveKartPhysicalProfile(BALANCED_KART_CONSTRUCTION);
  const rotated = cloneBalancedKart();
  rotated.components[6].transformAdjustment.rotation.y = 10;
  const profile = deriveKartPhysicalProfile(rotated);

  expect(profile.mass.centerOfMass).toEqual(baseline.mass.centerOfMass);
  expect(profile.mass.inertiaTensor.xz).toBeCloseTo(-0.1398349356, 8);
  expect(profile.bounds.minimum.z).toBeCloseTo(-0.8902745848, 8);
  expect(profile.bounds.dimensions.z).toBeCloseTo(1.8002745848, 8);
  expect(
    profile.collisionPrimitives.find(
      (entry) => entry.primitive.id === "front-bumper-collision",
    )?.componentTransform,
  ).toEqual({
    position: { x: 0, y: 0, z: 0 },
    rotation: { x: 0, y: 10, z: 0 },
  });
  expect(profile.drive).toEqual(baseline.drive);
  expect(profile.grip).toEqual(baseline.grip);
});

test("keeps every display stat bounded and downstream of physical values", () => {
  const profile = deriveKartPhysicalProfile(BALANCED_KART_CONSTRUCTION);

  Object.values(profile.statBars).forEach((value) => {
    expect(Number.isInteger(value)).toBe(true);
    expect(value).toBeGreaterThanOrEqual(0);
    expect(value).toBeLessThanOrEqual(100);
  });
  expect(BALANCED_KART_CONSTRUCTION).not.toHaveProperty("statBars");
});

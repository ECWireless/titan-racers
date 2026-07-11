import { expect, test } from "@playwright/test";

import {
  calculateBoxInertia,
  configureRigidBodyCcd,
  getRigidBodyCcdConfiguration,
} from "../src/game/runtime/ammo-rigid-body";

test("calculates a box inertia tensor in chassis-local axes", () => {
  const inertia = calculateBoxInertia(120, {
    x: 1.25,
    y: 0.55,
    z: 1.85,
  });

  expect(inertia.x).toBeCloseTo(37.25, 2);
  expect(inertia.y).toBeCloseTo(49.85, 2);
  expect(inertia.z).toBeCloseTo(18.65, 2);
});

test("scales box inertia linearly with mass", () => {
  const light = calculateBoxInertia(60, { x: 1.25, y: 0.55, z: 1.85 });
  const heavy = calculateBoxInertia(120, { x: 1.25, y: 0.55, z: 1.85 });

  expect(heavy.x).toBeCloseTo(light.x * 2);
  expect(heavy.y).toBeCloseTo(light.y * 2);
  expect(heavy.z).toBeCloseTo(light.z * 2);
});

test("configures CCD directly on an initialized Ammo body", () => {
  const thresholds: number[] = [];
  const radii: number[] = [];
  let activationCount = 0;
  const entity = {
    name: "test-kart",
    rigidbody: {
      activate: () => {
        activationCount += 1;
      },
      body: {
        setCcdMotionThreshold: (threshold: number) => {
          thresholds.push(threshold);
        },
        setCcdSweptSphereRadius: (radius: number) => {
          radii.push(radius);
        },
      },
    },
  };

  configureRigidBodyCcd(entity as never, {
    motionThreshold: 0.12,
    sweptSphereRadius: 0.16,
  });

  expect(thresholds).toEqual([0.12]);
  expect(radii).toEqual([0.16]);
  expect(activationCount).toBe(1);
  expect(getRigidBodyCcdConfiguration(entity as never)).toEqual({
    motionThreshold: 0.12,
    sweptSphereRadius: 0.16,
  });
});

test("rejects invalid CCD dimensions before touching Ammo", () => {
  const entity = {
    name: "test-kart",
    rigidbody: {
      activate: () => undefined,
      body: {
        setCcdMotionThreshold: () => undefined,
        setCcdSweptSphereRadius: () => undefined,
      },
    },
  };

  expect(() =>
    configureRigidBodyCcd(entity as never, {
      motionThreshold: -1,
      sweptSphereRadius: 0.16,
    }),
  ).toThrow(/non-negative threshold/);
  expect(() =>
    configureRigidBodyCcd(entity as never, {
      motionThreshold: 0.12,
      sweptSphereRadius: 0,
    }),
  ).toThrow(/positive radius/);
});

import { expect, test } from "@playwright/test";

import { calculateBoxInertia } from "../src/game/runtime/ammo-rigid-body";

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

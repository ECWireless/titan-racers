import { expect, test } from "@playwright/test";

import {
  getEnclosureFrame,
  ISLAND_THREE_ENCLOSURE,
  type CourseEnclosure,
  type Vector3,
} from "../src/game/enclosure/island-three";
import {
  createHabitatField,
  getLevelRotation,
} from "../src/game/physics/rotating-habitat";

const G = 9.81;
const R = 4_000;
const enclosure = (height = 0): CourseEnclosure => ({
  ...ISLAND_THREE_ENCLOSURE,
  mirrorAngle: 45,
  placement: { axial: 1_200, azimuth: 118, heading: 38, height },
});
const { spinward, sunward } = getEnclosureFrame(enclosure());
const scale = (v: Vector3, s: number) => ({
  x: v.x * s,
  y: v.y * s,
  z: v.z * s,
});
const expectVector = (actual: Vector3, expected: Vector3, digits = 6) => {
  expect(actual.x).toBeCloseTo(expected.x, digits);
  expect(actual.y).toBeCloseTo(expected.y, digits);
  expect(actual.z).toBeCloseTo(expected.z, digits);
};

test("spins for floor gravity: one turn every 127 s", () => {
  const field = createHabitatField(enclosure(), G);
  expect(field.spinRate).toBeCloseTo(Math.sqrt(G / R), 12);
  expect((2 * Math.PI) / field.spinRate).toBeCloseTo(126.9, 1);
  expectVector(field.spinAxis, sunward);
});

test("pulls with floor gravity straight down at a floor placement", () => {
  const field = createHabitatField(enclosure(), G);
  expectVector(field.gravity({ x: 0, y: 0, z: 0 }), { x: 0, y: -G, z: 0 });
  expectVector(field.up({ x: 0, y: 0, z: 0 }), { x: 0, y: 1, z: 0 });
  // Along the axis nothing changes.
  expectVector(field.gravity(scale(sunward, 300)), { x: 0, y: -G, z: 0 });
});

test("weakens linearly with height and vanishes on the axis", () => {
  const raised = createHabitatField(enclosure(3_500), G);
  expectVector(raised.gravity({ x: 0, y: 0, z: 0 }), {
    x: 0,
    y: (-G * 500) / R,
    z: 0,
  });
  const floor = createHabitatField(enclosure(), G);
  expectVector(floor.gravity({ x: 0, y: 2, z: 0 }), {
    x: 0,
    y: (-G * (R - 2)) / R,
    z: 0,
  });
  expectVector(floor.gravity({ x: 0, y: R, z: 0 }), { x: 0, y: 0, z: 0 });
  expectVector(floor.up({ x: 0, y: R, z: 0 }), { x: 0, y: 1, z: 0 });
});

test("tilts away from the axial line across the spin, so up points at the axis", () => {
  const field = createHabitatField(enclosure(), G);
  const position = scale(spinward, 45);
  const gravity = field.gravity(position);
  const magnitude = Math.hypot(gravity.x, gravity.y, gravity.z);
  const downhill =
    gravity.x * spinward.x + gravity.y * spinward.y + gravity.z * spinward.z;
  expect(magnitude).toBeCloseTo((G * Math.hypot(R, 45)) / R, 6);
  expect(Math.asin(downhill / magnitude) * (180 / Math.PI)).toBeCloseTo(
    0.645,
    2,
  );
  expectVector(field.up(position), scale(gravity, -1 / magnitude));
});

test("applies Coriolis as weight along spin and spinward drift when rising", () => {
  const field = createHabitatField(enclosure(), G);
  const twoOmega = 2 * field.spinRate;
  expectVector(field.coriolis(scale(spinward, 10)), {
    x: 0,
    y: -twoOmega * 10,
    z: 0,
  });
  expectVector(field.coriolis(scale(spinward, -10)), {
    x: 0,
    y: twoOmega * 10,
    z: 0,
  });
  expectVector(field.coriolis(scale(sunward, 10)), { x: 0, y: 0, z: 0 });
  expectVector(
    field.coriolis({ x: 0, y: 3, z: 0 }),
    scale(spinward, twoOmega * 3),
  );
});

test("level rotation turns habitat up onto course +Y", () => {
  const up = { x: 0.3, y: 0.9, z: -Math.sqrt(1 - 0.09 - 0.81) };
  const q = getLevelRotation(up);
  // Rotate `up` by q: v' = v + 2w(q × v) + 2q × (q × v).
  const cross = (a: Vector3, b: Vector3) => ({
    x: a.y * b.z - a.z * b.y,
    y: a.z * b.x - a.x * b.z,
    z: a.x * b.y - a.y * b.x,
  });
  const qv = { x: q.x, y: q.y, z: q.z };
  const t = scale(cross(qv, up), 2);
  const rotated = cross(qv, t);
  expectVector(
    {
      x: up.x + q.w * t.x + rotated.x,
      y: up.y + q.w * t.y + rotated.y,
      z: up.z + q.w * t.z + rotated.z,
    },
    { x: 0, y: 1, z: 0 },
  );
});

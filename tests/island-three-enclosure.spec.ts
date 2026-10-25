import { expect, test } from "@playwright/test";

import { createDistantLights } from "../src/game/enclosure/distant-lights";
import { waterEdge } from "../src/game/enclosure/habitat-land";
import {
  getEnclosureFrame,
  ISLAND_THREE_ENCLOSURE,
  type CourseEnclosure,
} from "../src/game/enclosure/island-three";

function expectVector(
  actual: { x: number; y: number; z: number },
  expected: { x: number; y: number; z: number },
) {
  expect(actual.x).toBeCloseTo(expected.x, 6);
  expect(actual.y).toBeCloseTo(expected.y, 6);
  expect(actual.z).toBeCloseTo(expected.z, 6);
}

const enclosure: CourseEnclosure = {
  ...ISLAND_THREE_ENCLOSURE,
  mirrorAngle: 45,
  placement: { axial: -8_000, azimuth: 120, heading: 90, height: 0 },
};

test("places the course origin on the floor with the axis 4 km overhead", () => {
  const frame = getEnclosureFrame(enclosure);

  expectVector(frame.point(-8_000, 120, 4_000), { x: 0, y: 0, z: 0 });
  // The floor across the axis hangs 8 km overhead.
  expectVector(frame.point(-8_000, 300, 4_000), { x: 0, y: 8_000, z: 0 });
  // Heading 90 turns the sunward axis onto the course's -X.
  expectVector(frame.sunward, { x: -1, y: 0, z: 0 });
  expectVector(frame.point(-7_000, 120, 4_000), { x: -1_000, y: 0, z: 0 });
  // Spinward = up × sunward, and the floor curves up ahead of it.
  expectVector(frame.spinward, { x: 0, y: 0, z: 1 });
  const spinwardFloor = frame.point(-8_000, 121, 4_000);
  expect(spinwardFloor.z).toBeCloseTo(4_000 * Math.sin(Math.PI / 180), 6);
  expect(spinwardFloor.y).toBeGreaterThan(0.6);
});

test("raises a placement above the floor toward the axis", () => {
  const frame = getEnclosureFrame({
    ...enclosure,
    placement: { ...enclosure.placement, height: 3_000 },
  });

  expectVector(frame.point(-8_000, 120, 4_000), { x: 0, y: -3_000, z: 0 });
  expectVector(frame.point(-8_000, 120, 0), { x: 0, y: 1_000, z: 0 });
});

test("lights each valley through the window opposite it", () => {
  const sun = (mirrorAngle: number, azimuth = 120) =>
    getEnclosureFrame({
      ...enclosure,
      mirrorAngle,
      placement: { ...enclosure.placement, azimuth },
    }).sunDirection();

  expectVector(sun(45), { x: 0, y: 1, z: 0 });
  // Morning sits toward the sunward cap, evening toward the other.
  const morning = sun(15);
  expect(morning.x).toBeCloseTo(-Math.cos(Math.PI / 6), 6);
  expect(morning.y).toBeCloseTo(0.5, 6);
  expect(sun(75).x).toBeCloseTo(Math.cos(Math.PI / 6), 6);
  // 10° spinward of the valley centre, the same parallel rays arrive
  // tilted: the window is 10° back along the far side, which lies spinward.
  const offCentre = sun(45, 130);
  expect(offCentre.y).toBeCloseTo(Math.cos(Math.PI / 18), 6);
  expect(offCentre.z).toBeCloseTo(Math.sin(Math.PI / 18), 6);
});

test("lights only the band of floor its mirror reaches", () => {
  const reaches = (axial: number, mirrorAngle: number) =>
    getEnclosureFrame({
      ...enclosure,
      mirrorAngle,
      placement: { ...enclosure.placement, axial },
    }).sunReaches();

  // A low morning sun lands toward the anti-sun cap; an evening one at the
  // same elevation reaches the middle.
  expect(reaches(0, 19)).toBe(false);
  expect(reaches(-12_000, 19)).toBe(true);
  expect(reaches(0, 71)).toBe(true);
  // Low evening sun reaches only the sunward end, and at 84° nothing.
  expect(reaches(5_000, 80)).toBe(false);
  expect(reaches(8_000, 80)).toBe(true);
  expect(reaches(15_000, 84)).toBe(false);
});

test("lights the falls bridge and a few floodlit fields clear of water", () => {
  const data = createDistantLights();
  const lights = Array.from({ length: data.length / 8 }, (_, i) =>
    Array.from(data.subarray(i * 8, i * 8 + 8)),
  );
  const [beacons, fields] = [
    lights.filter(([, , , , , green]) => green === 0),
    lights.filter(([, , , candela]) => candela! > 10_000),
  ];

  expect(beacons).toHaveLength(4);
  expect(fields).toHaveLength(24);
  for (const [axial, across, , , , , , valley] of fields) {
    expect(waterEdge(axial!, across!, valley! + 1)).toBeGreaterThan(0);
  }
});

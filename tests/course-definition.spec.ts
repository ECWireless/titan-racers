import { expect, test } from "@playwright/test";

import {
  ROUGH_COURSE,
  ROUGH_COURSE_RAMPS,
} from "../src/game/course/course-definition";

test("places the super-tall ramp on the lower straight for counter-clockwise traffic", () => {
  const ramp = ROUGH_COURSE_RAMPS.find(
    (candidate) => candidate.id === "ramp-super-tall",
  );

  expect(ramp).toBeDefined();

  const angle = Math.abs(ramp?.rotation.z ?? 0) * (Math.PI / 180);
  const halfLength = (ramp?.scale.x ?? 0) * 0.5;
  const halfThickness = (ramp?.scale.y ?? 0) * 0.5;
  const entryTop =
    (ramp?.position.y ?? 0) -
    Math.sin(angle) * halfLength +
    Math.cos(angle) * halfThickness;
  const entryX =
    (ramp?.position.x ?? 0) - Math.cos(angle) * halfLength;
  const runwayLength = entryX + ROUGH_COURSE.road.halfStraight;

  expect(ROUGH_COURSE_RAMPS).toHaveLength(1);
  expect(ramp?.position.z).toBe(
    ROUGH_COURSE.centerZ + ROUGH_COURSE.road.turnRadius,
  );
  expect(ramp?.rotation.z).toBeGreaterThan(0);
  expect(entryTop).toBeGreaterThan(0.04);
  expect(entryTop).toBeLessThan(0.12);
  expect(runwayLength).toBeGreaterThan(16);
});

test("keeps the expanded plane approximately 1.5 times its original area", () => {
  const originalArea = 72 * 48;
  const expandedArea = ROUGH_COURSE.ground.width * ROUGH_COURSE.ground.depth;

  expect(expandedArea / originalArea).toBeCloseTo(1.5, 1);
});

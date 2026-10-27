import { expect, test } from "@playwright/test";

import { createCourseInteriorTest } from "../src/game/course/course-interior";
import {
  FALLS_VIEW_PARK_DOCUMENT,
  ROUGH_COURSE_DOCUMENT,
} from "../src/game/course/course-document";

test("finds a kart indoors only beneath the tunnel's roof", () => {
  const isIndoors = createCourseInteriorTest(FALLS_VIEW_PARK_DOCUMENT)!;
  const at = (x: number, y: number, z: number) => isIndoors({ x, y, z });

  // The grid, the junction chamber (beneath its chamfered strip too), and
  // the north leg.
  expect(at(30, 0.15, -45)).toBe(true);
  expect(at(80, 0.15, -44)).toBe(true);
  expect(at(77.5, 0.15, -41.5)).toBe(true);
  expect(at(81, 0.15, -20)).toBe(true);
  // Either side of each portal plane.
  expect(at(10.05, 0.15, -45)).toBe(true);
  expect(at(9.95, 0.15, -45)).toBe(false);
  expect(at(81, 0.15, -10.05)).toBe(true);
  expect(at(81, 0.15, -9.95)).toBe(false);
  // Out on the course, and up on the berm above the roof.
  expect(at(81, 0.15, 0)).toBe(false);
  expect(at(30, 4.7, -45)).toBe(false);

  // A course without a roof has no inside.
  expect(createCourseInteriorTest(ROUGH_COURSE_DOCUMENT)).toBeNull();
});

import { expect, test } from "@playwright/test";

import {
  COURSE_ASPHALT_COLOR,
  COURSE_SURFACE_OVERLAY_DEPTH_BIAS,
  getCourseVisualDepthBias,
} from "../src/game/course/course-visual-policy";

test("gives surface overlays a stable render-depth priority", () => {
  expect(getCourseVisualDepthBias("ground")).toBe(
    COURSE_SURFACE_OVERLAY_DEPTH_BIAS,
  );
  expect(getCourseVisualDepthBias("line")).toBe(
    COURSE_SURFACE_OVERLAY_DEPTH_BIAS,
  );
  expect(getCourseVisualDepthBias("asphalt")).toBe(0);
  expect(getCourseVisualDepthBias("ramp")).toBe(0);
  expect(COURSE_SURFACE_OVERLAY_DEPTH_BIAS).toBeLessThan(0);
});

test("keeps the asphalt visibly lighter than near-black kart tires", () => {
  expect(COURSE_ASPHALT_COLOR).toEqual([0.18, 0.2, 0.22]);
  expect(Math.min(...COURSE_ASPHALT_COLOR)).toBeGreaterThan(0.1);
});

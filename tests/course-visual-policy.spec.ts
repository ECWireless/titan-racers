import { expect, test } from "@playwright/test";

import {
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

import { expect, test } from "@playwright/test";

import {
  COURSE_ASPHALT_COLOR,
  COURSE_EDITOR_CAMERA_NEAR_CLIP,
  COURSE_SURFACE_OVERLAY_DEPTH_BIAS,
  getCourseEditorVisualDepthBias,
  getCourseVisualDepthBias,
  isCourseEditorBaseGround,
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

test("reserves enough course-editor depth precision for distant surfaces", () => {
  expect(COURSE_EDITOR_CAMERA_NEAR_CLIP).toBe(0.5);
});

test("removes overlay priority only from the editor base ground", () => {
  expect(isCourseEditorBaseGround("ground", "ground")).toBe(true);
  expect(
    isCourseEditorBaseGround("ground", "course-inner-straight"),
  ).toBe(false);
  expect(isCourseEditorBaseGround("asphalt", "ground")).toBe(false);
  expect(getCourseEditorVisualDepthBias("ground", "ground")).toBe(0);
  expect(
    getCourseEditorVisualDepthBias("ground", "course-inner-straight"),
  ).toBe(COURSE_SURFACE_OVERLAY_DEPTH_BIAS);
  expect(getCourseEditorVisualDepthBias("line", "start-finish-line")).toBe(
    COURSE_SURFACE_OVERLAY_DEPTH_BIAS,
  );
  expect(getCourseEditorVisualDepthBias("asphalt", "ground")).toBe(0);
});

test("keeps the asphalt visibly lighter than near-black kart tires", () => {
  expect(COURSE_ASPHALT_COLOR).toEqual([0.18, 0.2, 0.22]);
  expect(Math.min(...COURSE_ASPHALT_COLOR)).toBeGreaterThan(0.1);
});

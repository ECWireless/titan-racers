import { expect, test } from "@playwright/test";

import {
  COURSE_ASPHALT_COLOR,
  COURSE_EDITOR_CAMERA_NEAR_CLIP,
  drawsCourseGrassUnlayered,
  getCourseSurfaceLayerDepthBias,
  isCourseBaseGround,
} from "../src/game/course/course-visual-policy";

test("orders coplanar surface layers above the unbiased base ground", () => {
  const order = [
    0,
    getCourseSurfaceLayerDepthBias("asphalt"),
    getCourseSurfaceLayerDepthBias("ground"),
    getCourseSurfaceLayerDepthBias("line"),
    getCourseSurfaceLayerDepthBias("tireMark"),
    getCourseSurfaceLayerDepthBias("contactShadow"),
  ];

  order.slice(1).forEach((bias, index) => {
    expect(bias).toBeLessThan(order[index]);
  });
});

test("reserves enough course-editor depth precision for distant surfaces", () => {
  expect(COURSE_EDITOR_CAMERA_NEAR_CLIP).toBe(0.5);
});

test("treats only the ground object as the base ground", () => {
  expect(isCourseBaseGround("ground", "ground")).toBe(true);
  expect(isCourseBaseGround("ground", "course-inner-straight")).toBe(false);
  expect(isCourseBaseGround("asphalt", "ground")).toBe(false);
});

test("draws solid earthworks, unlike thin grass layers, without layer bias", () => {
  const grass = (
    id: string,
    material: "asphalt" | "lawn" | "verge",
    thickness: number,
    tilt = 0,
  ) => ({
    id,
    transform: { rotation: { x: tilt, z: 0 } },
    visual: { material, scale: { y: thickness } },
  });
  // The base ground and a berm's thick lawn slabs, level or sloping.
  expect(drawsCourseGrassUnlayered(grass("ground", "lawn", 0.1))).toBe(true);
  expect(drawsCourseGrassUnlayered(grass("berm-crest", "lawn", 0.65))).toBe(
    true,
  );
  expect(
    drawsCourseGrassUnlayered(grass("berm-slope", "lawn", 0.8, -26.6)),
  ).toBe(true);
  // Thin grass layers keep their order above the ground; asphalt is not grass.
  expect(drawsCourseGrassUnlayered(grass("infield", "lawn", 0.002))).toBe(
    false,
  );
  expect(drawsCourseGrassUnlayered(grass("verge", "verge", 0.002))).toBe(false);
  expect(drawsCourseGrassUnlayered(grass("deck", "asphalt", 0.3))).toBe(false);
});

test("keeps the asphalt visibly lighter than near-black kart tires", () => {
  expect(COURSE_ASPHALT_COLOR).toEqual([0.34, 0.37, 0.39]);
  expect(Math.min(...COURSE_ASPHALT_COLOR)).toBeGreaterThan(0.1);
});

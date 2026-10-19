import type { CourseVisualMaterial } from "./course-document";

export const COURSE_ASPHALT_COLOR = [0.18, 0.2, 0.22] as const;
export const COURSE_BASE_GROUND_OBJECT_ID = "ground";
export const COURSE_EDITOR_CAMERA_NEAR_CLIP = 0.5;

// Surfaces and markings are drawn at their shared collision top, so coplanar
// layers are ordered by depth bias instead of height. Each layer draws over
// the ones before it; the base ground has no bias and draws under them all.
const COURSE_SURFACE_LAYERS = [
  "asphalt",
  "ground",
  "startMarker",
  "line",
] as const;
const COURSE_SURFACE_LAYER_DEPTH_BIAS_STEP = -1;

export type CourseSurfaceLayer = (typeof COURSE_SURFACE_LAYERS)[number];

export function getCourseSurfaceLayerDepthBias(layer: CourseSurfaceLayer) {
  return (
    (COURSE_SURFACE_LAYERS.indexOf(layer) + 1) *
    COURSE_SURFACE_LAYER_DEPTH_BIAS_STEP
  );
}

export function isCourseBaseGround(
  material: CourseVisualMaterial,
  objectId: string,
) {
  return material === "ground" && objectId === COURSE_BASE_GROUND_OBJECT_ID;
}

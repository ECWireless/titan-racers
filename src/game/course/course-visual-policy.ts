import type { CourseVisualMaterial } from "./course-document";

export const COURSE_ASPHALT_COLOR = [0.18, 0.2, 0.22] as const;
export const COURSE_BASE_GROUND_OBJECT_ID = "ground";
export const COURSE_EDITOR_CAMERA_NEAR_CLIP = 0.5;
export const COURSE_SURFACE_OVERLAY_DEPTH_BIAS = -1;

export function getCourseVisualDepthBias(material: CourseVisualMaterial) {
  return material === "ground" || material === "line"
    ? COURSE_SURFACE_OVERLAY_DEPTH_BIAS
    : 0;
}

export function getCourseEditorVisualDepthBias(
  material: CourseVisualMaterial,
  objectId: string,
) {
  return isCourseEditorBaseGround(material, objectId)
    ? 0
    : getCourseVisualDepthBias(material);
}

export function isCourseEditorBaseGround(
  material: CourseVisualMaterial,
  objectId: string,
) {
  return material === "ground" && objectId === COURSE_BASE_GROUND_OBJECT_ID;
}

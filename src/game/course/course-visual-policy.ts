import type { CourseVisualMaterial } from "./course-document";

export const COURSE_ASPHALT_COLOR = [0.18, 0.2, 0.22] as const;
export const COURSE_SURFACE_OVERLAY_DEPTH_BIAS = -1;

export function getCourseVisualDepthBias(material: CourseVisualMaterial) {
  return material === "ground" || material === "line"
    ? COURSE_SURFACE_OVERLAY_DEPTH_BIAS
    : 0;
}

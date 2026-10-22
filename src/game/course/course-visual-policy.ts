import type { CourseVisualMaterial } from "./course-document";

export const COURSE_ASPHALT_COLOR = [0.34, 0.37, 0.39] as const;
export const COURSE_TURF_COLOR = "#65735a";
// Uncut lawn: darker and denser than the clipped turf.
export const COURSE_LAWN_COLOR = "#56644b";
// Cut blades are not shaded by their neighbours, so clippings take each
// grass colour without its scan's baked occlusion (about 85%).
export const COURSE_TURF_CLIPPING_COLOR = "#6d7c61";
export const COURSE_LAWN_CLIPPING_COLOR = "#5d6c51";
export const COURSE_BASE_GROUND_OBJECT_ID = "ground";
export const COURSE_EDITOR_CAMERA_NEAR_CLIP = 0.5;
// The editor overview sits about 30 m above the ground, beyond the race's
// 20 m shadow reach, so it keeps the budget's full 40 m.
export const COURSE_EDITOR_SHADOW_DISTANCE = 40;

// Surfaces and markings are drawn at their shared collision top, so coplanar
// layers are ordered by depth bias instead of height. Each layer draws over
// the ones before it; the base ground has no bias and draws under them all.
// Verge turf edges the asphalt from beneath; infield turf and lawn draw over it.
// Tire marks lie on the road, its paint, and grass; the kart's contact shadow
// lies on top of every course layer.
const COURSE_SURFACE_LAYERS = [
  "verge",
  "asphalt",
  "ground",
  "lawn",
  "line",
  "tireMark",
  "contactShadow",
] as const;
const COURSE_SURFACE_OVERLAY_MAX_THICKNESS = 0.01;
const COURSE_SURFACE_LAYER_DEPTH_BIAS_STEP = -1;

export type CourseSurfaceLayer = (typeof COURSE_SURFACE_LAYERS)[number];

export function getCourseSurfaceLayerDepthBias(layer: CourseSurfaceLayer) {
  return (
    (COURSE_SURFACE_LAYERS.indexOf(layer) + 1) *
    COURSE_SURFACE_LAYER_DEPTH_BIAS_STEP
  );
}

function getCourseSurfaceLayer(
  material: CourseVisualMaterial,
  objectId: string,
): CourseSurfaceLayer | null {
  if (material === "asphalt" || material === "verge") return material;
  if (material === "ground" || material === "lawn") {
    return isCourseBaseGround(material, objectId) ? null : material;
  }
  return material === "line" || material === "hazard" ? "line" : null;
}

// A thin, level layer only ever shows its top face. Drawing just that face
// keeps the slope-scaled layer bias from pulling its hidden side faces through
// the layers above it as dark seams.
export function drawsCourseTopFaceOnly(object: {
  id: string;
  transform: { rotation: { x: number; z: number } };
  visual: { material: CourseVisualMaterial; scale: { y: number } };
}) {
  return (
    getCourseSurfaceLayer(object.visual.material, object.id) !== null &&
    object.visual.scale.y <= COURSE_SURFACE_OVERLAY_MAX_THICKNESS &&
    object.transform.rotation.x === 0 &&
    object.transform.rotation.z === 0
  );
}

export function isCourseBaseGround(
  material: CourseVisualMaterial,
  objectId: string,
) {
  return (
    (material === "ground" || material === "lawn") &&
    objectId === COURSE_BASE_GROUND_OBJECT_ID
  );
}

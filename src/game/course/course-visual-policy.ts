import type { CourseVisualMaterial } from "./course-document";

export const COURSE_ASPHALT_COLOR = [0.34, 0.37, 0.39] as const;
export const COURSE_BASE_GROUND_OBJECT_ID = "ground";
export const COURSE_EDITOR_CAMERA_NEAR_CLIP = 0.5;
// The editor overview sits about 30 m above the ground, beyond the race's
// 20 m shadow reach, so it keeps the budget's full 40 m.
export const COURSE_EDITOR_SHADOW_DISTANCE = 40;

// Surfaces and markings are drawn at their shared collision top, so coplanar
// layers are ordered by depth bias instead of height. Each layer draws over
// the ones before it; the base ground has no bias and draws under them all.
// The kart's contact shadow lies on top of every course layer.
const COURSE_SURFACE_LAYERS = [
  "asphalt",
  "ground",
  "line",
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
  if (material === "asphalt") return "asphalt";
  if (material === "ground") {
    return isCourseBaseGround(material, objectId) ? null : "ground";
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
  return material === "ground" && objectId === COURSE_BASE_GROUND_OBJECT_ID;
}

// Open water on a course: a box whose top is the water surface and whose
// volume is the water. Its surface flows along the box's local +X at a slow
// stream's speed. Karts never float: a 1:10 kart in water 0.3 m deep is under
// it entirely, so a kart whose centre of mass goes under is drowned, and the
// race recovers it. The bed beneath is its own object and collides.
import {
  type CourseDocument,
  type CoursePrimitiveObject,
  isCoursePrimitiveObject,
  rotateCourseDirection,
} from "./course-document";

/** Surface speed of a slow lowland stream, in m/s. */
export const COURSE_WATER_FLOW_SPEED = 0.3;

type Vec3 = { x: number; y: number; z: number };

export type CourseWaterVolume = {
  halfExtents: Vec3;
  position: Vec3;
  rotation: Vec3;
};

const LOCAL = { x: 0, y: 0, z: 0 };

export function isCourseWater(
  object: CourseDocument["objects"][number],
): object is CoursePrimitiveObject {
  return object.visual.material === "water" && isCoursePrimitiveObject(object);
}

export function getCourseWaterVolumes(
  document: CourseDocument,
): CourseWaterVolume[] {
  return document.objects.filter(isCourseWater).map((object) => ({
    halfExtents: {
      x: object.visual.scale.x / 2,
      y: object.visual.scale.y / 2,
      z: object.visual.scale.z / 2,
    },
    position: object.transform.position,
    rotation: object.transform.rotation,
  }));
}

/** Whether a point, such as a kart's centre of mass, is under water. */
export function isUnderCourseWater(
  volumes: readonly CourseWaterVolume[],
  point: Vec3,
) {
  return volumes.some(({ halfExtents, position, rotation }) => {
    const local = rotateCourseDirection(
      {
        x: point.x - position.x,
        y: point.y - position.y,
        z: point.z - position.z,
      },
      rotation,
      LOCAL,
    );
    return (
      Math.abs(local.x) <= halfExtents.x &&
      Math.abs(local.y) <= halfExtents.y &&
      Math.abs(local.z) <= halfExtents.z
    );
  });
}

/**
 * A unit box's top face for a water object of this size: its UVs are metres,
 * u downstream along local +X and v across, so ripples keep their real size
 * and flow with the box after the course's batching merges it.
 */
export function createCourseWaterSurfaceGeometry(scale: Vec3) {
  const corners = [
    [-0.5, -0.5],
    [0.5, -0.5],
    [0.5, 0.5],
    [-0.5, 0.5],
  ] as const;
  return {
    indices: [0, 2, 1, 0, 3, 2],
    normals: corners.flatMap(() => [0, 1, 0]),
    positions: corners.flatMap(([x, z]) => [x, 0.5, z]),
    uvs: corners.flatMap(([x, z]) => [x * scale.x, z * scale.z]),
  };
}

import type { Position3 } from "../contracts";
import { rotateCourseDirection, type CourseObject } from "./course-document";

type Surface = {
  collision: NonNullable<CourseObject["collision"]>;
  center: Position3;
  right: Position3;
  forward: Position3;
  name: string;
  normal: Position3;
};

const CONTACT_PLANE_TOLERANCE = 0.001;
const COPLANAR_TOLERANCE = 0.000001;

/** Static collision geometry only: render scale and material never select grip. */
export class CourseSurfaceResolver {
  private readonly surfaces: Surface[] = [];
  private readonly byName = new Map<string, Surface>();

  constructor(objects: readonly CourseObject[]) {
    for (const object of objects) {
      const collision = object.collision;
      if (
        collision?.role !== "drivable-surface" ||
        (collision.shape === "cylinder" && collision.axis !== 1)
      )
        continue;
      const { position, rotation } = object.transform;
      const zero = { x: 0, y: 0, z: 0 };
      const offset = collision.offset;
      const offsetPosition = rotateCourseDirection(
        offset.position,
        zero,
        rotation,
      );
      const axis = (direction: Position3) =>
        rotateCourseDirection(
          rotateCourseDirection(direction, zero, offset.rotation),
          zero,
          rotation,
        );
      const surface = {
        collision,
        center: {
          x: position.x + offsetPosition.x,
          y: position.y + offsetPosition.y,
          z: position.z + offsetPosition.z,
        },
        right: axis({ x: 1, y: 0, z: 0 }),
        forward: axis({ x: 0, y: 0, z: 1 }),
        name: object.id,
        normal: axis({ x: 0, y: 1, z: 0 }),
      };
      this.surfaces.push(surface);
      this.byName.set(object.id, surface);
    }
  }

  resolve(hitName: string, point: Position3, normal: Position3) {
    let selected = this.byName.get(hitName);
    // Collision angular offsets affect layer alignment independently of the
    // entity-up normal retained by the force solver.
    const supportNormal = selected?.normal ?? normal;
    let highestPlane = -Infinity;
    for (const surface of this.surfaces) {
      if (
        surface.normal.x * supportNormal.x +
          surface.normal.y * supportNormal.y +
          surface.normal.z * supportNormal.z <
        1 - COPLANAR_TOLERANCE
      )
        continue;
      const dx = point.x - surface.center.x;
      const dy = point.y - surface.center.y;
      const dz = point.z - surface.center.z;
      const localX =
        dx * surface.right.x + dy * surface.right.y + dz * surface.right.z;
      const localY =
        dx * surface.normal.x + dy * surface.normal.y + dz * surface.normal.z;
      const localZ =
        dx * surface.forward.x +
        dy * surface.forward.y +
        dz * surface.forward.z;
      const collision = surface.collision;
      const top =
        collision.shape === "box"
          ? collision.halfExtents.y
          : collision.height / 2;
      const plane = top - localY;
      if (Math.abs(plane) > CONTACT_PLANE_TOLERANCE) continue;
      const inside =
        collision.shape === "box"
          ? Math.abs(localX) <= collision.halfExtents.x &&
            Math.abs(localZ) <= collision.halfExtents.z
          : localX ** 2 + localZ ** 2 <= collision.radius ** 2;
      if (!inside || plane < highestPlane - COPLANAR_TOLERANCE) continue;
      // Later authored colliders win ties, including grass cutouts over asphalt.
      // A bridge or ramp on a different plane cannot replace this wheel's hit.
      selected = surface;
      highestPlane = Math.max(highestPlane, plane);
    }
    return selected;
  }
}

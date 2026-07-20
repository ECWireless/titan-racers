import type * as pc from "playcanvas";

import type { Position3 } from "../contracts";

export type DrivableSurfaceSupportShape =
  | Readonly<{
      angularOffset: Position3;
      halfExtents: Position3;
      linearOffset: Position3;
      shape: "box";
    }>
  | Readonly<{
      angularOffset: Position3;
      axis: 0 | 1 | 2;
      height: number;
      linearOffset: Position3;
      shape: "cylinder";
    }>;

const TOP_FACE_TOLERANCE_METERS = 0.001;
const supportShapes = new WeakMap<pc.Entity, DrivableSurfaceSupportShape>();

export function registerDrivableSurfaceSupportShape(
  entity: pc.Entity,
  shape: DrivableSurfaceSupportShape,
) {
  supportShapes.set(entity, shape);
}

export function isCollisionLocalTopContact(
  shape: DrivableSurfaceSupportShape,
  collisionLocalPoint: Position3,
) {
  if (shape.shape === "cylinder" && shape.axis !== 1) {
    return false;
  }

  const topY =
    shape.shape === "box" ? shape.halfExtents.y : shape.height / 2;

  return collisionLocalPoint.y >= topY - TOP_FACE_TOLERANCE_METERS;
}

export function isDrivableSurfaceTopContact(
  entity: pc.Entity,
  worldPoint: pc.Vec3,
) {
  const shape = supportShapes.get(entity);

  if (!shape) {
    return false;
  }

  const entityPosition = entity.getPosition();
  const entityLocalPoint = worldPoint.clone();
  entityLocalPoint.x -= entityPosition.x;
  entityLocalPoint.y -= entityPosition.y;
  entityLocalPoint.z -= entityPosition.z;

  const inverseRotation = entity.getRotation().clone().invert();
  inverseRotation.transformVector(entityLocalPoint, entityLocalPoint);

  entityLocalPoint.x -= shape.linearOffset.x;
  entityLocalPoint.y -= shape.linearOffset.y;
  entityLocalPoint.z -= shape.linearOffset.z;

  inverseRotation
    .setFromEulerAngles(
      shape.angularOffset.x,
      shape.angularOffset.y,
      shape.angularOffset.z,
    )
    .invert()
    .transformVector(entityLocalPoint, entityLocalPoint);

  return isCollisionLocalTopContact(shape, entityLocalPoint);
}

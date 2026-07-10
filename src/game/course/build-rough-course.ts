import * as pc from "playcanvas";

import type { ObstacleObjectId } from "../contracts";
import { ROUGH_COURSE, ROUGH_COURSE_OBSTACLES } from "./course-definition";

export type CollisionObstacle = {
  id: ObstacleObjectId;
  radius: number;
  x: number;
  z: number;
};

type RoughCourseMaterials = {
  asphalt: pc.StandardMaterial;
  ground: pc.StandardMaterial;
  line: pc.StandardMaterial;
  obstacleBarrel: pc.StandardMaterial;
  obstacleBlock: pc.StandardMaterial;
};

export function buildRoughCourse(
  app: pc.Application,
  materials: RoughCourseMaterials,
) {
  const obstacleEntities = new Map<ObstacleObjectId, pc.Entity>();
  const collisionObstacles: CollisionObstacle[] = [];

  createPrimitive(
    app,
    "box",
    "ground",
    new pc.Vec3(0, -0.06, ROUGH_COURSE.centerZ),
    new pc.Vec3(
      ROUGH_COURSE.ground.width,
      0.1,
      ROUGH_COURSE.ground.depth,
    ),
    materials.ground,
    0,
    true,
  );

  buildPillCourse(app, materials);

  ROUGH_COURSE_OBSTACLES.forEach((obstacle) => {
    const position = new pc.Vec3(
      obstacle.position.x,
      obstacle.position.y,
      obstacle.position.z,
    );
    const entity = createPrimitive(
      app,
      obstacle.kind,
      obstacle.id,
      position,
      new pc.Vec3(obstacle.scale.x, obstacle.scale.y, obstacle.scale.z),
      obstacle.kind === "box"
        ? materials.obstacleBlock
        : materials.obstacleBarrel,
      obstacle.rotationY,
      false,
    );

    obstacleEntities.set(obstacle.id, entity);
    collisionObstacles.push({
      id: obstacle.id,
      radius: obstacle.collisionRadius,
      x: position.x,
      z: position.z,
    });
  });

  return { collisionObstacles, obstacleEntities };
}

function buildPillCourse(
  app: pc.Application,
  materials: Pick<RoughCourseMaterials, "asphalt" | "ground" | "line">,
) {
  const { centerZ } = ROUGH_COURSE;
  const { halfStraight, turnRadius, width } = ROUGH_COURSE.road;
  const outerRadius = turnRadius + width / 2;
  const innerRadius = turnRadius - width / 2;

  createPrimitive(
    app,
    "box",
    "course-outer-straight",
    new pc.Vec3(0, 0.01, centerZ),
    new pc.Vec3(halfStraight * 2, 0.08, outerRadius * 2),
    materials.asphalt,
    0,
    true,
  );
  createPrimitive(
    app,
    "cylinder",
    "course-left-cap",
    new pc.Vec3(-halfStraight, 0.01, centerZ),
    new pc.Vec3(outerRadius * 2, 0.08, outerRadius * 2),
    materials.asphalt,
    0,
    true,
  );
  createPrimitive(
    app,
    "cylinder",
    "course-right-cap",
    new pc.Vec3(halfStraight, 0.01, centerZ),
    new pc.Vec3(outerRadius * 2, 0.08, outerRadius * 2),
    materials.asphalt,
    0,
    true,
  );
  createPrimitive(
    app,
    "box",
    "course-inner-straight",
    new pc.Vec3(0, 0.08, centerZ),
    new pc.Vec3(halfStraight * 2, 0.08, innerRadius * 2),
    materials.ground,
    0,
    true,
  );
  createPrimitive(
    app,
    "cylinder",
    "course-left-cutout",
    new pc.Vec3(-halfStraight, 0.08, centerZ),
    new pc.Vec3(innerRadius * 2, 0.08, innerRadius * 2),
    materials.ground,
    0,
    true,
  );
  createPrimitive(
    app,
    "cylinder",
    "course-right-cutout",
    new pc.Vec3(halfStraight, 0.08, centerZ),
    new pc.Vec3(innerRadius * 2, 0.08, innerRadius * 2),
    materials.ground,
    0,
    true,
  );
  createPrimitive(
    app,
    "box",
    "start-finish-line",
    new pc.Vec3(0, 0.14, 0),
    new pc.Vec3(0.18, 0.08, width + 0.4),
    materials.line,
    0,
    true,
    false,
  );
}

function createPrimitive(
  app: pc.Application,
  type: "box" | "cylinder",
  name: string,
  position: pc.Vec3,
  scale: pc.Vec3,
  material: pc.StandardMaterial,
  rotationY = 0,
  supportsKart = false,
  hasPhysics = true,
) {
  const entity = new pc.Entity(name);
  entity.addComponent("model", { type });
  entity.setPosition(position);
  entity.setEulerAngles(0, rotationY, 0);
  entity.setLocalScale(scale);
  entity.model?.meshInstances?.forEach((meshInstance) => {
    meshInstance.material = material;
  });
  if (hasPhysics) {
    entity.tags.add(supportsKart ? "drivable-surface" : "obstacle");

    if (type === "box") {
      entity.addComponent("collision", {
        halfExtents: scale.clone().mulScalar(0.5),
        linearOffset: supportsKart
          ? new pc.Vec3(0, -position.y - scale.y * 0.5, 0)
          : pc.Vec3.ZERO,
        type,
      });
    } else {
      entity.addComponent("collision", {
        height: scale.y,
        linearOffset: supportsKart
          ? new pc.Vec3(0, -position.y - scale.y * 0.5, 0)
          : pc.Vec3.ZERO,
        radius: Math.max(scale.x, scale.z) * 0.5,
        type,
      });
    }

    entity.addComponent("rigidbody", {
      friction: 0.7,
      restitution: 0,
      type: pc.BODYTYPE_STATIC,
    });
  }
  app.root.addChild(entity);

  return entity;
}

import * as pc from "playcanvas";

import type { ObstacleObjectId } from "../contracts";
import { PHYSICS_GROUP, PHYSICS_MASK } from "../physics/collision-groups";
import {
  ROUGH_COURSE,
  ROUGH_COURSE_CAMERA_FIXTURES,
  ROUGH_COURSE_COLLISION_FIXTURES,
  ROUGH_COURSE_OBSTACLES,
  ROUGH_COURSE_RAMPS,
} from "./course-definition";

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
  ramp: pc.StandardMaterial;
};

export function buildRoughCourse(
  app: pc.Application,
  materials: RoughCourseMaterials,
  includeCollisionFixtures = false,
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

  const rampEntities = ROUGH_COURSE_RAMPS.map((ramp) =>
    createRamp(
      app,
      ramp.id,
      new pc.Vec3(ramp.position.x, ramp.position.y, ramp.position.z),
      new pc.Vec3(ramp.scale.x, ramp.scale.y, ramp.scale.z),
      new pc.Vec3(ramp.rotation.x, ramp.rotation.y, ramp.rotation.z),
      materials.ramp,
    ),
  );

  const cameraFixtureEntities = ROUGH_COURSE_CAMERA_FIXTURES.map((fixture) =>
    createPrimitive(
      app,
      "box",
      fixture.id,
      new pc.Vec3(
        fixture.position.x,
        fixture.position.y,
        fixture.position.z,
      ),
      new pc.Vec3(fixture.scale.x, fixture.scale.y, fixture.scale.z),
      materials.obstacleBlock,
    ),
  );

  const collisionFixtureEntities = includeCollisionFixtures
    ? ROUGH_COURSE_COLLISION_FIXTURES.map((fixture) =>
        createPrimitive(
          app,
          "box",
          fixture.id,
          new pc.Vec3(
            fixture.position.x,
            fixture.position.y,
            fixture.position.z,
          ),
          new pc.Vec3(fixture.scale.x, fixture.scale.y, fixture.scale.z),
          materials.obstacleBlock,
        ),
      )
    : [];

  return {
    cameraFixtureEntities,
    collisionFixtureEntities,
    collisionObstacles,
    obstacleEntities,
    rampEntities,
  };
}

function createRamp(
  app: pc.Application,
  name: string,
  position: pc.Vec3,
  scale: pc.Vec3,
  rotation: pc.Vec3,
  material: pc.StandardMaterial,
) {
  const entity = new pc.Entity(name);

  entity.addComponent("model", { type: "box" });
  entity.setPosition(position);
  entity.setEulerAngles(rotation);
  entity.setLocalScale(scale);
  entity.model?.meshInstances?.forEach((meshInstance) => {
    meshInstance.material = material;
  });
  entity.tags.add("drivable-surface");
  entity.addComponent("collision", {
    halfExtents: scale.clone().mulScalar(0.5),
    type: "box",
  });
  entity.addComponent("rigidbody", {
    friction: 0.55,
    group: PHYSICS_GROUP.drivableSurface,
    mask: PHYSICS_MASK.drivableSurface,
    restitution: 0,
    type: pc.BODYTYPE_STATIC,
  });
  app.root.addChild(entity);

  return entity;
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
      group: supportsKart
        ? PHYSICS_GROUP.drivableSurface
        : PHYSICS_GROUP.solidObstacle,
      mask: supportsKart
        ? PHYSICS_MASK.drivableSurface
        : PHYSICS_MASK.solidObstacle,
      restitution: 0,
      type: pc.BODYTYPE_STATIC,
    });
  }
  app.root.addChild(entity);

  return entity;
}

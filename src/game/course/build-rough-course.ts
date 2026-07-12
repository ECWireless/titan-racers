import * as pc from "playcanvas";

import type { ObstacleObjectId } from "../contracts";
import { PHYSICS_GROUP, PHYSICS_MASK } from "../physics/collision-groups";
import type {
  CourseDocument,
  CourseObject,
  CourseVisualMaterial,
} from "./course-document";
import { ROUGH_COURSE_DOCUMENT } from "./course-document";

export type CollisionObstacle = {
  id: ObstacleObjectId;
  radius: number;
  x: number;
  z: number;
};

type RoughCourseMaterials = Record<CourseVisualMaterial, pc.StandardMaterial>;

export type CourseObjectProjection = ReturnType<typeof projectCourseObject>;

// Custom factories must return an unattached entity. The builder owns scene
// attachment so the complete course batch can be committed atomically.
type CourseEntityFactory = (
  projection: CourseObjectProjection,
  material: pc.StandardMaterial,
) => pc.Entity;

type BuildRoughCourseOptions = {
  createEntity?: CourseEntityFactory;
  document?: CourseDocument;
  includeCollisionFixtures?: boolean;
  materials: RoughCourseMaterials;
};

function isLegacyEditableObstacleId(id: string): id is ObstacleObjectId {
  return id === "obstacle-barrel-a" || id === "obstacle-barrel-b";
}

function toVec3(vector: { x: number; y: number; z: number }) {
  return new pc.Vec3(vector.x, vector.y, vector.z);
}

export function selectCourseObjectsForBuild(
  document: CourseDocument,
  includeCollisionFixtures: boolean,
) {
  return document.objects.filter(
    (object) =>
      object.availability === "standard" || includeCollisionFixtures,
  );
}

export function projectCourseObject(object: CourseObject) {
  const collision = object.collision;
  const supportsKart = collision?.role === "drivable-surface";

  return {
    availability: object.availability,
    category: object.category,
    collision,
    editable: object.editable,
    id: object.id,
    physics: collision
      ? {
          friction: collision.friction,
          group: supportsKart
            ? PHYSICS_GROUP.drivableSurface
            : PHYSICS_GROUP.solidObstacle,
          mask: supportsKart
            ? PHYSICS_MASK.drivableSurface
            : PHYSICS_MASK.solidObstacle,
          restitution: collision.restitution,
          tag: supportsKart ? "drivable-surface" : "obstacle",
        }
      : null,
    transform: object.transform,
    visual: object.visual,
  } as const;
}

export function buildRoughCourse(
  app: pc.Application,
  {
    createEntity = createCourseEntity,
    document = ROUGH_COURSE_DOCUMENT,
    includeCollisionFixtures = false,
    materials,
  }: BuildRoughCourseOptions,
) {
  const obstacleEntities = new Map<ObstacleObjectId, pc.Entity>();
  const collisionObstacles: CollisionObstacle[] = [];
  const courseEntities = new Map<string, pc.Entity>();
  const cameraFixtureEntities: pc.Entity[] = [];
  const collisionFixtureEntities: pc.Entity[] = [];
  const rampEntities: pc.Entity[] = [];
  const stagedEntities: pc.Entity[] = [];

  try {
    selectCourseObjectsForBuild(document, includeCollisionFixtures).forEach(
      (object) => {
        const projection = projectCourseObject(object);
        const entity = createEntity(
          projection,
          materials[projection.visual.material],
        );

        stagedEntities.push(entity);
        courseEntities.set(object.id, entity);

        if (object.availability === "collision-test") {
          collisionFixtureEntities.push(entity);
        } else if (object.category === "fixture") {
          cameraFixtureEntities.push(entity);
        }

        if (object.visual.material === "ramp") {
          rampEntities.push(entity);
        }

        if (
          object.category === "obstacle" &&
          isLegacyEditableObstacleId(object.id)
        ) {
          obstacleEntities.set(object.id, entity);
          collisionObstacles.push({
            id: object.id,
            // Preserve the transitional Lite Editor selection/clearance
            // footprint. Physics consumes the independent collision radius.
            radius: Math.max(object.visual.scale.x, object.visual.scale.z),
            x: object.transform.position.x,
            z: object.transform.position.z,
          });
        }
      },
    );

    stagedEntities.forEach((entity) => app.root.addChild(entity));
  } catch (error) {
    stagedEntities.forEach((entity) => entity.destroy());
    throw error;
  }

  return {
    cameraFixtureEntities,
    collisionFixtureEntities,
    collisionObstacles,
    courseEntities,
    obstacleEntities,
    rampEntities,
  };
}

function createCourseEntity(
  projection: CourseObjectProjection,
  material: pc.StandardMaterial,
) {
  const entity = new pc.Entity(projection.id);

  try {
    return configureCourseEntity(entity, projection, material);
  } catch (error) {
    entity.destroy();
    throw error;
  }
}

function configureCourseEntity(
  entity: pc.Entity,
  projection: CourseObjectProjection,
  material: pc.StandardMaterial,
) {
  entity.addComponent("model", { type: projection.visual.shape });
  entity.setPosition(toVec3(projection.transform.position));
  entity.setEulerAngles(toVec3(projection.transform.rotation));
  entity.setLocalScale(toVec3(projection.visual.scale));
  entity.model?.meshInstances?.forEach((meshInstance) => {
    meshInstance.material = material;
  });

  const collision = projection.collision;
  const physics = projection.physics;

  if (collision && physics) {
    const angularOffset = new pc.Quat().setFromEulerAngles(
      collision.offset.rotation.x,
      collision.offset.rotation.y,
      collision.offset.rotation.z,
    );
    const linearOffset = toVec3(collision.offset.position);

    entity.tags.add(physics.tag);

    if (collision.shape === "box") {
      entity.addComponent("collision", {
        angularOffset,
        halfExtents: toVec3(collision.halfExtents),
        linearOffset,
        type: "box",
      });
    } else {
      entity.addComponent("collision", {
        angularOffset,
        axis: collision.axis,
        height: collision.height,
        linearOffset,
        radius: collision.radius,
        type: "cylinder",
      });
    }

    entity.addComponent("rigidbody", {
      friction: physics.friction,
      group: physics.group,
      mask: physics.mask,
      restitution: physics.restitution,
      type: pc.BODYTYPE_STATIC,
    });
  }

  return entity;
}

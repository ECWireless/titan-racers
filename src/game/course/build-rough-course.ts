import * as pc from "playcanvas";

import type { CourseTestObstacleId } from "../contracts";
import { PHYSICS_GROUP, PHYSICS_MASK } from "../physics/collision-groups";
import { registerDrivableSurfaceSupportShape } from "../physics/drivable-surface-support";
import type {
  CourseDocument,
  CourseObject,
  CourseVisualMaterial,
} from "./course-document";
import { ROUGH_COURSE_DOCUMENT } from "./course-document";
import { CourseSurfaceResolver } from "./course-surface-resolver";
import {
  drawsCourseTopFaceOnly,
  isCourseBaseGround,
} from "./course-visual-policy";

export type CollisionObstacle = {
  id: CourseTestObstacleId;
  radius: number;
  x: number;
  z: number;
};

export type RoughCourseMaterials = Record<
  CourseVisualMaterial,
  pc.StandardMaterial
> & {
  // The base ground draws under every coplanar surface layer.
  baseGround: pc.StandardMaterial;
  baseLawn: pc.StandardMaterial;
};

export type CourseTopFaceMeshes = Record<"box" | "cylinder", pc.Mesh>;

export type CourseObjectProjection = ReturnType<typeof projectCourseObject>;

// Custom factories must return an unattached entity. The builder owns scene
// attachment so the complete course batch can be committed atomically. A
// top-face mesh replaces the visual primitive for thin surface layers.
type CourseEntityFactory = (
  projection: CourseObjectProjection,
  material: pc.StandardMaterial,
  topFace?: pc.Mesh,
) => pc.Entity;

type BuildRoughCourseOptions = {
  createEntity?: CourseEntityFactory;
  document?: CourseDocument;
  includeCollisionFixtures?: boolean;
  materials: RoughCourseMaterials;
  topFaces?: CourseTopFaceMeshes;
};

function isCourseTestObstacleId(id: string): id is CourseTestObstacleId {
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
    topFaces,
  }: BuildRoughCourseOptions,
) {
  const obstacleEntities = new Map<CourseTestObstacleId, pc.Entity>();
  const collisionObstacles: CollisionObstacle[] = [];
  const courseEntities = new Map<string, pc.Entity>();
  const cameraFixtureEntities: pc.Entity[] = [];
  const collisionFixtureEntities: pc.Entity[] = [];
  const rampEntities: pc.Entity[] = [];
  const stagedEntities: pc.Entity[] = [];
  const objects = selectCourseObjectsForBuild(document, includeCollisionFixtures);
  const surfaceResolver = new CourseSurfaceResolver(objects);

  try {
    objects.forEach(
      (object) => {
        const projection = projectCourseObject(object);
        const entity = createEntity(
          projection,
          isCourseBaseGround(projection.visual.material, projection.id)
            ? projection.visual.material === "lawn"
              ? materials.baseLawn
              : materials.baseGround
            : materials[projection.visual.material],
          drawsCourseTopFaceOnly(object)
            ? topFaces?.[object.visual.shape]
            : undefined,
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
          isCourseTestObstacleId(object.id)
        ) {
          obstacleEntities.set(object.id, entity);
          collisionObstacles.push({
            id: object.id,
            // Preserve the deterministic reset-clearance and runtime test
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
    surfaceResolver,
  };
}

function createCourseEntity(
  projection: CourseObjectProjection,
  material: pc.StandardMaterial,
  topFace?: pc.Mesh,
) {
  const entity = new pc.Entity(projection.id);

  try {
    return configureCourseEntity(entity, projection, material, topFace);
  } catch (error) {
    entity.destroy();
    throw error;
  }
}

function configureCourseEntity(
  entity: pc.Entity,
  projection: CourseObjectProjection,
  material: pc.StandardMaterial,
  topFace?: pc.Mesh,
) {
  addCourseVisual(entity, projection.visual.shape, material, topFace);
  entity.setPosition(toVec3(projection.transform.position));
  entity.setEulerAngles(toVec3(projection.transform.rotation));
  entity.setLocalScale(toVec3(projection.visual.scale));

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

    if (collision.role === "drivable-surface") {
      registerDrivableSurfaceSupportShape(entity, {
        ...collision,
        angularOffset: collision.offset.rotation,
        linearOffset: collision.offset.position,
      });
    }

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

export function addCourseVisual(
  entity: pc.Entity,
  shape: "box" | "cylinder",
  material: pc.StandardMaterial,
  topFace?: pc.Mesh,
) {
  if (topFace) {
    entity.addComponent("render", {
      castShadows: false,
      meshInstances: [new pc.MeshInstance(topFace, material)],
    });
    return;
  }
  entity.addComponent("model", { type: shape });
  entity.model?.meshInstances?.forEach((meshInstance) => {
    meshInstance.material = material;
  });
}

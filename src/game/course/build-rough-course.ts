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
import {
  type CourseArc,
  createCourseArcGeometry,
  getCourseArcCollisionBoxes,
} from "./course-arc";
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
// generated mesh replaces the visual primitive: an arc's surface, or the top
// face of a thin surface layer.
type CourseEntityFactory = (
  projection: CourseObjectProjection,
  material: pc.StandardMaterial,
  mesh?: pc.Mesh,
) => pc.Entity;

type BuildRoughCourseOptions = {
  createEntity?: CourseEntityFactory;
  document?: CourseDocument;
  includeCollisionFixtures?: boolean;
  /**
   * Finishes lit by an interior's environment. Given them, indoor objects
   * use them and take light only from lights that reach indoors.
   */
  indoorMaterials?: RoughCourseMaterials | null;
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
    indoorMaterials = null,
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
        const finishes = (object.indoors && indoorMaterials) || materials;
        const indoors = finishes !== materials;
        const arcMesh =
          object.visual.shape === "arc"
            ? createCourseArcMesh(app.graphicsDevice, object.visual.arc)
            : undefined;
        let entity: pc.Entity;
        try {
          entity = createEntity(
            projection,
            isCourseBaseGround(projection.visual.material, projection.id)
              ? projection.visual.material === "lawn"
                ? finishes.baseLawn
                : finishes.baseGround
              : finishes[projection.visual.material],
            arcMesh ??
              (object.visual.shape !== "arc" && drawsCourseTopFaceOnly(object)
                ? topFaces?.[object.visual.shape]
                : undefined),
          );
        } catch (error) {
          // Free the mesh the entity never took; destroying it twice is safe.
          arcMesh?.destroy();
          throw error;
        }

        if (indoors) keepCourseVisualIndoors(entity);
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
          object.visual.shape !== "arc" &&
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
  mesh?: pc.Mesh,
) {
  const entity = new pc.Entity(projection.id);

  try {
    return configureCourseEntity(entity, projection, material, mesh);
  } catch (error) {
    entity.destroy();
    throw error;
  }
}

function configureCourseEntity(
  entity: pc.Entity,
  projection: CourseObjectProjection,
  material: pc.StandardMaterial,
  mesh?: pc.Mesh,
) {
  const { visual } = projection;
  addCourseVisual(entity, visual.shape, material, mesh);
  entity.setPosition(toVec3(projection.transform.position));
  entity.setEulerAngles(toVec3(projection.transform.rotation));
  // An arc's mesh is built to size.
  if (visual.shape !== "arc") entity.setLocalScale(toVec3(visual.scale));

  const collision = projection.collision;
  const physics = projection.physics;

  if (collision?.shape === "arc" && physics) {
    if (visual.shape !== "arc") throw new Error("Arcs collide as arcs");
    addCourseArcCollision(entity, visual.arc, physics);
  } else if (collision && collision.shape !== "arc" && physics) {
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
  shape: "arc" | "box" | "cylinder",
  material: pc.StandardMaterial,
  mesh?: pc.Mesh,
) {
  if (mesh) {
    entity.addComponent("render", {
      // A thin layer's top face casts no shadow; an arc casts like a box.
      castShadows: shape === "arc",
      meshInstances: [new pc.MeshInstance(mesh, material)],
    });
    return;
  }
  if (shape === "arc") throw new Error("An arc needs its generated mesh");
  entity.addComponent("model", { type: shape });
  entity.model?.meshInstances?.forEach((meshInstance) => {
    meshInstance.material = material;
  });
}

/**
 * An arc's smooth surface, with the box primitive's vertex streams so it
 * joins its finish's static batch. Its mesh instance frees it on destroy.
 */
export function createCourseArcMesh(device: pc.GraphicsDevice, arc: CourseArc) {
  const geometry = createCourseArcGeometry(arc);
  const mesh = new pc.Mesh(device);
  mesh.setPositions(geometry.positions);
  mesh.setNormals(geometry.normals);
  mesh.setUvs(0, geometry.uvs);
  mesh.setUvs(1, geometry.uvs);
  mesh.setIndices(geometry.indices);
  mesh.update();
  return mesh;
}

// Each collision box is its own static body, as authored boxes are, under
// the arc's entity; contacts and the chase camera's ray see their tags.
function addCourseArcCollision(
  entity: pc.Entity,
  arc: CourseArc,
  physics: NonNullable<CourseObjectProjection["physics"]>,
) {
  getCourseArcCollisionBoxes(arc).forEach((box, index) => {
    const part = new pc.Entity(`${entity.name}-collision-${index + 1}`);
    part.tags.add(physics.tag);
    part.setLocalPosition(box.center.x, box.center.y, box.center.z);
    part.setLocalEulerAngles(0, box.yaw, 0);
    part.addComponent("collision", {
      halfExtents: toVec3(box.halfExtents),
      type: "box",
    });
    part.addComponent("rigidbody", {
      friction: physics.friction,
      group: physics.group,
      mask: physics.mask,
      restitution: physics.restitution,
      type: pc.BODYTYPE_STATIC,
    });
    entity.addChild(part);
  });
}

/**
 * Lights an indoor object only with lights that reach indoors (whose mask
 * includes MASK_AFFECT_LIGHTMAPPED), so the sun and outdoor lamps never shine
 * through a roof. It casts no sun shadow: nothing it could shade is lit by
 * the sun. Set after the visual exists, since assigning a render
 * component's mesh instances resets their masks.
 */
export function keepCourseVisualIndoors(entity: pc.Entity) {
  const visual = entity.render ?? entity.model;
  if (!visual) return;
  visual.castShadows = false;
  visual.meshInstances?.forEach((meshInstance) => {
    meshInstance.mask = pc.MASK_AFFECT_LIGHTMAPPED;
  });
}

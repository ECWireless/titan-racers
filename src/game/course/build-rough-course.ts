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
import {
  COURSE_CLEARING_SURFACE,
  COURSE_FENCE_MESH,
  type CourseClearingGeometry,
  getCourseClearingFence,
  getCourseClearingGround,
  getCourseFenceMeshCoverage,
} from "./course-clearing";
import { createCourseBevelGeometry, type CourseMeshGeometry } from "./course-bevel";
import {
  type CourseKitBox,
  createCourseElbowGeometry,
  createCourseHandwheelGeometry,
  createCourseKitGeometry,
  getCourseElbowCollisionCylinders,
  getCourseKit,
} from "./course-kits";
import { createCourseSignGeometry, type CourseSignGlyphs } from "./course-sign";
import { CourseSurfaceResolver } from "./course-surface-resolver";
import { createCourseTimberGeometry } from "./course-timber";
import {
  createCourseWaterSurfaceGeometry,
  isCourseWater,
} from "./course-water";
import {
  drawsCourseAsphaltUnlayered,
  drawsCourseGrassUnlayered,
  drawsCourseTopFaceOnly,
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
  // Solid asphalt decks, which draw with no layer bias.
  baseAsphalt: pc.StandardMaterial;
};

export type CourseTopFaceMeshes = Record<"box" | "cylinder", pc.Mesh>;

export type CourseObjectProjection = ReturnType<typeof projectCourseObject>;

// Custom factories must return an unattached entity. The builder owns scene
// attachment so the complete course batch can be committed atomically. A
// generated mesh replaces the visual primitive: an arc's surface, a timber
// box or round with its grain laid along it, a bevelled solid, a handwheel, a
// sign's lettering, a water surface, or the top face of a thin surface layer.
type CourseEntityFactory = (
  projection: CourseObjectProjection,
  material: pc.StandardMaterial,
  visual?: CourseObjectMesh,
) => pc.Entity;

/**
 * A generated mesh, and whether it casts as its primitive would: a solid's
 * does; a thin layer's top face, a water surface, and lettering do not.
 */
export type CourseObjectMesh = { castShadows: boolean; mesh: pc.Mesh };

/** Signs' letters and their paint, from the course's finishes. */
type CourseSignFinishes = {
  glyphs(): Pick<CourseSignGlyphs, "capHeight" | "cell" | "glyphs" | "space">;
  material(finish: CourseVisualMaterial, indoors: boolean): pc.StandardMaterial;
};

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
  /** Without them, a sign draws as its plain box. */
  signs?: CourseSignFinishes;
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
  app: pc.AppBase,
  {
    createEntity = createCourseEntity,
    document = ROUGH_COURSE_DOCUMENT,
    includeCollisionFixtures = false,
    indoorMaterials = null,
    materials,
    signs,
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
        const lettered = object.sign !== undefined && signs !== undefined;
        const generated = createCourseObjectMesh(app.graphicsDevice, object, signs);
        let entity: pc.Entity;
        try {
          entity = createEntity(
            projection,
            lettered
              ? signs.material(projection.visual.material, indoors)
              : drawsCourseGrassUnlayered(object)
                ? projection.visual.material === "lawn"
                  ? finishes.baseLawn
                  : finishes.baseGround
                : drawsCourseAsphaltUnlayered(object)
                  ? finishes.baseAsphalt
                  : finishes[projection.visual.material],
            generated ??
              (object.visual.shape !== "arc" &&
              drawsCourseTopFaceOnly(object) &&
              topFaces
                ? { castShadows: false, mesh: topFaces[object.visual.shape] }
                : undefined),
          );
        } catch (error) {
          // Free the mesh the entity never took; destroying it twice is safe.
          generated?.mesh.destroy();
          throw error;
        }

        // Staged first, so a kit that fails to build is freed with it.
        stagedEntities.push(entity);
        const kit = getCourseKit(object);
        if (kit) {
          const frame = addCourseKit(
            app.graphicsDevice,
            entity,
            kit.scale,
            kit.boxes,
            finishes.steel,
          );
          if (indoors) keepCourseVisualIndoors(frame);
        }
        if (indoors) keepCourseVisualIndoors(entity);
        // A bicycle is drawn with the trees, in place of its box, which
        // only the editor keeps, unseen, to select.
        if (object.bicycle) entity.enabled = false;
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
  generated?: CourseObjectMesh,
) {
  const entity = new pc.Entity(projection.id);

  try {
    return configureCourseEntity(entity, projection, material, generated);
  } catch (error) {
    entity.destroy();
    throw error;
  }
}

function configureCourseEntity(
  entity: pc.Entity,
  projection: CourseObjectProjection,
  material: pc.StandardMaterial,
  generated?: CourseObjectMesh,
) {
  const { visual } = projection;
  addCourseVisual(entity, visual.shape, material, generated);
  entity.setPosition(toVec3(projection.transform.position));
  entity.setEulerAngles(toVec3(projection.transform.rotation));
  // An arc's mesh is built to size.
  if (visual.shape !== "arc") entity.setLocalScale(toVec3(visual.scale));

  const collision = projection.collision;
  const physics = projection.physics;

  if (collision?.shape === "arc" && physics) {
    if (visual.shape !== "arc") throw new Error("Arcs collide as arcs");
    addCourseArcCollision(entity, visual.arc, physics);
  } else if (collision?.shape === "elbow" && physics) {
    if (visual.shape === "arc") throw new Error("Elbows collide as elbows");
    addCourseElbowCollision(entity, visual.scale, physics);
  } else if (
    collision &&
    collision.shape !== "arc" &&
    collision.shape !== "elbow" &&
    physics
  ) {
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
  generated?: CourseObjectMesh,
) {
  if (generated) {
    entity.addComponent("render", {
      castShadows: generated.castShadows,
      meshInstances: [new pc.MeshInstance(generated.mesh, material)],
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
 * Draws a kit's boxes as one mesh under its object's entity, undoing the
 * object's scale; the mesh instance frees the mesh on destroy.
 */
function addCourseKit(
  device: pc.GraphicsDevice,
  entity: pc.Entity,
  scale: { x: number; y: number; z: number },
  boxes: CourseKitBox[],
  material: pc.StandardMaterial,
) {
  const mesh = createCourseMesh(device, createCourseKitGeometry(boxes));
  const frame = new pc.Entity(`${entity.name}-kit`);
  frame.setLocalScale(1 / scale.x, 1 / scale.y, 1 / scale.z);
  frame.addComponent("render", {
    meshInstances: [new pc.MeshInstance(mesh, material)],
  });
  entity.addChild(frame);
  return frame;
}

/**
 * The mesh an object draws in place of its primitive, if any (see
 * CourseEntityFactory). Given `signs`, a sign draws its lettering; its mesh
 * instance frees the mesh on destroy.
 */
function createCourseObjectMesh(
  device: pc.GraphicsDevice,
  object: CourseObject,
  signs?: CourseSignFinishes,
): CourseObjectMesh | undefined {
  const { visual } = object;
  const solid = (geometry: CourseMeshGeometry) => ({
    castShadows: true,
    mesh: createCourseMesh(device, geometry),
  });
  if (visual.shape === "arc") return solid(createCourseArcGeometry(visual.arc));
  if (isCourseWater(object)) {
    return {
      castShadows: false,
      mesh: createCourseMesh(device, createCourseWaterSurfaceGeometry(visual.scale)),
    };
  }
  if (signs && object.sign !== undefined) {
    return {
      castShadows: false,
      mesh: createCourseMesh(
        device,
        createCourseSignGeometry(object.sign, visual.scale, signs.glyphs()),
      ),
    };
  }
  if (object.kit === "handwheel") return solid(createCourseHandwheelGeometry(visual.scale));
  if (object.kit === "elbow") return solid(createCourseElbowGeometry(visual.scale));
  if (visual.material === "timber") {
    return solid(createCourseTimberGeometry(visual.shape, visual.scale, object.transform));
  }
  if (visual.bevel) {
    return solid(createCourseBevelGeometry(visual.shape, visual.scale, visual.bevel));
  }
  return undefined;
}

// The engine primitives' streams (positions, normals, two UV sets), so the
// mesh joins its finish's static batch.
function createCourseMesh(device: pc.GraphicsDevice, geometry: CourseMeshGeometry) {
  const mesh = new pc.Mesh(device);
  mesh.setPositions(geometry.positions);
  mesh.setNormals(geometry.normals);
  mesh.setUvs(0, geometry.uvs);
  mesh.setUvs(1, geometry.uvs);
  mesh.setIndices(geometry.indices);
  mesh.update();
  return mesh;
}

/**
 * An arc's smooth surface, with the box primitive's vertex streams so it
 * joins its finish's static batch. Its mesh instance frees it on destroy.
 */
export function createCourseArcMesh(device: pc.GraphicsDevice, arc: CourseArc) {
  return createCourseMesh(device, createCourseArcGeometry(arc));
}

/**
 * A pipe elbow, fitted to the unit primitive its entity scales by `scale`;
 * its mesh instance frees it on destroy.
 */
export function createCourseElbowMesh(
  device: pc.GraphicsDevice,
  scale: { x: number; y: number; z: number },
) {
  return createCourseMesh(device, createCourseElbowGeometry(scale));
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

// An elbow collides as cylinders along its bend, each its own static body,
// under a child that undoes the elbow's scale so they are laid out in metres.
function addCourseElbowCollision(
  entity: pc.Entity,
  scale: { x: number; y: number; z: number },
  physics: NonNullable<CourseObjectProjection["physics"]>,
) {
  const root = new pc.Entity(`${entity.name}-collision`);
  root.setLocalScale(1 / scale.x, 1 / scale.y, 1 / scale.z);
  getCourseElbowCollisionCylinders(scale.x).forEach((cylinder, index) => {
    const part = new pc.Entity(`${entity.name}-collision-${index + 1}`);
    part.tags.add(physics.tag);
    part.setLocalPosition(cylinder.center.x, cylinder.center.y, cylinder.center.z);
    part.setLocalEulerAngles(0, 0, cylinder.roll);
    part.addComponent("collision", {
      axis: 1,
      height: cylinder.height,
      radius: cylinder.radius,
      type: "cylinder",
    });
    part.addComponent("rigidbody", {
      friction: physics.friction,
      group: physics.group,
      mask: physics.mask,
      restitution: physics.restitution,
      type: pc.BODYTYPE_STATIC,
    });
    root.addChild(part);
  });
  entity.addChild(root);
}

/**
 * The habitat floor of a course's clearing outside its footprint, and the
 * park fence ringing it. The ground is one lawn mesh, with a static slab
 * for each piece, which supports karts as lawn and resolves straight to it.
 * The fence's posts are one steel mesh and its weld-mesh panels one
 * see-through mesh, with static obstacle colliders. `batched` lists the
 * entities drawn in course finishes, to join their static batch. Null for
 * a course without a clearing.
 */
export function addCourseClearing(
  app: pc.AppBase,
  document: CourseDocument,
  {
    lawn,
    steel,
    surfaceResolver,
  }: {
    lawn: pc.Material;
    steel: pc.StandardMaterial;
    surfaceResolver: CourseSurfaceResolver;
  },
) {
  const ground = getCourseClearingGround(document.enclosure);
  const fence = getCourseClearingFence(document.enclosure);
  if (!ground || !fence) return null;
  const root = new pc.Entity("course-clearing");
  const meshTexture = new pc.Texture(app.graphicsDevice, {
    addressU: pc.ADDRESS_REPEAT,
    addressV: pc.ADDRESS_REPEAT,
    format: pc.PIXELFORMAT_RGBA8,
    height: COURSE_FENCE_MESH.texels,
    levels: [getCourseFenceMeshCoverage()],
    magFilter: pc.FILTER_LINEAR,
    minFilter: pc.FILTER_LINEAR_MIPMAP_LINEAR,
    mipmaps: true,
    name: "course-fence-mesh",
    width: COURSE_FENCE_MESH.texels,
  });
  // Galvanised wire in the posts' finish, seen from either side.
  const meshMaterial = new pc.StandardMaterial();
  meshMaterial.diffuse = steel.diffuse.clone();
  meshMaterial.useMetalness = true;
  meshMaterial.metalness = 0;
  meshMaterial.gloss = steel.gloss;
  meshMaterial.opacityMap = meshTexture;
  meshMaterial.opacityMapChannel = "r";
  // Wire covers about a ninth of a panel; a low threshold lets alpha to
  // coverage thin it to a haze at distance rather than cut it off.
  meshMaterial.alphaTest = 0.05;
  meshMaterial.alphaToCoverage = true;
  meshMaterial.cull = pc.CULLFACE_NONE;
  meshMaterial.twoSidedLighting = true;
  meshMaterial.update();
  const destroy = () => {
    root.destroy();
    meshMaterial.destroy();
    meshTexture.destroy();
  };

  const addMesh = (
    name: string,
    geometry: CourseClearingGeometry,
    material: pc.Material,
    castShadows = false,
  ) => {
    const mesh = new pc.Mesh(app.graphicsDevice);
    mesh.setPositions(geometry.positions);
    mesh.setNormals(geometry.normals);
    // The box primitive's streams, so it can join a finish's static batch.
    mesh.setUvs(0, geometry.uvs);
    mesh.setUvs(1, geometry.uvs);
    mesh.setIndices(geometry.indices);
    mesh.update();
    const entity = new pc.Entity(name);
    entity.addComponent("render", {
      castShadows,
      meshInstances: [new pc.MeshInstance(mesh, material)],
    });
    root.addChild(entity);
    return entity;
  };
  const axes = new pc.Mat4();
  const addSlab = (
    name: string,
    { center, forward, halfExtents, right, up }: (typeof ground.pieces)[number],
    physics: { friction: number; group: number; mask: number; restitution: number; tag: string },
  ) => {
    const entity = new pc.Entity(name);
    axes.data.set([right.x, right.y, right.z, 0, up.x, up.y, up.z, 0, forward.x, forward.y, forward.z, 0, 0, 0, 0, 1]);
    entity.setPosition(center.x, center.y, center.z);
    entity.setRotation(new pc.Quat().setFromMat4(axes));
    entity.tags.add(physics.tag);
    entity.addComponent("collision", {
      halfExtents: toVec3(halfExtents),
      type: "box",
    });
    entity.addComponent("rigidbody", {
      friction: physics.friction,
      group: physics.group,
      mask: physics.mask,
      restitution: physics.restitution,
      type: pc.BODYTYPE_STATIC,
    });
    root.addChild(entity);
    return entity;
  };

  try {
    const batched = [
      addMesh("course-clearing-ground", ground, lawn),
      // Posts cast shadows, as the course's other steel does, so they
      // share its batch.
      addMesh("course-clearing-fence-posts", fence.posts, steel, true),
    ];
    addMesh("course-clearing-fence-mesh", fence.panels, meshMaterial);

    const zero = { x: 0, y: 0, z: 0 };
    // Every slab resolves to the one lawn surface; no authored layer lies
    // on the clearing.
    const surface = {
      center: zero,
      collision: {
        ...COURSE_CLEARING_SURFACE,
        halfExtents: zero,
        offset: { position: zero, rotation: zero },
        role: "drivable-surface",
        shape: "box",
      },
      forward: { x: 0, y: 0, z: 1 },
      name: "course-clearing",
      normal: { x: 0, y: 1, z: 0 },
      right: { x: 1, y: 0, z: 0 },
    } as const;
    ground.pieces.forEach((piece, index) => {
      const name = `course-clearing-ground-${index + 1}`;
      const entity = addSlab(name, piece, {
        ...COURSE_CLEARING_SURFACE,
        group: PHYSICS_GROUP.drivableSurface,
        mask: PHYSICS_MASK.drivableSurface,
        tag: "drivable-surface",
      });
      registerDrivableSurfaceSupportShape(entity, {
        angularOffset: zero,
        halfExtents: piece.halfExtents,
        linearOffset: zero,
        shape: "box",
      });
      surfaceResolver.addStandaloneSurface(name, surface);
    });
    fence.colliders.forEach((collider, index) =>
      addSlab(`course-clearing-fence-${index + 1}`, collider, {
        friction: 0.6,
        group: PHYSICS_GROUP.solidObstacle,
        mask: PHYSICS_MASK.solidObstacle,
        restitution: 0,
        tag: "obstacle",
      }),
    );
    app.root.addChild(root);
    return { batched, destroy };
  } catch (error) {
    destroy();
    throw error;
  }
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

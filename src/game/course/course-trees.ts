import * as pc from "playcanvas";

import { PHYSICS_GROUP, PHYSICS_MASK } from "../physics/collision-groups";
import { createBicycleGeometry } from "./course-bicycle-geometry";
import type { CourseBicycle, CourseDocument } from "./course-document";
import {
  createCourseHedgeGeometry,
  createNurseryStakeGeometry,
  createNurseryTreeGeometry,
  getCourseTreeCollider,
  getCourseTreeInstances,
  NURSERY_TREE_VARIANTS,
  type TreeMeshData,
} from "./course-tree-geometry";

export type CourseLeafImages = {
  colour: HTMLImageElement;
  coverage: HTMLImageElement;
};

export type CourseTreeMaterials = ReturnType<typeof createCourseTreeMaterials>;

// Young bark, smooth and grey-brown.
const BARK_COLOR = "#6b6254";
// The scanned leaves, muted toward the course's olive turf.
const LEAF_TINT = [0.95, 1, 0.85] as const;

/**
 * Bark, the leaf sprays shared by trees and hedges, and the parked
 * bicycles' two finishes, for one scene. Without the leaf images there are
 * no leaves, and trees stand bare. The caller destroys them.
 */
export function createCourseTreeMaterials(
  device: pc.GraphicsDevice,
  leafImages: CourseLeafImages | null,
) {
  const bark = new pc.StandardMaterial();
  bark.diffuse = new pc.Color().fromString(BARK_COLOR);
  bark.useMetalness = true;
  bark.metalness = 0;
  bark.gloss = 0.15;
  bark.update();

  const textures: pc.Texture[] = [];
  const texture = (name: string, image: HTMLImageElement, format: number) => {
    const result = new pc.Texture(device, {
      addressU: pc.ADDRESS_CLAMP_TO_EDGE,
      addressV: pc.ADDRESS_CLAMP_TO_EDGE,
      format,
      magFilter: pc.FILTER_LINEAR,
      minFilter: pc.FILTER_LINEAR_MIPMAP_LINEAR,
      mipmaps: true,
      name,
    });
    result.setSource(image);
    textures.push(result);
    return result;
  };
  let leaves: pc.StandardMaterial | null = null;
  if (leafImages) {
    leaves = new pc.StandardMaterial();
    leaves.diffuseMap = texture(
      "course-leaves-colour",
      leafImages.colour,
      pc.PIXELFORMAT_SRGBA8,
    );
    leaves.diffuse = new pc.Color(...LEAF_TINT);
    // Vertex colours carry how much of the crown shades each spray.
    leaves.diffuseVertexColor = true;
    leaves.opacityMap = texture(
      "course-leaves-coverage",
      leafImages.coverage,
      pc.PIXELFORMAT_RGBA8,
    );
    leaves.opacityMapChannel = "r";
    leaves.alphaTest = 0.5;
    leaves.alphaToCoverage = true;
    leaves.cull = pc.CULLFACE_NONE;
    leaves.useMetalness = true;
    leaves.metalness = 0;
    leaves.gloss = 0.3;
    leaves.update();
  }
  // A bicycle's coated and rubber parts, and its bare metal, coloured per
  // vertex in linear albedo (see course-bicycle-geometry.ts).
  const bicycle = (metal: boolean) => {
    const material = new pc.StandardMaterial();
    material.diffuseVertexColor = true;
    material.useMetalness = true;
    material.metalness = metal ? 1 : 0;
    material.gloss = metal ? 0.65 : 0.4;
    material.update();
    return material;
  };
  const bicycleCoat = bicycle(false);
  const bicycleMetal = bicycle(true);
  return {
    bark,
    bicycleCoat,
    bicycleMetal,
    leaves,
    destroy() {
      bark.destroy();
      bicycleCoat.destroy();
      bicycleMetal.destroy();
      leaves?.destroy();
      textures.forEach((texture) => texture.destroy());
    },
  };
}

function createMesh(device: pc.GraphicsDevice, data: TreeMeshData) {
  const mesh = new pc.Mesh(device);
  mesh.setPositions(data.positions);
  mesh.setNormals(data.normals);
  if (data.uvs) mesh.setUvs(0, data.uvs);
  if (data.colors) mesh.setColors(data.colors);
  mesh.setIndices(data.indices);
  mesh.update();
  return mesh;
}

type Placed = {
  at: [number, number, number];
  size: number;
  transform: pc.Mat4;
};

function place(
  at: [number, number, number],
  yaw: number,
  size: number,
): Placed {
  return {
    at,
    size,
    transform: new pc.Mat4().setTRS(
      new pc.Vec3(...at),
      new pc.Quat().setFromEulerAngles(0, yaw, 0),
      new pc.Vec3(size, size, size),
    ),
  };
}

type Vec3 = [number, number, number];
type BicyclePart = { centre: Vec3; halfExtents: Vec3 };

// What a kart can hit of each bicycle, as boxes about its footprint's
// centre, on its floor: one around what lies below 0.35 m (as high as even a
// bouncing kart reaches) in each cell of a 3 x 3 grid over its footprint,
// none thinner than the kart's substeps allow for (0.1 m). Worked out once,
// offline, from points every 5 cm along its mesh edges, so a race builds
// none; the spec checks they still hold every vertex below 0.35 m.
const BICYCLE_PARTS: Record<CourseBicycle, BicyclePart[]> = {
  hardtail: [
    { centre: [-0.464, 0.175, 0.027], halfExtents: [0.149, 0.176, 0.063] },
    { centre: [-0.584, 0.175, 0.149], halfExtents: [0.294, 0.176, 0.063] },
    { centre: [-0.519, 0.173, 0.221], halfExtents: [0.228, 0.174, 0.051] },
    { centre: [-0.19, 0.149, 0.027], halfExtents: [0.103, 0.15, 0.063] },
    { centre: [-0.001, 0.175, 0.149], halfExtents: [0.292, 0.176, 0.063] },
    { centre: [-0.066, 0.164, 0.272], halfExtents: [0.181, 0.165, 0.063] },
    { centre: [0.53, 0.171, 0.074], halfExtents: [0.051, 0.172, 0.051] },
    { centre: [0.585, 0.175, 0.15], halfExtents: [0.293, 0.176, 0.062] },
    { centre: [0.532, 0.056, 0.221], halfExtents: [0.215, 0.057, 0.051] },
  ],
  bmx: [
    { centre: [-0.409, 0.175, 0.085], halfExtents: [0.189, 0.176, 0.051] },
    { centre: [-0.442, 0.175, 0.194], halfExtents: [0.223, 0.176, 0.089] },
    { centre: [-0.433, 0.081, 0.336], halfExtents: [0.206, 0.082, 0.056] },
    { centre: [-0.055, 0.175, 0.018], halfExtents: [0.168, 0.176, 0.088] },
    { centre: [-0.052, 0.175, 0.193], halfExtents: [0.169, 0.176, 0.088] },
    { centre: [-0.124, 0.115, 0.373], halfExtents: [0.096, 0.116, 0.086] },
    { centre: [0.496, 0.174, 0.047], halfExtents: [0.166, 0.176, 0.06] },
    { centre: [0.447, 0.175, 0.194], halfExtents: [0.218, 0.176, 0.089] },
    { centre: [0.415, 0.168, 0.353], halfExtents: [0.187, 0.17, 0.073] },
  ],
};

function span(values: number[]) {
  let [low, high] = [Infinity, -Infinity];
  for (const value of values) {
    low = Math.min(low, value);
    high = Math.max(high, value);
  }
  return [low, high] as const;
}

// Each bicycle variant's geometry, built once (it takes 5 to 40 ms) and
// only for the variants a course parks, with its footprint's centre.
const bicycleGeometry = new Map<
  CourseBicycle,
  ReturnType<typeof createBicycleGeometry> & { centre: [number, number] }
>();
function getBicycleGeometry(bicycle: CourseBicycle) {
  let geometry = bicycleGeometry.get(bicycle);
  if (!geometry) {
    const built = createBicycleGeometry(bicycle);
    const meshes = [built.dielectric, built.metal];
    const along = (axis: number) =>
      span(
        meshes.flatMap(({ positions }) =>
          positions.filter((_, index) => index % 3 === axis),
        ),
      );
    const [left, right] = along(0);
    const [near, far] = along(2);
    const centre: [number, number] = [(left + right) / 2, (near + far) / 2];
    geometry = { ...built, centre };
    bicycleGeometry.set(bicycle, geometry);
  }
  return geometry;
}

/**
 * Every bicycle's colliders in course space, as static boxes: one around
 * what a kart can reach in each cell of a grid over it, turned with it.
 */
export function getCourseBicycleColliders(document: CourseDocument) {
  return document.objects.flatMap(({ bicycle, transform, visual }) => {
    if (!bicycle || visual.shape !== "box") return [];
    const parts = BICYCLE_PARTS[bicycle];
    const yaw = (transform.rotation.y * Math.PI) / 180;
    const [cos, sin] = [Math.cos(yaw), Math.sin(yaw)];
    const floor = transform.position.y - visual.scale.y / 2;
    return parts.map(({ centre: [x, y, z], halfExtents }) => ({
      halfExtents,
      position: [
        transform.position.x + x * cos + z * sin,
        floor + y,
        transform.position.z - x * sin + z * cos,
      ] as Vec3,
      yaw: transform.rotation.y,
    }));
  });
}

/**
 * Both finishes of every parked bicycle, each merged into one mesh in course
 * space: a bicycle stands centred in its box, on its floor, turned with it.
 */
export function createCourseBicycleGeometry(document: CourseDocument) {
  const merged = {
    coat: {
      colors: [],
      indices: [],
      normals: [],
      positions: [],
    } as TreeMeshData,
    metal: {
      colors: [],
      indices: [],
      normals: [],
      positions: [],
    } as TreeMeshData,
  };
  document.objects.forEach(({ bicycle, transform, visual }) => {
    if (!bicycle || visual.shape !== "box") return;
    const bike = getBicycleGeometry(bicycle);
    const [cx, cz] = bike.centre;
    const yaw = (transform.rotation.y * Math.PI) / 180;
    const [cos, sin] = [Math.cos(yaw), Math.sin(yaw)];
    const { x, z } = transform.position;
    const y = transform.position.y - visual.scale.y / 2;
    for (const [part, data] of [
      [merged.coat, bike.dielectric],
      [merged.metal, bike.metal],
    ] as const) {
      const first = part.positions.length / 3;
      const { colors, indices, normals, positions } = data;
      for (let index = 0; index < positions.length; index += 3) {
        const px = positions[index]! - cx;
        const pz = positions[index + 2]! - cz;
        const [nx, nz] = [normals[index]!, normals[index + 2]!];
        // A turn about +Y by the yaw, as the engine's Euler angles turn.
        part.positions.push(
          x + px * cos + pz * sin,
          y + positions[index + 1]!,
          z - px * sin + pz * cos,
        );
        part.normals.push(
          nx * cos + nz * sin,
          normals[index + 1]!,
          -nx * sin + nz * cos,
        );
      }
      for (const value of colors!) part.colors!.push(value);
      for (const corner of indices) part.indices.push(corner + first);
    }
  });
  return merged;
}

/**
 * Plants the course's trees, dresses its hedges, and parks its bicycles
 * under one root entity: each tree variant's bark and leaves, and every
 * stake, as one instanced draw each, culled as a whole, the hedges' leaves
 * as one mesh, and the bicycles' two finishes as one mesh each. With
 * `colliders`, each tree also gets a static box taking in its stem and
 * stake, and each bicycle boxes around what a kart can reach of it;
 * untagged as obstacles, they leave the chase camera's view clear.
 */
export function addCourseTrees(
  app: pc.AppBase,
  document: CourseDocument,
  {
    colliders,
    materials,
    timber,
  }: {
    colliders: boolean;
    materials: CourseTreeMaterials;
    timber: pc.Material;
  },
) {
  const device = app.graphicsDevice;
  const root = new pc.Entity("course-trees");
  const buffers: pc.VertexBuffer[] = [];
  const trees = getCourseTreeInstances(document);

  const addDraw = (
    name: string,
    data: TreeMeshData,
    material: pc.Material,
    placed?: Placed[],
    castShadows = true,
  ) => {
    if ((placed && placed.length === 0) || data.indices.length === 0) return;
    const meshInstance = new pc.MeshInstance(
      createMesh(device, data),
      material,
    );
    let bounds: pc.BoundingBox | null = null;
    if (placed) {
      const matrices = new Float32Array(placed.length * 16);
      placed.forEach(({ transform }, index) =>
        matrices.set(transform.data, index * 16),
      );
      const buffer = new pc.VertexBuffer(
        device,
        pc.VertexFormat.getDefaultInstancingFormat(device),
        placed.length,
        { data: matrices.buffer },
      );
      buffers.push(buffer);
      meshInstance.setInstancing(buffer, true);
      // Culled as one: every instance, turned any way, from its foot to
      // its top and out to its widest reach.
      let top = 0;
      let reach = 0;
      const { positions } = data;
      for (let index = 0; index < positions.length; index += 3) {
        top = Math.max(top, positions[index + 1]!);
        reach = Math.max(
          reach,
          Math.hypot(positions[index]!, positions[index + 2]!),
        );
      }
      const min = new pc.Vec3(Infinity, Infinity, Infinity);
      const max = new pc.Vec3(-Infinity, -Infinity, -Infinity);
      placed.forEach(({ at: [x, y, z], size }) => {
        const out = reach * size;
        min.min(new pc.Vec3(x - out, y, z - out));
        max.max(new pc.Vec3(x + out, y + top * size, z + out));
      });
      bounds = new pc.BoundingBox();
      bounds.setMinMax(min, max);
    }
    const entity = new pc.Entity(name);
    entity.addComponent("render", {
      castShadows,
      meshInstances: [meshInstance],
    });
    // The render component owns its mesh instances' bounds.
    if (bounds) entity.render!.customAabb = bounds;
    root.addChild(entity);
  };

  for (let variant = 0; variant < NURSERY_TREE_VARIANTS; variant++) {
    const placed = trees
      .filter((tree) => tree.variant === variant)
      .map((tree) => place(tree.position, tree.yaw, tree.scale));
    if (placed.length === 0) continue;
    const geometry = createNurseryTreeGeometry(variant);
    addDraw(
      `course-tree-bark-${variant}`,
      geometry.bark,
      materials.bark,
      placed,
    );
    if (materials.leaves) {
      addDraw(
        `course-tree-leaves-${variant}`,
        geometry.leaves,
        materials.leaves,
        placed,
      );
    }
  }
  if (trees.length > 0) {
    addDraw(
      "course-tree-stakes",
      createNurseryStakeGeometry(),
      timber,
      trees.map((tree) => place(tree.stake, 0, 1)),
    );
  }
  const bicycles = createCourseBicycleGeometry(document);
  addDraw("course-bicycle-coat", bicycles.coat, materials.bicycleCoat);
  // Spokes and chain are too fine for a shadow map to draw.
  addDraw(
    "course-bicycle-metal",
    bicycles.metal,
    materials.bicycleMetal,
    undefined,
    false,
  );
  if (materials.leaves) {
    // The hedge's box beneath already casts its shadow.
    addDraw(
      "course-hedge-leaves",
      createCourseHedgeGeometry(document),
      materials.leaves,
      undefined,
      false,
    );
  }

  if (colliders) {
    const addCollider = (
      name: string,
      { halfExtents, position, yaw }: ReturnType<typeof getCourseTreeCollider>,
    ) => {
      const collider = new pc.Entity(name);
      collider.setPosition(...position);
      collider.setEulerAngles(0, yaw, 0);
      collider.addComponent("collision", {
        halfExtents: new pc.Vec3(...halfExtents),
        type: "box",
      });
      collider.addComponent("rigidbody", {
        friction: 0.6,
        group: PHYSICS_GROUP.solidObstacle,
        mask: PHYSICS_MASK.solidObstacle,
        restitution: 0,
        type: pc.BODYTYPE_STATIC,
      });
      root.addChild(collider);
    };
    getCourseBicycleColliders(document).forEach((box, index) =>
      addCollider(`course-bicycle-collider-${index + 1}`, box),
    );
    trees.forEach((tree, index) =>
      addCollider(
        `course-tree-collider-${index + 1}`,
        getCourseTreeCollider(tree),
      ),
    );
  }

  app.root.addChild(root);
  return {
    root,
    destroy() {
      root.destroy();
      buffers.forEach((buffer) => buffer.destroy());
    },
  };
}

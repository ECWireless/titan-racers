import * as pc from "playcanvas";

import { PHYSICS_GROUP, PHYSICS_MASK } from "../physics/collision-groups";
import { createBicycleGeometry } from "./course-bicycle-geometry";
import { COURSE_BICYCLES, type CourseDocument } from "./course-document";
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

// A bicycle collides only as high as a kart reaches, even a bouncing one.
const BICYCLE_COLLIDER_HEIGHT = 0.35;
// Its colliders: a box around what lies in each cell of a grid over its
// footprint, along and across it, so they follow its outline.
const BICYCLE_COLLIDER_CELLS = 3;
// Points taken along each mesh edge, so a long tube fills every cell it
// crosses.
const BICYCLE_COLLIDER_SPACING = 0.05;
// No collider is thinner than the kart's substeps allow for (0.1 m).
const BICYCLE_COLLIDER_MIN_HALF = 0.05;

type Vec3 = [number, number, number];
type BicyclePart = { centre: Vec3; halfExtents: Vec3 };

function span(values: number[]) {
  let [low, high] = [Infinity, -Infinity];
  for (const value of values) {
    low = Math.min(low, value);
    high = Math.max(high, value);
  }
  return [low, high] as const;
}

// What a kart can hit of a bicycle, as boxes about its footprint's centre.
function getBicycleParts(
  meshes: TreeMeshData[],
  centre: [number, number],
): BicyclePart[] {
  const points: Vec3[] = [];
  for (const { indices, positions } of meshes) {
    const corner = (k: number): Vec3 => [
      positions[k * 3]!,
      positions[k * 3 + 1]!,
      positions[k * 3 + 2]!,
    ];
    for (let index = 0; index < indices.length; index += 3) {
      for (let side = 0; side < 3; side++) {
        const a = corner(indices[index + side]!);
        const b = corner(indices[index + ((side + 1) % 3)]!);
        if (Math.min(a[1], b[1]) >= BICYCLE_COLLIDER_HEIGHT) continue;
        const steps = Math.ceil(
          Math.hypot(b[0] - a[0], b[1] - a[1], b[2] - a[2]) /
            BICYCLE_COLLIDER_SPACING,
        );
        for (let step = 0; step <= steps; step++) {
          const t = step / Math.max(steps, 1);
          const point: Vec3 = [
            a[0] + (b[0] - a[0]) * t,
            a[1] + (b[1] - a[1]) * t,
            a[2] + (b[2] - a[2]) * t,
          ];
          if (point[1] < BICYCLE_COLLIDER_HEIGHT) points.push(point);
        }
      }
    }
  }
  const [left, right] = span(points.map(([x]) => x));
  const [near, far] = span(points.map(([, , z]) => z));
  const cell = (value: number, low: number, high: number) =>
    Math.min(
      Math.floor(((value - low) / (high - low)) * BICYCLE_COLLIDER_CELLS),
      BICYCLE_COLLIDER_CELLS - 1,
    );
  const cells = new Map<number, Vec3[]>();
  for (const point of points) {
    const key =
      cell(point[0], left, right) * BICYCLE_COLLIDER_CELLS +
      cell(point[2], near, far);
    const inCell = cells.get(key);
    if (inCell) inCell.push(point);
    else cells.set(key, [point]);
  }
  const half = ([a, b]: readonly [number, number]) =>
    Math.max((b - a) / 2, BICYCLE_COLLIDER_MIN_HALF);
  return [...cells.keys()]
    .sort((a, b) => a - b)
    .map((key) => {
      const inCell = cells.get(key)!;
      const xs = span(inCell.map(([x]) => x));
      const top = span(inCell.map(([, y]) => y))[1];
      const zs = span(inCell.map(([, , z]) => z));
      return {
        centre: [
          (xs[0] + xs[1]) / 2 - centre[0],
          top / 2,
          (zs[0] + zs[1]) / 2 - centre[1],
        ] as Vec3,
        halfExtents: [
          half(xs),
          Math.max(top / 2, BICYCLE_COLLIDER_MIN_HALF),
          half(zs),
        ] as Vec3,
      };
    });
}

// Each bicycle variant's geometry, built once (it takes 5 to 40 ms) and
// only for the variants a course parks, with its footprint's centre; its
// colliders about that centre are worked out only when a race asks.
const bicycleGeometry = new Map<
  number,
  ReturnType<typeof createBicycleGeometry> & {
    centre: [number, number];
    parts?: BicyclePart[];
  }
>();
function getBicycleGeometry(variant: number) {
  let geometry = bicycleGeometry.get(variant);
  if (!geometry) {
    const built = createBicycleGeometry(variant);
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
    bicycleGeometry.set(variant, geometry);
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
    const bike = getBicycleGeometry(COURSE_BICYCLES.indexOf(bicycle));
    bike.parts ??= getBicycleParts([bike.dielectric, bike.metal], bike.centre);
    const { parts } = bike;
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
    const bike = getBicycleGeometry(COURSE_BICYCLES.indexOf(bicycle));
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
    getCourseBicycleColliders(document).forEach(
      ({ halfExtents, position, yaw }, index) => {
        const collider = new pc.Entity(`course-bicycle-collider-${index + 1}`);
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
      },
    );
    trees.forEach((tree, index) => {
      const { halfExtents, position, yaw } = getCourseTreeCollider(tree);
      const collider = new pc.Entity(`course-tree-collider-${index + 1}`);
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
    });
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

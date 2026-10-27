import * as pc from "playcanvas";

import { PHYSICS_GROUP, PHYSICS_MASK } from "../physics/collision-groups";
import type { CourseDocument } from "./course-document";
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
 * Bark, and the leaf sprays shared by trees and hedges, for one scene.
 * Without the leaf images there are no leaves, and trees stand bare. The
 * caller destroys them.
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
  return {
    bark,
    leaves,
    destroy() {
      bark.destroy();
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

/**
 * Plants the course's trees and dresses its hedges under one root entity:
 * each tree variant's bark and leaves, and every stake, as one instanced
 * draw each, culled as a whole, and the hedges' leaves as one mesh. With
 * `colliders`, each tree also gets a static box taking in its stem and
 * stake; untagged as an obstacle, it leaves the chase camera's view clear.
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

import * as pc from "playcanvas";

import { PHYSICS_GROUP, PHYSICS_MASK } from "../physics/collision-groups";
import { rotateByEulerAngles, type CourseDocument } from "./course-document";
import {
  buildParkBench,
  buildParkBin,
  buildParkFlowerBed,
  buildParkOrnamentalTree,
  buildParkShadeTree,
  buildParkShrub,
  createEmptyParkMeshes,
  PARK_FINISHES,
  type ParkGeometry,
} from "./course-park-geometry";
import { hashString } from "./course-tree-geometry";
import type { CourseTreeMaterials } from "./course-trees";

type V = [number, number, number];

let bench: ParkGeometry | undefined;
let bin: ParkGeometry | undefined;
let cached:
  | { key: string; geometry: ReturnType<typeof buildCourseParkGeometry> }
  | undefined;

/**
 * A course's park pieces in place, merged by finish, with their collision
 * boxes. Built once per page for the last document asked for, and shared
 * by the editor and the race; callers read it and never change it.
 */
export function getCourseParkGeometry(document: CourseDocument) {
  const objects = document.objects.filter(
    (object) => object.park && object.availability === "standard",
  );
  const key = JSON.stringify(objects);
  if (cached?.key !== key) {
    cached = { key, geometry: buildCourseParkGeometry(objects) };
  }
  return cached.geometry;
}

function buildCourseParkGeometry(objects: CourseDocument["objects"]) {
  const meshes = createEmptyParkMeshes();
  const colliders: Array<{
    center: V;
    halfExtents: V;
    id: string;
    tree: boolean;
    yaw: number;
  }> = [];
  for (const object of objects) {
    if (!object.park || object.visual.shape !== "box") continue;
    const kind = object.park;
    // Each tree, shrub, and bed grows its own way, by its ID.
    const value = hashString(object.id);
    const size = object.visual.scale;
    const geometry =
      kind === "bench"
        ? (bench ??= buildParkBench())
        : kind === "bin"
          ? (bin ??= buildParkBin())
          : kind === "shade-tree"
            ? buildParkShadeTree(value)
            : kind === "ornamental-tree"
              ? buildParkOrnamentalTree(value)
              : kind === "shrub"
                ? buildParkShrub(value)
                : buildParkFlowerBed(size, value);
    // The editor can express an upright yaw as (180, 180 - y, 180).
    const right = rotateByEulerAngles(object.transform.rotation, {
      x: 1,
      y: 0,
      z: 0,
    });
    const angle = Math.atan2(-right.z, right.x);
    const cos = Math.cos(angle);
    const sin = Math.sin(angle);
    // A piece stands on its box's base.
    const { x, z } = object.transform.position;
    const base = object.transform.position.y - size.y / 2;
    for (const finish of PARK_FINISHES) {
      const target = meshes[finish];
      const source = geometry.meshes[finish];
      const first = target.positions.length / 3;
      const { positions, normals } = source;
      for (let i = 0; i < positions.length; i += 3) {
        target.positions.push(
          positions[i]! * cos + positions[i + 2]! * sin + x,
          positions[i + 1]! + base,
          -positions[i]! * sin + positions[i + 2]! * cos + z,
        );
        target.normals.push(
          normals[i]! * cos + normals[i + 2]! * sin,
          normals[i + 1]!,
          -normals[i]! * sin + normals[i + 2]! * cos,
        );
      }
      for (const index of source.indices) target.indices.push(first + index);
      for (const value of source.colors!) target.colors!.push(value);
      for (const value of source.uvs!) target.uvs!.push(value);
    }
    for (const box of geometry.colliders) {
      const [cx, cy, cz] = box.center;
      colliders.push({
        center: [cx * cos + cz * sin + x, cy + base, -cx * sin + cz * cos + z],
        halfExtents: box.halfExtents,
        id: object.id,
        tree: kind === "shade-tree" || kind === "ornamental-tree",
        yaw: (angle * 180) / Math.PI,
      });
    }
  }
  return { meshes, colliders };
}

/**
 * Draws a course's park furniture and planting as one mesh per finish, in
 * the course's own timber, kerb concrete, and mulch, the trees' bark and
 * leaves, and the bicycles' coating. With `colliders`, each piece also
 * gets its static boxes; a tree's trunk is untagged as an obstacle, so the
 * chase camera looks past it. Destroying the returned entity frees it all.
 */
export function addCoursePark(
  app: pc.AppBase,
  document: CourseDocument,
  {
    colliders,
    materials,
    surfaces,
  }: {
    colliders: boolean;
    materials: CourseTreeMaterials;
    surfaces: Record<"kerb" | "mulch" | "timber", pc.Material>;
  },
) {
  const root = new pc.Entity("course-park");
  const geometry = getCourseParkGeometry(document);
  if (geometry.colliders.length === 0) return root;
  // Flower rays and stalks are single sheets, lit on both faces.
  const solid = materials.bicycleCoat.clone();
  solid.cull = pc.CULLFACE_NONE;
  solid.twoSidedLighting = true;
  solid.update();
  root.on("destroy", () => solid.destroy());
  const finishes: Record<(typeof PARK_FINISHES)[number], pc.Material | null> = {
    timber: surfaces.timber,
    solid,
    bark: materials.bark,
    boughs: materials.boughs,
    leaves: materials.leaves,
    kerb: surfaces.kerb,
    mulch: surfaces.mulch,
  };
  for (const finish of PARK_FINISHES) {
    const material = finishes[finish];
    const data = geometry.meshes[finish];
    if (!material || data.indices.length === 0) continue;
    const mesh = new pc.Mesh(app.graphicsDevice);
    mesh.setPositions(data.positions);
    mesh.setNormals(data.normals);
    mesh.setUvs(0, data.uvs!);
    mesh.setColors(data.colors!);
    mesh.setIndices(data.indices);
    mesh.update();
    const entity = new pc.Entity(`course-park-${finish}`);
    entity.addComponent("render", {
      // A bed's soil and its flowers' leaves lie inside its kerbs' shadow.
      castShadows: finish !== "leaves" && finish !== "mulch",
      meshInstances: [new pc.MeshInstance(mesh, material)],
    });
    root.addChild(entity);
  }
  if (colliders) {
    geometry.colliders.forEach((box, index) => {
      const entity = new pc.Entity(`${box.id}-collision-${index}`);
      entity.setPosition(...box.center);
      entity.setEulerAngles(0, box.yaw, 0);
      if (!box.tree) entity.tags.add("obstacle");
      entity.addComponent("collision", {
        type: "box",
        halfExtents: new pc.Vec3(...box.halfExtents),
      });
      entity.addComponent("rigidbody", {
        type: pc.BODYTYPE_STATIC,
        friction: 0.6,
        restitution: 0,
        group: PHYSICS_GROUP.solidObstacle,
        mask: PHYSICS_MASK.solidObstacle,
      });
      root.addChild(entity);
    });
  }
  return root;
}

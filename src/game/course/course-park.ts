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

type V = [number, number, number];

let bench: ParkGeometry | undefined;
let bin: ParkGeometry | undefined;
let cached:
  | { key: string; geometry: ReturnType<typeof buildCourseParkGeometry> }
  | undefined;

/**
 * A course's park pieces in place, merged by finish, with their collision
 * boxes: course-trees.ts draws one mesh per finish and adds the boxes.
 * Built once per page for the last document asked for, and shared by the
 * editor and the race; callers read it and never change it.
 */
export function getCourseParkGeometry(document: CourseDocument) {
  const objects = document.objects.filter((object) => object.park);
  const key = JSON.stringify(objects);
  if (cached?.key !== key) {
    cached = { key, geometry: buildCourseParkGeometry(objects) };
  }
  return cached.geometry;
}

function buildCourseParkGeometry(objects: CourseDocument["objects"]) {
  const meshes = createEmptyParkMeshes();
  const colliders: Array<{
    halfExtents: V;
    id: string;
    position: V;
    /** A tree's trunk, which the chase camera looks past. */
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
                : buildParkFlowerBed(value);
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
        halfExtents: box.halfExtents,
        id: object.id,
        position: [cx * cos + cz * sin + x, cy + base, -cx * sin + cz * cos + z],
        tree: kind === "shade-tree" || kind === "ornamental-tree",
        yaw: (angle * 180) / Math.PI,
      });
    }
  }
  return { meshes, colliders };
}

import { expect, test } from "@playwright/test";

import {
  type CourseDocument,
  FALLS_VIEW_PARK_DOCUMENT,
  isCoursePrimitiveObject,
} from "../src/game/course/course-document";
import {
  createCourseHedgeGeometry,
  createNurseryTreeGeometry,
  getCourseTreeInstances,
  NURSERY_TREE,
  NURSERY_TREE_VARIANTS,
} from "../src/game/course/course-tree-geometry";

function withObjects(...objects: CourseDocument["objects"]) {
  const block = FALLS_VIEW_PARK_DOCUMENT.objects
    .filter(isCoursePrimitiveObject)
    .find((object) => object.collision?.role === "solid-obstacle")!;
  return {
    ...structuredClone(FALLS_VIEW_PARK_DOCUMENT),
    objects: objects.map((object) => ({
      ...structuredClone(block),
      ...object,
    })),
  } as CourseDocument;
}

const bed = {
  id: "bed",
  planting: { across: 1.5, along: 1.2 },
  transform: {
    position: { x: 10, y: 0.1, z: -4 },
    rotation: { x: 0, y: 90, z: 0 },
  },
  visual: { material: "mulch", scale: { x: 6, y: 0.2, z: 6 }, shape: "box" },
} as CourseDocument["objects"][number];

test("plants a bed's trees in rows on its top, the same way every time", () => {
  const document = withObjects(bed);
  const trees = getCourseTreeInstances(document);

  // Five 1.2 m apart along the bed's local X, in four rows 1.5 m apart.
  expect(trees).toHaveLength(20);
  expect(getCourseTreeInstances(document)).toEqual(trees);
  for (const tree of trees) {
    expect(tree.position[1]).toBeCloseTo(0.2);
    // Each stake stands 6 cm toward its bed's local +X: world -Z here.
    expect(tree.stake[0]).toBeCloseTo(tree.position[0]);
    expect(tree.stake[2]).toBeCloseTo(
      tree.position[2] - NURSERY_TREE.stake.offset,
    );
  }
  // Turned 90°, the bed's rows run along world -Z, centred on it.
  const xs = [...new Set(trees.map((tree) => tree.position[0].toFixed(3)))];
  const zs = [...new Set(trees.map((tree) => tree.position[2].toFixed(3)))];
  expect(xs.map(Number).sort((a, b) => a - b)).toEqual([
    7.75, 9.25, 10.75, 12.25,
  ]);
  expect(zs.map(Number).sort((a, b) => a - b)).toEqual([
    -6.4, -5.2, -4, -2.8, -1.6,
  ]);
  expect(new Set(trees.map((tree) => tree.variant)).size).toBeGreaterThan(1);
});

test("builds young trees at real size within a small triangle budget", () => {
  for (let variant = 0; variant < NURSERY_TREE_VARIANTS; variant++) {
    const { bark, leaves } = createNurseryTreeGeometry(variant);
    const heights = (positions: number[]) =>
      positions.filter((_, index) => index % 3 === 1);
    // The leader tops out at 3.2 m; sprays reach a little above it.
    expect(Math.max(...heights(bark.positions))).toBeCloseTo(
      NURSERY_TREE.height,
      1,
    );
    expect(Math.max(...heights(leaves.positions))).toBeLessThan(3.8);
    // No spray hangs below the clear stem.
    expect(Math.min(...heights(leaves.positions))).toBeGreaterThan(
      NURSERY_TREE.clearStem - 0.1,
    );
    // About 300 triangles a tree.
    const triangles = (bark.indices.length + leaves.indices.length) / 3;
    expect(triangles).toBeLessThan(320);
    // Stems face outward: each triangle winds the way its normals point.
    const vertex = (index: number, data: number[]) =>
      data.slice(index * 3, index * 3 + 3);
    for (let index = 0; index < bark.indices.length; index += 3) {
      const corners = [0, 1, 2].map((k) => bark.indices[index + k]!);
      const [a, b, c] = corners.map((k) => vertex(k, bark.positions));
      const normal = corners
        .map((k) => vertex(k, bark.normals))
        .reduce((sum, n) => sum.map((value, axis) => value + n[axis]!));
      const ab = b!.map((value, axis) => value - a![axis]!);
      const ac = c!.map((value, axis) => value - a![axis]!);
      const face = [
        ab[1]! * ac[2]! - ab[2]! * ac[1]!,
        ab[2]! * ac[0]! - ab[0]! * ac[2]!,
        ab[0]! * ac[1]! - ab[1]! * ac[0]!,
      ];
      const cosine =
        face.reduce((sum, value, axis) => sum + value * normal[axis]!, 0) /
        (Math.hypot(...face) * Math.hypot(...normal));
      expect(cosine).toBeGreaterThan(0.5);
    }
    expect(leaves.uvs!.length / 2).toBe(leaves.positions.length / 3);
    expect(leaves.colors!.length / 4).toBe(leaves.positions.length / 3);
  }
});

test("covers a hedge's sides and top with leaf sprays by area", () => {
  const hedge = {
    id: "hedge",
    transform: {
      position: { x: 0, y: 1.2, z: 0 },
      rotation: { x: 0, y: 0, z: 0 },
    },
    visual: {
      material: "hedge",
      scale: { x: 1.2, y: 2.4, z: 10 },
      shape: "box",
    },
  } as CourseDocument["objects"][number];
  const leaves = createCourseHedgeGeometry(withObjects(hedge, bed));
  const area = 2 * (1.2 * 2.4) + 2 * (10 * 2.4) + 1.2 * 10;

  // About 24 sprays a square metre.
  expect(leaves.indices.length / 6).toBeCloseTo(area * 24, -1);
  // Sprays lie close along its faces, never far inside or outside them.
  for (let index = 0; index < leaves.positions.length; index += 3) {
    expect(Math.abs(leaves.positions[index]!)).toBeLessThan(0.6 + 0.35);
    expect(Math.abs(leaves.positions[index + 2]!)).toBeLessThan(5 + 0.35);
    expect(leaves.positions[index + 1]!).toBeGreaterThan(-0.05);
    expect(leaves.positions[index + 1]!).toBeLessThan(2.4 + 0.35);
  }
  expect(createCourseHedgeGeometry(withObjects(bed)).indices).toHaveLength(0);
});

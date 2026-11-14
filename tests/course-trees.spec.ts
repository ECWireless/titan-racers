import { expect, test } from "@playwright/test";

import {
  type CourseDocument,
  FALLS_VIEW_PARK_DOCUMENT,
  isCoursePrimitiveObject,
} from "../src/game/course/course-document";
import {
  createCourseHedgeCoreGeometry,
  createCourseHedgeGeometry,
  growCourseHedgeGeometry,
  HEDGE_SPRAYS_PER_BOUGH,
} from "../src/game/course/course-hedge-geometry";
import {
  createNurseryTreeGeometry,
  getCourseTreeCollider,
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

test("gives each tree one box round its stem and stake", () => {
  const { radius } = NURSERY_TREE.stake;
  const stem = NURSERY_TREE.trunk.baseRadius;
  for (const tree of getCourseTreeInstances(withObjects(bed))) {
    const { halfExtents, position, yaw } = getCourseTreeCollider(tree);
    // A point's place in the box: along its local X, and across its local Z.
    const local = ([x, , z]: number[]) => {
      const [dx, dz] = [x! - position[0], z! - position[2]];
      const angle = (yaw * Math.PI) / 180;
      return [
        dx * Math.cos(angle) - dz * Math.sin(angle),
        dx * Math.sin(angle) + dz * Math.cos(angle),
      ];
    };
    const [stemAlong, stemAcross] = local(tree.position);
    const [stakeAlong, stakeAcross] = local(tree.stake);
    // The stem's far side and the stake's meet the box's ends.
    expect(Math.abs(stemAlong!) + stem).toBeCloseTo(halfExtents[0]);
    expect(Math.abs(stakeAlong!) + radius).toBeCloseTo(halfExtents[0]);
    expect(Math.sign(stemAlong!)).toBe(-Math.sign(stakeAlong!));
    expect(Math.abs(stemAcross!)).toBeLessThan(1e-9);
    expect(Math.abs(stakeAcross!)).toBeLessThan(1e-9);
    expect(halfExtents[2]).toBe(radius);
    // It stands on the bed, up past the stake's top.
    expect(position[1] - halfExtents[1]).toBeCloseTo(tree.position[1]);
    expect(halfExtents[1] * 2).toBeGreaterThan(NURSERY_TREE.stake.height);
  }
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

test("covers a hedge's clipped faces and top with boughs by area, over its core", () => {
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

  // A bough for every two sprays: about 12 a square metre.
  expect(leaves.indices.length / 6).toBeCloseTo(
    (area * 24) / HEDGE_SPRAYS_PER_BOUGH,
    -1,
  );
  // Boughs keep to the box, but for a shoot's tip, and above the lawn.
  let foot = 0;
  let head = 0;
  for (let index = 0; index < leaves.positions.length; index += 3) {
    const [x, y, z] = leaves.positions.slice(index, index + 3) as [number, number, number];
    expect(Math.abs(x)).toBeLessThan(0.6 + 0.07);
    expect(Math.abs(z)).toBeLessThan(5 + 0.07);
    expect(y).toBeGreaterThan(0);
    expect(y).toBeLessThan(2.4 + 0.07);
    if (y < 0.5) foot = Math.max(foot, Math.abs(x));
    if (y > 2) head = Math.max(head, Math.abs(x));
  }
  // Its faces lean in toward a narrower top.
  expect(head).toBeLessThan(foot - 0.08);
  // The core stands inside them, 0.2 m back at its foot and more above.
  const core = createCourseHedgeCoreGeometry({ x: 1.2, y: 2.4, z: 10 });
  // Closed: four sides, a top, and a foot.
  expect(core.indices).toHaveLength(6 * 6);
  for (let index = 0; index < core.positions.length; index += 3) {
    const x = core.positions[index]! * 1.2;
    const y = core.positions[index + 1]! * 2.4;
    expect(Math.abs(x)).toBeLessThanOrEqual(y < 0 ? 0.4 + 1e-9 : 0.2);
    expect(y).toBeLessThanOrEqual(1.2 - 0.26 + 1e-9);
  }
  expect(createCourseHedgeGeometry(withObjects(bed)).indices).toHaveLength(0);
});

test("hedges grown a few boughs at a time are the hedges built at once", () => {
  const hedge = (id: string) =>
    ({
      id,
      transform: {
        position: { x: 0, y: 1.2, z: 0 },
        rotation: { x: 0, y: 40, z: 0 },
      },
      visual: { material: "hedge", scale: { x: 1.2, y: 2.4, z: 6 }, shape: "box" },
    }) as CourseDocument["objects"][number];
  const whole = structuredClone(
    createCourseHedgeGeometry(withObjects(hedge("a"), hedge("b"))),
  );
  // Another course's hedges take the cache, so these start over.
  createCourseHedgeGeometry(withObjects(hedge("c")));
  let slices = 0;
  let grown = growCourseHedgeGeometry(withObjects(hedge("a"), hedge("b")), 0);
  while (!grown) {
    slices++;
    grown = growCourseHedgeGeometry(withObjects(hedge("a"), hedge("b")), 0);
  }
  expect(slices).toBeGreaterThan(5);
  expect(grown).toEqual(whole);
  // Whole, they are handed back as they are.
  expect(growCourseHedgeGeometry(withObjects(hedge("a"), hedge("b")), 0)).toBe(grown);
});

test("a low, thin, or turned hedge keeps its boughs to its box", () => {
  for (const [x, y, z] of [
    [1.2, 0.4, 3],
    [1.2, 0.1, 6],
    [0.3, 2.4, 3],
    [0.3, 0.3, 2],
    [6, 5, 1.2],
  ] as const) {
    const hedge = {
      id: `hedge-${x}-${y}-${z}`,
      transform: {
        position: { x: 20, y: 3 + y / 2, z: -7 },
        rotation: { x: 0, y: 30, z: 0 },
      },
      visual: { material: "hedge", scale: { x, y, z }, shape: "box" },
    } as CourseDocument["objects"][number];
    const leaves = createCourseHedgeGeometry(withObjects(hedge));
    expect(leaves.indices.length).toBeGreaterThan(0);
    const cos = Math.cos(Math.PI / 6);
    const sin = Math.sin(Math.PI / 6);
    let outside = 0;
    for (let index = 0; index < leaves.positions.length; index += 3) {
      // Back into the hedge's own frame, about its box's centre.
      const dx = leaves.positions[index]! - 20;
      const dz = leaves.positions[index + 2]! + 7;
      outside = Math.max(
        outside,
        Math.abs(dx * cos - dz * sin) - x / 2,
        Math.abs(dx * sin + dz * cos) - z / 2,
        Math.abs(leaves.positions[index + 1]! - 3 - y / 2) - y / 2,
      );
      expect(Math.hypot(...leaves.normals.slice(index, index + 3))).toBeCloseTo(1, 5);
    }
    expect(outside, hedge.id).toBeLessThan(0.07);
  }
});

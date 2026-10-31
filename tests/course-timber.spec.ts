import { expect, test } from "@playwright/test";

import { createCourseTimberGeometry } from "../src/game/course/course-timber";
import { createNurseryStakeGeometry } from "../src/game/course/course-tree-geometry";

type Geometry = {
  indices: number[];
  normals: number[];
  positions: number[];
  uvs?: number[];
};

const vertex = (values: number[], size: number, index: number) =>
  values.slice(index * size, index * size + size);

// Each triangle's direction along its grain (u) in metres of the piece, and
// whether it faces its outward normal.
function triangles(geometry: Geometry, scale = [1, 1, 1]) {
  const result = [];
  for (let index = 0; index < geometry.indices.length; index += 3) {
    const [a, b, c] = geometry.indices.slice(index, index + 3) as [number, number, number];
    const [pa, pb, pc] = [a, b, c].map((v) =>
      vertex(geometry.positions, 3, v).map((value, axis) => value * scale[axis]!),
    ) as [number[], number[], number[]];
    const [ua, ub, uc] = [a, b, c].map((v) => vertex(geometry.uvs!, 2, v)) as [
      number[],
      number[],
      number[],
    ];
    const e1 = pb.map((value, axis) => value - pa[axis]!);
    const e2 = pc.map((value, axis) => value - pa[axis]!);
    const facing = [
      e1[1]! * e2[2]! - e1[2]! * e2[1]!,
      e1[2]! * e2[0]! - e1[0]! * e2[2]!,
      e1[0]! * e2[1]! - e1[1]! * e2[0]!,
    ];
    const normal = vertex(geometry.normals, 3, a);
    // Solve the triangle's position gradient along u: dP/du.
    const [du1, dv1, du2, dv2] = [
      ub[0]! - ua[0]!,
      ub[1]! - ua[1]!,
      uc[0]! - ua[0]!,
      uc[1]! - ua[1]!,
    ];
    const determinant = du1 * dv2 - du2 * dv1;
    const along = e1.map(
      (value, axis) => (value * dv2 - e2[axis]! * dv1) / determinant,
    );
    const across = e1.map(
      (value, axis) => (e2[axis]! * du1 - value * du2) / determinant,
    );
    result.push({
      across,
      along,
      normal,
      outward: facing.reduce((sum, value, axis) => sum + value * normal[axis]!, 0) > 0,
    });
  }
  return result;
}

const length = (vector: number[]) => Math.hypot(...vector);

const PLACE = { position: { x: 0, y: 0, z: 0 }, rotation: { x: 0, y: 0, z: 0 } };

test("lays timber's grain along each piece, in metres, on outward faces", () => {
  // A post, a deck bearer, and a deck's plywood sheet.
  for (const scale of [
    { x: 0.09, y: 2.26, z: 0.09 },
    { x: 3.05, y: 0.14, z: 0.045 },
    { x: 3.05, y: 0.018, z: 2.066 },
  ]) {
    const sizes = [scale.x, scale.y, scale.z];
    const longest = sizes.indexOf(Math.max(...sizes));
    const faces = triangles(createCourseTimberGeometry("box", scale, PLACE), sizes);
    expect(faces).toHaveLength(12);
    for (const { across, along, normal, outward } of faces) {
      expect(outward).toBe(true);
      // One UV unit is a metre each way.
      expect(length(along)).toBeCloseTo(1, 6);
      expect(length(across)).toBeCloseTo(1, 6);
      const facing = normal.findIndex((value) => value !== 0);
      // Faces along the piece take its grain; its ends, their longer side.
      const grain = along.findIndex((value) => Math.abs(value) > 0.5);
      if (facing !== longest) expect(grain).toBe(longest);
      else {
        const sides = [0, 1, 2].filter((axis) => axis !== facing);
        expect(sizes[grain]).toBe(Math.max(...sides.map((axis) => sizes[axis]!)));
      }
    }
  }
});

test("runs a round's grain along its axis", () => {
  const scale = [0.1, 2, 0.1];
  const faces = triangles(
    createCourseTimberGeometry("cylinder", { x: 0.1, y: 2, z: 0.1 }, PLACE),
    scale,
  );
  for (const { along, normal, outward } of faces) {
    expect(outward).toBe(true);
    if (normal[1] === 0) expect(along[1]).toBeCloseTo(1, 6);
  }
});

// The UV at a world point on a box's top face, for a box turned 0° or 180°.
function topUvAt(
  geometry: ReturnType<typeof createCourseTimberGeometry>,
  scale: { x: number; y: number; z: number },
  place: { position: { x: number; y: number; z: number }; turned: boolean },
  world: [number, number, number],
) {
  const flip = place.turned ? -1 : 1;
  const local = [
    (flip * (world[0] - place.position.x)) / scale.x,
    (world[1] - place.position.y) / scale.y,
    (flip * (world[2] - place.position.z)) / scale.z,
  ];
  const first =
    Array.from({ length: geometry.normals.length / 3 }).findIndex(
      (_, index) => geometry.normals[index * 3 + 1] === 1,
    );
  const [p0, p1, p3] = [first, first + 1, first + 3].map((index) =>
    vertex(geometry.positions, 3, index),
  ) as [number[], number[], number[]];
  const [uv0, uv1, uv3] = [first, first + 1, first + 3].map((index) =>
    vertex(geometry.uvs, 2, index),
  ) as [number[], number[], number[]];
  const along = (edge: number[]) =>
    local.reduce((sum, value, axis) => sum + (value - p0[axis]!) * (edge[axis]! - p0[axis]!), 0) /
    edge.reduce((sum, value, axis) => sum + (value - p0[axis]!) ** 2, 0);
  const [s, t] = [along(p1), along(p3)];
  return uv0.map((value, index) => value + s * (uv1[index]! - value) + t * (uv3[index]! - value));
}

test("gives timber lying in one plane the same wood, either way round", () => {
  // A kicker's plywood sheet and a side board turned end for end, their
  // tops flush, as Falls View Park's kicker has them.
  const sheet = { x: 2.44, y: 0.018, z: 2.4401 };
  const board = { x: 0.018, y: 0.34, z: 2.44 };
  const sheetPlace = { position: { x: 0, y: 0, z: 0 }, turned: false };
  const boardPlace = { position: { x: 1.211, y: -0.161, z: 0.4 }, turned: true };
  const point: [number, number, number] = [1.21, 0.009, 0.3];
  const sheetUv = topUvAt(
    createCourseTimberGeometry("box", sheet, { ...sheetPlace, rotation: { x: 0, y: 0, z: 0 } }),
    sheet,
    sheetPlace,
    point,
  );
  const boardUv = topUvAt(
    createCourseTimberGeometry("box", board, { ...boardPlace, rotation: { x: 0, y: 180, z: 0 } }),
    board,
    boardPlace,
    point,
  );
  expect(boardUv[0]).toBeCloseTo(sheetUv[0]!, 6);
  expect(boardUv[1]).toBeCloseTo(sheetUv[1]!, 6);
});

test("runs a stake's grain up it", () => {
  const stake = createNurseryStakeGeometry();
  for (const { across, along, outward } of triangles(stake)) {
    expect(outward).toBe(true);
    expect(along[1]).toBeCloseTo(1, 6);
    expect(length(across)).toBeGreaterThan(0.9);
  }
});

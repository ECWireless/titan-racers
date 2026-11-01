import { expect, test } from "@playwright/test";

import {
  type CourseMeshGeometry,
  createCourseBevelGeometry,
} from "../src/game/course/course-bevel";
import {
  createCourseElbowGeometry,
  createCourseHandwheelGeometry,
} from "../src/game/course/course-kits";
import {
  type CourseSignGlyph,
  createCourseSignGeometry,
} from "../src/game/course/course-sign";

type Scale = { x: number; y: number; z: number };

// Positions and normals in metres, as the entity scaled by `scale` draws them.
function inMetres(geometry: CourseMeshGeometry, scale: Scale) {
  const size = [scale.x, scale.y, scale.z];
  const points = [];
  for (let index = 0; index < geometry.positions.length; index += 3) {
    const point = [0, 1, 2].map((axis) => geometry.positions[index + axis]! * size[axis]!);
    // Normals transform by the inverse scale.
    const normal = [0, 1, 2].map((axis) => geometry.normals[index + axis]! / size[axis]!);
    const length = Math.hypot(...normal);
    points.push({ normal: normal.map((value) => value / length), point });
  }
  return points;
}

// Whether every triangle is wound to face its corners' normals.
function facesItsNormals(geometry: CourseMeshGeometry, scale: Scale) {
  const points = inMetres(geometry, scale);
  for (let index = 0; index < geometry.indices.length; index += 3) {
    const [a, b, c] = geometry.indices.slice(index, index + 3).map((i) => points[i]!);
    const e1 = b!.point.map((value, axis) => value - a!.point[axis]!);
    const e2 = c!.point.map((value, axis) => value - a!.point[axis]!);
    const facing = [
      e1[1]! * e2[2]! - e1[2]! * e2[1]!,
      e1[2]! * e2[0]! - e1[0]! * e2[2]!,
      e1[0]! * e2[1]! - e1[1]! * e2[0]!,
    ];
    for (const corner of [a!, b!, c!]) {
      if (facing.reduce((sum, value, axis) => sum + value * corner.normal[axis]!, 0) <= 0) {
        return false;
      }
    }
  }
  return true;
}

test("chamfers a box's edges by the same metres however it is scaled", () => {
  // A portal's height board: 5 m long, 0.4 m tall, and 60 mm thick.
  const scale = { x: 5, y: 0.4, z: 0.06 };
  const geometry = createCourseBevelGeometry("box", scale, 0.01);
  expect(facesItsNormals(geometry, scale)).toBe(true);
  // 6 faces, 12 edges, and 8 corners.
  expect(geometry.indices.length / 3).toBe(6 * 2 + 12 * 2 + 8);
  const points = inMetres(geometry, scale);
  for (const { normal, point } of points) {
    expect(Math.abs(point[0]!)).toBeLessThanOrEqual(2.5 + 1e-9);
    expect(Math.hypot(...normal)).toBeCloseTo(1, 9);
    // A chamfer, between two faces, leans 45° in metres.
    const axes = normal.filter((value) => Math.abs(value) > 1e-9);
    if (axes.length === 2) expect(Math.abs(axes[0]!)).toBeCloseTo(Math.SQRT1_2, 9);
  }
  // The front face stops 10 mm short of each edge.
  const front = points.filter(({ normal }) => normal[2]! > 0.999);
  expect(Math.max(...front.map(({ point }) => point[1]!))).toBeCloseTo(0.19, 9);
  expect(Math.max(...front.map(({ point }) => point[0]!))).toBeCloseTo(2.49, 9);
});

test("keeps a bevel under half a solid's thinnest side", () => {
  // A 10 mm door leaf asked for a 5 cm chamfer still has a face.
  const scale = { x: 1, y: 2.1, z: 0.01 };
  const front = inMetres(createCourseBevelGeometry("box", scale, 0.05), scale).filter(
    ({ normal }) => normal[2]! > 0.999,
  );
  expect(Math.max(...front.map(({ point }) => point[1]!))).toBeGreaterThan(1.04);
});

test("chamfers a round's rims, smooth around it", () => {
  // A fire main flange: 285 mm across, 22 mm thick, on its side.
  const scale = { x: 0.285, y: 0.022, z: 0.285 };
  const geometry = createCourseBevelGeometry("cylinder", scale, 0.004);
  expect(facesItsNormals(geometry, scale)).toBe(true);
  for (const { point } of inMetres(geometry, scale)) {
    expect(Math.hypot(point[0]!, point[2]!)).toBeLessThanOrEqual(0.1425 + 1e-9);
    expect(Math.abs(point[1]!)).toBeLessThanOrEqual(0.011 + 1e-9);
  }
});

test("draws a handwheel's rim, hub, and spokes within its round", () => {
  for (const scale of [
    { x: 0.4, y: 0.04, z: 0.4 },
    { x: 0.07, y: 0.015, z: 0.07 },
  ]) {
    const geometry = createCourseHandwheelGeometry(scale);
    expect(facesItsNormals(geometry, scale)).toBe(true);
    for (const { point } of inMetres(geometry, scale)) {
      expect(Math.hypot(point[0]!, point[2]!)).toBeLessThanOrEqual(scale.x / 2 + 1e-9);
      expect(Math.abs(point[1]!)).toBeLessThanOrEqual(scale.y / 2 + 1e-9);
    }
  }
});

test("bends an elbow through its corner, its ends square to the pipes", () => {
  // The water main: 326 mm, bending 1.5 diameters.
  const scale = { x: 0.326, y: 0.326, z: 0.326 };
  const geometry = createCourseElbowGeometry(scale);
  expect(facesItsNormals(geometry, scale)).toBe(true);
  const bend = 1.5 * 0.326;
  const points = inMetres(geometry, scale);
  // Its ends: a ring across the +Y pipe at the bend's start, and one across
  // the +X pipe at its end, each the pipe's width.
  for (const axis of [0, 1]) {
    const ring = points.filter(({ point }) => Math.abs(point[axis]! - bend) < 1e-9 && point[1 - axis]! < 0.2);
    expect(ring.length).toBeGreaterThan(0);
    for (const { normal, point } of ring) {
      expect(Math.hypot(point[1 - axis]!, point[2]!)).toBeCloseTo(0.163, 9);
      expect(normal[axis]).toBeCloseTo(0, 9);
    }
  }
});

test("lays a sign's letters on its front, centred and fitted to it", () => {
  // Square cells, each letter half an em wide, with capitals 0.7 em tall.
  const cell = (index: number): CourseSignGlyph => ({
    advance: 0.5,
    uv: [index / 10, 0, (index + 1) / 10, 1],
    width: 1,
  });
  const glyphs = {
    capHeight: 0.7,
    cell: { height: 1, left: 0.25, top: 0.8 },
    glyphs: new Map([..."MAX3.6m"].map((c, i) => [c, cell(i)])),
    space: 0.25,
  };
  const scale = { x: 2.2, y: 0.4, z: 0.001 };
  const geometry = createCourseSignGeometry("MAX 3.6m", scale, glyphs);
  // A quad a letter; the space only moves the pen.
  expect(geometry.indices.length / 6).toBe(7);
  const points = inMetres(geometry, scale);
  for (const { normal, point } of points) {
    expect(normal).toEqual([0, 0, 1]);
    expect(point[2]).toBeCloseTo(0.0005, 9);
  }
  // Capitals fill 62% of the board's height, centred on it.
  const em = (0.62 * 0.4) / 0.7;
  const pens = points.filter((_, index) => index % 4 === 0).map(({ point }) => point[0]! + 0.25 * em);
  const advance = 7 * 0.5 + 0.25;
  expect(pens[0]).toBeCloseTo((-advance * em) / 2, 9);
  const baseline = points[0]!.point[1]! + (1 - 0.8) * em;
  expect(baseline).toBeCloseTo((-0.7 * em) / 2, 9);
  // A long line shrinks to fit the width instead.
  const wide = inMetres(createCourseSignGeometry("MAX 3.6m", { ...scale, x: 0.5 }, glyphs), {
    ...scale,
    x: 0.5,
  });
  const lastPen = wide.at(-4)!.point[0]! + 0.25 * ((0.9 * 0.5) / advance);
  expect(lastPen + 0.5 * ((0.9 * 0.5) / advance)).toBeCloseTo(0.45 / 2, 9);
});

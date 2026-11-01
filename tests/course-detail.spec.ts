import { expect, test } from "@playwright/test";

import { type CourseMeshGeometry, createCourseBevelGeometry } from "../src/game/course/course-bevel";
import {
  FALLS_VIEW_PARK_DOCUMENT,
  rotateCourseDirection,
} from "../src/game/course/course-document";
import {
  createCourseElbowGeometry,
  createCourseHandwheelGeometry,
  createCourseKitGeometry,
  getCourseElbowCollisionCylinders,
  getCrowdBarrierFrameBoxes,
} from "../src/game/course/course-kits";
import {
  type CourseSignGlyph,
  createCourseSignGeometry,
} from "../src/game/course/course-sign";
import { createCourseTimberGeometry } from "../src/game/course/course-timber";
import { createNurseryStakeGeometry } from "../src/game/course/course-tree-geometry";

type Scale = { x: number; y: number; z: number };
type Geometry = Omit<CourseMeshGeometry, "uvs"> & { uvs?: number[] };
const UNIT = { x: 1, y: 1, z: 1 };

const vertex = (values: number[], size: number, index: number) =>
  values.slice(index * size, index * size + size);
const length = (vector: number[]) => Math.hypot(...vector);

// Positions and normals in metres, as the entity scaled by `scale` draws them.
function inMetres(geometry: Geometry, scale: Scale) {
  const size = [scale.x, scale.y, scale.z];
  return Array.from({ length: geometry.positions.length / 3 }, (_, index) => {
    const point = vertex(geometry.positions, 3, index).map((value, axis) => value * size[axis]!);
    // Normals transform by the inverse scale.
    const normal = vertex(geometry.normals, 3, index).map((value, axis) => value / size[axis]!);
    return { normal: normal.map((value) => value / length(normal)), point };
  });
}

/**
 * Each triangle in metres: whether it is wound to face all its corners'
 * normals, and, given UVs, how far it runs along u and v per unit.
 */
function triangles(geometry: Geometry, scale: Scale = UNIT) {
  const points = inMetres(geometry, scale);
  return Array.from({ length: geometry.indices.length / 3 }, (_, triangle) => {
    const corners = geometry.indices.slice(triangle * 3, triangle * 3 + 3);
    const [a, b, c] = corners.map((index) => points[index]!);
    const e1 = b!.point.map((value, axis) => value - a!.point[axis]!);
    const e2 = c!.point.map((value, axis) => value - a!.point[axis]!);
    const facing = [
      e1[1]! * e2[2]! - e1[2]! * e2[1]!,
      e1[2]! * e2[0]! - e1[0]! * e2[2]!,
      e1[0]! * e2[1]! - e1[1]! * e2[0]!,
    ];
    const outward = [a!, b!, c!].every(
      ({ normal }) => facing.reduce((sum, value, axis) => sum + value * normal[axis]!, 0) > 0,
    );
    if (!geometry.uvs) return { across: [], along: [], normal: a!.normal, outward };
    const [ua, ub, uc] = corners.map((index) => vertex(geometry.uvs!, 2, index)) as [
      number[],
      number[],
      number[],
    ];
    // Solve the position's gradients along u and v: dP/du and dP/dv.
    const [du1, dv1, du2, dv2] = [ub[0]! - ua[0]!, ub[1]! - ua[1]!, uc[0]! - ua[0]!, uc[1]! - ua[1]!];
    const determinant = du1 * dv2 - du2 * dv1;
    return {
      across: e1.map((value, axis) => (e2[axis]! * du1 - value * du2) / determinant),
      along: e1.map((value, axis) => (value * dv2 - e2[axis]! * dv1) / determinant),
      normal: a!.normal,
      outward,
    };
  });
}

const facesItsNormals = (geometry: Geometry, scale: Scale = UNIT) =>
  triangles(geometry, scale).every(({ outward }) => outward);

test("builds a crowd barrier's frame on its plank's base, facing outward", () => {
  const frame = getCrowdBarrierFrameBoxes({ x: 2.2, y: 0.15, z: 0.025 });
  expect(Math.min(...frame.map(({ center, size }) => center.y - size.y / 2))).toBeCloseTo(-0.075, 9);
  expect(facesItsNormals(createCourseKitGeometry(frame))).toBe(true);
});

test("fills a crowd barrier's grille too closely for any kart to pass", () => {
  for (const length of [2.2, 1.869, 0.6]) {
    // The uprights and infill bars, left to right.
    const posts = getCrowdBarrierFrameBoxes({ x: length, y: 0.15, z: 0.025 })
      .filter(({ size }) => size.y > 0.5)
      .sort((a, b) => a.center.x - b.center.x);
    for (let index = 1; index < posts.length; index++) {
      const [left, right] = [posts[index - 1]!, posts[index]!];
      const gap = right.center.x - right.size.x / 2 - (left.center.x + left.size.x / 2);
      expect(gap, `${length} m`).toBeLessThanOrEqual(0.1);
    }
  }
});

test("chamfers a box's edges by the same metres however it is scaled", () => {
  // A portal's height board: 5 m long, 0.4 m tall, and 60 mm thick.
  const scale = { x: 5, y: 0.4, z: 0.06 };
  const geometry = createCourseBevelGeometry("box", scale, 0.01);
  expect(facesItsNormals(geometry, scale)).toBe(true);
  const points = inMetres(geometry, scale);
  for (const { normal, point } of points) {
    expect(Math.abs(point[0]!)).toBeLessThanOrEqual(2.5 + 1e-9);
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

// The water main: 326 mm, bending 1.5 diameters.
const MAIN = { x: 0.326, y: 0.326, z: 0.326 };
const BEND = 1.5 * MAIN.x;

test("bends an elbow through its corner, its ends square to the pipes", () => {
  const geometry = createCourseElbowGeometry(MAIN);
  expect(facesItsNormals(geometry, MAIN)).toBe(true);
  const points = inMetres(geometry, MAIN);
  // Its ends: a ring across the +Y pipe at the bend's start, and one across
  // the +X pipe at its end, each the pipe's width, and each closed.
  for (const axis of [0, 1]) {
    const end = points.filter(({ point }) => Math.abs(point[axis]! - BEND) < 1e-9 && point[1 - axis]! < 0.2);
    const ring = end.filter(({ normal }) => Math.abs(normal[axis]!) < 1e-9);
    const cap = end.filter(({ normal }) => normal[axis]! > 1 - 1e-9);
    expect(ring.length).toBeGreaterThan(0);
    expect(cap.length).toBe(ring.length / 2);
    for (const { point } of [...ring, ...cap]) {
      expect(Math.hypot(point[1 - axis]!, point[2]!)).toBeCloseTo(0.163, 9);
    }
  }
});

// How far a point lies outside the nearest of an elbow's collision
// cylinders (0 inside one), in its local frame in metres.
function outsideColliders(point: number[], diameter: number) {
  let nearest = Infinity;
  for (const { center, height, radius, roll } of getCourseElbowCollisionCylinders(diameter)) {
    const turn = (roll * Math.PI) / 180;
    const axis = [-Math.sin(turn), Math.cos(turn), 0];
    const offset = [point[0]! - center.x, point[1]! - center.y, point[2]! - center.z];
    const along = offset.reduce((sum, value, index) => sum + value * axis[index]!, 0);
    const radial = length(offset.map((value, index) => value - along * axis[index]!));
    nearest = Math.min(
      nearest,
      Math.hypot(Math.max(0, radial - radius), Math.max(0, Math.abs(along) - height / 2)),
    );
  }
  return nearest;
}

// How far a point lies from an elbow's pipe centre line: its bend about
// (bend, bend, 0), and the straight pipes it joins along +Y and +X.
function fromCentreLine(point: number[], bend: number) {
  const [x, y, z] = point as [number, number, number];
  const legs = Math.min(
    Math.hypot(x, Math.max(0, bend - y), z),
    Math.hypot(Math.max(0, bend - x), y, z),
  );
  const [dx, dy] = [x - bend, y - bend];
  const onBend = dx <= 0 && dy <= 0;
  return onBend ? Math.min(legs, Math.hypot(Math.hypot(dx, dy) - bend, z)) : legs;
}

// The nearest point on triangle abc to p (Ericson, Real-Time Collision
// Detection, 5.1.5).
function closestOnTriangle(p: number[], a: number[], b: number[], c: number[]) {
  const sub = (u: number[], v: number[]) => u.map((value, index) => value - v[index]!);
  const dot = (u: number[], v: number[]) => u.reduce((sum, value, index) => sum + value * v[index]!, 0);
  const at = (s: number, t: number) => a.map((value, index) => value + s * (b[index]! - value) + t * (c[index]! - value));
  const [ab, ac, ap] = [sub(b, a), sub(c, a), sub(p, a)];
  const [d1, d2] = [dot(ab, ap), dot(ac, ap)];
  if (d1 <= 0 && d2 <= 0) return a;
  const bp = sub(p, b);
  const [d3, d4] = [dot(ab, bp), dot(ac, bp)];
  if (d3 >= 0 && d4 <= d3) return b;
  const vc = d1 * d4 - d3 * d2;
  if (vc <= 0 && d1 >= 0 && d3 <= 0) return at(d1 / (d1 - d3), 0);
  const cp = sub(p, c);
  const [d5, d6] = [dot(ab, cp), dot(ac, cp)];
  if (d6 >= 0 && d5 <= d6) return c;
  const vb = d5 * d2 - d1 * d6;
  if (vb <= 0 && d2 >= 0 && d6 <= 0) return at(0, d2 / (d2 - d6));
  const va = d3 * d6 - d5 * d4;
  if (va <= 0 && d4 - d3 >= 0 && d5 - d6 >= 0) {
    const w = (d4 - d3) / (d4 - d3 + (d5 - d6));
    return b.map((value, index) => value + w * (c[index]! - value));
  }
  const denominator = 1 / (va + vb + vc);
  return at(vb * denominator, vc * denominator);
}

// An elbow's drawn faces in metres, and how far outside them a point lies
// (0 inside them).
function drawnFaces(geometry: Geometry, scale: Scale) {
  const points = inMetres(geometry, scale).map(({ point }) => point);
  const faces = Array.from({ length: geometry.indices.length / 3 }, (_, index) => {
    const [a, b, c] = [0, 1, 2].map((corner) => points[geometry.indices[index * 3 + corner]!]!);
    const e1 = b!.map((value, axis) => value - a![axis]!);
    const e2 = c!.map((value, axis) => value - a![axis]!);
    const facing = [
      e1[1]! * e2[2]! - e1[2]! * e2[1]!,
      e1[2]! * e2[0]! - e1[0]! * e2[2]!,
      e1[0]! * e2[1]! - e1[1]! * e2[0]!,
    ];
    const centre = a!.map((value, axis) => (value + b![axis]! + c![axis]!) / 3);
    const reach = Math.max(
      ...[a!, b!, c!].map((corner) => length(corner.map((value, axis) => value - centre[axis]!))),
    );
    return { a: a!, b: b!, c: c!, centre, facing, reach };
  });
  return (point: number[]) => {
    // Only faces whose bounding spheres come near the point can be nearest.
    const [px, py, pz] = point as [number, number, number];
    const near = new Float64Array(faces.length);
    let bound = Infinity;
    for (let index = 0; index < faces.length; index++) {
      const { centre, reach } = faces[index]!;
      const [dx, dy, dz] = [px - centre[0]!, py - centre[1]!, pz - centre[2]!];
      near[index] = Math.sqrt(dx * dx + dy * dy + dz * dz);
      if (near[index]! + reach < bound) bound = near[index]! + reach;
    }
    let best = Infinity;
    let outside = 0;
    for (let index = 0; index < faces.length; index++) {
      if (near[index]! - faces[index]!.reach > bound) continue;
      const { a, b, c, facing } = faces[index]!;
      const nearest = closestOnTriangle(point, a, b, c);
      const offset = point.map((value, axis) => value - nearest[axis]!);
      const distance = length(offset);
      if (distance >= best) continue;
      best = distance;
      outside = facing.reduce((sum, value, axis) => sum + value * offset[axis]!, 0) > 0 ? distance : 0;
    }
    return outside;
  };
}

test("collides as an elbow's drawn pipe within 4 mm, both ways, up to 2 m across", () => {
  for (const diameter of [0.326, 1, 2]) {
    const scale = { x: diameter, y: diameter, z: diameter };
    const bend = 1.5 * diameter;
    const geometry = createCourseElbowGeometry(scale);
    const outsideFaces = drawnFaces(geometry, scale);
    // The pipe drawn lies within the cylinders...
    let gap = 0;
    for (const { point } of inMetres(geometry, scale)) {
      gap = Math.max(gap, outsideColliders(point, diameter));
    }
    expect(gap, `${diameter} m`).toBeLessThanOrEqual(0.004);
    // ...and the cylinders' surfaces within the pipe drawn, or, past the
    // bend's ends, within the straight pipes it joins.
    let reach = 0;
    for (const { center, height, radius, roll } of getCourseElbowCollisionCylinders(diameter)) {
      const turn = (roll * Math.PI) / 180;
      const axis = [-Math.sin(turn), Math.cos(turn), 0];
      const across = [Math.cos(turn), Math.sin(turn), 0];
      for (let step = 0; step <= 4; step++) {
        for (let side = 0; side < 12; side++) {
          const along = (step / 4 - 0.5) * height;
          const angle = (side / 12) * Math.PI * 2;
          const point = [center.x, center.y, center.z].map(
            (value, index) =>
              value +
              along * axis[index]! +
              radius * (Math.cos(angle) * across[index]! + (index === 2 ? Math.sin(angle) : 0)),
          );
          const pastBend = point[0]! > bend || point[1]! > bend;
          reach = Math.max(
            reach,
            pastBend ? fromCentreLine(point, bend) - diameter / 2 : outsideFaces(point),
          );
        }
      }
    }
    expect(reach, `${diameter} m`).toBeLessThanOrEqual(0.004);
  }
});

test("joins each water-main elbow's collision to the main's, with no gap", () => {
  const main = FALLS_VIEW_PARK_DOCUMENT.objects.find((o) => o.id === "tunnel-water-main")!;
  if (main.visual.shape === "arc" || main.collision?.shape !== "cylinder") {
    throw new Error("Expected the main's cylinder");
  }
  const { radius, height } = main.collision;
  const centre = main.transform.position;
  // Inside the main's collider, along world X, as it lies.
  const outsideMain = (point: { x: number; y: number; z: number }) =>
    Math.hypot(
      Math.max(0, Math.hypot(point.y - centre.y, point.z - centre.z) - radius),
      Math.max(0, Math.abs(point.x - centre.x) - height / 2),
    );
  for (const side of ["west", "east"] as const) {
    const elbow = FALLS_VIEW_PARK_DOCUMENT.objects.find(
      (o) => o.id === `tunnel-water-main-elbow-${side}`,
    )!;
    if (elbow.visual.shape === "arc") throw new Error("Expected a primitive");
    const diameter = elbow.visual.scale.x;
    const bend = 1.5 * diameter;
    const { position, rotation } = elbow.transform;
    const toWorld = (local: number[]) => {
      const turned = rotateCourseDirection({ x: local[0]!, y: local[1]!, z: local[2]! }, { x: 0, y: 0, z: 0 }, rotation);
      return { x: position.x + turned.x, y: position.y + turned.y, z: position.z + turned.z };
    };
    const toLocal = (world: { x: number; y: number; z: number }) => {
      const local = rotateCourseDirection(
        { x: world.x - position.x, y: world.y - position.y, z: world.z - position.z },
        rotation,
        { x: 0, y: 0, z: 0 },
      );
      return [local.x, local.y, local.z];
    };
    // The pipe's surface 0.1 m either side of the junction, all round.
    let gap = 0;
    for (let step = -10; step <= 10; step++) {
      for (let side = 0; side < 24; side++) {
        const angle = (side / 24) * Math.PI * 2;
        const ring = [Math.cos(angle) * (diameter / 2), 0, Math.sin(angle) * (diameter / 2)];
        // Along the +Y pipe past the bend's start, or around its first degrees.
        const local =
          step >= 0
            ? [ring[0]!, bend + step * 0.01, ring[2]!]
            : (() => {
                const theta = (-step * 0.01) / bend;
                const out = [-Math.cos(theta), -Math.sin(theta), 0];
                return [0, 1, 2].map(
                  (index) =>
                    [bend - bend * Math.cos(theta), bend - bend * Math.sin(theta), 0][index]! +
                    (diameter / 2) * (Math.cos(angle) * out[index]! + (index === 2 ? Math.sin(angle) : 0)),
                );
              })();
        const world = toWorld(local);
        gap = Math.max(gap, Math.min(outsideMain(world), outsideColliders(toLocal(world), diameter)));
      }
    }
    expect(gap, side).toBeLessThanOrEqual(0.004);
  }
});

test("covers both of the water main's elbows where a kart reaches them", () => {
  // Just inside each elbow's outer side, above the pipe bay.
  for (const [id, world] of [
    ["tunnel-water-main-elbow-west", { x: 10.45, y: 0.36, z: -47.66 }],
    ["tunnel-water-main-elbow-east", { x: 73.55, y: 0.36, z: -47.66 }],
  ] as const) {
    const elbow = FALLS_VIEW_PARK_DOCUMENT.objects.find((o) => o.id === id)!;
    expect(elbow.collision?.shape).toBe("elbow");
    if (elbow.visual.shape === "arc") throw new Error("Expected a primitive");
    const { position, rotation } = elbow.transform;
    const local = rotateCourseDirection(
      { x: world.x - position.x, y: world.y - position.y, z: world.z - position.z },
      rotation,
      { x: 0, y: 0, z: 0 },
    );
    expect(outsideColliders([local.x, local.y, local.z], elbow.visual.scale.x)).toBe(0);
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
    glyphs: new Map([..."MAX3.1m"].map((c, i) => [c, cell(i)])),
    space: 0.25,
  };
  const scale = { x: 2.2, y: 0.4, z: 0.001 };
  const geometry = createCourseSignGeometry("MAX 3.1m", scale, glyphs);
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
  const narrow = { ...scale, x: 0.5 };
  const wide = inMetres(createCourseSignGeometry("MAX 3.1m", narrow, glyphs), narrow);
  const fitted = (0.9 * 0.5) / advance;
  expect(wide.at(-4)!.point[0]! + 0.25 * fitted + 0.5 * fitted).toBeCloseTo(0.45 / 2, 9);
});

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
    const faces = triangles(createCourseTimberGeometry("box", scale, PLACE), scale);
    expect(faces).toHaveLength(12);
    for (const { across, along, normal, outward } of faces) {
      expect(outward).toBe(true);
      // One UV unit is a metre each way.
      expect(length(along)).toBeCloseTo(1, 6);
      expect(length(across)).toBeCloseTo(1, 6);
      const facing = normal.findIndex((value) => Math.abs(value) > 0.5);
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
  const scale = { x: 0.1, y: 2, z: 0.1 };
  for (const { along, normal, outward } of triangles(
    createCourseTimberGeometry("cylinder", scale, PLACE),
    scale,
  )) {
    expect(outward).toBe(true);
    if (Math.abs(normal[1]!) < 1e-9) expect(along[1]).toBeCloseTo(1, 6);
  }
});

// The UV at a world point on a box's top face, for a box turned 0° or 180°.
function topUvAt(
  geometry: ReturnType<typeof createCourseTimberGeometry>,
  scale: Scale,
  place: { position: { x: number; y: number; z: number }; turned: boolean },
  world: [number, number, number],
) {
  const flip = place.turned ? -1 : 1;
  const local = [
    (flip * (world[0] - place.position.x)) / scale.x,
    (world[1] - place.position.y) / scale.y,
    (flip * (world[2] - place.position.z)) / scale.z,
  ];
  const first = Array.from({ length: geometry.normals.length / 3 }).findIndex(
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
  for (const { across, along, outward } of triangles(createNurseryStakeGeometry())) {
    expect(outward).toBe(true);
    expect(along[1]).toBeCloseTo(1, 6);
    expect(length(across)).toBeGreaterThan(0.9);
  }
});

import { expect, test } from "@playwright/test";

import {
  COURSE_CLEARING_FENCE,
  COURSE_CLEARING_GROUND,
  getCourseClearingFence,
  getCourseClearingGround,
} from "../src/game/course/course-clearing";
import {
  FALLS_VIEW_PARK_DOCUMENT,
  ROUGH_COURSE_DOCUMENT,
} from "../src/game/course/course-document";
import { CLEARING_RADIUS } from "../src/game/enclosure/habitat-land";
import { getEnclosureFrame, type Vector3 } from "../src/game/enclosure/island-three";

const enclosure = FALLS_VIEW_PARK_DOCUMENT.enclosure;
const ground = getCourseClearingGround(enclosure)!;
const frame = getEnclosureFrame(enclosure);
const { radius } = frame.definition;
const { axial, azimuth } = enclosure.placement;
const footprint = enclosure.clearing!.footprint;

const sub = (a: Vector3, b: Vector3) => ({ x: a.x - b.x, y: a.y - b.y, z: a.z - b.z });
const dot = (a: Vector3, b: Vector3) => a.x * b.x + a.y * b.y + a.z * b.z;
const along = (p: Vector3, axis: Vector3, s: number) => ({
  x: p.x + axis.x * s,
  y: p.y + axis.y * s,
  z: p.z + axis.z * s,
});
const axisOrigin = frame.point(axial, azimuth, 0);
const sunward = sub(frame.point(axial + 1, azimuth, 0), axisOrigin);
const fromAxis = (p: Vector3) => {
  const offset = sub(p, axisOrigin);
  const radial = sub(offset, along({ x: 0, y: 0, z: 0 }, sunward, dot(offset, sunward)));
  return Math.sqrt(dot(radial, radial));
};
const floor = (a: number, s: number) =>
  frame.point(axial + a, azimuth + ((s / radius) * 180) / Math.PI, radius);
const inFootprint = (p: Vector3, margin = 0) =>
  p.x > footprint.min.x + margin &&
  p.x < footprint.max.x - margin &&
  p.z > footprint.min.z + margin &&
  p.z < footprint.max.z - margin;
// A chord across a strip stands at most its sagitta off the floor.
const SAGITTA = COURSE_CLEARING_GROUND.stripWidth ** 2 / (8 * radius);
const tops = ground.pieces.map((piece) => along(piece.center, piece.up, piece.halfExtents.y));

test("leaves courses without a clearing as they were", () => {
  expect(getCourseClearingGround(ROUGH_COURSE_DOCUMENT.enclosure)).toBeNull();
  expect(getCourseClearingFence(ROUGH_COURSE_DOCUMENT.enclosure)).toBeNull();
});

test("draws the clearing on the habitat floor, facing the axis, out to its edge", () => {
  for (let i = 0; i < ground.positions.length; i += 3) {
    const p = { x: ground.positions[i]!, y: ground.positions[i + 1]!, z: ground.positions[i + 2]! };
    expect(Math.abs(fromAxis(p) - radius)).toBeLessThan(1e-6);
    const across = radius * Math.asin(dot(sub(p, axisOrigin), frame.outward(azimuth + 90)) / radius);
    expect(Math.hypot(dot(p, sunward), across)).toBeLessThan(CLEARING_RADIUS + 1e-6);
    expect(inFootprint(p, 1e-6)).toBe(false);
  }
  for (let i = 0; i < ground.indices.length; i += 3) {
    const [a, b, c] = [0, 1, 2].map((k) => {
      const v = ground.indices[i + k]! * 3;
      return { x: ground.positions[v]!, y: ground.positions[v + 1]!, z: ground.positions[v + 2]! };
    });
    const ab = sub(b!, a!);
    const ac = sub(c!, a!);
    const normal = { x: ab.y * ac.z - ab.z * ac.y, y: ab.z * ac.x - ab.x * ac.z, z: ab.x * ac.y - ab.y * ac.x };
    if (dot(normal, normal) < 1e-12) continue;
    expect(dot(normal, sub(axisOrigin, a!))).toBeGreaterThan(0);
  }
});

test("lays slabs whose tops are chords of the floor, within its pieces' limits", () => {
  for (const [index, piece] of ground.pieces.entries()) {
    const { forward, halfExtents, right } = piece;
    expect(2 * halfExtents.x).toBeLessThanOrEqual(COURSE_CLEARING_GROUND.pieceLength + 1e-6);
    expect(2 * halfExtents.z).toBeLessThanOrEqual(COURSE_CLEARING_GROUND.stripWidth + 1e-6);
    for (const [x, z] of [[-1, -1], [-1, 1], [1, -1], [1, 1]]) {
      const corner = along(along(tops[index]!, right, x! * halfExtents.x), forward, z! * halfExtents.z);
      expect(Math.abs(fromAxis(corner) - radius)).toBeLessThan(1e-6);
      expect(inFootprint(corner, 1e-6)).toBe(false);
    }
    expect(radius - fromAxis(tops[index]!)).toBeLessThan(SAGITTA);
  }
});

test("supports the floor everywhere in the clearing outside the park", () => {
  for (let a = -CLEARING_RADIUS; a <= CLEARING_RADIUS; a += 2.5) {
    for (let s = -CLEARING_RADIUS; s <= CLEARING_RADIUS; s += 2.5) {
      if (Math.hypot(a, s) > CLEARING_RADIUS - 5) continue;
      const point = floor(a, s);
      if (inFootprint(point, -0.01)) continue;
      const supported = ground.pieces.some((piece, index) => {
        const offset = sub(point, tops[index]!);
        return (
          Math.abs(dot(offset, piece.right)) <= piece.halfExtents.x + 1e-6 &&
          Math.abs(dot(offset, piece.forward)) <= piece.halfExtents.z + 1e-6 &&
          Math.abs(dot(offset, piece.up)) < SAGITTA
        );
      });
      expect(supported, `floor at a=${a}, s=${s}`).toBe(true);
    }
  }
});

test("closes the clearing with a fence standing on the floor", () => {
  const fence = getCourseClearingFence(enclosure)!;
  const { colliders, panels } = fence;
  const corner = (
    piece: (typeof colliders)[number],
    x: number,
    y: number,
    z: number,
  ) =>
    along(
      along(along(piece.center, piece.right, x * piece.halfExtents.x), piece.up, y * piece.halfExtents.y),
      piece.forward,
      z * piece.halfExtents.z,
    );
  const local = (piece: (typeof colliders)[number], point: Vector3) => {
    const offset = sub(point, piece.center);
    return [dot(offset, piece.right), dot(offset, piece.up), dot(offset, piece.forward)];
  };
  // Each collider stands on the floor from end to end, and meets the next
  // one along its centreline, so no gap opens between them.
  colliders.forEach((piece, index) => {
    for (const x of [-1, 1]) {
      expect(Math.abs(fromAxis(corner(piece, x, -1, 0)) - radius)).toBeLessThan(1e-6);
    }
    const next = colliders[(index + 1) % colliders.length]!;
    const gap = sub(corner(piece, 1, -1, 0), corner(next, -1, -1, 0));
    expect(Math.sqrt(dot(gap, gap))).toBeLessThan(1e-6);
  });
  // Every mesh panel lies within a collider.
  for (let quad = 0; quad < panels.positions.length / 12; quad++) {
    const points = [0, 1, 2, 3].map((k) => {
      const v = quad * 12 + k * 3;
      return { x: panels.positions[v]!, y: panels.positions[v + 1]!, z: panels.positions[v + 2]! };
    });
    const holder = colliders[Math.floor(quad / COURSE_CLEARING_FENCE.colliderPanels)]!;
    for (const point of points) {
      const [x, y, z] = local(holder, point);
      expect(Math.abs(x!)).toBeLessThanOrEqual(holder.halfExtents.x + 1e-6);
      expect(Math.abs(y!)).toBeLessThanOrEqual(holder.halfExtents.y + 1e-6);
      expect(Math.abs(z!)).toBeLessThanOrEqual(holder.halfExtents.z);
    }
  }
  // The fence stands clear of the park.
  for (const x of [footprint.min.x, footprint.max.x]) {
    for (const z of [footprint.min.z, footprint.max.z]) {
      expect(Math.hypot(x, z)).toBeLessThan(COURSE_CLEARING_FENCE.radius - 10);
    }
  }
});

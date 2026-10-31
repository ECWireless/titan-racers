import type { CourseObject } from "./course-document";

type Vector = { x: number; y: number; z: number };

/** A box in an object's unscaled local frame, in metres. */
export type CourseKitBox = { center: Vector; size: Vector };

// A steel crowd-control barrier: 38 mm square tube uprights and rails,
// 16 mm infill bars, and flat feet across the panel, 1.1 m tall from its
// kick plank's base.
const TUBE = 0.038;
const BAR = 0.016;
const HEIGHT = 1.1;
const FOOT = { across: 0.6, thickness: 0.01, width: 0.05 };
const BOTTOM_RAIL = 0.2;
const BARS_AT = [-0.3, -0.1, 0.1, 0.3];

/**
 * A crowd barrier's steel frame about its plank, whose local X runs along
 * the panel and whose size sets the panel's length and base: uprights and
 * feet at its ends, rails at the bottom and top, and four infill bars.
 */
export function getCrowdBarrierFrameBoxes(plank: Vector): CourseKitBox[] {
  const base = -plank.y / 2;
  const end = plank.x / 2;
  const rail = (height: number): CourseKitBox => ({
    center: { x: 0, y: base + height, z: 0 },
    size: { x: plank.x, y: TUBE, z: TUBE },
  });
  return [
    ...[-end, end].flatMap((x) => [
      {
        center: { x, y: base + FOOT.thickness / 2, z: 0 },
        size: { x: FOOT.width, y: FOOT.thickness, z: FOOT.across },
      },
      {
        center: { x, y: base + (FOOT.thickness + HEIGHT) / 2, z: 0 },
        size: { x: TUBE, y: HEIGHT - FOOT.thickness, z: TUBE },
      },
    ]),
    rail(BOTTOM_RAIL),
    rail(HEIGHT),
    ...BARS_AT.map((along) => ({
      center: { x: along * plank.x, y: base + (BOTTOM_RAIL + HEIGHT) / 2, z: 0 },
      size: { x: BAR, y: HEIGHT - BOTTOM_RAIL, z: BAR },
    })),
  ];
}

// Each face: its normal axis and sign, and the two axes spanning it, with
// u × v along +axis.
const FACES = [
  { axis: "x", sign: 1, u: "y", v: "z" },
  { axis: "x", sign: -1, u: "y", v: "z" },
  { axis: "y", sign: 1, u: "z", v: "x" },
  { axis: "y", sign: -1, u: "z", v: "x" },
  { axis: "z", sign: 1, u: "x", v: "y" },
  { axis: "z", sign: -1, u: "x", v: "y" },
] as const;

/**
 * Merges boxes into one mesh's streams, each face its own four vertices
 * with a unit UV square, wound counter-clockwise seen from outside.
 */
export function createCourseKitGeometry(boxes: readonly CourseKitBox[]) {
  const positions: number[] = [];
  const normals: number[] = [];
  const uvs: number[] = [];
  const indices: number[] = [];
  boxes.forEach(({ center, size }) => {
    FACES.forEach(({ axis, sign, u, v }) => {
      const first = positions.length / 3;
      const corners = [
        [-1, -1],
        [1, -1],
        [1, 1],
        [-1, 1],
      ];
      corners.forEach(([cu, cv]) => {
        const point = { ...center };
        point[axis] += (sign * size[axis]) / 2;
        point[u] += (cu * size[u]) / 2;
        point[v] += (cv * size[v]) / 2;
        positions.push(point.x, point.y, point.z);
        normals.push(
          axis === "x" ? sign : 0,
          axis === "y" ? sign : 0,
          axis === "z" ? sign : 0,
        );
        uvs.push((cu + 1) / 2, (cv + 1) / 2);
      });
      indices.push(
        ...(sign < 0
          ? [first, first + 2, first + 1, first, first + 3, first + 2]
          : [first, first + 1, first + 2, first, first + 2, first + 3]),
      );
    });
  });
  return { indices, normals, positions, uvs };
}

/** The boxes a kit draws about its object, and the object's scale, or null. */
export function getCourseKit(object: CourseObject) {
  if (object.kit !== "crowd-barrier" || object.visual.shape !== "box") return null;
  return {
    boxes: getCrowdBarrierFrameBoxes(object.visual.scale),
    scale: object.visual.scale,
  };
}

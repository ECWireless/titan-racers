import { createCourseMeshBuilder } from "./course-bevel";
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

// A valve handwheel's proportions, for its diameter: a round rim about a
// fifteenth of it thick, a hub, and four spokes, as a 400 mm cast wheel has.
const HANDWHEEL = { hub: 0.09, rim: 0.035, sides: { hub: 12, major: 24, minor: 6 } };

/**
 * A valve's handwheel, in place of its round (local Y is its spindle): a
 * torus rim, a hub as thick as the round, and four spokes between them.
 */
export function createCourseHandwheelGeometry(scale: Vector) {
  const { geometry, polygon } = createCourseMeshBuilder(scale);
  const diameter = scale.x;
  const thickness = scale.y;
  // At least 1 mm thicker than in proportion, for small wheels, but never
  // more than a fifth of the wheel's width.
  const tube = Math.min(thickness / 2, HANDWHEEL.rim * diameter + 0.001, diameter / 10);
  const ring = diameter / 2 - tube;
  const around = (step: number, steps: number) => (step / steps) * Math.PI * 2;
  const { hub: hubSides, major, minor } = HANDWHEEL.sides;
  for (let i = 0; i < major; i++) {
    for (let j = 0; j < minor; j++) {
      const corners = [
        [i, j],
        [i + 1, j],
        [i + 1, j + 1],
        [i, j + 1],
      ].map(([a, b]) => {
        const theta = around(a!, major);
        const phi = around(b!, minor);
        const normal: [number, number, number] = [
          Math.cos(phi) * Math.cos(theta),
          Math.sin(phi),
          Math.cos(phi) * Math.sin(theta),
        ];
        const reach = ring + tube * Math.cos(phi);
        return {
          normal,
          point: [reach * Math.cos(theta), tube * Math.sin(phi), reach * Math.sin(theta)] as [
            number,
            number,
            number,
          ],
        };
      });
      polygon(
        corners.map(({ point }) => point),
        corners.map(({ normal }) => normal),
      );
    }
  }
  const hub = HANDWHEEL.hub * diameter;
  const disc = (y: number) =>
    Array.from({ length: hubSides }, (_, side) => {
      const angle = around(side, hubSides);
      return [Math.cos(angle) * hub, y, Math.sin(angle) * hub] as [number, number, number];
    });
  const [low, high] = [disc(-thickness / 2), disc(thickness / 2)];
  polygon(low, [0, -1, 0]);
  polygon(high, [0, 1, 0]);
  low.forEach((point, side) => {
    const next = (side + 1) % hubSides;
    const corners = [point, low[next]!, high[next]!, high[side]!];
    polygon(
      corners,
      corners.map(([x, , z]) => [x / hub, 0, z / hub] as [number, number, number]),
    );
  });
  // Spokes run from inside the hub to the rim's centre line.
  const spoke = tube * 1.1;
  const length = ring - hub * 0.8;
  const middle = hub * 0.8 + length / 2;
  for (const [x, z] of [
    [1, 0],
    [0, 1],
    [-1, 0],
    [0, -1],
  ] as const) {
    const half = [
      Math.abs(x) * (length / 2) + Math.abs(z) * (spoke / 2),
      spoke / 2,
      Math.abs(z) * (length / 2) + Math.abs(x) * (spoke / 2),
    ];
    const center = [x * middle, 0, z * middle];
    for (let axis = 0; axis < 3; axis++) {
      const [a, b] = [0, 1, 2].filter((other) => other !== axis) as [number, number];
      for (const sign of [-1, 1]) {
        polygon(
          [
            [-1, -1],
            [1, -1],
            [1, 1],
            [-1, 1],
          ].map(([s, t]) => {
            const point = [...center] as [number, number, number];
            point[axis] += sign * half[axis]!;
            point[a] += s! * half[a]!;
            point[b] += t! * half[b]!;
            return point;
          }),
          [0, 1, 2].map((other) => (other === axis ? sign : 0)) as [number, number, number],
        );
      }
    }
  }
  return geometry;
}

// A long-radius elbow bends its pipe's centreline about one and a half of
// its diameters.
const ELBOW = { bend: 1.5, sides: { around: 20, along: 12 } };

/**
 * A pipe's 90° elbow, in place of its round, as wide as the pipe: the pipe
 * along local +Y bends through the corner at the origin to run along local
 * +X. Its ends are open, to meet the pipes either side.
 */
export function createCourseElbowGeometry(scale: Vector) {
  const { geometry, polygon } = createCourseMeshBuilder(scale);
  const radius = scale.x / 2;
  const bend = ELBOW.bend * scale.x;
  const { along, around } = ELBOW.sides;
  const at = (step: number, side: number) => {
    const theta = (step / along) * (Math.PI / 2);
    const phi = (side / around) * Math.PI * 2;
    // Out from the bend's centre, and across it.
    const out = [-Math.cos(theta), -Math.sin(theta), 0];
    const normal = out.map((value, axis) =>
      Math.cos(phi) * value + (axis === 2 ? Math.sin(phi) : 0),
    ) as [number, number, number];
    const centre = [bend - bend * Math.cos(theta), bend - bend * Math.sin(theta), 0];
    return {
      normal,
      point: centre.map((value, axis) => value + radius * normal[axis]!) as [
        number,
        number,
        number,
      ],
    };
  };
  for (let step = 0; step < along; step++) {
    for (let side = 0; side < around; side++) {
      const corners = [
        at(step, side),
        at(step + 1, side),
        at(step + 1, side + 1),
        at(step, side + 1),
      ];
      polygon(
        corners.map(({ point }) => point),
        corners.map(({ normal }) => normal),
      );
    }
  }
  return geometry;
}

// An elbow collides as cylinders along chords of its bend, as many as keep
// each chord within 4 mm of the bend, up to 32 (elbows to about 9 m across).
const ELBOW_COLLISION = { maximum: 32, tolerance: 0.004 };

/**
 * The cylinders an elbow of this diameter collides as, in its local frame in
 * metres: each along a chord of the bend, lengthened to close the mitre at
 * its ends, turned about local Z (`roll`, degrees) from local Y.
 */
export function getCourseElbowCollisionCylinders(diameter: number) {
  const radius = diameter / 2;
  const bend = ELBOW.bend * diameter;
  // A chord across angle a lies inside the bend by bend × (1 − cos(a / 2)).
  const widest = 2 * Math.acos(Math.max(-1, 1 - ELBOW_COLLISION.tolerance / bend));
  const count = Math.min(
    ELBOW_COLLISION.maximum,
    Math.max(1, Math.ceil(Math.PI / 2 / widest)),
  );
  const step = Math.PI / 2 / count;
  return Array.from({ length: count }, (_, index) => {
    const mid = (index + 0.5) * step;
    const half = step / 2;
    // The chord's middle lies inside the bend's centre line by its sagitta.
    const reach = bend * Math.cos(half);
    return {
      center: { x: bend - reach * Math.cos(mid), y: bend - reach * Math.sin(mid), z: 0 },
      height: 2 * bend * Math.sin(half) + 2 * radius * Math.tan(half),
      radius,
      roll: (mid * 180) / Math.PI,
    };
  });
}

/** The boxes a kit draws about its object, and the object's scale, or null. */
export function getCourseKit(object: CourseObject) {
  if (object.kit !== "crowd-barrier" || object.visual.shape !== "box") return null;
  return {
    boxes: getCrowdBarrierFrameBoxes(object.visual.scale),
    scale: object.visual.scale,
  };
}

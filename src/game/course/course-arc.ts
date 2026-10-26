/**
 * An arc sweeps a rectangular section about its object's origin: from local
 * +X toward local -Z (a positive turn about +Y), its inner face at
 * innerRadius, its base on the origin's level. A smooth mesh draws it and a
 * row of boxes collides with it.
 */
export type CourseArc = {
  height: number;
  innerRadius: number;
  /** Degrees. */
  sweep: number;
  width: number;
};

// The drawn outline strays at most 3 mm from the true circle (about 1.5 px at
// chase-camera distance on a phone); the collision boxes at most 5 mm.
export const COURSE_ARC_VISUAL_TOLERANCE = 0.003;
export const COURSE_ARC_COLLISION_TOLERANCE = 0.005;
// Small radii still turn in short steps, so their outline reads as round.
const MAXIMUM_ARC_STEP = (6 * Math.PI) / 180;
// Enough for any arc the schema allows (outer radius ≤ 200 m, ≤ 360°) to keep
// the visual tolerance; the cap only guards against bad input.
const MAXIMUM_ARC_SEGMENTS = 1024;

/**
 * Segments that keep a circle of this radius within the tolerance: a chord
 * spanning angle a leaves a gap (sagitta) of r(1 - cos(a/2)).
 */
export function getCourseArcSegmentCount(
  radius: number,
  sweep: number,
  tolerance: number,
) {
  const step = Math.min(
    MAXIMUM_ARC_STEP,
    2 * Math.acos(Math.max(-1, 1 - tolerance / radius)),
  );
  const sweepRadians = (sweep * Math.PI) / 180;
  return Math.min(
    MAXIMUM_ARC_SEGMENTS,
    Math.max(1, Math.ceil(sweepRadians / step - 1e-9)),
  );
}

const direction = (angle: number) => ({
  x: Math.cos(angle),
  z: -Math.sin(angle),
});

/** The middle of the arc's top, in its object's frame: a point on it. */
export function getCourseArcMidpoint(arc: CourseArc) {
  const { x, z } = direction((arc.sweep * Math.PI) / 360);
  const radius = arc.innerRadius + arc.width / 2;
  return { x: x * radius, y: arc.height, z: z * radius };
}

/**
 * The arc's surface: inner and outer faces with radial normals, so it shades
 * as one curve, and a top and end caps with their own vertices, so those
 * edges stay sharp. The base is never seen. Streams match the engine's box
 * (positions, normals, two UV sets) so arcs batch with boxes of their finish.
 */
export function createCourseArcGeometry(arc: CourseArc) {
  const outerRadius = arc.innerRadius + arc.width;
  const segments = getCourseArcSegmentCount(
    outerRadius,
    arc.sweep,
    COURSE_ARC_VISUAL_TOLERANCE,
  );
  const sweep = (arc.sweep * Math.PI) / 180;
  const positions: number[] = [];
  const normals: number[] = [];
  const uvs: number[] = [];
  const indices: number[] = [];
  const vertex = (
    x: number,
    y: number,
    z: number,
    normal: { x: number; y: number; z: number },
    u: number,
    v: number,
  ) => {
    positions.push(x, y, z);
    normals.push(normal.x, normal.y, normal.z);
    uvs.push(u, v);
    return positions.length / 3 - 1;
  };
  // Two triangles over a quad, wound to face its normal.
  const quad = (
    a: number,
    b: number,
    c: number,
    d: number,
    normal: { x: number; y: number; z: number },
  ) => {
    const at = (index: number) => positions.slice(index * 3, index * 3 + 3);
    const [pa, pb, pc] = [at(a), at(b), at(c)];
    const e1 = [pb[0] - pa[0], pb[1] - pa[1], pb[2] - pa[2]];
    const e2 = [pc[0] - pa[0], pc[1] - pa[1], pc[2] - pa[2]];
    const facing =
      (e1[1] * e2[2] - e1[2] * e2[1]) * normal.x +
      (e1[2] * e2[0] - e1[0] * e2[2]) * normal.y +
      (e1[0] * e2[1] - e1[1] * e2[0]) * normal.z;
    if (facing >= 0) indices.push(a, b, c, a, c, d);
    else indices.push(a, c, b, a, d, c);
  };

  const rings = Array.from({ length: segments + 1 }, (_, index) => {
    const angle = (sweep * index) / segments;
    return { angle, ...direction(angle), u: angle * outerRadius };
  });
  const faces = [
    { radius: outerRadius, sign: 1 },
    { radius: arc.innerRadius, sign: -1 },
  ];
  for (const { radius, sign } of faces) {
    const strip = rings.map(({ u, x, z }) => {
      const normal = { x: x * sign, y: 0, z: z * sign };
      return [
        vertex(x * radius, 0, z * radius, normal, u, 0),
        vertex(x * radius, arc.height, z * radius, normal, u, arc.height),
      ];
    });
    for (let index = 0; index < segments; index++) {
      const [bottom, top] = strip[index]!;
      const [nextBottom, nextTop] = strip[index + 1]!;
      quad(bottom, nextBottom, nextTop, top, {
        x: (rings[index]!.x + rings[index + 1]!.x) * sign,
        y: 0,
        z: (rings[index]!.z + rings[index + 1]!.z) * sign,
      });
    }
  }

  const up = { x: 0, y: 1, z: 0 };
  const topStrip = rings.map(({ u, x, z }) => [
    vertex(x * arc.innerRadius, arc.height, z * arc.innerRadius, up, u, 0),
    vertex(x * outerRadius, arc.height, z * outerRadius, up, u, arc.width),
  ]);
  for (let index = 0; index < segments; index++) {
    const [inner, outer] = topStrip[index]!;
    const [nextInner, nextOuter] = topStrip[index + 1]!;
    quad(inner, outer, nextOuter, nextInner, up);
  }

  // End caps face back along the sweep at its start and onward at its end.
  for (const [ring, sign] of [
    [rings[0]!, -1],
    [rings[segments]!, 1],
  ] as const) {
    const normal = {
      x: -Math.sin(ring.angle) * sign,
      y: 0,
      z: -Math.cos(ring.angle) * sign,
    };
    const corner = (radius: number, y: number) =>
      vertex(ring.x * radius, y, ring.z * radius, normal, radius, y);
    quad(
      corner(arc.innerRadius, 0),
      corner(outerRadius, 0),
      corner(outerRadius, arc.height),
      corner(arc.innerRadius, arc.height),
      normal,
    );
  }

  return { indices, normals, positions, segments, uvs };
}

/**
 * Boxes that collide as the arc: each box's outer face is the exact chord of
 * the outer circle, so neighbours meet there without a gap or a protruding
 * corner, and they overlap only inside the wall. Faces stay within the
 * collision tolerance of the drawn arc: the outer face up to that much
 * inside it, the inner face up to that much proud of it.
 */
export function getCourseArcCollisionBoxes(arc: CourseArc) {
  const outerRadius = arc.innerRadius + arc.width;
  const segments = getCourseArcSegmentCount(
    outerRadius,
    arc.sweep,
    COURSE_ARC_COLLISION_TOLERANCE,
  );
  const step = (arc.sweep * Math.PI) / 180 / segments;
  const halfStep = Math.cos(step / 2);
  const outerFace = outerRadius * halfStep;
  const innerFace = arc.innerRadius * halfStep;
  return Array.from({ length: segments }, (_, index) => {
    const angle = step * (index + 0.5);
    const { x, z } = direction(angle);
    const middle = (outerFace + innerFace) / 2;
    return {
      center: { x: x * middle, y: arc.height / 2, z: z * middle },
      halfExtents: {
        // Along the chord, then the wall's height, then its depth.
        x: outerRadius * Math.sin(step / 2),
        y: arc.height / 2,
        z: (outerFace - innerFace) / 2,
      },
      // Turns the box's local +X along the chord and +Z out from the centre.
      yaw: (angle * 180) / Math.PI + 90,
    };
  });
}

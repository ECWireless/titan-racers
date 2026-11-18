import type { KartMatrix3, KartVector } from "./kart-construction-geometry";

/**
 * A convex solid in assembly axes: a part's construction box or cylinder; a
 * rounded hull (its points' hull swollen by a radius: a ball, a rod, or a rod
 * swept between two poses); or the hull of several boxes and cylinders (a
 * part swept between two poses).
 */
export type KartConvexShape =
  | {
      center: KartVector;
      /** The box's half sizes along its own axes. */
      half: KartVector;
      kind: "box";
      /** Its own axes in assembly axes (columns). */
      rotation: KartMatrix3;
    }
  | {
      /** Unit, along the cylinder. */
      axis: KartVector;
      center: KartVector;
      halfHeight: number;
      kind: "cylinder";
      radius: number;
    }
  | { kind: "rounded"; points: KartVector[]; radius: number }
  | { kind: "hull"; shapes: KartSolidShape[] };

type KartSolidShape = Exclude<KartConvexShape, { kind: "rounded" | "hull" }>;

/**
 * How two solids stand: `distance` is the gap between their surfaces, or,
 * when negative, how deep they overlap. `pointA` and `pointB` are the
 * nearest points (or, overlapping, the deepest) on each surface.
 */
export type KartConvexMeasurement = {
  distance: number;
  pointA: KartVector;
  pointB: KartVector;
};

type Vertex = { a: KartVector; b: KartVector; w: KartVector };

const add = (l: KartVector, r: KartVector) => ({
  x: l.x + r.x,
  y: l.y + r.y,
  z: l.z + r.z,
});
const sub = (l: KartVector, r: KartVector) => ({
  x: l.x - r.x,
  y: l.y - r.y,
  z: l.z - r.z,
});
const scale = (v: KartVector, s: number) => ({ x: v.x * s, y: v.y * s, z: v.z * s });
const dot = (l: KartVector, r: KartVector) => l.x * r.x + l.y * r.y + l.z * r.z;
const cross = (l: KartVector, r: KartVector) => ({
  x: l.y * r.z - l.z * r.y,
  y: l.z * r.x - l.x * r.z,
  z: l.x * r.y - l.y * r.x,
});
const lengthOf = (v: KartVector) => Math.sqrt(dot(v, v));
const negate = (v: KartVector) => scale(v, -1);

// A rounded hull is measured as its points' hull, then swollen by the
// radius, which keeps every core a polytope or a cylinder and the search exact.
function margin(shape: KartConvexShape) {
  return shape.kind === "rounded" ? shape.radius : 0;
}

function mean(points: KartVector[]) {
  return scale(
    points.reduce((sum, point) => add(sum, point), { x: 0, y: 0, z: 0 }),
    1 / points.length,
  );
}

function center(shape: KartConvexShape): KartVector {
  if (shape.kind === "rounded") return mean(shape.points);
  if (shape.kind === "hull") return mean(shape.shapes.map(center));
  return shape.center;
}

function farthest(points: KartVector[], direction: KartVector) {
  return points.reduce((best, point) =>
    dot(point, direction) > dot(best, direction) ? point : best,
  );
}

/** The core's farthest point along `direction`. */
function support(shape: KartConvexShape, direction: KartVector): KartVector {
  if (shape.kind === "rounded") return farthest(shape.points, direction);
  if (shape.kind === "hull") {
    return farthest(
      shape.shapes.map((member) => support(member, direction)),
      direction,
    );
  }
  if (shape.kind === "box") {
    const r = shape.rotation;
    // The direction in the box's own axes picks each half size's sign.
    const local = {
      x: r[0] * direction.x + r[3] * direction.y + r[6] * direction.z,
      y: r[1] * direction.x + r[4] * direction.y + r[7] * direction.z,
      z: r[2] * direction.x + r[5] * direction.y + r[8] * direction.z,
    };
    const corner = {
      x: local.x >= 0 ? shape.half.x : -shape.half.x,
      y: local.y >= 0 ? shape.half.y : -shape.half.y,
      z: local.z >= 0 ? shape.half.z : -shape.half.z,
    };
    return {
      x: shape.center.x + r[0] * corner.x + r[1] * corner.y + r[2] * corner.z,
      y: shape.center.y + r[3] * corner.x + r[4] * corner.y + r[5] * corner.z,
      z: shape.center.z + r[6] * corner.x + r[7] * corner.y + r[8] * corner.z,
    };
  }
  const along = dot(direction, shape.axis);
  const end = add(
    shape.center,
    scale(shape.axis, along >= 0 ? shape.halfHeight : -shape.halfHeight),
  );
  const radial = sub(direction, scale(shape.axis, along));
  const radialLength = lengthOf(radial);
  return radialLength > 1e-12
    ? add(end, scale(radial, shape.radius / radialLength))
    : end;
}

function supportVertex(
  a: KartConvexShape,
  b: KartConvexShape,
  direction: KartVector,
): Vertex {
  const pointA = support(a, direction);
  const pointB = support(b, negate(direction));
  return { a: pointA, b: pointB, w: sub(pointA, pointB) };
}

type Closest = { simplex: Vertex[]; weights: number[]; v: KartVector };

function closestOnSegment(p: Vertex, q: Vertex): Closest {
  const edge = sub(q.w, p.w);
  const lengthSquared = dot(edge, edge);
  const t = lengthSquared > 0 ? -dot(p.w, edge) / lengthSquared : 0;
  if (t <= 0) return { simplex: [p], v: p.w, weights: [1] };
  if (t >= 1) return { simplex: [q], v: q.w, weights: [1] };
  return { simplex: [p, q], v: add(p.w, scale(edge, t)), weights: [1 - t, t] };
}

// Ericson, Real-Time Collision Detection, 5.1.5, with the query at the origin.
function closestOnTriangle(p: Vertex, q: Vertex, r: Vertex): Closest {
  const a = p.w;
  const ab = sub(q.w, a);
  const ac = sub(r.w, a);
  const d1 = -dot(ab, a);
  const d2 = -dot(ac, a);
  if (d1 <= 0 && d2 <= 0) return { simplex: [p], v: a, weights: [1] };
  const d3 = -dot(ab, q.w);
  const d4 = -dot(ac, q.w);
  if (d3 >= 0 && d4 <= d3) return { simplex: [q], v: q.w, weights: [1] };
  const vc = d1 * d4 - d3 * d2;
  if (vc <= 0 && d1 >= 0 && d3 <= 0) {
    const t = d1 / (d1 - d3);
    return { simplex: [p, q], v: add(a, scale(ab, t)), weights: [1 - t, t] };
  }
  const d5 = -dot(ab, r.w);
  const d6 = -dot(ac, r.w);
  if (d6 >= 0 && d5 <= d6) return { simplex: [r], v: r.w, weights: [1] };
  const vb = d5 * d2 - d1 * d6;
  if (vb <= 0 && d2 >= 0 && d6 <= 0) {
    const t = d2 / (d2 - d6);
    return { simplex: [p, r], v: add(a, scale(ac, t)), weights: [1 - t, t] };
  }
  const va = d3 * d6 - d5 * d4;
  if (va <= 0 && d4 - d3 >= 0 && d5 - d6 >= 0) {
    const t = (d4 - d3) / (d4 - d3 + (d5 - d6));
    return {
      simplex: [q, r],
      v: add(q.w, scale(sub(r.w, q.w), t)),
      weights: [1 - t, t],
    };
  }
  const denominator = 1 / (va + vb + vc);
  const v = vb * denominator;
  const w = vc * denominator;
  return {
    simplex: [p, q, r],
    v: add(a, add(scale(ab, v), scale(ac, w))),
    weights: [1 - v - w, v, w],
  };
}

/** Null when the origin is inside the tetrahedron. */
function closestOnTetrahedron(vertices: Vertex[]): Closest | null {
  const faces: Array<[number, number, number, number]> = [
    [0, 1, 2, 3],
    [0, 3, 1, 2],
    [0, 2, 3, 1],
    [1, 3, 2, 0],
  ];
  let best: Closest | null = null;
  let bestDistance = Infinity;
  for (const [i, j, k, opposite] of faces) {
    const a = vertices[i].w;
    const normal = cross(sub(vertices[j].w, a), sub(vertices[k].w, a));
    const originSide = -dot(normal, a);
    const oppositeSide = dot(normal, sub(vertices[opposite].w, a));
    // Only a face the origin lies beyond, or on, can hold the nearest point.
    if (originSide * oppositeSide > 0) continue;
    const candidate = closestOnTriangle(vertices[i], vertices[j], vertices[k]);
    const distance = dot(candidate.v, candidate.v);
    if (distance < bestDistance) {
      best = candidate;
      bestDistance = distance;
    }
  }
  return best;
}

function closestOnSimplex(simplex: Vertex[]): Closest | null {
  switch (simplex.length) {
    case 1:
      return { simplex, v: simplex[0].w, weights: [1] };
    case 2:
      return closestOnSegment(simplex[0], simplex[1]);
    case 3:
      return closestOnTriangle(simplex[0], simplex[1], simplex[2]);
    default:
      return closestOnTetrahedron(simplex);
  }
}

function weighted(simplex: Vertex[], weights: number[], side: "a" | "b") {
  return simplex.reduce(
    (sum, vertex, index) => add(sum, scale(vertex[side], weights[index])),
    { x: 0, y: 0, z: 0 },
  );
}

const MAXIMUM_ITERATIONS = 128;
const TOLERANCE = 1e-9;

/**
 * Measures two convex solids: the gap between them, or how deep they
 * overlap, with the nearest or deepest point on each. GJK finds the gap;
 * EPA, from GJK's last simplex, finds the overlap.
 */
export function measureConvexPair(
  a: KartConvexShape,
  b: KartConvexShape,
): KartConvexMeasurement {
  const swell = margin(a) + margin(b);
  let direction = sub(center(a), center(b));
  if (dot(direction, direction) < 1e-18) direction = { x: 1, y: 0, z: 0 };
  const first = supportVertex(a, b, negate(direction));
  let closest: Closest = { simplex: [first], v: first.w, weights: [1] };
  for (let iteration = 0; iteration < MAXIMUM_ITERATIONS; iteration += 1) {
    const v = closest.v;
    const vv = dot(v, v);
    if (vv < TOLERANCE * TOLERANCE) break;
    const w = supportVertex(a, b, negate(v));
    // No support point gets meaningfully closer: v is the nearest point.
    if (vv - dot(v, w.w) <= TOLERANCE * Math.sqrt(vv)) {
      return separated(closest, swell, margin(a), margin(b));
    }
    const next = closestOnSimplex([...closest.simplex, w]);
    if (!next) {
      // The origin is inside: there are no nearest-point weights to keep.
      const inside = { simplex: [...closest.simplex, w], v: w.w, weights: [] };
      return overlapping(a, b, inside, margin(a), margin(b));
    }
    if (dot(next.v, next.v) >= vv) {
      return separated(closest, swell, margin(a), margin(b));
    }
    closest = next;
  }
  if (dot(closest.v, closest.v) >= TOLERANCE * TOLERANCE) {
    return separated(closest, swell, margin(a), margin(b));
  }
  return overlapping(a, b, closest, margin(a), margin(b));
}

function separated(
  closest: Closest,
  swell: number,
  marginA: number,
  marginB: number,
): KartConvexMeasurement {
  const pointA = weighted(closest.simplex, closest.weights, "a");
  const pointB = weighted(closest.simplex, closest.weights, "b");
  const gap = lengthOf(closest.v);
  const toA = scale(closest.v, 1 / gap);
  return {
    distance: gap - swell,
    pointA: sub(pointA, scale(toA, marginA)),
    pointB: add(pointB, scale(toA, marginB)),
  };
}

const AXES: KartVector[] = [
  { x: 1, y: 0, z: 0 },
  { x: -1, y: 0, z: 0 },
  { x: 0, y: 1, z: 0 },
  { x: 0, y: -1, z: 0 },
  { x: 0, y: 0, z: 1 },
  { x: 0, y: 0, z: -1 },
];

/**
 * Grows a simplex that touches or holds the origin into a tetrahedron, by
 * support points along directions that leave its span.
 */
function toTetrahedron(
  a: KartConvexShape,
  b: KartConvexShape,
  start: Vertex[],
): Vertex[] | null {
  const simplex = [...start];
  const spans = (candidate: Vertex) => {
    if (simplex.length === 1) {
      return lengthOf(sub(candidate.w, simplex[0].w)) > 1e-9;
    }
    if (simplex.length === 2) {
      const edge = sub(simplex[1].w, simplex[0].w);
      return (
        lengthOf(cross(edge, sub(candidate.w, simplex[0].w))) >
        1e-9 * lengthOf(edge)
      );
    }
    const normal = cross(
      sub(simplex[1].w, simplex[0].w),
      sub(simplex[2].w, simplex[0].w),
    );
    return (
      Math.abs(dot(normal, sub(candidate.w, simplex[0].w))) >
      1e-9 * lengthOf(normal)
    );
  };
  while (simplex.length < 4) {
    let directions = AXES;
    if (simplex.length === 2) {
      const edge = sub(simplex[1].w, simplex[0].w);
      directions = AXES.map((axis) => cross(edge, axis)).filter(
        (direction) => lengthOf(direction) > 1e-12,
      );
    } else if (simplex.length === 3) {
      const normal = cross(
        sub(simplex[1].w, simplex[0].w),
        sub(simplex[2].w, simplex[0].w),
      );
      directions = [normal, negate(normal)];
    }
    const next = directions
      .map((direction) => supportVertex(a, b, direction))
      .find(spans);
    if (!next) return null;
    simplex.push(next);
  }
  return simplex;
}

/** A unit direction square to the span of up to three points. */
function outOfSpan(points: KartVector[]): KartVector {
  const unit = (v: KartVector) => scale(v, 1 / lengthOf(v));
  if (points.length >= 3) {
    const normal = cross(sub(points[1], points[0]), sub(points[2], points[0]));
    if (lengthOf(normal) > 1e-18) return unit(normal);
  }
  const edge = points.length >= 2 ? sub(points[1], points[0]) : null;
  if (edge && lengthOf(edge) > 1e-12) {
    const across = AXES.map((axis) => cross(edge, axis)).reduce((best, v) =>
      lengthOf(v) > lengthOf(best) ? v : best,
    );
    return unit(across);
  }
  return AXES[0];
}

type Face = {
  distance: number;
  normal: KartVector;
  vertices: [number, number, number];
};

/**
 * A face wound so its normal points away from `inside`, a point within the
 * polytope: the starting tetrahedron's centre, which stays inside as the
 * polytope grows.
 */
function makeFace(
  points: Vertex[],
  i: number,
  j: number,
  k: number,
  inside: KartVector,
): Face {
  const a = points[i].w;
  let normal = cross(sub(points[j].w, a), sub(points[k].w, a));
  let vertices: [number, number, number] = [i, j, k];
  if (dot(normal, sub(a, inside)) < 0) {
    normal = negate(normal);
    vertices = [i, k, j];
  }
  const length = lengthOf(normal);
  if (length < 1e-18) {
    return { distance: Infinity, normal: { x: 0, y: 0, z: 0 }, vertices };
  }
  normal = scale(normal, 1 / length);
  return { distance: dot(normal, a), normal, vertices };
}

function overlapping(
  a: KartConvexShape,
  b: KartConvexShape,
  last: Closest,
  marginA: number,
  marginB: number,
): KartConvexMeasurement {
  const start = last.simplex;
  const tetrahedron = toTetrahedron(a, b, start);
  // A flat Minkowski difference: the cores only touch, at GJK's last
  // nearest point, so the solids overlap by their margins, along any
  // direction out of the cores' span.
  if (!tetrahedron) {
    const weights =
      last.weights.length === start.length
        ? last.weights
        : start.map(() => 1 / start.length);
    const normal = outOfSpan(start.map(({ w }) => w));
    return {
      distance: -(marginA + marginB),
      pointA: add(weighted(start, weights, "a"), scale(normal, marginA)),
      pointB: sub(weighted(start, weights, "b"), scale(normal, marginB)),
    };
  }
  const points = [...tetrahedron];
  const inside = scale(
    points.reduce((sum, point) => add(sum, point.w), { x: 0, y: 0, z: 0 }),
    0.25,
  );
  let faces = [
    makeFace(points, 0, 1, 2, inside),
    makeFace(points, 0, 3, 1, inside),
    makeFace(points, 0, 2, 3, inside),
    makeFace(points, 1, 3, 2, inside),
  ];
  let nearest = faces[0];
  for (let iteration = 0; iteration < MAXIMUM_ITERATIONS; iteration += 1) {
    const candidate = faces.reduce((best, face) =>
      face.distance < best.distance ? face : best,
    );
    // The nearest face only moves out as the polytope grows; a nearer one
    // means rounding has broken it, so keep the last sound face.
    if (iteration > 0 && candidate.distance < nearest.distance - 1e-12) break;
    nearest = candidate;
    const next = supportVertex(a, b, nearest.normal);
    if (dot(nearest.normal, next.w) - nearest.distance < 1e-9) break;
    points.push(next);
    const index = points.length - 1;
    // Faces the new point sees are replaced by a fan from their horizon. A
    // point on a face's plane does not see it.
    const edges = new Map<string, [number, number]>();
    faces = faces.filter((face) => {
      if (dot(face.normal, next.w) - face.distance <= 1e-10) return true;
      const [i, j, k] = face.vertices;
      for (const [from, to] of [
        [i, j],
        [j, k],
        [k, i],
      ] as const) {
        const reverse = `${to}:${from}`;
        if (edges.has(reverse)) edges.delete(reverse);
        else edges.set(`${from}:${to}`, [from, to]);
      }
      return false;
    });
    for (const [from, to] of edges.values()) {
      faces.push(makeFace(points, from, to, index, inside));
    }
  }
  // A flat side of the difference is split into triangles at one distance;
  // the witnesses come from the one holding the origin's projection, or,
  // where rounding leaves it outside them all, the nearest point to it.
  let best: { closest: Closest; offset: number } | null = null;
  for (const face of [nearest, ...faces]) {
    // Only the nearest face's own plane: an opposite face can tie with it.
    if (
      Math.abs(face.distance - nearest.distance) > 1e-9 ||
      dot(face.normal, nearest.normal) < 1 - 1e-9
    ) {
      continue;
    }
    const projection = scale(face.normal, face.distance);
    const [i, j, k] = face.vertices.map((index) => ({
      ...points[index],
      w: sub(points[index].w, projection),
    }));
    const closest = closestOnTriangle(i, j, k);
    const offset = lengthOf(closest.v);
    if (!best || offset < best.offset) best = { closest, offset };
  }
  const { simplex, weights } = best!.closest;
  const pointA = weighted(simplex, weights, "a");
  const pointB = weighted(simplex, weights, "b");
  // A's deepest point lies along the face normal into B.
  return {
    distance: -nearest.distance - marginA - marginB,
    pointA: add(pointA, scale(nearest.normal, marginA)),
    pointB: sub(pointB, scale(nearest.normal, marginB)),
  };
}

/** The solid's bounds along the assembly axes. */
export function getConvexShapeBounds(shape: KartConvexShape): {
  maximum: KartVector;
  minimum: KartVector;
} {
  const swell = margin(shape);
  const reach = (axis: KartVector) => dot(support(shape, axis), axis) + swell;
  return {
    maximum: {
      x: reach({ x: 1, y: 0, z: 0 }),
      y: reach({ x: 0, y: 1, z: 0 }),
      z: reach({ x: 0, y: 0, z: 1 }),
    },
    minimum: {
      x: -reach({ x: -1, y: 0, z: 0 }),
      y: -reach({ x: 0, y: -1, z: 0 }),
      z: -reach({ x: 0, y: 0, z: -1 }),
    },
  };
}

type Vec3 = { x: number; y: number; z: number };
type Point = [number, number, number];

/** Mesh streams in an object's local frame, as the engine primitives have. */
export type CourseMeshGeometry = {
  indices: number[];
  normals: number[];
  positions: number[];
  uvs: number[];
};

// The engine cylinder's sides.
export const CYLINDER_SIDES = 20;

/**
 * Builds geometry in metres, then fits it to the unit primitive its entity
 * scales by `scale`: positions divide by it and normals follow, so faces
 * keep their true angles and widths however unevenly the object is sized.
 * Each polygon gets its own vertices, flat-shaded unless it gives each
 * corner its own normal; it is wound to face its normals.
 */
export function createCourseMeshBuilder(scale: Vec3) {
  const size: Point = [scale.x, scale.y, scale.z];
  const geometry: CourseMeshGeometry = {
    indices: [],
    normals: [],
    positions: [],
    uvs: [],
  };
  const vertex = (point: Point, normal: Point) => {
    geometry.positions.push(...point.map((value, axis) => value / size[axis]!));
    const local = normal.map((value, axis) => value * size[axis]!);
    const length = Math.hypot(...local);
    geometry.normals.push(...local.map((value) => value / length));
    geometry.uvs.push(0, 0);
    return geometry.positions.length / 3 - 1;
  };
  /** A convex polygon, fanned from its first corner. */
  const polygon = (points: Point[], normals: Point | Point[]) => {
    const each = (index: number) =>
      (Array.isArray(normals[0]) ? (normals as Point[])[index]! : (normals as Point));
    const first = vertex(points[0]!, each(0));
    const rest = points.slice(1).map((point, index) => vertex(point, each(index + 1)));
    const [a, b, c] = points as [Point, Point, Point];
    const e1 = b.map((value, axis) => value - a[axis]!);
    const e2 = c.map((value, axis) => value - a[axis]!);
    const facing = [
      e1[1]! * e2[2]! - e1[2]! * e2[1]!,
      e1[2]! * e2[0]! - e1[0]! * e2[2]!,
      e1[0]! * e2[1]! - e1[1]! * e2[0]!,
    ].reduce((sum, value, axis) => sum + value * each(0)[axis]!, 0);
    for (let index = 1; index < rest.length; index++) {
      geometry.indices.push(
        ...(facing >= 0
          ? [first, rest[index - 1]!, rest[index]!]
          : [first, rest[index]!, rest[index - 1]!]),
      );
    }
  };
  return { geometry, polygon };
}

/** The largest bevel a solid of this size takes: under half its thinnest side. */
function getCourseBevelWidth(
  shape: "box" | "cylinder",
  scale: Vec3,
  bevel: number,
) {
  const thinnest =
    shape === "box"
      ? Math.min(scale.x, scale.y, scale.z)
      : Math.min(scale.x, scale.y);
  return Math.min(bevel, thinnest * 0.45);
}

/**
 * A box or round cylinder with its edges chamfered `bevel` metres back at
 * 45°: flat faces, each edge a strip, and each box corner a triangle.
 */
export function createCourseBevelGeometry(
  shape: "box" | "cylinder",
  scale: Vec3,
  bevel: number,
) {
  const width = getCourseBevelWidth(shape, scale, bevel);
  const { geometry, polygon } = createCourseMeshBuilder(scale);
  if (shape === "cylinder") {
    const radius = scale.x / 2;
    const top = scale.y / 2;
    const ring = (r: number, y: number) =>
      Array.from({ length: CYLINDER_SIDES }, (_, side) => {
        const angle = (side / CYLINDER_SIDES) * Math.PI * 2;
        return [Math.cos(angle) * r, y, Math.sin(angle) * r] as Point;
      });
    const out = (point: Point, up: number): Point => {
      const r = Math.hypot(point[0], point[2]);
      return [point[0] / r, up, point[2] / r];
    };
    for (const sign of [-1, 1]) {
      // The cap, inside its chamfer.
      polygon(ring(radius - width, sign * top), [0, sign, 0]);
      // Its chamfer, smooth around the round.
      const inner = ring(radius - width, sign * top);
      const outer = ring(radius, sign * (top - width));
      inner.forEach((point, side) => {
        const next = (side + 1) % CYLINDER_SIDES;
        const corners = [point, inner[next]!, outer[next]!, outer[side]!];
        polygon(corners, corners.map((corner) => out(corner, sign)));
      });
    }
    // The barrel between the chamfers.
    const low = ring(radius, -(top - width));
    const high = ring(radius, top - width);
    low.forEach((point, side) => {
      const next = (side + 1) % CYLINDER_SIDES;
      const corners = [point, low[next]!, high[next]!, high[side]!];
      polygon(corners, corners.map((corner) => out(corner, 0)));
    });
    return geometry;
  }

  const half: Point = [scale.x / 2, scale.y / 2, scale.z / 2];
  const at = (values: Partial<Record<number, number>>, fallback: (axis: number) => number) =>
    [0, 1, 2].map((axis) => values[axis] ?? fallback(axis)) as Point;
  for (let axis = 0; axis < 3; axis++) {
    const [a, b] = [0, 1, 2].filter((other) => other !== axis) as [number, number];
    for (const sign of [-1, 1]) {
      const normal = at({ [axis]: sign }, () => 0);
      // The face, inset by the chamfer on every side.
      polygon(
        [
          [-1, -1],
          [1, -1],
          [1, 1],
          [-1, 1],
        ].map(([s, t]) =>
          at({ [axis]: sign * half[axis]!, [a]: s! * (half[a]! - width), [b]: t! * (half[b]! - width) }, () => 0),
        ),
        normal,
      );
      // The chamfers along its edges, each shared by two faces, so each is
      // cut once: from this face to a later axis's.
      for (const other of [a, b].filter((next) => next > axis)) {
        const run = 3 - axis - other;
        for (const across of [-1, 1]) {
          polygon(
            [-1, 1, 1, -1].map((s, index) =>
              at(
                index < 2
                  ? { [axis]: sign * half[axis]!, [other]: across * (half[other]! - width), [run]: s * (half[run]! - width) }
                  : { [axis]: sign * (half[axis]! - width), [other]: across * half[other]!, [run]: s * (half[run]! - width) },
                () => 0,
              ),
            ),
            at({ [axis]: sign, [other]: across }, () => 0),
          );
        }
      }
    }
  }
  // The corners.
  for (const x of [-1, 1]) {
    for (const y of [-1, 1]) {
      for (const z of [-1, 1]) {
        const signs: Point = [x, y, z];
        polygon(
          [0, 1, 2].map((axis) =>
            signs.map((sign, other) =>
              sign * (other === axis ? half[other]! : half[other]! - width),
            ) as Point,
          ),
          signs,
        );
      }
    }
  }
  return geometry;
}

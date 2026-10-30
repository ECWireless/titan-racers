import { CLEARING_RADIUS } from "../enclosure/habitat-land";
import { getEnclosureFrame, type Vector3 } from "../enclosure/island-three";
import type { CourseDocument } from "./course-document";

/**
 * The habitat floor around a course in its clearing, out to the clearing's
 * edge, cut into flat pieces: strips across the curve at most `stripWidth`
 * wide (their chords sag at most 3.1 mm from the floor), cut along the axis
 * into pieces at most `pieceLength` long (long drivable pieces jitter wheel
 * contacts), each a slab `depth` deep. The mesh is the slabs' tops; at the
 * edge the slabs run a little past it, under ground the fence closes off.
 */
export const COURSE_CLEARING_GROUND = {
  depth: 0.5,
  pieceLength: 20,
  stripWidth: 10,
} as const;

/** The clearing is mown lawn, as the park's own ground is. */
export const COURSE_CLEARING_SURFACE = {
  friction: 0.7,
  restitution: 0,
  surfaceMaterial: { id: "surface.lawn-grass", version: 1 },
} as const;

/** A slab of ground: its centre, half-extents, and local axes. */
type CourseClearingPiece = {
  center: Vector3;
  forward: Vector3;
  halfExtents: Vector3;
  right: Vector3;
  up: Vector3;
};

const sub = (a: Vector3, b: Vector3) => ({ x: a.x - b.x, y: a.y - b.y, z: a.z - b.z });
const dot = (a: Vector3, b: Vector3) => a.x * b.x + a.y * b.y + a.z * b.z;
const length = (a: Vector3) => Math.sqrt(dot(a, a));
const scale = (a: Vector3, s: number) => ({ x: a.x * s, y: a.y * s, z: a.z * s });
const cross = (a: Vector3, b: Vector3) => ({
  x: a.y * b.z - a.z * b.y,
  y: a.z * b.x - a.x * b.z,
  z: a.x * b.y - a.y * b.x,
});

/**
 * Even steps from `from` to `to`, at most `step` apart, that also stop at
 * each of `stops` between them.
 */
function breaks(from: number, to: number, step: number, stops: number[]) {
  const fixed = [from, ...stops.filter((stop) => stop > from && stop < to), to]
    .sort((a, b) => a - b);
  return fixed.flatMap((start, index) => {
    if (index === fixed.length - 1) return [start];
    const end = fixed[index + 1]!;
    const count = Math.ceil((end - start) / step - 1e-9);
    return Array.from({ length: count }, (_, k) => start + ((end - start) * k) / count);
  });
}

/**
 * The floor of a course's clearing outside its footprint, from the habitat
 * model: the colliding slabs, and the mesh of their tops clipped to the
 * clearing's edge, in course coordinates. Null for a course without one.
 */
export function getCourseClearingGround(enclosure: CourseDocument["enclosure"]) {
  if (!enclosure.clearing) return null;
  const frame = getEnclosureFrame(enclosure);
  const { radius } = frame.definition;
  const { axial, azimuth } = enclosure.placement;
  // (a, s): metres along the axis, sunward, and around the floor,
  // spinward, from the clearing's centre at the placement.
  const floor = (a: number, s: number) =>
    frame.point(axial + a, azimuth + ((s / radius) * 180) / Math.PI, radius);
  const { spinward, sunward } = frame;
  const { max, min } = enclosure.clearing.footprint;
  const corners = [min.x, max.x].flatMap((x) =>
    [min.z, max.z].map((z) => ({ x, y: 0, z })),
  );
  const footprintA = corners.map((corner) => dot(corner, sunward));
  const footprintS = corners.map(
    (corner) => radius * Math.asin(dot(corner, spinward) / radius),
  );
  const [a0, a1] = [Math.min(...footprintA), Math.max(...footprintA)];
  const [s0, s1] = [Math.min(...footprintS), Math.max(...footprintS)];

  const { depth, pieceLength, stripWidth } = COURSE_CLEARING_GROUND;
  const edge = CLEARING_RADIUS;
  const reach = (s: number) => Math.sqrt(Math.max(edge * edge - s * s, 0));
  const acrossBreaks = breaks(-edge, edge, stripWidth, [s0, s1]);
  // Shared along-axis breaks, so neighbouring strips meet vertex to vertex.
  const alongBreaks = breaks(-edge, edge, pieceLength, [a0, a1]);

  const pieces: CourseClearingPiece[] = [];
  const positions: number[] = [];
  const normals: number[] = [];
  const uvs: number[] = [];
  const indices: number[] = [];
  const tolerance = 1e-6;

  for (let strip = 0; strip < acrossBreaks.length - 1; strip++) {
    const sFrom = acrossBreaks[strip]!;
    const sTo = acrossBreaks[strip + 1]!;
    // The strip's slabs reach as far as its nearer edge does; its mesh
    // follows the edge of the clearing.
    const stripReach = reach(sFrom < 0 && sTo > 0 ? 0 : Math.min(Math.abs(sFrom), Math.abs(sTo)));
    const inFootprintS = sFrom >= s0 - tolerance && sTo <= s1 + tolerance;
    const along = [
      -stripReach,
      ...alongBreaks.filter((a) => a > -stripReach && a < stripReach),
      stripReach,
    ];
    for (let piece = 0; piece < along.length - 1; piece++) {
      const aFrom = along[piece]!;
      const aTo = along[piece + 1]!;
      if (aTo - aFrom < tolerance) continue;
      if (inFootprintS && aFrom >= a0 - tolerance && aTo <= a1 + tolerance) continue;

      const p00 = floor(aFrom, sFrom);
      const p10 = floor(aTo, sFrom);
      const p01 = floor(aFrom, sTo);
      const p11 = floor(aTo, sTo);
      let right = scale(sub(p10, p00), 1 / length(sub(p10, p00)));
      const forward = scale(sub(p01, p00), 1 / length(sub(p01, p00)));
      let up = cross(forward, right);
      // Up faces the axis; flip the frame to keep it right-handed.
      if (up.y < 0) {
        right = scale(right, -1);
        up = scale(up, -1);
      }
      const top = scale(
        { x: p00.x + p10.x + p01.x + p11.x, y: p00.y + p10.y + p01.y + p11.y, z: p00.z + p10.z + p01.z + p11.z },
        0.25,
      );
      pieces.push({
        center: sub(top, scale(up, depth / 2)),
        forward,
        halfExtents: {
          x: length(sub(p10, p00)) / 2,
          y: depth / 2,
          z: length(sub(p01, p00)) / 2,
        },
        right,
        up,
      });

      // The top face, clipped along each edge to the clearing.
      const clip = (a: number, s: number) =>
        floor(Math.min(Math.max(a, -reach(s)), reach(s)), s);
      const quad = [clip(aFrom, sFrom), clip(aFrom, sTo), clip(aTo, sTo), clip(aTo, sFrom)];
      const first = positions.length / 3;
      quad.forEach((point) => {
        positions.push(point.x, point.y, point.z);
        normals.push(up.x, up.y, up.z);
        uvs.push(0, 0);
      });
      // Clipping keeps the corners' order, so the full quad sets the winding.
      const facing = dot(cross(sub(p01, p00), sub(p11, p00)), up);
      indices.push(
        ...(facing >= 0
          ? [first, first + 1, first + 2, first, first + 2, first + 3]
          : [first, first + 2, first + 1, first, first + 3, first + 2]),
      );
    }
  }

  return { indices, normals, pieces, positions, uvs };
}

import { CLEARING_RADIUS } from "../enclosure/habitat-land";
import {
  add,
  cross,
  dot,
  getEnclosureFrame,
  scaled,
  type Vector3,
} from "../enclosure/island-three";
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

const sub = (a: Vector3, b: Vector3) => add(a, b, -1);
const length = (a: Vector3) => Math.hypot(a.x, a.y, a.z);

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
 * The habitat floor in clearing coordinates (a, s): metres along the axis,
 * sunward, and around the floor, spinward, from the clearing's centre at
 * the placement; and the floor's up there, toward the axis.
 */
function getClearingFloor(enclosure: CourseDocument["enclosure"]) {
  const frame = getEnclosureFrame(enclosure);
  const { radius } = frame.definition;
  const { axial, azimuth } = enclosure.placement;
  const floor = (a: number, s: number) =>
    frame.point(axial + a, azimuth + ((s / radius) * 180) / Math.PI, radius);
  const up = (a: number, s: number) => {
    const toAxis = sub(frame.point(axial + a, azimuth, 0), floor(a, s));
    return scaled(toAxis, 1 / length(toAxis));
  };
  return { floor, frame, radius, up };
}

/**
 * The floor of a course's clearing outside its footprint, from the habitat
 * model: the colliding slabs, and the mesh of their tops clipped to the
 * clearing's edge, in course coordinates. Null for a course without one.
 */
export function getCourseClearingGround(enclosure: CourseDocument["enclosure"]) {
  if (!enclosure.clearing) return null;
  const { floor, frame, radius } = getClearingFloor(enclosure);
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
      let right = scaled(sub(p10, p00), 1 / length(sub(p10, p00)));
      const forward = scaled(sub(p01, p00), 1 / length(sub(p01, p00)));
      let up = cross(forward, right);
      // Up faces the axis; flip the frame to keep it right-handed.
      if (up.y < 0) {
        right = scaled(right, -1);
        up = scaled(up, -1);
      }
      const top = scaled(
        { x: p00.x + p10.x + p01.x + p11.x, y: p00.y + p10.y + p01.y + p11.y, z: p00.z + p10.z + p01.z + p11.z },
        0.25,
      );
      pieces.push({
        center: sub(top, scaled(up, depth / 2)),
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

/**
 * The park fence ringing the clearing inside its belt of trees: galvanised
 * weld-mesh panels between square posts, standing plumb to the floor.
 * Colliders span `colliderPanels` panels each, as thick as the thinnest
 * solid obstacle, from the floor to the posts' tops.
 */
export const COURSE_CLEARING_FENCE = {
  colliderPanels: 2,
  colliderThickness: 0.1,
  // Panels stand clear of the grass.
  panelBottom: 0.05,
  panelTop: 1.2,
  post: 0.06,
  postHeight: 1.25,
  postSpacing: 2.5,
  radius: 215,
} as const;

/** The weld mesh's repeat: 200 mm square, wires 50 mm apart across it. */
export const COURSE_FENCE_MESH = { cells: 4, size: 0.2, texels: 128, wire: 3 } as const;

/**
 * The weld mesh's coverage over one repeat: vertical wires every 50 mm and
 * one horizontal wire along its top, each about 4.7 mm thick.
 */
export function getCourseFenceMeshCoverage() {
  const { cells, texels, wire } = COURSE_FENCE_MESH;
  const pixels = new Uint8Array(texels * texels * 4);
  const cell = texels / cells;
  for (let y = 0; y < texels; y++) {
    for (let x = 0; x < texels; x++) {
      const on = x % cell < wire || y < wire ? 255 : 0;
      pixels.set([on, on, on, 255], (y * texels + x) * 4);
    }
  }
  return pixels;
}

export type CourseClearingGeometry = { indices: number[]; normals: number[]; positions: number[]; uvs: number[] };
const geometry = (): CourseClearingGeometry => ({ indices: [], normals: [], positions: [], uvs: [] });

/** A planar quad, wound to face `normal`, with its own UVs. */
function addQuad(
  target: CourseClearingGeometry,
  corners: [Vector3, Vector3, Vector3, Vector3],
  normal: Vector3,
  uvs: [number, number][] = [[0, 0], [0, 0], [0, 0], [0, 0]],
) {
  const first = target.positions.length / 3;
  corners.forEach((corner, index) => {
    target.positions.push(corner.x, corner.y, corner.z);
    target.normals.push(normal.x, normal.y, normal.z);
    target.uvs.push(...uvs[index]!);
  });
  const facing = dot(cross(sub(corners[1], corners[0]), sub(corners[2], corners[0])), normal);
  target.indices.push(
    ...(facing >= 0
      ? [first, first + 1, first + 2, first, first + 2, first + 3]
      : [first, first + 2, first + 1, first, first + 3, first + 2]),
  );
}

/**
 * A course's clearing fence, from the habitat model: its posts' and mesh
 * panels' geometry, in course coordinates, and its colliders. Null for a
 * course without a clearing.
 */
export function getCourseClearingFence(enclosure: CourseDocument["enclosure"]) {
  if (!enclosure.clearing) return null;
  const { floor, up } = getClearingFloor(enclosure);
  const fence = COURSE_CLEARING_FENCE;
  // An even count, so colliders span whole pairs of panels.
  const count =
    fence.colliderPanels *
    Math.round((2 * Math.PI * fence.radius) / fence.postSpacing / fence.colliderPanels);
  const stations = Array.from({ length: count }, (_, index) => {
    const angle = (2 * Math.PI * index) / count;
    const a = fence.radius * Math.cos(angle);
    const s = fence.radius * Math.sin(angle);
    return { base: floor(a, s), up: up(a, s) };
  });
  const station = (index: number) => stations[index % count]!;
  const at = (point: Vector3, direction: Vector3, distance: number) =>
    add(point, scaled(direction, distance));

  const posts = geometry();
  const panels = geometry();
  const colliders: CourseClearingPiece[] = [];
  stations.forEach(({ base, up: postUp }, index) => {
    // A square post, its faces along and across the fence.
    const next = station(index + 1);
    const along = sub(next.base, station(index + count - 1).base);
    const tangent = scaled(along, 1 / length(along));
    const across = cross(tangent, postUp);
    const half = fence.post / 2;
    const corner = (x: number, z: number, height: number) =>
      at(at(at(base, tangent, x), across, z), postUp, height);
    const sides: [number, number][] = [[-1, -1], [1, -1], [1, 1], [-1, 1]];
    sides.forEach(([x0, z0], side) => {
      const [x1, z1] = sides[(side + 1) % 4]!;
      const normal = scaled(add(scaled(tangent, x0 + x1), scaled(across, z0 + z1)), 0.5);
      addQuad(
        posts,
        [
          corner(x0 * half, z0 * half, 0),
          corner(x1 * half, z1 * half, 0),
          corner(x1 * half, z1 * half, fence.postHeight),
          corner(x0 * half, z0 * half, fence.postHeight),
        ],
        normal,
      );
    });
    addQuad(
      posts,
      [
        corner(-half, -half, fence.postHeight),
        corner(half, -half, fence.postHeight),
        corner(half, half, fence.postHeight),
        corner(-half, half, fence.postHeight),
      ],
      postUp,
    );

    // The mesh panel to the next post, its UVs in mesh repeats down from
    // its top wire.
    const span = length(sub(next.base, base));
    const normal = cross(scaled(sub(next.base, base), 1 / span), postUp);
    const repeat = COURSE_FENCE_MESH.size;
    addQuad(
      panels,
      [
        at(base, postUp, fence.panelBottom),
        at(next.base, next.up, fence.panelBottom),
        at(next.base, next.up, fence.panelTop),
        at(base, postUp, fence.panelTop),
      ],
      normal,
      [
        [0, (fence.panelTop - fence.panelBottom) / repeat],
        [span / repeat, (fence.panelTop - fence.panelBottom) / repeat],
        [span / repeat, 0],
        [0, 0],
      ],
    );

    if (index % fence.colliderPanels === 0) {
      const end = station(index + fence.colliderPanels);
      const chord = sub(end.base, base);
      const right = scaled(chord, 1 / length(chord));
      const middleUp = add(postUp, end.up);
      const colliderUp = sub(middleUp, scaled(right, dot(middleUp, right)));
      const unitUp = scaled(colliderUp, 1 / length(colliderUp));
      colliders.push({
        center: at(at(base, chord, 0.5), unitUp, fence.postHeight / 2),
        forward: cross(right, unitUp),
        halfExtents: {
          x: length(chord) / 2,
          y: fence.postHeight / 2,
          z: fence.colliderThickness / 2,
        },
        right,
        up: unitUp,
      });
    }
  });
  return { colliders, panels, posts };
}

import type { KartAssemblyComponentInstance } from "./kart-assembly-document";
import {
  addVector,
  multiplyMatrix,
  rotationMatrix,
  scaleVector,
  subtractVector,
  transformVector,
  transposeMatrix,
  type KartMatrix3,
  type KartVector,
} from "./kart-construction-geometry";
import {
  checkKartMountPair,
  KART_MOUNT_TOLERANCE_METERS,
  listKartInstanceMounts,
  type KartMountInstance,
  type KartMountKind,
  type KartMountSide,
  type KartResolvedMount,
} from "./kart-mounting";

/**
 * Snapping: where a part stands with one of its mounting points seated on
 * one of its parent's (the rules are `checkKartMountPair`'s).
 *
 * Seating starts from the pose asked for and moves it as little as it can:
 * - Facing mounts turn the part about its own mount by the smallest turn
 *   that faces them, which keeps any turn about the face's normal (a
 *   footprint's heading on its face, or a motor's about its shaft).
 * - A base footprint drops onto its face and is pushed in from the edge
 *   until all of it rests there; a face meets a face or a tower pad at a
 *   point within it. Both slide.
 * - A motor face, a wheel's hub, and a shock's top eye go to their mount's
 *   point (a top eye to the nearest point within its pin's part).
 */

export type KartInstanceTransform = KartAssemblyComponentInstance["transform"];

/** How far the editor reaches to snap a part onto a mounting point. */
export const KART_SNAP_REACH_METERS = 0.01;
/** Snapping turns a part at most this far to face its mount: 45°. */
const KART_SNAP_MAXIMUM_TURN = Math.PI / 4;

/** The parent mounts each kind of child mount seats on. */
const SEATS: Partial<Record<KartMountKind, readonly KartMountKind[]>> = {
  base: ["face"],
  "chassis-anchor": ["pin"],
  face: ["face", "tower-pad"],
  hub: ["hub-anchor"],
  "motor-face": ["motor-plate"],
};

/**
 * Whether a seated pair holds its part in place, so it moves only once
 * detached: a wheel on its hub and a shock on its pin.
 */
export function isKartMountLocked(kind: KartMountKind) {
  return kind === "hub" || kind === "chassis-anchor";
}

const dot = (left: KartVector, right: KartVector) =>
  left.x * right.x + left.y * right.y + left.z * right.z;
const cross = (left: KartVector, right: KartVector): KartVector => ({
  x: left.y * right.z - left.z * right.y,
  y: left.z * right.x - left.x * right.z,
  z: left.x * right.y - left.y * right.x,
});
const length = (vector: KartVector) => Math.sqrt(dot(vector, vector));
const clamp = (value: number, limit: number) =>
  Math.min(Math.max(value, -limit), limit);

/**
 * Euler degrees for a rotation matrix, as `rotationMatrix` (and PlayCanvas's
 * `setFromEulerAngles`) builds it: R = Rz · Ry · Rx, row-major. Every
 * rotation has two sets of angles (and at ±90° about Y, the turn about X
 * takes all of X and Z); given `near`, the set nearer it is chosen, so a
 * part turned step by step about Y passes 90° rather than folding back.
 */
export function rotationDegreesFromMatrix(
  matrix: KartMatrix3,
  near?: KartVector,
): KartVector {
  const toDegrees = 180 / Math.PI;
  const cosineY = Math.hypot(matrix[0], matrix[3]);
  // `+ 0` reads −0 as 0, so an unturned part keeps its document unchanged.
  const tidy = (angles: KartVector) => ({
    x: angles.x + 0,
    y: angles.y + 0,
    z: angles.z + 0,
  });
  const wrap = (angle: number) => angle - 360 * Math.round(angle / 360);
  // Moved by whole turns to sit nearest `near`, within the document's
  // ±360°.
  const toward = (angles: KartVector): KartVector => {
    if (!near) return angles;
    const axis = (angle: number, reference: number) => {
      const value = reference + wrap(angle - reference);
      return value > 360 ? value - 360 : value < -360 ? value + 360 : value;
    };
    return {
      x: axis(angles.x, near.x),
      y: axis(angles.y, near.y),
      z: axis(angles.z, near.z),
    };
  };
  if (cosineY < 1e-9) {
    // Only X less (or plus) Z is set: keep the Z asked for, and take X
    // from what is left once that Z is turned back out.
    const y = matrix[6] < 0 ? 90 : -90;
    const z = near?.z ?? 0;
    const rest = multiplyMatrix(rotationMatrix({ x: 0, y: 0, z: -z }), matrix);
    return tidy(
      toward({ x: Math.atan2(-rest[5], rest[4]) * toDegrees, y, z }),
    );
  }
  const first = {
    x: Math.atan2(matrix[7], matrix[8]) * toDegrees,
    y: Math.atan2(-matrix[6], cosineY) * toDegrees,
    z: Math.atan2(matrix[3], matrix[0]) * toDegrees,
  };
  if (!near) return tidy(first);
  const second = {
    x: wrap(first.x + 180),
    y: wrap(180 - first.y),
    z: wrap(first.z + 180),
  };
  const distance = (angles: KartVector) =>
    Math.abs(angles.x - near.x) +
    Math.abs(angles.y - near.y) +
    Math.abs(angles.z - near.z);
  const [a, b] = [toward(first), toward(second)];
  return tidy(distance(a) <= distance(b) ? a : b);
}

/** The smallest rotation taking unit `from` to unit `to`. */
function turnBetween(from: KartVector, to: KartVector): KartMatrix3 {
  const cosine = Math.max(-1, Math.min(1, dot(from, to)));
  let axis = cross(from, to);
  let sine = length(axis);
  if (sine < 1e-12) {
    if (cosine > 0) return [1, 0, 0, 0, 1, 0, 0, 0, 1];
    // Opposed: half a turn about any axis across them.
    axis = cross(from, Math.abs(from.x) < 0.9 ? { x: 1, y: 0, z: 0 } : { x: 0, y: 1, z: 0 });
    sine = 0;
  }
  const k = scaleVector(axis, 1 / length(axis));
  const c = cosine;
  const s = sine;
  const t = 1 - c;
  return [
    t * k.x * k.x + c,
    t * k.x * k.y - s * k.z,
    t * k.x * k.z + s * k.y,
    t * k.x * k.y + s * k.z,
    t * k.y * k.y + c,
    t * k.y * k.z - s * k.x,
    t * k.x * k.z - s * k.y,
    t * k.y * k.z + s * k.x,
    t * k.z * k.z + c,
  ];
}

/**
 * A suspension's mounting geometry is authored in assembly space, so it
 * moves with its part: from one transform to another, rigidly.
 */
export function moveSuspensionMount(
  mount: NonNullable<KartAssemblyComponentInstance["suspensionMount"]>,
  from: KartInstanceTransform,
  to: KartInstanceTransform,
) {
  const inverse = transposeMatrix(rotationMatrix(from.rotationDegrees));
  const next = rotationMatrix(to.rotationDegrees);
  const moved = { ...mount };
  for (const point of Object.keys(mount) as Array<keyof typeof mount>) {
    moved[point] = addVector(
      transformVector(next, transformVector(inverse, subtractVector(mount[point], from.position))),
      to.position,
    );
  }
  return moved;
}

/** A copy of an instance standing at `transform`. */
export function poseKartMountInstance<T extends KartMountInstance>(
  instance: T,
  transform: KartInstanceTransform,
): T {
  if (instance.kind === "component" && instance.suspensionMount) {
    return {
      ...instance,
      suspensionMount: moveSuspensionMount(
        instance.suspensionMount,
        instance.transform,
        transform,
      ),
      transform,
    };
  }
  return { ...instance, transform };
}

const toLocal = (transform: KartInstanceTransform, point: KartVector) =>
  transformVector(
    transposeMatrix(rotationMatrix(transform.rotationDegrees)),
    subtractVector(point, transform.position),
  );
const toWorld = (transform: KartInstanceTransform, local: KartVector) =>
  addVector(
    transform.position,
    transformVector(rotationMatrix(transform.rotationDegrees), local),
  );

/**
 * Where on a face (or pad) a child's meeting point goes: the nearest point
 * to `point` at which the child's region (`offsets`, its corners from the
 * point) rests wholly on the face; null if it cannot. Along an axis where
 * the child is larger than the face (`fitWhole` false), only the point
 * must lie on it, as a wide bumper meets a plate's edge.
 */
function placeOnRegion(
  region: NonNullable<KartResolvedMount["region"]>,
  point: KartVector,
  offsets: KartVector[],
  fitWhole: boolean,
): KartVector | null {
  const tolerance = KART_MOUNT_TOLERANCE_METERS / 2;
  if (region.kind === "disc") {
    // Each corner must lie on the disc, so the meeting point must lie in
    // the disc moved back by that corner's offset: the places that fit are
    // where those discs (and the disc itself) overlap, and the nearest of
    // them is found by Dykstra's alternating projections.
    const discs = [{ x: 0, y: 0, z: 0 }, ...offsets].map((offset) =>
      subtractVector(region.center, offset),
    );
    const fits = (at: KartVector) =>
      discs.every(
        (center) => length(subtractVector(at, center)) <= region.radius + tolerance,
      );
    if (fits(point)) return point;
    let at = point;
    const corrections = discs.map(() => ({ x: 0, y: 0, z: 0 }));
    for (let sweep = 0; sweep < 400; sweep += 1) {
      const from = at;
      discs.forEach((center, index) => {
        const moved = addVector(at, corrections[index]);
        const out = subtractVector(moved, center);
        const reach = length(out);
        const projected =
          reach <= region.radius
            ? moved
            : addVector(center, scaleVector(out, region.radius / reach));
        corrections[index] = subtractVector(moved, projected);
        at = projected;
      });
      if (length(subtractVector(at, from)) < 1e-12) break;
    }
    if (fits(at)) return at;
    // Nearly tangent, the projections can creep: then come in along the line
    // toward the centre, where the places that fit run from the centre out.
    if (fits(region.center)) {
      const outward = subtractVector(point, region.center);
      let inside = 0;
      let outside = 1;
      for (let step = 0; step < 48; step += 1) {
        const middle = (inside + outside) / 2;
        if (fits(addVector(region.center, scaleVector(outward, middle)))) {
          inside = middle;
        } else {
          outside = middle;
        }
      }
      return addVector(region.center, scaleVector(outward, inside));
    }
    return fitWhole ? null : placeOnRegion(region, point, [], true);
  }
  const offset = subtractVector(point, region.center);
  const along = (axis: KartVector, half: number) => {
    const reaches = offsets.map((corner) => dot(corner, axis));
    const low = -half - Math.min(0, ...reaches);
    const high = half - Math.max(0, ...reaches);
    const value = dot(offset, axis);
    if (low > high + tolerance) {
      if (fitWhole) return null;
      return clamp(value, half);
    }
    return Math.min(Math.max(value, low), Math.max(high, low));
  };
  const u = along(region.u, region.halfU);
  const v = along(region.v, region.halfV);
  if (u === null || v === null) return null;
  return addVector(
    region.center,
    addVector(scaleVector(region.u, u), scaleVector(region.v, v)),
  );
}

/**
 * A shock's top eye goes this far within its pin's part where the part is
 * deep enough: the edge distance the official towers keep, so the bolt has
 * material around it.
 */
const PIN_EDGE_DISTANCE = 0.004;

/**
 * The nearest point to `point` within a primitive (a pin's part): a point
 * already within it stays, and one outside comes in by the edge distance.
 */
function closestWithin(instance: KartMountInstance, point: KartVector) {
  if (instance.kind !== "primitive") return null;
  const local = toLocal(instance.transform, point);
  const room = (half: number) => Math.max(half - PIN_EDGE_DISTANCE, 0);
  const inside = (value: number, half: number) =>
    Math.abs(value) <= half + KART_MOUNT_TOLERANCE_METERS / 2;
  if (instance.shape === "box") {
    if (
      inside(local.x, instance.size.x / 2) &&
      inside(local.y, instance.size.y / 2) &&
      inside(local.z, instance.size.z / 2)
    ) {
      return point;
    }
    return toWorld(instance.transform, {
      x: clamp(local.x, room(instance.size.x / 2)),
      y: clamp(local.y, room(instance.size.y / 2)),
      z: clamp(local.z, room(instance.size.z / 2)),
    });
  }
  const { axis, height, radius } = instance;
  const across = { ...local, [axis]: 0 };
  const reach = length(across);
  if (inside(local[axis], height / 2) && inside(reach, radius)) return point;
  const scale = reach > room(radius) ? room(radius) / reach : 1;
  return toWorld(instance.transform, {
    ...scaleVector(across, scale),
    [axis]: clamp(local[axis], room(height / 2)),
  });
}

export type KartMountSnap = {
  childMount: string;
  /** How far the seated mount moved. */
  distance: number;
  parentMount: string;
  /** Where the two mounts meet, in assembly space. */
  point: KartVector;
  transform: KartInstanceTransform;
  /** How far the part turned to face its mount, in radians. */
  turn: number;
};

const findMount = (side: KartMountSide, instance: KartMountInstance, id: string) =>
  listKartInstanceMounts(instance, side.definition).find(
    (mount) => mount.id === id,
  );

function regionCorners(region: KartResolvedMount["region"]) {
  if (region?.kind !== "rectangle") return [];
  return [-1, 1].flatMap((su) =>
    [-1, 1].map((sv) =>
      addVector(
        region.center,
        addVector(
          scaleVector(region.u, su * region.halfU),
          scaleVector(region.v, sv * region.halfV),
        ),
      ),
    ),
  );
}

/**
 * Where `child`, asked to stand at `transform`, stands with its mount
 * `childMountId` seated on its parent's `parentMountId`; null if they
 * cannot meet (a footprint larger than its face, or an unseatable pair).
 * `carried` is the point on a child's face, in its own frame, that meets
 * the parent (its centre by default), so a face slides from where it is.
 * A turn to face the mount is made about the part's own origin, so a tilt
 * the mount refuses is undone exactly.
 */
export function seatKartMount(
  child: KartMountSide,
  parent: KartMountSide,
  childMountId: string,
  parentMountId: string,
  transform: KartInstanceTransform,
  carried?: KartVector,
): KartMountSnap | null {
  const asked = poseKartMountInstance(child.instance, transform);
  const childMount = findMount(child, asked, childMountId);
  const parentMount = findMount(parent, parent.instance, parentMountId);
  if (
    !childMount ||
    !parentMount ||
    !SEATS[childMount.kind]?.includes(parentMount.kind)
  ) {
    return null;
  }
  // The point on the child that meets the parent, in the child's frame: a
  // carried point is kept on the face itself (which a resize may move).
  let local = toLocal(transform, childMount.point);
  if (childMount.kind === "face" && carried && childMount.normal) {
    const at = toWorld(transform, carried);
    local = toLocal(
      transform,
      subtractVector(
        at,
        scaleVector(
          childMount.normal,
          dot(subtractVector(at, childMount.point), childMount.normal),
        ),
      ),
    );
  }

  // Facing mounts turn the part to face; a part already facing keeps the
  // angles it was asked for, as typed.
  let rotationDegrees = transform.rotationDegrees;
  let turn = 0;
  if (childMount.normal && parentMount.normal) {
    const facing = scaleVector(parentMount.normal, -1);
    turn = Math.acos(Math.max(-1, Math.min(1, dot(childMount.normal, facing))));
    if (turn > 1e-12) {
      rotationDegrees = rotationDegreesFromMatrix(
        multiplyMatrix(
          turnBetween(childMount.normal, facing),
          rotationMatrix(transform.rotationDegrees),
        ),
        transform.rotationDegrees,
      );
    }
  }
  const turned = { position: transform.position, rotationDegrees };
  const point = toWorld(turned, local);

  let target: KartVector | null;
  if (parentMount.kind === "face" || parentMount.kind === "tower-pad") {
    const normal = parentMount.normal!;
    const onPlane = subtractVector(
      point,
      scaleVector(normal, dot(subtractVector(point, parentMount.point), normal)),
    );
    // The child's own footprint or face, from its meeting point: a base
    // must rest wholly on the face, and a face does where it fits.
    const region = findMount(
      child,
      poseKartMountInstance(child.instance, turned),
      childMountId,
    )!.region;
    const offsets = regionCorners(region).map((corner) => {
      const offset = subtractVector(corner, point);
      return subtractVector(offset, scaleVector(normal, dot(offset, normal)));
    });
    target = parentMount.region
      ? placeOnRegion(
          parentMount.region,
          onPlane,
          offsets,
          childMount.kind === "base",
        )
      : onPlane;
  } else if (parentMount.kind === "pin") {
    target = closestWithin(parent.instance, point);
  } else {
    target = parentMount.point;
  }
  if (!target) return null;

  const shift = subtractVector(target, point);
  const seated = {
    position: addVector(turned.position, shift),
    rotationDegrees: turned.rotationDegrees,
  };
  const seatedMount = findMount(
    child,
    poseKartMountInstance(child.instance, seated),
    childMountId,
  )!;
  if (checkKartMountPair(seatedMount, parentMount, target)) return null;
  return {
    childMount: childMountId,
    distance: length(shift),
    parentMount: parentMountId,
    point: target,
    transform: seated,
    turn,
  };
}

/**
 * The nearest seat for `child`, asked to stand at `transform`, on any of
 * its parent's mounting points: within `KART_SNAP_REACH_METERS` and a
 * turn of 45°, nearest first.
 */
export function findKartMountSnap(
  child: KartMountSide,
  parent: KartMountSide,
  transform: KartInstanceTransform,
): KartMountSnap | null {
  const asked = poseKartMountInstance(child.instance, transform);
  const parentMounts = listKartInstanceMounts(parent.instance, parent.definition);
  let best: KartMountSnap | null = null;
  for (const childMount of listKartInstanceMounts(asked, child.definition)) {
    const seats = SEATS[childMount.kind];
    if (!seats) continue;
    for (const parentMount of parentMounts) {
      if (!seats.includes(parentMount.kind)) continue;
      const snap = seatKartMount(
        child,
        parent,
        childMount.id,
        parentMount.id,
        transform,
      );
      if (
        !snap ||
        snap.turn > KART_SNAP_MAXIMUM_TURN + 1e-9 ||
        snap.distance > KART_SNAP_REACH_METERS + 1e-9
      ) {
        continue;
      }
      if (
        !best ||
        snap.distance < best.distance - 1e-9 ||
        (snap.distance <= best.distance + 1e-9 && snap.turn < best.turn)
      ) {
        best = snap;
      }
    }
  }
  return best;
}

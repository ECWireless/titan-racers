import { DEFAULT_KART_COLLISION_CONSTRUCTION } from "../collision/kart-collision-model";
import type { RaceQuaternion, RaceVector3 } from "../race/race-gate";

/**
 * Contact between two karts in a room, where each client simulates only its
 * own kart (the kart-to-kart contact standard). One box around each kart's
 * collision hull stands in for it. Two boxes touch by separating axes, tested
 * along a motion in sub-steps short enough that none can pass through or
 * graze unseen. A touch meets at a few points, the corners of each box's
 * touching face that lie within the other's, each answered with a two-body
 * impulse given both karts' mass and inertia, with Coulomb friction. It
 * changes velocity and spin only. The page and the room server share this
 * code, so both resolve a contact the same way, whichever kart comes first.
 */

type Vec3 = RaceVector3;

type SourceVector = { readonly x: number; readonly y: number; readonly z: number };
type SourceTransform = {
  readonly position: SourceVector;
  readonly rotationDegrees: SourceVector;
};

/**
 * The parts of a published kart snapshot (any version) contact reads, so
 * the room server needn't type-check the kart derivation.
 */
export type KartContactSource = {
  readonly geometry: {
    readonly collisionCompound: ReadonlyArray<
      | {
          readonly shape: "box";
          readonly size: SourceVector;
          readonly transform: SourceTransform;
        }
      | {
          readonly shape: "cylinder";
          readonly axis: "x" | "y" | "z";
          readonly height: number;
          readonly radius: number;
          readonly transform: SourceTransform;
        }
    >;
    readonly wheelGuard?: {
      readonly size: SourceVector;
      readonly transform: SourceTransform;
    };
  };
  readonly massProperties: {
    readonly centerOfMass: SourceVector;
    readonly inertiaTensor: {
      readonly xx: number;
      readonly yy: number;
      readonly zz: number;
      readonly xy: number;
      readonly xz: number;
      readonly yz: number;
    };
    readonly totalMass: number;
  };
};

/** What contact needs to know about a kart, from its published snapshot. */
export type KartContactShape = {
  /**
   * The box around its collision hull, in the kart's own axes, from its
   * centre of mass (m).
   */
  center: Vec3;
  halfExtents: Vec3;
  /** kg. */
  mass: number;
  /** About the centre of mass, in the kart's own axes (kg·m²). */
  inertia: { xx: number; yy: number; zz: number; xy: number; xz: number; yz: number };
};

/** Where a kart's centre of mass is, and its own axes' rotation. */
export type KartPose = { position: Vec3; rotation: RaceQuaternion };

/** A kart's pose and motion; `spin` is its angular velocity (rad/s). */
export type KartContactBody = KartPose & { velocity: Vec3; spin: Vec3 };

export type ContactKart = { shape: KartContactShape; body: KartContactBody };

export type KartContactPoint = {
  point: Vec3;
  /** From each kart's centre of mass to the point. */
  leverA: Vec3;
  leverB: Vec3;
  /** The overlap there along the normal; negative is the gap still to close. */
  depth: number;
};

export type KartContact = {
  /** Unit, from kart a toward kart b. */
  normal: Vec3;
  /** Where the karts meet, measured where they are at the motion's start. */
  points: KartContactPoint[];
  /** How far along the motion they first touch, 0 to 1. */
  at: number;
};

export type KartContactResponse = {
  normal: Vec3;
  /** Where it pushed, weighted by how hard at each point. */
  point: Vec3;
  /** The fastest the karts were closing at any point (m/s). */
  closingSpeed: number;
  /** The impulse on kart b; kart a takes the opposite. */
  impulse: Vec3;
  /** Each kart's angular impulse about its centre of mass. */
  turnA: Vec3;
  turnB: Vec3;
};

const material = DEFAULT_KART_COLLISION_CONSTRUCTION.bodyContactMaterial;

export const KART_CONTACT = {
  /**
   * Combined as kart-against-course contacts are, by multiplying the two
   * karts' materials.
   */
  friction: material.friction * material.friction,
  restitution: material.restitution * material.restitution,
  /** Overlap up to this is left alone, so resting contact doesn't jitter. */
  slopMetres: 0.005,
  /** Overlap beyond it is closed at this share a second... */
  separationPerSecond: 20,
  /** ...never faster than this, so an estimate's error can't eject a kart. */
  maxSeparationSpeed: 0.5,
  /** A sweep's sub-step moves at most this share of the smallest box size. */
  sweepShare: 0.25,
  maxSweepSteps: 64,
  /** Near a touch, the sweep looks this many times closer. */
  refineSteps: 8,
  /**
   * A contact's points are answered in turn up to this many times over, so
   * points still apart and points already overlapping settle together.
   */
  passes: 32,
  /**
   * ...stopping once a pass changes no impulse by more than this (N·s),
   * about 50 µm/s on a kart.
   */
  settledImpulse: 1e-4,
};

/**
 * The contact box, mass, and inertia, rounded as the room's token carries
 * them. The box stops at the wheel guard's top: above it stand only the
 * narrow shock towers, which would raise every contact, and the pitch it
 * gives, above where karts really meet.
 */
export function kartContactShape(snapshot: KartContactSource): KartContactShape {
  const { centerOfMass, inertiaTensor, totalMass } = snapshot.massProperties;
  const guard = snapshot.geometry.wheelGuard;
  const primitives = [
    ...snapshot.geometry.collisionCompound,
    ...(guard ? [{ ...guard, shape: "box" as const }] : []),
  ];
  const min = { x: Infinity, y: Infinity, z: Infinity };
  const max = { x: -Infinity, y: -Infinity, z: -Infinity };
  for (const primitive of primitives) {
    const half =
      primitive.shape === "box"
        ? scale(primitive.size, 0.5)
        : {
            x: primitive.axis === "x" ? primitive.height / 2 : primitive.radius,
            y: primitive.axis === "y" ? primitive.height / 2 : primitive.radius,
            z: primitive.axis === "z" ? primitive.height / 2 : primitive.radius,
          };
    const rotation = eulerRotation(primitive.transform.rotationDegrees);
    for (const sx of [-1, 1]) {
      for (const sy of [-1, 1]) {
        for (const sz of [-1, 1]) {
          const corner = sub(
            add(
              rotate(rotation, { x: sx * half.x, y: sy * half.y, z: sz * half.z }),
              primitive.transform.position,
            ),
            centerOfMass,
          );
          for (const axis of AXES) {
            min[axis] = Math.min(min[axis], corner[axis]);
            max[axis] = Math.max(max[axis], corner[axis]);
          }
        }
      }
    }
  }
  if (guard) {
    max.y = Math.min(
      max.y,
      guard.transform.position.y + guard.size.y / 2 - centerOfMass.y,
    );
  }
  const round = (value: number, places: number) =>
    Number(value.toFixed(places)) || 0;
  const box = (value: (axis: (typeof AXES)[number]) => number) => ({
    x: round(value("x"), 4),
    y: round(value("y"), 4),
    z: round(value("z"), 4),
  });
  return {
    center: box((axis) => (min[axis] + max[axis]) / 2),
    halfExtents: box((axis) => (max[axis] - min[axis]) / 2),
    mass: round(totalMass, 4),
    inertia: {
      xx: round(inertiaTensor.xx, 6),
      yy: round(inertiaTensor.yy, 6),
      zz: round(inertiaTensor.zz, 6),
      xy: round(inertiaTensor.xy, 6),
      xz: round(inertiaTensor.xz, 6),
      yz: round(inertiaTensor.yz, 6),
    },
  };
}

/**
 * The first time two karts, each moving from one pose to another, touch, or
 * null. It tests sub-steps short enough that none can pass through; where
 * the boxes come within half a sub-step's travel, it looks closer, so only a
 * graze that sinks in less than about a millimetre goes unseen. Its points
 * are where the karts first meet, carried back to where they start, each
 * with its own gap. Coming within `within` metres counts as touching: the
 * room allows the slop, since the pages' answers stop karts just touching,
 * which the straight paths between their states can miss.
 */
export function sweepKartContact(
  a: { shape: KartContactShape; from: KartPose; to: KartPose },
  b: { shape: KartContactShape; from: KartPose; to: KartPose },
  within = 0,
): KartContact | null {
  const reachA = reach(a.shape);
  const reachB = reach(b.shape);
  const stepMetres =
    KART_CONTACT.sweepShare *
    2 *
    Math.min(smallest(a.shape.halfExtents), smallest(b.shape.halfExtents));
  const margin = stepMetres / 2;
  // Too far apart all the way, by the spheres around each box.
  const start = sub(b.from.position, a.from.position);
  const motion = sub(
    sub(b.to.position, b.from.position),
    sub(a.to.position, a.from.position),
  );
  const motionSquared = dot(motion, motion);
  const closest =
    motionSquared > 0
      ? Math.min(1, Math.max(0, -dot(start, motion) / motionSquared))
      : 0;
  const apart = reachA + reachB + margin + within;
  if (length(add(start, scale(motion, closest))) > apart) return null;

  const travel =
    Math.sqrt(motionSquared) +
    turned(a.from.rotation, a.to.rotation) * reachA +
    turned(b.from.rotation, b.to.rotation) * reachB;
  const steps = Math.min(
    KART_CONTACT.maxSweepSteps,
    Math.max(1, Math.ceil(travel / stepMetres)),
  );
  const sample = (at: number, reachMetres: number) => {
    const poseA = between(a.from, a.to, at);
    const poseB = between(b.from, b.to, at);
    const boxA = worldBox(a.shape, poseA);
    const boxB = worldBox(b.shape, poseB);
    const overlap = boxOverlap(boxA, boxB, reachMetres);
    return overlap && { at, poseA, poseB, boxA, boxB, overlap };
  };
  const fine = KART_CONTACT.refineSteps;
  let scannedTo = 0;
  for (let step = 0; step <= steps; step += 1) {
    if (!sample(step / steps, margin + within)) continue;
    // Within reach of touching: look closer, around this sub-step, for
    // where they really touch. Passing close without touching isn't contact.
    const first = Math.max(scannedTo, step - 1) * fine;
    const last = Math.min(steps, step + 1) * fine;
    for (let index = first; index <= last; index += 1) {
      const touch = sample(index / (steps * fine), within);
      if (touch) return contactAt(a, b, touch);
    }
    scannedTo = Math.min(steps, step + 1);
  }
  return null;
}

/** The contact where two karts' boxes touch, carried back to their starts. */
function contactAt(
  a: { from: KartPose },
  b: { from: KartPose },
  touch: {
    at: number;
    poseA: KartPose;
    poseB: KartPose;
    boxA: WorldBox;
    boxB: WorldBox;
    overlap: Overlap;
  },
): KartContact {
  const { at, poseA, poseB, boxA, boxB, overlap } = touch;
  const { normal } = overlap;
  // Each kart's part of each point, carried back with that kart to where it
  // starts, so a point's gap is between the two parts that will meet. In one
  // order by position, without repeats, so the points are answered the same
  // way whichever kart comes first.
  const points = new Map<string, KartContactPoint>();
  for (const { onA, onB } of contactPoints(boxA, boxB, overlap)) {
    const startA = carried(onA, poseA, a.from);
    const startB = carried(onB, poseB, b.from);
    const point = scale(add(startA, startB), 0.5);
    const depth = dot(sub(startA, startB), normal);
    const key = positionKey(point);
    const kept = points.get(key);
    if (kept && kept.depth >= depth) continue;
    points.set(key, {
      point,
      leverA: sub(point, a.from.position),
      leverB: sub(point, b.from.position),
      depth,
    });
  }
  return {
    normal,
    points: [...points.entries()]
      .sort(([left], [right]) => compareKeys(left, right))
      .map(([, point]) => point),
    at,
  };
}

/**
 * The impulses that answer a contact, given each kart's motion now, or null
 * when they aren't closing. At each point in turn, touching, it removes the
 * closing speed (all but the restitution) and pushes any overlap apart at a
 * capped speed; short of touching, it lets them close only the gap within
 * `stepSeconds`, so they meet rather than stopping short.
 */
export function resolveKartContact(
  a: ContactKart,
  b: ContactKart,
  contact: Pick<KartContact, "normal" | "points">,
  stepSeconds: number,
): KartContactResponse | null {
  const { normal, points } = contact;
  // Neither kart turns within one answer, so each one's inertia is fixed.
  const [moverA, moverB] = [a, b].map((kart) => ({
    inverseMass: 1 / kart.shape.mass,
    inverseInertia: worldInverseInertia(kart),
    velocity: kart.body.velocity,
    spin: kart.body.spin,
  }));
  const relativeAt = ({ leverA, leverB }: KartContactPoint) =>
    sub(
      add(moverB.velocity, cross(moverB.spin, leverB)),
      add(moverA.velocity, cross(moverA.spin, leverA)),
    );
  /** How much the closing speed along `direction` changes per unit impulse. */
  const resistance = ({ leverA, leverB }: KartContactPoint, direction: Vec3) =>
    moverA.inverseMass +
    moverB.inverseMass +
    dot(direction, cross(times(moverA.inverseInertia, cross(leverA, direction)), leverA)) +
    dot(direction, cross(times(moverB.inverseInertia, cross(leverB, direction)), leverB));
  // Each point's aim, from how the karts move before any of it: touching,
  // to part at the restitution's share of the closing speed, or faster to
  // undo an overlap; short of touching, to close no more than the gap.
  let closingSpeed = -Infinity;
  const targets = points.map((point) => {
    const normalSpeed = dot(relativeAt(point), normal);
    closingSpeed = Math.max(closingSpeed, -normalSpeed);
    const { depth } = point;
    return depth < 0
      ? depth / stepSeconds
      : Math.max(
          normalSpeed < 0 ? -KART_CONTACT.restitution * normalSpeed : 0,
          Math.min(
            KART_CONTACT.maxSeparationSpeed,
            Math.max(0, depth - KART_CONTACT.slopMetres) *
              KART_CONTACT.separationPerSecond,
          ),
        );
  });
  // Each point's normal and friction impulses so far: a later pass may take
  // back what an earlier one gave, but never pull the karts together.
  const pressing = points.map(() => 0);
  const gripping = points.map(() => ZERO);
  let impulse = ZERO;
  let turnA = ZERO;
  let turnB = ZERO;
  const push = ({ leverA, leverB }: KartContactPoint, change: Vec3) => {
    const changeA = cross(leverA, scale(change, -1));
    const changeB = cross(leverB, change);
    moverA.velocity = sub(moverA.velocity, scale(change, moverA.inverseMass));
    moverA.spin = add(moverA.spin, times(moverA.inverseInertia, changeA));
    moverB.velocity = add(moverB.velocity, scale(change, moverB.inverseMass));
    moverB.spin = add(moverB.spin, times(moverB.inverseInertia, changeB));
    impulse = add(impulse, change);
    turnA = add(turnA, changeA);
    turnB = add(turnB, changeB);
  };
  // Start from the whole contact answered at once, at its points' centre
  // weighted by what each needs, shared out by need. Answering one point at
  // a time from nothing leaves a flat face's points pushed unevenly, so a
  // square hit would spin the karts; from here the passes only refine.
  const needs = points.map((point, index) =>
    Math.max(0, targets[index] - dot(relativeAt(point), normal)),
  );
  const needed = needs.reduce((sum, value) => sum + value, 0);
  if (needed > 0) {
    const weighted = (pick: (point: KartContactPoint) => Vec3) =>
      scale(
        points.reduce(
          (sum, point, index) => add(sum, scale(pick(point), needs[index])),
          ZERO,
        ),
        1 / needed,
      );
    const centre: KartContactPoint = {
      point: weighted(({ point }) => point),
      leverA: weighted(({ leverA }) => leverA),
      leverB: weighted(({ leverB }) => leverB),
      depth: 0,
    };
    const target =
      targets.reduce((sum, value, index) => sum + value * needs[index], 0) /
      needed;
    const whole = Math.max(
      0,
      (target - dot(relativeAt(centre), normal)) / resistance(centre, normal),
    );
    points.forEach((point, index) => {
      const share = (whole * needs[index]) / needed;
      if (share <= 0) return;
      push(point, scale(normal, share));
      pressing[index] = share;
    });
  }
  for (
    let pass = 0, changed = Infinity;
    pass < KART_CONTACT.passes && changed > KART_CONTACT.settledImpulse;
    pass += 1
  ) {
    changed = 0;
    points.forEach((point, index) => {
      const normalSpeed = dot(relativeAt(point), normal);
      const pressed = Math.max(
        0,
        pressing[index] +
          (targets[index] - normalSpeed) / resistance(point, normal),
      );
      if (pressed !== pressing[index]) {
        changed = Math.max(changed, Math.abs(pressed - pressing[index]));
        push(point, scale(normal, pressed - pressing[index]));
        pressing[index] = pressed;
      }
      // Friction against the sliding left, within the cone the normal
      // impulse allows.
      const relative = relativeAt(point);
      const sliding = sub(relative, scale(normal, dot(relative, normal)));
      const slidingSpeed = length(sliding);
      let grip = gripping[index];
      if (slidingSpeed > 1e-9) {
        const tangent = scale(sliding, 1 / slidingSpeed);
        grip = sub(grip, scale(tangent, slidingSpeed / resistance(point, tangent)));
      }
      const most = KART_CONTACT.friction * pressed;
      const size = length(grip);
      if (size > most) grip = size > 0 ? scale(grip, most / size) : ZERO;
      const gripChange = sub(grip, gripping[index]);
      changed = Math.max(changed, length(gripChange));
      push(point, gripChange);
      gripping[index] = grip;
    });
  }
  const pressed = pressing.reduce((sum, value) => sum + value, 0);
  if (pressed <= 0) return null;
  return {
    normal,
    point: scale(
      points.reduce(
        (sum, { point }, index) => add(sum, scale(point, pressing[index])),
        ZERO,
      ),
      1 / pressed,
    ),
    closingSpeed,
    impulse,
    turnA,
    turnB,
  };
}

/**
 * A kart's motion after an impulse and an angular impulse about its centre
 * of mass (an impulse at a lever turns it by lever × impulse).
 */
export function withKartImpulse(
  kart: ContactKart,
  impulse: Vec3,
  turn: Vec3,
): KartContactBody {
  const { body, shape } = kart;
  return {
    ...body,
    velocity: add(body.velocity, scale(impulse, 1 / shape.mass)),
    spin: add(body.spin, times(worldInverseInertia(kart), turn)),
  };
}

/** Whether two karts' boxes are within `metres` of touching, as posed. */
export function kartsWithin(
  a: { shape: KartContactShape; pose: KartPose },
  b: { shape: KartContactShape; pose: KartPose },
  metres: number,
) {
  return (
    boxOverlap(worldBox(a.shape, a.pose), worldBox(b.shape, b.pose), metres) !==
    null
  );
}

/** A point moving rigidly with a kart from one of its poses to another. */
export function carryKartPoint(point: Vec3, from: KartPose, to: KartPose): Vec3 {
  return carried(point, from, to);
}

/** A kart's pose `at` (0 to 1) of the way between two of its poses. */
export function betweenKartPoses(
  from: KartPose,
  to: KartPose,
  at: number,
): KartPose {
  return between(from, to, at);
}

/** Where a kart's motion carries its pose in `seconds`. */
export function advanceKartPose(body: KartContactBody, seconds: number): KartPose {
  return {
    position: add(body.position, scale(body.velocity, seconds)),
    rotation: turnBy(body.rotation, body.spin, seconds),
  };
}

const AXES = ["x", "y", "z"] as const;
const ZERO: Vec3 = { x: 0, y: 0, z: 0 };

type WorldBox = {
  center: Vec3;
  axes: [Vec3, Vec3, Vec3];
  half: [number, number, number];
};

type Overlap = {
  depth: number;
  /** The depth as a share of both boxes' reach along the normal. */
  share: number;
  /** From box a toward box b. */
  normal: Vec3;
  feature:
    | { kind: "faceA"; index: number }
    | { kind: "faceB"; index: number }
    | { kind: "edges"; indexA: number; indexB: number };
};

function worldBox(shape: KartContactShape, pose: KartPose): WorldBox {
  const { halfExtents } = shape;
  return {
    center: add(pose.position, rotate(pose.rotation, shape.center)),
    axes: [
      rotate(pose.rotation, { x: 1, y: 0, z: 0 }),
      rotate(pose.rotation, { x: 0, y: 1, z: 0 }),
      rotate(pose.rotation, { x: 0, y: 0, z: 1 }),
    ],
    half: [halfExtents.x, halfExtents.y, halfExtents.z],
  };
}

function radiusAlong(box: WorldBox, axis: Vec3) {
  return (
    box.half[0] * Math.abs(dot(box.axes[0], axis)) +
    box.half[1] * Math.abs(dot(box.axes[1], axis)) +
    box.half[2] * Math.abs(dot(box.axes[2], axis))
  );
}

/**
 * The two boxes' overlap along the axis that separates them least, or null
 * when some axis separates them by more than `margin`; a negative overlap is
 * a gap within it. Least is by share of the boxes' reach along the axis, so
 * flat karts pressed deep into each other end to end still push apart end to
 * end, not up through their shallow height. A face's axis wins over two
 * edges' unless the edges' overlap is clearly smaller, so near-aligned karts
 * meet face on.
 */
function boxOverlap(a: WorldBox, b: WorldBox, margin: number): Overlap | null {
  const between = sub(b.center, a.center);
  let face: Overlap | null = null;
  let edges: Overlap | null = null;
  const test = (axis: Vec3, feature: Overlap["feature"]) => {
    const distance = dot(between, axis);
    const reachAlong = radiusAlong(a, axis) + radiusAlong(b, axis);
    const depth = reachAlong - Math.abs(distance);
    if (depth < -margin) return false;
    const share = depth / reachAlong;
    const best = feature.kind === "edges" ? edges : face;
    // Equal shares go to the same axis whichever kart comes first.
    if (
      !best ||
      share < best.share - 1e-9 ||
      (share <= best.share + 1e-9 && lineKey(axis) < lineKey(best.normal))
    ) {
      const found = {
        depth,
        share,
        normal: distance < 0 ? scale(axis, -1) : axis,
        feature,
      };
      if (feature.kind === "edges") edges = found;
      else face = found;
    }
    return true;
  };
  for (let index = 0; index < 3; index += 1) {
    if (!test(a.axes[index], { kind: "faceA", index })) return null;
    if (!test(b.axes[index], { kind: "faceB", index })) return null;
  }
  for (let indexA = 0; indexA < 3; indexA += 1) {
    for (let indexB = 0; indexB < 3; indexB += 1) {
      const axis = cross(a.axes[indexA], b.axes[indexB]);
      const size = length(axis);
      // Near-parallel edges give no direction of their own.
      if (size < 1e-3) continue;
      if (!test(scale(axis, 1 / size), { kind: "edges", indexA, indexB })) {
        return null;
      }
    }
  }
  const faceOverlap = face as Overlap | null;
  const edgeOverlap = edges as Overlap | null;
  if (!faceOverlap) return edgeOverlap;
  return edgeOverlap &&
    edgeOverlap.share <
      faceOverlap.share - 0.05 * Math.abs(faceOverlap.share) - 1e-3
    ? edgeOverlap
    : faceOverlap;
}

/** Where two boxes meet across the overlap's feature: each box's part. */
function contactPoints(
  a: WorldBox,
  b: WorldBox,
  { feature, normal }: Overlap,
): Array<{ onA: Vec3; onB: Vec3 }> {
  if (feature.kind === "edges") {
    // The closest points of the edge of each box nearest the other.
    const [onA, onB] = closestOnSegments(
      supportEdge(a, feature.indexA, normal),
      supportEdge(b, feature.indexB, scale(normal, -1)),
    );
    return [{ onA, onB }];
  }
  return feature.kind === "faceA"
    ? facePoints(a, feature.index, b, normal).map(
        ({ onReference, onIncident }) => ({ onA: onReference, onB: onIncident }),
      )
    : facePoints(b, feature.index, a, scale(normal, -1)).map(
        ({ onReference, onIncident }) => ({ onA: onIncident, onB: onReference }),
      );
}

/**
 * A face of `reference`, facing `incident` along `normal`, against the
 * incident face most turned toward it: the incident face clipped to the
 * reference face's edges (Sutherland–Hodgman), each corner paired with the
 * point of the reference face across from it.
 */
function facePoints(
  reference: WorldBox,
  index: number,
  incident: WorldBox,
  normal: Vec3,
): Array<{ onReference: Vec3; onIncident: Vec3 }> {
  const plane = dot(reference.center, normal) + reference.half[index];
  let facing = 0;
  for (let axis = 1; axis < 3; axis += 1) {
    if (
      Math.abs(dot(incident.axes[axis], normal)) >
      Math.abs(dot(incident.axes[facing], normal))
    ) {
      facing = axis;
    }
  }
  const outward = scale(
    incident.axes[facing],
    dot(incident.axes[facing], normal) > 0 ? -1 : 1,
  );
  const corners = faceCorners(incident, facing, outward);
  let clipped = corners;
  for (let axis = 0; axis < 3 && clipped.length > 0; axis += 1) {
    if (axis === index) continue;
    for (const sign of [-1, 1]) {
      clipped = clipPolygon(
        clipped,
        reference.center,
        scale(reference.axes[axis], sign),
        reference.half[axis],
      );
    }
  }
  if (clipped.length > 0) {
    return clipped.map((corner) => ({
      onReference: add(corner, scale(normal, plane - dot(corner, normal))),
      onIncident: corner,
    }));
  }
  // The faces don't overlap: they meet where a corner of either comes
  // closest to the other face, the same pair whichever kart comes first.
  const side = dot(reference.axes[index], normal) < 0 ? -1 : 1;
  let closest: { onReference: Vec3; onIncident: Vec3 } | null = null;
  let closestMetres = Infinity;
  const consider = (onReference: Vec3, onIncident: Vec3) => {
    const offset = sub(onIncident, onReference);
    const metres = length(sub(offset, scale(normal, dot(offset, normal))));
    const tied = closest !== null && Math.abs(metres - closestMetres) < 1e-9;
    if (
      metres < closestMetres - 1e-9 ||
      (tied &&
        compareKeys(
          positionKey(add(onReference, onIncident)),
          positionKey(add(closest!.onReference, closest!.onIncident)),
        ) < 0)
    ) {
      closest = { onReference, onIncident };
      closestMetres = Math.min(metres, closestMetres);
    }
  };
  for (const corner of corners) {
    consider(onFace(reference, index, corner), corner);
  }
  for (const corner of faceCorners(
    reference,
    index,
    scale(reference.axes[index], side),
  )) {
    consider(corner, onFace(incident, facing, corner));
  }
  return [closest!];
}

/** The four corners, in order around it, of a box's face facing `outward`. */
function faceCorners(box: WorldBox, index: number, outward: Vec3): Vec3[] {
  const center = add(box.center, scale(outward, box.half[index]));
  const [first, second] = [0, 1, 2].filter((axis) => axis !== index);
  return [
    [-1, -1],
    [-1, 1],
    [1, 1],
    [1, -1],
  ].map(([u, v]) =>
    add(
      add(center, scale(box.axes[first], u * box.half[first])),
      scale(box.axes[second], v * box.half[second]),
    ),
  );
}

/** The part of a polygon within `limit` of `center` along unit `axis`. */
function clipPolygon(
  polygon: Vec3[],
  center: Vec3,
  axis: Vec3,
  limit: number,
): Vec3[] {
  const kept: Vec3[] = [];
  polygon.forEach((point, index) => {
    const next = polygon[(index + 1) % polygon.length];
    const beyond = dot(sub(point, center), axis) - limit;
    const nextBeyond = dot(sub(next, center), axis) - limit;
    if (beyond <= 0) kept.push(point);
    if ((beyond < 0 && nextBeyond > 0) || (beyond > 0 && nextBeyond < 0)) {
      kept.push(
        add(point, scale(sub(next, point), beyond / (beyond - nextBeyond))),
      );
    }
  });
  return kept;
}

/** A point held within a box's face along axis `index`, on its plane. */
function onFace(box: WorldBox, index: number, point: Vec3): Vec3 {
  const offset = sub(point, box.center);
  let held = box.center;
  for (let axis = 0; axis < 3; axis += 1) {
    const half = box.half[axis];
    const along = dot(offset, box.axes[axis]);
    held = add(
      held,
      scale(
        box.axes[axis],
        axis === index
          ? Math.sign(along || 1) * half
          : Math.min(half, Math.max(-half, along)),
      ),
    );
  }
  return held;
}

type Segment = { center: Vec3; direction: Vec3; half: number };

/** The box's edge along axis `index` furthest toward `toward`. */
function supportEdge(box: WorldBox, index: number, toward: Vec3): Segment {
  let center = box.center;
  for (let axis = 0; axis < 3; axis += 1) {
    if (axis === index) continue;
    const side = dot(box.axes[axis], toward) < 0 ? -1 : 1;
    center = add(center, scale(box.axes[axis], side * box.half[axis]));
  }
  return { center, direction: box.axes[index], half: box.half[index] };
}

/** The closest points of two segments with unit directions. */
function closestOnSegments(first: Segment, second: Segment): [Vec3, Vec3] {
  const offset = sub(first.center, second.center);
  const cosine = dot(first.direction, second.direction);
  const alongFirst = dot(first.direction, offset);
  const alongSecond = dot(second.direction, offset);
  const clamp = (value: number, half: number) =>
    Math.min(half, Math.max(-half, value));
  const parallel = 1 - cosine * cosine < 1e-9;
  let s = parallel
    ? 0
    : clamp((cosine * alongSecond - alongFirst) / (1 - cosine * cosine), first.half);
  const t = clamp(alongSecond + s * cosine, second.half);
  s = clamp(t * cosine - alongFirst, first.half);
  return [
    add(first.center, scale(first.direction, s)),
    add(second.center, scale(second.direction, t)),
  ];
}

/** A direction's line, the same whichever way along it, as a sortable key. */
function lineKey(direction: Vec3) {
  const flip =
    (direction.x || direction.y || direction.z) < 0 ? -1 : 1;
  return [direction.x, direction.y, direction.z]
    .map((value) => (Math.round(value * flip * 1e6) + 1e7).toString().padStart(8, "0"))
    .join(",");
}

/** A point to a tenth of a millimetre, as a key that sorts by position. */
function positionKey({ x, y, z }: Vec3) {
  return [x, y, z].map((value) => Math.round(value * 1e4)).join(",");
}

function compareKeys(left: string, right: string) {
  const a = left.split(",").map(Number);
  const b = right.split(",").map(Number);
  return a[0] - b[0] || a[1] - b[1] || a[2] - b[2];
}

/** How far any point of the box can be from the centre of mass. */
function reach(shape: KartContactShape) {
  return length(shape.center) + length(shape.halfExtents);
}

function smallest({ x, y, z }: Vec3) {
  return Math.min(x, y, z);
}

const inverses = new WeakMap<KartContactShape, number[]>();

/** A kart's inverse inertia in world axes, as a row-major 3×3 matrix. */
function worldInverseInertia({ shape, body }: ContactKart): number[] {
  let inverse = inverses.get(shape);
  if (!inverse) {
    inverse = invertSymmetric(shape.inertia);
    inverses.set(shape, inverse);
  }
  const [xx, xy, xz, yy, yz, zz] = inverse;
  const local = [xx, xy, xz, xy, yy, yz, xz, yz, zz];
  // R · I⁻¹ · Rᵀ, with R's columns the kart's own axes in world space.
  const columns = [
    rotate(body.rotation, { x: 1, y: 0, z: 0 }),
    rotate(body.rotation, { x: 0, y: 1, z: 0 }),
    rotate(body.rotation, { x: 0, y: 0, z: 1 }),
  ];
  const r = [0, 1, 2].map((row) =>
    columns.map((column) => [column.x, column.y, column.z][row]),
  );
  const world: number[] = [];
  for (let row = 0; row < 3; row += 1) {
    for (let column = 0; column < 3; column += 1) {
      let sum = 0;
      for (let i = 0; i < 3; i += 1) {
        for (let j = 0; j < 3; j += 1) {
          sum += r[row][i] * local[i * 3 + j] * r[column][j];
        }
      }
      world.push(sum);
    }
  }
  return world;
}

function times(matrix: number[], { x, y, z }: Vec3): Vec3 {
  return {
    x: matrix[0] * x + matrix[1] * y + matrix[2] * z,
    y: matrix[3] * x + matrix[4] * y + matrix[5] * z,
    z: matrix[6] * x + matrix[7] * y + matrix[8] * z,
  };
}

/** [xx, xy, xz, yy, yz, zz] of a symmetric matrix's inverse. */
function invertSymmetric({ xx, yy, zz, xy, xz, yz }: KartContactShape["inertia"]) {
  const cxx = yy * zz - yz * yz;
  const cxy = xz * yz - xy * zz;
  const cxz = xy * yz - xz * yy;
  const determinant = xx * cxx + xy * cxy + xz * cxz;
  return [
    cxx / determinant,
    cxy / determinant,
    cxz / determinant,
    (xx * zz - xz * xz) / determinant,
    (xy * xz - xx * yz) / determinant,
    (xx * yy - xy * xy) / determinant,
  ];
}

/** A point moving with a kart from one pose to another. */
function carried(point: Vec3, from: KartPose, to: KartPose): Vec3 {
  return add(
    to.position,
    rotate(to.rotation, rotate(conjugate(from.rotation), sub(point, from.position))),
  );
}

function between(from: KartPose, to: KartPose, at: number): KartPose {
  return {
    position: add(from.position, scale(sub(to.position, from.position), at)),
    rotation: nlerp(from.rotation, to.rotation, at),
  };
}

/** The angle between two rotations (rad). */
function turned(from: RaceQuaternion, to: RaceQuaternion) {
  const cosine = Math.abs(
    from.w * to.w + from.x * to.x + from.y * to.y + from.z * to.z,
  );
  return 2 * Math.acos(Math.min(1, cosine));
}

/** A rotation turned by a world-axes spin for `seconds`. */
function turnBy(rotation: RaceQuaternion, spin: Vec3, seconds: number) {
  const rate = length(spin);
  if (rate * seconds < 1e-9) return { ...rotation };
  const half = (rate * seconds) / 2;
  const sine = Math.sin(half) / rate;
  return normalize(
    multiply(
      { w: Math.cos(half), x: spin.x * sine, y: spin.y * sine, z: spin.z * sine },
      rotation,
    ),
  );
}

/** As PlayCanvas sets Euler angles in degrees: X first, then Y, then Z. */
function eulerRotation({ x, y, z }: Vec3): RaceQuaternion {
  const half = Math.PI / 360;
  const about = (angle: number, axis: "x" | "y" | "z") => ({
    w: Math.cos(angle * half),
    x: 0,
    y: 0,
    z: 0,
    [axis]: Math.sin(angle * half),
  });
  return multiply(about(z, "z"), multiply(about(y, "y"), about(x, "x")));
}

function rotate(q: RaceQuaternion, v: Vec3): Vec3 {
  // v + 2w(q×v) + 2q×(q×v), with t = 2(q×v).
  const tx = 2 * (q.y * v.z - q.z * v.y);
  const ty = 2 * (q.z * v.x - q.x * v.z);
  const tz = 2 * (q.x * v.y - q.y * v.x);
  return {
    x: v.x + q.w * tx + (q.y * tz - q.z * ty),
    y: v.y + q.w * ty + (q.z * tx - q.x * tz),
    z: v.z + q.w * tz + (q.x * ty - q.y * tx),
  };
}

function multiply(a: RaceQuaternion, b: RaceQuaternion): RaceQuaternion {
  return {
    w: a.w * b.w - a.x * b.x - a.y * b.y - a.z * b.z,
    x: a.w * b.x + a.x * b.w + a.y * b.z - a.z * b.y,
    y: a.w * b.y - a.x * b.z + a.y * b.w + a.z * b.x,
    z: a.w * b.z + a.x * b.y - a.y * b.x + a.z * b.w,
  };
}

function conjugate({ w, x, y, z }: RaceQuaternion): RaceQuaternion {
  return { w, x: -x, y: -y, z: -z };
}

function normalize(q: RaceQuaternion): RaceQuaternion {
  const size = Math.hypot(q.w, q.x, q.y, q.z) || 1;
  return { w: q.w / size, x: q.x / size, y: q.y / size, z: q.z / size };
}

/** Normalized blend along the shorter arc. */
function nlerp(a: RaceQuaternion, b: RaceQuaternion, t: number): RaceQuaternion {
  const sign = a.w * b.w + a.x * b.x + a.y * b.y + a.z * b.z < 0 ? -1 : 1;
  return normalize({
    w: a.w + (sign * b.w - a.w) * t,
    x: a.x + (sign * b.x - a.x) * t,
    y: a.y + (sign * b.y - a.y) * t,
    z: a.z + (sign * b.z - a.z) * t,
  });
}

function add(a: Vec3, b: Vec3): Vec3 {
  return { x: a.x + b.x, y: a.y + b.y, z: a.z + b.z };
}

function sub(a: Vec3, b: Vec3): Vec3 {
  return { x: a.x - b.x, y: a.y - b.y, z: a.z - b.z };
}

function scale(v: Vec3, by: number): Vec3 {
  return { x: v.x * by, y: v.y * by, z: v.z * by };
}

function dot(a: Vec3, b: Vec3) {
  return a.x * b.x + a.y * b.y + a.z * b.z;
}

function cross(a: Vec3, b: Vec3): Vec3 {
  return {
    x: a.y * b.z - a.z * b.y,
    y: a.z * b.x - a.x * b.z,
    z: a.x * b.y - a.y * b.x,
  };
}

function length(v: Vec3) {
  return Math.hypot(v.x, v.y, v.z);
}

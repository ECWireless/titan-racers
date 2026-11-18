import type {
  KartAssemblyComponentInstance,
  KartAssemblyDocument,
} from "./kart-assembly-document";
import { getApprovedKartComponent } from "./kart-component-registry";
import {
  addVector,
  buildComponentMassElements,
  buildPrimitiveMassElement,
  scaleVector,
  subtractVector,
  type KartBounds,
  type KartVector,
} from "./kart-construction-geometry";
import {
  getConvexShapeBounds,
  measureConvexPair,
  type KartConvexMeasurement,
  type KartConvexShape,
} from "./kart-convex-distance";
import type { ResolvedKartSnapshot } from "./kart-derivation";
import {
  findWheelSuspension,
  getDriveshaftEnds,
  getHornAngle,
  getHornBall,
  getKnuckleBall,
  planKartLinkagePoses,
} from "./kart-linkage-poses";
import {
  BALL_CUP_HALF_HEIGHT,
  BALL_CUP_RADIUS,
  DOGBONE_BALL_RADIUS,
  DOGBONE_PIN_RADIUS,
  DOGBONE_SHAFT_RADIUS,
  getTieRodNeckEnd,
  TIE_ROD_FLATS_LENGTH,
  TIE_ROD_NECK_RADIUS,
  TURNBUCKLE_RADIUS,
} from "./kart-linkage-visual-geometry";
import { WHEEL_WEB_INSET } from "./kart-part-visual-geometry";
import { getAckermannWheelSteerAngle } from "./kart-steering";
import type { DeepReadonly } from "./immutable-registry";

/**
 * Overlap allowed where parts only touch, such as a part bolted flat to a
 * plate, so rounding never reads as a clash.
 */
export const KART_CLEARANCE_TOUCH_TOLERANCE = 0.0002;

/** A pose a linkage was measured at. */
export type KartLinkagePoseSample = {
  /** The kart's centre steering angle, in degrees. */
  centerSteerDegrees: number;
  /** The wheel's hub above its rest height, in metres. */
  wheelTravel: number;
};

/**
 * Two things that overlap by more than the touch tolerance: two instances'
 * construction, or a linkage (`<wheel>:tie-rod` or `<wheel>:driveshaft`)
 * and an instance, at about the pose where it runs deepest. A driveshaft
 * that leaves its outdrive cup clashes with its transmission, by how far
 * its ball strays from where the cup holds it.
 */
export type KartClash = KartConvexMeasurement & {
  first: string;
  pose: KartLinkagePoseSample | null;
  second: string;
};

/** A linkage's closest approach to any part over its sampled poses. */
export type KartLinkageClearance = KartConvexMeasurement & {
  instanceId: string;
  linkageId: string;
  pose: KartLinkagePoseSample;
};

export type KartClearanceReport = {
  clashes: KartClash[];
  /** Each linkage's closest approach, if any part comes within 50 mm. */
  linkages: KartLinkageClearance[];
};

type Cylinder = Extract<KartConvexShape, { kind: "cylinder" }>;

type Solid = {
  bounds: KartBounds;
  instanceId: string;
  /** A wheel against its own coilover, which may sit in the rim's mouth. */
  mouth: { shape: KartConvexShape; suspensionId: string } | null;
  shape: KartConvexShape;
};

/** The gap between two bounds, 0 where they meet. */
function boundsGap(left: KartBounds, right: KartBounds) {
  return Math.hypot(
    ...(["x", "y", "z"] as const).map((axis) =>
      Math.max(
        left.minimum[axis] - right.maximum[axis],
        right.minimum[axis] - left.maximum[axis],
        0,
      ),
    ),
  );
}

/**
 * Every instance's construction shapes, as derivation places them, except
 * two whose mass cylinders only stand in for them: a mounted suspension is
 * its coilover body at rest, and a wheel is its whole tire and rim, but
 * against its own coilover stops at the web, as the rim's mouth is open.
 */
function buildSolids(document: KartAssemblyDocument): Solid[] {
  const solid = (
    instanceId: string,
    shape: KartConvexShape,
    mouth: Solid["mouth"] = null,
  ): Solid => ({
    bounds: getConvexShapeBounds(shape),
    instanceId,
    mouth,
    shape,
  });
  return [
    ...document.primitiveInstances.map((primitive) =>
      solid(primitive.id, buildPrimitiveMassElement(primitive).solid),
    ),
    ...document.componentInstances.flatMap((instance) => {
      const definition = getApprovedKartComponent(instance.definition);
      if (!definition) return [];
      const coilover = getCoiloverShape(instance, 0);
      if (coilover) return [solid(instance.id, coilover)];
      const elements = buildComponentMassElements(instance, definition);
      const suspension =
        definition.category === "wheel-tire"
          ? findWheelSuspension(document, instance.id)
          : undefined;
      const wheel = elements[0].solid;
      if (suspension && wheel.kind === "cylinder") {
        return [
          solid(instance.id, wheel, {
            shape: getWheelOutboardOfWeb(instance, wheel),
            suspensionId: suspension.id,
          }),
        ];
      }
      return elements.map((element) => solid(instance.id, element.solid));
    }),
  ];
}

function getWheelOutboardOfWeb(
  instance: KartAssemblyComponentInstance,
  wheel: Cylinder,
): Cylinder {
  const width = wheel.halfHeight * 2;
  // Wheels face outboard, away from the kart's centre line.
  const outboard = instance.transform.position.x < 0 ? -1 : 1;
  return {
    ...wheel,
    center: {
      ...wheel.center,
      x: wheel.center.x + (outboard * (0.5 - WHEEL_WEB_INSET) * width) / 2,
    },
    halfHeight: ((0.5 + WHEEL_WEB_INSET) * width) / 2,
  };
}

// The drawn coilover's body and lower perch stop this far short of each eye
// (`buildCoilover`); the eyes are the pin joints it is mounted by.
const COILOVER_EYE_CLEARANCE = { arm: 0.011, chassis: 0.01 };

/**
 * A mounted suspension's coilover body with its wheel `wheelTravel` above
 * rest: the arm eye rises by the arm's lever ratio, as the drawn coilover's
 * does.
 */
function getCoiloverShape(
  instance: KartAssemblyComponentInstance,
  wheelTravel: number,
): Cylinder | null {
  const definition = getApprovedKartComponent(instance.definition);
  const mount = instance.suspensionMount;
  const body = definition?.construction[0];
  if (
    definition?.category !== "suspension" ||
    !mount ||
    body?.shape !== "cylinder"
  ) {
    return null;
  }
  const lever = (point: KartVector) =>
    Math.hypot(
      point.x - mount.armPivot.x,
      point.y - mount.armPivot.y,
      point.z - mount.armPivot.z,
    );
  const motionRatio = lever(mount.springArmAnchor) / lever(mount.hubAnchor);
  const armEye = {
    ...mount.springArmAnchor,
    y: mount.springArmAnchor.y + wheelTravel * motionRatio,
  };
  const along = subtractVector(armEye, mount.chassisAnchor);
  const length = Math.hypot(along.x, along.y, along.z);
  const axis = scaleVector(along, 1 / length);
  const bodyLength = Math.max(
    length - COILOVER_EYE_CLEARANCE.chassis - COILOVER_EYE_CLEARANCE.arm,
    0,
  );
  return {
    axis,
    center: addVector(
      mount.chassisAnchor,
      scaleVector(axis, COILOVER_EYE_CLEARANCE.chassis + bodyLength / 2),
    ),
    halfHeight: bodyLength / 2,
    kind: "cylinder",
    radius: body.radius,
  };
}

type Rod = { end: KartVector; start: KartVector };

/** A rigid part of a rod: the hull of these points, swollen by a radius. */
type RodFeature = { points: (rod: Rod) => KartVector[]; radius: number };

const lerp = (start: KartVector, end: KartVector, t: number) =>
  addVector(start, scaleVector(subtractVector(end, start), t));
const cross = (left: KartVector, right: KartVector) => ({
  x: left.y * right.z - left.z * right.y,
  y: left.z * right.x - left.x * right.z,
  z: left.x * right.y - left.y * right.x,
});

/** Round, between fractions of the rod's length from its start. */
const along = (from: number, to: number, radius: number): RodFeature => ({
  points: ({ end, start }) =>
    from === to
      ? [lerp(start, end, from)]
      : [lerp(start, end, from), lerp(start, end, to)],
  radius,
});

// `buildTieRod`'s cup: 3.6 mm round and 4.4 mm tall about the ball stud,
// chamfered 0.6 mm, as a twelve-sided prism around it.
const CUP_SIDES = 12;
const CUP_PROFILE = [
  { height: BALL_CUP_HALF_HEIGHT, radius: BALL_CUP_RADIUS - 0.0006 },
  { height: BALL_CUP_HALF_HEIGHT - 0.0006, radius: BALL_CUP_RADIUS },
];

/**
 * A tie rod's cup about its ball at the rod's start (0) or end (1), framed
 * and stretched as `aimLinkage` draws the rod: +X along it, the studs (+Y)
 * in the upright plane through it, and +X scaled from the rest length.
 */
const cup = (at: 0 | 1, restLength: number): RodFeature => ({
  points: ({ end, start }) => {
    const center = at === 0 ? start : end;
    const offset = subtractVector(end, start);
    const length = Math.hypot(offset.x, offset.y, offset.z);
    const yaw = Math.atan2(-offset.z, offset.x);
    const pitch = Math.atan2(offset.y, Math.hypot(offset.x, offset.z));
    const direction = {
      x: Math.cos(pitch) * Math.cos(yaw),
      y: Math.sin(pitch),
      z: -Math.cos(pitch) * Math.sin(yaw),
    };
    const stud = {
      x: -Math.sin(pitch) * Math.cos(yaw),
      y: Math.cos(pitch),
      z: Math.sin(pitch) * Math.sin(yaw),
    };
    const side = cross(direction, stud);
    // Circumscribed, so the prism holds the round cup.
    const widen = 1 / Math.cos(Math.PI / CUP_SIDES);
    const stretch = length / restLength;
    return CUP_PROFILE.flatMap(({ height, radius }) =>
      [-height, height].flatMap((rise) =>
        Array.from({ length: CUP_SIDES }, (_, index) => {
          const angle = (2 * Math.PI * index) / CUP_SIDES;
          return addVector(
            addVector(center, scaleVector(stud, rise)),
            addVector(
              scaleVector(direction, Math.cos(angle) * radius * widen * stretch),
              scaleVector(side, Math.sin(angle) * radius * widen),
            ),
          );
        }),
      ),
    );
  },
  radius: 0,
});

type LinkageSample = Rod & {
  /** The wheel's own coilover, which travels with it. */
  coilover: Cylinder | null;
  /**
   * How far a driveshaft's inner ball strays from where its cup holds it
   * (0 while it is held), and the nearest point the cup would hold it at.
   */
  disengagement: { distance: number; held: KartVector } | null;
  pose: KartLinkagePoseSample;
};

// The outdrive cup (`cad/parts/_laydown_gearbox.py`): its bore's depth, and
// how far inside its mouth the ball sits at rest (the outdrive point). The
// ball's cross pin must stay in the cup's slots, and the ball must not
// bottom out in the bore.
const OUTDRIVE_BORE_DEPTH = 0.008;
const OUTDRIVE_BALL_DEPTH = 0.0038;
const OUTDRIVE_SLIDE = {
  inward: OUTDRIVE_BORE_DEPTH - DOGBONE_BALL_RADIUS - OUTDRIVE_BALL_DEPTH,
  outward: OUTDRIVE_BALL_DEPTH - DOGBONE_PIN_RADIUS,
};

type LinkageSweep = {
  /** The instances the linkage joins, which it may touch. */
  ends: Set<string>;
  features: RodFeature[];
  id: string;
  /** A driveshaft's transmission, which it must stay in. */
  outdriveId: string | null;
  /** The linkage at travel `u` and steering `v`, each from 0 to 1. */
  sample: (u: number, v: number) => LinkageSample;
  steered: boolean;
  suspensionId: string | null;
};

/**
 * Each tie rod and driveshaft as a function of its pose: wheel travel from
 * full droop (u = 0) to full bump (u = 1), and, for tie rods, steering from
 * lock to lock (v from 0 to 1), as the derived kart can reach them.
 */
function planSweeps(
  document: KartAssemblyDocument,
  snapshot: DeepReadonly<ResolvedKartSnapshot>,
): LinkageSweep[] {
  const { trackWidth, wheelStations, wheelbase } = snapshot.geometry;
  const lock = snapshot.physicalProfile.steering.maximumCenterAngle;
  const stationOf = new Map(
    wheelStations.map((station) => [station.id, station]),
  );
  const steered = wheelStations.filter(({ steered }) => steered);
  const steeringCenterX =
    steered.reduce((sum, { position }) => sum + position.x, 0) /
    Math.max(steered.length, 1);
  const instances = new Map(
    document.componentInstances.map((instance) => [instance.id, instance]),
  );
  const travelAt = (wheelId: string, u: number) => {
    const { maximumWheelTravel, restWheelCompression } =
      stationOf.get(wheelId)!.suspension;
    return u * maximumWheelTravel - restWheelCompression;
  };
  const hubAt = (wheelId: string, travel: number): KartVector => {
    const { position } = stationOf.get(wheelId)!;
    return { ...position, y: position.y + travel };
  };
  const steerAt = (wheelId: string, centerDegrees: number) =>
    (getAckermannWheelSteerAngle(
      centerDegrees,
      stationOf.get(wheelId)!.position.x - steeringCenterX,
      { centerOfMassHeight: 0, trackWidth, wheelbase },
    ) *
      Math.PI) /
    180;
  const coiloverAt = (suspensionId: string | null, travel: number) => {
    const suspension = suspensionId ? instances.get(suspensionId) : undefined;
    return suspension ? getCoiloverShape(suspension, travel) : null;
  };

  const poses = planKartLinkagePoses(document);
  const sweeps: LinkageSweep[] = [];
  for (const servo of poses.servos) {
    for (const tieRod of servo.tieRods) {
      const { restLength, wheelId } = tieRod;
      if (!stationOf.has(wheelId)) continue;
      const suspensionId = findWheelSuspension(document, wheelId)?.id ?? null;
      const neck = getTieRodNeckEnd(restLength) / restLength;
      const flats = TIE_ROD_FLATS_LENGTH / 2 / restLength;
      sweeps.push({
        ends: new Set([servo.servoId, wheelId]),
        // As `buildTieRod` draws it: the rod, its cups and their necks, and
        // the wrench flats.
        features: [
          along(0, 1, TURNBUCKLE_RADIUS),
          cup(0, restLength),
          cup(1, restLength),
          along(0, neck, TIE_ROD_NECK_RADIUS),
          along(1 - neck, 1, TIE_ROD_NECK_RADIUS),
          along(0.5 - flats, 0.5 + flats, TIE_ROD_NECK_RADIUS),
        ],
        outdriveId: null,
        id: `${wheelId}:tie-rod`,
        sample: (u, v) => {
          const centerSteerDegrees = (2 * v - 1) * lock;
          const wheelTravel = travelAt(wheelId, u);
          const hornAngle = getHornAngle(servo, (id) =>
            steerAt(id, centerSteerDegrees),
          );
          const steerAngle = steerAt(wheelId, centerSteerDegrees);
          return {
            coilover: coiloverAt(suspensionId, wheelTravel),
            end: getKnuckleBall(
              tieRod,
              hubAt(wheelId, wheelTravel),
              steerAngle,
              { x: 0, y: 0, z: 0 },
            ),
            disengagement: null,
            pose: { centerSteerDegrees, wheelTravel },
            start: getHornBall(tieRod, hornAngle, { x: 0, y: 0, z: 0 }),
          };
        },
        steered: true,
        suspensionId,
      });
    }
  }
  for (const driveshaft of poses.driveshafts) {
    const { suspensionId, wheelId } = driveshaft;
    if (!stationOf.has(wheelId)) continue;
    sweeps.push({
      ends: new Set([driveshaft.transmissionId, wheelId]),
      // As `buildDogbone` draws it: the shaft and its balls (its cross pins
      // stay inside the cups).
      features: [
        along(0, 1, DOGBONE_SHAFT_RADIUS),
        along(0, 0, DOGBONE_BALL_RADIUS),
        along(1, 1, DOGBONE_BALL_RADIUS),
      ],
      id: `${wheelId}:driveshaft`,
      outdriveId: driveshaft.transmissionId,
      sample: (u) => {
        const wheelTravel = travelAt(wheelId, u);
        const start = { x: 0, y: 0, z: 0 };
        const end = { x: 0, y: 0, z: 0 };
        getDriveshaftEnds(driveshaft, hubAt(wheelId, wheelTravel), start, end);
        // The ball slides along the outdrive's axis (out toward the wheel
        // is positive), within the cup's range.
        const { outputAxis, outputPoint } = driveshaft;
        const slide =
          (end.x - outputPoint.x) * outputAxis.x +
          (end.y - outputPoint.y) * outputAxis.y +
          (end.z - outputPoint.z) * outputAxis.z;
        const held = addVector(
          outputPoint,
          scaleVector(
            outputAxis,
            Math.min(Math.max(slide, -OUTDRIVE_SLIDE.inward), OUTDRIVE_SLIDE.outward),
          ),
        );
        return {
          coilover: coiloverAt(suspensionId, wheelTravel),
          disengagement: {
            // Also off the axis, where the bone cannot reach it.
            distance: Math.hypot(
              end.x - held.x,
              end.y - held.y,
              end.z - held.z,
            ),
            held,
          },
          end,
          pose: { centerSteerDegrees: 0, wheelTravel },
          start,
        };
      },
      steered: false,
      suspensionId,
    });
  }
  return sweeps;
}

/** Each pose axis is sampled this many times to start with. */
const SAMPLES = 7;
/** Halvings of a pose step that straddles a clash before it is reported. */
const MAXIMUM_REFINEMENTS = 4;
/** Linkages report their closest approach to parts within this range. */
const NEAREST_RANGE = 0.05;

/**
 * Measures a kart for clashes: any two instances whose construction
 * overlaps, and any tie rod or driveshaft that runs into a part anywhere in
 * its travel and steering, or a driveshaft that leaves its outdrive cup.
 * Between sampled poses, each step is measured as the hull of the rod's
 * positions at its corners, swollen by how far it strays between them
 * (`STRAYING_MARGIN`), and halved until it clears or the clash is reported.
 * Each pair reports once, at about its deepest.
 */
export function checkKartClearance(
  document: KartAssemblyDocument,
  snapshot: DeepReadonly<ResolvedKartSnapshot>,
): KartClearanceReport {
  const solids = buildSolids(document);
  const deepest = new Map<string, KartClash>();
  const record = (clash: KartClash) => {
    const key = `${clash.first}|${clash.second}`;
    const current = deepest.get(key);
    if (!current || clash.distance < current.distance) deepest.set(key, clash);
  };

  for (let i = 0; i < solids.length; i += 1) {
    for (let j = i + 1; j < solids.length; j += 1) {
      const [a, b] = [solids[i], solids[j]];
      if (a.instanceId === b.instanceId || boundsGap(a.bounds, b.bounds) > 0) {
        continue;
      }
      const measurement = measureConvexPair(
        a.mouth?.suspensionId === b.instanceId ? a.mouth.shape : a.shape,
        b.mouth?.suspensionId === a.instanceId ? b.mouth.shape : b.shape,
      );
      if (measurement.distance < -KART_CLEARANCE_TOUCH_TOLERANCE) {
        const swap = b.instanceId < a.instanceId;
        record({
          distance: measurement.distance,
          first: swap ? b.instanceId : a.instanceId,
          pointA: swap ? measurement.pointB : measurement.pointA,
          pointB: swap ? measurement.pointA : measurement.pointB,
          pose: null,
          second: swap ? a.instanceId : b.instanceId,
        });
      }
    }
  }

  const linkages: KartLinkageClearance[] = [];
  for (const sweep of planSweeps(document, snapshot)) {
    const result = sweepLinkage(sweep, solids, record);
    if (result) linkages.push(result);
  }

  return {
    clashes: [...deepest.values()].sort(
      (left, right) => left.distance - right.distance,
    ),
    linkages,
  };
}

/** A point's straying from where its step's corners would put it by blending. */
function straying(
  corners: KartVector[][],
  between: { point: KartVector[]; weights: number[] }[],
) {
  let worst = 0;
  for (const { point, weights } of between) {
    point.forEach((actual, index) => {
      const blended = corners.reduce(
        (sum, corner, c) => addVector(sum, scaleVector(corner[index], weights[c])),
        { x: 0, y: 0, z: 0 },
      );
      worst = Math.max(
        worst,
        Math.hypot(actual.x - blended.x, actual.y - blended.y, actual.z - blended.z),
      );
    });
  }
  return worst;
}

/**
 * Over a step, everything a feature reaches stays within the hull of its
 * corner positions (where blending them puts it), swollen by how far it
 * strays from that blend. The straying is measured at the step's centre and
 * edge midpoints, and swollen by this margin. This is an approximation, not
 * a proof: smooth arcs and slides stray most midway, but a kink inside a step
 * (the horn reaching its travel) can stray more, by up to a third on the
 * official karts' coarse steps, which this margin covers.
 */
const STRAYING_MARGIN = 2;

function sweepLinkage(
  sweep: LinkageSweep,
  solids: Solid[],
  record: (clash: KartClash) => void,
): KartLinkageClearance | null {
  const others = solids.filter(({ instanceId }) => !sweep.ends.has(instanceId));
  const clashing = new Set<string>();
  let nearest: KartLinkageClearance | null = null;
  const report = (
    measurement: KartConvexMeasurement,
    second: string,
    pose: KartLinkagePoseSample,
  ) => {
    clashing.add(second);
    record({ ...measurement, first: sweep.id, pose, second });
  };

  const poses = new Map<string, LinkageSample>();
  const poseAt = (u: number, v: number) => {
    const key = `${u}:${v}`;
    let sample = poses.get(key);
    if (!sample) {
      sample = sweep.sample(u, v);
      poses.set(key, sample);
    }
    return sample;
  };
  const target = (solid: Solid, coilovers: Cylinder[]) =>
    solid.instanceId !== sweep.suspensionId || coilovers.length === 0
      ? solid.shape
      : coilovers.length === 1
        ? coilovers[0]
        : { kind: "hull" as const, shapes: coilovers };
  /** The rod's deepest feature against `solid`, given its feature shapes. */
  const measure = (
    shapes: KartConvexShape[],
    solid: Solid,
    coilovers: Cylinder[],
    coiloverStraying: number,
  ) => {
    const against = target(solid, coilovers);
    const bounds =
      against === solid.shape ? solid.bounds : getConvexShapeBounds(against);
    let worst: KartConvexMeasurement | null = null;
    for (const shape of shapes) {
      if (boundsGap(getConvexShapeBounds(shape), bounds) > NEAREST_RANGE) continue;
      const measurement = measureConvexPair(shape, against);
      // The coilover's own straying counts against the gap too.
      if (against !== solid.shape) measurement.distance -= coiloverStraying;
      if (!worst || measurement.distance < worst.distance) worst = measurement;
    }
    return worst;
  };
  const exactShapes = (sample: LinkageSample) =>
    sweep.features.map(
      (feature): KartConvexShape => ({
        kind: "rounded",
        points: feature.points(sample),
        radius: feature.radius,
      }),
    );

  // A driveshaft's ball must stay in its outdrive cup at every pose; the
  // worst pose found is reported once the sweep is done.
  let leastHeld: LinkageSample | null = null;
  const checkReach = (sample: LinkageSample) => {
    const distance = sample.disengagement?.distance ?? 0;
    if (distance > (leastHeld?.disengagement?.distance ?? 0)) {
      leastHeld = sample;
    }
  };

  // Each corner pose is measured exactly once, for the closest approach and
  // for any clash it shows outright.
  const measured = new Set<LinkageSample>();
  const sampleAt = (u: number, v: number) => {
    const sample = poseAt(u, v);
    if (measured.has(sample)) return sample;
    measured.add(sample);
    checkReach(sample);
    const shapes = exactShapes(sample);
    const coilovers = sample.coilover ? [sample.coilover] : [];
    for (const solid of others) {
      const measurement = measure(shapes, solid, coilovers, 0);
      if (!measurement) continue;
      if (!nearest || measurement.distance < nearest.distance) {
        nearest = {
          ...measurement,
          instanceId: solid.instanceId,
          linkageId: sweep.id,
          pose: sample.pose,
        };
      }
      if (measurement.distance < -KART_CLEARANCE_TOUCH_TOLERANCE) {
        report(measurement, solid.instanceId, sample.pose);
      }
    }
    return sample;
  };

  const refine = (
    [u0, u1]: [number, number],
    [v0, v1]: [number, number],
    depth: number,
    candidates: Solid[],
  ): void => {
    const um = (u0 + u1) / 2;
    const vm = (v0 + v1) / 2;
    const corners = sweep.steered
      ? [sampleAt(u0, v0), sampleAt(u1, v0), sampleAt(u0, v1), sampleAt(u1, v1)]
      : [sampleAt(u0, v0), sampleAt(u1, v0)];
    // Between the corners: the centre, and each edge's midpoint, with the
    // weights that blend the corners there.
    const between: Array<[LinkageSample, number[]]> = sweep.steered
      ? [
          [poseAt(um, vm), [0.25, 0.25, 0.25, 0.25]],
          [poseAt(um, v0), [0.5, 0.5, 0, 0]],
          [poseAt(um, v1), [0, 0, 0.5, 0.5]],
          [poseAt(u0, vm), [0.5, 0, 0.5, 0]],
          [poseAt(u1, vm), [0, 0.5, 0, 0.5]],
        ]
      : [[poseAt(um, v0), [0.5, 0.5]]];
    for (const [sample] of between) checkReach(sample);
    const shapes = sweep.features.map((feature): KartConvexShape => {
      const cornerPoints = corners.map((corner) => feature.points(corner));
      const stray = straying(
        cornerPoints,
        between.map(([sample, weights]) => ({
          point: feature.points(sample),
          weights,
        })),
      );
      return {
        kind: "rounded",
        points: cornerPoints.flat(),
        radius: feature.radius + STRAYING_MARGIN * stray,
      };
    });
    const coilovers = corners.flatMap(({ coilover }) => (coilover ? [coilover] : []));
    const coiloverStraying =
      coilovers.length === corners.length
        ? STRAYING_MARGIN *
          straying(
            coilovers.map(axisEnds),
            between.flatMap(([sample, weights]) =>
              sample.coilover ? [{ point: axisEnds(sample.coilover), weights }] : [],
            ),
          )
        : 0;

    const straddling = candidates.filter((solid) => {
      if (clashing.has(solid.instanceId)) return false;
      const measurement = measure(shapes, solid, coilovers, coiloverStraying);
      if (
        !measurement ||
        measurement.distance >= -KART_CLEARANCE_TOUCH_TOLERANCE
      ) {
        return false;
      }
      if (depth < MAXIMUM_REFINEMENTS) return true;
      // Too fine a step to halve again: report the clash at its centre pose
      // if it shows there, or else the step's own.
      const center = sampleAt(um, sweep.steered ? vm : v0);
      if (!clashing.has(solid.instanceId)) {
        report(measurement, solid.instanceId, center.pose);
      }
      return false;
    });
    if (straddling.length === 0) return;
    const u: Array<[number, number]> = [
      [u0, um],
      [um, u1],
    ];
    const v: Array<[number, number]> = sweep.steered
      ? [
          [v0, vm],
          [vm, v1],
        ]
      : [[v0, v1]];
    for (const uStep of u) {
      for (const vStep of v) refine(uStep, vStep, depth + 1, straddling);
    }
  };

  const steps = SAMPLES - 1;
  for (let i = 0; i < steps; i += 1) {
    for (let j = 0; j < (sweep.steered ? steps : 1); j += 1) {
      refine(
        [i / steps, (i + 1) / steps],
        sweep.steered ? [j / steps, (j + 1) / steps] : [0, 0],
        0,
        others,
      );
    }
  }
  // Assigned in `checkReach`, which control flow does not follow.
  const held = leastHeld as LinkageSample | null;
  if (
    held?.disengagement &&
    sweep.outdriveId &&
    held.disengagement.distance > KART_CLEARANCE_TOUCH_TOLERANCE
  ) {
    report(
      {
        distance: -held.disengagement.distance,
        pointA: held.end,
        pointB: held.disengagement.held,
      },
      sweep.outdriveId,
      held.pose,
    );
  }
  return nearest;
}

/** A cylinder's axis ends, which carry its motion. */
function axisEnds({ axis, center, halfHeight }: Cylinder) {
  return [
    addVector(center, scaleVector(axis, halfHeight)),
    addVector(center, scaleVector(axis, -halfHeight)),
  ];
}

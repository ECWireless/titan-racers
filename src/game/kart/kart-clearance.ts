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
  type KartSolidShape,
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

/**
 * A coilover as `getCoiloverShape` builds it: the hull of its body, its
 * lower spring perch, and its arm eye (in that order).
 */
type Coilover = { kind: "hull"; shapes: [Cylinder, Cylinder, Cylinder] };

type Solid = {
  bounds: KartBounds;
  instanceId: string;
  /**
   * A coilover's top connector, posed through its travel: it stays a
   * target where the moving coilover stands in for its other solid.
   */
  connector?: true;
  /** The part this one is held in, which it is not measured against. */
  heldBy?: string;
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
function buildSolids(
  document: KartAssemblyDocument,
  snapshot: DeepReadonly<ResolvedKartSnapshot>,
): Solid[] {
  // Each suspension's wheel travel, from full droop to full bump.
  const travelRange = (suspensionId: string) => {
    const wheelId = document.structuralAttachments.find(
      ({ parent }) => parent.instanceId === suspensionId,
    )?.child.instanceId;
    const station = snapshot.geometry.wheelStations.find(
      ({ id }) => id === wheelId,
    );
    if (!station) return [0];
    const { maximumWheelTravel, restWheelCompression } = station.suspension;
    return [-restWheelCompression, 0, maximumWheelTravel - restWheelCompression];
  };
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
      if (coilover) {
        const connector = getCoiloverConnectorShape(
          instance,
          travelRange(instance.id),
        );
        // Only a pin through a part holds the eye in it.
        const tower = document.structuralAttachments.find(
          ({ child, parent }) =>
            child.instanceId === instance.id && parent.mount === "pin",
        )?.parent.instanceId;
        return [
          solid(instance.id, coilover),
          ...(connector
            ? [{ ...solid(instance.id, connector), connector: true as const, heldBy: tower }]
            : []),
        ];
      }
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

// The drawn coilover's body stops this far short of each eye
// (`buildCoilover`); its lower perch sits at the arm end's.
const COILOVER_EYE_CLEARANCE = { arm: 0.011, chassis: 0.01 };
// The drawn arm eye: a ring across the shock on the arm's pin. The spring
// and the perches reach this far beyond the body's construction radius.
const COILOVER_EYE = { halfWidth: 0.003, radius: 0.005 };
const COILOVER_PERCH_HALF_THICKNESS = 0.001;
const COILOVER_SPRING_RIM = 0.002;
// The drawn top connector: 6 mm square, from 3 to 11 mm below the top eye.
const COILOVER_CONNECTOR = {
  center: 0.007,
  half: { x: 0.003, y: 0.004, z: 0.003 },
};

/**
 * The coilover's eye pins, as the drawn coilover turns them: its +Y frame
 * axis is turned onto `axis` by the smallest turn (`setFromDirections`), and
 * the pins run along its +Z, so a shock leaning fore or aft tilts them.
 */
export function getCoiloverPin(axis: KartVector): KartVector {
  // The turn from +Y onto the axis, as a quaternion: (+Y × axis, 1 + +Y·axis).
  const w = 1 + axis.y;
  if (w < Number.EPSILON) return { x: 0, y: 0, z: 1 };
  const norm = Math.hypot(axis.z, axis.x, w);
  const [x, y, z] = [axis.z / norm, 0, -axis.x / norm];
  const q = w / norm;
  // (x, y, z, q) applied to +Z.
  return {
    x: 2 * (x * z + q * y),
    y: 2 * (y * z - q * x),
    z: 1 - 2 * (x * x + y * y),
  };
}

/**
 * The coilover's top connector, between its top eye and its body (the
 * drawn 6 mm block, `buildCoilover`), through all of its wheel's travel:
 * the hull of the block at full droop, at rest, and at full bump. It turns
 * only a few degrees about the top eye, so the hull bulges past the arc it
 * sweeps by well under a tenth of a millimetre. Its own tower holds the
 * eye on a pin through it, so it is not measured against that part.
 */
function getCoiloverConnectorShape(
  instance: KartAssemblyComponentInstance,
  travels: readonly number[],
): KartConvexShape | null {
  const shapes = getCoiloverConnectorPoses(instance, travels);
  if (shapes.length === 0) return null;
  return shapes.length === 1 ? shapes[0] : { kind: "hull", shapes };
}

/** The top connector's block at each of `travels`. */
function getCoiloverConnectorPoses(
  instance: KartAssemblyComponentInstance,
  travels: readonly number[],
): KartSolidShape[] {
  const mount = instance.suspensionMount;
  if (!mount) return [];
  const lever = (point: KartVector) =>
    Math.hypot(
      point.x - mount.armPivot.x,
      point.y - mount.armPivot.y,
      point.z - mount.armPivot.z,
    );
  const motionRatio = lever(mount.springArmAnchor) / lever(mount.hubAnchor);
  const shapes: KartSolidShape[] = [];
  for (const travel of travels) {
    const along = subtractVector(
      { ...mount.springArmAnchor, y: mount.springArmAnchor.y + travel * motionRatio },
      mount.chassisAnchor,
    );
    const length = Math.hypot(along.x, along.y, along.z);
    if (length <= 0) continue;
    const axis = scaleVector(along, 1 / length);
    const pin = getCoiloverPin(axis);
    const across = cross(axis, pin);
    shapes.push({
      center: addVector(
        mount.chassisAnchor,
        scaleVector(axis, COILOVER_CONNECTOR.center),
      ),
      half: COILOVER_CONNECTOR.half,
      kind: "box",
      rotation: [
        across.x, axis.x, pin.x,
        across.y, axis.y, pin.y,
        across.z, axis.z, pin.z,
      ],
    });
  }
  return shapes;
}

/**
 * A mounted suspension's coilover with its wheel `wheelTravel` above rest:
 * its body and spring, lower perch, and arm eye. The arm eye rises by the arm's lever
 * ratio, as the drawn coilover's does. The top eye is left out: it rides on
 * the pin through its tower.
 */
function getCoiloverShape(
  instance: KartAssemblyComponentInstance,
  wheelTravel: number,
): Coilover | null {
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
  const hinge = getCoiloverPin(axis);
  return {
    kind: "hull",
    shapes: [
      {
        axis,
        center: addVector(
          mount.chassisAnchor,
          scaleVector(axis, COILOVER_EYE_CLEARANCE.chassis + bodyLength / 2),
        ),
        halfHeight: bodyLength / 2,
        kind: "cylinder",
        radius: body.radius + COILOVER_SPRING_RIM,
      },
      {
        axis,
        center: addVector(
          armEye,
          scaleVector(axis, -COILOVER_EYE_CLEARANCE.arm),
        ),
        halfHeight: COILOVER_PERCH_HALF_THICKNESS,
        kind: "cylinder",
        radius: body.radius + COILOVER_SPRING_RIM,
      },
      {
        axis: hinge,
        center: armEye,
        halfHeight: COILOVER_EYE.halfWidth,
        kind: "cylinder",
        radius: COILOVER_EYE.radius,
      },
    ],
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
  coilover: Coilover | null;
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
 * How the derived kart poses each wheel: its hub's travel from full droop
 * (u = 0) to full bump (u = 1), its own steering angle (with Ackermann) for
 * the kart's centre angle, and its coilover at a travel.
 */
function planPosing(
  document: KartAssemblyDocument,
  snapshot: DeepReadonly<ResolvedKartSnapshot>,
) {
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
  const connectorAt = (suspensionId: string | null, travel: number) => {
    const suspension = suspensionId ? instances.get(suspensionId) : undefined;
    return suspension ? getCoiloverConnectorPoses(suspension, [travel]) : [];
  };
  return { coiloverAt, connectorAt, hubAt, lock, stationOf, steerAt, travelAt };
}

/**
 * Each tie rod and driveshaft as a function of its pose: wheel travel from
 * full droop (u = 0) to full bump (u = 1), and, for tie rods, steering from
 * lock to lock (v from 0 to 1), as the derived kart can reach them.
 */
function planSweeps(
  document: KartAssemblyDocument,
  snapshot: DeepReadonly<ResolvedKartSnapshot>,
): LinkageSweep[] {
  const { coiloverAt, hubAt, lock, stationOf, steerAt, travelAt } =
    planPosing(document, snapshot);

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
 * overlaps, any wheel that runs into a part through its travel and steering,
 * and any tie rod or driveshaft that runs into a part anywhere in its travel
 * and steering, or a driveshaft that leaves its outdrive cup.
 * Between sampled poses, each step is measured as the hull of the rod's
 * positions at its corners, swollen by how far it strays between them
 * (`STRAYING_MARGIN`), and halved until it clears or the clash is reported.
 * Each pair reports once, at about its deepest.
 */
export function checkKartClearance(
  document: KartAssemblyDocument,
  snapshot: DeepReadonly<ResolvedKartSnapshot>,
): KartClearanceReport {
  const solids = buildSolids(document, snapshot);
  const deepest = new Map<string, KartClash>();
  const record = (clash: KartClash) => {
    const key = `${clash.first}|${clash.second}`;
    const current = deepest.get(key);
    if (!current || clash.distance < current.distance) deepest.set(key, clash);
  };

  for (let i = 0; i < solids.length; i += 1) {
    for (let j = i + 1; j < solids.length; j += 1) {
      const [a, b] = [solids[i], solids[j]];
      if (
        a.instanceId === b.instanceId ||
        a.heldBy === b.instanceId ||
        b.heldBy === a.instanceId ||
        boundsGap(a.bounds, b.bounds) > 0
      ) {
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

  sweepWheels(document, snapshot, solids, record);

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

/** Wheel pose steps: travel, and steering from lock to lock. */
const WHEEL_STEPS = { steer: 8, travel: 6 };

type WheelPose = {
  coilover: Coilover | null;
  /** Its own coilover's top connector, at the same travel. */
  connector: KartSolidShape[];
  /** The whole wheel, and the part outboard of its web. */
  full: Cylinder;
  mouth: Cylinder | null;
  pose: KartLinkagePoseSample;
  steerAngle: number;
};

/**
 * Each wheel moved through its travel and, if steered, from lock to lock,
 * turning about its hub: against its own coilover at the same travel (which
 * may sit in the rim's mouth), and against every part but its own
 * suspension and the other wheels. Each step between sampled poses is
 * measured as the hull of the wheel at its corners, swollen by how far the
 * turning wheel bulges past that hull, and halved until it clears or the
 * clash is reported; a clash at a sampled pose is reported there.
 */
function sweepWheels(
  document: KartAssemblyDocument,
  snapshot: DeepReadonly<ResolvedKartSnapshot>,
  solids: Solid[],
  record: (clash: KartClash) => void,
) {
  const { coiloverAt, connectorAt, lock, stationOf, steerAt, travelAt } =
    planPosing(document, snapshot);
  for (const wheel of solids) {
    const station = stationOf.get(wheel.instanceId);
    if (!station || wheel.shape.kind !== "cylinder") continue;
    const id = wheel.instanceId;
    const full = wheel.shape;
    const mouth = wheel.mouth?.shape.kind === "cylinder" ? wheel.mouth.shape : null;
    const suspensionId = wheel.mouth?.suspensionId ?? null;
    const others = solids.filter(
      ({ instanceId }) =>
        instanceId !== suspensionId && !stationOf.has(instanceId),
    );
    // How far any point of the wheel lies from its hub, which bounds how far
    // it bulges past the chord of a turn.
    const reach =
      Math.hypot(full.radius, full.halfHeight) +
      Math.hypot(
        full.center.x - station.position.x,
        full.center.y - station.position.y,
        full.center.z - station.position.z,
      );
    const cache = new Map<string, WheelPose>();
    const poseAt = (u: number, v: number): WheelPose => {
      const key = `${u}:${v}`;
      const cached = cache.get(key);
      if (cached) return cached;
      const wheelTravel = travelAt(id, u);
      const centerSteerDegrees = station.steered ? (2 * v - 1) * lock : 0;
      const angle = station.steered ? steerAt(id, centerSteerDegrees) : 0;
      const turn = (vector: KartVector): KartVector => ({
        x: vector.x * Math.cos(angle) + vector.z * Math.sin(angle),
        y: vector.y,
        z: -vector.x * Math.sin(angle) + vector.z * Math.cos(angle),
      });
      const place = (shape: Cylinder): Cylinder => ({
        ...shape,
        axis: turn(shape.axis),
        center: addVector(
          addVector(
            station.position,
            turn(subtractVector(shape.center, station.position)),
          ),
          { x: 0, y: wheelTravel, z: 0 },
        ),
      });
      const pose: WheelPose = {
        coilover: coiloverAt(suspensionId, wheelTravel),
        connector: connectorAt(suspensionId, wheelTravel),
        full: place(full),
        mouth: mouth ? place(mouth) : null,
        pose: { centerSteerDegrees, wheelTravel },
        steerAngle: angle,
      };
      cache.set(key, pose);
      return pose;
    };

    const clashing = new Set<string>();
    const report = (
      measurement: KartConvexMeasurement,
      other: string,
      pose: KartLinkagePoseSample,
    ) => {
      clashing.add(other);
      const swap = other < id;
      record({
        distance: measurement.distance,
        first: swap ? other : id,
        pointA: swap ? measurement.pointB : measurement.pointA,
        pointB: swap ? measurement.pointA : measurement.pointB,
        pose,
        second: swap ? id : other,
      });
    };
    // The wheel's shape, and what it is measured against, for each part.
    const against = (posed: WheelPose[], other: Solid | null) => {
      if (!other) {
        // Its own coilover, top connector and all, against the rim's mouth.
        const coilovers = posed.flatMap(({ coilover, connector }) =>
          coilover ? [...coilover.shapes, ...connector] : [],
        );
        const mouths = posed.flatMap(({ mouth: shape }) => (shape ? [shape] : []));
        if (coilovers.length === 0 || mouths.length === 0) return null;
        return {
          moving: hullOf(mouths),
          target: hullOf(coilovers),
        };
      }
      return { moving: hullOf(posed.map(({ full: shape }) => shape)), target: other.shape };
    };
    const targets: Array<{ id: string; solid: Solid | null }> = [
      ...(suspensionId ? [{ id: suspensionId, solid: null }] : []),
      ...others.map((solid) => ({ id: solid.instanceId, solid })),
    ];

    const measured = new Set<WheelPose>();
    const exact = (posed: WheelPose) => {
      if (measured.has(posed)) return;
      measured.add(posed);
      // Every sampled pose is measured, so a clash reports at its deepest.
      for (const { id: other, solid } of targets) {
        const pair = against([posed], solid);
        if (!pair) continue;
        if (
          solid &&
          boundsGap(getConvexShapeBounds(pair.moving), solid.bounds) > 0
        ) {
          continue;
        }
        const measurement = measureConvexPair(pair.moving, pair.target);
        if (measurement.distance < -KART_CLEARANCE_TOUCH_TOLERANCE) {
          report(measurement, other, posed.pose);
        }
      }
    };

    const refine = (
      [u0, u1]: [number, number],
      [v0, v1]: [number, number],
      depth: number,
      candidates: typeof targets,
    ): void => {
      const corners = station.steered
        ? [poseAt(u0, v0), poseAt(u1, v0), poseAt(u0, v1), poseAt(u1, v1)]
        : [poseAt(u0, v0), poseAt(u1, v0)];
      corners.forEach(exact);
      const turned = Math.abs(corners.at(-1)!.steerAngle - corners[0].steerAngle);
      const bulge = reach * (1 - Math.cos(turned / 2));
      // Between travel samples the coilover's eye rises along a straight line,
      // and its body swings by little; its straying is measured midway.
      const middle = poseAt((u0 + u1) / 2, (v0 + v1) / 2);
      const coiloverStray =
        middle.coilover && corners.every(({ coilover }) => coilover)
          ? straying(
              corners.map(({ coilover }) => coiloverPoints(coilover!)),
              [
                {
                  point: coiloverPoints(middle.coilover),
                  weights: corners.map(() => 1 / corners.length),
                },
              ],
            )
          : 0;
      const straddling = candidates.filter(({ id: other, solid }) => {
        if (clashing.has(other)) return false;
        const pair = against(corners, solid);
        if (!pair) return false;
        if (
          solid &&
          boundsGap(getConvexShapeBounds(pair.moving), solid.bounds) >
            bulge + KART_CLEARANCE_TOUCH_TOLERANCE
        ) {
          return false;
        }
        const measurement = measureConvexPair(pair.moving, pair.target);
        measurement.distance -=
          STRAYING_MARGIN * (bulge + (solid ? 0 : coiloverStray));
        if (measurement.distance >= -KART_CLEARANCE_TOUCH_TOLERANCE) {
          return false;
        }
        if (depth < MAXIMUM_REFINEMENTS) return true;
        // Too fine a step to halve again. Against a fixed part, the hull
        // bounds every pose in the step, so its overlap is reported. A
        // wheel and its own shock move together, so their hulls may hold
        // poses that never meet: they report only what the step's centre
        // pose shows.
        exact(middle);
        if (solid && !clashing.has(other)) {
          report(measurement, other, middle.pose);
        }
        return false;
      });
      if (straddling.length === 0) return;
      const um = (u0 + u1) / 2;
      const vm = (v0 + v1) / 2;
      for (const uStep of [
        [u0, um],
        [um, u1],
      ] as Array<[number, number]>) {
        for (const vStep of (station.steered
          ? [
              [v0, vm],
              [vm, v1],
            ]
          : [[v0, v1]]) as Array<[number, number]>) {
          refine(uStep, vStep, depth + 1, straddling);
        }
      }
    };

    const steer = station.steered ? WHEEL_STEPS.steer : 1;
    for (let i = 0; i < WHEEL_STEPS.travel; i += 1) {
      for (let j = 0; j < steer; j += 1) {
        refine(
          [i / WHEEL_STEPS.travel, (i + 1) / WHEEL_STEPS.travel],
          station.steered ? [j / steer, (j + 1) / steer] : [0.5, 0.5],
          0,
          targets,
        );
      }
    }
  }
}

/** The convex hull of solid shapes, or the shape itself. */
function hullOf(shapes: KartSolidShape[]): KartConvexShape {
  return shapes.length === 1 ? shapes[0] : { kind: "hull", shapes };
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
  const target = (solid: Solid, coilovers: Coilover[]): KartConvexShape =>
    solid.instanceId !== sweep.suspensionId ||
    solid.connector ||
    coilovers.length === 0
      ? solid.shape
      : coilovers.length === 1
        ? coilovers[0]
        : {
            kind: "hull",
            shapes: coilovers.flatMap(({ shapes }): KartSolidShape[] => shapes),
          };
  /** The rod's deepest feature against `solid`, given its feature shapes. */
  const measure = (
    shapes: KartConvexShape[],
    solid: Solid,
    coilovers: Coilover[],
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
            coilovers.map(coiloverPoints),
            between.flatMap(([sample, weights]) =>
              sample.coilover
                ? [{ point: coiloverPoints(sample.coilover), weights }]
                : [],
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

/** A coilover's body axis ends and arm eye, which carry its motion. */
function coiloverPoints({ shapes: [body, , eye] }: Coilover) {
  return [
    addVector(body.center, scaleVector(body.axis, body.halfHeight)),
    addVector(body.center, scaleVector(body.axis, -body.halfHeight)),
    eye.center,
  ];
}

/**
 * A pose to view the kart in, each axis from -1 to 1: wheel travel from full
 * droop (-1) through rest (0) to full bump (1), and steering from full right
 * lock (-1) to full left lock (1).
 */
export type KartViewPose = { steer: number; travel: number };

export const KART_REST_POSE: KartViewPose = { steer: 0, travel: 0 };

export type KartWheelViewPose = {
  /** The kart's centre steering angle, in degrees (positive turns left). */
  centerSteerDegrees: number;
  /** This wheel's own steering angle, in degrees (0 if not steered). */
  steerDegrees: number;
  /** The hub above its rest height, in metres. */
  travel: number;
};

/** Each wheel's travel and steering at a view pose, as races pose them. */
export function getKartWheelViewPoses(
  document: KartAssemblyDocument,
  snapshot: DeepReadonly<ResolvedKartSnapshot>,
  pose: KartViewPose,
): Map<string, KartWheelViewPose> {
  const { lock, stationOf, steerAt } = planPosing(document, snapshot);
  const travel = Math.min(Math.max(pose.travel, -1), 1);
  const centerSteerDegrees = Math.min(Math.max(pose.steer, -1), 1) * lock;
  const poses = new Map<string, KartWheelViewPose>();
  for (const [wheelId, station] of stationOf) {
    const { maximumWheelTravel, restWheelCompression } = station.suspension;
    poses.set(wheelId, {
      centerSteerDegrees,
      steerDegrees: station.steered
        ? (steerAt(wheelId, centerSteerDegrees) * 180) / Math.PI
        : 0,
      travel:
        travel >= 0
          ? travel * (maximumWheelTravel - restWheelCompression)
          : travel * restWheelCompression,
    });
  }
  return poses;
}

/**
 * Each instance's solids at one pose, as the builder draws it: wheels
 * travel and steer, and coilovers follow their wheel, with their top
 * connector where it stands at that travel (not swept through it).
 */
function poseSolids(
  document: KartAssemblyDocument,
  snapshot: DeepReadonly<ResolvedKartSnapshot>,
  solids: Solid[],
  pose: KartViewPose,
): Solid[] {
  const { coiloverAt, connectorAt, stationOf } = planPosing(document, snapshot);
  const wheelPoses = getKartWheelViewPoses(document, snapshot, pose);
  // The wheel each suspension carries, found as the drawn rig finds it.
  const wheelOfSuspension = new Map(
    [...wheelPoses.keys()].flatMap((wheelId) => {
      const suspension = findWheelSuspension(document, wheelId);
      return suspension ? [[suspension.id, wheelId] as const] : [];
    }),
  );
  return solids.map((solid) => {
    const station = stationOf.get(solid.instanceId);
    const wheelPose = wheelPoses.get(solid.instanceId);
    if (station && wheelPose && solid.shape.kind === "cylinder") {
      const angle = (wheelPose.steerDegrees * Math.PI) / 180;
      const turn = (vector: KartVector): KartVector => ({
        x: vector.x * Math.cos(angle) + vector.z * Math.sin(angle),
        y: vector.y,
        z: -vector.x * Math.sin(angle) + vector.z * Math.cos(angle),
      });
      const place = (shape: Cylinder): Cylinder => ({
        ...shape,
        axis: turn(shape.axis),
        center: addVector(
          addVector(
            station.position,
            turn(subtractVector(shape.center, station.position)),
          ),
          { x: 0, y: wheelPose.travel, z: 0 },
        ),
      });
      const shape = place(solid.shape);
      return {
        ...solid,
        bounds: getConvexShapeBounds(shape),
        mouth:
          solid.mouth?.shape.kind === "cylinder"
            ? { ...solid.mouth, shape: place(solid.mouth.shape) }
            : solid.mouth,
        shape,
      };
    }
    const wheelId = wheelOfSuspension.get(solid.instanceId);
    const travel = wheelId ? (wheelPoses.get(wheelId)?.travel ?? 0) : 0;
    if (!solid.connector && !wheelId) return solid;
    const connector = solid.connector
      ? connectorAt(solid.instanceId, travel)
      : [];
    const shape = solid.connector
      ? connector.length > 0
        ? hullOf(connector)
        : null
      : coiloverAt(solid.instanceId, travel);
    return shape ? { ...solid, bounds: getConvexShapeBounds(shape), shape } : solid;
  });
}

const solidsByDocument = new WeakMap<KartAssemblyDocument, Solid[]>();

function restSolids(
  document: KartAssemblyDocument,
  snapshot: DeepReadonly<ResolvedKartSnapshot>,
) {
  let solids = solidsByDocument.get(document);
  if (!solids) {
    solids = buildSolids(document, snapshot);
    solidsByDocument.set(document, solids);
  }
  return solids;
}

/** Two solids measured as the clash check measures them. */
function measureSolids(a: Solid, b: Solid) {
  return measureConvexPair(
    a.mouth?.suspensionId === b.instanceId ? a.mouth.shape : a.shape,
    b.mouth?.suspensionId === a.instanceId ? b.mouth.shape : b.shape,
  );
}

/**
 * The gap between two parts at a view pose, measured on the shapes the clash
 * check uses: the nearest points of each, and the distance between them
 * (negative where they overlap). Null if either has no shape.
 */
export function measureKartPartGap(
  document: KartAssemblyDocument,
  snapshot: DeepReadonly<ResolvedKartSnapshot>,
  firstId: string,
  secondId: string,
  pose: KartViewPose = KART_REST_POSE,
): KartConvexMeasurement | null {
  if (firstId === secondId) return null;
  const solids = poseSolids(
    document,
    snapshot,
    restSolids(document, snapshot).filter(
      ({ instanceId }) => instanceId === firstId || instanceId === secondId,
    ),
    pose,
  );
  let nearest: KartConvexMeasurement | null = null;
  for (const a of solids) {
    if (a.instanceId !== firstId) continue;
    for (const b of solids) {
      if (b.instanceId !== secondId || a.heldBy === secondId || b.heldBy === firstId) {
        continue;
      }
      const measurement = measureSolids(a, b);
      if (!nearest || measurement.distance < nearest.distance) {
        nearest = measurement;
      }
    }
  }
  return nearest;
}

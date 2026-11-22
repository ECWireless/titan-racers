import type {
  KartAssemblyComponentInstance,
  KartAssemblyDocument,
} from "./kart-assembly-document";
import { getCadPoint } from "./kart-cad-meshes";
import { getApprovedKartComponent } from "./kart-component-registry";
import {
  addVector,
  rotationMatrix,
  scaleVector,
  subtractVector,
  transformVector,
  type KartMatrix3,
  type KartVector,
} from "./kart-construction-geometry";
import {
  getAxleCupStation,
  getSteeringArmBall,
} from "./kart-linkage-visual-geometry";
import { planKartLinkages } from "./kart-linkages";
import { WHEEL_WEB_INSET } from "./kart-part-visual-geometry";

/**
 * Where a kart's tie rods and driveshafts run for any wheel travel and
 * steering, in assembly axes, without an engine: the drawn kart poses its
 * linkages from these, and the clearance check sweeps them.
 */
type KartLinkagePoses = {
  driveshafts: KartDriveshaftPose[];
  servos: KartServoPose[];
};

/** A steering servo and the tie rods its horn drives. */
export type KartServoPose = {
  /** The servo's travel either way, in radians. */
  maximumHornAngle: number;
  /** The horn's pivot in the servo's frame. */
  hornPivot: KartVector;
  servoId: string;
  servoPosition: KartVector;
  servoRotation: KartMatrix3;
  tieRods: KartTieRodPose[];
};

export type KartTieRodPose = {
  /** The horn's ball stud from its pivot, in the servo's frame, at rest. */
  hornBall: KartVector;
  /** Horn radians per radian of this wheel's steering, signed. */
  hornRatio: number;
  /** The steering arm's ball stud in the wheel pivot's frame. */
  knuckleBall: KartVector;
  restLength: number;
  servo: KartServoPose;
  /** The steering arm's `buildSteeringArm` reach and length. */
  steeringArm: { length: number; reach: number };
  wheelId: string;
};

export type KartDriveshaftPose = {
  /** The axle cup rides the arm this share of the way from pivot to hub. */
  armFraction: number;
  armPivot: KartVector;
  /** Along the arm from its pivot, where the dogbone's ball sits. */
  axleCupStation: number;
  length: number;
  /** Unit, out of the transmission toward this wheel. */
  outputAxis: KartVector;
  /** Where the dogbone's ball sits in the outdrive cup at rest. */
  outputPoint: KartVector;
  suspensionId: string;
  transmissionId: string;
  wheelId: string;
};

// A steering arm's length as a share of its wheel's radius: the arm lies in
// the mouth of the rim, clear of the web and the tire.
const STEERING_ARM_REACH_CLEARANCE = 0.0003;
const STEERING_ARM_LENGTH = { maximum: 0.024, perWheelRadius: 0.4 };

const toVector = ([x, y, z]: readonly number[]): KartVector => ({ x, y, z });
const dot = (left: KartVector, right: KartVector) =>
  left.x * right.x + left.y * right.y + left.z * right.z;
const distance = (left: KartVector, right: KartVector) =>
  Math.sqrt(dot(subtractVector(left, right), subtractVector(left, right)));

/** `vector` turned `radians` about +Y. */
function yawVector(vector: KartVector, radians: number): KartVector {
  const sin = Math.sin(radians);
  const cos = Math.cos(radians);
  return {
    x: vector.x * cos + vector.z * sin,
    y: vector.y,
    z: -vector.x * sin + vector.z * cos,
  };
}

export function planKartLinkagePoses(
  document: KartAssemblyDocument,
): KartLinkagePoses {
  const plan = planKartLinkages(document);
  const servos = new Map<string, KartServoPose>();
  const steered: Array<{
    balls: KartVector[];
    servo: KartServoPose;
    wheel: KartAssemblyComponentInstance;
    wheelTire: { radius: number; width: number };
  }> = [];
  for (const { mesh, part, wheel } of plan.tieRods) {
    const definition = getApprovedKartComponent(part.definition);
    const wheelDefinition = getApprovedKartComponent(wheel.definition);
    if (
      definition?.category !== "steering" ||
      wheelDefinition?.category !== "wheel-tire"
    ) {
      continue;
    }
    let servo = servos.get(part.id);
    if (!servo) {
      servo = {
        hornPivot: toVector(getCadPoint(mesh, "horn-pivot")!),
        maximumHornAngle:
          (definition.steering.maximumTravelDegrees * Math.PI) / 180,
        servoId: part.id,
        servoPosition: part.transform.position,
        servoRotation: rotationMatrix(part.transform.rotationDegrees),
        tieRods: [],
      };
      servos.set(part.id, servo);
    }
    steered.push({
      balls: ["horn-ball-left", "horn-ball-right"].map((name) =>
        toVector(getCadPoint(mesh, name)!),
      ),
      servo,
      wheel,
      wheelTire: wheelDefinition.wheelTire,
    });
  }
  // Two rods on one servo take a stud each, paired so they run shortest
  // (and so never cross), however the servo is turned.
  for (const { balls, servo, wheel, wheelTire } of steered) {
    const pair = steered.filter((rod) => rod.servo === servo);
    let ball = nearestHornBall(servo, wheel, balls);
    if (pair.length === 2 && balls.length === 2) {
      const reach = (rod: (typeof pair)[number], index: number) =>
        distance(hornBallInAssembly(servo, balls[index]), rod.wheel.transform.position);
      const straight = reach(pair[0], 0) + reach(pair[1], 1);
      const crossed = reach(pair[0], 1) + reach(pair[1], 0);
      const first = pair[0].wheel === wheel;
      ball = balls[(straight <= crossed) === first ? 0 : 1];
    }
    servo.tieRods.push(planTieRod(servo, wheel, wheelTire, ball));
  }

  const driveshafts: KartDriveshaftPose[] = [];
  for (const { mesh, part, wheel } of plan.driveshafts) {
    const suspension = findWheelSuspension(document, wheel.id);
    if (!suspension) continue;
    const rotation = rotationMatrix(part.transform.rotationDegrees);
    const outputs = ["output-left", "output-right"].flatMap((name) => {
      const point = getCadPoint(mesh, name);
      if (!point) return [];
      return [
        {
          axis: transformVector(rotation, {
            x: Math.sign(point[0]) || 1,
            y: 0,
            z: 0,
          }),
          point: addVector(
            transformVector(rotation, toVector(point)),
            part.transform.position,
          ),
        },
      ];
    });
    const hub = wheel.transform.position;
    const output = outputs.reduce((nearest, candidate) =>
      distance(candidate.point, hub) < distance(nearest.point, hub)
        ? candidate
        : nearest,
    );
    const mount = suspension.suspensionMount!;
    const armRestLength = distance(mount.hubAnchor, mount.armPivot);
    const springLever = distance(mount.springArmAnchor, mount.armPivot);
    const axleCupStation = getAxleCupStation(armRestLength, springLever);
    const driveshaft: KartDriveshaftPose = {
      armFraction: axleCupStation / armRestLength,
      armPivot: mount.armPivot,
      axleCupStation,
      length: 0,
      outputAxis: output.axis,
      outputPoint: output.point,
      suspensionId: suspension.id,
      transmissionId: part.id,
      wheelId: wheel.id,
    };
    driveshaft.length = distance(
      addVector(
        scaleVector(subtractVector(hub, mount.armPivot), driveshaft.armFraction),
        mount.armPivot,
      ),
      output.point,
    );
    driveshafts.push(driveshaft);
  }
  return { driveshafts, servos: [...servos.values()] };
}

const hornBallInAssembly = (servo: KartServoPose, ball: KartVector) =>
  addVector(transformVector(servo.servoRotation, ball), servo.servoPosition);

/** The horn stud nearest a wheel, for a servo steering one wheel alone. */
function nearestHornBall(
  servo: KartServoPose,
  wheel: KartAssemblyComponentInstance,
  balls: KartVector[],
) {
  const hub = wheel.transform.position;
  return balls.reduce((nearest, ball) =>
    distance(hornBallInAssembly(servo, ball), hub) <
    distance(hornBallInAssembly(servo, nearest), hub)
      ? ball
      : nearest,
  );
}

/**
 * A steered wheel's steering arm, under its pivot, and its tie rod from the
 * given horn stud.
 */
function planTieRod(
  servo: KartServoPose,
  wheel: KartAssemblyComponentInstance,
  wheelTire: { radius: number; width: number },
  ball: KartVector,
): KartTieRodPose {
  const hub = wheel.transform.position;
  const hornBall = subtractVector(ball, servo.hornPivot);
  // The arm lies against the wheel's inboard web and points along the kart
  // toward the horn, so the rod runs clear of the shock.
  const horn = hornBallInAssembly(servo, servo.hornPivot);
  const inboard = horn.x < hub.x ? -1 : 1;
  const toward = horn.z < hub.z ? -1 : 1;
  const steeringArm = {
    length:
      toward *
      Math.min(
        STEERING_ARM_LENGTH.maximum,
        STEERING_ARM_LENGTH.perWheelRadius * wheelTire.radius,
      ),
    reach:
      inboard *
      (WHEEL_WEB_INSET * wheelTire.width + STEERING_ARM_REACH_CLEARANCE),
  };
  const tieRod: KartTieRodPose = {
    hornBall,
    hornRatio: 0,
    knuckleBall: toVector(
      getSteeringArmBall(steeringArm.reach, steeringArm.length),
    ),
    restLength: 0,
    servo,
    steeringArm,
    wheelId: wheel.id,
  };
  // The horn angle that keeps the rod's length for a small steering angle,
  // measured on the linkage itself so any servo placement works.
  const step = 0.01;
  const knuckleRest = getKnuckleBall(tieRod, hub, 0, { x: 0, y: 0, z: 0 });
  const hornRest = getHornBall(tieRod, 0, { x: 0, y: 0, z: 0 });
  const along = subtractVector(knuckleRest, hornRest);
  tieRod.restLength = Math.sqrt(dot(along, along));
  const unit = scaleVector(along, 1 / tieRod.restLength);
  const knuckleStep = subtractVector(
    yawVector(tieRod.knuckleBall, step),
    tieRod.knuckleBall,
  );
  const hornTravel = dot(
    subtractVector(getHornBall(tieRod, step, { x: 0, y: 0, z: 0 }), hornRest),
    unit,
  );
  tieRod.hornRatio =
    Math.abs(hornTravel) > 1e-7 ? dot(knuckleStep, unit) / hornTravel : 0;
  return tieRod;
}

/**
 * The servo's horn angle for its wheels' steering angles (radians, by wheel
 * id): the mean of each rod's ratio, within the servo's travel. Both steering
 * arms' balls swing outboard as their wheels turn, which no horn angle can
 * follow, so the rods stretch slightly to reach.
 */
export function getHornAngle(
  servo: KartServoPose,
  steerAngleOf: (wheelId: string) => number,
) {
  let sum = 0;
  for (const { hornRatio, wheelId } of servo.tieRods) {
    sum += hornRatio * steerAngleOf(wheelId);
  }
  const mean = sum / servo.tieRods.length;
  return Math.min(
    Math.max(mean, -servo.maximumHornAngle),
    servo.maximumHornAngle,
  );
}

// The pose helpers below run every frame for every kart, so they write into
// the caller's vectors (a PlayCanvas Vec3 will do) rather than allocate.

/** The horn's ball stud, in assembly axes, with the horn at `hornAngle`. */
export function getHornBall<T extends KartVector>(
  tieRod: KartTieRodPose,
  hornAngle: number,
  out: T,
): T {
  const { hornPivot, servoPosition, servoRotation: r } = tieRod.servo;
  const { x: bx, y: by, z: bz } = tieRod.hornBall;
  const sin = Math.sin(hornAngle);
  const cos = Math.cos(hornAngle);
  const x = bx * cos + bz * sin + hornPivot.x;
  const y = by + hornPivot.y;
  const z = -bx * sin + bz * cos + hornPivot.z;
  out.x = r[0] * x + r[1] * y + r[2] * z + servoPosition.x;
  out.y = r[3] * x + r[4] * y + r[5] * z + servoPosition.y;
  out.z = r[6] * x + r[7] * y + r[8] * z + servoPosition.z;
  return out;
}

/** The steering arm's ball stud, in assembly axes, for its wheel's pose. */
export function getKnuckleBall<T extends KartVector>(
  tieRod: KartTieRodPose,
  hub: KartVector,
  steerAngle: number,
  out: T,
): T {
  const { x, y, z } = tieRod.knuckleBall;
  const sin = Math.sin(steerAngle);
  const cos = Math.cos(steerAngle);
  out.x = x * cos + z * sin + hub.x;
  out.y = y + hub.y;
  out.z = -x * sin + z * cos + hub.z;
  return out;
}

/**
 * The dogbone's ends for the hub's position: `start`, the axle cup's ball,
 * and `end`, the outdrive's. The bone is rigid, so its inner ball slides
 * along the outdrive cup's axis as the hub travels; where the cup is out of
 * reach, the bone still points at it at its own length.
 */
export function getDriveshaftEnds<T extends KartVector>(
  driveshaft: KartDriveshaftPose,
  hub: KartVector,
  start: T,
  end: T,
) {
  const { armFraction, armPivot, length, outputAxis, outputPoint } =
    driveshaft;
  start.x = armPivot.x + (hub.x - armPivot.x) * armFraction;
  start.y = armPivot.y + (hub.y - armPivot.y) * armFraction;
  start.z = armPivot.z + (hub.z - armPivot.z) * armFraction;
  const ox = start.x - outputPoint.x;
  const oy = start.y - outputPoint.y;
  const oz = start.z - outputPoint.z;
  const along = ox * outputAxis.x + oy * outputAxis.y + oz * outputAxis.z;
  const reach = length * length - (ox * ox + oy * oy + oz * oz) + along * along;
  const slide = along - Math.sqrt(Math.max(reach, 0));
  end.x = outputPoint.x + outputAxis.x * slide;
  end.y = outputPoint.y + outputAxis.y * slide;
  end.z = outputPoint.z + outputAxis.z * slide;
  if (reach < 0) {
    const dx = end.x - start.x;
    const dy = end.y - start.y;
    const dz = end.z - start.z;
    const scale = length / Math.hypot(dx, dy, dz);
    end.x = start.x + dx * scale;
    end.y = start.y + dy * scale;
    end.z = start.z + dz * scale;
  }
}

/** The suspension a wheel's hub mount connects to, if it has a mount. */
export function findWheelSuspension(
  document: KartAssemblyDocument,
  wheelId: string,
) {
  return document.connections
    .filter(
      ({ from, to }) =>
        (from.instanceId === wheelId && from.portId === "hub-mount") ||
        (to.instanceId === wheelId && to.portId === "hub-mount"),
    )
    .map(({ from, to }) =>
      from.instanceId === wheelId ? to.instanceId : from.instanceId,
    )
    .map((id) =>
      document.componentInstances.find((instance) => instance.id === id),
    )
    .find(
      (instance): instance is KartAssemblyComponentInstance =>
        !!instance?.suspensionMount &&
        getApprovedKartComponent(instance.definition)?.category ===
          "suspension",
    );
}

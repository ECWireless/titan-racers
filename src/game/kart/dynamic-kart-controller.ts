import * as pc from "playcanvas";

import type {
  DrivingInput,
  KartController,
  KartControllerState,
  KartMovementTuning,
} from "../contracts";
import {
  KART_SUSPENSION_MAX_COMPRESSION_Y,
  KART_SUSPENSION_REST_TRAVEL,
  KART_SUSPENSION_TRAVEL,
  KART_WHEEL_RADIUS,
  KART_WHEEL_WIDTH,
} from "./kart-dimensions";
import { getMaximumSteerAngle } from "./kart-steering";
import {
  getBrakingYawLeverScale,
  getCombinedSlipBrakeForceScale,
  getCombinedSlipGripCoefficient,
  getCombinedSlipLateralStiffnessScale,
  getTireGripCoefficient,
  getTireSlipAngle,
} from "./kart-tire-model";
import {
  AmmoWheelSweep,
  requireAmmoDynamicsWorld,
} from "../runtime/ammo-wheel-sweep";

const SUSPENSION_SPRING_RATE = 9_500;
const SUSPENSION_DAMPER_RATE = 540;
const SUSPENSION_BUMP_START = 0.17;
const SUSPENSION_BUMP_RATE = 62_000;
const MAX_SUSPENSION_LOAD = 2_500;
const LATERAL_STIFFNESS = 560;
const LOW_SPEED_STIFFNESS = 780;
const HANDBRAKE_FORCE_MULTIPLIER = 0.45;
const REVERSE_FORCE_MULTIPLIER = 0.72;
const VELOCITY_EPSILON = 0.04;
const RESTING_ANGULAR_SETTLE_RATE = 12;
const AIRBORNE_PITCH_TARGET = 6 * pc.math.DEG_TO_RAD;
const AIRBORNE_PITCH_SPRING_RATE = 12;
const AIRBORNE_PITCH_DAMPING_RATE = 7;
const AIRBORNE_MAX_PITCH_ACCELERATION = 10;

export type DynamicWheel = {
  driven: boolean;
  localPosition: pc.Vec3;
  name: string;
  pivot: pc.Entity;
  steered: boolean;
};

type DynamicKartControllerOptions = {
  app: pc.Application;
  fallResetY: number;
  kart: pc.Entity;
  mass: number;
  onFallReset: () => void;
  pitchInertia: number;
  tuning: KartMovementTuning;
  wheels: readonly DynamicWheel[];
};

export type DynamicKartControllerState = KartControllerState & {
  airbornePitch: AirbornePitchTelemetry;
  maximumSteerAngle: number;
  supportCount: number;
  supportEntityNames: string[];
  supportedWheelNames: string[];
  wheelTelemetry: DynamicWheelTelemetry[];
};

export type AirbornePitchTelemetry = {
  active: boolean;
  angle: number;
  appliedTorque: number;
  rate: number;
  target: number;
};

export type DynamicWheelTelemetry = {
  appliedTireForce: number;
  gripCoefficient: number;
  hubLocalY: number;
  lateralSpeed: number;
  longitudinalSpeed: number;
  name: string;
  surfaceName: string | null;
  suspensionCompression: number;
  suspensionLoad: number;
  suspensionTravel: number;
  sweepFraction: number | null;
  slipAngle: number;
  supported: boolean;
  tireForceUtilization: number;
};

function clamp(value: number, min: number, max: number) {
  return Math.min(Math.max(value, min), max);
}

function approachValue(current: number, target: number, maxDelta: number) {
  if (current < target) {
    return Math.min(current + maxDelta, target);
  }

  return Math.max(current - maxDelta, target);
}

function requireRigidBody(entity: pc.Entity) {
  const rigidBody = entity.rigidbody;

  if (!rigidBody) {
    throw new Error(`Entity ${entity.name} requires a rigid-body component`);
  }

  return rigidBody;
}

export class DynamicKartController implements KartController {
  readonly state: DynamicKartControllerState = {
    airbornePitch: {
      active: false,
      angle: 0,
      appliedTorque: 0,
      rate: 0,
      target: AIRBORNE_PITCH_TARGET,
    },
    maximumSteerAngle: 0,
    speed: 0,
    steerAngle: 0,
    supportCount: 0,
    supportEntityNames: [],
    supportedWheelNames: [],
    verticalVelocity: 0,
    wheelTelemetry: [],
  };

  private tuning: KartMovementTuning;
  private readonly drivenWheelCount: number;
  private readonly wheelSweep: AmmoWheelSweep;
  private destroyed = false;

  constructor(private readonly options: DynamicKartControllerOptions) {
    this.tuning = { ...options.tuning };
    this.drivenWheelCount = options.wheels.filter(
      (wheel) => wheel.driven,
    ).length;

    if (this.drivenWheelCount === 0) {
      throw new Error("Dynamic kart requires at least one driven wheel");
    }

    this.wheelSweep = new AmmoWheelSweep(
      requireAmmoDynamicsWorld(options.app),
      KART_WHEEL_RADIUS,
      KART_WHEEL_WIDTH * 0.5,
    );
  }

  destroy() {
    if (this.destroyed) {
      return;
    }

    this.destroyed = true;
    this.wheelSweep.destroy();
  }

  reset() {
    const rigidBody = requireRigidBody(this.options.kart);

    rigidBody.linearVelocity = pc.Vec3.ZERO;
    rigidBody.angularVelocity = pc.Vec3.ZERO;
    rigidBody.activate();
    this.state.speed = 0;
    this.state.airbornePitch = {
      active: false,
      angle: 0,
      appliedTorque: 0,
      rate: 0,
      target: AIRBORNE_PITCH_TARGET,
    };
    this.state.supportCount = 0;
    this.state.supportEntityNames = [];
    this.state.supportedWheelNames = [];
    this.state.verticalVelocity = 0;
    this.state.wheelTelemetry = [];
    this.state.maximumSteerAngle = getMaximumSteerAngle(
      0,
      this.tuning.maxForwardSpeed,
    );
    this.setSteerAngle(0);
  }

  setTuning(tuning: KartMovementTuning) {
    this.tuning = { ...tuning };
  }

  update(input: DrivingInput, deltaSeconds: number) {
    if (this.destroyed) {
      throw new Error("Cannot update a destroyed dynamic kart controller");
    }

    const { kart } = this.options;
    const rigidBody = requireRigidBody(kart);
    const bodyPosition = kart.getPosition();

    if (bodyPosition.y <= this.options.fallResetY) {
      this.options.onFallReset();
      return;
    }

    const bodyForward = kart.forward.clone().normalize();
    const bodyUp = kart.up.clone().normalize();
    const suspensionDirection = bodyUp.clone().mulScalar(-1);
    const linearVelocity = rigidBody.linearVelocity.clone();
    const angularVelocity = rigidBody.angularVelocity.clone();
    const chassisForwardSpeed = linearVelocity.dot(bodyForward);
    const maximumSteerAngle = getMaximumSteerAngle(
      chassisForwardSpeed,
      this.tuning.maxForwardSpeed,
    );
    this.state.maximumSteerAngle = maximumSteerAngle;

    this.setSteerAngle(
      approachValue(
        this.state.steerAngle,
        input.steer * maximumSteerAngle,
        this.tuning.turnRate * deltaSeconds,
      ),
    );

    let supportCount = 0;
    const supportEntityNames: string[] = [];
    const supportedWheelNames: string[] = [];
    const wheelTelemetry: DynamicWheelTelemetry[] = [];
    const worldTransform = kart.getWorldTransform();
    for (const wheel of this.options.wheels) {
      const telemetry: DynamicWheelTelemetry = {
        appliedTireForce: 0,
        gripCoefficient: 0,
        hubLocalY: KART_SUSPENSION_MAX_COMPRESSION_Y - KART_SUSPENSION_TRAVEL,
        lateralSpeed: 0,
        longitudinalSpeed: 0,
        name: wheel.name,
        surfaceName: null,
        suspensionCompression: 0,
        suspensionLoad: 0,
        suspensionTravel: KART_SUSPENSION_TRAVEL,
        slipAngle: 0,
        supported: false,
        sweepFraction: null,
        tireForceUtilization: 0,
      };

      wheelTelemetry.push(telemetry);
      const maximumCompressionPosition = wheel.localPosition.clone();
      maximumCompressionPosition.y =
        wheel.localPosition.y + KART_SUSPENSION_REST_TRAVEL;
      const queryStart = worldTransform.transformPoint(
        maximumCompressionPosition,
      );
      const queryTravel = KART_SUSPENSION_TRAVEL;
      const queryEnd = queryStart
        .clone()
        .add(suspensionDirection.clone().mulScalar(queryTravel));
      const steerAngle = wheel.steered ? this.state.steerAngle : 0;
      const sweepRotation = new pc.Quat().mul2(
        kart.getRotation(),
        new pc.Quat().setFromEulerAngles(0, steerAngle, 0),
      );
      const hit = this.wheelSweep.sweep(queryStart, queryEnd, sweepRotation);

      if (!hit) {
        continue;
      }

      const suspensionTravel = clamp(
        hit.fraction * queryTravel,
        0,
        KART_SUSPENSION_TRAVEL,
      );
      const compression = Math.max(
        KART_SUSPENSION_REST_TRAVEL - suspensionTravel,
        0,
      );
      telemetry.surfaceName = hit.entity.name;
      telemetry.hubLocalY =
        KART_SUSPENSION_MAX_COMPRESSION_Y - suspensionTravel;
      telemetry.suspensionCompression = compression;
      telemetry.suspensionTravel = suspensionTravel;
      telemetry.sweepFraction = hit.fraction;

      if (compression <= 0) {
        continue;
      }

      const contactNormal = hit.normal.clone().normalize();
      const wheelCenter = new pc.Vec3().lerp(
        queryStart,
        queryEnd,
        hit.fraction,
      );
      const stableContactPoint = wheelCenter
        .clone()
        .sub(contactNormal.clone().mulScalar(KART_WHEEL_RADIUS));
      const relativePoint = stableContactPoint.sub(bodyPosition);
      const angularPointVelocity = new pc.Vec3().cross(
        angularVelocity,
        relativePoint,
      );
      const pointVelocity = linearVelocity.clone().add(angularPointVelocity);
      const separationSpeed = pointVelocity.dot(contactNormal);
      const bumpCompression = Math.max(compression - SUSPENSION_BUMP_START, 0);
      const suspensionLoad = clamp(
        compression * SUSPENSION_SPRING_RATE -
          separationSpeed * SUSPENSION_DAMPER_RATE +
          bumpCompression ** 2 * SUSPENSION_BUMP_RATE,
        0,
        MAX_SUSPENSION_LOAD,
      );

      if (suspensionLoad <= 0) {
        continue;
      }

      telemetry.supported = true;
      telemetry.suspensionLoad = suspensionLoad;
      supportCount += 1;
      supportEntityNames.push(hit.entity.name);
      supportedWheelNames.push(wheel.name);
      rigidBody.applyForce(
        contactNormal.clone().mulScalar(suspensionLoad),
        relativePoint,
      );

      const wheelForward = this.getWheelForward(
        bodyForward,
        contactNormal,
        steerAngle,
      );
      const wheelRight = new pc.Vec3()
        .cross(wheelForward, contactNormal)
        .normalize();
      const longitudinalSpeed = pointVelocity.dot(wheelForward);
      const lateralSpeed = pointVelocity.dot(wheelRight);

      telemetry.longitudinalSpeed = longitudinalSpeed;
      telemetry.lateralSpeed = lateralSpeed;
      const slipAngle = getTireSlipAngle(longitudinalSpeed, lateralSpeed);
      const brakingForwardMotion =
        input.brake > 0 && chassisForwardSpeed > VELOCITY_EPSILON;
      const handbrakingMotion =
        input.handbrake > 0 && Math.abs(chassisForwardSpeed) > VELOCITY_EPSILON;
      const brakingDemand = Math.max(
        brakingForwardMotion ? input.brake : 0,
        wheel.driven && handbrakingMotion ? input.handbrake : 0,
      );
      const gripCoefficient =
        brakingDemand > 0
          ? getCombinedSlipGripCoefficient(slipAngle, brakingDemand)
          : getTireGripCoefficient(slipAngle);
      const maximumTireForce = suspensionLoad * gripCoefficient;
      telemetry.slipAngle = slipAngle;
      telemetry.gripCoefficient = gripCoefficient;
      let longitudinalForce = 0;

      if (
        brakingForwardMotion &&
        Math.abs(longitudinalSpeed) > VELOCITY_EPSILON
      ) {
        const brakingForceScale = getCombinedSlipBrakeForceScale(
          slipAngle,
          input.brake,
        );
        longitudinalForce +=
          -Math.sign(longitudinalSpeed) *
          ((this.options.mass *
            this.tuning.brakeForce *
            input.brake *
            brakingForceScale) /
            this.options.wheels.length);
      }

      if (
        handbrakingMotion &&
        wheel.driven &&
        Math.abs(longitudinalSpeed) > VELOCITY_EPSILON
      ) {
        const brakingForceScale = getCombinedSlipBrakeForceScale(
          slipAngle,
          input.handbrake,
        );
        longitudinalForce +=
          -Math.sign(longitudinalSpeed) *
          ((this.options.mass *
            this.tuning.brakeForce *
            HANDBRAKE_FORCE_MULTIPLIER *
            input.handbrake *
            brakingForceScale) /
            this.drivenWheelCount);
      }

      if (!brakingForwardMotion && input.throttle !== 0 && wheel.driven) {
        const isReverse = input.throttle < 0;
        const speedLimit = isReverse
          ? this.tuning.maxReverseSpeed
          : this.tuning.maxForwardSpeed;
        const speedInRequestedDirection = isReverse
          ? -chassisForwardSpeed
          : chassisForwardSpeed;
        const remainingSpeedRatio = clamp(
          1 - Math.max(speedInRequestedDirection, 0) / speedLimit,
          0,
          1,
        );
        longitudinalForce +=
          (input.throttle *
            this.options.mass *
            this.tuning.acceleration *
            remainingSpeedRatio *
            (isReverse ? REVERSE_FORCE_MULTIPLIER : 1)) /
          this.drivenWheelCount;
      }

      if (input.throttle === 0 && !brakingForwardMotion && !handbrakingMotion) {
        const rollingStiffness =
          (this.options.mass * this.tuning.drag) /
          (this.options.wheels.length * this.tuning.maxForwardSpeed);
        longitudinalForce = -longitudinalSpeed * rollingStiffness;
      }

      const lateralStiffness =
        Math.abs(lateralSpeed) < 0.35 ? LOW_SPEED_STIFFNESS : LATERAL_STIFFNESS;
      const lateralForce =
        -lateralSpeed *
        lateralStiffness *
        getCombinedSlipLateralStiffnessScale(wheel.driven ? brakingDemand : 0);
      const longitudinalTireForce = wheelForward
        .clone()
        .mulScalar(longitudinalForce);
      const lateralTireForce = wheelRight.clone().mulScalar(lateralForce);
      const tireForce = longitudinalTireForce.clone().add(lateralTireForce);
      const requestedTireForce = tireForce.length();

      if (requestedTireForce > maximumTireForce) {
        const forceScale = maximumTireForce / requestedTireForce;
        longitudinalTireForce.mulScalar(forceScale);
        lateralTireForce.mulScalar(forceScale);
        tireForce.mulScalar(forceScale);
      }

      telemetry.appliedTireForce = tireForce.length();
      telemetry.tireForceUtilization =
        maximumTireForce > 0
          ? Math.min(requestedTireForce / maximumTireForce, 1)
          : 0;
      rigidBody.applyForce(longitudinalTireForce, relativePoint);
      const yawLeverBrakingDemand = Math.max(
        brakingForwardMotion ? input.brake : 0,
        handbrakingMotion ? input.handbrake : 0,
      );
      const verticalApplicationOffset = bodyUp
        .clone()
        .mulScalar(relativePoint.dot(bodyUp));
      const horizontalApplicationOffset = relativePoint
        .clone()
        .sub(verticalApplicationOffset)
        .mulScalar(getBrakingYawLeverScale(yawLeverBrakingDemand));
      const lateralApplicationPoint = verticalApplicationOffset.add(
        horizontalApplicationOffset,
      );
      rigidBody.applyForce(lateralTireForce, lateralApplicationPoint);
    }

    this.state.airbornePitch = {
      active: false,
      angle: Math.asin(clamp(bodyForward.y, -1, 1)),
      appliedTorque: 0,
      rate: 0,
      target: AIRBORNE_PITCH_TARGET,
    };

    if (supportCount === 0) {
      // The broad chassis' center of pressure and spinning wheels create a
      // pitch-stability moment in flight. Model that as a critically damped
      // local pitch spring while leaving yaw and roll from impacts untouched.
      const bodyRight = kart.right.clone().normalize();
      const pitchAngle = Math.asin(clamp(bodyForward.y, -1, 1));
      const pitchSpeed = angularVelocity.dot(bodyRight);
      const pitchAcceleration = clamp(
        (AIRBORNE_PITCH_TARGET - pitchAngle) * AIRBORNE_PITCH_SPRING_RATE -
          pitchSpeed * AIRBORNE_PITCH_DAMPING_RATE,
        -AIRBORNE_MAX_PITCH_ACCELERATION,
        AIRBORNE_MAX_PITCH_ACCELERATION,
      );
      const appliedTorque = pitchAcceleration * this.options.pitchInertia;

      rigidBody.applyTorque(bodyRight.mulScalar(appliedTorque));
      this.state.airbornePitch = {
        active: true,
        angle: pitchAngle,
        appliedTorque,
        rate: pitchSpeed,
        target: AIRBORNE_PITCH_TARGET,
      };
    }

    this.state.speed = chassisForwardSpeed;
    this.state.supportCount = supportCount;
    this.state.supportEntityNames = supportEntityNames;
    this.state.supportedWheelNames = supportedWheelNames;
    this.state.verticalVelocity = linearVelocity.y;
    this.state.wheelTelemetry = wheelTelemetry;
  }

  postUpdate(input: DrivingInput, deltaSeconds: number) {
    const rigidBody = requireRigidBody(this.options.kart);
    const linearVelocity = rigidBody.linearVelocity.clone();
    const angularVelocity = rigidBody.angularVelocity.clone();

    const isRestingWithoutInput =
      this.state.supportCount === this.options.wheels.length &&
      input.brake === 0 &&
      input.handbrake === 0 &&
      input.steer === 0 &&
      input.throttle === 0 &&
      linearVelocity.length() < 0.3 &&
      Math.abs(linearVelocity.y) < 0.2 &&
      angularVelocity.length() < 1;

    if (isRestingWithoutInput) {
      // Finite wheel sweeps can alternate between coplanar course primitives at
      // rest. Settle only that low-energy grounded regime; any input, impact,
      // vertical motion, or larger rotation releases this policy immediately.
      rigidBody.angularVelocity = angularVelocity.mulScalar(
        Math.max(1 - RESTING_ANGULAR_SETTLE_RATE * deltaSeconds, 0),
      );
    }
  }

  private getWheelForward(
    bodyForward: pc.Vec3,
    contactNormal: pc.Vec3,
    steerAngle: number,
  ) {
    const steeringRotation = new pc.Quat().setFromAxisAngle(
      contactNormal,
      steerAngle,
    );
    const steeredForward = steeringRotation.transformVector(bodyForward);
    const normalComponent = contactNormal
      .clone()
      .mulScalar(steeredForward.dot(contactNormal));

    return steeredForward.sub(normalComponent).normalize();
  }

  private setSteerAngle(steerAngle: number) {
    this.state.steerAngle = steerAngle;

    this.options.wheels.forEach((wheel) => {
      if (wheel.steered) {
        wheel.pivot.setLocalEulerAngles(0, steerAngle, 0);
      }
    });
  }
}

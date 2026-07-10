import * as pc from "playcanvas";

import type {
  DrivingInput,
  KartController,
  KartControllerState,
  KartMovementTuning,
} from "../contracts";

const MAX_STEER_ANGLE = 28;
const MIN_HIGH_SPEED_STEER_ANGLE = 14;
const STEER_RESPONSE = 150;
const SUSPENSION_QUERY_LENGTH = 0.58;
const SUSPENSION_REST_LENGTH = 0.45;
const SUSPENSION_SPRING_RATE = 13_500;
const SUSPENSION_DAMPER_RATE = 900;
const MAX_SUSPENSION_LOAD = 1_500;
const TIRE_GRIP = 1.42;
const LATERAL_STIFFNESS = 560;
const LOW_SPEED_STIFFNESS = 780;
const REVERSE_FORCE_MULTIPLIER = 0.72;
const VELOCITY_EPSILON = 0.04;

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
  tuning: KartMovementTuning;
  wheels: readonly DynamicWheel[];
};

export type DynamicKartControllerState = KartControllerState & {
  supportCount: number;
  supportEntityNames: string[];
  supportedWheelNames: string[];
  wheelTelemetry: DynamicWheelTelemetry[];
};

export type DynamicWheelTelemetry = {
  appliedTireForce: number;
  lateralSpeed: number;
  longitudinalSpeed: number;
  name: string;
  surfaceName: string | null;
  suspensionCompression: number;
  suspensionLoad: number;
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

  constructor(private readonly options: DynamicKartControllerOptions) {
    this.tuning = { ...options.tuning };
    this.drivenWheelCount = options.wheels.filter(
      (wheel) => wheel.driven,
    ).length;

    if (this.drivenWheelCount === 0) {
      throw new Error("Dynamic kart requires at least one driven wheel");
    }
  }

  reset() {
    const rigidBody = requireRigidBody(this.options.kart);

    rigidBody.linearVelocity = pc.Vec3.ZERO;
    rigidBody.angularVelocity = pc.Vec3.ZERO;
    rigidBody.activate();
    this.state.speed = 0;
    this.state.supportCount = 0;
    this.state.supportEntityNames = [];
    this.state.supportedWheelNames = [];
    this.state.verticalVelocity = 0;
    this.state.wheelTelemetry = [];
    this.setSteerAngle(0);
  }

  setTuning(tuning: KartMovementTuning) {
    this.tuning = { ...tuning };
  }

  update(input: DrivingInput, deltaSeconds: number) {
    const { app, kart } = this.options;
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
    const speedRatio = clamp(
      Math.abs(chassisForwardSpeed) / this.tuning.maxForwardSpeed,
      0,
      1,
    );
    const maximumSteerAngle =
      MAX_STEER_ANGLE -
      (MAX_STEER_ANGLE - MIN_HIGH_SPEED_STEER_ANGLE) * speedRatio;

    this.setSteerAngle(
      approachValue(
        this.state.steerAngle,
        input.steer * maximumSteerAngle,
        STEER_RESPONSE * deltaSeconds,
      ),
    );

    let supportCount = 0;
    const supportEntityNames: string[] = [];
    const supportedWheelNames: string[] = [];
    const wheelTelemetry: DynamicWheelTelemetry[] = [];
    const worldTransform = kart.getWorldTransform();
    const raycastSystem = app.systems.rigidbody;

    if (!raycastSystem) {
      throw new Error("PlayCanvas rigid-body raycast system is unavailable");
    }

    for (const wheel of this.options.wheels) {
      const telemetry: DynamicWheelTelemetry = {
        appliedTireForce: 0,
        lateralSpeed: 0,
        longitudinalSpeed: 0,
        name: wheel.name,
        surfaceName: null,
        suspensionCompression: 0,
        suspensionLoad: 0,
        supported: false,
        tireForceUtilization: 0,
      };

      wheelTelemetry.push(telemetry);
      const queryStart = worldTransform.transformPoint(
        wheel.localPosition.clone().add(new pc.Vec3(0, 0.15, 0)),
      );
      const queryEnd = queryStart
        .clone()
        .add(suspensionDirection.clone().mulScalar(SUSPENSION_QUERY_LENGTH));
      const hit = raycastSystem.raycastFirst(queryStart, queryEnd, {
        filterCallback: (entity: pc.Entity) =>
          entity !== kart && entity.tags.has("drivable-surface"),
      });

      if (!hit) {
        continue;
      }

      const hitDistance = queryStart.distance(hit.point);
      const compression = Math.max(SUSPENSION_REST_LENGTH - hitDistance, 0);

      telemetry.surfaceName = hit.entity.name;
      telemetry.suspensionCompression = compression;

      if (compression <= 0) {
        continue;
      }

      const relativePoint = hit.point.clone().sub(bodyPosition);
      const angularPointVelocity = new pc.Vec3().cross(
        angularVelocity,
        relativePoint,
      );
      const pointVelocity = linearVelocity.clone().add(angularPointVelocity);
      const contactNormal = hit.normal.clone().normalize();
      const separationSpeed = pointVelocity.dot(contactNormal);
      const suspensionLoad = clamp(
        compression * SUSPENSION_SPRING_RATE -
          separationSpeed * SUSPENSION_DAMPER_RATE,
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
        wheel.steered ? this.state.steerAngle : 0,
      );
      const wheelRight = new pc.Vec3()
        .cross(wheelForward, contactNormal)
        .normalize();
      const longitudinalSpeed = pointVelocity.dot(wheelForward);
      const lateralSpeed = pointVelocity.dot(wheelRight);

      telemetry.longitudinalSpeed = longitudinalSpeed;
      telemetry.lateralSpeed = lateralSpeed;
      const maximumTireForce = suspensionLoad * TIRE_GRIP;
      let longitudinalForce = 0;

      const brakingForwardMotion =
        input.brake > 0 && chassisForwardSpeed > VELOCITY_EPSILON;

      if (brakingForwardMotion && Math.abs(longitudinalSpeed) > VELOCITY_EPSILON) {
        longitudinalForce =
          -Math.sign(longitudinalSpeed) *
          ((this.options.mass * this.tuning.brakeForce) /
            this.options.wheels.length);
      } else if (input.throttle !== 0) {
        if (wheel.driven) {
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
          longitudinalForce =
            (input.throttle *
              this.options.mass *
              this.tuning.acceleration *
              remainingSpeedRatio *
              (isReverse ? REVERSE_FORCE_MULTIPLIER : 1)) /
            this.drivenWheelCount;
        }
      } else {
        const rollingStiffness =
          (this.options.mass * this.tuning.drag) /
          (this.options.wheels.length * this.tuning.maxForwardSpeed);
        longitudinalForce = -longitudinalSpeed * rollingStiffness;
      }

      const lateralStiffness =
        Math.abs(lateralSpeed) < 0.35
          ? LOW_SPEED_STIFFNESS
          : LATERAL_STIFFNESS;
      const lateralForce = -lateralSpeed * lateralStiffness;
      const tireForce = wheelForward
        .clone()
        .mulScalar(longitudinalForce)
        .add(wheelRight.clone().mulScalar(lateralForce));
      const requestedTireForce = tireForce.length();

      if (requestedTireForce > maximumTireForce) {
        tireForce.mulScalar(maximumTireForce / requestedTireForce);
      }

      telemetry.appliedTireForce = tireForce.length();
      telemetry.tireForceUtilization =
        maximumTireForce > 0
          ? Math.min(requestedTireForce / maximumTireForce, 1)
          : 0;
      rigidBody.applyForce(tireForce, relativePoint);
    }

    this.state.speed = chassisForwardSpeed;
    this.state.supportCount = supportCount;
    this.state.supportEntityNames = supportEntityNames;
    this.state.supportedWheelNames = supportedWheelNames;
    this.state.verticalVelocity = linearVelocity.y;
    this.state.wheelTelemetry = wheelTelemetry;
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

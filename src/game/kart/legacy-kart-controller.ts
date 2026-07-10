import * as pc from "playcanvas";

import type {
  DrivingInput,
  KartController,
  KartControllerState,
  KartMovementTuning,
} from "../contracts";

const MAX_STEER_ANGLE = 28;
const BRAKE_TURN_MULTIPLIER = 1.18;

function clamp(value: number, min: number, max: number) {
  return Math.min(Math.max(value, min), max);
}

function approachValue(current: number, target: number, maxDelta: number) {
  if (current < target) {
    return Math.min(current + maxDelta, target);
  }

  return Math.max(current - maxDelta, target);
}

type LegacyKartControllerOptions = {
  collidesAt: (position: pc.Vec3) => boolean;
  fallResetY: number;
  isOverGround: (position: pc.Vec3) => boolean;
  kart: pc.Entity;
  onFallReset: () => void;
  rotateAroundSteeringAxle: (yawDelta: number) => void;
  tuning: KartMovementTuning;
  updateWheelSteering: (steerAngle: number) => void;
};

export class LegacyKartController implements KartController {
  readonly state: KartControllerState = {
    speed: 0,
    steerAngle: 0,
    verticalVelocity: 0,
  };

  private tuning: KartMovementTuning;

  constructor(private readonly options: LegacyKartControllerOptions) {
    this.tuning = { ...options.tuning };
  }

  reset() {
    this.state.speed = 0;
    this.state.verticalVelocity = 0;
    this.setSteerAngle(0);
  }

  setTuning(tuning: KartMovementTuning) {
    this.tuning = { ...tuning };
    this.state.speed = clamp(
      this.state.speed,
      -this.tuning.maxReverseSpeed,
      this.tuning.maxForwardSpeed,
    );
  }

  update(input: DrivingInput, deltaSeconds: number) {
    const isBraking = input.throttle < 0 && this.state.speed > 0.1;
    const targetSpeed =
      input.throttle > 0
        ? this.tuning.maxForwardSpeed
        : input.throttle < 0
          ? -this.tuning.maxReverseSpeed
          : 0;
    const acceleration =
      isBraking || input.throttle < 0
        ? this.tuning.brakeForce
        : input.throttle > 0
          ? this.tuning.acceleration
          : this.tuning.drag;

    this.state.speed = approachValue(
      this.state.speed,
      targetSpeed,
      acceleration * deltaSeconds,
    );

    this.setSteerAngle(input.steer * MAX_STEER_ANGLE);

    if (input.steer !== 0) {
      const speedRatio = clamp(
        Math.abs(this.state.speed) / this.tuning.maxForwardSpeed,
        input.throttle !== 0 ? 0.28 : 0,
        1,
      );
      const reverseSteering = this.state.speed < -0.1 ? -1 : 1;
      const brakeTurnBoost = isBraking ? BRAKE_TURN_MULTIPLIER : 1;

      this.options.rotateAroundSteeringAxle(
        input.steer *
          reverseSteering *
          this.tuning.turnRate *
          speedRatio *
          brakeTurnBoost *
          deltaSeconds,
      );
    }

    const nextPosition = this.options.kart
      .getPosition()
      .clone()
      .add(
        this.options.kart.forward
          .clone()
          .mulScalar(this.state.speed * deltaSeconds),
      );
    this.state.verticalVelocity -= this.tuning.gravity * deltaSeconds;
    nextPosition.y += this.state.verticalVelocity * deltaSeconds;

    if (this.options.isOverGround(nextPosition) && nextPosition.y <= 0) {
      nextPosition.y = 0;
      this.state.verticalVelocity = 0;
    }

    if (nextPosition.y <= this.options.fallResetY) {
      this.options.onFallReset();
      return;
    }

    if (Math.abs(this.state.speed) > 0.01) {
      if (!this.options.collidesAt(nextPosition)) {
        this.options.kart.setPosition(nextPosition);
      } else {
        this.state.speed = 0;
      }
    } else if (this.options.kart.getPosition().y !== nextPosition.y) {
      this.options.kart.setPosition(nextPosition);
    }
  }

  private setSteerAngle(steerAngle: number) {
    this.state.steerAngle = steerAngle;
    this.options.updateWheelSteering(steerAngle);
  }
}

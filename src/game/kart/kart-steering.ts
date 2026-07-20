import {
  DEFAULT_KART_PHYSICAL_PROFILE,
  type KartSteeringProfile,
} from "./kart-physical-profile";
import {
  DEFAULT_TIRE_SURFACE_INTERACTION,
  type TireSurfaceInteractionProfile,
} from "./tire-surface-interaction";
import {
  EARTH_WORLD_ENVIRONMENT,
  type WorldEnvironment,
} from "../physics/world-environment";
import { REFERENCE_KART_CONSTRUCTION } from "./kart-reference-construction";

export type KartSteeringGeometry = {
  centerOfMassHeight: number;
  trackWidth: number;
  wheelbase: number;
};

export const DEFAULT_KART_STEERING_GEOMETRY: KartSteeringGeometry = {
  ...REFERENCE_KART_CONSTRUCTION.steeringGeometry,
};

export const STEERING_REQUEST_PHYSICAL_LIMIT_RATIO = 0.45;
export const STEERING_TRANSIENT_SLIP_AUTHORITY_RATIO = 1;
export const STEERING_CENTER_TO_FULL_RESPONSE_SECONDS = 0.225;

function finitePositive(value: number) {
  return Number.isFinite(value) && value > 0 ? value : 0;
}

export function getPhysicalLateralAccelerationLimit(
  interaction: TireSurfaceInteractionProfile,
  environment: WorldEnvironment,
  geometry: KartSteeringGeometry,
) {
  const gravity = finitePositive(environment.gravity);
  const gripLimit = finitePositive(interaction.peakGripCoefficient) * gravity;
  const centerOfMassHeight = finitePositive(geometry.centerOfMassHeight);
  const trackWidth = finitePositive(geometry.trackWidth);
  const rolloverLimit =
    centerOfMassHeight > 0 && trackWidth > 0
      ? (gravity * trackWidth) / (2 * centerOfMassHeight)
      : 0;

  return Math.min(gripLimit, rolloverLimit);
}

export function getSteeringRequestLateralAccelerationLimit(
  interaction: TireSurfaceInteractionProfile,
  environment: WorldEnvironment,
  geometry: KartSteeringGeometry,
) {
  return (
    getPhysicalLateralAccelerationLimit(interaction, environment, geometry) *
    STEERING_REQUEST_PHYSICAL_LIMIT_RATIO
  );
}

export function getMaximumSteerAngle(
  forwardSpeed: number,
  steering: KartSteeringProfile = DEFAULT_KART_PHYSICAL_PROFILE.steering,
  interaction: TireSurfaceInteractionProfile =
    DEFAULT_TIRE_SURFACE_INTERACTION,
  environment: WorldEnvironment = EARTH_WORLD_ENVIRONMENT,
  geometry: KartSteeringGeometry = DEFAULT_KART_STEERING_GEOMETRY,
) {
  const mechanicalSteeringLock = finitePositive(
    steering.maximumCenterAngle,
  );
  const speed = Number.isFinite(forwardSpeed) ? Math.abs(forwardSpeed) : 0;
  const wheelbase = finitePositive(geometry.wheelbase);
  const lateralAccelerationLimit =
    getSteeringRequestLateralAccelerationLimit(
      interaction,
      environment,
      geometry,
    );

  if (speed === 0 || wheelbase === 0 || lateralAccelerationLimit === 0) {
    return mechanicalSteeringLock;
  }

  const geometricAngle =
    Math.atan((wheelbase * lateralAccelerationLimit) / speed ** 2) *
    (180 / Math.PI);
  const gripAccelerationLimit =
    finitePositive(interaction.peakGripCoefficient) *
    finitePositive(environment.gravity);
  // Front and rear slip largely cancel in steady-state bicycle geometry, so
  // adding a complete axle slip angle double-counts cornering demand. Retain a
  // bounded transient share so initial steering still develops tire force
  // promptly without commanding the peak-grip turn the margin is meant to
  // avoid.
  const tireSlipDemand =
    gripAccelerationLimit > 0
      ? finitePositive(interaction.peakSlipAngleDegrees) *
        Math.min(lateralAccelerationLimit / gripAccelerationLimit, 1)
      : 0;
  const derivedAngle =
    geometricAngle +
    tireSlipDemand * STEERING_TRANSIENT_SLIP_AUTHORITY_RATIO;

  return Math.min(mechanicalSteeringLock, derivedAngle);
}

export function getSteeringResponseRate(maximumSteerAngle: number) {
  const boundedAngle = finitePositive(maximumSteerAngle);

  return boundedAngle / STEERING_CENTER_TO_FULL_RESPONSE_SECONDS;
}

export function getGeometricTurnRadius(
  centerSteerAngle: number,
  wheelbase: number,
) {
  if (!Number.isFinite(centerSteerAngle) || centerSteerAngle === 0) {
    return null;
  }

  const boundedWheelbase = finitePositive(wheelbase);
  if (boundedWheelbase === 0) {
    return null;
  }

  const angleRadians = Math.abs(centerSteerAngle) * (Math.PI / 180);
  const radius = boundedWheelbase / Math.tan(angleRadians);

  return Number.isFinite(radius) && radius > 0 ? radius : null;
}

export function getActualTurnRadius(forwardSpeed: number, yawRate: number) {
  if (
    !Number.isFinite(forwardSpeed) ||
    !Number.isFinite(yawRate) ||
    Math.abs(forwardSpeed) < 0.01 ||
    Math.abs(yawRate) < 0.01
  ) {
    return null;
  }

  return Math.abs(forwardSpeed / yawRate);
}

export function getAckermannWheelSteerAngle(
  centerSteerAngle: number,
  wheelLateralOffset: number,
  geometry: KartSteeringGeometry,
) {
  if (
    !Number.isFinite(centerSteerAngle) ||
    centerSteerAngle === 0 ||
    !Number.isFinite(wheelLateralOffset)
  ) {
    return 0;
  }

  const wheelbase = finitePositive(geometry.wheelbase);
  if (wheelbase === 0) {
    return 0;
  }

  const turnDirection = Math.sign(centerSteerAngle);
  const centerAngleRadians =
    Math.abs(centerSteerAngle) * (Math.PI / 180);
  const centerRadius = wheelbase / Math.tan(centerAngleRadians);
  const wheelPathRadius =
    centerRadius + turnDirection * wheelLateralOffset;

  if (!Number.isFinite(wheelPathRadius) || wheelPathRadius <= 0) {
    return 0;
  }

  return (
    turnDirection *
    Math.atan(wheelbase / wheelPathRadius) *
    (180 / Math.PI)
  );
}

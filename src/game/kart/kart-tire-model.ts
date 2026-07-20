import {
  DEFAULT_TIRE_SURFACE_INTERACTION,
  type TireSurfaceInteractionProfile,
} from "./tire-surface-interaction";

function degreesToRadians(degrees: number) {
  return degrees * (Math.PI / 180);
}

function clamp(value: number, minimum: number, maximum: number) {
  return Math.min(Math.max(value, minimum), maximum);
}

function smoothstep(value: number) {
  return value * value * (3 - 2 * value);
}

export const LOW_SPEED_LATERAL_SETTLE_SECONDS = 0.12;
// Below this speed, the slip-angle force response would reverse a wheel's
// lateral point velocity within one 120 Hz step. Blend toward the bounded
// settling response until the cornering model is numerically monotonic.
export const LOW_SPEED_TIRE_REFERENCE = 2;
export const TRAILING_AXLE_GRIP_SAFETY_RATIO = 1.15;
export const TIRE_LOAD_SENSITIVITY_EXPONENT = 0.15;

export function getLoadSensitiveGripCoefficient(
  unloadedGripCoefficient: number,
  suspensionLoad: number,
  referenceLoad: number,
) {
  if (
    !Number.isFinite(unloadedGripCoefficient) ||
    !Number.isFinite(suspensionLoad) ||
    !Number.isFinite(referenceLoad) ||
    unloadedGripCoefficient <= 0 ||
    suspensionLoad <= 0 ||
    referenceLoad <= 0
  ) {
    return 0;
  }

  return (
    unloadedGripCoefficient *
    (suspensionLoad / referenceLoad) ** -TIRE_LOAD_SENSITIVITY_EXPONENT
  );
}

export function getLoadDerivedCorneringStiffness(
  peakGripCoefficient: number,
  suspensionLoad: number,
  peakSlipAngleDegrees: number,
) {
  const peakSlipAngle = degreesToRadians(peakSlipAngleDegrees);
  if (
    !Number.isFinite(peakGripCoefficient) ||
    !Number.isFinite(suspensionLoad) ||
    !Number.isFinite(peakSlipAngle) ||
    peakGripCoefficient <= 0 ||
    suspensionLoad <= 0 ||
    peakSlipAngle <= 0
  ) {
    return 0;
  }

  return (peakGripCoefficient * suspensionLoad) / peakSlipAngle;
}

export function getTireSlipAngle(
  longitudinalSpeed: number,
  lateralSpeed: number,
) {
  return Math.atan2(
    Math.abs(lateralSpeed),
    Math.max(Math.abs(longitudinalSpeed), LOW_SPEED_TIRE_REFERENCE),
  );
}

export function getRequestedLateralTireForce(
  slipAngle: number,
  longitudinalSpeed: number,
  lateralSpeed: number,
  corneringStiffness: number,
  supportedMass: number,
) {
  if (
    !Number.isFinite(slipAngle) ||
    !Number.isFinite(longitudinalSpeed) ||
    !Number.isFinite(lateralSpeed) ||
    !Number.isFinite(corneringStiffness) ||
    !Number.isFinite(supportedMass) ||
    corneringStiffness <= 0 ||
    supportedMass <= 0
  ) {
    return 0;
  }

  const corneringForce =
    -Math.sign(lateralSpeed) *
    Math.abs(slipAngle) *
    corneringStiffness;
  const lowSpeedSettlingForce =
    (-lateralSpeed * supportedMass) / LOW_SPEED_LATERAL_SETTLE_SECONDS;
  const rollingTransition = smoothstep(
    clamp(Math.abs(longitudinalSpeed) / LOW_SPEED_TIRE_REFERENCE, 0, 1),
  );

  return (
    lowSpeedSettlingForce +
    (corneringForce - lowSpeedSettlingForce) * rollingTransition
  );
}

export function getTireGripCoefficient(
  slipAngle: number,
  interaction: TireSurfaceInteractionProfile =
    DEFAULT_TIRE_SURFACE_INTERACTION,
) {
  const peakSlipAngle = degreesToRadians(interaction.peakSlipAngleDegrees);
  const slidingSlipAngle = degreesToRadians(
    interaction.slidingSlipAngleDegrees,
  );
  const transition = clamp(
    (Math.abs(slipAngle) - peakSlipAngle) / (slidingSlipAngle - peakSlipAngle),
    0,
    1,
  );
  const smoothTransition = smoothstep(transition);

  return (
    interaction.peakGripCoefficient +
    (interaction.slidingGripCoefficient - interaction.peakGripCoefficient) *
      smoothTransition
  );
}

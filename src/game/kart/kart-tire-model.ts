const PEAK_GRIP_COEFFICIENT = 1.42;
const SLIDING_GRIP_COEFFICIENT = 0.98;
const PEAK_SLIP_ANGLE = 5 * (Math.PI / 180);
const SLIDING_SLIP_ANGLE = 18 * (Math.PI / 180);
const LOW_SPEED_REFERENCE = 0.5;
const BRAKING_SLIDE_START_ANGLE = 7 * (Math.PI / 180);
const BRAKING_SLIDE_START_DEMAND = 0.65;
const MAXIMUM_BRAKING_SLIDE_GRIP_REDUCTION = 0.16;
const MAXIMUM_BRAKING_LATERAL_STIFFNESS_REDUCTION = 0.9;
const BRAKING_ASSIST_START_ANGLE = 4 * (Math.PI / 180);
const BRAKING_ASSIST_FULL_ANGLE = 10 * (Math.PI / 180);
const MAXIMUM_BRAKING_FORCE_REDUCTION = 0.85;
const MAXIMUM_BRAKING_YAW_LEVER_REDUCTION = 0.9;

function clamp(value: number, minimum: number, maximum: number) {
  return Math.min(Math.max(value, minimum), maximum);
}

function smoothstep(value: number) {
  return value * value * (3 - 2 * value);
}

export function getTireSlipAngle(
  longitudinalSpeed: number,
  lateralSpeed: number,
) {
  return Math.atan2(
    Math.abs(lateralSpeed),
    Math.max(Math.abs(longitudinalSpeed), LOW_SPEED_REFERENCE),
  );
}

export function getTireGripCoefficient(slipAngle: number) {
  const transition = clamp(
    (Math.abs(slipAngle) - PEAK_SLIP_ANGLE) /
      (SLIDING_SLIP_ANGLE - PEAK_SLIP_ANGLE),
    0,
    1,
  );
  const smoothTransition = smoothstep(transition);

  return (
    PEAK_GRIP_COEFFICIENT +
    (SLIDING_GRIP_COEFFICIENT - PEAK_GRIP_COEFFICIENT) * smoothTransition
  );
}

export function getCombinedSlipGripCoefficient(
  slipAngle: number,
  brakingDemand: number,
) {
  const baseGripCoefficient = getTireGripCoefficient(slipAngle);
  const slideProgress = smoothstep(
    clamp(
      (Math.abs(slipAngle) - BRAKING_SLIDE_START_ANGLE) /
        (SLIDING_SLIP_ANGLE - BRAKING_SLIDE_START_ANGLE),
      0,
      1,
    ),
  );
  const brakingProgress = smoothstep(
    clamp(
      (Math.abs(brakingDemand) - BRAKING_SLIDE_START_DEMAND) /
        (1 - BRAKING_SLIDE_START_DEMAND),
      0,
      1,
    ),
  );

  return (
    baseGripCoefficient *
    (1 - MAXIMUM_BRAKING_SLIDE_GRIP_REDUCTION * slideProgress * brakingProgress)
  );
}

function getHardBrakingProgress(brakingDemand: number) {
  return smoothstep(
    clamp(
      (Math.abs(brakingDemand) - BRAKING_SLIDE_START_DEMAND) /
        (1 - BRAKING_SLIDE_START_DEMAND),
      0,
      1,
    ),
  );
}

export function getCombinedSlipLateralStiffnessScale(brakingDemand: number) {
  return (
    1 -
    MAXIMUM_BRAKING_LATERAL_STIFFNESS_REDUCTION *
      getHardBrakingProgress(brakingDemand)
  );
}

export function getCombinedSlipBrakeForceScale(
  slipAngle: number,
  brakingDemand: number,
) {
  const slideProgress = smoothstep(
    clamp(
      (Math.abs(slipAngle) - BRAKING_ASSIST_START_ANGLE) /
        (BRAKING_ASSIST_FULL_ANGLE - BRAKING_ASSIST_START_ANGLE),
      0,
      1,
    ),
  );
  const brakingProgress = smoothstep(
    clamp(
      (Math.abs(brakingDemand) - BRAKING_SLIDE_START_DEMAND) /
        (1 - BRAKING_SLIDE_START_DEMAND),
      0,
      1,
    ),
  );
  return 1 - MAXIMUM_BRAKING_FORCE_REDUCTION * slideProgress * brakingProgress;
}

export function getBrakingYawLeverScale(brakingDemand: number) {
  return (
    1 -
    MAXIMUM_BRAKING_YAW_LEVER_REDUCTION * getHardBrakingProgress(brakingDemand)
  );
}

const MAX_STEER_ANGLE = 18;
const MIN_HIGH_SPEED_STEER_ANGLE = 6;

function clamp(value: number, min: number, max: number) {
  return Math.min(Math.max(value, min), max);
}

export function getMaximumSteerAngle(
  forwardSpeed: number,
  maximumForwardSpeed: number,
) {
  const speedRatio = clamp(
    Math.abs(forwardSpeed) / maximumForwardSpeed,
    0,
    1,
  );

  return (
    MAX_STEER_ANGLE -
    (MAX_STEER_ANGLE - MIN_HIGH_SPEED_STEER_ANGLE) * speedRatio
  );
}

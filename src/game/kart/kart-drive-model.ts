import type { KartDrivetrainProfile } from "./kart-physical-profile";

function clamp(value: number, minimum: number, maximum: number) {
  return Math.min(Math.max(value, minimum), maximum);
}

export function allocateDriveForce(
  requestedForce: number,
  wheelForceLimits: readonly number[],
  drivenWheelCount: number,
) {
  if (
    !Number.isFinite(requestedForce) ||
    !Number.isFinite(drivenWheelCount) ||
    drivenWheelCount <= 0
  ) {
    return wheelForceLimits.map(() => 0);
  }

  const direction = Math.sign(requestedForce);
  const forcePerDrivenWheel = Math.abs(requestedForce) / drivenWheelCount;

  // The reference drivetrain has a fixed split. If one driven tire cannot use
  // its share, that force is lost rather than transferred to the other side.
  return wheelForceLimits.map((limit) => {
    const finiteLimit = Number.isFinite(limit) ? Math.max(limit, 0) : 0;
    return finiteLimit > 0
      ? Math.min(forcePerDrivenWheel, finiteLimit) * direction
      : 0;
  });
}

export function getRequestedDriveForce(
  throttle: number,
  forwardSpeed: number,
  drivetrain: KartDrivetrainProfile,
) {
  const normalizedThrottle = clamp(throttle, -1, 1);
  if (normalizedThrottle === 0) {
    return 0;
  }

  const isReverse = normalizedThrottle < 0;
  const speedInRequestedDirection = isReverse
    ? -forwardSpeed
    : forwardSpeed;
  const remainingSpeedRatio = clamp(
    1 - Math.max(speedInRequestedDirection, 0) / drivetrain.noLoadSpeed,
    0,
    1,
  );

  return (
    normalizedThrottle *
    drivetrain.maximumDriveForce *
    remainingSpeedRatio
  );
}

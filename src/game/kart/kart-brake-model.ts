function clamp(value: number, minimum: number, maximum: number) {
  return Math.min(Math.max(value, minimum), maximum);
}

export const BRAKE_REVERSE_TRANSITION_SPEED = 0.04;

export function getRequestedBrakingForce(
  brakeDemand: number,
  maximumBrakingForce: number,
) {
  const boundedDemand = Number.isFinite(brakeDemand)
    ? clamp(brakeDemand, 0, 1)
    : 0;
  const boundedMaximumForce = Number.isFinite(maximumBrakingForce)
    ? Math.max(maximumBrakingForce, 0)
    : 0;

  return boundedDemand * boundedMaximumForce;
}

export function allocateServiceBrakeForce(
  requestedForce: number,
  wheelLoads: readonly number[],
) {
  const boundedForce = Number.isFinite(requestedForce)
    ? Math.max(requestedForce, 0)
    : 0;
  const boundedLoads = wheelLoads.map((load) =>
    Number.isFinite(load) ? Math.max(load, 0) : 0,
  );
  const totalLoad = boundedLoads.reduce((total, load) => total + load, 0);

  if (boundedForce === 0 || totalLoad === 0) {
    return boundedLoads.map(() => 0);
  }

  // The sealed four-wheel service brake includes shared load-aware
  // proportioning. Matching force share to current normal load keeps an
  // unloaded rear wheel from receiving the same demand as a loaded front
  // wheel; the ordinary combined tire clamp remains authoritative afterward.
  return boundedLoads.map((load) => boundedForce * (load / totalLoad));
}

export function getGroundBrakingForce(
  totalBrakeTorque: number,
  wheelRadius: number,
) {
  if (
    !Number.isFinite(totalBrakeTorque) ||
    !Number.isFinite(wheelRadius) ||
    wheelRadius <= 0
  ) {
    return 0;
  }

  return Math.max(totalBrakeTorque, 0) / wheelRadius;
}

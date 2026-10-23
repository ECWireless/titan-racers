const ROLLING_RESISTANCE_TRANSITION_SPEED = 0.5;

function finiteNonNegative(value: number) {
  return Number.isFinite(value) ? Math.max(value, 0) : 0;
}

export function getAerodynamicDragForce(
  speed: number,
  aerodynamicDragArea: number,
  airDensity: number,
) {
  const boundedSpeed = finiteNonNegative(Math.abs(speed));
  const boundedDragArea = finiteNonNegative(aerodynamicDragArea);
  const boundedAirDensity = finiteNonNegative(airDensity);

  return (
    0.5 *
    boundedAirDensity *
    boundedDragArea *
    boundedSpeed ** 2
  );
}

/**
 * Rolling resistance opposes travel with up to `Crr × N`. Below the transition
 * speed it fades with speed for numerical smoothness, and the share it gives
 * up instead holds the wheel against `gravityPull` (gravity's force along the
 * wheel's travel, positive forward), as a stopped tire holds on a slope gentler
 * than its rolling resistance.
 */
export function getRollingResistanceForce(
  longitudinalSpeed: number,
  normalLoad: number,
  rollingResistanceCoefficient: number,
  gravityPull = 0,
) {
  if (!Number.isFinite(longitudinalSpeed)) {
    return 0;
  }

  const limit =
    finiteNonNegative(rollingResistanceCoefficient) *
    finiteNonNegative(normalLoad);
  const lowSpeedScale = Math.min(
    Math.abs(longitudinalSpeed) / ROLLING_RESISTANCE_TRANSITION_SPEED,
    1,
  );
  const hold = Number.isFinite(gravityPull)
    ? -gravityPull * (1 - lowSpeedScale)
    : 0;

  const force = -Math.sign(longitudinalSpeed) * limit * lowSpeedScale + hold;

  return Math.min(Math.max(force, -limit), limit);
}

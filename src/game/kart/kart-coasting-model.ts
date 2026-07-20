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

export function getRollingResistanceForce(
  longitudinalSpeed: number,
  normalLoad: number,
  rollingResistanceCoefficient: number,
) {
  if (!Number.isFinite(longitudinalSpeed) || longitudinalSpeed === 0) {
    return 0;
  }

  const boundedLoad = finiteNonNegative(normalLoad);
  const boundedCoefficient = finiteNonNegative(
    rollingResistanceCoefficient,
  );
  const lowSpeedScale = Math.min(
    Math.abs(longitudinalSpeed) / ROLLING_RESISTANCE_TRANSITION_SPEED,
    1,
  );

  return (
    -Math.sign(longitudinalSpeed) *
    boundedCoefficient *
    boundedLoad *
    lowSpeedScale
  );
}

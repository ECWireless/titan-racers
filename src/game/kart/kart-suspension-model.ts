import type { KartSuspensionProfile } from "./kart-physical-profile";

function finiteNonNegative(value: number) {
  return Number.isFinite(value) && value > 0 ? value : 0;
}

export function getLinearSpringCompression(
  supportedLoad: number,
  springRate: number,
) {
  const load = finiteNonNegative(supportedLoad);
  const rate = finiteNonNegative(springRate);

  return rate > 0 ? load / rate : 0;
}

export function getSuspensionLoad(
  compression: number,
  suspensionSpeed: number,
  suspension: KartSuspensionProfile,
) {
  const boundedCompression = finiteNonNegative(compression);
  if (boundedCompression === 0) {
    return 0;
  }

  const springForce =
    boundedCompression * finiteNonNegative(suspension.springRate);
  const damperForce =
    -finiteNonNegative(suspension.damperRate) *
    (Number.isFinite(suspensionSpeed) ? suspensionSpeed : 0);
  const bumpCompression = Math.max(
    boundedCompression - finiteNonNegative(suspension.bumpStart),
    0,
  );
  const bumpForce =
    bumpCompression ** 2 * finiteNonNegative(suspension.bumpRate);

  return Math.max(springForce + damperForce + bumpForce, 0);
}

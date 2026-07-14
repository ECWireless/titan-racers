import type { KartTuning } from "../contracts";
import { DEFAULT_KART_TUNING } from "./kart-tuning";

function clamp(value: number, min: number, max: number) {
  return Math.min(Math.max(value, min), max);
}

export function getMaximumSteerAngle(
  forwardSpeed: number,
  maximumForwardSpeed: number,
  tuning: KartTuning = DEFAULT_KART_TUNING,
) {
  const speedRatio = clamp(Math.abs(forwardSpeed) / maximumForwardSpeed, 0, 1);

  return (
    tuning.maximumSteerAngle -
    (tuning.maximumSteerAngle - tuning.minimumHighSpeedSteerAngle) * speedRatio
  );
}

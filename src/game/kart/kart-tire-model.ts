import type { KartTuning } from "../contracts";
import { DEFAULT_KART_TUNING } from "./kart-tuning";

function degreesToRadians(degrees: number) {
  return degrees * (Math.PI / 180);
}

function clamp(value: number, minimum: number, maximum: number) {
  return Math.min(Math.max(value, minimum), maximum);
}

function smoothstep(value: number) {
  return value * value * (3 - 2 * value);
}

export function getTireSlipAngle(
  longitudinalSpeed: number,
  lateralSpeed: number,
  tuning: KartTuning = DEFAULT_KART_TUNING,
) {
  return Math.atan2(
    Math.abs(lateralSpeed),
    Math.max(Math.abs(longitudinalSpeed), tuning.lowSpeedReference),
  );
}

export function getTireGripCoefficient(
  slipAngle: number,
  tuning: KartTuning = DEFAULT_KART_TUNING,
) {
  const peakSlipAngle = degreesToRadians(tuning.peakSlipAngleDegrees);
  const slidingSlipAngle = degreesToRadians(tuning.slidingSlipAngleDegrees);
  const transition = clamp(
    (Math.abs(slipAngle) - peakSlipAngle) / (slidingSlipAngle - peakSlipAngle),
    0,
    1,
  );
  const smoothTransition = smoothstep(transition);

  return (
    tuning.peakGripCoefficient +
    (tuning.slidingGripCoefficient - tuning.peakGripCoefficient) *
      smoothTransition
  );
}

export function getCombinedSlipGripCoefficient(
  slipAngle: number,
  brakingDemand: number,
  tuning: KartTuning = DEFAULT_KART_TUNING,
) {
  const baseGripCoefficient = getTireGripCoefficient(slipAngle, tuning);
  const brakingSlideStartAngle = degreesToRadians(
    tuning.brakingSlideStartAngleDegrees,
  );
  const slidingSlipAngle = degreesToRadians(tuning.slidingSlipAngleDegrees);
  const slideProgress = smoothstep(
    clamp(
      (Math.abs(slipAngle) - brakingSlideStartAngle) /
        (slidingSlipAngle - brakingSlideStartAngle),
      0,
      1,
    ),
  );
  const brakingProgress = smoothstep(
    clamp(
      (Math.abs(brakingDemand) - tuning.brakingSlideStartDemand) /
        (1 - tuning.brakingSlideStartDemand),
      0,
      1,
    ),
  );

  return (
    baseGripCoefficient *
    (1 -
      tuning.maximumBrakingSlideGripReduction * slideProgress * brakingProgress)
  );
}

function getHardBrakingProgress(brakingDemand: number, tuning: KartTuning) {
  return smoothstep(
    clamp(
      (Math.abs(brakingDemand) - tuning.brakingSlideStartDemand) /
        (1 - tuning.brakingSlideStartDemand),
      0,
      1,
    ),
  );
}

export function getCombinedSlipLateralStiffnessScale(
  brakingDemand: number,
  tuning: KartTuning = DEFAULT_KART_TUNING,
) {
  return (
    1 -
    tuning.maximumBrakingLateralStiffnessReduction *
      getHardBrakingProgress(brakingDemand, tuning)
  );
}

export function getCombinedSlipBrakeForceScale(
  slipAngle: number,
  brakingDemand: number,
  tuning: KartTuning = DEFAULT_KART_TUNING,
) {
  const brakingAssistStartAngle = degreesToRadians(
    tuning.brakingAssistStartAngleDegrees,
  );
  const brakingAssistFullAngle = degreesToRadians(
    tuning.brakingAssistFullAngleDegrees,
  );
  const slideProgress = smoothstep(
    clamp(
      (Math.abs(slipAngle) - brakingAssistStartAngle) /
        (brakingAssistFullAngle - brakingAssistStartAngle),
      0,
      1,
    ),
  );
  const brakingProgress = smoothstep(
    clamp(
      (Math.abs(brakingDemand) - tuning.brakingSlideStartDemand) /
        (1 - tuning.brakingSlideStartDemand),
      0,
      1,
    ),
  );
  return (
    1 - tuning.maximumBrakingForceReduction * slideProgress * brakingProgress
  );
}

export function getBrakingYawLeverScale(
  brakingDemand: number,
  tuning: KartTuning = DEFAULT_KART_TUNING,
) {
  return (
    1 -
    tuning.maximumBrakingYawLeverReduction *
      getHardBrakingProgress(brakingDemand, tuning)
  );
}

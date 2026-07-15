import type { KartTuning, KartTuningKey } from "../contracts";

type KartTuningBound = {
  maximum: number;
  minimum: number;
  step: number;
};

export const DEFAULT_KART_TUNING: KartTuning = {
  acceleration: 9.5,
  angularDamping: 0.08,
  airborneMaximumPitchAcceleration: 10,
  airbornePitchDampingRate: 7,
  airbornePitchSpringRate: 12,
  airbornePitchTargetDegrees: 6,
  brakeForce: 14,
  brakeReverseStopSpeed: 0.04,
  brakingAssistFullAngleDegrees: 10,
  brakingAssistStartAngleDegrees: 4,
  brakingSmokeStartDemand: 0.65,
  brakingSmokeStartTireForceUtilization: 0.4,
  brakingSmokeStopDemand: 0.52,
  brakingSmokeStopTireForceUtilization: 0.3,
  brakingSlideStartAngleDegrees: 7,
  brakingSlideStartDemand: 0.65,
  chassisFriction: 0.12,
  chassisRestitution: 0.04,
  countdownSmokeStartThrottle: 0.35,
  countdownSmokeStopThrottle: 0.2,
  drag: 4.2,
  driftSmokeStartSlipAngleDegrees: 4,
  driftSmokeStartSpeed: 6,
  driftSmokeStopSlipAngleDegrees: 3,
  driftSmokeStopSpeed: 4.5,
  gravity: 18,
  handbrakeForceMultiplier: 0.45,
  heavyDriftSmokeStartSlipAngleDegrees: 10.5,
  heavyDriftSmokeStopSlipAngleDegrees: 8.5,
  lateralStiffness: 560,
  linearDamping: 0.015,
  lowSpeedLateralStiffness: 780,
  lowSpeedLateralStiffnessThreshold: 0.35,
  lowSpeedReference: 0.5,
  manualRightingAngledTorqueBoost: 2.4,
  manualRightingLiftImpulse: 300,
  manualRightingMinimumInversionDegrees: 120,
  manualRightingTorqueImpulse: 300,
  maxForwardSpeed: 17,
  maxReverseSpeed: 17,
  maximumBrakingForceReduction: 0.85,
  maximumBrakingLateralStiffnessReduction: 0.9,
  maximumBrakingSlideGripReduction: 0.16,
  maximumBrakingYawLeverReduction: 0.9,
  maximumSteerAngle: 18,
  maximumSuspensionLoad: 2_500,
  minimumHighSpeedSteerAngle: 6,
  peakGripCoefficient: 1.42,
  peakSlipAngleDegrees: 5,
  restingSettleMaximumAngularSpeed: 1,
  restingSettleMaximumLinearSpeed: 0.3,
  restingSettleMaximumVerticalSpeed: 0.2,
  restingAngularSettleRate: 12,
  rearGripMultiplier: 1.15,
  reverseForceMultiplier: 0.72,
  slidingGripCoefficient: 0.98,
  slidingSlipAngleDegrees: 18,
  suspensionBumpRate: 62_000,
  suspensionBumpStart: 0.17,
  suspensionDamperRate: 540,
  suspensionSpringRate: 9_500,
  turnRate: 80,
};

export const KART_TUNING_BOUNDS: Record<KartTuningKey, KartTuningBound> = {
  acceleration: { maximum: 30, minimum: 0.5, step: 0.5 },
  angularDamping: { maximum: 1, minimum: 0, step: 0.005 },
  airborneMaximumPitchAcceleration: { maximum: 50, minimum: 0, step: 0.5 },
  airbornePitchDampingRate: { maximum: 50, minimum: 0, step: 0.5 },
  airbornePitchSpringRate: { maximum: 50, minimum: 0, step: 0.5 },
  airbornePitchTargetDegrees: { maximum: 30, minimum: -30, step: 0.5 },
  brakeForce: { maximum: 40, minimum: 0.5, step: 0.5 },
  brakeReverseStopSpeed: { maximum: 1, minimum: 0, step: 0.01 },
  brakingAssistFullAngleDegrees: { maximum: 45, minimum: 0.5, step: 0.5 },
  brakingAssistStartAngleDegrees: { maximum: 44.5, minimum: 0, step: 0.5 },
  brakingSmokeStartDemand: { maximum: 1, minimum: 0, step: 0.01 },
  brakingSmokeStartTireForceUtilization: {
    maximum: 1,
    minimum: 0,
    step: 0.01,
  },
  brakingSmokeStopDemand: { maximum: 1, minimum: 0, step: 0.01 },
  brakingSmokeStopTireForceUtilization: {
    maximum: 1,
    minimum: 0,
    step: 0.01,
  },
  brakingSlideStartAngleDegrees: { maximum: 44.5, minimum: 0, step: 0.5 },
  brakingSlideStartDemand: { maximum: 0.99, minimum: 0, step: 0.01 },
  chassisFriction: { maximum: 2, minimum: 0, step: 0.01 },
  chassisRestitution: { maximum: 1, minimum: 0, step: 0.01 },
  countdownSmokeStartThrottle: { maximum: 1, minimum: 0, step: 0.05 },
  countdownSmokeStopThrottle: { maximum: 1, minimum: 0, step: 0.05 },
  drag: { maximum: 15, minimum: 0, step: 0.1 },
  driftSmokeStartSlipAngleDegrees: { maximum: 45, minimum: 0, step: 0.5 },
  driftSmokeStartSpeed: { maximum: 30, minimum: 0, step: 0.5 },
  driftSmokeStopSlipAngleDegrees: { maximum: 45, minimum: 0, step: 0.5 },
  driftSmokeStopSpeed: { maximum: 30, minimum: 0, step: 0.5 },
  gravity: { maximum: 40, minimum: 0, step: 0.5 },
  handbrakeForceMultiplier: { maximum: 2, minimum: 0, step: 0.05 },
  heavyDriftSmokeStartSlipAngleDegrees: {
    maximum: 60,
    minimum: 0.5,
    step: 0.5,
  },
  heavyDriftSmokeStopSlipAngleDegrees: {
    maximum: 60,
    minimum: 0,
    step: 0.5,
  },
  lateralStiffness: { maximum: 2_000, minimum: 10, step: 10 },
  linearDamping: { maximum: 1, minimum: 0, step: 0.005 },
  lowSpeedLateralStiffness: { maximum: 2_500, minimum: 10, step: 10 },
  lowSpeedLateralStiffnessThreshold: {
    maximum: 3,
    minimum: 0.05,
    step: 0.05,
  },
  lowSpeedReference: { maximum: 3, minimum: 0.1, step: 0.1 },
  manualRightingAngledTorqueBoost: {
    maximum: 4,
    minimum: 0,
    step: 0.1,
  },
  manualRightingLiftImpulse: { maximum: 500, minimum: 0, step: 5 },
  manualRightingMinimumInversionDegrees: {
    maximum: 175,
    minimum: 91,
    step: 1,
  },
  manualRightingTorqueImpulse: { maximum: 500, minimum: 0, step: 5 },
  maxForwardSpeed: { maximum: 40, minimum: 0.5, step: 0.5 },
  maxReverseSpeed: { maximum: 25, minimum: 0.5, step: 0.5 },
  maximumBrakingForceReduction: { maximum: 0.99, minimum: 0, step: 0.01 },
  maximumBrakingLateralStiffnessReduction: {
    maximum: 0.99,
    minimum: 0,
    step: 0.01,
  },
  maximumBrakingSlideGripReduction: {
    maximum: 0.99,
    minimum: 0,
    step: 0.01,
  },
  maximumBrakingYawLeverReduction: {
    maximum: 0.99,
    minimum: 0,
    step: 0.01,
  },
  maximumSteerAngle: { maximum: 45, minimum: 1, step: 0.5 },
  maximumSuspensionLoad: { maximum: 10_000, minimum: 100, step: 100 },
  minimumHighSpeedSteerAngle: { maximum: 45, minimum: 1, step: 0.5 },
  peakGripCoefficient: { maximum: 3, minimum: 0.1, step: 0.01 },
  peakSlipAngleDegrees: { maximum: 44.5, minimum: 0.5, step: 0.5 },
  restingSettleMaximumAngularSpeed: {
    maximum: 5,
    minimum: 0,
    step: 0.1,
  },
  restingSettleMaximumLinearSpeed: {
    maximum: 3,
    minimum: 0,
    step: 0.05,
  },
  restingSettleMaximumVerticalSpeed: {
    maximum: 3,
    minimum: 0,
    step: 0.05,
  },
  restingAngularSettleRate: { maximum: 50, minimum: 0, step: 0.5 },
  rearGripMultiplier: { maximum: 2, minimum: 0.5, step: 0.05 },
  reverseForceMultiplier: { maximum: 2, minimum: 0.1, step: 0.05 },
  slidingGripCoefficient: { maximum: 3, minimum: 0.1, step: 0.01 },
  slidingSlipAngleDegrees: { maximum: 45, minimum: 1, step: 0.5 },
  suspensionBumpRate: { maximum: 200_000, minimum: 0, step: 1_000 },
  suspensionBumpStart: { maximum: 0.4, minimum: 0, step: 0.01 },
  suspensionDamperRate: { maximum: 3_000, minimum: 0, step: 10 },
  suspensionSpringRate: { maximum: 30_000, minimum: 1_000, step: 500 },
  turnRate: { maximum: 240, minimum: 1, step: 1 },
};

function clamp(value: number, minimum: number, maximum: number) {
  return Math.min(Math.max(value, minimum), maximum);
}

export function normalizeKartTuning(tuning: Partial<KartTuning>): KartTuning {
  const next = { ...DEFAULT_KART_TUNING };

  (Object.keys(DEFAULT_KART_TUNING) as KartTuningKey[]).forEach((key) => {
    const requestedValue = tuning[key];
    if (
      typeof requestedValue !== "number" ||
      !Number.isFinite(requestedValue)
    ) {
      return;
    }
    const bounds = KART_TUNING_BOUNDS[key];
    next[key] = clamp(requestedValue, bounds.minimum, bounds.maximum);
  });

  next.minimumHighSpeedSteerAngle = Math.min(
    next.minimumHighSpeedSteerAngle,
    next.maximumSteerAngle,
  );
  next.slidingGripCoefficient = Math.min(
    next.slidingGripCoefficient,
    next.peakGripCoefficient,
  );
  next.slidingSlipAngleDegrees = Math.max(
    next.slidingSlipAngleDegrees,
    next.peakSlipAngleDegrees + 0.5,
  );
  next.brakingSlideStartAngleDegrees = Math.min(
    next.brakingSlideStartAngleDegrees,
    next.slidingSlipAngleDegrees - 0.5,
  );
  next.brakingAssistFullAngleDegrees = Math.max(
    next.brakingAssistFullAngleDegrees,
    next.brakingAssistStartAngleDegrees + 0.5,
  );
  next.brakingSmokeStopDemand = Math.min(
    next.brakingSmokeStopDemand,
    next.brakingSmokeStartDemand,
  );
  next.brakingSmokeStopTireForceUtilization = Math.min(
    next.brakingSmokeStopTireForceUtilization,
    next.brakingSmokeStartTireForceUtilization,
  );
  next.countdownSmokeStopThrottle = Math.min(
    next.countdownSmokeStopThrottle,
    next.countdownSmokeStartThrottle,
  );
  next.driftSmokeStopSpeed = Math.min(
    next.driftSmokeStopSpeed,
    next.driftSmokeStartSpeed,
  );
  next.driftSmokeStopSlipAngleDegrees = Math.min(
    next.driftSmokeStopSlipAngleDegrees,
    next.driftSmokeStartSlipAngleDegrees,
  );
  next.heavyDriftSmokeStartSlipAngleDegrees = Math.max(
    next.heavyDriftSmokeStartSlipAngleDegrees,
    next.driftSmokeStartSlipAngleDegrees + 0.5,
  );
  next.heavyDriftSmokeStopSlipAngleDegrees = clamp(
    next.heavyDriftSmokeStopSlipAngleDegrees,
    next.driftSmokeStopSlipAngleDegrees,
    next.heavyDriftSmokeStartSlipAngleDegrees,
  );

  return next;
}

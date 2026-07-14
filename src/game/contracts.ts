export type CourseTestObstacleId = "obstacle-barrel-a" | "obstacle-barrel-b";

export type Position3 = {
  x: number;
  y: number;
  z: number;
};

export type DrivingInput = {
  brake: number;
  handbrake: number;
  reset: boolean;
  steer: number;
  throttle: number;
};

export type PlayerInputActions = {
  accelerate: number;
  brakeReverse: number;
  handbrake: number;
  pauseRequested: boolean;
  resetRequested: boolean;
  steer: number;
};

export type KartControllerState = {
  speed: number;
  steerAngle: number;
  verticalVelocity: number;
};

export interface KartController {
  readonly state: KartControllerState;
  reset(): void;
  setTuning(tuning: KartTuning): void;
  update(input: DrivingInput, deltaSeconds: number): void;
}

export type KartTuning = {
  acceleration: number;
  angularDamping: number;
  airborneMaximumPitchAcceleration: number;
  airbornePitchDampingRate: number;
  airbornePitchSpringRate: number;
  airbornePitchTargetDegrees: number;
  brakeForce: number;
  brakeReverseStopSpeed: number;
  brakingAssistFullAngleDegrees: number;
  brakingAssistStartAngleDegrees: number;
  brakingSmokeStartDemand: number;
  brakingSmokeStartTireForceUtilization: number;
  brakingSmokeStopDemand: number;
  brakingSmokeStopTireForceUtilization: number;
  brakingSlideStartAngleDegrees: number;
  brakingSlideStartDemand: number;
  chassisFriction: number;
  chassisRestitution: number;
  countdownSmokeStartThrottle: number;
  countdownSmokeStopThrottle: number;
  drag: number;
  driftSmokeStartSlipAngleDegrees: number;
  driftSmokeStartSpeed: number;
  driftSmokeStopSlipAngleDegrees: number;
  driftSmokeStopSpeed: number;
  gravity: number;
  handbrakeForceMultiplier: number;
  heavyDriftSmokeStartSlipAngleDegrees: number;
  heavyDriftSmokeStopSlipAngleDegrees: number;
  lateralStiffness: number;
  linearDamping: number;
  lowSpeedLateralStiffness: number;
  lowSpeedLateralStiffnessThreshold: number;
  lowSpeedReference: number;
  maxForwardSpeed: number;
  maxReverseSpeed: number;
  maximumBrakingForceReduction: number;
  maximumBrakingLateralStiffnessReduction: number;
  maximumBrakingSlideGripReduction: number;
  maximumBrakingYawLeverReduction: number;
  maximumSteerAngle: number;
  maximumSuspensionLoad: number;
  minimumHighSpeedSteerAngle: number;
  peakGripCoefficient: number;
  peakSlipAngleDegrees: number;
  restingSettleMaximumAngularSpeed: number;
  restingSettleMaximumLinearSpeed: number;
  restingSettleMaximumVerticalSpeed: number;
  restingAngularSettleRate: number;
  reverseForceMultiplier: number;
  slidingGripCoefficient: number;
  slidingSlipAngleDegrees: number;
  suspensionBumpRate: number;
  suspensionBumpStart: number;
  suspensionDamperRate: number;
  suspensionSpringRate: number;
  turnRate: number;
};

export type KartTuningKey = keyof KartTuning;

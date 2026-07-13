export type CourseTestObstacleId =
  | "obstacle-barrel-a"
  | "obstacle-barrel-b";

export type Position3 = {
  x: number;
  y: number;
  z: number;
};

export type DrivingInput = {
  brake: number;
  reset: boolean;
  steer: number;
  throttle: number;
};

export type KartControllerState = {
  speed: number;
  steerAngle: number;
  verticalVelocity: number;
};

export interface KartController {
  readonly state: KartControllerState;
  reset(): void;
  setTuning(tuning: KartMovementTuning): void;
  update(input: DrivingInput, deltaSeconds: number): void;
}

export type KartMovementTuning = {
  acceleration: number;
  brakeForce: number;
  drag: number;
  gravity: number;
  maxForwardSpeed: number;
  maxReverseSpeed: number;
  turnRate: number;
};

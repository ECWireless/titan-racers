import type { KartPhysicalProfile } from "./kart/kart-physical-profile";
import type { WorldEnvironment } from "./physics/world-environment";

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
  setEnvironment(environment: WorldEnvironment): void;
  setPhysicalProfile(profile: KartPhysicalProfile): void;
  update(input: DrivingInput, deltaSeconds: number): void;
}

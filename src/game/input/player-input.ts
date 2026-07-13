import type { DrivingInput, PlayerInputActions } from "../contracts";

export type PlayerInputDevice = "gamepad" | "keyboard" | "touch";

export type ContinuousPlayerInput = Pick<
  PlayerInputActions,
  "accelerate" | "brakeReverse" | "steer"
>;

export type PlayerInputSourceSnapshot = ContinuousPlayerInput & {
  pauseRequested: boolean;
  resetRequested: boolean;
};

export const NEUTRAL_CONTINUOUS_INPUT: ContinuousPlayerInput = {
  accelerate: 0,
  brakeReverse: 0,
  steer: 0,
};

export const NEUTRAL_PLAYER_INPUT: PlayerInputActions = {
  ...NEUTRAL_CONTINUOUS_INPUT,
  pauseRequested: false,
  resetRequested: false,
};

export function clampInput(value: number, minimum: number, maximum: number) {
  if (!Number.isFinite(value)) {
    return 0;
  }

  return Math.min(maximum, Math.max(minimum, value));
}

export function normalizeContinuousInput(
  input: ContinuousPlayerInput,
): ContinuousPlayerInput {
  return {
    accelerate: clampInput(input.accelerate, 0, 1),
    brakeReverse: clampInput(input.brakeReverse, 0, 1),
    steer: clampInput(input.steer, -1, 1),
  };
}

export function applyAxialDeadZone(value: number, deadZone: number) {
  const clampedValue = clampInput(value, -1, 1);
  const clampedDeadZone = clampInput(deadZone, 0, 0.95);
  const magnitude = Math.abs(clampedValue);

  if (magnitude <= clampedDeadZone) {
    return 0;
  }

  return (
    Math.sign(clampedValue) *
    ((magnitude - clampedDeadZone) / (1 - clampedDeadZone))
  );
}

export function toDrivingInput(input: PlayerInputActions): DrivingInput {
  return {
    brake: input.brakeReverse,
    reset: false,
    // The normalized player contract follows the browser gamepad axis
    // convention (left negative, right positive). The accepted kart controller
    // predates that contract and uses the inverse sign.
    steer: -input.steer,
    throttle: input.accelerate - input.brakeReverse,
  };
}

export interface PlayerInputSource {
  clear(): void;
  sample(): PlayerInputSourceSnapshot;
}

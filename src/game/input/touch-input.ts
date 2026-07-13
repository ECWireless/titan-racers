import type {
  ContinuousPlayerInput,
  PlayerInputSource,
  PlayerInputSourceSnapshot,
} from "./player-input";
import { applyAxialDeadZone } from "./player-input";

export type TouchPedalAction = "accelerate" | "brakeReverse";

export const TOUCH_STEERING_DEAD_ZONE = 0.08;
export const TOUCH_STEERING_RESPONSE_EXPONENT = 1.5;

export function normalizeTouchSteering(value: number) {
  const steer = applyAxialDeadZone(value, TOUCH_STEERING_DEAD_ZONE);

  return (
    Math.sign(steer) *
    Math.pow(Math.abs(steer), TOUCH_STEERING_RESPONSE_EXPONENT)
  );
}

export class TouchInput implements PlayerInputSource {
  private readonly pedalPointers = new Map<number, TouchPedalAction>();
  private steeringPointer: { pointerId: number; value: number } | null = null;
  private pauseRequested = false;
  private resetRequested = false;

  constructor(private readonly onDrivingActivity: () => void = () => undefined) {}

  pressPedal(pointerId: number, action: TouchPedalAction) {
    this.pedalPointers.set(pointerId, action);
    this.onDrivingActivity();
  }

  setSteering(pointerId: number, value: number) {
    const steer = normalizeTouchSteering(value);
    this.steeringPointer = { pointerId, value: steer };
    if (steer !== 0) {
      this.onDrivingActivity();
    }
  }

  release(pointerId: number) {
    this.pedalPointers.delete(pointerId);
    if (this.steeringPointer?.pointerId === pointerId) {
      this.steeringPointer = null;
    }
  }

  requestPause() {
    this.pauseRequested = true;
  }

  requestReset() {
    this.resetRequested = true;
  }

  clear() {
    this.pedalPointers.clear();
    this.steeringPointer = null;
    this.pauseRequested = false;
    this.resetRequested = false;
  }

  getContinuousInput(): ContinuousPlayerInput {
    const actions = new Set(this.pedalPointers.values());
    return {
      accelerate: Number(actions.has("accelerate")),
      brakeReverse: Number(actions.has("brakeReverse")),
      steer: this.steeringPointer?.value ?? 0,
    };
  }

  sample(): PlayerInputSourceSnapshot {
    const snapshot = {
      ...this.getContinuousInput(),
      pauseRequested: this.pauseRequested,
      resetRequested: this.resetRequested,
    };
    this.pauseRequested = false;
    this.resetRequested = false;
    return snapshot;
  }
}

import type {
  ContinuousPlayerInput,
  PlayerInputSource,
  PlayerInputSourceSnapshot,
} from "./player-input";

export type TouchPedalAction = "accelerate" | "brakeReverse";

export const TOUCH_JOYSTICK_DEAD_ZONE = 0.08;
export const TOUCH_JOYSTICK_RESPONSE_EXPONENT = 1.75;

export type TouchJoystickValue = {
  x: number;
  y: number;
};

export function normalizeTouchJoystick(
  x: number,
  y: number,
): TouchJoystickValue {
  const safeX = Number.isFinite(x) ? x : 0;
  const safeY = Number.isFinite(y) ? y : 0;
  const rawMagnitude = Math.hypot(safeX, safeY);

  if (rawMagnitude <= TOUCH_JOYSTICK_DEAD_ZONE) {
    return { x: 0, y: 0 };
  }

  const clampedMagnitude = Math.min(rawMagnitude, 1);
  const normalizedMagnitude =
    (clampedMagnitude - TOUCH_JOYSTICK_DEAD_ZONE) /
    (1 - TOUCH_JOYSTICK_DEAD_ZONE);
  const shapedMagnitude = Math.pow(
    normalizedMagnitude,
    TOUCH_JOYSTICK_RESPONSE_EXPONENT,
  );
  const directionX = safeX / rawMagnitude;
  const directionY = safeY / rawMagnitude;

  return {
    x: directionX * shapedMagnitude,
    y: directionY * shapedMagnitude,
  };
}

export class TouchInput implements PlayerInputSource {
  private readonly pedalPointers = new Map<number, TouchPedalAction>();
  private joystickPointer: (TouchJoystickValue & { pointerId: number }) | null =
    null;
  private pauseRequested = false;
  private resetRequested = false;

  constructor(
    private readonly onDrivingActivity: () => void = () => undefined,
  ) {}

  pressPedal(pointerId: number, action: TouchPedalAction) {
    this.pedalPointers.set(pointerId, action);
    this.onDrivingActivity();
  }

  setJoystick(pointerId: number, x: number, y: number) {
    const joystick = normalizeTouchJoystick(x, y);
    this.joystickPointer = { pointerId, ...joystick };
    if (joystick.x !== 0 || joystick.y !== 0) {
      this.onDrivingActivity();
    }
  }

  release(pointerId: number) {
    this.pedalPointers.delete(pointerId);
    if (this.joystickPointer?.pointerId === pointerId) {
      this.joystickPointer = null;
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
    this.joystickPointer = null;
    this.pauseRequested = false;
    this.resetRequested = false;
  }

  getContinuousInput(): ContinuousPlayerInput {
    const actions = new Set(this.pedalPointers.values());
    const joystickX = this.joystickPointer?.x ?? 0;
    const joystickY = this.joystickPointer?.y ?? 0;
    return {
      accelerate: Math.max(
        Number(actions.has("accelerate")),
        Math.max(-joystickY, 0),
      ),
      brakeReverse: Math.max(
        Number(actions.has("brakeReverse")),
        Math.max(joystickY, 0),
      ),
      handbrake: 0,
      steer: joystickX,
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

import type {
  ContinuousPlayerInput,
  PlayerInputSource,
  PlayerInputSourceSnapshot,
} from "./player-input";

export type TouchPedalAction = "accelerate" | "brakeReverse";

export const TOUCH_JOYSTICK_DEAD_ZONE = 0.08;
export const TOUCH_JOYSTICK_RESPONSE_EXPONENT = 1.75;
export const TOUCH_HANDBRAKE_STEER_START = 0.3;
export const TOUCH_HANDBRAKE_STEER_FULL = 0.7;
export const TOUCH_HANDBRAKE_ACCELERATE_FULL = 0.5;
export const TOUCH_HANDBRAKE_SERVICE_BRAKE_FLOOR = 0.2;
// A full sideways push often sags a little below horizontal; within this many
// degrees the joystick only steers instead of dragging the service brake.
export const TOUCH_JOYSTICK_BRAKE_DEAD_BAND_DEGREES = 10;
// Pulling the joystick back-diagonal at speed requests the handbrake without
// the pedal. Angles are degrees behind horizontal; the band ramps in, holds,
// and ramps out so straight-back pulls stay service braking.
export const TOUCH_PULL_HANDBRAKE_ANGLES = [10, 20, 40, 50] as const;
export const TOUCH_PULL_HANDBRAKE_MAGNITUDE = [0.5, 0.8] as const;
// Travel speed as a fraction of the kart's no-load speed.
export const TOUCH_PULL_HANDBRAKE_SPEED_RATIO = [0.3, 0.4] as const;
// The gesture's handbrake rises over this time but releases at once.
export const TOUCH_PULL_HANDBRAKE_RISE_SECONDS = 0.3;

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

export function getTouchBrakeSteerHandbrake(
  accelerate: number,
  brakePedalHeld: boolean,
  steer: number,
): number {
  const accelerateIntent = Number.isFinite(accelerate)
    ? Math.max(accelerate, 0)
    : 0;
  const steerMagnitude = Number.isFinite(steer) ? Math.abs(steer) : 0;
  if (
    !brakePedalHeld ||
    accelerateIntent === 0 ||
    steerMagnitude <= TOUCH_HANDBRAKE_STEER_START
  ) {
    return 0;
  }

  const steerProgress = Math.min(
    (steerMagnitude - TOUCH_HANDBRAKE_STEER_START) /
      (TOUCH_HANDBRAKE_STEER_FULL - TOUCH_HANDBRAKE_STEER_START),
    1,
  );
  const smoothSteerProgress =
    steerProgress * steerProgress * (3 - 2 * steerProgress);
  const accelerateProgress = Math.min(
    accelerateIntent / TOUCH_HANDBRAKE_ACCELERATE_FULL,
    1,
  );

  return accelerateProgress * smoothSteerProgress;
}

// Degrees behind horizontal: 0 is full sideways and 90 is straight back.
function getJoystickAngleBehind(joystickX: number, joystickY: number) {
  return (Math.atan2(joystickY, Math.abs(joystickX)) * 180) / Math.PI;
}

function smoothRamp(value: number, start: number, full: number) {
  const progress = Math.min(Math.max((value - start) / (full - start), 0), 1);
  return progress * progress * (3 - 2 * progress);
}

export function getTouchPullHandbrake(
  joystickX: number,
  joystickY: number,
  forwardSpeedRatio: number,
): number {
  if (
    !Number.isFinite(joystickX) ||
    !Number.isFinite(joystickY) ||
    !Number.isFinite(forwardSpeedRatio) ||
    joystickY <= 0
  ) {
    return 0;
  }

  const angle = getJoystickAngleBehind(joystickX, joystickY);
  const [rampIn, fullIn, fullOut, rampOut] = TOUCH_PULL_HANDBRAKE_ANGLES;
  const angleProgress =
    smoothRamp(angle, rampIn, fullIn) *
    (1 - smoothRamp(angle, fullOut, rampOut));

  return (
    angleProgress *
    smoothRamp(
      Math.hypot(joystickX, joystickY),
      ...TOUCH_PULL_HANDBRAKE_MAGNITUDE,
    ) *
    smoothRamp(forwardSpeedRatio, ...TOUCH_PULL_HANDBRAKE_SPEED_RATIO)
  );
}

export class TouchInput implements PlayerInputSource {
  private readonly pedalPointers = new Map<number, TouchPedalAction>();
  private joystickPointer: (TouchJoystickValue & { pointerId: number }) | null =
    null;
  private pauseRequested = false;
  private resetRequested = false;
  private pullHandbrake = 0;

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
    this.pullHandbrake = 0;
  }

  getContinuousInput(): ContinuousPlayerInput {
    const pullHandbrake = this.pullHandbrake;
    const actions = new Set(this.pedalPointers.values());
    const joystickX = this.joystickPointer?.x ?? 0;
    const joystickY = this.joystickPointer?.y ?? 0;
    const accelerate = Math.max(
      Number(actions.has("accelerate")),
      Math.max(-joystickY, 0),
    );
    const brakePedalHeld = actions.has("brakeReverse");
    const handbrake = Math.max(
      getTouchBrakeSteerHandbrake(accelerate, brakePedalHeld, joystickX),
      pullHandbrake,
    );
    const joystickBrake =
      joystickY > 0 &&
      getJoystickAngleBehind(joystickX, joystickY) >=
        TOUCH_JOYSTICK_BRAKE_DEAD_BAND_DEGREES
        ? joystickY
        : 0;
    // A circular two-axis gesture cannot combine the full forward and lateral
    // components available from separate keyboard controls. As deliberate
    // handbrake intent rises, restore that missing steering authority smoothly
    // so the touch gesture can request the same physical maneuver.
    const handbrakeSteer =
      joystickX === 0
        ? 0
        : joystickX + (Math.sign(joystickX) - joystickX) * handbrake;
    return {
      accelerate,
      brakeReverse: Math.max(
        Number(brakePedalHeld) *
          (1 - handbrake * (1 - TOUCH_HANDBRAKE_SERVICE_BRAKE_FLOOR)),
        joystickBrake *
          (1 - pullHandbrake * (1 - TOUCH_HANDBRAKE_SERVICE_BRAKE_FLOOR)),
      ),
      handbrake,
      steer: handbrakeSteer,
    };
  }

  sample(forwardSpeedRatio = 0, deltaSeconds = 0): PlayerInputSourceSnapshot {
    const target = getTouchPullHandbrake(
      this.joystickPointer?.x ?? 0,
      this.joystickPointer?.y ?? 0,
      forwardSpeedRatio,
    );
    this.pullHandbrake =
      target <= this.pullHandbrake
        ? target
        : Math.min(
            target,
            this.pullHandbrake +
              deltaSeconds / TOUCH_PULL_HANDBRAKE_RISE_SECONDS,
          );
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

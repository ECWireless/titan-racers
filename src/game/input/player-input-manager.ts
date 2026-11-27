import type { DrivingInput, PlayerInputActions } from "../contracts";
import { GamepadInput, type GamepadProvider } from "./gamepad-input";
import { KeyboardInput } from "./keyboard-input";
import {
  NEUTRAL_CONTINUOUS_INPUT,
  NEUTRAL_PLAYER_INPUT,
  normalizeContinuousInput,
  toDrivingInput,
  type PlayerInputDevice,
} from "./player-input";
import { TouchInput, type TouchButtonAction } from "./touch-input";

export class PlayerInputManager {
  readonly keyboard: KeyboardInput;
  readonly touch: TouchInput;
  readonly gamepad: GamepadInput;
  private activeDevice: PlayerInputDevice = "keyboard";
  private enabled = true;
  // Set by a clear or a reset while looking behind: look behind waits for
  // every device to let go, so a held key, button, or touch does not carry
  // over.
  private lookBehindNeedsRelease = false;
  private lookingBehindNow = false;

  /** Whether the last sample held look behind, on any device. */
  get lookingBehind() {
    return this.lookingBehindNow;
  }

  constructor(
    target: Window,
    getGamepads: GamepadProvider,
    private readonly onDeviceActivity: (device: PlayerInputDevice) => void = () =>
      undefined,
  ) {
    this.keyboard = new KeyboardInput(target, () => this.activate("keyboard"));
    this.touch = new TouchInput(() => this.activate("touch"));
    this.gamepad = new GamepadInput(getGamepads, () => this.activate("gamepad"));
  }

  attach() {
    this.keyboard.attach();
  }

  detach() {
    this.keyboard.detach();
    this.touch.clear();
    this.gamepad.clear();
  }

  clear() {
    this.keyboard.clear();
    this.touch.clear();
    this.gamepad.clear();
    this.endLookBehind();
  }

  /**
   * Looks forward again. A control holding look behind now must be let go
   * and pressed again; a fresh press counts at once.
   */
  endLookBehind() {
    this.lookBehindNeedsRelease ||= this.lookingBehindNow;
    this.lookingBehindNow = false;
  }

  setEnabled(enabled: boolean) {
    this.clear();
    this.enabled = enabled;
  }

  pressTouchButton(pointerId: number, action: TouchButtonAction) {
    if (!this.enabled) {
      return;
    }
    this.touch.pressButton(pointerId, action);
  }

  setTouchJoystick(pointerId: number, x: number, y: number) {
    if (!this.enabled) {
      return;
    }
    this.touch.setJoystick(pointerId, x, y);
  }

  releaseTouch(pointerId: number) {
    this.touch.release(pointerId);
  }

  requestTouchReset() {
    if (!this.enabled) {
      return;
    }
    this.touch.requestReset();
  }

  // `forwardSpeedRatio` is signed travel speed over the kart's no-load speed.
  // Touch uses it and the step time to gate and ramp the pull-back handbrake.
  sample(forwardSpeedRatio = 0, deltaSeconds = 0): PlayerInputActions {
    if (!this.enabled) {
      return { ...NEUTRAL_PLAYER_INPUT };
    }
    const keyboard = this.keyboard.sample();
    const touch = this.touch.sample(forwardSpeedRatio, deltaSeconds);
    const gamepad = this.gamepad.sample();
    const sources = { gamepad, keyboard, touch };
    const continuous = normalizeContinuousInput(
      sources[this.activeDevice] ?? NEUTRAL_CONTINUOUS_INPUT,
    );

    // Any device looks behind, as any can pause or reset.
    const lookBehindHeld =
      keyboard.lookBehind || touch.lookBehind || gamepad.lookBehind;
    if (!lookBehindHeld) {
      this.lookBehindNeedsRelease = false;
    }
    this.lookingBehindNow = lookBehindHeld && !this.lookBehindNeedsRelease;

    return {
      ...continuous,
      pauseRequested:
        keyboard.pauseRequested || touch.pauseRequested || gamepad.pauseRequested,
      resetRequested:
        keyboard.resetRequested || touch.resetRequested || gamepad.resetRequested,
    };
  }

  sampleDrivingInput(
    forwardSpeedRatio = 0,
    deltaSeconds = 0,
  ): {
    actions: PlayerInputActions;
    driving: DrivingInput;
  } {
    const actions = this.sample(forwardSpeedRatio, deltaSeconds);
    return { actions, driving: toDrivingInput(actions) };
  }

  private activate(device: PlayerInputDevice) {
    this.activeDevice = device;
    this.onDeviceActivity(device);
  }
}

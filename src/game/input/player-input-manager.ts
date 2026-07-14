import type { DrivingInput, PlayerInputActions } from "../contracts";
import { GamepadInput, type GamepadProvider } from "./gamepad-input";
import { KeyboardInput } from "./keyboard-input";
import {
  NEUTRAL_CONTINUOUS_INPUT,
  normalizeContinuousInput,
  toDrivingInput,
  type PlayerInputDevice,
} from "./player-input";
import { TouchInput, type TouchPedalAction } from "./touch-input";

export class PlayerInputManager {
  readonly keyboard: KeyboardInput;
  readonly touch: TouchInput;
  readonly gamepad: GamepadInput;
  private activeDevice: PlayerInputDevice = "keyboard";
  private enabled = true;

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
  }

  setEnabled(enabled: boolean) {
    this.clear();
    this.enabled = enabled;
  }

  pressTouchPedal(pointerId: number, action: TouchPedalAction) {
    if (!this.enabled) {
      return;
    }
    this.touch.pressPedal(pointerId, action);
  }

  setTouchSteering(pointerId: number, value: number) {
    if (!this.enabled) {
      return;
    }
    this.touch.setSteering(pointerId, value);
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

  sample(): PlayerInputActions {
    if (!this.enabled) {
      return { ...NEUTRAL_CONTINUOUS_INPUT, pauseRequested: false, resetRequested: false };
    }
    const keyboard = this.keyboard.sample();
    const touch = this.touch.sample();
    const gamepad = this.gamepad.sample();
    const sources = { gamepad, keyboard, touch };
    const continuous = normalizeContinuousInput(
      sources[this.activeDevice] ?? NEUTRAL_CONTINUOUS_INPUT,
    );

    return {
      ...continuous,
      pauseRequested:
        keyboard.pauseRequested || touch.pauseRequested || gamepad.pauseRequested,
      resetRequested:
        keyboard.resetRequested || touch.resetRequested || gamepad.resetRequested,
    };
  }

  sampleDrivingInput(): { actions: PlayerInputActions; driving: DrivingInput } {
    const actions = this.sample();
    return { actions, driving: toDrivingInput(actions) };
  }

  private activate(device: PlayerInputDevice) {
    this.activeDevice = device;
    this.onDeviceActivity(device);
  }
}

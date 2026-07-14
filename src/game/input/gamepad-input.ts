import {
  applyAxialDeadZone,
  clampInput,
  type ContinuousPlayerInput,
  type PlayerInputSource,
  type PlayerInputSourceSnapshot,
} from "./player-input";

export type GamepadProvider = () => ArrayLike<Gamepad | null>;

const ACTIVITY_CHANGE_THRESHOLD = 0.08;
const BUTTON_RESET = 0;
const BUTTON_HANDBRAKE = 2;
const BUTTON_BRAKE_REVERSE = 6;
const BUTTON_ACCELERATE = 7;
const BUTTON_PAUSE = 9;
const BUTTON_DPAD_LEFT = 14;
const BUTTON_DPAD_RIGHT = 15;
const AXIS_STEER = 0;

function buttonValue(gamepad: Gamepad, index: number) {
  const button = gamepad.buttons[index];
  return button ? clampInput(button.value || Number(button.pressed), 0, 1) : 0;
}

function buttonPressed(gamepad: Gamepad, index: number) {
  return Boolean(gamepad.buttons[index]?.pressed);
}

function hasIntentionalInput(gamepad: Gamepad, deadZone: number) {
  return (
    applyAxialDeadZone(gamepad.axes[AXIS_STEER] ?? 0, deadZone) !== 0 ||
    buttonValue(gamepad, BUTTON_ACCELERATE) > 0 ||
    buttonValue(gamepad, BUTTON_BRAKE_REVERSE) > 0 ||
    buttonValue(gamepad, BUTTON_HANDBRAKE) > 0 ||
    buttonPressed(gamepad, BUTTON_DPAD_LEFT) ||
    buttonPressed(gamepad, BUTTON_DPAD_RIGHT) ||
    buttonPressed(gamepad, BUTTON_RESET) ||
    buttonPressed(gamepad, BUTTON_PAUSE)
  );
}

export class GamepadInput implements PlayerInputSource {
  private activeIndex: number | null = null;
  private activityBaseline: ContinuousPlayerInput = {
    accelerate: 0,
    brakeReverse: 0,
    handbrake: 0,
    steer: 0,
  };
  private lastPausePressed = false;
  private lastResetPressed = false;
  private requiresNeutral = false;

  constructor(
    private readonly getGamepads: GamepadProvider,
    private readonly onDrivingActivity: () => void = () => undefined,
    private readonly deadZone = 0.15,
  ) {}

  clear() {
    this.activeIndex = null;
    this.activityBaseline = {
      accelerate: 0,
      brakeReverse: 0,
      handbrake: 0,
      steer: 0,
    };
    this.lastPausePressed = false;
    this.lastResetPressed = false;
    this.requiresNeutral = true;
  }

  sample(): PlayerInputSourceSnapshot {
    const gamepads = Array.from(this.getGamepads());
    const supportedGamepads = gamepads.filter(
      (candidate): candidate is Gamepad =>
        Boolean(candidate?.connected && candidate.mapping === "standard"),
    );

    if (this.requiresNeutral) {
      if (
        supportedGamepads.some((candidate) =>
          hasIntentionalInput(candidate, this.deadZone),
        )
      ) {
        return this.neutralSnapshot();
      }

      this.requiresNeutral = false;
      return this.neutralSnapshot();
    }

    let gamepad =
      this.activeIndex === null ? null : (gamepads[this.activeIndex] ?? null);

    if (
      this.activeIndex !== null &&
      (!gamepad?.connected || gamepad.mapping !== "standard")
    ) {
      this.clear();
      return this.neutralSnapshot();
    }

    if (!gamepad?.connected || gamepad.mapping !== "standard") {
      gamepad =
        supportedGamepads.find((candidate) =>
          hasIntentionalInput(candidate, this.deadZone),
        ) ?? null;
    }

    if (!gamepad) {
      this.activeIndex = null;
      this.activityBaseline = {
        accelerate: 0,
        brakeReverse: 0,
        handbrake: 0,
        steer: 0,
      };
      this.lastPausePressed = false;
      this.lastResetPressed = false;
      return this.neutralSnapshot();
    }

    const analogSteer = applyAxialDeadZone(
      gamepad.axes[AXIS_STEER] ?? 0,
      this.deadZone,
    );
    const digitalSteer =
      Number(buttonPressed(gamepad, BUTTON_DPAD_RIGHT)) -
      Number(buttonPressed(gamepad, BUTTON_DPAD_LEFT));
    const continuous = {
      accelerate: buttonValue(gamepad, BUTTON_ACCELERATE),
      brakeReverse: buttonValue(gamepad, BUTTON_BRAKE_REVERSE),
      handbrake: buttonValue(gamepad, BUTTON_HANDBRAKE),
      steer: digitalSteer || analogSteer,
    };
    const meaningfulActivation =
      continuous.accelerate >=
        this.activityBaseline.accelerate + ACTIVITY_CHANGE_THRESHOLD ||
      continuous.brakeReverse >=
        this.activityBaseline.brakeReverse + ACTIVITY_CHANGE_THRESHOLD ||
      continuous.handbrake >=
        this.activityBaseline.handbrake + ACTIVITY_CHANGE_THRESHOLD ||
      Math.abs(continuous.steer) >=
        Math.abs(this.activityBaseline.steer) + ACTIVITY_CHANGE_THRESHOLD ||
      (Math.sign(continuous.steer) !== Math.sign(this.activityBaseline.steer) &&
        Math.abs(continuous.steer) >= ACTIVITY_CHANGE_THRESHOLD);
    const hasDrivingIntent =
      continuous.accelerate > 0 ||
      continuous.brakeReverse > 0 ||
      continuous.handbrake > 0 ||
      continuous.steer !== 0;

    if (hasDrivingIntent && meaningfulActivation) {
      this.activeIndex = gamepad.index;
      this.activityBaseline = continuous;
      this.onDrivingActivity();
    } else if (!hasDrivingIntent) {
      this.activityBaseline = {
        accelerate: 0,
        brakeReverse: 0,
        handbrake: 0,
        steer: 0,
      };
    }

    const pausePressed = buttonPressed(gamepad, BUTTON_PAUSE);
    const resetPressed = buttonPressed(gamepad, BUTTON_RESET);
    const snapshot = {
      ...continuous,
      pauseRequested: pausePressed && !this.lastPausePressed,
      resetRequested: resetPressed && !this.lastResetPressed,
    };

    this.lastPausePressed = pausePressed;
    this.lastResetPressed = resetPressed;
    return snapshot;
  }

  private neutralSnapshot(): PlayerInputSourceSnapshot {
    return {
      accelerate: 0,
      brakeReverse: 0,
      handbrake: 0,
      pauseRequested: false,
      resetRequested: false,
      steer: 0,
    };
  }
}

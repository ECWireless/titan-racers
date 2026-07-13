import type { GamepadProvider } from "./gamepad-input";

const AXIS_VERTICAL = 1;
const BUTTON_CONFIRM = 0;
const BUTTON_BACK = 1;
const BUTTON_MENU = 9;
const BUTTON_DPAD_UP = 12;
const BUTTON_DPAD_DOWN = 13;

export type MenuMove = -1 | 0 | 1;

export type GamepadMenuActions = {
  backRequested: boolean;
  confirmRequested: boolean;
  menuRequested: boolean;
  move: MenuMove;
};

const NEUTRAL_MENU_ACTIONS: GamepadMenuActions = {
  backRequested: false,
  confirmRequested: false,
  menuRequested: false,
  move: 0,
};

function pressed(gamepad: Gamepad, index: number) {
  return Boolean(gamepad.buttons[index]?.pressed);
}

function digitalDirection(gamepad: Gamepad): MenuMove {
  const direction =
    Number(pressed(gamepad, BUTTON_DPAD_DOWN)) -
    Number(pressed(gamepad, BUTTON_DPAD_UP));
  return direction < 0 ? -1 : direction > 0 ? 1 : 0;
}

export class GamepadMenuInput {
  private activeIndex: number | null = null;
  private armed = false;
  private heldDirection: MenuMove = 0;
  private lastBackPressed = false;
  private lastConfirmPressed = false;
  private lastMenuPressed = false;
  private nextRepeatAt = 0;

  constructor(
    private readonly getGamepads: GamepadProvider,
    private readonly entryThreshold = 0.55,
    private readonly releaseThreshold = 0.35,
    private readonly repeatDelayMs = 350,
    private readonly repeatIntervalMs = 120,
  ) {}

  clear() {
    this.activeIndex = null;
    this.armed = false;
    this.heldDirection = 0;
    this.lastBackPressed = false;
    this.lastConfirmPressed = false;
    this.lastMenuPressed = false;
    this.nextRepeatAt = 0;
  }

  sample(nowMs: number): GamepadMenuActions {
    const gamepads = Array.from(this.getGamepads());
    const supported = gamepads.filter(
      (candidate): candidate is Gamepad =>
        Boolean(candidate?.connected && candidate.mapping === "standard"),
    );

    if (!this.armed) {
      if (supported.some((gamepad) => this.hasIntentionalInput(gamepad))) {
        return { ...NEUTRAL_MENU_ACTIONS };
      }
      this.armed = true;
      return { ...NEUTRAL_MENU_ACTIONS };
    }

    let gamepad =
      this.activeIndex === null ? null : (gamepads[this.activeIndex] ?? null);

    if (
      this.activeIndex !== null &&
      (!gamepad?.connected || gamepad.mapping !== "standard")
    ) {
      this.clear();
      return { ...NEUTRAL_MENU_ACTIONS };
    }

    if (!gamepad) {
      gamepad =
        supported.find((candidate) => this.hasIntentionalInput(candidate)) ??
        null;
      this.activeIndex = gamepad?.index ?? null;
    }

    if (!gamepad) {
      this.resetEdges();
      return { ...NEUTRAL_MENU_ACTIONS };
    }

    const direction = this.readDirection(gamepad);
    let move: MenuMove = 0;

    if (direction !== this.heldDirection) {
      this.heldDirection = direction;
      if (direction !== 0) {
        move = direction;
        this.nextRepeatAt = nowMs + this.repeatDelayMs;
      }
    } else if (direction !== 0 && nowMs >= this.nextRepeatAt) {
      move = direction;
      this.nextRepeatAt = nowMs + this.repeatIntervalMs;
    }

    const backPressed = pressed(gamepad, BUTTON_BACK);
    const confirmPressed = pressed(gamepad, BUTTON_CONFIRM);
    const menuPressed = pressed(gamepad, BUTTON_MENU);
    const actions = {
      backRequested: backPressed && !this.lastBackPressed,
      confirmRequested: confirmPressed && !this.lastConfirmPressed,
      menuRequested: menuPressed && !this.lastMenuPressed,
      move,
    };

    this.lastBackPressed = backPressed;
    this.lastConfirmPressed = confirmPressed;
    this.lastMenuPressed = menuPressed;
    return actions;
  }

  private hasIntentionalInput(gamepad: Gamepad) {
    return (
      digitalDirection(gamepad) !== 0 ||
      Math.abs(gamepad.axes[AXIS_VERTICAL] ?? 0) >= this.entryThreshold ||
      pressed(gamepad, BUTTON_CONFIRM) ||
      pressed(gamepad, BUTTON_BACK) ||
      pressed(gamepad, BUTTON_MENU)
    );
  }

  private readDirection(gamepad: Gamepad): MenuMove {
    const digital = digitalDirection(gamepad);
    if (digital !== 0) {
      return digital;
    }

    const axis = gamepad.axes[AXIS_VERTICAL] ?? 0;
    if (this.heldDirection < 0 && axis <= -this.releaseThreshold) {
      return -1;
    }
    if (this.heldDirection > 0 && axis >= this.releaseThreshold) {
      return 1;
    }
    if (axis <= -this.entryThreshold) {
      return -1;
    }
    if (axis >= this.entryThreshold) {
      return 1;
    }
    return 0;
  }

  private resetEdges() {
    this.heldDirection = 0;
    this.lastBackPressed = false;
    this.lastConfirmPressed = false;
    this.lastMenuPressed = false;
    this.nextRepeatAt = 0;
  }
}

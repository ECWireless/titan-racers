import type { GamepadProvider } from "./gamepad-input";

const AXIS_LEFT_X = 0;
const AXIS_LEFT_Y = 1;
const AXIS_RIGHT_X = 2;
const AXIS_RIGHT_Y = 3;
const BUTTON_CONFIRM = 0;
const BUTTON_BACK = 1;
const BUTTON_AXIS = 2;
const BUTTON_FRAME = 3;
const BUTTON_TOOL_PREVIOUS = 4;
const BUTTON_TOOL_NEXT = 5;
const BUTTON_ZOOM_OUT = 6;
const BUTTON_ZOOM_IN = 7;
const BUTTON_HELP = 9;
const BUTTON_DPAD_UP = 12;
const BUTTON_DPAD_DOWN = 13;
const BUTTON_DPAD_LEFT = 14;
const BUTTON_DPAD_RIGHT = 15;
const MAPPED_BUTTONS = [
  BUTTON_CONFIRM,
  BUTTON_BACK,
  BUTTON_AXIS,
  BUTTON_FRAME,
  BUTTON_TOOL_PREVIOUS,
  BUTTON_TOOL_NEXT,
  BUTTON_ZOOM_OUT,
  BUTTON_ZOOM_IN,
  BUTTON_HELP,
  BUTTON_DPAD_UP,
  BUTTON_DPAD_DOWN,
  BUTTON_DPAD_LEFT,
  BUTTON_DPAD_RIGHT,
] as const;

export type EditorControllerContext = "ui" | "viewport";
export type EditorFocusDirection = "down" | "left" | "right" | "up";

export type EditorGamepadActions = {
  axisCycle: -1 | 0 | 1;
  backRequested: boolean;
  confirmRequested: boolean;
  connected: boolean;
  frameRequested: boolean;
  helpRequested: boolean;
  move: EditorFocusDirection | null;
  orbitX: number;
  orbitY: number;
  panX: number;
  panY: number;
  toolCycle: -1 | 0 | 1;
  transformDirection: EditorFocusDirection | null;
  zoom: number;
};

const NEUTRAL_ACTIONS: Omit<EditorGamepadActions, "connected"> = {
  axisCycle: 0,
  backRequested: false,
  confirmRequested: false,
  frameRequested: false,
  helpRequested: false,
  move: null,
  orbitX: 0,
  orbitY: 0,
  panX: 0,
  panY: 0,
  toolCycle: 0,
  transformDirection: null,
  zoom: 0,
};

function clamp(value: number, minimum = -1, maximum = 1) {
  return Math.min(maximum, Math.max(minimum, Number.isFinite(value) ? value : 0));
}

function buttonPressed(gamepad: Gamepad, index: number) {
  return Boolean(gamepad.buttons[index]?.pressed);
}

function buttonValue(gamepad: Gamepad, index: number) {
  const button = gamepad.buttons[index];
  return clamp(button?.value ?? Number(button?.pressed ?? false), 0, 1);
}

export function applyEditorStickDeadZone(
  x: number,
  y: number,
  deadZone = 0.2,
) {
  const safeX = clamp(x);
  const safeY = clamp(y);
  const magnitude = Math.min(1, Math.hypot(safeX, safeY));
  if (magnitude <= deadZone || deadZone >= 1) {
    return { x: 0, y: 0 };
  }
  const normalizedMagnitude = (magnitude - deadZone) / (1 - deadZone);
  const scale = normalizedMagnitude / magnitude;
  return {
    x: clamp(safeX * scale),
    y: clamp(safeY * scale),
  };
}

export class EditorGamepadInput {
  private activeIndex: number | null = null;
  private armed = false;
  private context: EditorControllerContext = "ui";
  private heldMove: EditorFocusDirection | null = null;
  private heldTransformDirection: EditorFocusDirection | null = null;
  private nextMoveRepeatAt = 0;
  private nextTransformRepeatAt = 0;
  private previousButtons = new Map<number, boolean>();

  constructor(
    private readonly getGamepads: GamepadProvider,
    private readonly stickDeadZone = 0.2,
    private readonly navigationEntryThreshold = 0.55,
    private readonly navigationReleaseThreshold = 0.35,
    private readonly repeatDelayMs = 350,
    private readonly repeatIntervalMs = 120,
  ) {}

  clear() {
    this.activeIndex = null;
    this.armed = false;
    this.resetRetainedState();
  }

  setContext(context: EditorControllerContext) {
    if (context === this.context) {
      return;
    }
    this.context = context;
    this.clear();
  }

  sample(nowMs: number): EditorGamepadActions {
    const gamepads = Array.from(this.getGamepads());
    const supported = gamepads.filter(
      (candidate): candidate is Gamepad =>
        Boolean(candidate?.connected && candidate.mapping === "standard"),
    );
    const neutral = {
      ...NEUTRAL_ACTIONS,
      connected: supported.length > 0,
    };

    if (!this.armed) {
      if (supported.some((gamepad) => this.hasIntentionalInput(gamepad))) {
        return neutral;
      }
      this.armed = true;
      return neutral;
    }

    let gamepad: Gamepad | null = null;
    if (this.activeIndex !== null) {
      gamepad = gamepads[this.activeIndex] ?? null;
      if (
        !gamepad ||
        !gamepad.connected ||
        gamepad.mapping !== "standard"
      ) {
        this.clear();
        return neutral;
      }
    }
    if (!gamepad) {
      gamepad =
        supported.find((candidate) => this.hasIntentionalInput(candidate)) ??
        null;
      this.activeIndex = gamepad?.index ?? null;
    }
    if (!gamepad) {
      this.resetRetainedState();
      return neutral;
    }

    const actions =
      this.context === "viewport"
        ? this.sampleViewport(gamepad, nowMs)
        : this.sampleUi(gamepad, nowMs);
    this.rememberButtons(gamepad);
    return { ...actions, connected: true };
  }

  private edge(gamepad: Gamepad, button: number) {
    const current = buttonPressed(gamepad, button);
    return current && !this.previousButtons.get(button);
  }

  private hasIntentionalInput(gamepad: Gamepad) {
    const left = applyEditorStickDeadZone(
      gamepad.axes[AXIS_LEFT_X] ?? 0,
      gamepad.axes[AXIS_LEFT_Y] ?? 0,
      this.stickDeadZone,
    );
    const right = applyEditorStickDeadZone(
      gamepad.axes[AXIS_RIGHT_X] ?? 0,
      gamepad.axes[AXIS_RIGHT_Y] ?? 0,
      this.stickDeadZone,
    );
    return (
      Math.hypot(left.x, left.y) > 0 ||
      Math.hypot(right.x, right.y) > 0 ||
      buttonValue(gamepad, BUTTON_ZOOM_OUT) > 0.05 ||
      buttonValue(gamepad, BUTTON_ZOOM_IN) > 0.05 ||
      MAPPED_BUTTONS.some((button) => buttonPressed(gamepad, button))
    );
  }

  private readDpadDirection(gamepad: Gamepad): EditorFocusDirection | null {
    const horizontal =
      Number(buttonPressed(gamepad, BUTTON_DPAD_RIGHT)) -
      Number(buttonPressed(gamepad, BUTTON_DPAD_LEFT));
    const vertical =
      Number(buttonPressed(gamepad, BUTTON_DPAD_DOWN)) -
      Number(buttonPressed(gamepad, BUTTON_DPAD_UP));
    if (horizontal !== 0 || vertical !== 0) {
      if (Math.abs(horizontal) >= Math.abs(vertical)) {
        return horizontal < 0 ? "left" : "right";
      }
      return vertical < 0 ? "up" : "down";
    }
    return null;
  }

  private readMove(gamepad: Gamepad): EditorFocusDirection | null {
    const dpadDirection = this.readDpadDirection(gamepad);
    if (dpadDirection) return dpadDirection;
    const x = clamp(gamepad.axes[AXIS_LEFT_X] ?? 0);
    const y = clamp(gamepad.axes[AXIS_LEFT_Y] ?? 0);
    if (this.heldMove) {
      const heldValue =
        this.heldMove === "left" || this.heldMove === "right" ? x : y;
      const heldSign =
        this.heldMove === "left" || this.heldMove === "up" ? -1 : 1;
      if (
        Math.abs(heldValue) >= this.navigationReleaseThreshold &&
        Math.sign(heldValue) === heldSign
      ) {
        return this.heldMove;
      }
    }
    if (
      Math.max(Math.abs(x), Math.abs(y)) < this.navigationEntryThreshold
    ) {
      return null;
    }
    if (Math.abs(x) >= Math.abs(y)) {
      return x < 0 ? "left" : "right";
    }
    return y < 0 ? "up" : "down";
  }

  private readRepeatedMove(gamepad: Gamepad, nowMs: number) {
    const direction = this.readMove(gamepad);
    let move: EditorFocusDirection | null = null;
    if (direction !== this.heldMove) {
      this.heldMove = direction;
      if (direction) {
        move = direction;
        this.nextMoveRepeatAt = nowMs + this.repeatDelayMs;
      }
    } else if (direction && nowMs >= this.nextMoveRepeatAt) {
      move = direction;
      this.nextMoveRepeatAt = nowMs + this.repeatIntervalMs;
    }
    return move;
  }

  private readTransformDirection(gamepad: Gamepad, nowMs: number) {
    const direction = this.readDpadDirection(gamepad);
    let output: EditorFocusDirection | null = null;
    if (direction !== this.heldTransformDirection) {
      this.heldTransformDirection = direction;
      if (direction) {
        output = direction;
        this.nextTransformRepeatAt = nowMs + this.repeatDelayMs;
      }
    } else if (direction && nowMs >= this.nextTransformRepeatAt) {
      output = direction;
      this.nextTransformRepeatAt = nowMs + this.repeatIntervalMs;
    }
    return output;
  }

  private rememberButtons(gamepad: Gamepad) {
    MAPPED_BUTTONS.forEach((button) =>
      this.previousButtons.set(button, buttonPressed(gamepad, button)),
    );
  }

  private resetRetainedState() {
    this.heldMove = null;
    this.heldTransformDirection = null;
    this.nextMoveRepeatAt = 0;
    this.nextTransformRepeatAt = 0;
    this.previousButtons.clear();
  }

  private sampleUi(gamepad: Gamepad, nowMs: number) {
    this.heldTransformDirection = null;
    this.nextTransformRepeatAt = 0;
    return {
      ...NEUTRAL_ACTIONS,
      backRequested: this.edge(gamepad, BUTTON_BACK),
      confirmRequested: this.edge(gamepad, BUTTON_CONFIRM),
      helpRequested: this.edge(gamepad, BUTTON_HELP),
      move: this.readRepeatedMove(gamepad, nowMs),
    };
  }

  private sampleViewport(gamepad: Gamepad, nowMs: number) {
    this.heldMove = null;
    this.nextMoveRepeatAt = 0;
    const left = applyEditorStickDeadZone(
      gamepad.axes[AXIS_LEFT_X] ?? 0,
      gamepad.axes[AXIS_LEFT_Y] ?? 0,
      this.stickDeadZone,
    );
    const right = applyEditorStickDeadZone(
      gamepad.axes[AXIS_RIGHT_X] ?? 0,
      gamepad.axes[AXIS_RIGHT_Y] ?? 0,
      this.stickDeadZone,
    );
    const axisCycle: -1 | 0 | 1 = this.edge(gamepad, BUTTON_AXIS) ? 1 : 0;
    const toolCycle = (
      Number(this.edge(gamepad, BUTTON_TOOL_NEXT)) -
      Number(this.edge(gamepad, BUTTON_TOOL_PREVIOUS))
    ) as -1 | 0 | 1;
    return {
      ...NEUTRAL_ACTIONS,
      axisCycle,
      backRequested: this.edge(gamepad, BUTTON_BACK),
      confirmRequested: this.edge(gamepad, BUTTON_CONFIRM),
      frameRequested: this.edge(gamepad, BUTTON_FRAME),
      helpRequested: this.edge(gamepad, BUTTON_HELP),
      orbitX: right.x,
      orbitY: right.y,
      panX: left.x,
      panY: left.y,
      toolCycle,
      transformDirection: this.readTransformDirection(gamepad, nowMs),
      zoom:
        buttonValue(gamepad, BUTTON_ZOOM_IN) -
        buttonValue(gamepad, BUTTON_ZOOM_OUT),
    };
  }
}

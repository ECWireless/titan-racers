import type {
  ContinuousPlayerInput,
  PlayerInputSource,
  PlayerInputSourceSnapshot,
} from "./player-input";

type KeyboardEventTarget = Pick<
  Window,
  "addEventListener" | "removeEventListener"
>;

const HANDLED_KEYS = new Set([
  "ArrowUp",
  "ArrowDown",
  "ArrowLeft",
  "ArrowRight",
  "Escape",
  "KeyW",
  "KeyA",
  "KeyS",
  "KeyD",
  "KeyR",
  "ShiftLeft",
  "ShiftRight",
]);

const DRIVING_KEYS = new Set([
  "ArrowUp",
  "ArrowDown",
  "ArrowLeft",
  "ArrowRight",
  "KeyW",
  "KeyA",
  "KeyS",
  "KeyD",
  "ShiftLeft",
  "ShiftRight",
]);

export function isEditableKeyboardTarget(target: EventTarget | null) {
  if (!target || typeof target !== "object") {
    return false;
  }
  const element = target as {
    isContentEditable?: boolean;
    tagName?: string;
  };

  return (
    element.isContentEditable === true ||
    ["INPUT", "SELECT", "TEXTAREA"].includes(element.tagName ?? "")
  );
}

export class KeyboardInput implements PlayerInputSource {
  readonly pressedKeys = new Set<string>();
  private pauseRequested = false;
  private resetRequested = false;

  constructor(
    private readonly target: KeyboardEventTarget,
    private readonly onDrivingActivity: () => void = () => undefined,
  ) {}

  attach() {
    this.target.addEventListener("keydown", this.onKeyDown as EventListener);
    this.target.addEventListener("keyup", this.onKeyUp as EventListener);
  }

  detach() {
    this.target.removeEventListener("keydown", this.onKeyDown as EventListener);
    this.target.removeEventListener("keyup", this.onKeyUp as EventListener);
    this.clear();
  }

  clear() {
    this.pressedKeys.clear();
    this.pauseRequested = false;
    this.resetRequested = false;
  }

  getContinuousInput(): ContinuousPlayerInput {
    return {
      accelerate: Number(this.hasAny("ArrowUp", "KeyW")),
      brakeReverse: Number(this.hasAny("ArrowDown", "KeyS")),
      handbrake: Number(this.hasAny("ShiftLeft", "ShiftRight")),
      steer:
        Number(this.hasAny("ArrowRight", "KeyD")) -
        Number(this.hasAny("ArrowLeft", "KeyA")),
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

  private hasAny(...keys: string[]) {
    return keys.some((key) => this.pressedKeys.has(key));
  }

  private readonly onKeyDown = (event: KeyboardEvent) => {
    if (
      !HANDLED_KEYS.has(event.code) ||
      isEditableKeyboardTarget(event.target)
    ) {
      return;
    }

    event.preventDefault();

    if (event.repeat) {
      return;
    }

    if (event.code === "KeyR") {
      this.resetRequested = true;
      return;
    }

    if (event.code === "Escape") {
      this.pauseRequested = true;
      return;
    }

    if (!this.pressedKeys.has(event.code)) {
      this.pressedKeys.add(event.code);
      this.onDrivingActivity();
    }
  };

  private readonly onKeyUp = (event: KeyboardEvent) => {
    if (!HANDLED_KEYS.has(event.code)) {
      return;
    }

    if (!isEditableKeyboardTarget(event.target)) {
      event.preventDefault();
    }
    if (DRIVING_KEYS.has(event.code)) {
      this.pressedKeys.delete(event.code);
    }
  };
}

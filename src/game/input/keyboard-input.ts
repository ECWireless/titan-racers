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
  "KeyC",
  "KeyR",
  "ShiftLeft",
  "ShiftRight",
]);

// Keys held down, released on keyup.
const HELD_KEYS = new Set([
  "ArrowUp",
  "ArrowDown",
  "ArrowLeft",
  "ArrowRight",
  "KeyW",
  "KeyA",
  "KeyS",
  "KeyD",
  "KeyC",
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
      lookBehind: this.pressedKeys.has("KeyC"),
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
      isEditableKeyboardTarget(event.target) ||
      // Copy and other shortcuts stay the browser's.
      (event.code === "KeyC" &&
        (event.ctrlKey || event.metaKey || event.altKey))
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

    // Looking behind moves the camera, not the kart: it never takes driving
    // from another device.
    if (event.code === "KeyC") {
      this.pressedKeys.add(event.code);
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
    if (HELD_KEYS.has(event.code)) {
      this.pressedKeys.delete(event.code);
    }
  };
}

import type { DrivingInput } from "../contracts";

const HANDLED_KEYS = new Set([
  "ArrowUp",
  "ArrowDown",
  "ArrowLeft",
  "ArrowRight",
  "KeyW",
  "KeyA",
  "KeyS",
  "KeyD",
  "KeyR",
  "KeyF",
  "ShiftLeft",
  "ShiftRight",
]);

export class KeyboardInput {
  readonly pressedKeys = new Set<string>();

  constructor(
    private readonly target: Window,
    private readonly onReset: () => void,
    private readonly onFrameEditorSelection: () => void,
    private readonly isEditorMode: () => boolean,
  ) {}

  attach() {
    this.target.addEventListener("keydown", this.onKeyDown);
    this.target.addEventListener("keyup", this.onKeyUp);
  }

  detach() {
    this.target.removeEventListener("keydown", this.onKeyDown);
    this.target.removeEventListener("keyup", this.onKeyUp);
    this.clear();
  }

  clear() {
    this.pressedKeys.clear();
  }

  getDrivingInput(): DrivingInput {
    const throttle =
      Number(this.hasAny("ArrowUp", "KeyW")) -
      Number(this.hasAny("ArrowDown", "KeyS"));

    return {
      brake: throttle < 0 ? 1 : 0,
      reset: false,
      steer:
        Number(this.hasAny("ArrowLeft", "KeyA")) -
        Number(this.hasAny("ArrowRight", "KeyD")),
      throttle,
    };
  }

  getEditorMovement() {
    return {
      fast: this.hasAny("ShiftLeft", "ShiftRight"),
      lateral:
        Number(this.hasAny("ArrowRight", "KeyD")) -
        Number(this.hasAny("ArrowLeft", "KeyA")),
      forward:
        Number(this.hasAny("ArrowUp", "KeyW")) -
        Number(this.hasAny("ArrowDown", "KeyS")),
    };
  }

  private hasAny(...keys: string[]) {
    return keys.some((key) => this.pressedKeys.has(key));
  }

  private readonly onKeyDown = (event: KeyboardEvent) => {
    if (!HANDLED_KEYS.has(event.code)) {
      return;
    }

    event.preventDefault();

    if (event.code === "KeyR") {
      this.onReset();
      return;
    }

    if (event.code === "KeyF" && this.isEditorMode()) {
      this.onFrameEditorSelection();
      return;
    }

    this.pressedKeys.add(event.code);
  };

  private readonly onKeyUp = (event: KeyboardEvent) => {
    if (!HANDLED_KEYS.has(event.code)) {
      return;
    }

    event.preventDefault();
    this.pressedKeys.delete(event.code);
  };
}

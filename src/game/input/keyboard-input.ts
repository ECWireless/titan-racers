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
]);

export class KeyboardInput {
  readonly pressedKeys = new Set<string>();

  constructor(
    private readonly target: Window,
    private readonly onReset: () => void,
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

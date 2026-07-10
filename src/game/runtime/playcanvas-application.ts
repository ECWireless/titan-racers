import * as pc from "playcanvas";

import { FixedStepClock, type FixedStepFrame } from "./fixed-step-clock";

type EventTargetWithListeners = Pick<
  EventTarget,
  "addEventListener" | "removeEventListener"
>;

export type PlayCanvasRuntimeDependencies = {
  app?: pc.Application;
  cancelAnimationFrame?: (animationFrameId: number) => void;
  cancelApplicationTick?: (app: pc.Application) => void;
  requestAnimationFrame?: (callback: FrameRequestCallback) => number;
};

export class PlayCanvasRuntime {
  readonly app: pc.Application;
  private readonly cleanups: Array<() => void> = [];
  private readonly clock = new FixedStepClock();
  private readonly fixedStepListeners = new Set<(stepSeconds: number) => void>();
  private readonly renderListeners = new Set<(frame: FixedStepFrame) => void>();
  private readonly cancelAnimationFrame: (animationFrameId: number) => void;
  private readonly cancelApplicationTick: (app: pc.Application) => void;
  private readonly requestAnimationFrame: (
    callback: FrameRequestCallback,
  ) => number;
  private animationFrameId: number | null = null;
  private destroyed = false;
  private initialized = false;
  private lastFrameTimestamp: number | null = null;
  private paused = false;
  private started = false;

  constructor(
    canvas: HTMLCanvasElement,
    dependencies: PlayCanvasRuntimeDependencies = {},
  ) {
    this.app = dependencies.app ?? new pc.Application(canvas);
    this.cancelAnimationFrame =
      dependencies.cancelAnimationFrame ?? window.cancelAnimationFrame.bind(window);
    this.cancelApplicationTick =
      dependencies.cancelApplicationTick ?? pc.AppBase.cancelTick.bind(pc.AppBase);
    this.requestAnimationFrame =
      dependencies.requestAnimationFrame ?? window.requestAnimationFrame.bind(window);
    this.app.setCanvasResolution(pc.RESOLUTION_AUTO);
    this.app.setCanvasFillMode(pc.FILLMODE_FILL_WINDOW);
  }

  addCleanup(cleanup: () => void) {
    this.cleanups.push(cleanup);
  }

  onFixedStep(listener: (stepSeconds: number) => void) {
    this.fixedStepListeners.add(listener);
    this.addCleanup(() => this.fixedStepListeners.delete(listener));
  }

  onRender(listener: (frame: FixedStepFrame) => void) {
    this.renderListeners.add(listener);
    this.addCleanup(() => this.renderListeners.delete(listener));
  }

  setPaused(paused: boolean) {
    if (this.paused === paused) {
      return;
    }

    this.paused = paused;
    this.clock.reset();
    this.lastFrameTimestamp = null;
  }

  stepFixed(steps = 1) {
    if (!this.started || this.destroyed) {
      throw new Error("PlayCanvas runtime must be running before manual steps");
    }

    if (!this.paused) {
      throw new Error("Pause the PlayCanvas runtime before manual stepping");
    }

    if (!Number.isInteger(steps) || steps <= 0) {
      throw new Error("Manual step count must be a positive integer");
    }

    for (let step = 0; step < steps; step += 1) {
      this.executeFixedStep(this.clock.fixedStepSeconds);
    }

    const frame = {
      accumulatorFraction: 0,
      droppedSeconds: 0,
      frameSeconds: steps * this.clock.fixedStepSeconds,
      steps,
    } satisfies FixedStepFrame;

    this.renderListeners.forEach((listener) => listener(frame));
    this.app.render();
  }

  initialize() {
    if (this.destroyed) {
      throw new Error("Cannot initialize a destroyed PlayCanvas runtime");
    }

    if (this.initialized) {
      return;
    }

    this.initialized = true;
    this.app.start();
    this.cancelApplicationTick(this.app);

    const rigidBodySystem = this.app.systems.rigidbody;

    if (!rigidBodySystem) {
      throw new Error("PlayCanvas rigid-body system is unavailable");
    }

    rigidBodySystem.fixedTimeStep = this.clock.fixedStepSeconds;
    rigidBodySystem.maxSubSteps = 1;
  }

  start() {
    if (this.destroyed) {
      throw new Error("Cannot start a destroyed PlayCanvas runtime");
    }

    if (this.started) {
      return;
    }

    this.initialize();
    this.started = true;

    this.animationFrameId = this.requestAnimationFrame(this.runFrame);
  }

  listen<TEvent extends Event>(
    target: EventTargetWithListeners,
    type: string,
    listener: (event: TEvent) => void,
    options?: AddEventListenerOptions,
  ) {
    const eventListener = listener as EventListener;

    target.addEventListener(type, eventListener, options);
    this.addCleanup(() =>
      target.removeEventListener(type, eventListener, options),
    );
  }

  destroy() {
    if (this.destroyed) {
      return;
    }

    this.destroyed = true;

    if (this.animationFrameId !== null) {
      this.cancelAnimationFrame(this.animationFrameId);
      this.animationFrameId = null;
    }

    this.cleanups.splice(0).reverse().forEach((cleanup) => cleanup());
    this.app.destroy();
  }

  private readonly runFrame = (timestamp: number) => {
    if (this.destroyed) {
      return;
    }

    const frameSeconds =
      this.lastFrameTimestamp === null
        ? 0
        : (timestamp - this.lastFrameTimestamp) / 1000;
    this.lastFrameTimestamp = timestamp;

    if (this.paused) {
      this.app.render();
      this.animationFrameId = this.requestAnimationFrame(this.runFrame);
      return;
    }

    const frame = this.clock.advance(frameSeconds, (stepSeconds) => {
      this.executeFixedStep(stepSeconds);
    });

    this.renderListeners.forEach((listener) => listener(frame));
    this.app.render();
    this.animationFrameId = this.requestAnimationFrame(this.runFrame);
  };

  private executeFixedStep(stepSeconds: number) {
    this.fixedStepListeners.forEach((listener) => listener(stepSeconds));
    this.app.update(stepSeconds);
  }
}

let ammoLoadPromise: Promise<void> | null = null;

export function loadAmmoPhysics() {
  if (ammoLoadPromise) {
    return ammoLoadPromise;
  }

  ammoLoadPromise = new Promise<void>((resolve, reject) => {
    pc.WasmModule.setConfig("Ammo", {
      fallbackUrl: "/vendor/ammo/ammo.js",
      glueUrl: "/vendor/ammo/ammo.wasm.js",
      wasmUrl: "/vendor/ammo/ammo.wasm.wasm",
      errorHandler: (error) => {
        ammoLoadPromise = null;
        reject(new Error(`Unable to load Ammo physics: ${error}`));
      },
    });
    pc.WasmModule.getInstance("Ammo", () => resolve());
  });

  return ammoLoadPromise;
}

export function createPlayCanvasRuntime(canvas: HTMLCanvasElement) {
  return new PlayCanvasRuntime(canvas);
}

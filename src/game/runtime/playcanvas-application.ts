import * as pc from "playcanvas";

type EventTargetWithListeners = Pick<
  EventTarget,
  "addEventListener" | "removeEventListener"
>;

export class PlayCanvasRuntime {
  readonly app: pc.Application;
  private readonly cleanups: Array<() => void> = [];

  constructor(canvas: HTMLCanvasElement) {
    this.app = new pc.Application(canvas);
    this.app.setCanvasResolution(pc.RESOLUTION_AUTO);
    this.app.setCanvasFillMode(pc.FILLMODE_FILL_WINDOW);
    this.app.start();
  }

  addCleanup(cleanup: () => void) {
    this.cleanups.push(cleanup);
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
    this.cleanups.splice(0).reverse().forEach((cleanup) => cleanup());
    this.app.destroy();
  }
}

export function createPlayCanvasRuntime(canvas: HTMLCanvasElement) {
  return new PlayCanvasRuntime(canvas);
}

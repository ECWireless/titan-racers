import { expect, test } from "@playwright/test";
import type * as pc from "playcanvas";

import { PlayCanvasRuntime } from "../src/game/runtime/playcanvas-application";

function createRuntimeHarness() {
  const events: string[] = [];
  const scheduledFrames = new Map<number, FrameRequestCallback>();
  const cancelledFrames: number[] = [];
  let nextFrameId = 1;
  const rigidbody = {
    fixedTimeStep: 0,
    maxSubSteps: 0,
  };
  const app = {
    destroy: () => events.push("destroy"),
    render: () => events.push("render"),
    setCanvasFillMode: () => undefined,
    setCanvasResolution: () => undefined,
    start: () => events.push("start"),
    systems: { rigidbody },
    update: () => events.push("update"),
  } as unknown as pc.Application;
  const runtime = new PlayCanvasRuntime({} as HTMLCanvasElement, {
    app,
    cancelAnimationFrame: (animationFrameId) => {
      cancelledFrames.push(animationFrameId);
      scheduledFrames.delete(animationFrameId);
    },
    cancelApplicationTick: () => events.push("cancel-default-tick"),
    requestAnimationFrame: (callback) => {
      const animationFrameId = nextFrameId;

      nextFrameId += 1;
      scheduledFrames.set(animationFrameId, callback);

      return animationFrameId;
    },
  });

  function runNextFrame(timestamp: number) {
    const nextFrame = scheduledFrames.entries().next().value as
      [number, FrameRequestCallback] | undefined;

    if (!nextFrame) {
      throw new Error("Expected a scheduled animation frame");
    }

    scheduledFrames.delete(nextFrame[0]);
    nextFrame[1](timestamp);
  }

  return {
    cancelledFrames,
    events,
    rigidbody,
    runNextFrame,
    runtime,
    scheduledFrames,
  };
}

test("advances one whole-world update per outer fixed step before rendering", () => {
  const { events, rigidbody, runNextFrame, runtime } = createRuntimeHarness();

  runtime.onFixedStep(() => events.push("fixed-listener"));
  runtime.onRender(() => events.push("render-listener"));
  runtime.start();

  expect(events).toEqual(["start", "cancel-default-tick"]);
  expect(rigidbody.fixedTimeStep).toBeCloseTo(1 / 60);
  expect(rigidbody.maxSubSteps).toBe(1);

  runNextFrame(0);
  events.length = 0;
  runNextFrame(1000 / 30);

  expect(events).toEqual([
    "fixed-listener",
    "update",
    "fixed-listener",
    "update",
    "render-listener",
    "render",
  ]);
});

test("manual stepping advances exact updates and renders once", () => {
  const { events, runtime } = createRuntimeHarness();

  runtime.onFixedStep(() => events.push("fixed-listener"));
  runtime.onRender(() => events.push("render-listener"));
  runtime.start();
  runtime.setPaused(true);
  events.length = 0;
  runtime.stepFixed(3);

  expect(events).toEqual([
    "fixed-listener",
    "update",
    "fixed-listener",
    "update",
    "fixed-listener",
    "update",
    "render-listener",
    "render",
  ]);
});

test("runs post-step listeners after the whole-world update", () => {
  const { events, runtime } = createRuntimeHarness();

  runtime.onFixedStep(() => events.push("fixed-listener"));
  runtime.onPostFixedStep(() => events.push("post-fixed-listener"));
  runtime.start();
  runtime.setPaused(true);
  events.length = 0;
  runtime.stepFixed(1);

  expect(events).toEqual([
    "fixed-listener",
    "update",
    "post-fixed-listener",
    "render",
  ]);
});

test("reports discarded active time after fixed steps and before rendering", () => {
  const { events, runNextFrame, runtime } = createRuntimeHarness();

  runtime.onFixedStep(() => events.push("fixed-listener"));
  runtime.onPostFixedStep(() => events.push("post-fixed-listener"));
  runtime.onDiscardedTime((seconds) =>
    events.push(`discarded-${seconds.toFixed(3)}`),
  );
  runtime.onRender(() => events.push("render-listener"));
  runtime.start();
  runNextFrame(0);
  events.length = 0;

  runNextFrame(500);

  expect(events).toEqual([
    "fixed-listener",
    "update",
    "post-fixed-listener",
    "fixed-listener",
    "update",
    "post-fixed-listener",
    "fixed-listener",
    "update",
    "post-fixed-listener",
    "fixed-listener",
    "update",
    "post-fixed-listener",
    "discarded-0.433",
    "render-listener",
    "render",
  ]);
});

test("pauses on one completed fixed-step boundary without extra catch-up", () => {
  const { events, runNextFrame, runtime } = createRuntimeHarness();

  runtime.onFixedStep(() => {
    events.push("fixed-listener");
    runtime.requestPauseAtFixedStepBoundary();
  });
  runtime.onPostFixedStep(() => events.push("post-fixed-listener"));
  runtime.onDiscardedTime(() => events.push("discarded"));
  runtime.onRender(() => events.push("render-listener"));
  runtime.start();
  runNextFrame(0);
  events.length = 0;

  runNextFrame(1000 / 15);

  expect(events).toEqual([
    "fixed-listener",
    "update",
    "post-fixed-listener",
    "render-listener",
    "render",
  ]);
  expect(() => runtime.stepFixed(1)).not.toThrow();
});

test("destroy cancels the frame and releases listeners exactly once", () => {
  const { cancelledFrames, events, runtime, scheduledFrames } =
    createRuntimeHarness();
  const target = new EventTarget();
  let handledEvents = 0;

  runtime.listen(target, "runtime-test", () => {
    handledEvents += 1;
  });
  runtime.start();
  target.dispatchEvent(new Event("runtime-test"));

  runtime.destroy();
  runtime.destroy();
  target.dispatchEvent(new Event("runtime-test"));

  expect(handledEvents).toBe(1);
  expect(cancelledFrames).toEqual([1]);
  expect(scheduledFrames.size).toBe(0);
  expect(events.filter((event) => event === "destroy")).toHaveLength(1);
});

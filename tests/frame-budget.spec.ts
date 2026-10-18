import { expect, test } from "@playwright/test";

import { FrameBudgetRecorder } from "../src/game/runtime/frame-budget";

test.describe("frame budget recorder", () => {
  test("summarizes intervals, work, hitches, and draw calls", () => {
    const recorder = new FrameBudgetRecorder();
    expect(recorder.summarize()).toBeNull();

    for (let frame = 0; frame < 20; frame += 1) {
      recorder.record({
        drawCalls: 100 + frame,
        forwardDrawCalls: 80,
        frameIntervalMs: frame === 0 ? null : frame === 19 ? 60 : 16,
        shadowDrawCalls: 20 + frame,
        shadowMapUpdates: 1,
        workMs: frame + 1,
      });
    }

    expect(recorder.summarize()).toEqual({
      drawCalls: { maximum: 119, median: 109 },
      forwardDrawCalls: { maximum: 80 },
      frameIntervalMs: { median: 16, p95: 60 },
      frames: 20,
      hitches: 1,
      shadowDrawCalls: { maximum: 39 },
      shadowMapUpdates: { median: 1 },
      workMs: { median: 10, p95: 19 },
    });

    recorder.reset();
    expect(recorder.summarize()).toBeNull();
  });
});

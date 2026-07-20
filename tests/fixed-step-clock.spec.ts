import { expect, test } from "@playwright/test";

import { FixedStepClock } from "../src/game/runtime/fixed-step-clock";

test.describe("fixed-step clock", () => {
  test("produces the same 120 simulation steps at common render cadences", () => {
    for (const renderRate of [30, 60, 120]) {
      const clock = new FixedStepClock();
      let steps = 0;

      for (let frame = 0; frame < renderRate; frame += 1) {
        clock.advance(1 / renderRate, () => {
          steps += 1;
        });
      }

      expect(steps).toBe(120);
    }
  });

  test("caps catch-up work and reports discarded time", () => {
    const clock = new FixedStepClock({
      fixedStepSeconds: 1 / 60,
      maxCatchUpSteps: 4,
      maxFrameSeconds: 1,
    });
    let steps = 0;

    const frame = clock.advance(0.5, () => {
      steps += 1;
    });

    expect(steps).toBe(4);
    expect(frame.steps).toBe(4);
    expect(frame.droppedFrameSeconds).toBeCloseTo(26 / 60, 8);
    expect(frame.droppedSeconds).toBeCloseTo(26 / 60, 8);
    expect(frame.accumulatorFraction).toBeCloseTo(0, 8);
  });

  test("clamps stalls before they enter the accumulator", () => {
    const clock = new FixedStepClock({ maxFrameSeconds: 0.1 });
    let steps = 0;

    const frame = clock.advance(2, () => {
      steps += 1;
    });

    expect(steps).toBe(8);
    expect(frame.droppedFrameSeconds).toBeGreaterThan(1.9);
    expect(frame.droppedSeconds).toBeGreaterThan(1.9);
    expect(frame.accumulatorFraction).toBeLessThan(1);
  });

  test("reports per-frame drops separately from the cumulative total", () => {
    const clock = new FixedStepClock({
      fixedStepSeconds: 0.1,
      maxCatchUpSteps: 1,
      maxFrameSeconds: 1,
    });

    const first = clock.advance(0.3, () => undefined);
    const second = clock.advance(0.2, () => undefined);

    expect(first.droppedFrameSeconds).toBeCloseTo(0.2);
    expect(first.droppedSeconds).toBeCloseTo(0.2);
    expect(second.droppedFrameSeconds).toBeCloseTo(0.1);
    expect(second.droppedSeconds).toBeCloseTo(0.3);
  });

  test("stops catch-up without treating paused accumulator time as discarded", () => {
    const clock = new FixedStepClock({
      fixedStepSeconds: 0.1,
      maxCatchUpSteps: 4,
      maxFrameSeconds: 1,
    });
    let steps = 0;

    const frame = clock.advance(0.4, () => {
      steps += 1;
      return false;
    });

    expect(steps).toBe(1);
    expect(frame.steps).toBe(1);
    expect(frame.droppedFrameSeconds).toBe(0);
    expect(frame.droppedSeconds).toBe(0);
    expect(frame.accumulatorFraction).toBe(0);

    const resumedFrame = clock.advance(0, () => {
      steps += 1;
    });

    expect(steps).toBe(1);
    expect(resumedFrame.steps).toBe(0);
  });
});

import type * as pc from "playcanvas";

/** One rendered animation frame, measured for the phone performance budget. */
export type FrameBudgetSample = {
  drawCalls: number;
  forwardDrawCalls: number;
  /** Interval since the previous rendered frame; null after a gap. */
  frameIntervalMs: number | null;
  shadowDrawCalls: number;
  shadowMapUpdates: number;
  /** Main-thread time spent in fixed steps, update, and render submit. */
  workMs: number;
};

export type FrameBudgetSummary = {
  drawCalls: { maximum: number; median: number };
  forwardDrawCalls: { maximum: number };
  frameIntervalMs: { median: number; p95: number };
  frames: number;
  hitches: number;
  shadowDrawCalls: { maximum: number };
  shadowMapUpdates: { median: number };
  workMs: { median: number; p95: number };
};

const FRAME_BUDGET_HITCH_MS = 50;

type FrameCounters = {
  device: { _drawCallsPerFrame: number };
  renderer: {
    _forwardDrawCalls: number;
    _shadowDrawCalls: number;
    _shadowMapUpdates: number;
  };
};

/**
 * Reads and clears PlayCanvas's per-frame counters. The engine only resets
 * them inside its own tick, which the fixed-step runtime replaces.
 */
export function takeFrameCounters(app: pc.Application) {
  const { device, renderer } = {
    device: app.graphicsDevice,
    renderer: app.renderer,
  } as unknown as FrameCounters;
  const counters = {
    drawCalls: device._drawCallsPerFrame,
    forwardDrawCalls: renderer._forwardDrawCalls,
    shadowDrawCalls: renderer._shadowDrawCalls,
    shadowMapUpdates: renderer._shadowMapUpdates,
  };
  device._drawCallsPerFrame = 0;
  renderer._forwardDrawCalls = 0;
  renderer._shadowDrawCalls = 0;
  renderer._shadowMapUpdates = 0;
  return counters;
}

export class FrameBudgetRecorder {
  private samples: FrameBudgetSample[] = [];

  record(sample: FrameBudgetSample) {
    this.samples.push(sample);
  }

  reset() {
    this.samples = [];
  }

  summarize(): FrameBudgetSummary | null {
    if (this.samples.length === 0) return null;
    const intervals = sorted(
      this.samples.flatMap(({ frameIntervalMs }) =>
        frameIntervalMs === null ? [] : [frameIntervalMs],
      ),
    );
    const work = sorted(this.samples.map(({ workMs }) => workMs));
    const drawCalls = sorted(this.samples.map(({ drawCalls }) => drawCalls));
    return {
      drawCalls: {
        maximum: drawCalls[drawCalls.length - 1],
        median: percentile(drawCalls, 0.5),
      },
      forwardDrawCalls: { maximum: this.maximum("forwardDrawCalls") },
      frameIntervalMs: {
        median: percentile(intervals, 0.5),
        p95: percentile(intervals, 0.95),
      },
      frames: this.samples.length,
      hitches: intervals.filter((interval) => interval > FRAME_BUDGET_HITCH_MS)
        .length,
      shadowDrawCalls: { maximum: this.maximum("shadowDrawCalls") },
      shadowMapUpdates: {
        median: percentile(
          sorted(this.samples.map((sample) => sample.shadowMapUpdates)),
          0.5,
        ),
      },
      workMs: { median: percentile(work, 0.5), p95: percentile(work, 0.95) },
    };
  }

  private maximum(key: "forwardDrawCalls" | "shadowDrawCalls") {
    return this.samples.reduce(
      (maximum, sample) => Math.max(maximum, sample[key]),
      0,
    );
  }
}

function sorted(values: number[]) {
  return values.sort((a, b) => a - b);
}

/** Nearest-rank percentile of ascending values; 0 when empty. */
function percentile(ascending: number[], fraction: number) {
  if (ascending.length === 0) return 0;
  const rank = Math.ceil(fraction * ascending.length);
  return ascending[Math.min(ascending.length, Math.max(1, rank)) - 1];
}

import { expect, test } from "@playwright/test";

import {
  decodeGhostTrace,
  encodeGhostTrace,
  GHOST_STEPS_PER_SAMPLE,
  GhostRecorder,
  type GhostSample,
  GhostTraceFormatError,
  ghostTraceFromBase64,
  ghostTraceToBase64,
  MAX_GHOST_SAMPLES,
} from "../src/game/ghost/ghost-trace";

const STEP_MICROSECONDS = 1_000_000 / 120;
const HEADER = 8;

function yawQuaternion(radians: number) {
  return { w: Math.cos(radians / 2), x: 0, y: Math.sin(radians / 2), z: 0 };
}

function sample(index: number, overrides: Partial<GhostSample> = {}): GhostSample {
  return {
    gate: false,
    position: { x: 30 + index * 0.73, y: -0.125 + index * 0.001, z: -45 - index * 0.31 },
    reset: false,
    rotation: yawQuaternion(index * 0.05 - 1.5),
    // Real steering: 18° at rest, a few degrees at speed.
    steerDegrees: Math.sin(index) * 18,
    timeMicroseconds: Math.round(index * GHOST_STEPS_PER_SAMPLE * STEP_MICROSECONDS),
    ...overrides,
  };
}

function rotationAngle(
  a: GhostSample["rotation"],
  b: GhostSample["rotation"],
) {
  const dot = Math.abs(a.w * b.w + a.x * b.x + a.y * b.y + a.z * b.z);
  return 2 * Math.acos(Math.min(1, dot));
}

test.describe("ghost trace format", () => {
  test("round-trips a race within its quantization", () => {
    const tilted = { w: -0.5, x: 0.5, y: -0.5, z: 0.5 };
    const original = [
      sample(0),
      sample(1, { gate: true, steerDegrees: 3.1 }),
      sample(2, { reset: true, rotation: tilted }),
      sample(3, { steerDegrees: 70 }),
    ];
    const decoded = decodeGhostTrace(
      ghostTraceFromBase64(ghostTraceToBase64(encodeGhostTrace(original))),
    );

    expect(decoded).toHaveLength(4);
    decoded.forEach((decodedSample, index) => {
      const source = original[index];
      expect(decodedSample.timeMicroseconds).toBe(source.timeMicroseconds);
      expect(decodedSample.gate).toBe(source.gate);
      expect(decodedSample.reset).toBe(source.reset);
      for (const axis of ["x", "y", "z"] as const) {
        expect(Math.abs(decodedSample.position[axis] - source.position[axis])).toBeLessThanOrEqual(0.0005);
      }
      // Well under a tenth of a degree.
      expect(rotationAngle(decodedSample.rotation, source.rotation)).toBeLessThan(0.0015);
    });
    // Steering keeps about a third of a degree of resolution.
    expect(Math.abs(decoded[1].steerDegrees - 3.1)).toBeLessThan(0.2);
    expect(Math.abs(decoded[2].steerDegrees - original[2].steerDegrees)).toBeLessThan(0.2);
    // Steering beyond the stored range clamps to its end.
    expect(decoded[3].steerDegrees).toBeCloseTo(45, 6);
  });

  test("keeps a two-lap race small", () => {
    // Ninety seconds at 20 Hz plus fourteen gate samples.
    const samples = Array.from({ length: 90 * 20 + 14 }, (_, index) => sample(index));
    const bytes = encodeGhostTrace(samples);
    expect(bytes.byteLength).toBe(HEADER + samples.length * 24);
    expect(bytes.byteLength).toBeLessThan(45_000);
  });

  test("rejects malformed or out-of-range ghosts", () => {
    const valid = encodeGhostTrace([sample(0), sample(1)]);
    const corrupt = (edit: (bytes: Uint8Array, view: DataView) => void) => {
      const bytes = valid.slice();
      edit(bytes, new DataView(bytes.buffer));
      return bytes;
    };
    for (const bytes of [
      new Uint8Array(4),
      corrupt((bytes) => {
        bytes[0] = 0x58;
      }),
      corrupt((_, view) => view.setUint8(3, 2)),
      corrupt((_, view) => view.setUint32(4, 3, true)),
      corrupt((_, view) => view.setUint32(4, 0, true)),
      corrupt((_, view) => view.setUint32(4, MAX_GHOST_SAMPLES + 1, true)),
      valid.slice(0, valid.length - 1),
      // The second sample's time goes backwards.
      corrupt((_, view) => {
        view.setUint32(HEADER, 9, true);
        view.setUint32(HEADER + 24, 0, true);
      }),
      corrupt((_, view) => view.setUint8(HEADER + 22, 0b1_0000)),
      corrupt((_, view) => {
        for (const slot of [0, 1, 2]) view.setInt16(HEADER + 16 + slot * 2, 32_767, true);
      }),
    ]) {
      expect(() => decodeGhostTrace(bytes)).toThrow(GhostTraceFormatError);
    }
    expect(() => ghostTraceFromBase64("not base64!")).toThrow(GhostTraceFormatError);
    expect(() => ghostTraceFromBase64("A".repeat(2_000_000))).toThrow(GhostTraceFormatError);

    expect(() => encodeGhostTrace([])).toThrow(GhostTraceFormatError);
    expect(() => encodeGhostTrace([sample(1), sample(0)])).toThrow(GhostTraceFormatError);
    expect(() => encodeGhostTrace([sample(0, { timeMicroseconds: -1 })])).toThrow(
      GhostTraceFormatError,
    );
    expect(() =>
      encodeGhostTrace([sample(0, { position: { x: Number.NaN, y: 0, z: 0 } })]),
    ).toThrow(GhostTraceFormatError);
    expect(() =>
      encodeGhostTrace([sample(0, { rotation: { w: 0, x: 0, y: 0, z: 0 } })]),
    ).toThrow(GhostTraceFormatError);
  });
});

test.describe("ghost recorder", () => {
  const step = (recorder: GhostRecorder, index: number, crossedGate = false) =>
    recorder.recordStep(
      Math.round(index * STEP_MICROSECONDS),
      { x: index, y: 0, z: 0 },
      yawQuaternion(0),
      0,
      crossedGate,
    );

  test("samples every sixth step, both sides of a gate, and after a reset", () => {
    const recorder = new GhostRecorder();
    for (let index = 0; index < 14; index += 1) {
      if (index === 9) recorder.markReset();
      // Gate 3 follows an unsampled step; gate 7 follows a sampled one.
      step(recorder, index, index === 3 || index === 7);
    }
    const recorded = recorder.finish();
    expect(recorded?.map(({ position }) => position.x)).toEqual([0, 2, 3, 6, 7, 9, 12]);
    expect(recorded?.map(({ gate }) => gate)).toEqual([
      false, false, true, false, true, false, false,
    ]);
    expect(recorded?.map(({ reset }) => reset)).toEqual([
      false, false, false, false, false, true, false,
    ]);
    expect(recorded?.[1].timeMicroseconds).toBe(Math.round(2 * STEP_MICROSECONDS));

    recorder.reset();
    expect(recorder.finish()).toBeNull();
  });

  test("gives up on a race too long to keep", () => {
    const recorder = new GhostRecorder(1);
    for (let index = 0; index <= MAX_GHOST_SAMPLES; index += 1) step(recorder, index);
    expect(recorder.finish()).toBeNull();
  });
});

import { expect, test } from "@playwright/test";

import { createGhostPose, GhostPlayback } from "../src/game/ghost/ghost-playback";
import type { GhostSample } from "../src/game/ghost/ghost-trace";

const IDENTITY = { w: 1, x: 0, y: 0, z: 0 };

function sample(
  timeMicroseconds: number,
  x: number,
  overrides: Partial<GhostSample> = {},
): GhostSample {
  return {
    gate: false,
    position: { x, y: 0, z: 0 },
    reset: false,
    rotation: IDENTITY,
    steerDegrees: 0,
    timeMicroseconds,
    ...overrides,
  };
}

// Ten metres per second, sampled at 20 Hz plus an uneven gate pair.
const STEADY = [
  sample(0, 0),
  sample(50_000, 0.5),
  sample(100_000, 1),
  sample(141_667, 1.41667),
  sample(150_000, 1.5, { gate: true }),
  sample(200_000, 2),
];

test.describe("ghost playback", () => {
  test("waits at the start, follows steady motion exactly, and leaves at the finish", () => {
    const playback = new GhostPlayback(STEADY);
    const pose = createGhostPose();

    expect(playback.sample(0, pose)?.position.x).toBe(0);
    for (const time of [25_000, 75_000, 120_000, 145_000, 175_000]) {
      const at = playback.sample(time, pose);
      expect(at?.position.x).toBeCloseTo(time / 100_000, 4);
      expect(at?.speed).toBeCloseTo(10, 2);
    }
    expect(playback.sample(200_000, pose)?.position.x).toBeCloseTo(2, 6);
    expect(playback.sample(200_001, pose)).toBeNull();
    expect(playback.finishMicroseconds).toBe(200_000);

    // Race again rewinds the clock.
    expect(playback.sample(30_000, pose)?.position.x).toBeCloseTo(0.3, 4);
  });

  test("passes through every sample on a curve", () => {
    const curve = Array.from({ length: 8 }, (_, index) =>
      sample(index * 50_000, Math.sin(index * 0.6) * 4, {
        position: { x: Math.sin(index * 0.6) * 4, y: 0, z: Math.cos(index * 0.6) * 4 },
      }),
    );
    const playback = new GhostPlayback(curve);
    const pose = createGhostPose();
    for (const recorded of curve) {
      const at = playback.sample(recorded.timeMicroseconds, pose);
      expect(at?.position.x).toBeCloseTo(recorded.position.x, 6);
      expect(at?.position.z).toBeCloseTo(recorded.position.z, 6);
    }
    // Between samples it stays near the circle the samples lie on.
    const between = playback.sample(125_000, pose);
    expect(Math.hypot(between!.position.x, between!.position.z)).toBeCloseTo(4, 1);
  });

  test("holds before a reset and jumps without blending", () => {
    const playback = new GhostPlayback([
      sample(0, 0),
      sample(50_000, 0.5),
      sample(1_000_000, 30, { reset: true }),
      sample(1_050_000, 30.4),
    ]);
    const pose = createGhostPose();
    expect(playback.sample(60_000, pose)?.position.x).toBe(0.5);
    expect(playback.sample(999_999, pose)?.position.x).toBe(0.5);
    expect(playback.sample(1_000_000, pose)?.position.x).toBe(30);
    // The segment after the reset ignores the pose from before it.
    expect(playback.sample(1_025_000, pose)?.position.x).toBeCloseTo(30.2, 4);
  });

  test("blends rotation and steering along the shorter way", () => {
    const quarterTurn = { w: Math.SQRT1_2, x: 0, y: Math.SQRT1_2, z: 0 };
    const negated = { w: -quarterTurn.w, x: 0, y: -quarterTurn.y, z: 0 };
    const playback = new GhostPlayback([
      sample(0, 0, { steerDegrees: -10 }),
      sample(50_000, 0, { rotation: negated, steerDegrees: 10 }),
    ]);
    const pose = createGhostPose();
    const halfway = playback.sample(25_000, pose)!;
    // An eighth of a turn about Y, whichever sign the sample was stored with.
    expect(Math.abs(halfway.rotation.y)).toBeCloseTo(Math.sin(Math.PI / 8), 3);
    expect(Math.abs(halfway.rotation.w)).toBeCloseTo(Math.cos(Math.PI / 8), 3);
    expect(halfway.steerDegrees).toBeCloseTo(0, 6);
  });
});

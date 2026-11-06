import { expect, test } from "@playwright/test";

import { createGhostPose } from "../src/game/ghost/ghost-playback";
import {
  OPPONENT_MOTION,
  OpponentMotion,
  type OpponentState,
} from "../src/game/room/opponent-motion";
import { OpponentTracks } from "../src/game/room/room-race";

const FRAME_MS = 1_000 / 60;
const STATE_MS = 1_000 / 30;
const SPEED = 10;

/** A kart driving along x at 10 m/s, unless told otherwise. */
function state(
  tMs: number,
  x = (tMs / 1_000) * SPEED,
  extra: Partial<OpponentState> = {},
): OpponentState {
  return {
    t: Math.round(tMs * 1_000),
    position: { x, y: 0, z: 0 },
    rotation: { w: 1, x: 0, y: 0, z: 0 },
    velocity: { x: SPEED, y: 0, z: 0 },
    steerDegrees: 0,
    reset: false,
    ...extra,
  };
}

type Delivery = { state: OpponentState; atMs: number };

/**
 * Draws frames from `fromMs` to `toMs` of room time, delivering each state
 * when it arrives; `clock` can shift the room's clock estimate. Returns
 * each frame's room time and drawn x.
 */
function drive(
  motion: OpponentMotion,
  deliveries: Delivery[],
  fromMs: number,
  toMs: number,
  clock: (ms: number) => number = (ms) => ms,
  frameMs: (ms: number) => number = () => FRAME_MS,
) {
  const pending = [...deliveries].sort((a, b) => a.atMs - b.atMs);
  const pose = createGhostPose();
  const frames: Array<{
    ms: number;
    x: number;
    drawnMs: number;
    starved: boolean;
  }> = [];
  let lastMs = fromMs - FRAME_MS;
  for (let ms = fromMs; ms <= toMs; ms += frameMs(ms)) {
    while (pending[0] && pending[0].atMs <= ms) {
      motion.add(pending.shift()!.state, clock(ms) * 1_000);
    }
    const starvedBefore = motion.starvedFrames;
    const drawn = motion.pose(clock(ms) * 1_000, (ms - lastMs) / 1_000, pose);
    lastMs = ms;
    if (drawn) {
      frames.push({
        ms,
        x: drawn.position.x,
        drawnMs: clock(ms) - motion.drawnDelayUs / 1_000,
        starved: motion.starvedFrames > starvedBefore,
      });
    }
  }
  return frames;
}

function stream(fromMs: number, toMs: number, lateMs: (tMs: number) => number) {
  const deliveries: Delivery[] = [];
  for (let tMs = fromMs; tMs <= toMs; tMs += STATE_MS) {
    deliveries.push({ state: state(tMs), atMs: tMs + lateMs(tMs) });
  }
  return deliveries;
}

function steps(frames: Array<{ x: number }>) {
  return frames.slice(1).map(({ x }, index) => x - frames[index].x);
}

const NOMINAL_STEP = (SPEED * FRAME_MS) / 1_000;

test.describe("opponent motion", () => {
  test("draws timely states on their path, at the shortest delay", () => {
    const motion = new OpponentMotion();
    const frames = drive(motion, stream(0, 3_000, () => 30), 0, 3_000);
    expect(motion.delayUs).toBe(OPPONENT_MOTION.minDelayUs);
    for (const { ms, x } of frames.filter(({ ms }) => ms > 500)) {
      expect(x).toBeCloseTo(((ms - 100) / 1_000) * SPEED, 3);
    }
    expect(motion.starvedFrames).toBeLessThan(10);
  });

  test("waits longer for late, bunched states, and eases to it", () => {
    const motion = new OpponentMotion();
    // States arrive in bunches every 200 ms, the oldest 230 ms late.
    const frames = drive(
      motion,
      stream(0, 6_000, (tMs) => 30 + (200 - (tMs % 200))),
      0,
      5_000,
    );
    expect(motion.delayUs).toBeGreaterThan(200_000);
    expect(motion.delayUs).toBeLessThanOrEqual(OPPONENT_MOTION.maxDelayUs);
    // Settled, it never runs out, and moves evenly: at most 10% off pace.
    const settled = frames.filter(({ ms }) => ms > 2_500);
    expect(settled.filter(({ starved }) => starved)).toHaveLength(0);
    for (const step of steps(settled)) {
      expect(step).toBeGreaterThan(NOMINAL_STEP * 0.89);
      expect(step).toBeLessThan(NOMINAL_STEP * 1.11);
    }
  });

  test("carries on briefly past its newest state, then blends back", () => {
    const motion = new OpponentMotion();
    // On time to 1 s, then nothing for 400 ms; the kart had slowed to
    // 5 m/s meanwhile, which the late states show.
    const deliveries = stream(0, 1_000, () => 30);
    for (let tMs = 1_000 + STATE_MS; tMs <= 2_000; tMs += STATE_MS) {
      deliveries.push({
        state: state(tMs, SPEED + ((tMs - 1_000) / 1_000) * 5, {
          velocity: { x: 5, y: 0, z: 0 },
        }),
        atMs: Math.max(tMs + 30, 1_430),
      });
    }
    const frames = drive(motion, deliveries, 0, 2_000);
    expect(motion.starvedFrames).toBeGreaterThan(5);
    // It slows to a stop half of 100 ms on from its newest state...
    for (const { x } of frames.filter(({ ms }) => ms < 1_430)) {
      expect(x).toBeLessThanOrEqual(SPEED + 0.5 + 1e-9);
    }
    // ...never jumps when the late states land (a metre's correction over
    // 150 ms, not a snap), and is soon back on them.
    for (const step of steps(frames)) expect(Math.abs(step)).toBeLessThan(0.4);
    const back = frames.filter(({ ms }) => ms > 1_430 + 150);
    expect(back.length).toBeGreaterThan(10);
    for (const { x, drawnMs } of back) {
      expect(x).toBeCloseTo(SPEED + ((drawnMs - 1_000) / 1_000) * 5, 3);
    }
  });

  test("snaps through a reset rather than sliding there", () => {
    const motion = new OpponentMotion();
    const deliveries = stream(0, 1_000, () => 30);
    deliveries.push({
      state: state(1_000 + STATE_MS, -50, {
        reset: true,
        velocity: { x: 0, y: 0, z: 0 },
      }),
      atMs: 1_000 + STATE_MS + 30,
    });
    const frames = drive(motion, deliveries, 0, 1_400);
    const jumps = steps(frames).filter((step) => Math.abs(step) > 1);
    expect(jumps).toHaveLength(1);
    expect(frames.at(-1)!.x).toBe(-50);
  });

  test("eases a jump in the room's clock, either way, rather than jumping", () => {
    for (const shiftMs of [200, -200]) {
      const motion = new OpponentMotion();
      const frames = drive(
        motion,
        stream(0, 8_000, () => 30),
        0,
        8_000,
        // The clock estimate improves by 200 ms at 1.5 s; one 200 ms ahead
        // made states look late, which holds the delay up for 3 s.
        (ms) => (ms < 1_500 ? ms - shiftMs : ms),
      );
      for (const step of steps(frames.filter(({ ms }) => ms > 500))) {
        expect(step).toBeGreaterThan(NOMINAL_STEP * 0.89);
        expect(step).toBeLessThan(NOMINAL_STEP * 1.11);
      }
      // And it settles at its delay again.
      expect(Math.abs(motion.drawnDelayUs - motion.delayUs)).toBeLessThan(
        2_000,
      );
    }
  });

  test("keeps to the clock through a hitch on this page", () => {
    const motion = new OpponentMotion();
    drive(
      motion,
      stream(0, 3_000, () => 30),
      0,
      1_000 + 400 + FRAME_MS,
      undefined,
      // One 400 ms frame at 1 s.
      (ms) => (ms > 1_000 && ms < 1_000 + FRAME_MS ? 400 : FRAME_MS),
    );
    // Straight after it, drawn its usual 100 ms behind, give or take the
    // 10% its time may run slow (states read late after the hitch look
    // late, so the delay aims higher for a while), not the hitch behind.
    expect(motion.drawnDelayUs).toBeLessThanOrEqual(100_000 + 40_000 + 1);
  });

  test("snaps a late reset rather than sliding through it", () => {
    const motion = new OpponentMotion();
    // On time to 1 s; then a reset just after, back to 8 m and held there
    // (under the 3 m that would snap anyway), heard 300 ms late, by when
    // the guess has run on to 10.5 m.
    const deliveries = stream(0, 1_000, () => 30);
    for (let tMs = 1_000 + STATE_MS; tMs <= 2_000; tMs += STATE_MS) {
      deliveries.push({
        state: state(tMs, 8, {
          reset: tMs === 1_000 + STATE_MS,
          velocity: { x: 0, y: 0, z: 0 },
        }),
        atMs: Math.max(tMs + 30, 1_330),
      });
    }
    const frames = drive(motion, deliveries, 0, 2_000);
    // One jump straight back, not a slide over 150 ms.
    const moves = steps(frames).filter((step) => Math.abs(step) > 0.05);
    const back = moves.filter((step) => step < 0);
    expect(back).toHaveLength(1);
    expect(back[0]).toBeLessThan(-2);
  });

  test("eases through a sender's stall without a lurch", () => {
    const motion = new OpponentMotion();
    const deliveries = stream(0, 1_000, () => 30);
    // A 300 ms hitch: race time ran on while the kart moved one step.
    const resumeMs = 1_300;
    for (let tMs = resumeMs; tMs <= 2_500; tMs += STATE_MS) {
      deliveries.push({
        state: state(tMs, SPEED + 0.17 + ((tMs - resumeMs) / 1_000) * SPEED),
        atMs: tMs + 30,
      });
    }
    const frames = drive(motion, deliveries, 0, 2_500);
    // It pauses within half a metre of where it stopped, and moves on
    // without a jump.
    for (const step of steps(frames)) expect(Math.abs(step)).toBeLessThan(0.3);
    const stalled = frames.filter(
      ({ drawnMs }) => drawnMs > 1_000 && drawnMs < resumeMs,
    );
    expect(stalled.length).toBeGreaterThan(5);
    for (const { x } of stalled) {
      expect(x).toBeGreaterThanOrEqual(SPEED - 1e-9);
      expect(x).toBeLessThanOrEqual(SPEED + 0.5 + 1e-9);
    }
  });

  test("keeps a race's figures for the readout once its tracks are cleared", () => {
    const tracks = new OpponentTracks();
    tracks.add(
      { type: "state", from: "p2", t: 0, p: [0, 0, 0], q: [0, 0, 0, 1], v: [0, 0, 0], w: [0, 0, 0], s: 0, r: false },
      0,
    );
    const pose = createGhostPose();
    for (let frame = 0; frame < 10; frame += 1) {
      tracks.pose("p2", frame * 16_667, 1 / 60, pose);
    }
    const raced = tracks.stats();
    expect(raced.frames).toBe(10);
    // The room moves on before the race view reads them.
    tracks.clear();
    expect(tracks.stats()).toEqual(raced);
  });
});

import { expect, test } from "@playwright/test";

import {
  remoteMotorState,
  remoteVoiceMix,
} from "../src/game/audio/remote-motor-voice";

// The camera at the origin looking down -z, so its right is +x.
const LISTENER = {
  position: { x: 0, y: 0, z: 0 },
  right: { x: 1, y: 0, z: 0 },
  velocity: { x: 0, y: 0, z: 0 },
};
const STILL = { x: 0, y: 0, z: 0 };

test.describe("an opponent's voice", () => {
  test("falls off with distance, losing its top end, and goes quiet far off", () => {
    const near = remoteVoiceMix(LISTENER, { x: 0, y: 0, z: -1.5 }, STILL);
    const mid = remoteVoiceMix(LISTENER, { x: 0, y: 0, z: -12 }, STILL);
    const far = remoteVoiceMix(LISTENER, { x: 0, y: 0, z: -24 }, STILL);
    expect(near.gain).toBe(1);
    // The inverse-distance law: half as loud at twice the distance.
    expect(far.gain).toBeCloseTo(mid.gain / 2, 6);
    expect(far.cutoffHz).toBeLessThan(mid.cutoffHz);
    expect(mid.cutoffHz).toBeLessThan(near.cutoffHz);
    expect(remoteVoiceMix(LISTENER, { x: 0, y: 0, z: -70 }, STILL).gain)
      .toBeLessThan(remoteVoiceMix(LISTENER, { x: 0, y: 0, z: -59 }, STILL).gain / 2);
    expect(remoteVoiceMix(LISTENER, { x: 0, y: 0, z: -80 }, STILL).gain).toBe(0);
  });

  test("sits to the side it is on, never wholly", () => {
    const right = remoteVoiceMix(LISTENER, { x: 5, y: 0, z: 0 }, STILL);
    const left = remoteVoiceMix(LISTENER, { x: -5, y: 0, z: 0 }, STILL);
    const ahead = remoteVoiceMix(LISTENER, { x: 0, y: 0, z: -5 }, STILL);
    expect(right.pan).toBeCloseTo(0.85, 6);
    expect(left.pan).toBeCloseTo(-0.85, 6);
    expect(ahead.pan).toBeCloseTo(0, 6);
  });

  test("rises in pitch closing, falls parting, at the speed of sound", () => {
    const at = { x: 0, y: 0, z: -10 };
    const closing = remoteVoiceMix(LISTENER, at, { x: 0, y: 0, z: 20 });
    const parting = remoteVoiceMix(LISTENER, at, { x: 0, y: 0, z: -20 });
    const passing = remoteVoiceMix(LISTENER, at, { x: 20, y: 0, z: 0 });
    // 343 / (343 - 20): about 6% up; 343 / (343 + 20): about 5.5% down.
    expect(closing.doppler).toBeCloseTo(343 / 323, 6);
    expect(parting.doppler).toBeCloseTo(343 / 363, 6);
    expect(passing.doppler).toBeCloseTo(1, 6);
    // The listener closing in counts the same way.
    const chasing = remoteVoiceMix(
      { ...LISTENER, velocity: { x: 0, y: 0, z: -20 } },
      at,
      STILL,
    );
    expect(chasing.doppler).toBeCloseTo(363 / 343, 6);
  });

  test("turns its motor with its own kart's speed, loaded speeding up", () => {
    const mix = remoteVoiceMix(LISTENER, { x: 0, y: 0, z: -5 }, STILL);
    // Half its own top speed, whatever that is.
    expect(remoteMotorState(10, 0, 20, mix)).toMatchObject({
      motorSpeed: 0.5,
      load: 0,
    });
    expect(remoteMotorState(6, 0, 12, mix).motorSpeed).toBe(0.5);
    expect(remoteMotorState(40, 12, 20, mix)).toMatchObject({
      motorSpeed: 1.1,
      load: 1,
    });
    expect(remoteMotorState(5, -8, 20, mix).load).toBe(0);
  });
});

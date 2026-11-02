import { expect, test } from "@playwright/test";

import { BUNDLED_COURSE_DOCUMENTS } from "../src/game/course/course-document";
import type { GhostSample } from "../src/game/ghost/ghost-trace";
import { createRaceSessionConfig } from "../src/game/race/race-course";
import type { DirectedRaceGate, RaceVector3 } from "../src/game/race/race-gate";
import type { RaceSessionConfig } from "../src/game/race/race-session";
import {
  MAX_RUN_SAMPLES,
  verifyRaceRecording,
} from "../src/game/race/race-verification";
import {
  lifted,
  recordRace,
  type Route,
  routeThroughGates,
} from "./support/race-recording";

const IDENTITY = { w: 1, x: 0, y: 0, z: 0 };
const NO_ROTATION = { x: 0, y: 0, z: 0 };

function axisGate(
  id: string,
  center: RaceVector3,
  forward: RaceVector3,
): DirectedRaceGate {
  return {
    center,
    forward,
    halfExtents:
      forward.x === 0 ? { x: 3, y: 1.5, z: 0.4 } : { x: 0.4, y: 1.5, z: 3 },
    id,
    worldToLocalRotation: IDENTITY,
  };
}

// A 200 m loop: start facing +x at the origin, A on the east side, B on the
// north side, each with its reset point just past the gate.
const SQUARE: RaceSessionConfig = {
  checkpoints: [
    {
      gate: axisGate("a", { x: 40, y: 1.5, z: 20 }, { x: 0, y: 0, z: 1 }),
      id: "a",
      recovery: { position: { x: 40, y: 0, z: 22 }, rotation: NO_ROTATION },
    },
    {
      gate: axisGate("b", { x: 0, y: 1.5, z: 40 }, { x: -1, y: 0, z: 0 }),
      id: "b",
      recovery: { position: { x: -2, y: 0, z: 40 }, rotation: NO_ROTATION },
    },
  ],
  countdownSeconds: 3,
  lapCount: 2,
  recoverySeconds: 0.5,
  startGate: axisGate("start", { x: 0, y: 1.5, z: 0 }, { x: 1, y: 0, z: 0 }),
  startRecovery: { position: { x: -0.6, y: 0, z: 0 }, rotation: NO_ROTATION },
};
const SQUARE_ROUTE: Route = {
  lap: [
    { x: 40, y: 0, z: 0 },
    { x: 40, y: 0, z: 40 },
    { x: -20, y: 0, z: 40 },
    { x: -20, y: 0, z: 0 },
  ].map(lifted),
  start: lifted(SQUARE.startRecovery.position),
};

function copySamples(samples: readonly GhostSample[]) {
  return samples.map((sample) => ({
    ...sample,
    position: { ...sample.position },
  }));
}

function firstIndex(
  samples: readonly GhostSample[],
  predicate: (sample: GhostSample, index: number) => boolean,
) {
  const index = samples.findIndex(predicate);
  if (index < 0) throw new Error("No matching sample.");
  return index;
}

test.describe("race recording verification", () => {
  const clean = recordRace(SQUARE, SQUARE_ROUTE);

  test("verifies a recorded race and takes the time from its finish", () => {
    expect(clean.samples.filter(({ gate }) => gate)).toHaveLength(6);
    expect(verifyRaceRecording(SQUARE, clean.samples)).toEqual({
      timeMicroseconds: clean.timeMicroseconds,
      verified: true,
    });
  });

  test("verifies a race on Falls View Park's own gates", () => {
    const config = createRaceSessionConfig(
      BUNDLED_COURSE_DOCUMENTS["falls-view-park"],
    );
    const race = recordRace(config, routeThroughGates(config));

    expect(race.samples.filter(({ gate }) => gate)).toHaveLength(
      2 * (config.checkpoints.length + 1),
    );
    expect(verifyRaceRecording(config, race.samples)).toEqual({
      timeMicroseconds: race.timeMicroseconds,
      verified: true,
    });
  });

  test("rejects a recording that does not start on the grid", () => {
    const samples = copySamples(clean.samples);
    samples[0].position.z += 1;

    expect(verifyRaceRecording(SQUARE, samples)).toEqual({
      reason: "off-start",
      verified: false,
    });
  });

  test("caps the speed between samples", () => {
    const atSpeed = (speed: number) =>
      verifyRaceRecording(
        SQUARE,
        recordRace(SQUARE, SQUARE_ROUTE, { speed }).samples,
      );
    expect(atSpeed(29).verified).toBe(true);
    expect(atSpeed(33)).toEqual({ reason: "too-fast", verified: false });

    const jumped = copySamples(clean.samples);
    jumped[40].position.x += 5;
    expect(verifyRaceRecording(SQUARE, jumped)).toEqual({
      reason: "too-fast",
      verified: false,
    });
  });

  test("keeps samples at least a fixed step apart", () => {
    // A copy of a sample, held still, passes the speed cap at any spacing;
    // packed closer than a step, each pair's allowance would add up.
    const withCopy = (spacing: number) => {
      const samples = copySamples(clean.samples);
      const held = samples[20];
      samples.splice(21, 0, {
        ...held,
        position: { ...held.position },
        timeMicroseconds: held.timeMicroseconds + spacing,
      });
      return verifyRaceRecording(SQUARE, samples);
    };

    expect(withCopy(8_333).verified).toBe(true);
    for (const spacing of [0, 1, 8_332]) {
      expect(withCopy(spacing)).toEqual({
        reason: "too-fast",
        verified: false,
      });
    }
  });

  test("verifies a crossing too slow for its rounded ends to differ", () => {
    const creeping = recordRace(SQUARE, {
      ...SQUARE_ROUTE,
      lap: [
        SQUARE_ROUTE.lap[0],
        lifted({ x: 40, y: 0, z: 19.9 }),
        { ...lifted({ x: 40, y: 0, z: 20.1 }), speed: 0.03 },
        ...SQUARE_ROUTE.lap.slice(1),
      ],
    });
    const crossing = firstIndex(creeping.samples, ({ gate }) => gate);
    expect(creeping.samples[crossing].position).toEqual(
      creeping.samples[crossing - 1].position,
    );

    expect(verifyRaceRecording(SQUARE, creeping.samples)).toEqual({
      timeMicroseconds: creeping.timeMicroseconds,
      verified: true,
    });
  });

  test("checks every recorded crossing against the expected gate", () => {
    const missed = copySamples(clean.samples);
    missed[firstIndex(missed, ({ gate }) => gate)].gate = false;
    expect(verifyRaceRecording(SQUARE, missed)).toEqual({
      reason: "wrong-gate",
      verified: false,
    });

    const invented = copySamples(clean.samples);
    invented[20].gate = true;
    expect(verifyRaceRecording(SQUARE, invented)).toEqual({
      reason: "wrong-gate",
      verified: false,
    });
  });

  test("needs the finishing crossing as the last sample", () => {
    expect(verifyRaceRecording(SQUARE, clean.samples.slice(0, -1))).toEqual({
      reason: "unfinished",
      verified: false,
    });

    const last = clean.samples.at(-1)!;
    const extended = [
      ...clean.samples,
      {
        ...last,
        gate: false,
        timeMicroseconds: last.timeMicroseconds + 50_000,
      },
    ];
    expect(verifyRaceRecording(SQUARE, extended)).toEqual({
      reason: "after-finish",
      verified: false,
    });
  });

  test("allows a reset only to the race's newest reset point", () => {
    // Ten seconds in, the kart is past A on its way to B.
    const reset = recordRace(SQUARE, SQUARE_ROUTE, {
      reset: { atMicroseconds: 10_000_000, resumeAt: 1 },
    });
    expect(verifyRaceRecording(SQUARE, reset.samples)).toEqual({
      timeMicroseconds: reset.timeMicroseconds,
      verified: true,
    });

    const resetIndex = firstIndex(reset.samples, (sample) => sample.reset);
    expect(reset.samples[resetIndex].position).toEqual(
      lifted(SQUARE.checkpoints[0].recovery.position),
    );
    // B is not passed yet; the start, beside the finish, is passed but older.
    const tampered = [
      lifted(SQUARE.checkpoints[1].recovery.position),
      lifted(SQUARE.startRecovery.position),
      { ...reset.samples[resetIndex].position, x: 41 },
    ].map((position) => {
      const samples = copySamples(reset.samples);
      samples[resetIndex].position = position;
      return samples;
    });
    for (const samples of tampered) {
      expect(verifyRaceRecording(SQUARE, samples)).toEqual({
        reason: "bad-reset",
        verified: false,
      });
    }
  });

  test("rejects races over the time limit", () => {
    const slowed = clean.samples.map((sample) => ({
      ...sample,
      timeMicroseconds: sample.timeMicroseconds * 25,
    }));

    expect(verifyRaceRecording(SQUARE, slowed)).toEqual({
      reason: "too-long",
      verified: false,
    });
    const crowded = Array.from(
      { length: MAX_RUN_SAMPLES + 1 },
      () => clean.samples[0],
    );
    expect(verifyRaceRecording(SQUARE, crowded)).toEqual({
      reason: "too-long",
      verified: false,
    });
  });

  test("builds the same gates as PlayCanvas", async () => {
    const { Quat, Vec3 } = await import(
      "playcanvas/build/playcanvas/src/index.js"
    );
    const inverse = ({ x, y, z }: RaceVector3) =>
      new Quat().setFromEulerAngles(x, y, z).invert();
    const expectClose = (actual: object, expected: object) => {
      for (const [key, value] of Object.entries(expected)) {
        expect((actual as Record<string, number>)[key]).toBeCloseTo(
          value as number,
          12,
        );
      }
    };

    for (const document of Object.values(BUNDLED_COURSE_DOCUMENTS)) {
      const config = createRaceSessionConfig(document);
      document.checkpoints.forEach((checkpoint, index) => {
        const { w, x, y, z } = inverse(checkpoint.rotation);
        expectClose(config.checkpoints[index].gate.worldToLocalRotation, {
          w,
          x,
          y,
          z,
        });
      });
      const start = inverse(document.start.rotation);
      expectClose(config.startGate.worldToLocalRotation, {
        w: start.w,
        x: start.x,
        y: start.y,
        z: start.z,
      });
      const forward = start
        .clone()
        .invert()
        .transformVector(new Vec3(0, 0, -1))
        .normalize();
      expectClose(config.startGate.forward, {
        x: forward.x,
        y: forward.y,
        z: forward.z,
      });
    }
  });
});

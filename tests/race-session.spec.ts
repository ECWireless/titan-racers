import { expect, test } from "@playwright/test";

import {
  RaceSession,
  type RaceCheckpoint,
  type RaceSessionConfig,
} from "../src/game/race/race-session";

function gate(id: string, x: number) {
  return {
    center: { x, y: 1, z: 0 },
    forward: { x: 1, y: 0, z: 0 },
    halfExtents: { x: 0.5, y: 1, z: 2 },
    id,
    worldToLocalRotation: { w: 1, x: 0, y: 0, z: 0 },
  } as const;
}

function checkpoint(id: string, x: number): RaceCheckpoint {
  return {
    gate: gate(id, x),
    id,
    recovery: {
      position: { x, y: 0, z: 0 },
      rotation: { x: 0, y: 90, z: 0 },
    },
  };
}

function config(overrides: Partial<RaceSessionConfig> = {}): RaceSessionConfig {
  return {
    checkpoints: [checkpoint("checkpoint-1", 1), checkpoint("checkpoint-2", 2)],
    countdownSeconds: 3,
    lapCount: 2,
    recoverySeconds: 0.5,
    startGate: gate("start", 3),
    startRecovery: {
      position: { x: 3, y: 0, z: 0 },
      rotation: { x: 0, y: 90, z: 0 },
    },
    ...overrides,
  };
}

function startRace(session: RaceSession) {
  expect(session.markReady()).toBe(true);
  expect(session.startCountdown()).toBe(true);
  session.advanceTime(3);
  expect(session.snapshot.state).toBe("racing");
}

function cross(session: RaceSession, x: number) {
  return session.processMovement(
    { x: x - 0.1, y: 1, z: 0 },
    { x: x + 0.1, y: 1, z: 0 },
  );
}

test.describe("race session", () => {
  test.beforeEach(async ({}, testInfo) => {
    test.skip(
      testInfo.project.name !== "desktop",
      "Pure lifecycle coverage only needs to run once.",
    );
  });

  test("moves through loading, ready, countdown, racing, and pause", () => {
    const session = new RaceSession(config());

    expect(session.snapshot.state).toBe("loading");
    expect(session.startCountdown()).toBe(false);
    expect(session.markReady()).toBe(true);
    expect(session.startCountdown()).toBe(true);
    session.advanceTime(2.5);
    expect(session.snapshot).toMatchObject({
      countdownRemainingMicroseconds: 500_000,
      elapsedRaceMicroseconds: 0,
      state: "countdown",
    });
    expect(session.pause()).toBe(true);
    session.advanceTime(10);
    expect(session.snapshot.countdownRemainingMicroseconds).toBe(500_000);
    expect(session.resume()).toBe(true);
    session.advanceTime(0.5);
    expect(session.snapshot.state).toBe("racing");
  });

  test("keeps fixed-step time exact across common render cadences", () => {
    for (const hz of [30, 60, 120]) {
      const session = new RaceSession(config({ countdownSeconds: 1 }));
      expect(session.markReady()).toBe(true);
      expect(session.startCountdown()).toBe(true);
      for (let frame = 0; frame < hz * 2; frame += 1) {
        session.advanceTime(1 / hz);
      }

      expect(session.snapshot).toMatchObject({
        countdownRemainingMicroseconds: 0,
        elapsedRaceMicroseconds: 1_000_000,
        state: "racing",
      });
    }
  });

  test("enforces ordered checkpoints and ignores invalid progression", () => {
    const session = new RaceSession(config());
    startRace(session);

    expect(cross(session, 3)).toEqual({
      kind: "rejected",
      reason: "finish-before-checkpoints",
    });
    expect(cross(session, 2)).toEqual({
      kind: "rejected",
      reason: "out-of-order",
      targetId: "checkpoint-2",
    });
    expect(cross(session, 1)).toEqual({
      checkpointId: "checkpoint-1",
      kind: "checkpoint",
    });
    expect(cross(session, 1)).toEqual({
      kind: "rejected",
      reason: "repeated",
      targetId: "checkpoint-1",
    });
    expect(session.snapshot).toMatchObject({
      currentLap: 1,
      expectedTargetId: "checkpoint-2",
      recoveryCandidates: [{ id: "checkpoint-1" }, { id: "start" }],
    });
  });

  test("completes two timed laps and freezes the finished result", () => {
    const session = new RaceSession(config());
    startRace(session);

    session.advanceTime(5);
    expect(cross(session, 1).kind).toBe("checkpoint");
    expect(cross(session, 2).kind).toBe("checkpoint");
    expect(cross(session, 3)).toEqual({
      kind: "lap",
      lap: 1,
      lapMicroseconds: 5_000_000,
    });
    session.advanceTime(7.25);
    expect(cross(session, 1).kind).toBe("checkpoint");
    expect(cross(session, 2).kind).toBe("checkpoint");
    expect(cross(session, 3)).toEqual({
      kind: "finished",
      lap: 2,
      lapMicroseconds: 7_250_000,
      totalMicroseconds: 12_250_000,
    });

    session.advanceTime(10);
    expect(session.snapshot).toMatchObject({
      completedLapMicroseconds: [5_000_000, 7_250_000],
      elapsedRaceMicroseconds: 12_250_000,
      expectedTargetId: null,
      state: "finished",
    });
    expect(cross(session, 1)).toEqual({
      kind: "rejected",
      reason: "lifecycle-inactive",
    });
  });

  test("charges recovery time, pauses it, and resumes from the safe transform", () => {
    const session = new RaceSession(config());
    startRace(session);
    expect(cross(session, 1).kind).toBe("checkpoint");

    expect(session.requestRecovery()).toEqual({
      position: { x: 1, y: 0, z: 0 },
      rotation: { x: 0, y: 90, z: 0 },
    });
    expect(session.snapshot.state).toBe("recovering");
    session.advanceTime(0.2);
    expect(session.snapshot.elapsedRaceMicroseconds).toBe(200_000);
    expect(session.pause()).toBe(true);
    session.advanceTime(1);
    expect(session.snapshot.recoveryRemainingMicroseconds).toBe(300_000);
    expect(session.resume()).toBe(true);
    session.advanceTime(0.3);
    expect(session.snapshot).toMatchObject({
      elapsedRaceMicroseconds: 500_000,
      recoveryRemainingMicroseconds: 0,
      state: "racing",
    });
  });

  test("keeps earlier accepted anchors as ordered recovery fallbacks", () => {
    const session = new RaceSession(config());
    startRace(session);
    expect(cross(session, 1).kind).toBe("checkpoint");
    expect(cross(session, 2).kind).toBe("checkpoint");

    expect(session.snapshot.recoveryCandidates.map(({ id }) => id)).toEqual([
      "checkpoint-2",
      "checkpoint-1",
      "start",
    ]);

    expect(cross(session, 3).kind).toBe("lap");
    expect(session.snapshot.recoveryCandidates.map(({ id }) => id)).toEqual([
      "start",
    ]);
  });

  test("charges explicitly discarded active simulation time", () => {
    const session = new RaceSession(config());
    startRace(session);

    session.advanceTime(0.75);

    expect(session.snapshot.elapsedRaceMicroseconds).toBe(750_000);
  });
});

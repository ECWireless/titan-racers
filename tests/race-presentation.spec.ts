import { expect, test } from "@playwright/test";

import {
  createLoadingRacePresentationSnapshot,
  createRacePresentationSnapshot,
  formatRaceTime,
  racePresentationSnapshotsEqual,
} from "../src/game/race/race-presentation";
import type {
  RaceProgressionResult,
  RaceSessionSnapshot,
} from "../src/game/race/race-session";

function snapshot(
  overrides: Partial<RaceSessionSnapshot> = {},
): RaceSessionSnapshot {
  return {
    activeRecovery: {
      id: "start",
      transform: {
        position: { x: 0, y: 0, z: 0 },
        rotation: { x: 0, y: 0, z: 0 },
      },
    },
    completedLapMicroseconds: [],
    countdownRemainingMicroseconds: 3_000_000,
    currentLap: 1,
    elapsedRaceMicroseconds: 0,
    expectedTargetId: "checkpoint-1",
    lapCount: 2,
    recoveryCandidates: [],
    recoveryRemainingMicroseconds: 0,
    resumableState: null,
    state: "countdown",
    ...overrides,
  };
}

test.describe("race presentation", () => {
  test.beforeEach(async ({}, testInfo) => {
    test.skip(
      testInfo.project.name !== "desktop",
      "Pure presentation coverage only needs to run once.",
    );
  });

  test("formats deterministic race times without rounding ahead", () => {
    expect(formatRaceTime(0)).toBe("0:00.0");
    expect(formatRaceTime(61_999_999)).toBe("1:01.9");
    expect(formatRaceTime(61_999_999, 3)).toBe("1:01.999");
    expect(formatRaceTime(Number.NaN)).toBe("0:00.0");
  });

  test("creates a non-authoritative loading state without a race session", () => {
    expect(createLoadingRacePresentationSnapshot()).toEqual({
      announcement: "",
      countdownValue: null,
      cue: null,
      currentLap: 1,
      elapsedTime: "0:00.0",
      lapCount: 1,
      lapTimes: [],
      state: "loading",
    });
  });

  test("projects countdown, progress, recovery, and finish states", () => {
    expect(
      createRacePresentationSnapshot(
        snapshot({ countdownRemainingMicroseconds: 2_000_001 }),
      ),
    ).toMatchObject({
      announcement: "Race starts in 3",
      countdownValue: 3,
      cue: "3",
      elapsedTime: "0:00.0",
    });

    const checkpointResult: RaceProgressionResult = {
      checkpointId: "checkpoint-1",
      kind: "checkpoint",
    };
    expect(
      createRacePresentationSnapshot(
        snapshot({
          countdownRemainingMicroseconds: 0,
          elapsedRaceMicroseconds: 1_250_000,
          expectedTargetId: "checkpoint-2",
          state: "racing",
        }),
        checkpointResult,
      ),
    ).toMatchObject({
      announcement: "",
      cue: null,
      elapsedTime: "0:01.2",
    });

    expect(
      createRacePresentationSnapshot(
        snapshot({
          countdownRemainingMicroseconds: 0,
          elapsedRaceMicroseconds: 3_500_000,
          state: "recovering",
        }),
      ),
    ).toMatchObject({
      announcement: "Recovering kart",
      cue: null,
      state: "recovering",
    });

    expect(
      createRacePresentationSnapshot(
        snapshot({
          completedLapMicroseconds: [6_125_000, 5_750_000],
          countdownRemainingMicroseconds: 0,
          currentLap: 2,
          elapsedRaceMicroseconds: 11_875_000,
          expectedTargetId: null,
          state: "finished",
        }),
      ),
    ).toMatchObject({
      announcement: "Race finished in 0:11.875",
      elapsedTime: "0:11.875",
      lapTimes: ["0:06.125", "0:05.750"],
      state: "finished",
    });
  });

  test("compares projected values instead of object identity", () => {
    const first = createRacePresentationSnapshot(snapshot());
    const equivalent = createRacePresentationSnapshot(snapshot());
    const changed = createRacePresentationSnapshot(
      snapshot({ countdownRemainingMicroseconds: 1_900_000 }),
    );

    expect(racePresentationSnapshotsEqual(first, equivalent)).toBe(true);
    expect(racePresentationSnapshotsEqual(first, changed)).toBe(false);
  });
});

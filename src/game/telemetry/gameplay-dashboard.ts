import { z } from "zod";

import {
  gameplayRunFailureCodeSchema,
  type GameplayInputFamily,
  type GameplayRunFailureCode,
} from "./gameplay-run-events";

type GameplayRunOutcome =
  | "completed"
  | "exited"
  | "load_failed"
  | "runtime_failed";

export const gameplayDashboardRangeSchema = z.enum(["7d", "30d", "all"]);
export type GameplayDashboardRange = z.infer<
  typeof gameplayDashboardRangeSchema
>;

export type GameplayDashboardRun = {
  automaticPauseCount: number;
  attribution: "authenticated" | "guest";
  completedRaceTimeMs: number | null;
  deploymentVersion: string;
  discardedTimeMs: number;
  endedAt: Date | null;
  failureCode: GameplayRunFailureCode | null;
  inputFamilies: GameplayInputFamily[];
  loadedAt: Date | null;
  outcome: GameplayRunOutcome | null;
  racingStartedAt: Date | null;
  recoveryCount: number;
  runtimeLoadTimeMs: number | null;
  startedAt: Date;
};

const countSchema = z.number().int().nonnegative();

export const gameplayDashboardSchema = z.strictObject({
  attribution: z.strictObject({
    anonymous: countSchema,
    authenticated: countSchema,
  }),
  daily: z.array(
    z.strictObject({
      attempts: countSchema,
      completed: countSchema,
      date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
    }),
  ),
  inputFamilies: z.strictObject({
    gamepad: countSchema,
    keyboard: countSchema,
    touch: countSchema,
  }),
  outcomes: z.strictObject({
    active: countSchema,
    completed: countSchema,
    exited: countSchema,
    loadFailed: countSchema,
    runtimeFailed: countSchema,
    unfinished: countSchema,
  }),
  range: gameplayDashboardRangeSchema,
  failureGroups: z.array(
    z.strictObject({
      count: countSchema,
      deploymentVersion: z.string(),
      failureCode: gameplayRunFailureCodeSchema,
      lastOccurredAt: z.string().datetime(),
      stage: z.enum(["loading", "ready", "racing"]),
    }),
  ),
  funnel: z.strictObject({
    attempts: z.strictObject({ count: countSchema }),
    completed: z.strictObject({
      conversionRate: z.number().nonnegative().max(1),
      count: countSchema,
    }),
    loaded: z.strictObject({
      conversionRate: z.number().nonnegative().max(1),
      count: countSchema,
    }),
    racing: z.strictObject({
      conversionRate: z.number().nonnegative().max(1),
      count: countSchema,
    }),
  }),
  recoveries: z.strictObject({
    multiple: countSchema,
    one: countSchema,
    sampleSize: countSchema,
    zero: countSchema,
  }),
  runtimeHealth: z.strictObject({
    runsWithAutomaticPauses: countSchema,
    runsWithDiscardedTime: countSchema,
    medianDiscardedTimeMs: z.number().int().nonnegative().nullable(),
  }),
  summary: z.strictObject({
    attempts: countSchema,
    completed: countSchema,
    completionRate: z.number().nonnegative().max(1),
    loaded: countSchema,
    medianCompletedRaceTimeMs: z.number().int().nonnegative().nullable(),
    medianLoadTimeMs: z.number().int().nonnegative().nullable(),
    racing: countSchema,
  }),
});

export type GameplayDashboard = z.infer<typeof gameplayDashboardSchema>;

const UNFINISHED_AFTER_MS = 30 * 60 * 1_000;

function median(values: number[]) {
  if (values.length === 0) {
    return null;
  }

  const sorted = [...values].sort((left, right) => left - right);
  const middle = Math.floor(sorted.length / 2);
  const value =
    sorted.length % 2 === 0
      ? (sorted[middle - 1] + sorted[middle]) / 2
      : sorted[middle];
  return Math.round(value);
}

function failureStage(run: GameplayDashboardRun) {
  if (run.racingStartedAt) {
    return "racing" as const;
  }
  if (run.loadedAt) {
    return "ready" as const;
  }
  return "loading" as const;
}

export function aggregateGameplayDashboard(
  runs: GameplayDashboardRun[],
  range: GameplayDashboardRange,
  now = new Date(),
): GameplayDashboard {
  const staleBefore = now.getTime() - UNFINISHED_AFTER_MS;
  const completed = runs.filter((run) => run.outcome === "completed");
  const racingRuns = runs.filter((run) => run.racingStartedAt !== null);
  const terminalRacingRuns = racingRuns.filter((run) => run.outcome !== null);
  const loadedRuns = runs.filter((run) => run.loadedAt !== null);
  const daily = new Map<string, { attempts: number; completed: number }>();

  for (const run of runs) {
    const date = run.startedAt.toISOString().slice(0, 10);
    const totals = daily.get(date) ?? { attempts: 0, completed: 0 };
    totals.attempts += 1;
    totals.completed += Number(run.outcome === "completed");
    daily.set(date, totals);
  }

  const inputFamilies = { gamepad: 0, keyboard: 0, touch: 0 };
  for (const run of runs) {
    for (const family of run.inputFamilies) {
      inputFamilies[family] += 1;
    }
  }

  const unfinished = runs.filter(
    (run) => run.outcome === null && run.startedAt.getTime() < staleBefore,
  ).length;
  const active = runs.filter(
    (run) => run.outcome === null && run.startedAt.getTime() >= staleBefore,
  ).length;
  const failures = new Map<
    string,
    {
      count: number;
      deploymentVersion: string;
      failureCode: GameplayRunFailureCode;
      lastOccurredAt: Date;
      stage: "loading" | "racing" | "ready";
    }
  >();
  for (const run of runs) {
    if (
      !run.endedAt ||
      !run.failureCode ||
      (run.outcome !== "load_failed" && run.outcome !== "runtime_failed")
    ) {
      continue;
    }
    const stage = failureStage(run);
    const key = `${run.failureCode}\u0000${stage}\u0000${run.deploymentVersion}`;
    const existing = failures.get(key);
    if (existing) {
      existing.count += 1;
      if (run.endedAt > existing.lastOccurredAt) {
        existing.lastOccurredAt = run.endedAt;
      }
    } else {
      failures.set(key, {
        count: 1,
        deploymentVersion: run.deploymentVersion,
        failureCode: run.failureCode,
        lastOccurredAt: run.endedAt,
        stage,
      });
    }
  }

  const rate = (numerator: number, denominator: number) =>
    denominator === 0 ? 0 : numerator / denominator;

  return {
    attribution: {
      anonymous: runs.filter((run) => run.attribution === "guest").length,
      authenticated: runs.filter((run) => run.attribution === "authenticated")
        .length,
    },
    daily: [...daily.entries()]
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([date, totals]) => ({ date, ...totals })),
    failureGroups: [...failures.values()]
      .sort(
        (left, right) =>
          right.count - left.count ||
          right.lastOccurredAt.getTime() - left.lastOccurredAt.getTime(),
      )
      .slice(0, 10)
      .map((failure) => ({
        ...failure,
        lastOccurredAt: failure.lastOccurredAt.toISOString(),
      })),
    funnel: {
      attempts: { count: runs.length },
      completed: {
        conversionRate: rate(completed.length, racingRuns.length),
        count: completed.length,
      },
      loaded: {
        conversionRate: rate(loadedRuns.length, runs.length),
        count: loadedRuns.length,
      },
      racing: {
        conversionRate: rate(racingRuns.length, loadedRuns.length),
        count: racingRuns.length,
      },
    },
    inputFamilies,
    outcomes: {
      active,
      completed: completed.length,
      exited: runs.filter((run) => run.outcome === "exited").length,
      loadFailed: runs.filter((run) => run.outcome === "load_failed").length,
      runtimeFailed: runs.filter((run) => run.outcome === "runtime_failed")
        .length,
      unfinished,
    },
    range,
    recoveries: {
      multiple: terminalRacingRuns.filter((run) => run.recoveryCount > 1)
        .length,
      one: terminalRacingRuns.filter((run) => run.recoveryCount === 1).length,
      sampleSize: terminalRacingRuns.length,
      zero: terminalRacingRuns.filter((run) => run.recoveryCount === 0).length,
    },
    runtimeHealth: {
      runsWithAutomaticPauses: runs.filter(
        (run) => run.automaticPauseCount > 0,
      ).length,
      runsWithDiscardedTime: runs.filter((run) => run.discardedTimeMs > 0)
        .length,
      medianDiscardedTimeMs: median(
        runs.flatMap((run) =>
          run.discardedTimeMs > 0 ? [run.discardedTimeMs] : [],
        ),
      ),
    },
    summary: {
      attempts: runs.length,
      completed: completed.length,
      completionRate: runs.length === 0 ? 0 : completed.length / runs.length,
      loaded: loadedRuns.length,
      medianCompletedRaceTimeMs: median(
        completed.flatMap((run) =>
          run.completedRaceTimeMs === null ? [] : [run.completedRaceTimeMs],
        ),
      ),
      medianLoadTimeMs: median(
        runs.flatMap((run) =>
          run.runtimeLoadTimeMs === null ? [] : [run.runtimeLoadTimeMs],
        ),
      ),
      racing: racingRuns.length,
    },
  };
}

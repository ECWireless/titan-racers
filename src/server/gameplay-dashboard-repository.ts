import { gte } from "drizzle-orm";

import { db } from "@/db/client";
import { gameplayRuns } from "@/db/schema";
import {
  aggregateGameplayDashboard,
  type GameplayDashboardRange,
} from "@/game/telemetry/gameplay-dashboard";
import { gameplayRunFailureCodeSchema } from "@/game/telemetry/gameplay-run-events";

function rangeStart(range: GameplayDashboardRange, now: Date) {
  if (range === "all") {
    return null;
  }

  const days = range === "7d" ? 7 : 30;
  return new Date(now.getTime() - days * 24 * 60 * 60 * 1_000);
}

export async function loadGameplayDashboard(
  range: GameplayDashboardRange,
  now = new Date(),
) {
  const since = rangeStart(range, now);
  const query = db
    .select({
      attribution: gameplayRuns.attribution,
      completedRaceTimeMs: gameplayRuns.completedRaceTimeMs,
      deploymentVersion: gameplayRuns.deploymentVersion,
      endedAt: gameplayRuns.endedAt,
      failureCode: gameplayRuns.failureCode,
      inputFamilies: gameplayRuns.inputFamilies,
      loadedAt: gameplayRuns.loadedAt,
      outcome: gameplayRuns.outcome,
      racingStartedAt: gameplayRuns.racingStartedAt,
      recoveryCount: gameplayRuns.recoveryCount,
      runtimeLoadTimeMs: gameplayRuns.runtimeLoadTimeMs,
      startedAt: gameplayRuns.startedAt,
    })
    .from(gameplayRuns);
  const runs = since
    ? await query.where(gte(gameplayRuns.startedAt, since))
    : await query;

  return aggregateGameplayDashboard(
    runs.map((run) => ({
      ...run,
      failureCode: gameplayRunFailureCodeSchema
        .nullable()
        .parse(run.failureCode),
    })),
    range,
    now,
  );
}

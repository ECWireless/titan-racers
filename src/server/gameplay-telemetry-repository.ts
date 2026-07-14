import { and, eq, isNotNull, isNull, lte } from "drizzle-orm";

import { db } from "@/db/client";
import { gameplayRuns } from "@/db/schema";
import type { GameplayRunEvent } from "@/game/telemetry/gameplay-run-events";

function deploymentVersion() {
  const version = process.env.VERCEL_GIT_COMMIT_SHA?.trim();
  return version ? version.slice(0, 120) : "development";
}

export async function recordGameplayRunEvent(
  event: GameplayRunEvent,
  receivedAt = new Date(),
) {
  if (event.type === "run_started") {
    const inserted = await db
      .insert(gameplayRuns)
      .values({
        courseId: event.courseId,
        deploymentVersion: deploymentVersion(),
        id: event.runId,
        inputFamilies: [],
        startedAt: receivedAt,
        updatedAt: receivedAt,
      })
      .onConflictDoNothing({ target: gameplayRuns.id })
      .returning({ id: gameplayRuns.id });

    return inserted.length > 0 ? "created" : "ignored";
  }

  if (event.type === "runtime_loaded") {
    const updated = await db
      .update(gameplayRuns)
      .set({
        loadedAt: receivedAt,
        runtimeLoadTimeMs: event.elapsedMs,
        updatedAt: receivedAt,
      })
      .where(
        and(
          eq(gameplayRuns.id, event.runId),
          isNull(gameplayRuns.loadedAt),
          isNull(gameplayRuns.outcome),
          lte(gameplayRuns.startedAt, receivedAt),
        ),
      )
      .returning({ id: gameplayRuns.id });

    return updated.length > 0 ? "updated" : "ignored";
  }

  if (event.type === "race_started") {
    const updated = await db
      .update(gameplayRuns)
      .set({ racingStartedAt: receivedAt, updatedAt: receivedAt })
      .where(
        and(
          eq(gameplayRuns.id, event.runId),
          isNotNull(gameplayRuns.loadedAt),
          isNull(gameplayRuns.racingStartedAt),
          isNull(gameplayRuns.outcome),
          lte(gameplayRuns.loadedAt, receivedAt),
        ),
      )
      .returning({ id: gameplayRuns.id });

    return updated.length > 0 ? "updated" : "ignored";
  }

  const prerequisites = [
    eq(gameplayRuns.id, event.runId),
    isNull(gameplayRuns.outcome),
    lte(gameplayRuns.startedAt, receivedAt),
  ];
  if (event.outcome === "completed") {
    prerequisites.push(
      isNotNull(gameplayRuns.racingStartedAt),
      lte(gameplayRuns.racingStartedAt, receivedAt),
    );
  } else if (event.outcome === "load_failed") {
    prerequisites.push(
      isNull(gameplayRuns.loadedAt),
      isNull(gameplayRuns.racingStartedAt),
    );
  } else if (event.outcome === "runtime_failed") {
    prerequisites.push(
      isNotNull(gameplayRuns.loadedAt),
      lte(gameplayRuns.loadedAt, receivedAt),
    );
  }

  const updated = await db
    .update(gameplayRuns)
    .set({
      completedRaceTimeMs:
        event.outcome === "completed" ? event.completedRaceTimeMs : null,
      endedAt: receivedAt,
      failureCode:
        event.outcome === "load_failed" || event.outcome === "runtime_failed"
          ? event.failureCode
          : null,
      inputFamilies: event.inputFamilies,
      outcome: event.outcome,
      recoveryCount: event.recoveryCount,
      updatedAt: receivedAt,
    })
    .where(and(...prerequisites))
    .returning({ id: gameplayRuns.id });

  return updated.length > 0 ? "updated" : "ignored";
}

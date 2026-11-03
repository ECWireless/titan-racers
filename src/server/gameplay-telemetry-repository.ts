import { and, eq, isNotNull, isNull, lte, sql } from "drizzle-orm";

import { db } from "@/db/client";
import { gameplayRuns } from "@/db/schema";
import { isOfficialCourseId } from "@/game/course/course-ids";
import { OFFICIAL_KART_IDS } from "@/game/kart/official-kart-roster";
import type {
  GameplayRaceIdentity,
  GameplayRunEvent,
} from "@/game/telemetry/gameplay-run-events";
import { wasCourseRevisionPublished } from "@/server/course-repository";
import { wasKartRevisionPublished } from "@/server/kart-repository";

function deploymentVersion() {
  const version = process.env.VERCEL_GIT_COMMIT_SHA?.trim();
  return version ? version.slice(0, 120) : "development";
}

/**
 * A run may name a revision only if it was published at some point (a race
 * outlives a later republish), and a null revision only for a bundled
 * official seed or roster kart.
 */
async function isRecordableRaceIdentity(identity: GameplayRaceIdentity) {
  const [course, kart] = await Promise.all([
    identity.courseRevision === null
      ? isOfficialCourseId(identity.courseId)
      : wasCourseRevisionPublished(identity.courseId, identity.courseRevision),
    identity.kartRevision === null
      ? (OFFICIAL_KART_IDS as readonly string[]).includes(identity.kartId)
      : wasKartRevisionPublished(identity.kartId, identity.kartRevision),
  ]);
  return course && kart;
}

export async function recordGameplayRunEvent(
  event: GameplayRunEvent,
  receivedAt = new Date(),
) {
  if (event.type === "run_started") {
    const identified = event.schemaVersion === 3 ? event : null;
    if (identified && !(await isRecordableRaceIdentity(identified))) {
      return "ignored";
    }
    const inserted = await db
      .insert(gameplayRuns)
      .values({
        courseId: event.courseId,
        courseRevision: identified?.courseRevision ?? null,
        kartId: identified?.kartId ?? null,
        kartRevision: identified?.kartRevision ?? null,
        raceAgain: identified?.raceAgain ?? null,
        ghost: identified?.ghost ?? null,
        deploymentVersion: deploymentVersion(),
        physicsVersion: event.schemaVersion === 1 ? null : event.physicsVersion,
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

  if (event.type === "run_shared") {
    const updated = await db
      .update(gameplayRuns)
      .set({ shared: true, updatedAt: receivedAt })
      .where(
        and(
          eq(gameplayRuns.id, event.runId),
          eq(gameplayRuns.outcome, "completed"),
          eq(gameplayRuns.shared, false),
        ),
      )
      .returning({ id: gameplayRuns.id });

    return updated.length > 0 ? "updated" : "ignored";
  }

  if (event.type === "runtime_health") {
    const updated = await db
      .update(gameplayRuns)
      .set({
        automaticPauseCount: sql`greatest(${gameplayRuns.automaticPauseCount}, ${event.automaticPauseCount})`,
        discardedTimeMs: sql`greatest(${gameplayRuns.discardedTimeMs}, ${event.discardedTimeMs})`,
        updatedAt: receivedAt,
      })
      .where(
        and(
          eq(gameplayRuns.id, event.runId),
          isNull(gameplayRuns.outcome),
          lte(gameplayRuns.startedAt, receivedAt),
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
      automaticPauseCount: sql`greatest(${gameplayRuns.automaticPauseCount}, ${event.automaticPauseCount ?? 0})`,
      discardedTimeMs: sql`greatest(${gameplayRuns.discardedTimeMs}, ${event.discardedTimeMs ?? 0})`,
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

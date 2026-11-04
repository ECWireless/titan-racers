import { and, eq, gte, sql } from "drizzle-orm";

import { db } from "@/db/client";
import { gameplayRuns } from "@/db/schema";
import { CURRENT_GUEST_COURSE_ID } from "@/game/course/course-ids";
import {
  aggregateGameplayDashboard,
  type GameplayDashboardRange,
  type SoloPlayAccounts,
} from "@/game/telemetry/gameplay-dashboard";
import {
  gameplayRunFailureCodeSchema,
  ghostRacedSchema,
} from "@/game/telemetry/gameplay-run-events";
import { loadRangeStart } from "@/server/admin-overview-repository";

/**
 * Sign-ups by the login method each racer joined with (their first login
 * method; anonymized racers have none left), and submissions to the current
 * solo course's boards, from the rows those features store.
 */
async function loadSoloPlayAccounts(since: Date | null): Promise<SoloPlayAccounts> {
  const after = (column: ReturnType<typeof sql>) =>
    since ? sql`and ${column} >= ${since}` : sql``;
  const [signUps, submissions] = await Promise.all([
    db.execute<{ count: number; provider_id: string }>(sql`
      select provider_id, count(*)::int as count from (
        select distinct on (account.user_id) account.provider_id
        from accounts account
        join users on users.id = account.user_id
        where true ${after(sql`users.created_at`)}
        order by account.user_id, account.created_at, account.id
      ) joined
      group by provider_id
    `),
    db.execute<{ claimed: boolean; count: number; status: string }>(sql`
      select result.status, result.claimed, count(*)::int as count
      from race_results result
      join leaderboards board on board.id = result.leaderboard_id
      where board.course_id = ${CURRENT_GUEST_COURSE_ID}
        ${after(sql`result.submitted_at`)}
      group by result.status, result.claimed
    `),
  ]);
  const joined = (provider: string) =>
    signUps.rows.find((row) => row.provider_id === provider)?.count ?? 0;
  const submitted = (match: (row: { claimed: boolean; status: string }) => boolean) =>
    submissions.rows.reduce((total, row) => total + (match(row) ? row.count : 0), 0);
  return {
    signUps: { google: joined("google"), wallet: joined("siwe") },
    submissions: {
      afterSignIn: submitted((row) => row.claimed),
      rejected: submitted((row) => row.status === "rejected"),
      verified: submitted((row) => row.status === "verified"),
    },
  };
}

export async function loadGameplayDashboard(
  range: GameplayDashboardRange,
  timeZone = "UTC",
  now = new Date(),
) {
  // The overview's calendar days, so the two pages' totals agree.
  const since = await loadRangeStart(range, timeZone, now);
  const query = db
    .select({
      automaticPauseCount: gameplayRuns.automaticPauseCount,
      attribution: gameplayRuns.attribution,
      completedRaceTimeMs: gameplayRuns.completedRaceTimeMs,
      deploymentVersion: gameplayRuns.deploymentVersion,
      discardedTimeMs: gameplayRuns.discardedTimeMs,
      endedAt: gameplayRuns.endedAt,
      failureCode: gameplayRuns.failureCode,
      ghost: gameplayRuns.ghost,
      inputFamilies: gameplayRuns.inputFamilies,
      loadedAt: gameplayRuns.loadedAt,
      outcome: gameplayRuns.outcome,
      raceAgain: gameplayRuns.raceAgain,
      racingStartedAt: gameplayRuns.racingStartedAt,
      recoveryCount: gameplayRuns.recoveryCount,
      runtimeLoadTimeMs: gameplayRuns.runtimeLoadTimeMs,
      shared: gameplayRuns.shared,
      startedAt: gameplayRuns.startedAt,
    })
    .from(gameplayRuns);
  // Race times only compare within one course: the current solo course.
  const onCourse = eq(gameplayRuns.courseId, CURRENT_GUEST_COURSE_ID);
  const [runs, accounts] = await Promise.all([
    query.where(
      since ? and(onCourse, gte(gameplayRuns.startedAt, since)) : onCourse,
    ),
    loadSoloPlayAccounts(since),
  ]);

  return aggregateGameplayDashboard(
    runs.map((run) => ({
      ...run,
      failureCode: gameplayRunFailureCodeSchema
        .nullable()
        .parse(run.failureCode),
      ghost: ghostRacedSchema.nullable().parse(run.ghost),
    })),
    range,
    now,
    accounts,
  );
}

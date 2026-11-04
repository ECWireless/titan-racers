import { sql } from "drizzle-orm";

import { db } from "@/db/client";
import { CURRENT_GUEST_COURSE_ID } from "@/game/course/course-ids";
import {
  createOfficialKartRosterDocuments,
  OFFICIAL_KART_IDS,
} from "@/game/kart/official-kart-roster";
import type { AdminOverview } from "@/game/telemetry/admin-overview";
import type { GameplayDashboardRange } from "@/game/telemetry/gameplay-dashboard";

const RANGE_DAYS = { "7d": 7, "30d": 30 } as const;

const OFFICIAL_KART_NAMES = new Map(
  createOfficialKartRosterDocuments().map((document) => [
    document.kartId,
    document.name,
  ]),
);

/**
 * Where a reporting range starts: the first instant in `timeZone` of its
 * first calendar day (today and the six or 29 before it), or null for all
 * time. Where clocks fall back across midnight, midnight happens more than
 * once and Postgres reads the last, so the day before it is searched in the
 * quarter hours clock changes fall on.
 */
export async function loadRangeStart(
  range: GameplayDashboardRange,
  timeZone: string,
  now = new Date(),
): Promise<Date | null> {
  if (range === "all") return null;
  const { rows } = await db.execute<{ since: Date | string }>(sql`
    with day as (
      select date_trunc('day', ${now}::timestamptz at time zone ${timeZone})
        - make_interval(days => ${RANGE_DAYS[range] - 1}) as midnight
    )
    select min(instant) as since
    from day, generate_series(
      (midnight at time zone ${timeZone}) - interval '1 day',
      midnight at time zone ${timeZone},
      interval '15 minutes'
    ) as instant
    where (instant at time zone ${timeZone})::date = midnight::date
  `);
  return new Date(rows[0].since);
}

export async function loadAdminOverview(
  range: GameplayDashboardRange,
  timeZone: string,
  now = new Date(),
  courseId: string = CURRENT_GUEST_COURSE_ID,
): Promise<AdminOverview> {
  const since = await loadRangeStart(range, timeZone, now);
  const bucket = range === "all" ? "week" : "day";
  const unit = sql.raw(`'${bucket}'`);
  const startedSince = since ? sql`and started_at >= ${since}` : sql``;
  const localNow = sql`${now}::timestamptz at time zone ${timeZone}`;

  const [activity, totals, karts, signUps, leaderboard] = await Promise.all([
    db.execute<{
      date: string;
      finished: number;
      signed_in_racers: number;
      started: number;
    }>(sql`
      with runs as (
        select date_trunc(${unit}, started_at at time zone ${timeZone}) as bucket,
          outcome, user_id
        from gameplay_runs
        where course_id = ${courseId} ${startedSince}
      ), buckets as (
        select generate_series(
          coalesce(
            date_trunc(${unit}, ${since}::timestamptz at time zone ${timeZone}),
            (select min(bucket) from runs),
            date_trunc(${unit}, ${localNow})
          ),
          date_trunc(${unit}, ${localNow}),
          ${sql.raw(`interval '1 ${bucket}'`)}
        ) as bucket
      )
      select to_char(buckets.bucket, 'YYYY-MM-DD') as date,
        count(runs.bucket)::int as started,
        count(*) filter (where runs.outcome = 'completed')::int as finished,
        count(distinct runs.user_id)::int as signed_in_racers
      from buckets
      left join runs on runs.bucket = buckets.bucket
      group by buckets.bucket
      order by buckets.bucket
    `),
    db.execute<Record<string, number>>(sql`
      select count(*)::int as started,
        count(*) filter (where outcome = 'completed')::int as finished,
        count(*) filter (where attribution = 'authenticated')::int as signed_in,
        count(distinct user_id)::int as active_racers,
        count(*) filter (where race_again)::int as race_again,
        count(*) filter (where shared)::int as results_shared,
        count(*) filter (where ghost = 'none')::int as ghost_none,
        count(*) filter (where ghost = 'own_best')::int as ghost_own_best,
        count(*) filter (where ghost = 'course_best')::int as ghost_course_best,
        count(*) filter (where ghost = 'shared_link')::int as ghost_shared_link,
        count(*) filter (where ghost = 'leaderboard_racer')::int as ghost_leaderboard_racer
      from gameplay_runs
      where course_id = ${courseId} ${startedSince}
    `),
    db.execute<{ kart_id: string; races: number }>(sql`
      select kart_id, count(*)::int as races
      from gameplay_runs
      where course_id = ${courseId} ${startedSince}
        and kart_id in (${sql.join(
          OFFICIAL_KART_IDS.map((id) => sql`${id}`),
          sql`, `,
        )})
      group by kart_id
    `),
    // Each racer by the login method they joined with (their first);
    // anonymized racers have none left.
    db.execute<{ count: number; provider_id: string }>(sql`
      select provider_id, count(*)::int as count from (
        select distinct on (account.user_id) account.provider_id
        from accounts account
        join users on users.id = account.user_id
        where true ${since ? sql`and users.created_at >= ${since}` : sql``}
        order by account.user_id, account.created_at, account.id
      ) joined
      group by provider_id
    `),
    // A run is a new best if it beat every earlier verified run, the
    // racer's own or the board's, in the order they were submitted.
    db.execute<Record<string, number>>(sql`
      with results as (
        select result.status, result.claimed, result.submitted_at,
          result.time_microseconds,
          min(result.time_microseconds) over (
            partition by result.leaderboard_id, result.user_id
            order by result.submitted_at, result.id
            rows between unbounded preceding and 1 preceding
          ) as own_before,
          min(result.time_microseconds) over (
            partition by result.leaderboard_id
            order by result.submitted_at, result.id
            rows between unbounded preceding and 1 preceding
          ) as board_before
        from race_results result
        join leaderboards board on board.id = result.leaderboard_id
        where board.course_id = ${courseId}
      )
      select count(*) filter (where status = 'verified')::int as verified,
        count(*) filter (where status = 'rejected')::int as rejected,
        count(*) filter (where claimed)::int as after_sign_in,
        count(*) filter (
          where status = 'verified'
            and (own_before is null or time_microseconds < own_before)
        )::int as personal_bests,
        count(*) filter (
          where status = 'verified'
            and (board_before is null or time_microseconds < board_before)
        )::int as course_records
      from results
      where true ${since ? sql`and submitted_at >= ${since}` : sql``}
    `),
  ]);

  const total = totals.rows[0];
  const board = leaderboard.rows[0];
  const joined = (provider: string) =>
    signUps.rows.find((row) => row.provider_id === provider)?.count ?? 0;
  return {
    activity: activity.rows.map((row) => ({
      date: row.date,
      finished: row.finished,
      signedInRacers: row.signed_in_racers,
      started: row.started,
    })),
    bucket,
    ghosts: {
      courseBest: total.ghost_course_best,
      leaderboardRacer: total.ghost_leaderboard_racer,
      none: total.ghost_none,
      ownBest: total.ghost_own_best,
      sharedLink: total.ghost_shared_link,
    },
    karts: OFFICIAL_KART_IDS.map((kartId) => ({
      kartId,
      name: OFFICIAL_KART_NAMES.get(kartId) ?? kartId,
      races: karts.rows.find((row) => row.kart_id === kartId)?.races ?? 0,
    })),
    leaderboard: {
      afterSignIn: board.after_sign_in,
      courseRecords: board.course_records,
      personalBests: board.personal_bests,
      rejected: board.rejected,
      verified: board.verified,
    },
    racers: {
      active: total.active_racers,
      signUps: { google: joined("google"), wallet: joined("siwe") },
    },
    races: {
      finished: total.finished,
      guest: total.started - total.signed_in,
      raceAgain: total.race_again,
      resultsShared: total.results_shared,
      signedIn: total.signed_in,
      started: total.started,
    },
    range,
    timeZone,
  };
}

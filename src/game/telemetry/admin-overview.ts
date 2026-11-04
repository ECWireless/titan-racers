import { z } from "zod";

import { gameplayDashboardRangeSchema } from "./gameplay-dashboard";

const countSchema = z.number().int().nonnegative();

/**
 * The admin's IANA time zone, canonicalized, or null if it is not one.
 * Offsets such as "+05:00" are refused: Postgres reads their sign the other
 * way round. Names start with a letter, as "CET" and "America/Denver" do,
 * and must canonicalize to "UTC" or a Region/City zone, since Postgres reads
 * a bare name such as "CET" as a fixed abbreviation with no summer time.
 */
export function parseReportingTimeZone(value: string): string | null {
  if (value.length > 64 || !/^[A-Za-z][A-Za-z0-9_+-]*(\/[A-Za-z0-9_+-]+)*$/.test(value)) {
    return null;
  }
  try {
    const zone = new Intl.DateTimeFormat("en-US", { timeZone: value }).resolvedOptions()
      .timeZone;
    return zone === "UTC" || zone.includes("/") ? zone : null;
  } catch {
    return null;
  }
}

/**
 * The at-a-glance admin overview: counts only, for the current solo course,
 * over calendar days (weeks for all time) in the admin's time zone.
 */
export const adminOverviewSchema = z.strictObject({
  range: gameplayDashboardRangeSchema,
  timeZone: z.string().min(1).max(64),
  bucket: z.enum(["day", "week"]),
  // Every day (or week, starting Monday) in the range, oldest first.
  activity: z.array(
    z.strictObject({
      date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
      finished: countSchema,
      signedInRacers: countSchema,
      started: countSchema,
    }),
  ),
  races: z.strictObject({
    finished: countSchema,
    guest: countSchema,
    raceAgain: countSchema,
    // Finished races whose link was copied from the results screen.
    resultsShared: countSchema,
    signedIn: countSchema,
    started: countSchema,
  }),
  racers: z.strictObject({
    // Distinct signed-in racers who started a race.
    active: countSchema,
    signUps: z.strictObject({ google: countSchema, wallet: countSchema }),
  }),
  leaderboard: z.strictObject({
    // Guests' runs sent once they signed in, among the verified and rejected.
    afterSignIn: countSchema,
    // Verified runs faster than every earlier run on their board.
    courseRecords: countSchema,
    // Verified runs faster than the racer's earlier runs on their board.
    personalBests: countSchema,
    rejected: countSchema,
    verified: countSchema,
  }),
  // Races per official kart, in roster order.
  karts: z.array(
    z.strictObject({
      kartId: z.string().min(1).max(80),
      name: z.string().min(1).max(80),
      races: countSchema,
    }),
  ),
  ghosts: z.strictObject({
    courseBest: countSchema,
    leaderboardRacer: countSchema,
    none: countSchema,
    ownBest: countSchema,
    sharedLink: countSchema,
  }),
});

export type AdminOverview = z.infer<typeof adminOverviewSchema>;

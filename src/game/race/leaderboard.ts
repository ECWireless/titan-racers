import { z } from "zod";

/** An earlier board's number from `?board=`, or null if it names none. */
export function parseBoardNumber(value: string | null | undefined) {
  if (value === null || value === undefined) return null;
  const number = Number(value);
  return Number.isInteger(number) && number > 0 && number < 2 ** 31
    ? number
    : null;
}

/** A race time, in whole microseconds. */
export const microsecondsSchema = z.number().int().positive();

/**
 * One racer on a board: their best race's time, kart, and fastest lap, and
 * their rank in the list it appears in.
 */
const boardEntrySchema = z.strictObject({
  // Null for a best set before laps were kept.
  fastestLapMicroseconds: microsecondsSchema.nullable(),
  kartName: z.string(),
  rank: z.number().int().positive(),
  timeMicroseconds: microsecondsSchema,
  username: z.string(),
  viewer: z.boolean(),
});

const standingSchema = z.strictObject({
  rank: z.number().int().positive(),
  timeMicroseconds: microsecondsSchema,
});

/**
 * A course's current board (its newest published revision under the current
 * physics), or an earlier one: the top 50 by best time and by fastest lap,
 * the viewer's own standing in each, and the earlier boards with times,
 * newest first, by number and when their times were set.
 */
export const leaderboardResponseSchema = z.strictObject({
  board: z
    .strictObject({
      courseName: z.string(),
      entries: z.array(boardEntrySchema).max(50),
      lapEntries: z.array(boardEntrySchema).max(50),
      viewer: standingSchema
        .extend({ fastestLap: standingSchema.nullable() })
        .nullable(),
    })
    .nullable(),
  earlier: z.array(
    z.strictObject({
      firstTimeAt: z.string().datetime(),
      lastTimeAt: z.string().datetime(),
      number: z.number().int().positive(),
    }),
  ),
});
export type LeaderboardResponse = z.infer<typeof leaderboardResponseSchema>;

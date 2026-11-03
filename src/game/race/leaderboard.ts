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
 * A course's current board (its newest published revision under the current
 * physics), or an earlier one: the top 50 bests and the viewer's own
 * standing, and the earlier boards with times, newest first, by number and
 * when their times were set.
 */
export const leaderboardResponseSchema = z.strictObject({
  board: z
    .strictObject({
      courseName: z.string(),
      entries: z
        .array(
          z.strictObject({
            kartName: z.string(),
            rank: z.number().int().positive(),
            timeMicroseconds: microsecondsSchema,
            username: z.string(),
            viewer: z.boolean(),
          }),
        )
        .max(50),
      viewer: z
        .strictObject({
          rank: z.number().int().positive(),
          timeMicroseconds: microsecondsSchema,
        })
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

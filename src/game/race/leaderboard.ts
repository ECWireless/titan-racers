import { z } from "zod";

const microsecondsSchema = z.number().int().positive();

/**
 * A course's current board (its newest published revision under the current
 * physics): the top 50 bests and the viewer's own standing.
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
});
export type LeaderboardResponse = z.infer<typeof leaderboardResponseSchema>;

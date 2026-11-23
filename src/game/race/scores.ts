import { z } from "zod";

/**
 * The one licence every published kart carries, after RSL 1.0's shape: what
 * others may do with it, and the kind of payment owed. A "use" payment is
 * owed each time the kart earns points: a share of them goes to its
 * assembler. Players never choose or see it; changing the share re-prices
 * every score from then on, since scores are never stored.
 */
export const STANDARD_KART_LICENCE = Object.freeze({
  permits: Object.freeze(["race", "remix"] as const),
  payment: Object.freeze({ type: "use", sharePercent: 10 } as const),
});

/** Points for 1st to 20th on a course's current board, by total time. */
const PLACE_POINTS = Object.freeze([
  300, 250, 210, 180, 160, 150, 140, 130, 120, 110, 100, 90, 80, 70, 60, 50,
  40, 30, 20, 10,
]);

export const SCORING_PLACES = PLACE_POINTS.length;

/** A place's points; nothing outside the top 20. */
export function pointsForPlace(place: number) {
  return PLACE_POINTS[place - 1] ?? 0;
}

/** A place's points, split between the racer and the kart's assembler. */
export function splitPoints(points: number) {
  const assembler = Math.floor(
    (points * STANDARD_KART_LICENCE.payment.sharePercent) / 100,
  );
  return { assembler, racer: points - assembler };
}

const scoreSchema = z.number().int().nonnegative();

/**
 * Every racer with a score, ranked (equal scores share a rank), the
 * viewer's own score if signed in, and the courses whose boards count.
 * What karts earn their assemblers stays on the server.
 */
export const scoreBoardResponseSchema = z.strictObject({
  courses: z.array(
    z.strictObject({ courseId: z.string(), courseName: z.string() }),
  ),
  entries: z.array(
    z.strictObject({
      rank: z.number().int().positive(),
      score: scoreSchema.positive(),
      username: z.string(),
      viewer: z.boolean(),
    }),
  ),
  // Null for a guest; a rank only with a score.
  viewer: z
    .strictObject({
      rank: z.number().int().positive().nullable(),
      score: scoreSchema,
    })
    .nullable(),
});
export type ScoreBoardResponse = z.infer<typeof scoreBoardResponseSchema>;

/** The score board, with what each official kart has earned its assembler. */
export type ScoreBoard = ScoreBoardResponse & {
  karts: { kartId: string; royalties: number }[];
};

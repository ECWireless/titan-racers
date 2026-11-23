/** The score board's page, which the leaderboard opens on. */
export const SCORE_BOARD_PATH = "/leaderboard";

/**
 * A course's race leaderboard: its current board, or an earlier one by its
 * number, ranked by total time or by fastest lap.
 */
export function courseBoardPath(
  courseId: string,
  { board = null, byLap = false }: { board?: number | null; byLap?: boolean } = {},
) {
  const query = new URLSearchParams({ course: courseId });
  if (board !== null) query.set("board", String(board));
  if (byLap) query.set("sort", "lap");
  return `${SCORE_BOARD_PATH}?${query}`;
}

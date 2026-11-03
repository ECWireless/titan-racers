import { LeaderboardView } from "@/components/leaderboard-view";
import { parseBoardNumber } from "@/game/race/leaderboard";

export default async function LeaderboardPage({
  searchParams,
}: {
  searchParams: Promise<{ board?: string | string[] }>;
}) {
  const { board } = await searchParams;
  return (
    <LeaderboardView
      boardNumber={parseBoardNumber(Array.isArray(board) ? board[0] : board)}
    />
  );
}

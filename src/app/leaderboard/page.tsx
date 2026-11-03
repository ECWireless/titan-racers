import { LeaderboardView } from "@/components/leaderboard-view";

export default async function LeaderboardPage({
  searchParams,
}: {
  searchParams: Promise<{ board?: string | string[] }>;
}) {
  const { board } = await searchParams;
  const number = Number(Array.isArray(board) ? board[0] : board);
  return (
    <LeaderboardView
      boardNumber={Number.isInteger(number) && number > 0 ? number : null}
    />
  );
}

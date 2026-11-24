import { LeaderboardView } from "@/components/leaderboard-view";

// The view reads its address itself (the score board, or `?course=` with
// `?board=` and `?sort=`), on the server too, so it renders per request.
export const dynamic = "force-dynamic";

export default function LeaderboardPage() {
  return <LeaderboardView />;
}

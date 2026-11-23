"use client";

import Link from "next/link";

import { SCORE_BOARD_PATH } from "@/lib/leaderboard-path";
import { useScores } from "@/lib/scores-client";

/**
 * The account's score and its place on the score board. Left out until the
 * scores arrive, and if they cannot be loaded.
 */
export function ProfileScore() {
  const viewer = useScores()?.viewer;
  if (!viewer) return null;
  return (
    <section
      aria-label="Your score"
      className="flex items-end justify-between gap-4 border border-titan-ice/18 bg-titan-black px-5 py-4"
    >
      <span className="grid gap-1.5">
        <span className="font-mono text-xs font-bold uppercase tracking-[0.16em] text-titan-muted">
          Your score
        </span>
        <span className="font-mono text-4xl font-bold leading-none tabular-nums">
          {viewer.score}
        </span>
      </span>
      <span className="grid justify-items-end gap-2 text-right">
        {viewer.rank === null ? (
          <span className="text-sm leading-6 text-titan-ice/76">
            Set a top-20 time on any course to get a score.
          </span>
        ) : (
          <span className="font-mono text-sm font-bold tabular-nums">
            Rank {viewer.rank}
          </span>
        )}
        <Link
          className="font-mono text-xs font-bold uppercase tracking-[0.16em] text-titan-hazard underline-offset-4 hover:underline"
          href={SCORE_BOARD_PATH}
        >
          High scores
        </Link>
      </span>
    </section>
  );
}

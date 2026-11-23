"use client";

import Link from "next/link";
import { useRef } from "react";

import type { ScoreBoardResponse } from "@/game/race/scores";
import { SCORE_BOARD_PATH } from "@/lib/leaderboard-path";
import { racerOnboardingPath } from "@/lib/racer-username";

import { type HeldRunOutcome, HeldRunStatus } from "./held-run-status";

export type ScoresState =
  | { status: "loading" }
  | { status: "unavailable" }
  | { scores: ScoreBoardResponse; status: "ready" };

const LABEL_CLASS =
  "font-mono text-[0.68rem] font-bold uppercase tracking-[0.16em]";
// The viewer's own, wherever it shows: a hazard edge on a hazard wash.
const OWN_CLASS = "bg-titan-hazard/8 shadow-[inset_2px_0_0_var(--titan-hazard)]";
const NOTE_CLASS =
  "border-y border-titan-ice/12 px-3 py-4 text-center font-mono text-sm text-titan-muted";

function ArrowDownIcon() {
  return (
    <svg
      aria-hidden="true"
      className="size-3.5 shrink-0"
      fill="none"
      stroke="currentColor"
      strokeLinecap="square"
      strokeWidth={2}
      viewBox="0 0 24 24"
    >
      <path d="M12 4.5v15M6 13.5l6 6 6-6" />
    </svg>
  );
}

/**
 * The viewer's own score, above the list: with a place, it also takes them
 * to their row; without one, it says how to get on the board.
 */
function ViewerScore({
  onShowRow,
  racers,
  viewer,
}: {
  onShowRow: () => void;
  racers: number;
  viewer: NonNullable<ScoreBoardResponse["viewer"]>;
}) {
  const score = (
    <span className="grid gap-1.5">
      <span className={`${LABEL_CLASS} text-titan-hazard`}>Your score</span>
      <span className="font-mono text-4xl font-bold leading-none tabular-nums">
        {viewer.score}
      </span>
    </span>
  );
  if (viewer.rank === null) {
    return (
      <div
        className={`grid grid-cols-[1fr_auto] items-center gap-x-5 gap-y-3 border border-titan-ice/18 px-4 py-3 sm:grid-cols-[auto_1fr_auto] ${OWN_CLASS}`}
      >
        {score}
        {/* Under the score on a phone, beside it on a wide screen. */}
        <p className="order-last col-span-2 text-sm leading-6 text-titan-ice/76 sm:order-none sm:col-span-1">
          Set a top-20 time on any course to get a score.
        </p>
        <Link className="titan-button titan-button-primary" href="/">
          Race
        </Link>
      </div>
    );
  }
  return (
    <button
      aria-label={`Your score: ${viewer.score}, rank ${viewer.rank} of ${racers}. Show your row`}
      className={`group flex items-end justify-between gap-4 border border-titan-ice/18 px-4 py-3 text-left transition hover:border-titan-ice/50 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-titan-hazard motion-reduce:transition-none ${OWN_CLASS}`}
      type="button"
      onClick={onShowRow}
    >
      {score}
      <span className="grid justify-items-end gap-2">
        <span className="font-mono text-sm font-bold tabular-nums">
          Rank {viewer.rank}
          <span className="text-titan-ice/60"> of {racers}</span>
        </span>
        <span
          className={`${LABEL_CLASS} flex items-center gap-1.5 text-titan-ice/60 transition group-hover:text-titan-ice motion-reduce:transition-none`}
        >
          Show my row
          <ArrowDownIcon />
        </span>
      </span>
    </button>
  );
}

/**
 * Every account with a score, ranked: equal scores share a rank. No medals,
 * which are for a race's result. The viewer's own row is marked, and their
 * score sits above the list, where it also shows a score of none.
 */
export function ScoreBoard({
  heldRun,
  state,
}: {
  /** What became of a run kept from before signing in, if there was one. */
  heldRun: HeldRunOutcome | null;
  state: ScoresState;
}) {
  const viewerRowRef = useRef<HTMLLIElement>(null);
  function showViewerRow() {
    const row = viewerRowRef.current;
    if (!row) return;
    row.scrollIntoView({
      behavior: window.matchMedia("(prefers-reduced-motion: reduce)").matches
        ? "auto"
        : "smooth",
      block: "center",
    });
    row.focus({ preventScroll: true });
  }
  const scores = state.status === "ready" ? state.scores : null;

  return (
    <>
      <div className="grid gap-3">
        {/* As tall as a course board's label, so the title stays put. */}
        <p className="flex min-h-9 items-center font-mono text-xs font-bold uppercase tracking-[0.2em] text-titan-muted">
          Leaderboard
        </p>
        <h1 className="text-[2.5rem] font-bold uppercase leading-[0.95] tracking-[-0.01em] sm:text-7xl">
          High scores
        </h1>
        <p className="max-w-xl text-sm leading-6 text-titan-ice/76">
          Scores come from the top 20 on each course&apos;s current
          leaderboard: the higher you place, the higher your score. Your total
          can fall when someone passes you.
        </p>
      </div>

      <HeldRunStatus outcome={heldRun} />

      {state.status === "loading" ? (
        <p className="font-mono text-sm text-titan-ice/70" role="status">
          Loading scores…
        </p>
      ) : !scores ? (
        <p className="text-sm text-titan-ice/76" role="alert">
          High scores are unavailable right now.
        </p>
      ) : (
        <div className="grid gap-3">
          {scores.viewer ? (
            <ViewerScore
              racers={scores.entries.length}
              viewer={scores.viewer}
              onShowRow={showViewerRow}
            />
          ) : heldRun && "reason" in heldRun.note && heldRun.note.reason !== "failed" ? null : (
            // A guest's kept run already asks them to sign in.
            <div className="flex items-center justify-between gap-4 border border-titan-ice/18 bg-titan-black px-4 py-3">
              <p className="text-sm leading-6 text-titan-ice/76">
                Sign in to get a score of your own.
              </p>
              <Link
                className="titan-button titan-button-secondary shrink-0"
                href={racerOnboardingPath(SCORE_BOARD_PATH)}
              >
                Sign in
              </Link>
            </div>
          )}
          {scores.entries.length === 0 ? (
            <p className={NOTE_CLASS}>No scores yet</p>
          ) : (
            <ol aria-label="High scores" className="grid border-t border-titan-ice/12">
              {scores.entries.map((entry) => (
                <li
                  aria-current={entry.viewer ? "true" : undefined}
                  // With no buttons, the rows themselves are the stops down
                  // the board, starting on your own.
                  className={`grid grid-cols-[2rem_1fr_auto] items-center gap-2 border-b border-titan-ice/12 px-2 py-3 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-titan-hazard sm:gap-3 sm:px-3 ${
                    entry.viewer ? OWN_CLASS : "bg-titan-black/60"
                  }`}
                  data-controller-default={entry.viewer ? "true" : undefined}
                  key={entry.username}
                  ref={entry.viewer ? viewerRowRef : undefined}
                  tabIndex={0}
                >
                  <span className="text-center font-mono text-sm font-bold tabular-nums text-titan-ice/70">
                    {entry.rank}
                  </span>
                  <span className="flex min-w-0 items-center gap-2">
                    <span className="truncate font-bold">@{entry.username}</span>
                    {entry.viewer ? (
                      <span className="border border-titan-hazard/60 px-1.5 py-0.5 text-[0.62rem] font-bold uppercase tracking-[0.14em] text-titan-hazard">
                        You
                      </span>
                    ) : null}
                  </span>
                  <span className="font-mono text-base font-bold tabular-nums">
                    {entry.score}
                  </span>
                </li>
              ))}
            </ol>
          )}
        </div>
      )}
    </>
  );
}

import Link from "next/link";

import type { HeldRunNote, HeldRunWait } from "@/game/race/held-run";
import { formatRaceTime } from "@/game/race/race-presentation";
import { racerOnboardingPath } from "@/lib/racer-username";

const time = (microseconds: number) => formatRaceTime(microseconds, 3);

export type HeldRunOutcome = {
  /** Its course's board, where signing in comes back to. */
  boardPath: string;
  /** Named on the score board, whose ranks are its own. */
  courseName?: string;
  note: HeldRunNote | HeldRunWait;
};

/**
 * What became of a run held from a race before signing in. Always rendered,
 * so screen readers announce the outcome when it arrives.
 */
export function HeldRunStatus({ outcome }: { outcome: HeldRunOutcome | null }) {
  return (
    <div
      className={
        outcome
          ? "border border-titan-ice/18 bg-titan-black px-4 py-3"
          : "sr-only"
      }
      role="status"
    >
      {outcome ? <Outcome {...outcome} /> : null}
    </div>
  );
}

function Outcome({ boardPath, courseName, note }: HeldRunOutcome) {
  const run = time(note.timeMicroseconds);
  const board = courseName ? `${courseName}'s leaderboard` : "the leaderboard";
  if ("reason" in note) {
    if (note.reason === "failed") {
      return (
        <p className="text-sm leading-6 text-titan-ice/76">
          Your {run} couldn&apos;t be sent. We&apos;ll try again next time you
          open the leaderboard.
        </p>
      );
    }
    return (
      <div className="flex flex-wrap items-center justify-between gap-3">
        <p className="text-sm leading-6 text-titan-ice/76">
          {note.reason === "login"
            ? `Sign in to put your ${run} on ${board}.`
            : `Choose a username to put your ${run} on ${board}.`}
        </p>
        <Link
          className="titan-button titan-button-secondary"
          href={racerOnboardingPath(boardPath)}
        >
          {note.reason === "login" ? "Sign in" : "Choose username"}
        </Link>
      </div>
    );
  }
  if (note.status === "verified") {
    const { entries, personalBest, rank } = note;
    return (
      <p className="text-sm leading-6">
        {personalBest.improved
          ? `Your ${time(personalBest.timeMicroseconds)} is on ${board}, rank ${rank} of ${entries}.`
          : `Your ${run} is saved. Your best, ${time(personalBest.timeMicroseconds)}, ranks ${rank} of ${entries}.`}
      </p>
    );
  }
  return (
    <p className="text-sm leading-6 text-titan-ice/76">
      {note.status === "rejected"
        ? `We couldn't verify your ${run}, so it isn't on ${board}.`
        : note.status === "expired"
          ? `Your ${run} wasn't added in time, so it isn't on ${board}.`
          : `Your ${run} couldn't be added to ${board}.`}
    </p>
  );
}

import Link from "next/link";

import { formatRaceTime } from "@/game/race/race-presentation";
import { MEDAL_LABELS, medalForRank } from "@/game/race/race-medals";
import type { RunSubmissionResponse } from "@/game/race/run-submission";

/** A finished run's leaderboard standing, or where it stands in getting one. */
export type RunStanding =
  | RunSubmissionResponse
  | { status: "failed" }
  | { status: "pending" }
  | { status: "username" };

const NOTES = {
  failed: "This run could not be submitted.",
  pending: "Verifying run…",
  rejected: "This run could not be verified.",
};

function NewTag() {
  return (
    <span className="ml-2 border border-titan-hazard/60 px-1.5 py-0.5 text-[0.62rem] font-bold uppercase tracking-[0.14em] text-titan-hazard">
      New
    </span>
  );
}

function StandingRow({
  label,
  children,
}: {
  label: string;
  children: React.ReactNode;
}) {
  return (
    <div className="flex items-center justify-between gap-4">
      <dt className="uppercase tracking-[0.12em] text-titan-ice/60">{label}</dt>
      <dd className="font-bold tabular-nums">{children}</dd>
    </div>
  );
}

/**
 * Always rendered while the result is open, so screen readers announce the
 * standing when it fills in.
 */
export function RunStandingSummary({
  standing,
}: {
  standing: RunStanding | null;
}) {
  let content: React.ReactNode = null;
  if (standing?.status === "verified") {
    const medal = medalForRank(standing.rank);
    content = (
      <>
        <dl className="grid gap-2">
          <StandingRow label="Rank">
            {standing.rank} of {standing.entries}
          </StandingRow>
          <StandingRow label="Personal best">
            {formatRaceTime(standing.personalBest.timeMicroseconds, 3)}
            {standing.personalBest.improved ? <NewTag /> : null}
          </StandingRow>
          {medal ? (
            <StandingRow label="Medal">{MEDAL_LABELS[medal]}</StandingRow>
          ) : null}
        </dl>
        <Link
          className="justify-self-center text-xs font-bold uppercase tracking-[0.16em] text-titan-hazard underline-offset-4 hover:underline"
          href="/leaderboard"
        >
          Leaderboard
        </Link>
      </>
    );
  } else if (standing) {
    content = (
      <p className="text-xs leading-5 text-titan-ice/70">
        {standing.status === "username" ? (
          <>
            Choose a username in your{" "}
            <Link className="text-titan-hazard underline" href="/profile">
              profile
            </Link>{" "}
            to rank your runs.
          </>
        ) : (
          NOTES[standing.status]
        )}
      </p>
    );
  }
  return (
    <div
      className={
        content
          ? "grid gap-2 border-b border-titan-ice/15 pb-3 text-sm"
          : "sr-only"
      }
      role="status"
    >
      {content}
    </div>
  );
}

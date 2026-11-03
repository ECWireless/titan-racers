import Link from "next/link";

import { racerOnboardingPath } from "@/lib/racer-username";
import { formatRaceTime } from "@/game/race/race-presentation";
import { MEDAL_LABELS, medalForRank } from "@/game/race/race-medals";
import type {
  RunSubmissionResponse,
  UnnamedTicketReason,
} from "@/game/race/run-submission";

/** A finished run's leaderboard standing, or where it stands in getting one. */
export type RunStanding =
  | RunSubmissionResponse
  | { status: "failed" }
  | {
      /** When the waiting run can no longer go on the board. */
      expiresAt: number;
      /** A faster run already waiting, which is the one that will count. */
      heldTimeMicroseconds: number | null;
      reason: UnnamedTicketReason;
      status: "held";
    }
  | { status: "pending" };

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
          <StandingRow label="Board rank">
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
          View leaderboard
        </Link>
      </>
    );
  } else if (standing?.status === "held") {
    const time =
      standing.heldTimeMicroseconds === null
        ? "this time"
        : `your best, ${formatRaceTime(standing.heldTimeMicroseconds, 3)},`;
    content = (
      <div className="grid gap-3 border border-titan-hazard/70 bg-titan-hazard/10 p-4">
        <p className="text-base font-bold leading-6 text-titan-ice">
          {standing.reason === "login"
            ? `Sign in to put ${time} on the leaderboard.`
            : `Choose a username to put ${time} on the leaderboard.`}
        </p>
        <p className="font-mono text-xs font-bold uppercase tracking-[0.14em] text-titan-hazard">
          Kept until{" "}
          {new Date(standing.expiresAt).toLocaleTimeString([], {
            hour: "numeric",
            minute: "2-digit",
          })}
        </p>
        <Link
          className="titan-button titan-button-primary"
          href={racerOnboardingPath("/leaderboard")}
        >
          {standing.reason === "login" ? "Sign in" : "Choose username"}
        </Link>
      </div>
    );
  } else if (standing) {
    content = (
      <p className="text-xs leading-5 text-titan-ice/70">
        {NOTES[standing.status]}
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

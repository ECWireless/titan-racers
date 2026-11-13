import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";

import {
  ANONYMOUS_START_FAILURES,
  continueAnonymously,
} from "@/lib/browser-racer";
import { racerOnboardingPath } from "@/lib/racer-username";
import { MedalIcon } from "@/components/medal-icon";
import { OrDivider } from "@/components/or-divider";
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

const HELD_RUN_PATH = racerOnboardingPath("/leaderboard");

// Instead of signing in, a guest can start a racer kept in this browser;
// choosing a username then puts the waiting run on the board.
function ContinueAnonymously() {
  const router = useRouter();
  const [pending, setPending] = useState(false);
  const [failure, setFailure] = useState<string | null>(null);
  async function start() {
    setPending(true);
    setFailure(null);
    const started = await continueAnonymously();
    if (started === "started") {
      router.push(HELD_RUN_PATH);
      return;
    }
    setFailure(ANONYMOUS_START_FAILURES[started]);
    setPending(false);
  }
  return (
    <>
      <OrDivider />
      <button
        className="titan-button titan-button-secondary"
        disabled={pending}
        type="button"
        onClick={() => void start()}
      >
        {pending ? "Starting…" : "Continue anonymously"}
      </button>
      {failure ? (
        <p className="text-xs leading-5 text-red-300" role="alert">
          {failure}
        </p>
      ) : null}
    </>
  );
}

function NewTag() {
  return (
    <span className="ml-2 border border-titan-ice/50 px-1.5 py-0.5 text-[0.62rem] font-bold uppercase tracking-[0.14em] text-titan-ice">
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
      <dt className="uppercase tracking-[0.12em] text-titan-muted">{label}</dt>
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
            <StandingRow label="Medal">
              <span className="inline-flex items-center gap-2">
                <MedalIcon decorative rank={standing.rank} tier={medal} />
                {MEDAL_LABELS[medal]}
              </span>
            </StandingRow>
          ) : null}
        </dl>
        <Link
          className="justify-self-center text-xs font-bold uppercase tracking-[0.16em] text-titan-ice underline decoration-titan-ice/40 underline-offset-4 transition hover:text-titan-hazard hover:decoration-titan-hazard focus-visible:text-titan-hazard focus-visible:outline-none"
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
      <div className="grid gap-3 border border-titan-ice/18 p-4">
        <p className="text-base font-bold leading-6 text-titan-ice">
          {standing.reason === "login"
            ? `Sign in to put ${time} on the leaderboard.`
            : `Choose a username to put ${time} on the leaderboard.`}
        </p>
        <p className="font-mono text-xs font-bold uppercase tracking-[0.14em] text-titan-muted">
          Kept until{" "}
          {new Date(standing.expiresAt).toLocaleTimeString([], {
            hour: "numeric",
            minute: "2-digit",
          })}
        </p>
        <Link className="titan-button titan-button-primary" href={HELD_RUN_PATH}>
          {standing.reason === "login" ? "Sign in" : "Choose username"}
        </Link>
        {standing.reason === "login" ? <ContinueAnonymously /> : null}
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

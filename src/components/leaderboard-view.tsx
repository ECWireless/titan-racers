"use client";

import Image from "next/image";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { type ReactNode, useEffect, useRef, useState } from "react";

import { FALLS_VIEW_PARK_COURSE_ID } from "@/game/course/course-ids";
import {
  type HeldRunNote,
  type HeldRunWait,
  sendHeldRun,
  takeHeldRunNote,
} from "@/game/race/held-run";
import { useControllerMenuNavigation } from "@/game/input/use-controller-menu-navigation";
import {
  type LeaderboardResponse,
  leaderboardResponseSchema,
} from "@/game/race/leaderboard";
import { medalForRank } from "@/game/race/race-medals";
import { formatRaceTime } from "@/game/race/race-presentation";
import { racerOnboardingPath } from "@/lib/racer-username";
import { copyLink, ghostLinkUrl, shareNoteFor } from "@/lib/share-link";

import { MedalIcon } from "./medal-icon";
import { CheckIcon, CopyLinkIcon, RaceGhostIcon } from "./menu-icons";

type BoardState =
  | { status: "loading" }
  | { status: "unavailable" }
  | { leaderboard: LeaderboardResponse; status: "ready" };

async function loadBoard(): Promise<BoardState> {
  try {
    const response = await fetch(`/api/leaderboards/${FALLS_VIEW_PARK_COURSE_ID}`, {
      cache: "no-store",
    });
    if (!response.ok) return { status: "unavailable" };
    return {
      leaderboard: leaderboardResponseSchema.parse(await response.json()),
      status: "ready",
    };
  } catch {
    return { status: "unavailable" };
  }
}

const time = (microseconds: number) => formatRaceTime(microseconds, 3);

// The editors' tooltip look, shown above a row's button.
const HINT_CLASS =
  "pointer-events-none absolute bottom-full left-1/2 z-10 mb-2 w-max -translate-x-1/2 border border-titan-ice/20 bg-titan-black/96 px-2 py-1.5 text-[0.62rem] font-bold uppercase tracking-[0.08em] text-titan-ice shadow-[0_8px_30px_rgb(0_0_0/0.6)] transition-opacity duration-150";

/**
 * A tooltip over a row's button, on hover or focus, or while `shown`. It is
 * hidden from screen readers, which hear the button's own name.
 */
function RowActionHint({
  children,
  hint,
  shown = false,
}: {
  children: ReactNode;
  hint: string;
  shown?: boolean;
}) {
  return (
    <span className="group relative">
      {children}
      <span
        aria-hidden="true"
        className={`${HINT_CLASS} ${
          shown
            ? "opacity-100"
            : "opacity-0 group-has-[:focus-visible]:opacity-100 group-hover:opacity-100"
        }`}
      >
        {hint}
      </span>
    </span>
  );
}

const rowActionClass =
  "grid size-10 place-items-center border border-titan-ice/20 text-titan-ice/76 transition hover:border-titan-hazard hover:text-titan-hazard focus-visible:border-titan-hazard focus-visible:text-titan-hazard focus-visible:outline-none";

/** What became of a run held from a race before signing in. */
function HeldRunStatus({ note }: { note: HeldRunNote | HeldRunWait }) {
  const run = time(note.timeMicroseconds);
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
            ? `Sign in to put your ${run} on the leaderboard.`
            : `Choose a username to put your ${run} on the leaderboard.`}
        </p>
        <Link
          className="titan-button titan-button-secondary"
          href={racerOnboardingPath("/leaderboard")}
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
          ? `Your ${time(personalBest.timeMicroseconds)} is on the leaderboard, rank ${rank} of ${entries}.`
          : `Your ${run} is saved. Your best, ${time(personalBest.timeMicroseconds)}, ranks ${rank} of ${entries}.`}
      </p>
    );
  }
  return (
    <p className="text-sm leading-6 text-titan-ice/76">
      {note.status === "rejected"
        ? `We couldn't verify your ${run}, so it isn't on the leaderboard.`
        : note.status === "expired"
          ? `Your ${run} wasn't added in time, so it isn't on the leaderboard.`
          : `Your ${run} couldn't be added to the leaderboard.`}
    </p>
  );
}

export function LeaderboardView() {
  const router = useRouter();
  const mainRef = useRef<HTMLElement>(null);
  const [state, setState] = useState<BoardState>({ status: "loading" });
  // Announces a copy to screen readers; the copied row shows it itself.
  const [copyNote, setCopyNote] = useState<string | null>(null);
  const [copiedUsername, setCopiedUsername] = useState<string | null>(null);
  const copiedTimerRef = useRef<number | null>(null);
  const [heldRunNote, setHeldRunNote] = useState<
    HeldRunNote | HeldRunWait | null
  >(null);
  useControllerMenuNavigation({
    containerRef: mainRef,
    enabled: true,
    keyboard: true,
    navigationMode: "spatial",
    onBack: () => router.push("/"),
  });

  useEffect(() => {
    let active = true;
    void (async () => {
      // A run held from before signing in goes first, so the board has it.
      const wait = await sendHeldRun().catch(() => null);
      const next = await loadBoard();
      if (!active) return;
      setHeldRunNote(takeHeldRunNote() ?? wait);
      setState(next);
    })();
    return () => {
      active = false;
    };
  }, []);

  const board = state.status === "ready" ? state.leaderboard.board : null;

  async function copyGhostLink(username: string) {
    // Cleared first, so a repeated note is announced again.
    setCopyNote(null);
    const outcome = await copyLink(ghostLinkUrl(username));
    setCopyNote(shareNoteFor(outcome));
    if (outcome !== "copied") return;
    setCopiedUsername(username);
    if (copiedTimerRef.current !== null) {
      window.clearTimeout(copiedTimerRef.current);
    }
    copiedTimerRef.current = window.setTimeout(() => {
      copiedTimerRef.current = null;
      setCopiedUsername(null);
    }, 1_600);
  }

  useEffect(
    () => () => {
      if (copiedTimerRef.current !== null) {
        window.clearTimeout(copiedTimerRef.current);
      }
    },
    [],
  );
  const viewerListed = board?.entries.some((entry) => entry.viewer) ?? false;

  return (
    <main
      className="relative grid min-h-screen place-items-center overflow-hidden bg-titan-black px-5 py-10 text-titan-ice"
      ref={mainRef}
    >
      <div className="absolute inset-0 bg-[radial-gradient(circle_at_50%_18%,rgb(52_64_74/0.42),transparent_46%),linear-gradient(145deg,rgb(7_7_6),rgb(20_18_15))]" />
      <section className="relative grid w-full max-w-2xl gap-7 border border-titan-ice/20 bg-titan-black/88 p-6 shadow-[0_28px_100px_rgb(0_0_0/0.62)] sm:p-9">
        <header className="flex flex-wrap items-center justify-between gap-5">
          <Link
            aria-label="Back to racing"
            className="focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-titan-hazard"
            href="/"
          >
            <Image
              src="/titan-racers-logo.png"
              alt="Titan Racers"
              width={300}
              height={60}
              priority
              className="h-10 w-auto sm:h-12"
            />
          </Link>
          <Link
            className="titan-button titan-button-secondary"
            data-ui-sound="back"
            href="/"
          >
            Back
          </Link>
        </header>

        <div className="grid gap-3">
          <p className="font-mono text-xs font-bold uppercase tracking-[0.22em] text-titan-hazard">
            Leaderboard
          </p>
          <h1 className="text-4xl font-black uppercase tracking-[-0.04em] sm:text-5xl">
            {board?.courseName ?? "Falls View Park"}
          </h1>
        </div>

        <div
          className={
            heldRunNote
              ? "border border-titan-hazard/50 bg-titan-hazard/6 px-4 py-3"
              : "sr-only"
          }
          role="status"
        >
          {heldRunNote ? <HeldRunStatus note={heldRunNote} /> : null}
        </div>

        {state.status === "loading" ? (
          <p className="font-mono text-sm text-titan-ice/70" role="status">
            Loading leaderboard…
          </p>
        ) : state.status === "unavailable" ? (
          <p className="text-sm text-titan-ice/76" role="alert">
            The leaderboard is unavailable right now.
          </p>
        ) : !board || board.entries.length === 0 ? (
          <p className="border border-titan-ice/10 px-3 py-4 text-center font-mono text-sm text-titan-ice/60">
            No times yet
          </p>
        ) : (
          <ol aria-label="Best times" className="grid gap-1">
            {board.entries.map((entry) => {
              const medal = medalForRank(entry.rank);
              return (
              <li
                aria-current={entry.viewer ? "true" : undefined}
                className={`grid grid-cols-[2rem_1fr_auto_auto] items-center gap-2 border px-2 py-2 focus-within:border-titan-hazard sm:gap-3 sm:px-3 ${
                  entry.viewer
                    ? "border-titan-hazard/70 bg-titan-hazard/8"
                    : "border-titan-ice/10"
                }`}
                key={entry.rank}
              >
                {medal ? (
                  <MedalIcon rank={entry.rank} tier={medal} />
                ) : (
                  <span className="text-center font-mono text-sm font-bold tabular-nums text-titan-ice/72">
                    {entry.rank}
                  </span>
                )}
                <span className="grid min-w-0">
                  <span className="truncate font-bold">@{entry.username}</span>
                  <span className="truncate text-xs text-titan-ice/60">
                    {entry.kartName}
                  </span>
                </span>
                <span className="font-mono text-sm font-bold tabular-nums">
                  {time(entry.timeMicroseconds)}
                </span>
                <span className="flex gap-1">
                  <RowActionHint hint="Race ghost">
                    {/* Each row's one stop on the way down the board,
                        starting on your own; Copy link is to its right. */}
                    <Link
                      aria-label={`Race @${entry.username}'s ghost`}
                      className={rowActionClass}
                      data-controller-default={entry.viewer ? "true" : undefined}
                      href={`/?ghost=${encodeURIComponent(entry.username)}&from=leaderboard`}
                    >
                      <RaceGhostIcon />
                    </Link>
                  </RowActionHint>
                  <RowActionHint
                    hint={
                      copiedUsername === entry.username
                        ? "Copied"
                        : "Copy ghost link"
                    }
                    shown={copiedUsername === entry.username}
                  >
                    <button
                      aria-label={`Copy @${entry.username}'s ghost link`}
                      className={rowActionClass}
                      type="button"
                      onClick={() => void copyGhostLink(entry.username)}
                    >
                      {copiedUsername === entry.username ? (
                        <CheckIcon />
                      ) : (
                        <CopyLinkIcon />
                      )}
                    </button>
                  </RowActionHint>
                </span>
              </li>
              );
            })}
          </ol>
        )}

        <p
          className="sr-only"
          aria-live="polite"
        >
          {copyNote}
        </p>

        {board?.viewer && !viewerListed ? (
          <p
            className="font-mono text-sm text-titan-ice/76 outline-none focus-visible:text-titan-hazard"
            data-controller-default="true"
            tabIndex={0}
          >
            Your best: {time(board.viewer.timeMicroseconds)}, rank{" "}
            {board.viewer.rank}
          </p>
        ) : null}
      </section>
    </main>
  );
}

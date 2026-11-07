"use client";

import Image from "next/image";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { useEffect, useRef, useState } from "react";

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
import { copyLink, ghostLinkUrl, copyNoteFor } from "@/lib/share-link";

import { ActionHint } from "./action-hint";
import { MedalIcon } from "./medal-icon";
import {
  BackIcon,
  CheckIcon,
  CopyLinkIcon,
  CourseVersionsIcon,
  RaceGhostIcon,
} from "./menu-icons";

type BoardState =
  | { status: "loading" }
  // An earlier board this link names no longer has times to show.
  | { status: "missing" }
  | { status: "unavailable" }
  | { leaderboard: LeaderboardResponse; status: "ready" };

/** The current board when null, or an earlier one by its number. */
async function loadBoard(boardNumber: number | null): Promise<BoardState> {
  try {
    const response = await fetch(
      `/api/leaderboards/${FALLS_VIEW_PARK_COURSE_ID}${
        boardNumber === null ? "" : `?board=${boardNumber}`
      }`,
      { cache: "no-store" },
    );
    if (response.status === 404 && boardNumber !== null) {
      return { status: "missing" };
    }
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

/** A board's page, current when `number` is null, ranked by lap or time. */
function boardHref(number: number | null, byLap: boolean) {
  const query = new URLSearchParams();
  if (number !== null) query.set("board", String(number));
  if (byLap) query.set("sort", "lap");
  const search = query.toString();
  return search ? `/leaderboard?${search}` : "/leaderboard";
}

const RANKINGS = [
  { byLap: false, label: "Total time" },
  { byLap: true, label: "Fastest lap" },
] as const;

/** When an earlier board's times were set, as "2–3 Nov" in the racer's locale. */
function timesSetBetween(board: LeaderboardResponse["earlier"][number]) {
  const first = new Date(board.firstTimeAt);
  const last = new Date(board.lastTimeAt);
  const thisYear = new Date().getFullYear();
  return new Intl.DateTimeFormat(undefined, {
    day: "numeric",
    month: "short",
    ...(first.getFullYear() === thisYear && last.getFullYear() === thisYear
      ? {}
      : { year: "numeric" }),
  }).formatRange(first, last);
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

/**
 * The current board, or an earlier course version's after a new leaderboard
 * started: read-only, so its times are honoured without racing an older
 * layout. Earlier versions sit behind a quiet icon by the course name.
 */
export function LeaderboardView({ boardNumber }: { boardNumber: number | null }) {
  const router = useRouter();
  // Both rankings are loaded, so switching only rewrites the address.
  const byLap = useSearchParams().get("sort") === "lap";
  const mainRef = useRef<HTMLElement>(null);
  // The board loaded for a choice; switching shows loading until it comes.
  const [loaded, setLoaded] = useState<{
    boardNumber: number | null;
    state: BoardState;
  } | null>(null);
  const state: BoardState =
    loaded?.boardNumber === boardNumber ? loaded.state : { status: "loading" };
  const [earlierOpen, setEarlierOpen] = useState(false);
  const earlierButtonRef = useRef<HTMLButtonElement>(null);
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
    // Back closes the earlier versions' list first.
    onBack: () => {
      if (!earlierOpen) {
        router.push("/");
        return;
      }
      setEarlierOpen(false);
      earlierButtonRef.current?.focus();
    },
  });

  // A tap outside closes the list, also where tapping doesn't focus.
  const earlierRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!earlierOpen) return;
    const closeOutside = (event: PointerEvent) => {
      if (!earlierRef.current?.contains(event.target as Node)) {
        setEarlierOpen(false);
      }
    };
    document.addEventListener("pointerdown", closeOutside);
    return () => document.removeEventListener("pointerdown", closeOutside);
  }, [earlierOpen]);

  useEffect(() => {
    let active = true;
    void (async () => {
      // A run held from before signing in goes first, so the board has it.
      const wait = await sendHeldRun().catch(() => null);
      const next = await loadBoard(boardNumber);
      if (!active) return;
      if (next.status === "missing") {
        // Keeps the ranking in view without reloading for each switch.
        const sort = new URLSearchParams(window.location.search).get("sort");
        router.replace(boardHref(null, sort === "lap"));
        return;
      }
      setHeldRunNote((current) => takeHeldRunNote() ?? wait ?? current);
      setLoaded({ boardNumber, state: next });
    })();
    return () => {
      active = false;
    };
  }, [boardNumber, router]);

  const board = state.status === "ready" ? state.leaderboard.board : null;
  const readOnly = boardNumber !== null;
  // The last answer decides these while another board loads, so the icon
  // and title don't change under the racer.
  const earlier =
    loaded?.state.status === "ready" ? loaded.state.leaderboard.earlier : [];
  const viewing = earlier.find(({ number }) => number === boardNumber);
  const courseName =
    (loaded?.state.status === "ready"
      ? loaded.state.leaderboard.board?.courseName
      : null) ?? "Falls View Park";

  async function copyGhostLink(username: string) {
    // Cleared first, so a repeated note is announced again.
    setCopyNote(null);
    const outcome = await copyLink(ghostLinkUrl(username));
    setCopyNote(copyNoteFor(outcome));
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
  const rows = (byLap ? board?.lapEntries : board?.entries) ?? [];
  const viewerListed = rows.some((entry) => entry.viewer);
  const viewerStanding = byLap ? board?.viewer?.fastestLap : board?.viewer;

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
          <ActionHint align="end" hint="Back">
            <Link
              aria-label="Back"
              className={rowActionClass}
              data-ui-sound="back"
              href="/"
            >
              <BackIcon />
            </Link>
          </ActionHint>
        </header>

        <div className="grid gap-3">
          {/* The versions sit on the label's line, leaving the title its
              full width. */}
          <div className="flex min-h-9 items-center justify-between gap-3">
            <p className="font-mono text-xs font-bold uppercase tracking-[0.22em] text-titan-hazard">
              Leaderboard
            </p>
            {earlier.length > 0 ? (
              <div
                className="relative"
                // Focus leaving the icon and its list closes it.
                onBlur={(event) => {
                  if (!event.currentTarget.contains(event.relatedTarget)) {
                    setEarlierOpen(false);
                  }
                }}
                ref={earlierRef}
              >
                <ActionHint
                  align="end"
                  hint="Course versions"
                  // The open list says the rest.
                  shown={earlierOpen ? false : null}
                >
                  <button
                    aria-controls="course-versions"
                    aria-expanded={earlierOpen}
                    aria-label="Course versions"
                    className="grid size-9 place-items-center border border-titan-ice/12 text-titan-ice/50 transition hover:border-titan-ice/40 hover:text-titan-ice focus-visible:border-titan-hazard focus-visible:text-titan-hazard focus-visible:outline-none"
                    // Where an earlier version's page starts, unless your
                    // own time on it does.
                    data-controller-default={
                      readOnly && !board?.viewer ? "true" : undefined
                    }
                    ref={earlierButtonRef}
                    type="button"
                    onClick={() => setEarlierOpen((open) => !open)}
                  >
                    <CourseVersionsIcon />
                  </button>
                </ActionHint>
                {earlierOpen ? (
                  <ul
                    className="absolute right-0 top-[calc(100%+0.5rem)] z-20 grid w-64 gap-1 border border-titan-ice/20 bg-titan-black/98 p-1 shadow-[0_18px_55px_rgb(0_0_0/0.65)]"
                    id="course-versions"
                  >
                    {[
                      {
                        href: boardHref(null, byLap),
                        label: "Latest course version",
                        number: null,
                      },
                      ...earlier.map((version) => ({
                        href: boardHref(version.number, byLap),
                        label: `Course version · ${timesSetBetween(version)}`,
                        number: version.number,
                      })),
                    ].map(({ href, label, number }) => (
                      <li key={number ?? "latest"}>
                        <Link
                          aria-current={number === boardNumber ? "page" : undefined}
                          className={`block border px-3 py-2 text-sm transition focus-visible:border-titan-hazard focus-visible:outline-none ${
                            number === boardNumber
                              ? "border-titan-hazard/60 text-titan-hazard"
                              : "border-transparent text-titan-ice/78 hover:border-titan-ice/30"
                          }`}
                          href={href}
                          onClick={() => setEarlierOpen(false)}
                        >
                          {label}
                        </Link>
                      </li>
                    ))}
                  </ul>
                ) : null}
              </div>
            ) : null}
          </div>
          <h1 className="text-4xl font-black uppercase tracking-[-0.04em] sm:text-5xl">
            {courseName}
          </h1>
          {readOnly ? (
            <p className="font-mono text-xs text-titan-ice/60">
              Earlier course version
              {viewing ? ` · times from ${timesSetBetween(viewing)}` : ""}
            </p>
          ) : null}
        </div>

        <div
          className={
            heldRunNote && !readOnly
              ? "border border-titan-hazard/50 bg-titan-hazard/6 px-4 py-3"
              : "sr-only"
          }
          role="status"
        >
          {/* It describes the current board. */}
          {heldRunNote && !readOnly ? <HeldRunStatus note={heldRunNote} /> : null}
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
            {readOnly ? "No earlier times" : "No times yet"}
          </p>
        ) : (
          <div className="grid gap-3">
            <div
              aria-label="Rank by"
              className="flex w-fit border border-titan-ice/12"
              role="group"
            >
              {RANKINGS.map((option) => (
                <button
                  aria-pressed={option.byLap === byLap}
                  className={`h-8 whitespace-nowrap px-2 font-mono text-[0.68rem] font-bold uppercase tracking-[0.04em] transition sm:px-3 sm:tracking-[0.14em] focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-inset focus-visible:ring-titan-hazard ${
                    option.byLap === byLap
                      ? "bg-titan-ice/8 text-titan-hazard"
                      : "text-titan-ice/50 hover:text-titan-ice"
                  }`}
                  key={option.label}
                  type="button"
                  onClick={() =>
                    window.history.replaceState(
                      null,
                      "",
                      boardHref(boardNumber, option.byLap),
                    )
                  }
                >
                  {option.label}
                </button>
              ))}
            </div>
            {rows.length === 0 ? (
              <p className="border border-titan-ice/10 px-3 py-4 text-center font-mono text-sm text-titan-ice/60">
                No laps yet
              </p>
            ) : (
            <ol
              aria-label={byLap ? "Fastest laps" : "Best times"}
              className="grid gap-1"
            >
              {rows.map((entry) => {
                // Medals are for the race, not a lap.
                const medal = byLap ? null : medalForRank(entry.rank);
                return (
                <li
                  aria-current={entry.viewer ? "true" : undefined}
                  // With no buttons, the rows themselves are the stops down
                  // the board, starting on your own.
                  data-controller-default={
                    readOnly && entry.viewer ? "true" : undefined
                  }
                  tabIndex={readOnly ? 0 : undefined}
                  className={`grid ${
                    readOnly
                      ? "grid-cols-[2rem_1fr_auto] py-3"
                      : "grid-cols-[2rem_1fr_auto_auto] py-2"
                  } items-center gap-2 border px-2 focus-within:border-titan-hazard focus-visible:border-titan-hazard focus-visible:outline-none sm:gap-3 sm:px-3 ${
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
                  <span className="grid text-right font-mono tabular-nums">
                    <span className="text-sm font-bold">
                      {time(
                        byLap
                          ? entry.fastestLapMicroseconds!
                          : entry.timeMicroseconds,
                      )}
                    </span>
                    {/* Phones keep the name's room; the switch says which. */}
                    {byLap || entry.fastestLapMicroseconds !== null ? (
                      <span className="text-xs text-titan-ice/60">
                        <span className="sr-only sm:not-sr-only">
                          {byLap ? "Total " : "Fastest lap "}
                        </span>
                        {time(
                          byLap
                            ? entry.timeMicroseconds
                            : entry.fastestLapMicroseconds!,
                        )}
                      </span>
                    ) : null}
                  </span>
                  {readOnly ? null : (
                  <span className="flex gap-1">
                    <ActionHint hint="Race ghost">
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
                    </ActionHint>
                    <ActionHint
                      hint={
                        copiedUsername === entry.username
                          ? "Copied"
                          : "Copy ghost link"
                      }
                      shown={copiedUsername === entry.username || null}
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
                    </ActionHint>
                  </span>
                  )}
                </li>
                );
              })}
            </ol>
            )}
          </div>
        )}

        <p
          className="sr-only"
          aria-live="polite"
        >
          {copyNote}
        </p>

        {viewerStanding && !viewerListed ? (
          <p
            className="font-mono text-sm text-titan-ice/76 outline-none focus-visible:text-titan-hazard"
            data-controller-default="true"
            tabIndex={0}
          >
            {byLap ? "Your fastest lap" : "Your best"}:{" "}
            {time(viewerStanding.timeMicroseconds)}, rank {viewerStanding.rank}
          </p>
        ) : null}
      </section>
    </main>
  );
}

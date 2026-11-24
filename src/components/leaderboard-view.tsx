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
  parseBoardNumber,
} from "@/game/race/leaderboard";
import { medalForRank } from "@/game/race/race-medals";
import { formatRaceTime } from "@/game/race/race-presentation";
import { courseBoardPath, SCORE_BOARD_PATH } from "@/lib/leaderboard-path";
import { fetchScores } from "@/lib/scores-client";
import { copyLink, ghostLinkUrl, copyNoteFor } from "@/lib/share-link";

import { ActionHint } from "./action-hint";
import { CourseSelector } from "./course-selector";
import { HeldRunStatus } from "./held-run-status";
import { HomeBackdrop } from "./home-steps";
import { MedalIcon } from "./medal-icon";
import {
  BackIcon,
  CheckIcon,
  CopyLinkIcon,
  CourseVersionsIcon,
  RaceGhostIcon,
} from "./menu-icons";
import { ScoreBoard, type ScoresState } from "./score-board";

type BoardState =
  | { status: "loading" }
  // The course has no leaderboard, or the earlier board this link names
  // no longer has times to show.
  | { status: "missing" }
  | { status: "unavailable" }
  | { leaderboard: LeaderboardResponse; status: "ready" };

/** A course's current board when null, or an earlier one by its number. */
async function loadBoard(
  courseId: string,
  boardNumber: number | null,
): Promise<BoardState> {
  try {
    const response = await fetch(
      `/api/leaderboards/${encodeURIComponent(courseId)}${
        boardNumber === null ? "" : `?board=${boardNumber}`
      }`,
      { cache: "no-store" },
    );
    if (response.status === 404) return { status: "missing" };
    if (!response.ok) return { status: "unavailable" };
    return {
      leaderboard: leaderboardResponseSchema.parse(await response.json()),
      status: "ready",
    };
  } catch {
    return { status: "unavailable" };
  }
}

async function loadScores(): Promise<ScoresState> {
  const scores = await fetchScores();
  return scores ? { scores, status: "ready" } : { status: "unavailable" };
}

// Offered before the scores name the courses, and if they cannot be loaded.
const KNOWN_COURSES = [
  { courseId: FALLS_VIEW_PARK_COURSE_ID, courseName: "Falls View Park" },
];

const time = (microseconds: number) => formatRaceTime(microseconds, 3);

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

/**
 * The leaderboard: the score board, and behind the course selector each
 * course's race leaderboard (`?course=<id>`). That is its current board, or
 * an earlier course version's after a new leaderboard started: read-only,
 * so its times are honoured without racing an older layout. Earlier
 * versions sit behind a quiet icon by the course name.
 */
export function LeaderboardView() {
  const router = useRouter();
  // The address says what is open, so a choice only rewrites it.
  const params = useSearchParams();
  // Links from before the score board name no course: they open Falls View
  // Park's, the only course then.
  const courseId =
    params.get("course") ??
    (params.has("board") || params.has("sort")
      ? FALLS_VIEW_PARK_COURSE_ID
      : null);
  const boardNumber =
    courseId === null ? null : parseBoardNumber(params.get("board"));
  // Both rankings are loaded, so switching only rewrites the address.
  const byLap = params.get("sort") === "lap";
  const mainRef = useRef<HTMLElement>(null);
  const [scores, setScores] = useState<ScoresState>({ status: "loading" });
  // The board loaded for a choice; switching shows loading until it comes.
  const [loaded, setLoaded] = useState<{
    boardNumber: number | null;
    courseId: string;
    state: BoardState;
  } | null>(null);
  const shown =
    loaded?.courseId === courseId && loaded.boardNumber === boardNumber
      ? loaded
      : null;
  const state: BoardState = shown?.state ?? { status: "loading" };
  const [earlierOpen, setEarlierOpen] = useState(false);
  const earlierButtonRef = useRef<HTMLButtonElement>(null);
  // Announces a copy to screen readers; the copied row shows it itself.
  const [copyNote, setCopyNote] = useState<string | null>(null);
  const [copiedUsername, setCopiedUsername] = useState<string | null>(null);
  const copiedTimerRef = useRef<number | null>(null);
  // Null until a run held from before signing in has been sent, if any.
  const [heldRun, setHeldRun] = useState<{
    note: HeldRunNote | HeldRunWait | null;
  } | null>(null);
  const heldRunSent = heldRun !== null;
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

  // A run held from before signing in goes first, so the scores and its
  // course's board have it.
  useEffect(() => {
    let active = true;
    void sendHeldRun()
      .catch(() => null)
      .then((wait) => {
        if (active) setHeldRun({ note: takeHeldRunNote() ?? wait });
      });
    return () => {
      active = false;
    };
  }, []);

  useEffect(() => {
    if (!heldRunSent) return;
    let active = true;
    void loadScores().then((next) => {
      if (active) setScores(next);
    });
    return () => {
      active = false;
    };
  }, [heldRunSent]);

  useEffect(() => {
    if (!heldRunSent || courseId === null) return;
    let active = true;
    void loadBoard(courseId, boardNumber).then((next) => {
      if (!active) return;
      if (next.status === "missing") {
        // A course without a leaderboard shows the scores, even when they
        // cannot be loaded to say so; a missing earlier board, the current
        // one, keeping the ranking in view.
        const sort = new URLSearchParams(window.location.search).get("sort");
        router.replace(
          boardNumber === null
            ? SCORE_BOARD_PATH
            : courseBoardPath(courseId, { byLap: sort === "lap" }),
        );
        return;
      }
      setLoaded({ boardNumber, courseId, state: next });
    });
    return () => {
      active = false;
    };
  }, [boardNumber, courseId, heldRunSent, router]);

  // The course's last answer decides these while another of its boards
  // loads, so the icon and title don't change under the racer.
  const lastAnswer =
    loaded?.courseId === courseId && loaded.state.status === "ready"
      ? loaded.state.leaderboard
      : null;
  // Without the scores, the open course stays a choice once its board
  // names it.
  const answeredCourse = lastAnswer?.board?.courseName;
  const courses =
    scores.status === "ready"
      ? scores.scores.courses
      : courseId !== null &&
          answeredCourse &&
          !KNOWN_COURSES.some((course) => course.courseId === courseId)
        ? [...KNOWN_COURSES, { courseId, courseName: answeredCourse }]
        : KNOWN_COURSES;
  // A link to a course without a leaderboard shows the scores.
  const unknownCourse =
    scores.status === "ready" &&
    courseId !== null &&
    !courses.some((course) => course.courseId === courseId);
  useEffect(() => {
    if (unknownCourse) router.replace(SCORE_BOARD_PATH);
  }, [router, unknownCourse]);

  const board = state.status === "ready" ? state.leaderboard.board : null;
  const readOnly = boardNumber !== null;
  const earlier = lastAnswer?.earlier ?? [];
  const viewing = earlier.find(({ number }) => number === boardNumber);
  const courseName =
    lastAnswer?.board?.courseName ??
    courses.find((course) => course.courseId === courseId)?.courseName ??
    "";
  // The held run's outcome belongs to its course: shown on that course's
  // current board, and on the score board by the course's name.
  const heldCourseId = heldRun?.note
    ? (heldRun.note.courseId ?? FALLS_VIEW_PARK_COURSE_ID)
    : null;
  const heldRunOutcome =
    heldRun?.note && heldCourseId !== null
      ? { boardPath: courseBoardPath(heldCourseId), note: heldRun.note }
      : null;

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
  // A controller's first move starts from the viewer's own place where the
  // open board shows one, and otherwise from the open choice.
  const viewerHasStop =
    courseId === null
      ? scores.status === "ready" &&
        scores.scores.entries.some((entry) => entry.viewer)
      : readOnly || viewerListed || Boolean(viewerStanding);

  return (
    <main
      className="relative min-h-screen bg-titan-black text-titan-ice"
      ref={mainRef}
    >
      {/* Home's render, dimmed as behind its later steps. */}
      <div className="pointer-events-none fixed inset-0">
        <HomeBackdrop dim />
      </div>
      <section className="relative mx-auto grid w-full max-w-3xl content-start gap-6 px-4 py-6 sm:gap-8 sm:px-8">
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
              className="h-11 w-auto sm:h-14"
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

        {courses.length > 0 ? (
          <CourseSelector
            courses={courses}
            defaultChoice={!viewerHasStop}
            selectedCourseId={courseId}
          />
        ) : null}

        {courseId === null ? (
          <ScoreBoard
            heldRun={
              heldRunOutcome && {
                ...heldRunOutcome,
                courseName: courses.find(
                  (course) => course.courseId === heldCourseId,
                )?.courseName,
              }
            }
            state={scores}
          />
        ) : (
        <>
        <div className="grid gap-3">
          {/* The versions sit on the label's line, leaving the title its
              full width. */}
          <div className="flex min-h-9 items-center justify-between gap-3">
            <p className="font-mono text-xs font-bold uppercase tracking-[0.2em] text-titan-muted">
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
                    className="absolute right-0 top-[calc(100%+0.5rem)] z-20 grid w-64 gap-1 border border-titan-ice/18 bg-titan-black p-1"
                    id="course-versions"
                  >
                    {[
                      {
                        href: courseBoardPath(courseId, { byLap }),
                        label: "Latest course version",
                        number: null,
                      },
                      ...earlier.map((version) => ({
                        href: courseBoardPath(courseId, { board: version.number, byLap }),
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
          {/* As tall while the name loads. */}
          <h1 className="min-h-[0.95em] text-[2.5rem] font-bold uppercase leading-[0.95] tracking-[-0.01em] sm:text-7xl">
            {courseName}
          </h1>
          {readOnly ? (
            <p className="font-mono text-xs text-titan-muted">
              Earlier course version
              {viewing ? ` · times from ${timesSetBetween(viewing)}` : ""}
            </p>
          ) : null}
        </div>

        {/* It describes its own course's current board. */}
        <HeldRunStatus
          outcome={heldCourseId === courseId && !readOnly ? heldRunOutcome : null}
        />

        {state.status === "loading" ? (
          <p className="font-mono text-sm text-titan-ice/70" role="status">
            Loading leaderboard…
          </p>
        ) : state.status === "unavailable" ? (
          <p className="text-sm text-titan-ice/76" role="alert">
            The leaderboard is unavailable right now.
          </p>
        ) : !board || board.entries.length === 0 ? (
          <p className="border-y border-titan-ice/12 px-3 py-4 text-center font-mono text-sm text-titan-muted">
            {readOnly ? "No earlier times" : "No times yet"}
          </p>
        ) : (
          <div className="grid gap-3">
            <div
              aria-label="Rank by"
              className="flex w-fit border border-titan-ice/18 bg-titan-black"
              role="group"
            >
              {RANKINGS.map((option) => (
                <button
                  aria-pressed={option.byLap === byLap}
                  className={`h-8 whitespace-nowrap px-2 transition sm:px-3 focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-inset focus-visible:ring-titan-hazard ${
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
                      courseBoardPath(courseId, {
                        board: boardNumber,
                        byLap: option.byLap,
                      }),
                    )
                  }
                >
                  {/* The global `button { font: inherit }` overrides font
                      classes on the button itself. */}
                  <span className="font-mono text-[0.68rem] font-bold uppercase tracking-[0.04em] sm:tracking-[0.14em]">
                    {option.label}
                  </span>
                </button>
              ))}
            </div>
            {rows.length === 0 ? (
              <p className="border-y border-titan-ice/12 px-3 py-4 text-center font-mono text-sm text-titan-muted">
                No laps yet
              </p>
            ) : (
            <ol
              aria-label={byLap ? "Fastest laps" : "Best times"}
              className="grid border-t border-titan-ice/12"
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
                  } items-center gap-2 border-b border-titan-ice/12 px-2 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-titan-hazard sm:gap-3 sm:px-3 ${
                    entry.viewer
                      ? "bg-titan-hazard/8 shadow-[inset_2px_0_0_var(--titan-hazard)]"
                      : "bg-titan-black/60"
                  }`}
                  key={entry.rank}
                >
                  {medal ? (
                    <MedalIcon rank={entry.rank} tier={medal} />
                  ) : (
                    <span className="text-center font-mono text-sm font-bold tabular-nums text-titan-ice/70">
                      {entry.rank}
                    </span>
                  )}
                  <span className="grid min-w-0">
                    <span className="truncate font-bold">@{entry.username}</span>
                    <span className="truncate text-xs text-titan-muted">
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
        </>
        )}
      </section>
    </main>
  );
}

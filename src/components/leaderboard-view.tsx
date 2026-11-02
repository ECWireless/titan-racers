"use client";

import Image from "next/image";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useRef, useState } from "react";

import { FALLS_VIEW_PARK_COURSE_ID } from "@/game/course/course-ids";
import { useControllerMenuNavigation } from "@/game/input/use-controller-menu-navigation";
import {
  type LeaderboardResponse,
  leaderboardResponseSchema,
} from "@/game/race/leaderboard";
import { MEDAL_LABELS, medalForRank } from "@/game/race/race-medals";
import { formatRaceTime } from "@/game/race/race-presentation";

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

export function LeaderboardView() {
  const router = useRouter();
  const mainRef = useRef<HTMLElement>(null);
  const [state, setState] = useState<BoardState>({ status: "loading" });
  useControllerMenuNavigation({
    containerRef: mainRef,
    enabled: true,
    navigationMode: "spatial",
    onBack: () => router.push("/"),
  });

  useEffect(() => {
    let active = true;
    void loadBoard().then((next) => {
      if (active) setState(next);
    });
    return () => {
      active = false;
    };
  }, []);

  const board = state.status === "ready" ? state.leaderboard.board : null;
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
          <Link className="titan-button titan-button-secondary" href="/">
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
                className={`grid grid-cols-[2.5rem_1fr_auto] items-center gap-3 border px-3 py-2 outline-none focus-visible:border-titan-hazard ${
                  entry.viewer
                    ? "border-titan-hazard/70 bg-titan-hazard/8"
                    : "border-titan-ice/10"
                }`}
                // Focusable so a controller can step down the board, which
                // scrolls each row into view; it starts on your own row.
                data-controller-default={entry.viewer ? "true" : undefined}
                key={entry.rank}
                tabIndex={0}
              >
                <span className="font-mono text-sm font-bold tabular-nums text-titan-ice/72">
                  {entry.rank}
                </span>
                <span className="grid min-w-0">
                  <span className="truncate font-bold">@{entry.username}</span>
                  <span className="truncate text-xs text-titan-ice/60">
                    {entry.kartName}
                    {medal ? ` · ${MEDAL_LABELS[medal]}` : ""}
                  </span>
                </span>
                <span className="font-mono text-sm font-bold tabular-nums">
                  {time(entry.timeMicroseconds)}
                </span>
              </li>
              );
            })}
          </ol>
        )}

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

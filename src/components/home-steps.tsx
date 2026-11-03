"use client";

import Image from "next/image";
import Link from "next/link";
import { type MouseEvent, type ReactNode, useId } from "react";

import type { CourseDocument } from "@/game/course/course-document";
import { FALLS_VIEW_PARK_COURSE_ID } from "@/game/course/course-ids";
import type { KartAssemblyDocument } from "@/game/kart/kart-assembly-document";
import type { PersistedResolvedKartSnapshot } from "@/game/kart/kart-derivation";

import { KartThumbnail } from "./kart-thumbnail";
import { LeaderboardIcon, RaceFlagIcon, RaceGhostIcon } from "./menu-icons";

// The first screen's icons, at the size of its titles.
const MENU_ICON = "size-7";

/** The home flow's steps, in order. A race starts from the last. */
export type HomeStep = "start" | "kart" | "course" | "race";

export type HomeKart = {
  assemblerCredit: string;
  document: KartAssemblyDocument;
  resolvedSnapshot: PersistedResolvedKartSnapshot;
  thumbnailSource: string | null;
};

/** A course's picture for the course choice, captured from the game. */
const COURSE_THUMBNAILS: Partial<Record<string, string>> = {
  [FALLS_VIEW_PARK_COURSE_ID]: "/images/courses/falls-view-park.webp",
};

// Every choice in the flow: a panel whose border turns gold when focused or
// hovered, as a console menu marks its current item.
const OPTION =
  "home-option grid min-w-0 border bg-titan-black/72 text-left shadow-[0_20px_60px_rgb(0_0_0/0.35)] backdrop-blur transition motion-reduce:transition-none";
const OPTION_IDLE = "border-titan-ice/18";
const OPTION_CHOSEN = "border-titan-hazard bg-titan-black/90";

/**
 * A choice that opens the next step, where a double-click's second click
 * would land on that step's first choice: only its first click counts.
 */
function onFirstClick(action: () => void) {
  return (event: MouseEvent<HTMLButtonElement>) => {
    if (event.detail > 1) return;
    action();
  };
}

/** A screen of the flow: where you are, its title, and the way back. */
export function HomeStepFrame({
  children,
  onBack,
  rail,
  title,
  titleId,
}: {
  children: ReactNode;
  onBack: () => void;
  rail: Array<{ current: boolean; label: string; value: string | null }>;
  title: string;
  titleId: string;
}) {
  return (
    <section
      aria-labelledby={titleId}
      className="home-step grid content-start gap-6"
    >
      <div className="flex flex-wrap items-center gap-x-6 gap-y-3">
        <button
          className="flex min-h-11 items-center gap-2 border border-titan-ice/24 bg-titan-black/60 px-4 text-titan-ice/80 transition hover:border-titan-hazard hover:text-titan-hazard focus-visible:border-titan-hazard focus-visible:text-titan-hazard focus-visible:outline-none"
          type="button"
          onClick={onBack}
        >
          <span aria-hidden="true">‹</span>
          {/* The global `button { font: inherit }` overrides the button's own
              font classes. */}
          <span className="font-mono text-xs font-bold uppercase tracking-[0.16em]">
            Back
          </span>
        </button>
        <ol
          aria-label="Race setup"
          className="flex flex-wrap items-center gap-x-4 gap-y-1 font-mono text-[0.62rem] font-bold uppercase tracking-[0.16em]"
        >
          {rail.map(({ current, label, value }, index) => (
            <li
              aria-current={current ? "step" : undefined}
              className={`flex items-center gap-2 ${
                current ? "text-titan-hazard" : "text-titan-ice/55"
              }`}
              key={label}
            >
              <span className="tabular-nums">
                {String(index + 1).padStart(2, "0")}
              </span>
              <span>{label}</span>
              {value ? (
                <span className="max-w-60 truncate text-titan-ice/85">
                  · {value}
                </span>
              ) : null}
            </li>
          ))}
        </ol>
      </div>
      <h1
        className="text-3xl font-black uppercase tracking-[-0.04em] sm:text-5xl"
        id={titleId}
      >
        {title}
      </h1>
      {children}
    </section>
  );
}

/** The first screen: race, or see the leaderboard. */
export function HomeStartStep({
  challenge,
  note,
  onRace,
  onRaceChallenge,
}: {
  /** A ghost link's racer, with their time once known. */
  challenge: { time: string | null; username: string } | null;
  /** Why a ghost link's racer is not offered. */
  note: string | null;
  onRace: () => void;
  onRaceChallenge: () => void;
}) {
  return (
    <section
      aria-labelledby="home-start-title"
      className="home-step grid max-w-xl content-center gap-6"
    >
      <h1 className="sr-only" id="home-start-title">
        Main menu
      </h1>
      <div className="grid gap-3">
        {challenge ? (
          <MenuItem
            controllerDefault
            detail={
              challenge.time
                ? `Their best: ${challenge.time}`
                : "Loading their best…"
            }
            icon={<RaceGhostIcon className={MENU_ICON} />}
            label={`Race @${challenge.username}'s ghost`}
            primary
            onClick={onRaceChallenge}
          />
        ) : null}
        <MenuItem
          controllerDefault={!challenge}
          detail="Pick a kart, a course, and a ghost"
          icon={<RaceFlagIcon className={MENU_ICON} />}
          label="Race"
          primary={!challenge}
          onClick={onRace}
        />
        <Link
          aria-describedby="home-leaderboard-detail"
          aria-labelledby="home-leaderboard-label"
          className={`${OPTION} ${OPTION_IDLE} home-menu-item`}
          href="/leaderboard"
        >
          <MenuItemContent
            detail="Best times and ghosts to race"
            icon={<LeaderboardIcon className={MENU_ICON} />}
            id="home-leaderboard"
            label="Leaderboard"
          />
        </Link>
      </div>
      {note ? (
        <p className="text-sm leading-6 text-titan-ice/76" role="status">
          {note}
        </p>
      ) : null}
    </section>
  );
}

function MenuItem({
  controllerDefault,
  detail,
  icon,
  label,
  onClick,
  primary,
}: {
  controllerDefault: boolean;
  detail: string;
  icon: ReactNode;
  label: string;
  onClick: () => void;
  primary: boolean;
}) {
  const id = useId();
  return (
    <button
      aria-describedby={`${id}-detail`}
      aria-labelledby={`${id}-label`}
      className={`${OPTION} ${primary ? OPTION_CHOSEN : OPTION_IDLE} home-menu-item`}
      data-controller-default={controllerDefault ? "true" : undefined}
      type="button"
      onClick={onFirstClick(onClick)}
    >
      <MenuItemContent
        detail={detail}
        icon={icon}
        id={id}
        label={label}
        large={primary}
      />
    </button>
  );
}

/**
 * A first-screen item's inside: its icon, its name and what it leads to,
 * and an arrow that slides on when it is the current item.
 */
function MenuItemContent({
  detail,
  icon,
  id,
  label,
  large = false,
}: {
  detail: string;
  icon: ReactNode;
  id: string;
  label: string;
  large?: boolean;
}) {
  return (
    <>
      <span className="text-titan-hazard">{icon}</span>
      <span className="grid min-w-0 gap-1">
        <span
          className={`truncate font-black uppercase tracking-[-0.03em] ${
            large ? "text-3xl sm:text-4xl" : "text-2xl"
          }`}
          id={`${id}-label`}
        >
          {label}
        </span>
        <span
          className="font-mono text-[0.68rem] font-bold uppercase tracking-[0.14em] text-titan-ice/60"
          id={`${id}-detail`}
        >
          {detail}
        </span>
      </span>
      <span
        aria-hidden="true"
        className="home-menu-arrow font-mono text-2xl font-bold text-titan-hazard"
      >
        ›
      </span>
    </>
  );
}

/** One official kart: picking it moves on to the course. */
export function HomeKartCard({
  chosen,
  kart,
  onChoose,
}: {
  chosen: boolean;
  kart: HomeKart;
  onChoose: () => void;
}) {
  return (
    <button
      aria-pressed={chosen}
      className={`${OPTION} ${chosen ? OPTION_CHOSEN : OPTION_IDLE} content-start gap-4 p-4`}
      data-controller-default={chosen ? "true" : undefined}
      type="button"
      onClick={onFirstClick(onChoose)}
    >
      <KartThumbnail
        document={kart.document}
        initialized
        keep
        source={kart.thumbnailSource}
      />
      <span
        aria-hidden="true"
        className="h-2 w-full"
        style={{
          background: `linear-gradient(90deg, ${kart.document.visualIdentity.primaryColor} 0 72%, ${kart.document.visualIdentity.accentColor} 72% 100%)`,
        }}
      />
      <span className="grid gap-1">
        <strong className="text-xl font-black uppercase tracking-[-0.03em]">
          {kart.document.name}
        </strong>
        <span className="font-mono text-[0.62rem] font-bold uppercase tracking-[0.12em] text-titan-hazard">
          Assembled by {kart.assemblerCredit}
        </span>
      </span>
      <span className="min-h-16 text-xs leading-5 text-titan-ice/68">
        {kart.document.practicalDescriptor}
      </span>
      <span className="grid gap-2">
        {Object.entries(kart.resolvedSnapshot.playerStats).map(
          ([label, value]) => (
            <span
              className="grid grid-cols-[5.5rem_1fr_1.5rem] items-center gap-2"
              key={label}
            >
              <span className="font-mono text-[0.56rem] font-bold uppercase tracking-[0.09em] text-titan-muted">
                {label}
              </span>
              <span className="h-1.5 overflow-hidden bg-titan-ice/10">
                <span
                  className="block h-full bg-titan-orange"
                  style={{ width: `${value}%` }}
                />
              </span>
              <span className="text-right font-mono text-[0.6rem] font-bold">
                {value}
              </span>
            </span>
          ),
        )}
      </span>
    </button>
  );
}

/** One course: picking it moves on to the mode. */
export function HomeCourseCard({
  course,
  laps,
  onChoose,
}: {
  course: CourseDocument;
  laps: number;
  onChoose: () => void;
}) {
  const thumbnail = COURSE_THUMBNAILS[course.courseId];
  return (
    <button
      className={`${OPTION} ${OPTION_CHOSEN} content-start gap-4 p-4`}
      data-controller-default="true"
      type="button"
      onClick={onFirstClick(onChoose)}
    >
      <span className="relative block aspect-video w-full overflow-hidden border border-titan-ice/12 bg-titan-steel/20">
        {thumbnail ? (
          <Image
            alt=""
            className="object-cover"
            fill
            sizes="(min-width: 768px) 28rem, 100vw"
            src={thumbnail}
          />
        ) : null}
      </span>
      <span className="grid gap-1">
        <strong className="text-xl font-black uppercase tracking-[-0.03em]">
          {course.name}
        </strong>
        <span className="font-mono text-[0.62rem] font-bold uppercase tracking-[0.12em] text-titan-hazard">
          {laps} laps · Island Three
        </span>
      </span>
    </button>
  );
}

/** A choice on the mode screen, pressed while it is the one chosen. */
export function HomeChoice({
  children,
  chosen,
  className = "",
  controllerDefault = false,
  disabledNote,
  onChoose,
}: {
  children: ReactNode;
  chosen: boolean;
  className?: string;
  controllerDefault?: boolean;
  /** Shown on a choice not yet available, which then only says so. */
  disabledNote?: string;
  onChoose: () => void;
}) {
  return (
    <button
      aria-disabled={disabledNote ? "true" : undefined}
      aria-pressed={disabledNote ? undefined : chosen}
      className={`${OPTION} ${chosen ? OPTION_CHOSEN : OPTION_IDLE} min-h-12 content-center px-4 py-3 ${
        disabledNote ? "text-titan-ice/45" : chosen ? "text-titan-hazard" : "text-titan-ice/80"
      } ${className}`}
      data-controller-default={controllerDefault ? "true" : undefined}
      type="button"
      onClick={onChoose}
    >
      <span className="flex items-center justify-between gap-3 font-mono text-xs font-bold uppercase tracking-[0.14em]">
        <span className="truncate">{children}</span>
        {disabledNote ? (
          <span className="shrink-0 border border-titan-ice/20 px-2 py-1 text-[0.56rem] tracking-[0.12em] text-titan-ice/60">
            {disabledNote}
          </span>
        ) : null}
      </span>
    </button>
  );
}

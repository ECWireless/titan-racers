"use client";

import Image from "next/image";
import Link from "next/link";
import { type MouseEvent, type ReactNode, useId } from "react";

import type { CourseDocument } from "@/game/course/course-document";
import { FALLS_VIEW_PARK_COURSE_ID } from "@/game/course/course-ids";
import type { KartAssemblyDocument } from "@/game/kart/kart-assembly-document";
import type { PersistedResolvedKartSnapshot } from "@/game/kart/kart-derivation";

import { KartThumbnail } from "./kart-thumbnail";

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

// Every choice after the first screen: solid black on a thin rule, whose
// rule turns hazard yellow when focused or hovered, as a console menu marks
// its current item.
const OPTION =
  "home-option grid min-w-0 border bg-titan-black text-left transition motion-reduce:transition-none";
const OPTION_IDLE = "border-titan-ice/18";
// Chosen is ice; hazard yellow is kept for focus.
const OPTION_CHOSEN = "border-titan-ice";

/**
 * Home's backdrop: Falls View Park at dusk, a render from the game, falling
 * off hard to black. On a phone or a tablet held upright it fills the top of
 * the screen above the menu; on a wide screen it fills the screen behind a
 * fall-off on the left. `dim` darkens it behind the steps after the first.
 */
export function HomeBackdrop({ dim }: { dim: boolean }) {
  return (
    <div aria-hidden="true" className="pointer-events-none absolute inset-0">
      <div className="absolute inset-x-0 top-0 h-[62svh] lg:inset-0 lg:h-auto">
        <Image
          alt=""
          className="object-cover object-[62%_50%] lg:object-[50%_62%]"
          fill
          priority
          sizes="100vw"
          src="/images/home/falls-view-park-habitat.webp"
        />
      </div>
      <div className="absolute inset-x-0 top-0 h-32 bg-[linear-gradient(180deg,rgb(7_7_6/0.7),rgb(7_7_6/0))]" />
      <div className="absolute inset-x-0 top-[38svh] h-[24.5svh] bg-[linear-gradient(180deg,rgb(7_7_6/0)_0%,var(--titan-black)_92%)] lg:hidden" />
      <div className="absolute inset-0 hidden bg-[linear-gradient(90deg,var(--titan-black)_0%,rgb(7_7_6/0.84)_32%,rgb(7_7_6/0)_70%)] lg:block" />
      <div className="absolute inset-x-0 bottom-0 hidden h-[12%] bg-[linear-gradient(0deg,var(--titan-black),rgb(7_7_6/0))] lg:block" />
      <div
        className={`absolute inset-0 bg-titan-black/65 transition-opacity duration-300 motion-reduce:transition-none ${
          dim ? "opacity-100" : "opacity-0"
        }`}
      />
    </div>
  );
}

/**
 * A choice that moves the flow on, where a double-click's second click
 * would land on the next screen's choice: only its first click counts (and
 * sounds).
 */
export function firstClickOnly(action: () => void) {
  return {
    "data-first-click-only": "",
    onClick: (event: MouseEvent<HTMLButtonElement>) => {
      if (event.detail > 1) return;
      action();
    },
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
          data-ui-sound="back"
          className="flex min-h-11 items-center gap-2 border border-titan-ice/50 bg-transparent px-4 text-titan-ice transition hover:border-titan-hazard hover:text-titan-hazard focus-visible:border-titan-hazard focus-visible:text-titan-hazard focus-visible:outline-none"
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
        className="text-[2.5rem] font-bold uppercase leading-[0.95] tracking-[-0.01em] sm:text-7xl"
        id={titleId}
      >
        {title}
      </h1>
      {children}
    </section>
  );
}

/**
 * The first screen: a time trial, multiplayer, or the leaderboard. The next
 * action is one orange block; the rest are rows on thin rules.
 */
export function HomeStartStep({
  challenge,
  multiplayerAvailable,
  note,
  onMultiplayer,
  onRaceChallenge,
  onTimeTrial,
}: {
  /** A ghost link's racer, with their time once known. */
  challenge: { time: string | null; username: string } | null;
  /** Without a room server, Multiplayer only says it's coming soon. */
  multiplayerAvailable: boolean;
  /** Why a ghost link's racer is not offered. */
  note: string | null;
  onMultiplayer: () => void;
  onRaceChallenge: () => void;
  onTimeTrial: () => void;
}) {
  return (
    <section
      aria-labelledby="home-start-title"
      className="home-step grid w-full max-w-xl content-center"
    >
      <h1 className="sr-only" id="home-start-title">
        Main menu
      </h1>
      {/* What the backdrop shows. */}
      <p className="mb-3.5 font-mono text-xs font-bold uppercase tracking-[0.2em] text-titan-muted">
        Falls View Park · dusk
      </p>
      <div className="grid gap-3">
        {challenge ? (
          <MenuItem
            controllerDefault
            detail={
              challenge.time
                ? `Their best: ${challenge.time}`
                : "Loading their best…"
            }
            label={`Race @${challenge.username}'s ghost`}
            primary
            onClick={onRaceChallenge}
          />
        ) : null}
        <MenuItem
          controllerDefault={!challenge}
          detail="Pick a kart, a course, and a ghost"
          label="Time Trial"
          primary={!challenge}
          onClick={onTimeTrial}
        />
        <MenuItem
          controllerDefault={false}
          detail={
            multiplayerAvailable
              ? "A private room for up to 4"
              : "Coming soon"
          }
          label="Multiplayer"
          primary={false}
          unavailable={!multiplayerAvailable}
          onClick={onMultiplayer}
        />
        <Link
          aria-describedby="home-leaderboard-detail"
          aria-labelledby="home-leaderboard-label"
          className={MENU_ROW}
          href="/leaderboard"
        >
          <MenuItemContent
            detail="Best times and ghosts to race"
            id="home-leaderboard"
            label="Leaderboard"
          />
        </Link>
      </div>
      {note ? (
        <p className="mt-4 text-sm leading-6 text-titan-ice/76" role="status">
          {note}
        </p>
      ) : null}
    </section>
  );
}

const MENU_ITEM = "home-menu-item min-w-0 text-left";
const MENU_PRIMARY = `${MENU_ITEM} home-menu-primary bg-titan-orange px-[1.125rem] py-4 text-titan-black`;
const MENU_ROW = `${MENU_ITEM} home-menu-row px-[1.125rem] py-3 text-titan-ice`;

function MenuItem({
  controllerDefault,
  detail,
  label,
  onClick,
  primary,
  unavailable = false,
}: {
  controllerDefault: boolean;
  detail: string;
  label: string;
  onClick: () => void;
  primary: boolean;
  /** Not yet available: it sounds so, and its detail says why. */
  unavailable?: boolean;
}) {
  const id = useId();
  return (
    <button
      aria-describedby={`${id}-detail`}
      aria-labelledby={`${id}-label`}
      className={primary ? MENU_PRIMARY : MENU_ROW}
      data-controller-default={controllerDefault ? "true" : undefined}
      aria-disabled={unavailable ? "true" : undefined}
      type="button"
      {...firstClickOnly(onClick)}
    >
      <MenuItemContent
        detail={detail}
        id={id}
        label={label}
        primary={primary}
      />
    </button>
  );
}

/**
 * A first-screen item's inside: its name, what it leads to, and an arrow
 * that slides on when it is the current item.
 */
function MenuItemContent({
  detail,
  id,
  label,
  primary = false,
}: {
  detail: string;
  id: string;
  label: string;
  primary?: boolean;
}) {
  return (
    <>
      <span className="grid min-w-0 gap-1">
        <span
          className="home-menu-label break-words text-[2.125rem] font-bold uppercase leading-none tracking-[0.01em] sm:text-[2.5rem]"
          id={`${id}-label`}
        >
          {label}
        </span>
        <span
          className={`text-sm leading-[1.3] ${
            primary ? "text-titan-black" : "text-titan-muted"
          }`}
          id={`${id}-detail`}
        >
          {detail}
        </span>
      </span>
      <span
        aria-hidden="true"
        className="home-menu-arrow font-mono text-3xl font-bold"
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
      {...firstClickOnly(onChoose)}
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
        <span className="font-mono text-[0.62rem] font-bold uppercase tracking-[0.12em] text-titan-muted">
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

/** One course: picking it moves on to the last step. */
export function HomeCourseCard({
  chosen,
  controllerDefault = true,
  course,
  laps,
  onChoose,
}: {
  /** In a room's choice of courses, whether it's the one chosen. */
  chosen?: boolean;
  controllerDefault?: boolean;
  course: CourseDocument;
  laps: number;
  /** Without it, the card only shows the course, as to a room's guests. */
  onChoose?: () => void;
}) {
  const thumbnail = COURSE_THUMBNAILS[course.courseId];
  const card = `${OPTION} ${OPTION_CHOSEN} content-start gap-4 p-4`;
  const content = (
    <>
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
        <span className="font-mono text-[0.62rem] font-bold uppercase tracking-[0.12em] text-titan-muted">
          {laps} laps · Island Three
        </span>
      </span>
    </>
  );
  if (!onChoose) return <div className={card}>{content}</div>;
  return (
    <button
      aria-pressed={chosen}
      className={card}
      data-controller-default={controllerDefault ? "true" : undefined}
      type="button"
      {...firstClickOnly(onChoose)}
    >
      {content}
    </button>
  );
}

/** A choice on the last step, pressed while it is the one chosen. */
export function HomeChoice({
  children,
  chosen,
  className = "",
  onChoose,
}: {
  children: ReactNode;
  chosen: boolean;
  className?: string;
  onChoose: () => void;
}) {
  return (
    <button
      aria-pressed={chosen}
      className={`${OPTION} ${chosen ? OPTION_CHOSEN : OPTION_IDLE} min-h-12 content-center px-4 py-3 ${
        chosen ? "text-titan-ice" : "text-titan-ice/70"
      } ${className}`}
      type="button"
      {...firstClickOnly(onChoose)}
    >
      <span className="flex items-center gap-3 font-mono text-xs font-bold uppercase tracking-[0.14em]">
        <span className="truncate">{children}</span>
      </span>
    </button>
  );
}

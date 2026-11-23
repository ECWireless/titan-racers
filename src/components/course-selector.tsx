"use client";

import Image from "next/image";
import { type MouseEvent, type ReactNode, useEffect, useRef } from "react";

import { courseBoardPath, SCORE_BOARD_PATH } from "@/lib/leaderboard-path";

import { COURSE_THUMBNAILS } from "./home-steps";
import { LeaderboardIcon, RaceFlagIcon } from "./menu-icons";

/**
 * Opens a choice at once: only the address changes, and the view follows
 * it. A new tab or window is left to the link.
 */
function openInPlace(event: MouseEvent<HTMLAnchorElement>) {
  if (
    event.button !== 0 ||
    event.altKey ||
    event.ctrlKey ||
    event.metaKey ||
    event.shiftKey
  ) {
    return;
  }
  event.preventDefault();
  // The open one stays as it is, ranking and version too.
  if (event.currentTarget.dataset.selected) return;
  window.history.pushState(null, "", event.currentTarget.href);
}

function Choice({
  children,
  controllerDefault,
  href,
  label,
  selected,
}: {
  /** What sits behind the name: a course's picture, or a stand-in. */
  children: ReactNode;
  controllerDefault: boolean;
  href: string;
  label: ReactNode;
  selected: boolean;
}) {
  return (
    <li className="grid min-w-0">
      {/* A plain link: `Link` would wait on the server before switching. */}
      <a
        aria-current={selected ? "page" : undefined}
        className={`group grid grid-rows-[auto_1fr] border bg-titan-black/90 transition focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-titan-hazard motion-reduce:transition-none ${
          selected
            ? "border-titan-hazard text-titan-hazard"
            : "border-titan-ice/18 text-titan-ice/80 hover:border-titan-ice/50 hover:text-titan-ice active:border-titan-ice active:text-titan-ice"
        }`}
        data-controller-default={controllerDefault ? "true" : undefined}
        data-selected={selected ? "true" : undefined}
        href={href}
        onClick={openInPlace}
      >
        <span
          aria-hidden="true"
          className={`relative block h-14 overflow-hidden transition-opacity motion-reduce:transition-none sm:h-24 ${
            selected ? "" : "opacity-80 group-hover:opacity-100 group-active:opacity-100"
          }`}
        >
          {children}
          {/* The picture falls off to black above the name. */}
          <span className="absolute inset-x-0 bottom-0 h-1/4 bg-[linear-gradient(180deg,rgb(7_7_6/0),rgb(7_7_6/0.9))]" />
        </span>
        <span className="grid content-start gap-0.5 px-2 pb-2 pt-1.5 sm:px-3 sm:pb-3">
          {label}
        </span>
      </a>
    </li>
  );
}

const NAME_CLASS =
  "text-[0.72rem] font-bold uppercase leading-[1.1] tracking-[0.01em] sm:text-sm";

/**
 * The leaderboard's choices, side by side: the score board first, then each
 * course's own board under its picture. Hazard marks the one open. A few
 * share the width; more scroll sideways, keeping the open one in view.
 */
export function CourseSelector({
  courses,
  defaultChoice,
  selectedCourseId,
}: {
  courses: readonly { courseId: string; courseName: string }[];
  /** Whether a controller's first move starts from the open choice. */
  defaultChoice: boolean;
  /** Null on the score board. */
  selectedCourseId: string | null;
}) {
  const listRef = useRef<HTMLUListElement>(null);
  useEffect(() => {
    const list = listRef.current;
    const open = list?.querySelector<HTMLElement>("[data-selected]");
    if (!list || !open) return;
    const { left, width } = open.getBoundingClientRect();
    const frame = list.getBoundingClientRect();
    // Only the row moves, never the page.
    list.scrollLeft += left - frame.left - (frame.width - width) / 2;
  }, [courses, selectedCourseId]);

  return (
    <nav aria-label="Leaderboards" className="min-w-0">
      {/* Bled to the screen's edges on a phone, so a cut-off picture says
          there are more; padded so a focus outline is not clipped. */}
      <ul
        className="-mx-4 -my-2 grid auto-cols-[minmax(6.75rem,1fr)] grid-flow-col gap-2 overflow-x-auto px-4 py-2 [scrollbar-width:none] sm:-mx-2 sm:auto-cols-[minmax(9rem,1fr)] sm:gap-3 sm:px-2 [&::-webkit-scrollbar]:hidden"
        ref={listRef}
      >
        <Choice
          controllerDefault={defaultChoice && selectedCourseId === null}
          href={SCORE_BOARD_PATH}
          label={
            <>
              <span className="font-mono text-[0.56rem] font-bold uppercase tracking-[0.14em] text-titan-muted">
                All courses
              </span>
              <span className={NAME_CLASS}>High scores</span>
            </>
          }
          selected={selectedCourseId === null}
        >
          <span className="absolute inset-0 grid items-center px-2 sm:px-3">
            <LeaderboardIcon className="size-7" />
          </span>
        </Choice>
        {courses.map(({ courseId, courseName }) => {
          const picture = COURSE_THUMBNAILS[courseId];
          return (
            <Choice
              controllerDefault={defaultChoice && selectedCourseId === courseId}
              href={courseBoardPath(courseId)}
              key={courseId}
              label={<span className={NAME_CLASS}>{courseName}</span>}
              selected={selectedCourseId === courseId}
            >
              {picture ? (
                <Image
                  alt=""
                  className="object-cover object-[50%_45%]"
                  fill
                  sizes="(min-width: 640px) 16rem, 45vw"
                  src={picture}
                />
              ) : (
                // No picture yet: home's empty frame, flagged as a course.
                <span className="absolute inset-0 grid place-items-center bg-titan-steel/20 text-titan-ice/30">
                  <RaceFlagIcon className="size-6" />
                </span>
              )}
            </Choice>
          );
        })}
      </ul>
    </nav>
  );
}

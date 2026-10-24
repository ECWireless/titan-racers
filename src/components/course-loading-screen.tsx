"use client";

import { useEffect, useRef } from "react";

import type { CourseEnclosure } from "@/game/enclosure/island-three";
import { createExteriorView } from "@/game/enclosure/exterior-view";
import { useControllerMenuNavigation } from "@/game/input/use-controller-menu-navigation";

/** How long the loading screen fades out as the race appears. */
export const COURSE_LOADING_FADE_MS = 300;

/**
 * Covers a course while it loads with Island Three seen from outside,
 * turning at its true spin.
 */
export function CourseLoadingScreen({
  courseName,
  enclosure,
  leaving,
  onExit,
  onFirstFrame,
}: {
  courseName: string;
  enclosure: CourseEnclosure;
  leaving: boolean;
  onExit: () => void;
  /** Called once the exterior is on screen, or could not be drawn. */
  onFirstFrame: () => void;
}) {
  const viewRef = useRef<HTMLDivElement | null>(null);
  const menuRef = useRef<HTMLDivElement | null>(null);
  const onFirstFrameRef = useRef(onFirstFrame);
  const enclosureRef = useRef(enclosure);
  // Only the habitat and its mirror angle change what the exterior shows.
  const sceneKey = `${enclosure.id}@${enclosure.version}:${enclosure.mirrorAngle}`;

  useControllerMenuNavigation({
    containerRef: menuRef,
    enabled: !leaving,
    onBack: onExit,
  });

  useEffect(() => {
    onFirstFrameRef.current = onFirstFrame;
    enclosureRef.current = enclosure;
  });

  useEffect(() => {
    const view = createExteriorView(viewRef.current!, enclosureRef.current);
    if (!view) {
      onFirstFrameRef.current();
      return;
    }
    let active = true;
    void view.firstFrame.then(() => {
      if (active) onFirstFrameRef.current();
    });
    return () => {
      active = false;
      view.dispose();
    };
  }, [sceneKey]);

  return (
    <div
      className="course-loading fixed inset-0 z-50 bg-titan-black text-titan-ice"
      data-leaving={leaving}
      data-testid="course-loading-screen"
      style={{ transitionDuration: `${COURSE_LOADING_FADE_MS}ms` }}
    >
      <div ref={viewRef} className="absolute inset-0" />
      <div
        ref={menuRef}
        className="absolute inset-x-0 bottom-0 grid justify-items-start gap-4 bg-[linear-gradient(0deg,rgb(7_7_6/0.85)_0%,rgb(7_7_6/0.6)_60%,rgb(7_7_6/0)_100%)] px-5 pb-[max(1.5rem,env(safe-area-inset-bottom))] pt-16 sm:px-8 sm:pb-8 lg:px-12"
      >
        <div className="grid gap-1">
          <p className="font-mono text-xs font-bold uppercase tracking-[0.22em] text-titan-hazard">
            Island Three
          </p>
          <p className="text-2xl font-black uppercase tracking-[-0.03em] sm:text-3xl">
            {courseName}
          </p>
        </div>
        <div className="race-loader-track" aria-hidden="true">
          <div className="race-loader-sweep" />
        </div>
        <p className="sr-only" role="status" aria-live="polite">
          Loading race…
        </p>
        <button
          type="button"
          className="race-loader-exit -ml-4 min-h-11 px-4 font-mono text-[0.68rem] font-bold uppercase tracking-[0.14em] text-titan-ice/55 transition hover:text-titan-ice focus-visible:text-titan-ice"
          data-controller-default="true"
          onClick={onExit}
        >
          Exit
        </button>
      </div>
    </div>
  );
}

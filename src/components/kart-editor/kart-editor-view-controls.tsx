"use client";

import { useRef, type KeyboardEvent, type PointerEvent } from "react";

import type { KartViewPose } from "@/game/kart/kart-clearance";

export type KartEditorViewMode = "build" | "explode" | "motion";

const VIEW_MODES: Array<{ label: string; mode: KartEditorViewMode; title: string }> = [
  { label: "Build", mode: "build", title: "Edit the kart as it stands" },
  { label: "Explode", mode: "explode", title: "Pull the parts apart" },
  {
    label: "Motion",
    mode: "motion",
    title: "Pose the wheels through their travel and steering",
  },
];

const PANEL =
  "border border-titan-ice/20 bg-titan-black/88 shadow-[0_10px_35px_rgb(0_0_0/0.45)] backdrop-blur";

/** Build, Explode, or Motion, and X-ray over any of them. */
export function KartViewBar({
  mode,
  motionUnavailable,
  onModeChange,
  onXrayChange,
  xray,
}: {
  mode: KartEditorViewMode;
  /** An invalid assembly has no suspension to pose. */
  motionUnavailable: boolean;
  onModeChange: (mode: KartEditorViewMode) => void;
  onXrayChange: (xray: boolean) => void;
  xray: boolean;
}) {
  return (
    <div
      className={`absolute left-2 top-2 z-10 flex font-mono text-[0.6rem] font-bold uppercase tracking-[0.12em] sm:left-3 sm:top-3 sm:text-[0.65rem] ${PANEL}`}
      data-testid="kart-view-bar"
    >
      <div
        aria-label="View"
        className="flex"
        role="radiogroup"
        onKeyDown={(event) => {
          // Arrows move between the views, as in any radio group.
          const step =
            event.key === "ArrowRight" || event.key === "ArrowDown"
              ? 1
              : event.key === "ArrowLeft" || event.key === "ArrowUp"
                ? -1
                : 0;
          if (step === 0) return;
          event.preventDefault();
          const available = VIEW_MODES.filter(
            ({ mode: candidate }) =>
              candidate !== "motion" || !motionUnavailable,
          );
          const index = available.findIndex(
            ({ mode: candidate }) => candidate === mode,
          );
          const next =
            available[(index + step + available.length) % available.length];
          onModeChange(next.mode);
          event.currentTarget
            .querySelector<HTMLButtonElement>(`[data-view-mode="${next.mode}"]`)
            ?.focus();
        }}
      >
        {VIEW_MODES.map(({ label, mode: candidate, title }) => (
          <button
            aria-checked={mode === candidate}
            className={`px-2.5 py-2 transition-colors disabled:cursor-not-allowed disabled:opacity-40 sm:px-3 ${
              mode === candidate
                ? "bg-titan-hazard text-titan-black"
                : "text-titan-ice/80 enabled:hover:text-titan-hazard"
            }`}
            data-view-mode={candidate}
            disabled={candidate === "motion" && motionUnavailable}
            key={candidate}
            role="radio"
            tabIndex={mode === candidate ? 0 : -1}
            title={
              candidate === "motion" && motionUnavailable
                ? "Fix the assembly to pose its suspension"
                : title
            }
            type="button"
            onClick={() => onModeChange(candidate)}
          >
            {label}
          </button>
        ))}
      </div>
      <button
        aria-pressed={xray}
        className={`border-l border-titan-ice/20 px-2.5 py-2 transition-colors sm:px-3 ${
          xray
            ? "bg-titan-blue/20 text-titan-blue"
            : "text-titan-ice/80 hover:text-titan-blue"
        }`}
        title="See through the parts around the selection"
        type="button"
        onClick={() => onXrayChange(!xray)}
      >
        X-ray
      </button>
    </div>
  );
}

/** How far apart the exploded view pulls the parts. */
export function KartExplodeSlider({
  onChange,
  value,
}: {
  onChange: (value: number) => void;
  value: number;
}) {
  return (
    <label
      className={`absolute bottom-3 left-1/2 z-10 flex w-[min(26rem,calc(100%-1.5rem))] -translate-x-1/2 items-center gap-3 px-3 py-2 font-mono text-[0.6rem] font-bold uppercase tracking-[0.12em] text-titan-ice/80 ${PANEL}`}
    >
      <span>Together</span>
      <input
        aria-label="How far apart"
        className="min-w-0 flex-1 accent-titan-hazard"
        max={1}
        min={0}
        step={0.01}
        type="range"
        value={value}
        onChange={(event) => onChange(Number(event.target.value))}
      />
      <span>Apart</span>
    </label>
  );
}

const clamp = (value: number) => Math.min(Math.max(value, -1), 1);
const KEY_STEP = 0.1;

/**
 * One pad for the suspension and steering: up and down move the wheels
 * from full droop to full bump, left and right steer from lock to lock.
 * The pose stays where it's let go; double-click or Home returns to rest.
 */
export function KartMotionPad({
  onPoseChange,
  onReset,
  pose,
  steerDegrees,
  travelMillimeters,
}: {
  onPoseChange: (pose: KartViewPose) => void;
  onReset: () => void;
  pose: KartViewPose;
  /** The kart's centre steering angle (positive turns left). */
  steerDegrees: number;
  /** The front wheels' travel from rest (positive is bump). */
  travelMillimeters: number;
}) {
  const padRef = useRef<HTMLDivElement>(null);
  const draggingRef = useRef<number | null>(null);

  const poseAt = (event: PointerEvent) => {
    const rect = padRef.current?.getBoundingClientRect();
    if (!rect) return;
    const x = ((event.clientX - rect.left) / rect.width) * 2 - 1;
    const y = ((event.clientY - rect.top) / rect.height) * 2 - 1;
    // Right on the pad steers right, which is negative steering.
    onPoseChange({ steer: clamp(-x), travel: clamp(-y) });
  };

  const onKeyDown = (event: KeyboardEvent) => {
    const step = event.shiftKey ? KEY_STEP / 4 : KEY_STEP;
    const moves: Record<string, Partial<KartViewPose>> = {
      ArrowDown: { travel: clamp(pose.travel - step) },
      ArrowLeft: { steer: clamp(pose.steer + step) },
      ArrowRight: { steer: clamp(pose.steer - step) },
      ArrowUp: { travel: clamp(pose.travel + step) },
    };
    if (event.key === "Home") {
      event.preventDefault();
      onReset();
      return;
    }
    const move = moves[event.key];
    if (!move) return;
    event.preventDefault();
    onPoseChange({ ...pose, ...move });
  };

  const travel =
    Math.abs(travelMillimeters) < 0.05
      ? "Rest"
      : `${travelMillimeters > 0 ? "Bump" : "Droop"} ${Math.abs(travelMillimeters).toFixed(0)} mm`;
  const steering =
    Math.abs(steerDegrees) < 0.05
      ? "Straight"
      : `${Math.abs(steerDegrees).toFixed(0)}° ${steerDegrees > 0 ? "L" : "R"}`;

  return (
    <div
      className={`absolute bottom-3 right-3 z-10 grid w-36 gap-1.5 p-2 font-mono text-[0.55rem] font-bold uppercase tracking-[0.1em] text-titan-muted sm:w-40 ${PANEL}`}
      data-testid="kart-motion-pad"
    >
      <div
        aria-describedby="kart-motion-pad-help"
        aria-label={`Wheel travel and steering: ${travel}, ${steering}`}
        className="relative aspect-[4/3] cursor-crosshair touch-none border border-titan-ice/15 bg-[linear-gradient(rgb(255_255_255/0.08),rgb(255_255_255/0.08))_50%_0/1px_100%_no-repeat,linear-gradient(rgb(255_255_255/0.08),rgb(255_255_255/0.08))_0_50%/100%_1px_no-repeat] outline-none focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-titan-hazard"
        ref={padRef}
        role="group"
        tabIndex={0}
        onDoubleClick={onReset}
        onKeyDown={onKeyDown}
        onLostPointerCapture={() => {
          draggingRef.current = null;
        }}
        onPointerDown={(event) => {
          draggingRef.current = event.pointerId;
          event.currentTarget.setPointerCapture(event.pointerId);
          poseAt(event);
        }}
        onPointerMove={(event) => {
          if (draggingRef.current === event.pointerId) poseAt(event);
        }}
        onPointerUp={(event) => {
          if (draggingRef.current === event.pointerId) {
            draggingRef.current = null;
          }
        }}
      >
        <span className="pointer-events-none absolute left-1/2 top-1 -translate-x-1/2">
          Bump
        </span>
        <span className="pointer-events-none absolute bottom-1 left-1/2 -translate-x-1/2">
          Droop
        </span>
        <span className="pointer-events-none absolute left-1 top-1/2 -translate-y-1/2">
          L
        </span>
        <span className="pointer-events-none absolute right-1 top-1/2 -translate-y-1/2">
          R
        </span>
        <span
          aria-hidden="true"
          className="pointer-events-none absolute h-3.5 w-3.5 -translate-x-1/2 -translate-y-1/2 rounded-full bg-titan-hazard shadow-[0_0_0_4px_rgb(255_122_26/0.25)]"
          style={{
            left: `${((1 - pose.steer) / 2) * 100}%`,
            top: `${((1 - pose.travel) / 2) * 100}%`,
          }}
        />
      </div>
      <div
        className="flex justify-between text-titan-ice"
        data-testid="kart-motion-readout"
      >
        <span>{travel}</span>
        <span>{steering}</span>
      </div>
      <p className="sr-only" id="kart-motion-pad-help">
        Arrow keys move the wheels and steer. Home returns to rest.
      </p>
    </div>
  );
}

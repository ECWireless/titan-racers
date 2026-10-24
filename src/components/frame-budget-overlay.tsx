import type { FrameBudgetSummary } from "@/game/runtime/frame-budget";

export type FrameBudgetReport = {
  backBuffer: { height: number; width: number };
  /** Race mount to first rendered frame. */
  firstFrameMs: number | null;
  recording: boolean;
  summary: FrameBudgetSummary | null;
};

/** Loading-screen milestones, each from the tap that started the race. */
export type CourseLoadTimings = {
  /** The exterior's first frame on screen. */
  coverFirstFrameMs: number | null;
  /** The race scene built behind the loading screen. */
  raceReadyMs: number | null;
  /** The loading screen lifting and the countdown starting. */
  revealedMs: number | null;
};

const milliseconds = (value: number | null) =>
  value === null ? "—" : `${Math.round(value)} ms`;

/** Local `?perf=1` readout for the phone performance budget. */
export function FrameBudgetOverlay({
  loadTimings,
  report,
}: {
  loadTimings?: CourseLoadTimings;
  report: FrameBudgetReport;
}) {
  const { backBuffer, firstFrameMs, recording, summary } = report;
  const rows: Array<[string, string]> = [
    ["Buffer", `${backBuffer.width}×${backBuffer.height}`],
    ["First frame", milliseconds(firstFrameMs)],
  ];
  if (loadTimings) {
    rows.push(
      ["Cover frame", milliseconds(loadTimings.coverFirstFrameMs)],
      ["Race ready", milliseconds(loadTimings.raceReadyMs)],
      ["Revealed", milliseconds(loadTimings.revealedMs)],
    );
  }
  if (recording || !summary) {
    rows.push(["Status", recording ? "Recording" : "Waiting for race"]);
  } else {
    rows.push(
      ["Frames", String(summary.frames)],
      [
        "Frame p50/p95",
        `${summary.frameIntervalMs.median.toFixed(1)} / ${summary.frameIntervalMs.p95.toFixed(1)}`,
      ],
      [
        "CPU p50/p95",
        `${summary.workMs.median.toFixed(1)} / ${summary.workMs.p95.toFixed(1)}`,
      ],
      ["Hitches", String(summary.hitches)],
      [
        "Draws p50/max",
        `${summary.drawCalls.median} / ${summary.drawCalls.maximum}`,
      ],
      [
        "Fwd/shd max",
        `${summary.forwardDrawCalls.maximum} / ${summary.shadowDrawCalls.maximum}`,
      ],
      ["Shadow maps p50", String(summary.shadowMapUpdates.median)],
    );
  }
  return (
    <dl
      className="pointer-events-none absolute left-3 top-28 z-40 grid grid-cols-[auto_auto] gap-x-3 border border-titan-ice/25 bg-black/80 px-3 py-2 font-mono text-[0.6rem] uppercase tracking-[0.08em] text-titan-ice"
      data-testid="frame-budget"
    >
      {rows.map(([label, value]) => (
        <div className="contents" key={label}>
          <dt className="text-titan-ice/60">{label}</dt>
          <dd className="text-right tabular-nums">{value}</dd>
        </div>
      ))}
    </dl>
  );
}

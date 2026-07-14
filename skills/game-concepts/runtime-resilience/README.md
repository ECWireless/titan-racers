# Runtime Resilience

**Maturity:** Validated. PR 5B implementation, real browser and database
fixtures, the complete desktop/mobile regression matrix, feature-lead QA, and
independent review were accepted on 2026-07-14.

## Purpose And Scope

This node defines the smallest engine-independent resilience contract needed for
the browser race loop. It covers focus and visibility interruption, cancelled
input, large frame gaps, viewport changes, loading exits, and graphics-context
failure. It does not define general crash reporting, device profiling, adaptive
quality, offline play, or a broad performance-monitoring system.

## Standard

Protect player control and race integrity before trying to hide an interruption.
An active race that loses focus, becomes hidden, or loses its graphics context
must neutralize retained input and enter a safe pause. Returning never resumes
driving automatically: the player explicitly resumes after the runtime is ready.
Repeated browser signals for one interruption produce one automatic pause.

The fixed-step simulation keeps a bounded catch-up budget. A long or slow frame
must not create an unbounded physics burst; excess active time is discarded from
simulation while authoritative race timing accounts for it. Background time is
excluded by resetting the frame clock at the pause boundary.

Resize and orientation changes reconcile the renderer with the actual canvas
size without recreating gameplay state. Loading remains cancellable through an
immediate exit. A graphics-context loss pauses and explains recovery, allows the
engine a bounded restoration attempt, and otherwise offers reload and exit
instead of leaving a frozen interactive canvas.

## Minimal Runtime-Health Summary

Store only coarse per-run totals that answer operational questions:

- automatic safety-pause count: how often active runs were interrupted; and
- discarded active-simulation milliseconds: which runs exceeded the bounded
  fixed-step budget and by how much in aggregate.

Send the current totals when the document becomes hidden and with the terminal
run summary. Updates are monotonic and idempotent. Do not collect frame samples,
frame-rate timelines, viewport dimensions, focus timestamps, device details,
graphics-driver details, exception text, or stack traces. Graphics failures use
the existing allowlisted terminal categories.

## Failure Modes

- Clearing controls without pausing lets the race clock and opponents progress
  while the player cannot respond.
- Automatically resuming after focus return can reapply an intentional control
  or surprise a player whose attention has not returned.
- Simulating a complete background gap creates tunnelling, unstable contacts,
  and large non-deterministic catch-up bursts.
- Treating every resize as a runtime restart discards race state unnecessarily.
- Continuing to present a context-lost canvas as playable creates a silent
  frozen state; immediate fatal failure also wastes recoverable engine support.
- Per-frame health capture produces high-volume behavioral telemetry without
  improving the two approved operational questions.

## Validation

1. Focus, visibility, pointer cancellation, controller disconnect, and context
   loss all leave normalized input neutral.
2. One interruption produces one pause and requires explicit resume; countdown,
   racing, recovery, and finish states remain coherent.
3. Long-frame fixtures prove the fixed-step cap, discarded-time accounting, and
   absence of catch-up after resume.
4. Resize/orientation fixtures preserve scene and race state while updating the
   render surface.
5. Context loss/restoration fixtures cover recovery plus reload/exit fallback.
6. Loading failure and slow loading retain accessible status, controller focus,
   exit, and retry behavior.
7. Contract, database, and dashboard tests prove bounded monotonic summaries and
   reject unknown fields or negative/unbounded totals.
8. Desktop keyboard, narrow touch, and controller race paths pass together.

## Tool Mapping

- [`../../tools/browser-playcanvas-runtime/`](../../tools/browser-playcanvas-runtime/README.md)
  maps this standard to browser events, PlayCanvas, and the repository runtime.

## Primary Sources

- [MDN Page Visibility API](https://developer.mozilla.org/en-US/docs/Web/API/Page_Visibility_API)
- [MDN `webglcontextlost`](https://developer.mozilla.org/en-US/docs/Web/API/HTMLCanvasElement/webglcontextlost_event)
- [MDN `webglcontextrestored`](https://developer.mozilla.org/en-US/docs/Web/API/HTMLCanvasElement/webglcontextrestored_event)
- [MDN WebGL best practices](https://developer.mozilla.org/en-US/docs/Web/API/WebGL_API/WebGL_best_practices)

## Known Limits

- Browser exit and hidden-document delivery remain best-effort.
- This standard does not promise recovery from process termination, GPU reset,
  out-of-memory failure, or every browser/driver defect.
- Adaptive graphics quality requires a separately justified player-facing and
  measurement contract.

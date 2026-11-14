# Progressive Loading

**Maturity:** Candidate (PR 6.11, 2026-11-14).

## Purpose And Scope

This node defines when a race's startup work should run, so that adding
content does not slow the first frame or cause a hitch in play. It covers
work on the main thread and the GPU between a menu and the countdown. It
does not cover downloads, asset formats, or streaming a world larger than
one course.

Read it before adding anything a race builds at startup, and when a
first-frame or hitch measurement regresses.

## Standard

The first frame builds only what the first view and the first second of
play need. Everything else runs earlier, while a menu is idle, or later, in
short slices behind the loading screen. The race is ready only when
everything that affects play stands.

## Desired Outcome

The player sees the loading screen at once and a complete course when it
lifts. New content costs time behind the cover, where there is slack, and
none at the first frame or during play.

## Core Principles

- **Order work by when it is first seen or touched.** A start line, its
  surroundings, and the kart come first. What is out of sight of every
  start, such as planting behind a tunnel, can wait.
- **Use the three places work can go.** Before: on a menu, while the page
  is idle. At: the build before the first frame. After: behind the loading
  screen, once the first frame is drawn.
- **Slice by time, not by count.** A slice does at least one unit of work,
  then checks a clock and stops at its budget. A count that suits a fast
  device is a long freeze on a slow one. Behind a cover a slice should
  stay well under a frame, so the cover's own picture keeps moving.
- **Yield between slices.** The page must be free to draw and take input
  between them. Tie slices to timers, not to rendered frames: a slow
  renderer would otherwise stretch the work to one slice per slow frame,
  and a page that is not being drawn would never finish.
- **Readiness follows play, not pictures.** Colliders and anything a ghost
  or another racer's page must agree on stand before the countdown. Only
  decoration that cannot be seen arriving may come later.
- **Pay first-draw costs behind the cover.** A renderer may upload and
  compile when something is first drawn, not when it is created. Draw new
  content for a frame before the race is called ready.
- **Loading lasts until ready.** A failure or interruption after the first
  frame but before ready is still a loading failure.
- **Make the work resumable and shared.** Cache by input and keep partial
  progress, so idle warm-up, slices, and a caller that needs it at once
  all advance the same build.

## Recommended Model

1. Cover first: paint the loading screen before any build starts.
2. Build and draw the first frame from what is needed and what a menu's
   warm-up already cached.
3. After that frame, grow the rest in slices of a few milliseconds, each
   scheduled by a timer.
4. When it is whole, add it, let one frame draw it, then report ready.
5. Hold the cover for its minimum time or until ready, whichever is later.

Heavier work than slices can absorb belongs off the main thread (a worker
returning transferable buffers) or offline (baked at build time). Neither
is needed while the deferred work fits inside the cover's minimum hold.

## Failure Modes

- **Everything at the first frame.** Each new feature lengthens the freeze
  between the tap and the first picture.
- **Warm-up that never runs.** A player who taps straight through leaves
  no idle time. Warm-up is an optimisation and cannot be the only thing
  keeping the first frame short.
- **A warm-up step that is itself a freeze.** Warm-up slices its long
  steps too, or it delays the tap it was meant to speed up.
- **Pop-in.** Deferred content that is in view when the cover lifts, or
  deferred at all where there is no cover.
- **First-draw hitches in play.** Content created at startup but first
  drawn mid-race compiles its shaders there.
- **Deferred collision.** A racer reaches a tree before its collider
  exists, or two pages disagree about it.
- **Moving a cost out of the measurement.** Deferring work past the first
  frame is only a gain if ready and reveal times hold. Track all three.

## Validation

Measure on the target phone, against the previous build in the same
sitting: the first frame split into waiting, building, and rendering; the
time the race is ready; the time it is revealed; and hitches in a full
race. A change passes when the first frame holds, reveal does not move, and
no hitch appears where the deferred content first comes into view.

## Tool Mappings

- [Browser and PlayCanvas progressive loading](../../tools/browser-progressive-loading/README.md)
  maps this to browser scheduling and first-draw costs.
- [Scene lighting](../../project-systems/scene-lighting/README.md) owns
  Titan Racers' warm-up, loading screen, deferred builds, and readout.
- [Runtime resilience](../runtime-resilience/README.md) owns loading exits
  and interruption while loading.

## Sources

- [QualitySettings.asyncUploadTimeSlice](https://docs.unity3d.com/2021.3/Documentation/ScriptReference/QualitySettings-asyncUploadTimeSlice.html)
  (Unity): a per-frame millisecond budget, 1 to 33 ms, for uploads.
- [Streaming settings](https://dev.epicgames.com/documentation/en-us/unreal-engine/streaming-settings-of-the-unreal-engine-project-settings)
  (Unreal Engine): a per-frame time limit for asynchronous loading, with
  extra time for high-priority loads such as a loading screen's.
- [Optimize long tasks](https://web.dev/articles/optimize-long-tasks)
  (web.dev): breaking long work into pieces and yielding between them.

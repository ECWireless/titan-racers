# Browser And PlayCanvas Progressive Loading

**Maturity:** Candidate (PR 6.11, 2026-11-14).

## Purpose And Scope

This node maps the engine-independent
[`progressive-loading`](../../game-concepts/progressive-loading/README.md)
standard to browser scheduling and to PlayCanvas on WebGL. Read it before
scheduling startup work on the main thread.

## Scheduling Mapping

- **Idle time.** `requestIdleCallback` runs warm-up steps where it exists.
  Safari has none, so warm-up there runs on a timer once the player has
  not touched or typed for a moment, and a quick tap-through skips it.
- **Yielding.** `scheduler.yield()` is not in Safari either. A
  `setTimeout` chain is the yield that works everywhere: its continuation
  goes to the back of the task queue, and a nested chain is held to 4 ms a
  step, which behind a loading screen is a useful gap for its picture.
- **Long tasks.** Work over 50 ms is a long task. A slice checks
  `performance.now()` after each unit and stops at its budget.
- **Slow frames.** Timers and frames take turns, so on a slow renderer
  each short slice is followed by a slow frame. A slice that lasts half
  the wait since the last one keeps the work to a share of the time.
- **Hidden pages.** A hidden page gets no animation frames and its timers
  slow to about one a second. Work that waits for a drawn frame needs a
  timer beside it, and a hidden page should finish in one go: nobody is
  watching it stall.

## PlayCanvas And WebGL Mapping

- `app.once("postrender", ...)` is the "after this frame" hook. Schedule
  the work from it with a timer, or the work lands inside that frame.
- A mesh's buffers upload and a material's shader compiles when it is
  first drawn. A merged mesh as large as the course is inside every view,
  so it is drawn, and paid for, on the first frame after it is added.
- Entities with rigid bodies may be added to a running scene; the body
  joins the physics world when its entity joins the hierarchy.
- A graphics context can be lost between the first frame and ready. Until
  the race has reported ready it is still loading: stay behind the loading
  screen, and report a failure there as a load failure.

## Primary Sources

- [Optimize long tasks](https://web.dev/articles/optimize-long-tasks)
  (web.dev)
- [Use scheduler.yield() to break up long tasks](https://developer.chrome.com/blog/use-scheduler-yield)
  (Chrome)
- [requestIdleCallback](https://developer.mozilla.org/docs/Web/API/Window/requestIdleCallback)
  (MDN) and its [support table](https://caniuse.com/mdn-api_window_requestidlecallback)
- [Why do browsers throttle JavaScript timers?](https://nolanlawson.com/2025/08/31/why-do-browsers-throttle-javascript-timers/)
- [WebGL best practices](https://developer.mozilla.org/en-US/docs/Web/API/WebGL_API/WebGL_best_practices)
  and [KHR_parallel_shader_compile](https://developer.mozilla.org/en-US/docs/Web/API/KHR_parallel_shader_compile)
  (MDN)

## Known Limits

- Whether one drawn frame covers all of the park's shader compiling on
  Safari is measured only by the absence of hitches in a phone race.
- Generation still runs on the main thread. A worker returning
  transferable buffers is the next step if slices stop fitting inside the
  loading screen's minimum hold.

# Browser And PlayCanvas Runtime Resilience

**Maturity:** Validated. The PlayCanvas 2.20.6 mapping passed focused runtime,
real-browser lifecycle, resize, WebGL restoration/failure, database, and full
desktop/mobile regression verification on 2026-07-14.

## Purpose And Scope

This node maps the engine-independent
[`runtime-resilience`](../../game-concepts/runtime-resilience/README.md)
standard to browser lifecycle APIs, PlayCanvas, the custom fixed-step loop, and
the existing run-summary transport.

## Browser Lifecycle Mapping

- Listen to `window.blur` and `document.visibilitychange`. Both clear normalized
  input; the first signal during active play requests one automatic pause.
- On `document.hidden`, send the current bounded runtime-health summary with the
  same best-effort `keepalive` transport as terminal telemetry. Do not add
  `unload` or unconditional `beforeunload` handlers.
- Keep the race paused when focus/visibility returns. Explicit UI or controller
  confirmation resumes it and resets the fixed-step clock.
- Pointer cancellation, lost capture, keyboard blur, and gamepad disconnect stay
  owned by the existing input adapters and converge on neutral input.

## Fixed-Step And Resize Mapping

The existing `FixedStepClock` accepts at most 100 ms of one animation frame and
runs at most eight 120 Hz steps. It reports the remainder as discarded active
time. Preserve that cap, add discarded time to authoritative race timing, and
accumulate only a bounded rounded per-run total for health reporting.

The app uses PlayCanvas `RESOLUTION_AUTO` and `FILLMODE_FILL_WINDOW`. Call
`Application.resizeCanvas()` on `resize` and `orientationchange` so CSS size,
back-buffer resolution, camera aspect, and picking coordinates reconcile
immediately. Do not persist viewport or pixel-ratio values.

## WebGL Context Mapping

PlayCanvas 2.20.6 already registers `webglcontextlost` and
`webglcontextrestored`, prevents the default permanent-loss behavior, rebuilds
graphics-device state and resources, and emits `devicelost`/`devicerestored`.
Project listeners therefore coordinate gameplay and presentation rather than
duplicating engine resource reconstruction:

1. On loss, clear input, pause simulation, hide driving controls, and show a
   restoring state with exit available.
2. Allow a bounded restoration window.
3. On restoration, call `resizeCanvas()`, return to the ordinary pause dialog,
   and require explicit resume.
4. If restoration does not arrive or the post-restore render path fails, end the
   run with an allowlisted runtime failure and offer reload plus exit.

Use the standardized `WEBGL_lose_context` extension only in automated or manual
diagnostics; production code must never trigger context loss deliberately.

## Telemetry Mapping

Add a strict `runtime_health` milestone containing only bounded nonnegative
`automaticPauseCount` and `discardedTimeMs`. The repository updates each value
monotonically and accepts safe duplicates. Terminal events repeat the final
totals so a normal finish does not require extra requests. A hidden-document
flush is best-effort and never blocks lifecycle handling.

The dashboard should show runs with automatic pauses and runs with discarded
time, plus a coarse aggregate such as median discarded time among affected
runs. Do not add charts, samples, viewport/device breakdowns, or raw run IDs.

## Verification

- Pure runtime tests inject animation frames and lifecycle events.
- Playwright uses `visibilitychange`, resize, input cancellation, delayed load,
  and `WEBGL_lose_context` fixtures without depending on physical devices.
- Existing keyboard, touch, controller, race-session, telemetry, admin, and
  complete browser suites remain the regression baseline.

## Primary Sources

- [PlayCanvas 2.20.6 `Application`](https://api.playcanvas.com/engine/classes/Application.html)
- [PlayCanvas WebGL graphics-device source](https://github.com/playcanvas/engine/blob/v2.20.6/src/platform/graphics/webgl/webgl-graphics-device.js)
- [MDN Page Visibility API](https://developer.mozilla.org/en-US/docs/Web/API/Page_Visibility_API)
- [MDN `WEBGL_lose_context`](https://developer.mozilla.org/en-US/docs/Web/API/WEBGL_lose_context)

## Known Limits

- PlayCanvas resource restoration is the supported baseline, but recovery still
  depends on the browser and graphics driver.
- Full-screen fill mode makes window/orientation events sufficient for the
  current app. An embedded or independently resized canvas would justify a
  `ResizeObserver` later.

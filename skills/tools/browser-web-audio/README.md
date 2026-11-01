# Browser Web Audio

**Maturity:** Candidate (PR 4.5.1, 2026-11-01).

## Purpose And Scope

Maps the [`game-audio`](../../game-concepts/game-audio/README.md) standard to
the browser's built-in Web Audio API. Read it before touching the audio
context, its lifecycle, or how voices are built. There is no audio
dependency, and PlayCanvas's sound system is not used: it plays recorded
files, while race sound is generated in code and changed every frame.

## Context Lifecycle

- One `AudioContext` per page, shared by every race. Browsers cap how many a
  page may create.
- Browsers start a context only from a user gesture. iPhone Safari is the
  strictest, so the context is resumed synchronously inside the click that
  starts a race (Solo Time Trial, the editor's test drive) and the one that
  resumes from pause.
- A `resume()` refused outside a gesture, or an iPhone interruption such as a
  call, is retried on the next pointer, touch, or key event.
- `suspend()` stops all audio processing, so pause, mute, blur, a hidden tab,
  and exit suspend the context rather than silencing it with gain.
- `suspend()` and `resume()` settle asynchronously, so `state` can lag a
  request. Send the wanted one on every change instead of deciding from
  `state`; the context applies them in order.
- A suspended context's clock stands still. Skip parameter updates while it
  is not running instead of queuing automation events.
- Gamepad input is not a user gesture. A race started only from a controller
  stays silent until the first tap, click, or key press.
- The iPhone ringer switch silences Web Audio.

## Synthesis Methods

- Schedule every parameter change at `context.currentTime` with
  `setTargetAtTime`, and skip writes that would not change the value, so
  per-frame updates are cheap and click-free.
- Generate noise and other buffers once per context and cache them per
  context.
- Voices use oscillators (with periodic waves), buffer sources, biquad
  filters, gains, and wave shapers.
- Not used: `AudioWorklet`, `ScriptProcessor`, `ConvolverNode`, panners, or
  media elements. They cost too much on phones or are not needed.
- A master `GainNode` feeds one `DynamicsCompressorNode` limiter before the
  destination.

## Verification

- Headless Chromium runs the context lifecycle in browser tests: a click
  counts as a gesture, and the context's `state` is observable.

## Known Limits

- Desktop Safari and iPhone Safari autoplay behavior needs manual checks.
- There is no positional audio or Doppler effect.

## Project Systems

- Race audio lives in `src/game/audio/`.

## Sources

- [Web Audio API](https://www.w3.org/TR/webaudio/) (W3C).
- [Autoplay guide for media and Web Audio APIs](https://developer.mozilla.org/en-US/docs/Web/Media/Guides/Autoplay)
  (MDN).

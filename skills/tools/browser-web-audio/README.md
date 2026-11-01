# Browser Web Audio

**Maturity:** Candidate (PR 4.5.1, 2026-11-01).

## Purpose And Scope

Maps the [`game-audio`](../../game-concepts/game-audio/README.md) standard to
the browser's built-in Web Audio API. Read it before touching the audio
context, its lifecycle, or how voices are built. There is no audio
dependency, and PlayCanvas's sound system is not used: race sound is mostly
generated in code and changed every frame. A recorded loop, where one is
used, is fetched once, decoded with `decodeAudioData`, and played through
the same graph; the generated sound covers for it until it loads or if it
fails to.

## Context Lifecycle

- One `AudioContext` per page, shared by every race. Browsers cap how many a
  page may create.
- Browsers start a context only from a user gesture. iPhone Safari is the
  strictest, so resume the context synchronously inside every click that
  starts or resumes play.
- A `resume()` refused outside a gesture, or an iPhone interruption such as a
  call, is retried on the next pointer, touch, or key event.
- `suspend()` stops all audio processing, so mute, blur, a hidden tab, and
  exit suspend the context rather than silencing it with gain.
- Waking a suspended context takes up to a few hundred milliseconds,
  longest on iPhone, so the first sound after it is late. Through a short
  pause or a loading screen, keep the context running and silence it with
  gain instead, so a countdown's first tick lands on time.
- `suspend()` and `resume()` settle asynchronously, so `state` can lag a
  request. Send the wanted one on every change instead of deciding from
  `state`; the context applies them in order.
- A suspended context's clock stands still. Skip parameter updates and
  one-shot sounds while it is not running instead of queuing them; a sound
  that must not be missed may wait at the frozen clock and plays as it
  starts.
- A game loop that stops its per-frame updates while paused leaves looping
  voices holding their last sound. Close them through a gain driven by game
  state, which applies even on a suspended context's frozen clock.
- Gamepad input is not a user gesture. A race started only from a controller
  stays silent until the first tap, click, or key press.
- The iPhone ringer switch silences Web Audio.

## Synthesis Methods

- Schedule every parameter change at `context.currentTime` with
  `setTargetAtTime`, and skip writes that would not change the value, so
  per-frame updates are cheap and click-free.
- Generate noise and other buffers once per context and cache them per
  context. Mono at 48 kHz costs about 190 kB per second of audio.
- One-shot sounds can play segments of a bank rendered in code, such as
  contact pulses through inharmonic modal resonators. Rendering takes tens
  of milliseconds, so do it behind a loading screen, never at the first hit.
- Give each one-shot a fixed node budget and stop every source it starts.
- Voices use oscillators (with periodic waves), buffer sources, biquad
  filters, gains, and wave shapers.
- Not used: `AudioWorklet`, `ScriptProcessor`, `ConvolverNode`, panners, or
  media elements. They cost too much on phones or are not needed.
- A master `GainNode` feeds one `DynamicsCompressorNode` limiter before the
  destination.

## Verification

- Headless Chromium runs the context lifecycle in browser tests: a click
  counts as a gesture, and the context's `state` is observable.
- A debug readout of recent events and current inputs lets tests check
  sounds without listening.

## Known Limits

- Desktop Safari and iPhone Safari autoplay behavior needs manual checks.
- There is no positional audio or Doppler effect.
- A limiter catches peaks; it is not the mix. A 3 ms attack lets sharp hits
  through, so keep mix levels low enough that the loudest hit stays under
  0 dBFS after it.

## Project Systems

- Race audio lives in `src/game/audio/`.

## Sources

- [Web Audio API](https://www.w3.org/TR/webaudio/) (W3C).
- [Autoplay guide for media and Web Audio APIs](https://developer.mozilla.org/en-US/docs/Web/Media/Guides/Autoplay)
  (MDN).

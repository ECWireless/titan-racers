# Browser Web Audio

**Maturity:** Candidate (PR 4.5.1, 2026-11-01).

## Purpose And Scope

Maps the [`game-audio`](../../game-concepts/game-audio/README.md) standard to
the browser's built-in Web Audio API. Read it before touching the audio
context, its lifecycle, or how voices are built. There is no audio
dependency, and PlayCanvas's sound system is not used: race sound is mostly
generated in code and changed every frame. A recorded loop, where one is
used, is fetched once, decoded with `decodeAudioData`, and played through
the same graph. Where a generated sound exists, such as the asphalt roll,
it covers for the recording until it loads or if it fails to; an ambience
bed with no generated stand-in stays silent until then.

## Context Lifecycle

- One `AudioContext` per page, shared by every race. Browsers cap how many a
  page may create.
- Browsers start a context only from a user gesture. iPhone Safari is the
  strictest, so resume the context synchronously inside every click that
  starts or resumes play.
- A `resume()` refused outside a gesture, or an iPhone interruption such as a
  call, is retried on the next pointer, touch, or key event.
- Once the page has been hidden, resume only inside a gesture: the end of a
  tap, a click, or a key press. Coming back, iPhone WebKit sends focus
  before the page is visible, refuses a resume tried then, and the context
  afterwards reports `running` with its clock stopped and no output, for the
  rest of the page. A background tab or app switch while a race loads
  counts, so a race whose sound waits for that gesture opens paused, and
  its Resume tap brings the sound.
- `suspend()` stops all audio processing, so mute, blur, a hidden tab, and
  exit (on pages without menu sounds) suspend the context rather than
  silencing it with gain.
- Create the voices just after the scene's first drawn frame, not during
  the scene build: building a graph of started sources then slowed an
  iPhone's first frame by about 60 ms. Until then, track focus and
  visibility for the unlocked context yourself, so a blur or hidden tab
  while loading still suspends it.
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
- Menu sounds start the shared context on the page's first pointer, touch,
  or key event, so the sound that event leads to is not late, and keep it
  running afterwards, through the end of a race; like other one-shots, one
  due before then is skipped.
- Gamepad input is not a user gesture. A race started only from a controller
  stays silent until the first tap, click, or key press, and so does one a
  controller player comes back to after the page hid.
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
  filters, gains, and wave shapers. A short room echo, such as a tunnel's,
  is one delay node with a low-pass in a feedback loop.
- Not used: `AudioWorklet`, `ScriptProcessor`, `ConvolverNode`, panners, or
  media elements. They cost too much on phones or are not needed.
- A master `GainNode` feeds one `DynamicsCompressorNode` limiter, then one
  volume `GainNode` per context before the destination. Menu sounds feed the
  volume gain directly. The gain is the square of the Volume level, so each
  step sounds about as large as the last.

## Verification

- Headless Chromium runs the context lifecycle in browser tests: a click
  counts as a gesture, and the context's `state` is observable.
- A debug readout of recent events and current inputs lets tests check
  sounds without listening.

## Known Limits

- Desktop Safari and iPhone Safari autoplay behavior needs manual checks.
- There is no positional audio or Doppler effect.
- A limiter catches peaks; it is not the mix. Even a 1 ms attack lets sharp
  hits through, so keep mix levels low enough that the loudest hit stays under
  0 dBFS after it.

## Project Systems

- Race and menu audio live in `src/game/audio/`; menu sounds are played
  app-wide by `src/components/ui-sounds.tsx`.

## Sources

- [Web Audio API](https://www.w3.org/TR/webaudio/) (W3C).
- [Autoplay guide for media and Web Audio APIs](https://developer.mozilla.org/en-US/docs/Web/Media/Guides/Autoplay)
  (MDN).

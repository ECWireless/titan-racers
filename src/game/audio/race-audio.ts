import {
  createBodyScrapeVoice,
  createScrubVoice,
  createTireRollVoice,
} from "./contact-voices";
import { playCueSound } from "./cue-sounds";
import {
  playImpactSound,
  playLandingSound,
  prepareImpactSounds,
} from "./impact-sounds";
import { createParameterSmoother } from "./audio-synthesis";
import { createMotorVoice } from "./motor-voice";
import {
  SILENT_MOTOR,
  type AudioSurface,
  type AudioWheel,
  type ImpactMaterial,
  type MotorAudioState,
  type RaceCue,
} from "./race-audio-mapping";

/**
 * The browser side of race sound: one shared audio context for the page,
 * started by a user gesture, plus a master bus and limiter per race.
 *
 * The context runs while a race exists, Sound effects is on, and the page is
 * visible and focused; otherwise it is suspended, which stops all audio
 * processing. A paused or covered race keeps it running but silent: waking
 * a suspended context takes up to a few hundred ms (longest on iPhone),
 * which would make the first countdown tick late.
 */

const SOUND_STORAGE_KEY = "titan-racers.sound.v1";

/**
 * Mix levels in dB, set by listening QA in a race. A full-strength hit peaks
 * under 0 dBFS after the limiter, and a firm tap barely touches it.
 */
const MASTER_GAIN = 0.9;
const MIX_DB = {
  ambience: -12,
  bodyScrape: -4,
  cue: -5.5,
  impact: 8,
  landing: 2.4,
  motor: -5.6,
  scrub: -1.8,
  tireRoll: -1.4,
};

let sharedContext: AudioContext | null = null;
// Whether the page has focus, tracked for the page's lifetime from the click
// that first unlocks audio, so race audio created later (after the scene's
// first frame) starts from it. `hasFocus()` can read false in a page that
// has focus (headless browsers), so a trusted gesture or focus event sets it.
let pageFocused = true;
// Set when the page hides; cleared by the next trusted gesture. iPhone
// WebKit refuses a resume while a page is coming back (focus arrives before
// it is visible), and a context refused then later reports "running" with
// its clock stopped and no output. Resuming only inside a gesture once the
// page has hidden avoids that.
let hiddenSinceGesture = false;
let pageListenersInstalled = false;

/** Installed once, with the first context, for the page's lifetime. */
function installPageListeners() {
  if (pageListenersInstalled) return;
  pageListenersInstalled = true;
  // Before a race's audio exists, nothing else stops the unlocked context
  // on blur or a hidden tab (which draws no frames, so its race audio waits
  // to be built). Race audio resumes it itself once it is wanted again.
  window.addEventListener("blur", () => {
    pageFocused = false;
    if (sharedContext) runContext(sharedContext, false);
  });
  window.addEventListener("focus", () => {
    pageFocused = true;
  });
  document.addEventListener("visibilitychange", () => {
    if (!document.hidden) return;
    hiddenSinceGesture = true;
    if (sharedContext) runContext(sharedContext, false);
  });
  // Installed before any race audio's own gesture listeners, so a gesture
  // clears the flag before they resume. Only a tap's end, a click, or a key
  // counts as a gesture for audio on iPhone.
  const onGesture = (event: Event) => {
    if (!event.isTrusted) return;
    pageFocused = true;
    hiddenSinceGesture = false;
  };
  for (const name of ["touchend", "click", "keydown"]) {
    window.addEventListener(name, onGesture, true);
  }
}

const ASPHALT_RECORDING_URL = "/audio/asphalt-roll.wav";
const HABITAT_BED_URL = "/audio/habitat-bed.wav";
const TUNNEL_TONE_URL = "/audio/tunnel-tone.wav";
const STREAM_URL = "/audio/stream.wav";
/** The stream's level at the water, over the beds. */
const STREAM_GAIN = 0.5;
const recordings = new WeakMap<
  BaseAudioContext,
  Map<string, Promise<AudioBuffer | null>>
>();

/** Fetches and decodes a recorded loop once per context; null on failure. */
function loadRecording(context: BaseAudioContext, url: string) {
  let loops = recordings.get(context);
  if (!loops) {
    loops = new Map();
    recordings.set(context, loops);
  }
  let pending = loops.get(url);
  if (!pending) {
    pending = fetch(url)
      .then((response) => (response.ok ? response.arrayBuffer() : null))
      .then((data) => (data ? context.decodeAudioData(data) : null))
      .catch(() => null)
      .then((buffer) => {
        // A failure is not kept: the next race tries again.
        if (!buffer) loops.delete(url);
        return buffer;
      });
    loops.set(url, pending);
  }
  return pending;
}

/**
 * A looping recording with its own level, silent until it loads. A distant
 * source stops playing entirely, and starts again at a random point.
 */
function createLoopPlayer(context: BaseAudioContext, output: AudioNode) {
  const gain = context.createGain();
  gain.gain.value = 0;
  gain.connect(output);
  let buffer: AudioBuffer | null = null;
  let source: AudioBufferSourceNode | null = null;
  let running = false;
  const sync = () => {
    if (running && buffer && !source) {
      source = context.createBufferSource();
      source.buffer = buffer;
      source.loop = true;
      source.connect(gain);
      source.start(0, Math.random() * buffer.duration);
    } else if (!running && source) {
      try {
        source.stop();
      } catch {
        // Already stopped.
      }
      source.disconnect();
      source = null;
    }
  };
  return {
    gain: gain.gain,
    loaded: () => buffer !== null,
    setBuffer(next: AudioBuffer) {
      buffer = next;
      sync();
    },
    setRunning(next: boolean) {
      running = next;
      sync();
    },
    dispose() {
      running = false;
      sync();
      gain.disconnect();
    },
  };
}

function getSharedContext() {
  if (sharedContext) return sharedContext;
  if (
    typeof window === "undefined" ||
    typeof window.AudioContext !== "function"
  ) {
    return null;
  }
  try {
    sharedContext = new window.AudioContext({ latencyHint: "interactive" });
  } catch {
    return null;
  }
  installPageListeners();
  return sharedContext;
}

// Suspend and resume settle asynchronously, so `state` can lag a request.
// Always send the wanted one: the context applies them in order, and a
// repeat is a no-op.
function runContext(context: AudioContext, running: boolean) {
  // Once the page has hidden, only a gesture may resume it (see above).
  if (running && hiddenSinceGesture) return;
  void (running ? context.resume() : context.suspend()).catch(() => undefined);
}

/** The player's Sound effects switch, kept on this device. On by default. */
export function readSoundOn() {
  try {
    const stored: unknown = JSON.parse(
      window.localStorage.getItem(SOUND_STORAGE_KEY) ?? "null",
    );
    if (stored && typeof stored === "object") {
      const { effects } = stored as { effects?: unknown };
      if (typeof effects === "boolean") return effects;
    }
  } catch {
    // Unreadable storage or a malformed value: fall back to on.
  }
  return true;
}

export function writeSoundOn(on: boolean) {
  try {
    window.localStorage.setItem(
      SOUND_STORAGE_KEY,
      JSON.stringify({ effects: on }),
    );
  } catch {
    // Storage can be unavailable (private mode); the choice lasts this page.
  }
}

/**
 * Call from inside a user gesture that leads to a race. Browsers, iPhone
 * Safari in particular, only let audio start from one.
 */
export function unlockRaceAudio(soundOn = readSoundOn()) {
  // Called from a gesture, which proves the page has focus.
  pageFocused = true;
  if (!soundOn) return;
  const context = getSharedContext();
  if (context) runContext(context, true);
}

/**
 * The page has hidden since its last gesture, so sound cannot start until
 * the next tap, click, or key press. A race starting now should open paused,
 * so its Resume tap brings the sound.
 */
export function raceAudioAwaitsGesture() {
  return hiddenSinceGesture && sharedContext !== null;
}

/** For a race that ends before its audio exists, such as a failed load. */
export function suspendRaceAudio() {
  if (sharedContext) runContext(sharedContext, false);
}

export type RaceAudioDebugState = {
  active: boolean;
  /** On screen, unpaused, and Sound effects on: the master is open. */
  audible: boolean;
  /** The recorded asphalt loop has loaded and replaced the generated one. */
  recordedAsphalt: boolean;
  contextState: string;
  cues: RaceCue[];
  impacts: Array<{ material: ImpactMaterial; strength: number }>;
  landings: Array<{ strength: number; surface: AudioSurface }>;
  motor: MotorAudioState;
  /** Sound effects are switched off, so the context stays suspended. */
  muted: boolean;
  /** Motor, tire roll, and scrub may sound: the world is moving. */
  continuousVoices: boolean;
  wheels: readonly AudioWheel[];
  bodyScrape: number;
  bodyScrapeHard: boolean;
  ambience: {
    habitatBed: boolean;
    indoors: number;
    stream: number;
    streamLoaded: boolean;
    tunnelTone: boolean;
  };
};

export type RaceAudio = {
  getDebugState: () => RaceAudioDebugState;
  playCue: (cue: RaceCue) => void;
  playImpact: (strength: number, material: ImpactMaterial) => void;
  playLanding: (strength: number, surface: AudioSurface) => void;
  /**
   * Builds the tire voices, renders the impact and landing sounds (tens of
   * ms each), starts the recordings downloading, and lets the context run.
   * Call after the scene's first frame, while the race is still covered, so
   * neither the scene build nor the first hit pays for any of it.
   */
  prepare: () => void;
  /** On screen, unpaused, and ready. */
  setActive: (active: boolean) => void;
  setSoundOn: (on: boolean) => void;
  /** Opens or closes the motor, tire roll, and scrub. */
  setContinuousVoices: (open: boolean) => void;
  updateMotor: (state: MotorAudioState) => void;
  updateWheels: (wheels: readonly AudioWheel[]) => void;
  /** A tipped kart's body sliding on the ground: 0–1, on hard ground or not. */
  updateBodyScrape: (level: number, hard: boolean) => void;
  /**
   * `indoors` 0 outdoors to 1 in the tunnel, eased across portals; `stream`
   * 0 out of range to 1 at the water.
   */
  updateAmbience: (indoors: number, stream: number) => void;
  dispose: () => void;
};

/** Event history kept for tests; old entries drop off. */
const DEBUG_HISTORY = 16;
const remember = <T>(list: T[], item: T) => {
  list.push(item);
  if (list.length > DEBUG_HISTORY) list.shift();
};

const fromDb = (decibels: number) => 10 ** (decibels / 20);

export function createRaceAudio(soundOn: boolean): RaceAudio | null {
  const context = getSharedContext();
  if (!context) return null;

  const master = context.createGain();
  // Silent until the race is on screen and unpaused.
  master.gain.value = 0;
  const limiter = context.createDynamicsCompressor();
  limiter.threshold.value = -6;
  limiter.knee.value = 0;
  limiter.ratio.value = 20;
  limiter.attack.value = 0.001;
  limiter.release.value = 0.12;
  master.connect(limiter).connect(context.destination);

  // The always-on voices pass through one gate, closed while the world
  // stands still (paused, or counting down to resume). The race skips its
  // per-frame updates then, so the voices would hold their last sound.
  const continuousGate = context.createGain();
  let continuousOpen = true;
  // The kart's own sounds, dry, plus a short echo in the tunnel: a single
  // concrete-box reflection about 21 ms back, darkened, with a little
  // feedback for the far wall. Silent outdoors.
  const kartBus = context.createGain();
  kartBus.connect(master);
  continuousGate.connect(kartBus);
  const echoDelay = context.createDelay(0.05);
  echoDelay.delayTime.value = 0.021;
  const echoTone = context.createBiquadFilter();
  echoTone.type = "lowpass";
  echoTone.frequency.value = 2400;
  const echoFeedback = context.createGain();
  echoFeedback.gain.value = 0.3;
  const echoWet = context.createGain();
  echoWet.gain.value = 0;
  kartBus.connect(echoDelay).connect(echoTone).connect(echoWet).connect(master);
  echoTone.connect(echoFeedback).connect(echoDelay);
  const bus = (decibels: number, destination: AudioNode = master) => {
    const gain = context.createGain();
    gain.gain.value = fromDb(decibels);
    gain.connect(destination);
    return gain;
  };
  const buses = {
    cue: bus(MIX_DB.cue),
    ambience: bus(MIX_DB.ambience),
    bodyScrape: bus(MIX_DB.bodyScrape, continuousGate),
    impact: bus(MIX_DB.impact, kartBus),
    landing: bus(MIX_DB.landing, kartBus),
    motor: bus(MIX_DB.motor, continuousGate),
    scrub: bus(MIX_DB.scrub, continuousGate),
    tireRoll: bus(MIX_DB.tireRoll, continuousGate),
  };
  const motorVoice = createMotorVoice(context, buses.motor);
  const bodyScrapeVoice = createBodyScrapeVoice(context, buses.bodyScrape);
  let bodyScrape = 0;
  let scrapeHard = false;
  // The habitat's air handling outdoors, and the tunnel's closer hum inside,
  // crossfaded by how far the listener is inside.
  const habitatBed = createLoopPlayer(context, buses.ambience);
  const tunnelTone = createLoopPlayer(context, buses.ambience);
  const stream = createLoopPlayer(context, buses.ambience);
  habitatBed.setRunning(true);
  tunnelTone.setRunning(true);
  // Recordings download and decode only once the scene has drawn its first
  // frame (`prepare`), so they never compete with building the course.
  const loadRecordings = () => {
    for (const [player, url] of [
      [habitatBed, HABITAT_BED_URL],
      [tunnelTone, TUNNEL_TONE_URL],
      [stream, STREAM_URL],
    ] as const) {
      void loadRecording(context, url).then((buffer) => {
        if (buffer && !disposed) player.setBuffer(buffer);
      });
    }
    void loadRecording(context, ASPHALT_RECORDING_URL).then((buffer) => {
      if (!buffer || disposed) return;
      asphaltRecording = buffer;
      contactVoices?.tires.setAsphaltRecording(buffer);
      recordedAsphalt = true;
    });
  };
  let streamLevel = 0;
  // When the stream's level first reached 0, on the audio clock.
  let streamQuietSince: number | null = null;
  let indoorAmount = 0;
  const setAmbience = createParameterSmoother();
  // The tire voices generate their gravel and water textures (tens of ms,
  // longer on phones), so they are built in `prepare`, after the scene's
  // first frame, not during the scene build.
  let contactVoices: {
    scrub: ReturnType<typeof createScrubVoice>;
    tires: ReturnType<typeof createTireRollVoice>;
  } | null = null;
  let asphaltRecording: AudioBuffer | null = null;
  const prepareContactVoices = () => {
    if (!contactVoices) {
      contactVoices = {
        scrub: createScrubVoice(context, buses.scrub),
        tires: createTireRollVoice(context, buses.tireRoll),
      };
      if (asphaltRecording) {
        contactVoices.tires.setAsphaltRecording(asphaltRecording);
      }
    }
    return contactVoices;
  };
  // The generated asphalt plays until the recording arrives, or for good if
  // it cannot load.
  const cues: RaceCue[] = [];
  const impacts: RaceAudioDebugState["impacts"] = [];
  const landings: RaceAudioDebugState["landings"] = [];
  let wheels: readonly AudioWheel[] = [];
  // Cues sent while the context is not yet running wait at its frozen clock.
  // Keep only one, so a resume refused until a tap cannot release a pile.
  let cueWaiting = false;
  const onStateChange = () => {
    if (context.state === "running") cueWaiting = false;
  };
  context.addEventListener("statechange", onStateChange);

  let active = false;
  let disposed = false;
  let prepared = false;
  let motor = SILENT_MOTOR;
  let soundEnabled = soundOn;
  let recordedAsphalt = false;
  // Runs whenever it may (silent while covered), so the first countdown tick
  // is on time. Create it after the scene's first frame: building the graph
  // during the scene build slows that frame on iPhone.
  const wanted = () =>
    soundEnabled && !disposed && pageFocused && !document.hidden;
  const audible = () => active && soundEnabled;
  const apply = () => {
    // A sound still ringing out stops with the race or the switch. Coming
    // back fades in over a few ms, so a cue sent in the same moment the race
    // turns active starts on time; the countdown opens it itself.
    const now = context.currentTime;
    master.gain.cancelScheduledValues(now);
    if (audible()) master.gain.setTargetAtTime(MASTER_GAIN, now, 0.004);
    else master.gain.setValueAtTime(0, now);
    runContext(context, wanted());
  };
  // The race pauses itself on blur and hidden tabs, but not once it has
  // finished, so the page's own state is checked here too.
  const onBlur = () => {
    pageFocused = false;
    apply();
  };
  const onFocus = () => {
    pageFocused = true;
    apply();
  };
  // A resume refused outside a gesture, or an iPhone interruption such as a
  // call, retries on the next tap, click, or key press.
  const retryInGesture = () => {
    // A trusted gesture proves the page has focus, even if a browser (iPhone
    // Safari) never sent the focus event.
    pageFocused = true;
    if (wanted() && context.state !== "running") runContext(context, true);
  };
  // A click too: once the page has hidden, a mouse's pointerdown comes
  // before the click that clears it.
  const gestureEvents = [
    "pointerdown",
    "keydown",
    "touchend",
    "click",
  ] as const;
  window.addEventListener("blur", onBlur);
  window.addEventListener("focus", onFocus);
  document.addEventListener("visibilitychange", apply);
  gestureEvents.forEach((name) =>
    window.addEventListener(name, retryInGesture, { capture: true }),
  );
  // Settle the context once; later calls send only changes.
  apply();

  return {
    getDebugState: () => ({
      active,
      audible: audible(),
      recordedAsphalt,
      bodyScrape,
      bodyScrapeHard: scrapeHard,
      ambience: {
        habitatBed: habitatBed.loaded(),
        indoors: indoorAmount,
        stream: streamLevel,
        streamLoaded: stream.loaded(),
        tunnelTone: tunnelTone.loaded(),
      },
      contextState: context.state,
      cues: [...cues],
      impacts: [...impacts],
      landings: [...landings],
      motor,
      muted: !soundEnabled,
      continuousVoices: continuousOpen,
      wheels: wheels.map((wheel) => ({ ...wheel })),
    }),
    // Cues may land just before the context resumes, such as the first
    // count as the loading screen lifts; they play as it starts.
    playCue(cue) {
      if (!soundEnabled || disposed) return;
      if (context.state !== "running") {
        if (cueWaiting) return;
        cueWaiting = true;
      }
      remember(cues, cue);
      playCueSound(context, buses.cue, cue, context.currentTime);
    },
    playImpact(strength, material) {
      if (context.state !== "running") return;
      remember(impacts, { material, strength });
      playImpactSound(
        context,
        buses.impact,
        strength,
        material,
        context.currentTime,
      );
    },
    prepare() {
      if (disposed || prepared) return;
      prepared = true;
      prepareContactVoices();
      prepareImpactSounds(context);
      loadRecordings();
      apply();
    },
    playLanding(strength, surface) {
      if (context.state !== "running") return;
      remember(landings, { strength, surface });
      playLandingSound(
        context,
        buses.landing,
        strength,
        surface,
        context.currentTime,
      );
    },
    // Unchanged values send nothing, so a resume made inside a gesture is
    // not undone by a suspend on the way to the next state.
    setActive(nextActive) {
      if (nextActive === active) return;
      active = nextActive;
      apply();
    },
    setContinuousVoices(open) {
      if (open === continuousOpen) return;
      continuousOpen = open;
      const now = context.currentTime;
      continuousGate.gain.cancelScheduledValues(now);
      // Closing applies at once, even on a suspended context's frozen clock,
      // so nothing plays when it resumes. Opening waits 60 ms, so the voices
      // have moved off their pre-pause sound, then fades in.
      if (open) continuousGate.gain.setTargetAtTime(1, now + 0.06, 0.02);
      else continuousGate.gain.setValueAtTime(0, now);
    },
    setSoundOn(on) {
      if (on === soundEnabled) return;
      soundEnabled = on;
      apply();
    },
    updateMotor(state) {
      motor = state;
      // A suspended context's clock stands still; queuing changes there
      // would only pile up.
      if (context.state !== "running") return;
      motorVoice.update(state, context.currentTime);
    },
    updateAmbience(indoors, streamAt) {
      if (disposed) return;
      indoorAmount = indoors;
      streamLevel = streamAt;
      if (context.state !== "running") return;
      const now = context.currentTime;
      // Out of range, the stream stops playing rather than playing silence,
      // but only once its level has rested at 0 for half a second: a
      // teleport away then fades it out instead of cutting it off.
      if (streamAt > 0) {
        streamQuietSince = null;
        stream.setRunning(true);
      } else {
        streamQuietSince ??= now;
        if (now - streamQuietSince > 0.5) stream.setRunning(false);
      }
      // Equal power: the two beds are unrelated noise, so equal gains would
      // dip about 3 dB halfway through a portal.
      setAmbience(habitatBed.gain, Math.sqrt(1 - indoors), now, 0.05);
      setAmbience(tunnelTone.gain, Math.sqrt(indoors), now, 0.05);
      setAmbience(echoWet.gain, indoors * 0.22, now, 0.05);
      setAmbience(stream.gain, streamAt * STREAM_GAIN, now, 0.08);
    },
    updateBodyScrape(level, hard) {
      bodyScrape = level;
      scrapeHard = hard;
      if (context.state !== "running") return;
      bodyScrapeVoice.update({ hard, level }, context.currentTime);
    },
    updateWheels(nextWheels) {
      wheels = nextWheels;
      if (context.state !== "running") return;
      const voices = prepareContactVoices();
      voices.tires.update(nextWheels, context.currentTime);
      voices.scrub.update(nextWheels, context.currentTime);
    },
    dispose() {
      if (disposed) return;
      disposed = true;
      window.removeEventListener("blur", onBlur);
      window.removeEventListener("focus", onFocus);
      document.removeEventListener("visibilitychange", apply);
      context.removeEventListener("statechange", onStateChange);
      gestureEvents.forEach((name) =>
        window.removeEventListener(name, retryInGesture, { capture: true }),
      );
      motorVoice.dispose();
      bodyScrapeVoice.dispose();
      contactVoices?.tires.dispose();
      contactVoices?.scrub.dispose();
      Object.values(buses).forEach((gain) => gain.disconnect());
      continuousGate.disconnect();
      habitatBed.dispose();
      tunnelTone.dispose();
      stream.dispose();
      for (const node of [
        kartBus,
        echoDelay,
        echoTone,
        echoFeedback,
        echoWet,
      ]) {
        node.disconnect();
      }
      master.disconnect();
      limiter.disconnect();
      runContext(context, false);
    },
  };
}

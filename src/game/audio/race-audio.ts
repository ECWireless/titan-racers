import { createScrubVoice, createTireRollVoice } from "./contact-voices";
import { playCueSound } from "./cue-sounds";
import {
  playImpactSound,
  playLandingSound,
  prepareImpactSounds,
} from "./impact-sounds";
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
 * The context runs only while a race is on screen, unpaused, unmuted, and in
 * a visible, focused page. Otherwise it is suspended, which stops all audio
 * processing.
 */

const SOUND_MUTED_STORAGE_KEY = "titan-racers.sound-muted.v1";

/**
 * Mix levels in dB, set by listening QA in a race. A full-strength hit peaks
 * under 0 dBFS after the limiter, and a firm tap barely touches it.
 */
const MASTER_GAIN = 0.9;
const MIX_DB = {
  cue: -5.5,
  impact: 8,
  landing: 2.4,
  motor: -5.6,
  scrub: -1.8,
  tireRoll: -1.4,
};

let sharedContext: AudioContext | null = null;

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
  return sharedContext;
}

// Suspend and resume settle asynchronously, so `state` can lag a request.
// Always send the wanted one: the context applies them in order, and a
// repeat is a no-op.
function runContext(context: AudioContext, running: boolean) {
  void (running ? context.resume() : context.suspend()).catch(() => undefined);
}

export function readSoundMuted() {
  try {
    return window.localStorage.getItem(SOUND_MUTED_STORAGE_KEY) === "true";
  } catch {
    return false;
  }
}

export function writeSoundMuted(muted: boolean) {
  try {
    window.localStorage.setItem(SOUND_MUTED_STORAGE_KEY, String(muted));
  } catch {
    // Storage can be unavailable (private mode); the choice lasts this page.
  }
}

/**
 * Call from inside a user gesture that leads to a race. Browsers, iPhone
 * Safari in particular, only let audio start from one.
 */
export function unlockRaceAudio(muted = readSoundMuted()) {
  if (muted) return;
  const context = getSharedContext();
  if (context) runContext(context, true);
}

/** For a race that ends before its audio exists, such as a failed load. */
export function suspendRaceAudio() {
  if (sharedContext) runContext(sharedContext, false);
}

export type RaceAudioDebugState = {
  active: boolean;
  contextState: string;
  cues: RaceCue[];
  impacts: Array<{ material: ImpactMaterial; strength: number }>;
  landings: Array<{ strength: number; surface: AudioSurface }>;
  motor: MotorAudioState;
  muted: boolean;
  wheels: readonly AudioWheel[];
};

export type RaceAudio = {
  getDebugState: () => RaceAudioDebugState;
  playCue: (cue: RaceCue) => void;
  playImpact: (strength: number, material: ImpactMaterial) => void;
  playLanding: (strength: number, surface: AudioSurface) => void;
  /**
   * Renders the impact and landing sounds (tens of ms). Call while the race
   * is still covered, so the first hit never stalls a frame.
   */
  prepare: () => void;
  /** On screen, unpaused, and ready. */
  setActive: (active: boolean) => void;
  setMuted: (muted: boolean) => void;
  updateMotor: (state: MotorAudioState) => void;
  updateWheels: (wheels: readonly AudioWheel[]) => void;
  dispose: () => void;
};

/** Event history kept for tests; old entries drop off. */
const DEBUG_HISTORY = 16;
const remember = <T>(list: T[], item: T) => {
  list.push(item);
  if (list.length > DEBUG_HISTORY) list.shift();
};

const fromDb = (decibels: number) => 10 ** (decibels / 20);

export function createRaceAudio(muted: boolean): RaceAudio | null {
  const context = getSharedContext();
  if (!context) return null;

  const master = context.createGain();
  master.gain.value = MASTER_GAIN;
  const limiter = context.createDynamicsCompressor();
  limiter.threshold.value = -6;
  limiter.knee.value = 0;
  limiter.ratio.value = 20;
  limiter.attack.value = 0.001;
  limiter.release.value = 0.12;
  master.connect(limiter).connect(context.destination);

  const bus = (decibels: number) => {
    const gain = context.createGain();
    gain.gain.value = fromDb(decibels);
    gain.connect(master);
    return gain;
  };
  const buses = {
    cue: bus(MIX_DB.cue),
    impact: bus(MIX_DB.impact),
    landing: bus(MIX_DB.landing),
    motor: bus(MIX_DB.motor),
    scrub: bus(MIX_DB.scrub),
    tireRoll: bus(MIX_DB.tireRoll),
  };
  const motorVoice = createMotorVoice(context, buses.motor);
  const tireRollVoice = createTireRollVoice(context, buses.tireRoll);
  const scrubVoice = createScrubVoice(context, buses.scrub);
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
  let motor = SILENT_MOTOR;
  let soundMuted = muted;
  // The page just took the click that started the race. `hasFocus()` can
  // read false in a page that has focus (headless browsers), and a blur
  // while the race loads still arrives as a pause.
  let pageFocused = true;

  const wanted = () =>
    active && !soundMuted && !disposed && pageFocused && !document.hidden;
  const apply = () => runContext(context, wanted());
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
  const gestureEvents = ["pointerdown", "keydown", "touchend"] as const;
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
      contextState: context.state,
      cues: [...cues],
      impacts: [...impacts],
      landings: [...landings],
      motor,
      muted: soundMuted,
      wheels: wheels.map((wheel) => ({ ...wheel })),
    }),
    // Cues may land just before the context resumes, such as the first
    // count as the loading screen lifts; they play as it starts.
    playCue(cue) {
      if (soundMuted || disposed) return;
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
      prepareImpactSounds(context);
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
    setMuted(nextMuted) {
      if (nextMuted === soundMuted) return;
      soundMuted = nextMuted;
      apply();
    },
    updateMotor(state) {
      motor = state;
      // A suspended context's clock stands still; queuing changes there
      // would only pile up.
      if (context.state !== "running") return;
      motorVoice.update(state, context.currentTime);
    },
    updateWheels(nextWheels) {
      wheels = nextWheels;
      if (context.state !== "running") return;
      tireRollVoice.update(nextWheels, context.currentTime);
      scrubVoice.update(nextWheels, context.currentTime);
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
      tireRollVoice.dispose();
      scrubVoice.dispose();
      Object.values(buses).forEach((gain) => gain.disconnect());
      master.disconnect();
      limiter.disconnect();
      runContext(context, false);
    },
  };
}

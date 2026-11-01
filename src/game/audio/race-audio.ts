import { createMotorVoice } from "./motor-voice";
import { SILENT_MOTOR, type MotorAudioState } from "./race-audio-mapping";

/**
 * The browser side of race sound: one shared audio context for the page,
 * started by a user gesture, plus a master bus and limiter per race.
 *
 * The context runs only while a race is on screen, unpaused, unmuted, and in
 * a visible, focused page. Otherwise it is suspended, which stops all audio
 * processing.
 */

const SOUND_MUTED_STORAGE_KEY = "titan-racers.sound-muted.v1";

/** Mix levels from loudness-matched listening, in dB. */
const MASTER_GAIN = 0.9;
const MOTOR_GAIN_DB = -3.6;

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
  motor: MotorAudioState;
  muted: boolean;
};

export type RaceAudio = {
  getDebugState: () => RaceAudioDebugState;
  /** On screen, unpaused, and ready. */
  setActive: (active: boolean) => void;
  setMuted: (muted: boolean) => void;
  updateMotor: (state: MotorAudioState) => void;
  dispose: () => void;
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
  limiter.attack.value = 0.003;
  limiter.release.value = 0.12;
  master.connect(limiter).connect(context.destination);

  const motorBus = context.createGain();
  motorBus.gain.value = fromDb(MOTOR_GAIN_DB);
  motorBus.connect(master);
  const motorVoice = createMotorVoice(context, motorBus);

  let active = false;
  let disposed = false;
  let motor = SILENT_MOTOR;
  let soundMuted = muted;
  // Focus can be lost while the race loads, before these listeners exist.
  let pageFocused = document.hasFocus();

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
      motor,
      muted: soundMuted,
    }),
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
    dispose() {
      if (disposed) return;
      disposed = true;
      window.removeEventListener("blur", onBlur);
      window.removeEventListener("focus", onFocus);
      document.removeEventListener("visibilitychange", apply);
      gestureEvents.forEach((name) =>
        window.removeEventListener(name, retryInGesture, { capture: true }),
      );
      motorVoice.dispose();
      motorBus.disconnect();
      master.disconnect();
      limiter.disconnect();
      runContext(context, false);
    },
  };
}

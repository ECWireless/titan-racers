import { type CueSpec, playTones } from "./cue-sounds";
import { silentPage, uiSoundOutput } from "./race-audio";

/**
 * Menu sounds: short tones from the same service network as the race's
 * timing cues, quieter and shorter, so they sit under a race. Each is one
 * call of `playTones` (6 nodes at most).
 */

export type UiSound =
  | "back"
  | "confirm"
  | "move"
  | "start"
  | "toggle"
  | "unavailable";

const UI_SOUNDS: Record<UiSound, CueSpec> = {
  back: {
    level: 0.5,
    notes: [
      [0, 0.035, 1700],
      [0.05, 0.05, 1250],
    ],
    shape: "flat",
    wave: "pip",
  },
  confirm: {
    level: 0.55,
    notes: [
      [0, 0.035, 1500],
      [0.05, 0.05, 2000],
    ],
    shape: "flat",
    wave: "pip",
  },
  move: { level: 0.3, notes: [[0, 0.022, 2300]], shape: "flat", wave: "pip" },
  start: {
    level: 0.6,
    notes: [
      [0, 0.04, 1250],
      [0.055, 0.04, 1650],
      [0.11, 0.22, 2200, 1650],
    ],
    second: 0.45,
    shape: "bell",
    wave: "pip",
  },
  toggle: { level: 0.45, notes: [[0, 0.03, 1850]], shape: "flat", wave: "pip" },
  unavailable: {
    level: 0.4,
    notes: [[0, 0.11, 440, 466]],
    second: 0.9,
    shape: "flat",
    wave: "buzz",
  },
};

/**
 * Starts sound on the earliest touch, click, or key, so the sound it leads
 * to is not late waiting for the audio to start.
 */
export function wakeUiSound() {
  if (!silentPage()) uiSoundOutput();
}

/** Plays a menu sound, unless Sound effects is off or the page is silent. */
export function playUiSound(sound: UiSound) {
  if (silentPage()) return;
  const audio = uiSoundOutput();
  if (!audio) return;
  if (process.env.NODE_ENV !== "production") {
    const log = ((window as { __titanUiSounds?: UiSound[] }).__titanUiSounds ??=
      []);
    log.push(sound);
  }
  playTones(audio.context, audio.output, UI_SOUNDS[sound], audio.context.currentTime);
}

/** Which sound activating an element makes, from its role or `data-ui-sound`. */
export function uiSoundFor(element: Element): UiSound | null {
  const named = element.closest<HTMLElement>("[data-ui-sound]")?.dataset.uiSound;
  if (named === "off") return null;
  if (element.getAttribute("aria-disabled") === "true") return "unavailable";
  if (named && Object.hasOwn(UI_SOUNDS, named)) return named as UiSound;
  if (element.getAttribute("role") === "switch") return "toggle";
  return "confirm";
}

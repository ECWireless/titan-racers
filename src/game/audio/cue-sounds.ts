import {
  applyEnvelope,
  cachedWave,
  filterNode,
  gainNode,
  type EnvelopeHit,
} from "./audio-synthesis";
import type { RaceCue } from "./race-audio-mapping";

/**
 * Timing tones from the habitat's service network: a piezo-like but clean
 * timbre (a fundamental with modest odd harmonics) between 500 Hz and 4 kHz,
 * so they stay legible on phone speakers. Each note is
 * [start, length, frequency, second voice frequency?].
 */

type Note = readonly [number, number, number, number?];
export type CueSpec = {
  level?: number;
  notes: readonly Note[];
  second?: number;
  shape: "flat" | "bell";
  wave: "pip" | "buzz";
};

const TICK: CueSpec = { notes: [[0, 0.07, 1000]], shape: "flat", wave: "pip" };
const CUES: Record<RaceCue, CueSpec> = {
  "count-1": TICK,
  "count-2": TICK,
  "count-3": TICK,
  finish: {
    notes: [
      [0, 0.2, 1600, 2400],
      [0.24, 0.2, 1600, 2400],
      [0.48, 0.95, 1200, 1800],
    ],
    second: 0.45,
    shape: "bell",
    wave: "pip",
  },
  "final-lap": {
    notes: [
      [0, 0.065, 1250],
      [0.095, 0.065, 1670],
      [0.27, 0.065, 1250],
      [0.365, 0.065, 1670],
    ],
    shape: "flat",
    wave: "pip",
  },
  go: {
    notes: [[0, 0.42, 2000, 1500]],
    second: 0.7,
    shape: "flat",
    wave: "pip",
  },
  "lap-rejected": {
    level: 0.6,
    notes: [
      [0, 0.15, 560, 593],
      [0.21, 0.27, 500, 530],
    ],
    second: 0.9,
    shape: "flat",
    wave: "buzz",
  },
};
const CUE_WAVES = {
  buzz: { 1: 1, 2: 0.08, 3: 0.55, 4: 0.05, 5: 0.38, 7: 0.25, 9: 0.15 },
  pip: { 1: 1, 2: 0.16, 3: 0.28, 4: 0.06, 5: 0.1 },
};

/** At most 6 nodes per cue, all stopped within 2 s. */
export function playCueSound(
  context: BaseAudioContext,
  output: AudioNode,
  cue: RaceCue,
  time: number,
) {
  playTones(context, output, CUES[cue], time);
}

/** Plays a cue's notes in the service network's timbre (6 nodes at most). */
export function playTones(
  context: BaseAudioContext,
  output: AudioNode,
  spec: CueSpec,
  time: number,
) {
  const last = spec.notes[spec.notes.length - 1];
  const release = spec.shape === "bell" ? 0 : 0.04;
  const duration = Math.min(1.9, last[0] + last[1] + release + 0.02);
  const peak = 0.5 * (spec.level ?? 1);

  const gain = gainNode(context);
  applyEnvelope(
    gain.gain,
    time,
    duration,
    spec.notes.map(([at, length]): EnvelopeHit =>
      spec.shape === "bell"
        ? { at, attack: 0.003, peak, tau: length / 3.2 }
        : {
            at,
            attack: 0.004,
            hold: length - 0.004,
            peak,
            tau: release / 4,
          },
    ),
  );

  // Keeps the energy in the phone band.
  const tone = filterNode(context, "bandpass", 1600, 0.35);
  tone.connect(gain).connect(output);
  const voiceCount = spec.notes.some((note) => note[3]) ? 2 : 1;
  for (let index = 0; index < voiceCount; index += 1) {
    const oscillator = context.createOscillator();
    oscillator.setPeriodicWave(
      cachedWave(context, `cue-${spec.wave}`, CUE_WAVES[spec.wave]),
    );
    for (const note of spec.notes) {
      oscillator.frequency.setValueAtTime(
        (index === 1 ? note[3] : undefined) ?? note[2],
        time + note[0],
      );
    }
    if (index === 0) oscillator.connect(tone);
    else oscillator.connect(gainNode(context, spec.second)).connect(tone);
    oscillator.start(time);
    oscillator.stop(time + duration);
  }
}

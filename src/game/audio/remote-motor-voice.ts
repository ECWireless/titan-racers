import {
  cachedWave,
  chain,
  clamp,
  continuousVoice,
  createParameterSmoother,
  filterNode,
  gainNode,
} from "./audio-synthesis";

/**
 * An opponent's motor, heard from the camera: the player's own motor voice
 * (motor-voice.ts) cut to its whine and the second-stage gear mesh, through
 * the same high shelf, in 8 nodes rather than 16, then placed. Its pitch
 * follows the opponent's drawn speed over its own kart's no-load speed, its
 * load how hard it is speeding up. It is staged as the player's motor is,
 * which the camera hears from about 2 m behind: the same level at that
 * distance, falling off by the inverse-distance law beyond, a little air
 * absorption, a side, and Doppler at the real speed of sound (a few
 * percent at RC speeds).
 */

type Vector = { x: number; y: number; z: number };

export type RemoteListener = {
  position: Vector;
  /** The camera's right, a unit vector. */
  right: Vector;
  velocity: Vector;
};

export type RemoteVoiceMix = {
  gain: number;
  /** -1 left to 1 right. */
  pan: number;
  cutoffHz: number;
  /** Heard frequency over emitted. */
  doppler: number;
};

export type RemoteMotorState = {
  /** 0–1.1: drawn speed over its kart's no-load speed. */
  motorSpeed: number;
  /** 0–1: how hard it is speeding up. */
  load: number;
  mix: RemoteVoiceMix;
};

const SPEED_OF_SOUND = 343;
/**
 * Full level this close, about where the chase camera trails its own
 * kart; the inverse-distance law beyond.
 */
const REFERENCE_METRES = 2;
/** Faded out between these, so far opponents cost nothing heard. */
const FADE_FROM_METRES = 60;
const SILENT_METRES = 80;
/** Never wholly to one side: both ears hear a nearby kart. */
const MAX_PAN = 0.85;
/** About this hard a launch is full load. */
const FULL_LOAD_ACCELERATION = 6;

export const SILENT_REMOTE_MIX: RemoteVoiceMix = Object.freeze({
  gain: 0,
  pan: 0,
  cutoffHz: 16_000,
  doppler: 1,
});
export const SILENT_REMOTE_MOTOR: RemoteMotorState = Object.freeze({
  motorSpeed: 0,
  load: 0,
  mix: SILENT_REMOTE_MIX,
});

/** How a source at `position`, moving at `velocity`, reaches the listener. */
export function remoteVoiceMix(
  listener: RemoteListener,
  position: Vector,
  velocity: Vector,
): RemoteVoiceMix {
  const dx = position.x - listener.position.x;
  const dy = position.y - listener.position.y;
  const dz = position.z - listener.position.z;
  const distance = Math.hypot(dx, dy, dz);
  if (!Number.isFinite(distance) || distance >= SILENT_METRES) {
    return SILENT_REMOTE_MIX;
  }
  // Toward the source, from the listener.
  const scale = distance > 1e-3 ? 1 / distance : 0;
  const ux = dx * scale;
  const uy = dy * scale;
  const uz = dz * scale;
  const { right, velocity: heard } = listener;
  const fade = clamp(
    (SILENT_METRES - distance) / (SILENT_METRES - FADE_FROM_METRES),
  );
  return {
    gain: (REFERENCE_METRES / Math.max(REFERENCE_METRES, distance)) * fade,
    pan: clamp(right.x * ux + right.y * uy + right.z * uz, -1, 1) * MAX_PAN,
    // Air takes only a little off the top over a course's distances.
    cutoffHz: 16_000 / (1 + distance / 40),
    doppler: clamp(
      (SPEED_OF_SOUND + heard.x * ux + heard.y * uy + heard.z * uz) /
        (SPEED_OF_SOUND + velocity.x * ux + velocity.y * uy + velocity.z * uz),
      0.85,
      1.18,
    ),
  };
}

/** What an opponent's motor is doing, from its drawn motion. */
export function remoteMotorState(
  speed: number,
  acceleration: number,
  noLoadSpeed: number,
  mix: RemoteVoiceMix,
): RemoteMotorState {
  return {
    motorSpeed: clamp(speed / Math.max(1, noLoadSpeed), 0, 1.1),
    load: clamp(acceleration / FULL_LOAD_ACCELERATION),
    mix,
  };
}

export function createRemoteMotorVoice(
  context: BaseAudioContext,
  output: AudioNode,
) {
  const electrical = context.createOscillator();
  electrical.setPeriodicWave(
    cachedWave(context, "remoteMotorElectrical", {
      1: 1,
      2: 0.45,
      3: 0.16,
      6: 0.35,
    }),
  );
  electrical.frequency.value = 5;
  const gear = context.createOscillator();
  gear.setPeriodicWave(
    cachedWave(context, "remoteMotorGear", { 20: 0.12, 21: 0.5, 22: 0.12 }),
  );
  gear.frequency.value = 1.25;
  const electricalGain = gainNode(context);
  const gearGain = gainNode(context);
  // The player's motor darkens its top end the same way.
  const shelf = filterNode(context, "highshelf", 1_500);
  shelf.gain.value = -9;
  const air = filterNode(context, "lowpass", 16_000, 0.7);
  const panner = context.createStereoPanner();
  const level = gainNode(context);
  chain(electrical, electricalGain, shelf);
  chain(gear, gearGain, shelf);
  chain(shelf, air, panner, level);
  level.connect(output);
  electrical.start();
  gear.start();

  const set = createParameterSmoother();
  return continuousVoice<RemoteMotorState>(
    [electrical, gear, electricalGain, gearGain, shelf, air, panner, level],
    [electrical, gear],
    ({ motorSpeed, load, mix }, time) => {
      const speed = clamp(motorSpeed, 0, 1.1);
      const rpm = speed ** 0.7;
      const spin = clamp(speed / 0.03);
      // The same rotor rate as the player's motor, shifted as heard.
      const rotorHz = 370 * Math.max(speed, 0.01) * mix.doppler;
      set(electrical.frequency, rotorHz, time, 0.03);
      set(gear.frequency, rotorHz / 4, time, 0.03);
      set(
        electricalGain.gain,
        spin * rpm * (0.12 + 0.45 * load),
        time,
        0.05,
      );
      set(gearGain.gain, spin * rpm * (0.28 + 0.2 * load), time, 0.05);
      set(shelf.gain, -9 + 4 * load, time, 0.05);
      set(air.frequency, mix.cutoffHz, time, 0.05);
      set(panner.pan, mix.pan, time, 0.05);
      set(level.gain, mix.gain, time, 0.05);
    },
  );
}

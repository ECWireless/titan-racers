import type { RaceQuaternion, RaceVector3 } from "../race/race-gate";

/**
 * A ghost is a recording of one race's path: the kart's pose at a fixed
 * cadence of race time, plus exact samples on both sides of every gate
 * crossing and after every reset. It is replayed as-is, never re-simulated,
 * and the same bytes are the evidence a server can re-check a run against.
 *
 * Binary layout (little-endian), version 1, recorded at 120 Hz fixed steps
 * with a regular sample every `GHOST_STEPS_PER_SAMPLE` steps:
 *
 * - Header, 8 bytes: "TRG", version (u8), sample count (u32).
 * - Sample, 24 bytes each: race time in microseconds (u32); kart root
 *   (centre of mass) position in millimetres (3 × i32); assembly rotation as
 *   its three smallest quaternion components (3 × i16); flags (u8: bits 0–1
 *   the omitted component, bit 2 reset, bit 3 gate); front steer angle
 *   (i8, ±45° full scale).
 */

const GHOST_TRACE_VERSION = 1;
/** Six 120 Hz steps: 20 regular samples per race second. */
export const GHOST_STEPS_PER_SAMPLE = 6;
/** Half an hour at 20 Hz, with room for gate and reset samples. */
export const MAX_GHOST_SAMPLES = 40_000;

const MAGIC = [0x54, 0x52, 0x47] as const; // "TRG"
const HEADER_BYTES = 8;
const SAMPLE_BYTES = 24;
const MAX_GHOST_BYTES = HEADER_BYTES + MAX_GHOST_SAMPLES * SAMPLE_BYTES;
const QUATERNION_SCALE = 32_767 * Math.SQRT2;
// Rounding each stored component moves it by at most half a step.
const QUATERNION_TOLERANCE = 4 / QUATERNION_SCALE;
const STEER_RANGE_DEGREES = 45;
const FLAG_RESET = 0b0100;
const FLAG_GATE = 0b1000;
const MAX_RACE_MICROSECONDS = 0xffff_ffff;
const MAX_POSITION_METRES = 2_000_000;

export type GhostSample = {
  /** Competitive race time, the race session's own clock. */
  timeMicroseconds: number;
  /** The kart root, the point race gates test. */
  position: RaceVector3;
  /** The kart's assembly (visual) rotation. */
  rotation: RaceQuaternion;
  /** Front wheel steer angle in degrees. */
  steerDegrees: number;
  /** The first sample after a reset teleport; playback must not blend into it. */
  reset: boolean;
  /** Recorded on the step that crossed a race gate. */
  gate: boolean;
};

export class GhostTraceFormatError extends Error {}

function fail(message: string): never {
  throw new GhostTraceFormatError(message);
}

export function encodeGhostTrace(samples: readonly GhostSample[]): Uint8Array {
  if (samples.length === 0 || samples.length > MAX_GHOST_SAMPLES) {
    fail("A ghost needs between one and the maximum number of samples.");
  }
  const bytes = new Uint8Array(HEADER_BYTES + samples.length * SAMPLE_BYTES);
  const view = new DataView(bytes.buffer);
  bytes.set(MAGIC, 0);
  view.setUint8(3, GHOST_TRACE_VERSION);
  view.setUint32(4, samples.length, true);

  let previousTime = 0;
  samples.forEach((sample, index) => {
    const offset = HEADER_BYTES + index * SAMPLE_BYTES;
    const time = Math.round(sample.timeMicroseconds);
    if (!(time >= previousTime && time <= MAX_RACE_MICROSECONDS)) {
      fail("Ghost sample times must be ordered and in range.");
    }
    previousTime = time;
    view.setUint32(offset, time, true);
    const { x, y, z } = sample.position;
    [x, y, z].forEach((value, axis) => {
      if (!(Math.abs(value) <= MAX_POSITION_METRES)) {
        fail("Ghost positions must be finite and in range.");
      }
      view.setInt32(offset + 4 + axis * 4, Math.round(value * 1_000), true);
    });

    const { largest, components } = smallestThree(sample.rotation);
    components.forEach((component, slot) => {
      view.setInt16(
        offset + 16 + slot * 2,
        Math.round(component * QUATERNION_SCALE),
        true,
      );
    });
    view.setUint8(
      offset + 22,
      largest | (sample.reset ? FLAG_RESET : 0) | (sample.gate ? FLAG_GATE : 0),
    );
    const steer = Number.isFinite(sample.steerDegrees) ? sample.steerDegrees : 0;
    view.setInt8(
      offset + 23,
      Math.round(Math.max(-1, Math.min(1, steer / STEER_RANGE_DEGREES)) * 127),
    );
  });
  return bytes;
}

/** Strictly parses untrusted bytes; throws `GhostTraceFormatError`. */
export function decodeGhostTrace(bytes: Uint8Array): GhostSample[] {
  if (bytes.byteLength < HEADER_BYTES) fail("The ghost is truncated.");
  if (MAGIC.some((value, index) => bytes[index] !== value)) {
    fail("This is not a ghost.");
  }
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  if (view.getUint8(3) !== GHOST_TRACE_VERSION) {
    fail("The ghost's version is not supported.");
  }
  const count = view.getUint32(4, true);
  if (count < 1 || count > MAX_GHOST_SAMPLES) {
    fail("The ghost's sample count is out of range.");
  }
  if (bytes.byteLength !== HEADER_BYTES + count * SAMPLE_BYTES) {
    fail("The ghost's length does not match its samples.");
  }

  const samples: GhostSample[] = [];
  let previousTime = 0;
  for (let index = 0; index < count; index += 1) {
    const offset = HEADER_BYTES + index * SAMPLE_BYTES;
    const timeMicroseconds = view.getUint32(offset, true);
    if (timeMicroseconds < previousTime) {
      fail("The ghost's sample times go backwards.");
    }
    previousTime = timeMicroseconds;
    const flags = view.getUint8(offset + 22);
    if (flags & ~(0b11 | FLAG_RESET | FLAG_GATE)) {
      fail("The ghost has unknown sample flags.");
    }
    const components = [0, 1, 2].map(
      (slot) => view.getInt16(offset + 16 + slot * 2, true) / QUATERNION_SCALE,
    );
    const squares = components.reduce((sum, value) => sum + value * value, 0);
    const omitted = Math.sqrt(Math.max(0, 1 - squares));
    // A valid encoding leaves out the largest component of a unit
    // quaternion, so the rest fit inside it and it is at least as large.
    if (
      squares > 1 + QUATERNION_TOLERANCE ||
      components.some(
        (value) => Math.abs(value) > omitted + QUATERNION_TOLERANCE,
      )
    ) {
      fail("The ghost has an invalid rotation.");
    }
    samples.push({
      gate: (flags & FLAG_GATE) !== 0,
      position: {
        x: view.getInt32(offset + 4, true) / 1_000,
        y: view.getInt32(offset + 8, true) / 1_000,
        z: view.getInt32(offset + 12, true) / 1_000,
      },
      reset: (flags & FLAG_RESET) !== 0,
      rotation: fromSmallestThree(flags & 0b11, components, omitted),
      steerDegrees: (view.getInt8(offset + 23) / 127) * STEER_RANGE_DEGREES,
      timeMicroseconds,
    });
  }
  return samples;
}

function smallestThree(rotation: RaceQuaternion) {
  const length = Math.hypot(rotation.x, rotation.y, rotation.z, rotation.w);
  if (!Number.isFinite(length) || length === 0) {
    fail("Ghost rotations must be finite.");
  }
  const values = [rotation.x, rotation.y, rotation.z, rotation.w].map(
    (value) => value / length,
  );
  let largest = 0;
  for (let index = 1; index < 4; index += 1) {
    if (Math.abs(values[index]) > Math.abs(values[largest])) largest = index;
  }
  // q and -q are the same rotation; keep the omitted component positive.
  const sign = values[largest] < 0 ? -1 : 1;
  return {
    components: values
      .filter((_, index) => index !== largest)
      .map((value) => value * sign),
    largest,
  };
}

function fromSmallestThree(
  largest: number,
  components: number[],
  omitted: number,
): RaceQuaternion {
  const values = [...components];
  values.splice(largest, 0, omitted);
  return { w: values[3], x: values[0], y: values[1], z: values[2] };
}

/** Base64 for JSON and browser storage; works in browsers and Node. */
export function ghostTraceToBase64(bytes: Uint8Array) {
  let binary = "";
  for (let index = 0; index < bytes.length; index += 0x8000) {
    binary += String.fromCharCode(...bytes.subarray(index, index + 0x8000));
  }
  return btoa(binary);
}

export function ghostTraceFromBase64(text: string) {
  if (text.length > 4 * Math.ceil(MAX_GHOST_BYTES / 3)) {
    fail("The ghost is too large.");
  }
  let binary: string;
  try {
    binary = atob(text);
  } catch {
    fail("The ghost is not valid base64.");
  }
  return Uint8Array.from(binary, (character) => character.charCodeAt(0));
}

/**
 * Collects a race's samples, one call per fixed step while race time runs.
 * A regular sample lands every `stepsPerSample` steps. A gate crossing is
 * sampled on its own step and the step before it, so the crossing segment
 * can be re-checked exactly; the first step after a reset is sampled too.
 */
export class GhostRecorder {
  private samples: GhostSample[] = [];
  private step = 0;
  private resetPending = false;
  private overflowed = false;
  // The previous step, kept without allocating in case a gate follows it.
  private previousRecorded = false;
  private previousTime = 0;
  private readonly previousPosition = { x: 0, y: 0, z: 0 };
  private readonly previousRotation = { w: 1, x: 0, y: 0, z: 0 };
  private previousSteer = 0;

  constructor(private readonly stepsPerSample = GHOST_STEPS_PER_SAMPLE) {}

  reset() {
    this.samples = [];
    this.step = 0;
    this.resetPending = false;
    this.overflowed = false;
    this.previousRecorded = false;
  }

  /** The kart was teleported; the next sample starts a new segment. */
  markReset() {
    this.resetPending = true;
  }

  recordStep(
    timeMicroseconds: number,
    position: Readonly<RaceVector3>,
    rotation: Readonly<RaceQuaternion>,
    steerDegrees: number,
    crossedGate: boolean,
  ) {
    const regular = this.step % this.stepsPerSample === 0;
    this.step += 1;
    const due = crossedGate || this.resetPending || regular;
    if (due && !this.overflowed) {
      if (crossedGate && !this.previousRecorded && this.step > 1) {
        this.push(
          this.previousTime,
          this.previousPosition,
          this.previousRotation,
          this.previousSteer,
          false,
          false,
        );
      }
      this.push(
        timeMicroseconds,
        position,
        rotation,
        steerDegrees,
        crossedGate,
        this.resetPending,
      );
      this.resetPending = false;
    }
    this.previousRecorded = due;
    this.previousTime = timeMicroseconds;
    this.previousPosition.x = position.x;
    this.previousPosition.y = position.y;
    this.previousPosition.z = position.z;
    this.previousRotation.w = rotation.w;
    this.previousRotation.x = rotation.x;
    this.previousRotation.y = rotation.y;
    this.previousRotation.z = rotation.z;
    this.previousSteer = steerDegrees;
  }

  /** The recorded race, or null if nothing was recorded or it ran too long. */
  finish(): GhostSample[] | null {
    if (this.overflowed || this.samples.length === 0) return null;
    return this.samples;
  }

  private push(
    timeMicroseconds: number,
    position: Readonly<RaceVector3>,
    rotation: Readonly<RaceQuaternion>,
    steerDegrees: number,
    gate: boolean,
    reset: boolean,
  ) {
    if (this.samples.length >= MAX_GHOST_SAMPLES) {
      this.overflowed = true;
      return;
    }
    this.samples.push({
      gate,
      position: { x: position.x, y: position.y, z: position.z },
      reset,
      rotation: { w: rotation.w, x: rotation.x, y: rotation.y, z: rotation.z },
      steerDegrees,
      timeMicroseconds,
    });
  }
}

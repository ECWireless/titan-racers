import type { RaceQuaternion, RaceVector3 } from "../race/race-gate";
import type { GhostSample } from "./ghost-trace";

export type GhostPose = {
  position: RaceVector3;
  rotation: RaceQuaternion;
  steerDegrees: number;
  /** Ground speed between the bracketing samples, in metres per second. */
  speed: number;
};

/**
 * Reads a ghost's pose at a race time. Positions follow a cubic through the
 * neighbouring samples, timed by race time so uneven gate samples stay
 * smooth; rotations blend along the shorter arc. A reset sample is never
 * blended into: the ghost holds its last pose until the reset, then jumps.
 * Before the first sample the ghost waits there; after the last it is gone.
 */
export class GhostPlayback {
  private index = 0;
  readonly finishMicroseconds: number;

  constructor(private readonly samples: readonly GhostSample[]) {
    if (samples.length === 0) throw new Error("A ghost needs samples.");
    this.finishMicroseconds = samples[samples.length - 1].timeMicroseconds;
  }

  /** Writes the pose into `out` and returns it, or null once finished. */
  sample(timeMicroseconds: number, out: GhostPose): GhostPose | null {
    const { samples } = this;
    if (timeMicroseconds > this.finishMicroseconds) return null;
    if (timeMicroseconds <= samples[0].timeMicroseconds) {
      return writeSample(samples[0], 0, out);
    }
    // Race time only moves forward within a race; a restart rewinds.
    if (samples[this.index].timeMicroseconds > timeMicroseconds) this.index = 0;
    while (
      this.index < samples.length - 2 &&
      samples[this.index + 1].timeMicroseconds <= timeMicroseconds
    ) {
      this.index += 1;
    }

    const from = samples[this.index];
    const to = samples[this.index + 1];
    const span = to.timeMicroseconds - from.timeMicroseconds;
    if (to.reset || span <= 0) return writeSample(from, 0, out);
    const t = Math.min(1, (timeMicroseconds - from.timeMicroseconds) / span);

    const before = this.index > 0 && !from.reset ? samples[this.index - 1] : from;
    const after =
      this.index + 2 < samples.length && !samples[this.index + 2].reset
        ? samples[this.index + 2]
        : to;
    out.position.x = interpolate(before, from, to, after, "x", span, t);
    out.position.y = interpolate(before, from, to, after, "y", span, t);
    out.position.z = interpolate(before, from, to, after, "z", span, t);
    blendRotation(from.rotation, to.rotation, t, out.rotation);
    out.steerDegrees =
      from.steerDegrees + (to.steerDegrees - from.steerDegrees) * t;
    out.speed =
      Math.hypot(
        to.position.x - from.position.x,
        to.position.y - from.position.y,
        to.position.z - from.position.z,
      ) /
      (span / 1_000_000);
    return out;
  }
}

export function createGhostPose(): GhostPose {
  return {
    position: { x: 0, y: 0, z: 0 },
    rotation: { w: 1, x: 0, y: 0, z: 0 },
    speed: 0,
    steerDegrees: 0,
  };
}

function writeSample(sample: GhostSample, speed: number, out: GhostPose) {
  out.position.x = sample.position.x;
  out.position.y = sample.position.y;
  out.position.z = sample.position.z;
  out.rotation.w = sample.rotation.w;
  out.rotation.x = sample.rotation.x;
  out.rotation.y = sample.rotation.y;
  out.rotation.z = sample.rotation.z;
  out.steerDegrees = sample.steerDegrees;
  out.speed = speed;
  return out;
}

/** Velocity per microsecond across two samples. */
function tangent(a: GhostSample, b: GhostSample, axis: "x" | "y" | "z") {
  const span = b.timeMicroseconds - a.timeMicroseconds;
  return span > 0 ? (b.position[axis] - a.position[axis]) / span : 0;
}

function interpolate(
  before: GhostSample,
  from: GhostSample,
  to: GhostSample,
  after: GhostSample,
  axis: "x" | "y" | "z",
  span: number,
  t: number,
) {
  return hermite(
    from.position[axis],
    to.position[axis],
    tangent(before, to, axis) * span,
    tangent(from, after, axis) * span,
    t,
  );
}

function hermite(p0: number, p1: number, m0: number, m1: number, t: number) {
  const t2 = t * t;
  const t3 = t2 * t;
  return (
    (2 * t3 - 3 * t2 + 1) * p0 +
    (t3 - 2 * t2 + t) * m0 +
    (-2 * t3 + 3 * t2) * p1 +
    (t3 - t2) * m1
  );
}

/** Normalized blend along the shorter arc; samples are 50 ms apart at most. */
function blendRotation(
  a: RaceQuaternion,
  b: RaceQuaternion,
  t: number,
  out: RaceQuaternion,
) {
  const sign = a.w * b.w + a.x * b.x + a.y * b.y + a.z * b.z < 0 ? -1 : 1;
  const w = a.w + (sign * b.w - a.w) * t;
  const x = a.x + (sign * b.x - a.x) * t;
  const y = a.y + (sign * b.y - a.y) * t;
  const z = a.z + (sign * b.z - a.z) * t;
  const length = Math.hypot(w, x, y, z) || 1;
  out.w = w / length;
  out.x = x / length;
  out.y = y / length;
  out.z = z / length;
}

import type { GhostSample } from "../ghost/ghost-trace";
import { DEFAULT_FIXED_STEP_SECONDS } from "../runtime/fixed-step-clock";
import { crossesDirectedRaceGate, type RaceVector3 } from "./race-gate";
import type { RaceSessionConfig } from "./race-session";

/** Each sample is its own fixed step, so samples are at least one apart. */
const STEP_MICROSECONDS = Math.floor(DEFAULT_FIXED_STEP_SECONDS * 1_000_000);

const RACE_CHECK_LIMITS = {
  /** Above any kart's drive (at most 23 m/s) plus a fall across a course. */
  maxSpeedMetresPerSecond: 30,
  /** Two rounded millimetre positions, with room to spare. */
  sampleToleranceMetres: 0.005,
  /** How far recorded millimetres can move a crossing. */
  gateToleranceMetres: 0.01,
  /**
   * A reset lands on ground found up to 2 m above or below its point, lifted
   * by the kart's ride height, with the centre of mass a little off-centre.
   */
  resetHorizontalMetres: 0.3,
  resetVerticalMetres: 2.5,
  maxRaceMicroseconds: 15 * 60 * 1_000_000,
} as const;

/**
 * The most samples a race within the time cap can record: 20 a second, one
 * more per reset (at most one per half-second recovery), and gate pairs.
 */
export const MAX_RUN_SAMPLES = 20_000;

export const RACE_CHECK_REJECTIONS = [
  "off-start",
  "too-fast",
  "bad-reset",
  "wrong-gate",
  "after-finish",
  "unfinished",
  "too-long",
] as const;
export type RaceCheckRejection = (typeof RACE_CHECK_REJECTIONS)[number];

/**
 * Why a submitted run did not count: the check's reasons, a recording that
 * does not decode, or a finish sooner after its ticket than the race took.
 */
export const RUN_REJECTIONS = [
  ...RACE_CHECK_REJECTIONS,
  "bad-recording",
  "too-early",
] as const;
export type RunRejection = (typeof RUN_REJECTIONS)[number];

export type RaceCheckResult =
  | { verified: true; timeMicroseconds: number }
  | { verified: false; reason: RaceCheckRejection };

function nearResetPoint(position: RaceVector3, point: RaceVector3) {
  return (
    Math.hypot(position.x - point.x, position.z - point.z) <=
      RACE_CHECK_LIMITS.resetHorizontalMetres &&
    Math.abs(position.y - point.y) <= RACE_CHECK_LIMITS.resetVerticalMetres
  );
}

function distance(left: RaceVector3, right: RaceVector3) {
  return Math.hypot(left.x - right.x, left.y - right.y, left.z - right.z);
}

/**
 * Checks a finished race's recording against its course, as the server does
 * before a run counts, mirroring `RaceSession`'s progression. Only
 * gate-flagged samples may cross, each must cross the expected gate, and the
 * speed between samples is capped. A reset may land only on the race's newest
 * reset point (the last checkpoint passed this lap, else the start), as the
 * race picks when that point has ground, so a reset never moves a kart
 * forwards. The time is the finishing crossing's. A forged recording that
 * obeys these rules still passes.
 */
export function verifyRaceRecording(
  config: RaceSessionConfig,
  samples: readonly GhostSample[],
): RaceCheckResult {
  const reject = (reason: RaceCheckRejection): RaceCheckResult => ({
    reason,
    verified: false,
  });
  const gateOptions = {
    boundsTolerance: RACE_CHECK_LIMITS.gateToleranceMetres,
    planeTolerance: RACE_CHECK_LIMITS.gateToleranceMetres,
  };
  if (samples.length > MAX_RUN_SAMPLES) return reject("too-long");
  const first = samples[0];
  if (
    !first ||
    !nearResetPoint(first.position, config.startRecovery.position)
  ) {
    return reject("off-start");
  }

  let lap = 1;
  let checkpointIndex = 0;
  let resetPoint = config.startRecovery.position;
  let finishMicroseconds: number | null = null;

  for (let index = 1; index < samples.length; index += 1) {
    if (finishMicroseconds !== null) return reject("after-finish");
    const previous = samples[index - 1];
    const sample = samples[index];
    const gapMicroseconds = sample.timeMicroseconds - previous.timeMicroseconds;
    if (gapMicroseconds < STEP_MICROSECONDS) return reject("too-fast");

    // Recovery holds the kart off the gates, so a reset never crosses one.
    if (sample.reset) {
      if (sample.gate || !nearResetPoint(sample.position, resetPoint)) {
        return reject("bad-reset");
      }
      continue;
    }

    if (
      distance(previous.position, sample.position) >
      (RACE_CHECK_LIMITS.maxSpeedMetresPerSecond * gapMicroseconds) /
        1_000_000 +
        RACE_CHECK_LIMITS.sampleToleranceMetres
    ) {
      return reject("too-fast");
    }
    if (!sample.gate) continue;

    const checkpoint = config.checkpoints[checkpointIndex];
    if (
      !crossesDirectedRaceGate(
        checkpoint?.gate ?? config.startGate,
        previous.position,
        sample.position,
        gateOptions,
      )
    ) {
      return reject("wrong-gate");
    }
    if (checkpoint) {
      checkpointIndex += 1;
      resetPoint = checkpoint.recovery.position;
      continue;
    }
    resetPoint = config.startRecovery.position;
    if (lap === config.lapCount) {
      finishMicroseconds = sample.timeMicroseconds;
    } else {
      lap += 1;
      checkpointIndex = 0;
    }
  }

  if (finishMicroseconds === null) return reject("unfinished");
  if (finishMicroseconds > RACE_CHECK_LIMITS.maxRaceMicroseconds) {
    return reject("too-long");
  }
  return { timeMicroseconds: finishMicroseconds, verified: true };
}

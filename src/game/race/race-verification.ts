import type { GhostSample } from "../ghost/ghost-trace";
import { DEFAULT_FIXED_STEP_SECONDS } from "../runtime/fixed-step-clock";
import {
  crossesDirectedRaceGate,
  type RaceGateGeometry,
  type RaceVector3,
} from "./race-gate";

/** Each sample is its own fixed step, so samples are at least one apart. */
export const STEP_MICROSECONDS = Math.floor(DEFAULT_FIXED_STEP_SECONDS * 1_000_000);

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

const RACE_CHECK_REJECTIONS = [
  "off-start",
  "too-fast",
  "bad-reset",
  "wrong-gate",
  "after-finish",
  "unfinished",
  "too-long",
] as const;
type RaceCheckRejection = (typeof RACE_CHECK_REJECTIONS)[number];

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

type RaceCheckResult =
  | { verified: true; timeMicroseconds: number }
  | { verified: false; reason: RaceCheckRejection };

/**
 * What the run check needs of a course: its gates in order, each
 * checkpoint's reset point, the start's, and the lap count. A race
 * session's config is one.
 */
export type RaceCheckCourse = {
  checkpoints: ReadonlyArray<{
    gate: RaceGateGeometry;
    recovery: { position: RaceVector3 };
  }>;
  lapCount: number;
  startGate: RaceGateGeometry;
  startRecovery: { position: RaceVector3 };
};

/** One checked moment of a race: a recorded sample, or a room state. */
export type RaceCheckSample = Pick<
  GhostSample,
  "gate" | "position" | "reset" | "timeMicroseconds"
>;

/** Gates a race passes, finish included, over every lap. */
export function raceGateCount(course: RaceCheckCourse) {
  return course.lapCount * (course.checkpoints.length + 1);
}

/**
 * Where a reset may land after `gates` crossings: the last checkpoint
 * passed this lap, else the start.
 */
function resetPointAfter(course: RaceCheckCourse, gates: number) {
  const index = gates % (course.checkpoints.length + 1);
  return index === 0
    ? course.startRecovery.position
    : course.checkpoints[index - 1].recovery.position;
}

function nextGateAfter(course: RaceCheckCourse, gates: number) {
  const index = gates % (course.checkpoints.length + 1);
  return course.checkpoints[index]?.gate ?? course.startGate;
}

/**
 * Whether a position is within a reset's landing of a point, or within
 * what the speed cap covers in `microseconds` of that landing.
 */
export function nearRaceResetPoint(
  position: RaceVector3,
  point: RaceVector3,
  microseconds = 0,
) {
  const outside = Math.hypot(
    Math.max(
      0,
      Math.hypot(position.x - point.x, position.z - point.z) -
        RACE_CHECK_LIMITS.resetHorizontalMetres,
    ),
    Math.max(
      0,
      Math.abs(position.y - point.y) - RACE_CHECK_LIMITS.resetVerticalMetres,
    ),
  );
  return (
    outside <=
    (RACE_CHECK_LIMITS.maxSpeedMetresPerSecond * Math.max(0, microseconds)) /
      1_000_000
  );
}

function distance(left: RaceVector3, right: RaceVector3) {
  return Math.hypot(left.x - right.x, left.y - right.y, left.z - right.z);
}

const GATE_OPTIONS = {
  boundsTolerance: RACE_CHECK_LIMITS.gateToleranceMetres,
  planeTolerance: RACE_CHECK_LIMITS.gateToleranceMetres,
};

/**
 * Whether the straight line between two moments crosses the next gate after
 * `gates`, with the check's tolerance.
 */
export function crossesNextRaceGate(
  course: RaceCheckCourse,
  gates: number,
  from: RaceVector3,
  to: RaceVector3,
) {
  return (
    gates < raceGateCount(course) &&
    crossesDirectedRaceGate(nextGateAfter(course, gates), from, to, GATE_OPTIONS)
  );
}

/**
 * One step of the run check, mirroring `RaceSession`'s progression: whether
 * `sample` may follow `previous` once `gates` gates are passed. A sample
 * comes at least `minimumGapMicroseconds` later (a fixed step, unless the
 * caller knows better) and no faster than the speed cap. A reset may land
 * only on the race's newest reset point, as the race picks when that point
 * has ground, so a reset never moves a kart forwards; recovery holds the
 * kart off the gates, so a reset never crosses one. A gate-flagged sample
 * must cross the next gate from `previous`. Returns why it fails, or null.
 */
export function checkRaceStep(
  course: RaceCheckCourse,
  gates: number,
  previous: Pick<RaceCheckSample, "position" | "timeMicroseconds">,
  sample: RaceCheckSample,
  minimumGapMicroseconds = STEP_MICROSECONDS,
): RaceCheckRejection | null {
  if (gates >= raceGateCount(course)) return "after-finish";
  const gapMicroseconds = sample.timeMicroseconds - previous.timeMicroseconds;
  if (gapMicroseconds < minimumGapMicroseconds) return "too-fast";
  if (sample.reset) {
    return sample.gate ||
      !nearRaceResetPoint(sample.position, resetPointAfter(course, gates))
      ? "bad-reset"
      : null;
  }
  if (
    distance(previous.position, sample.position) >
    (RACE_CHECK_LIMITS.maxSpeedMetresPerSecond * gapMicroseconds) / 1_000_000 +
      RACE_CHECK_LIMITS.sampleToleranceMetres
  ) {
    return "too-fast";
  }
  if (
    sample.gate &&
    !crossesDirectedRaceGate(
      nextGateAfter(course, gates),
      previous.position,
      sample.position,
      GATE_OPTIONS,
    )
  ) {
    return "wrong-gate";
  }
  return null;
}

/**
 * Checks a finished race's recording against its course, as the server does
 * before a run counts: it starts on the start's reset point, then passes
 * `checkRaceStep` sample by sample, and its time is the finishing
 * crossing's. A forged recording that obeys these rules still passes.
 */
export function verifyRaceRecording(
  course: RaceCheckCourse,
  samples: readonly RaceCheckSample[],
): RaceCheckResult {
  const reject = (reason: RaceCheckRejection): RaceCheckResult => ({
    reason,
    verified: false,
  });
  if (samples.length > MAX_RUN_SAMPLES) return reject("too-long");
  const first = samples[0];
  if (
    !first ||
    !nearRaceResetPoint(first.position, course.startRecovery.position)
  ) {
    return reject("off-start");
  }

  const gateCount = raceGateCount(course);
  let gates = 0;
  for (let index = 1; index < samples.length; index += 1) {
    const sample = samples[index];
    const rejection = checkRaceStep(course, gates, samples[index - 1], sample);
    if (rejection) return reject(rejection);
    if (sample.gate) gates += 1;
  }

  if (gates < gateCount) return reject("unfinished");
  const finishMicroseconds = samples.at(-1)!.timeMicroseconds;
  if (finishMicroseconds > RACE_CHECK_LIMITS.maxRaceMicroseconds) {
    return reject("too-long");
  }
  return { timeMicroseconds: finishMicroseconds, verified: true };
}

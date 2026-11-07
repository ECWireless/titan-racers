import {
  decodeGhostTrace,
  encodeGhostTrace,
  GhostRecorder,
} from "../../src/game/ghost/ghost-trace";
import type {
  DirectedRaceGate,
  RaceVector3,
} from "../../src/game/race/race-gate";
import {
  RaceSession,
  type RaceSessionConfig,
} from "../../src/game/race/race-session";

const STEP_SECONDS = 1 / 120;
const IDENTITY = { w: 1, x: 0, y: 0, z: 0 };
// The kart root rides this far above the ground its reset points sit on.
const ROOT_HEIGHT = 0.1;

export function lifted(point: RaceVector3): RaceVector3 {
  return { x: point.x, y: point.y + ROOT_HEIGHT, z: point.z };
}

/** A waypoint's speed, if any, holds on the leg towards it. */
export type Route = {
  lap: Array<RaceVector3 & { speed?: number }>;
  start: RaceVector3;
};

/** A lap straight through each gate's centre, a little above its floor. */
export function routeThroughGates(config: RaceSessionConfig): Route {
  const through = (gate: DirectedRaceGate) =>
    [-2, 2].map((offset) => ({
      x: gate.center.x + gate.forward.x * offset,
      y: gate.center.y - gate.halfExtents.y + ROOT_HEIGHT,
      z: gate.center.z + gate.forward.z * offset,
    }));
  return {
    lap: [
      ...config.checkpoints.map(({ gate }) => gate),
      config.startGate,
    ].flatMap(through),
    start: lifted(config.startRecovery.position),
  };
}

/**
 * Drives a kart along a looping route at a steady speed, stepping the race
 * session and recorder in the solo race's order, and returns the recording
 * as the server decodes it. A reset teleports to the race's recovery point
 * and resumes towards the route's `resumeAt` waypoint.
 */
export function recordRace(
  config: RaceSessionConfig,
  route: Route,
  {
    reset,
    speed = 10,
  }: {
    reset?: { atMicroseconds: number; resumeAt: number };
    speed?: number;
  } = {},
) {
  const session = new RaceSession(config);
  session.markReady();
  session.startCountdown();
  const recorder = new GhostRecorder();
  const position = { ...route.start };
  let previous = { ...position };
  let target = 0;
  let resetDone = false;

  for (let step = 0; step < 120 * 900; step += 1) {
    session.advanceTime(STEP_SECONDS);
    if (
      reset &&
      !resetDone &&
      session.lifecycleState === "racing" &&
      session.raceMicroseconds >= reset.atMicroseconds
    ) {
      const transform = session.requestRecovery();
      if (!transform) throw new Error("Recovery was refused.");
      Object.assign(position, lifted(transform.position));
      previous = { ...position };
      recorder.markReset();
      target = reset.resumeAt;
      resetDone = true;
    }
    if (session.lifecycleState === "racing") {
      let seconds = STEP_SECONDS;
      while (seconds > 0) {
        const goal = route.lap[target % route.lap.length];
        const travel = (goal.speed ?? speed) * seconds;
        const gap = Math.hypot(
          goal.x - position.x,
          goal.y - position.y,
          goal.z - position.z,
        );
        if (gap <= travel) {
          position.x = goal.x;
          position.y = goal.y;
          position.z = goal.z;
          seconds -= gap / (goal.speed ?? speed);
          target += 1;
        } else {
          position.x += ((goal.x - position.x) * travel) / gap;
          position.y += ((goal.y - position.y) * travel) / gap;
          position.z += ((goal.z - position.z) * travel) / gap;
          seconds = 0;
        }
      }
    }

    let crossed = false;
    let finished = false;
    if (session.acceptsDriving) {
      const result = session.processMovement(previous, position);
      crossed =
        result.kind === "checkpoint" ||
        result.kind === "lap" ||
        result.kind === "finished";
      finished = result.kind === "finished";
    }
    const state = session.lifecycleState;
    if (state === "racing" || state === "recovering" || finished) {
      recorder.recordStep(
        session.raceMicroseconds,
        position,
        IDENTITY,
        0,
        crossed,
      );
    }
    previous = { ...position };
    if (finished) {
      const samples = recorder.finish();
      if (!samples) throw new Error("The recorder overflowed.");
      return {
        fastestLapMicroseconds: Math.min(
          ...session.snapshot.completedLapMicroseconds,
        ),
        samples: decodeGhostTrace(encodeGhostTrace(samples)),
        timeMicroseconds: session.raceMicroseconds,
      };
    }
  }
  throw new Error("The route never finished.");
}

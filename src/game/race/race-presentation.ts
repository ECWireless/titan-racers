import type {
  RaceProgressionResult,
  RaceSessionSnapshot,
} from "./race-session";

export type RacePresentationSnapshot = {
  announcement: string;
  countdownValue: number | null;
  cue: string | null;
  currentLap: number;
  elapsedTime: string;
  lapCount: number;
  lapTimes: string[];
  state: RaceSessionSnapshot["state"];
};

const MICROSECONDS_PER_SECOND = 1_000_000;
const GO_CUE_MICROSECONDS = 1_200_000;
const LAP_CUE_MICROSECONDS = 1_300_000;

export function createLoadingRacePresentationSnapshot(): RacePresentationSnapshot {
  return {
    announcement: "",
    countdownValue: null,
    cue: null,
    currentLap: 1,
    elapsedTime: "0:00.0",
    lapCount: 1,
    lapTimes: [],
    state: "loading",
  };
}

export function formatRaceTime(microseconds: number, precision = 1) {
  const safeMicroseconds = Number.isFinite(microseconds)
    ? Math.max(0, Math.floor(microseconds))
    : 0;
  const minutes = Math.floor(safeMicroseconds / (60 * MICROSECONDS_PER_SECOND));
  const seconds = Math.floor(
    (safeMicroseconds % (60 * MICROSECONDS_PER_SECOND)) /
      MICROSECONDS_PER_SECOND,
  );
  const fractionScale = 10 ** precision;
  const fraction = Math.floor(
    ((safeMicroseconds % MICROSECONDS_PER_SECOND) * fractionScale) /
      MICROSECONDS_PER_SECOND,
  );

  return `${minutes}:${String(seconds).padStart(2, "0")}.${String(fraction).padStart(precision, "0")}`;
}

function getCurrentLapMicroseconds(snapshot: RaceSessionSnapshot) {
  const completedTime = snapshot.completedLapMicroseconds.reduce(
    (total, lapTime) => total + lapTime,
    0,
  );

  return Math.max(0, snapshot.elapsedRaceMicroseconds - completedTime);
}

function getCue(snapshot: RaceSessionSnapshot) {
  if (snapshot.state === "countdown") {
    return String(
      Math.max(
        1,
        Math.ceil(
          snapshot.countdownRemainingMicroseconds / MICROSECONDS_PER_SECOND,
        ),
      ),
    );
  }
  if (
    snapshot.state === "racing" &&
    snapshot.currentLap === 1 &&
    snapshot.elapsedRaceMicroseconds < GO_CUE_MICROSECONDS
  ) {
    return "Go!";
  }
  if (
    snapshot.state === "racing" &&
    snapshot.currentLap > 1 &&
    getCurrentLapMicroseconds(snapshot) < LAP_CUE_MICROSECONDS
  ) {
    return `Lap ${snapshot.currentLap}`;
  }

  return null;
}

function getAnnouncement(
  snapshot: RaceSessionSnapshot,
  result: RaceProgressionResult,
) {
  if (snapshot.state === "countdown") {
    return `Race starts in ${Math.max(1, Math.ceil(snapshot.countdownRemainingMicroseconds / MICROSECONDS_PER_SECOND))}`;
  }
  if (snapshot.state === "recovering") {
    return "Recovering kart";
  }
  if (snapshot.state === "finished") {
    return `Race finished in ${formatRaceTime(snapshot.elapsedRaceMicroseconds, 3)}`;
  }
  if (result.kind === "lap") {
    return `Lap ${snapshot.currentLap} of ${snapshot.lapCount}`;
  }
  if (
    result.kind === "rejected" &&
    (result.reason === "finish-before-checkpoints" ||
      result.reason === "out-of-order")
  ) {
    return "Lap route incomplete";
  }
  if (
    snapshot.state === "racing" &&
    snapshot.currentLap === 1 &&
    snapshot.elapsedRaceMicroseconds < GO_CUE_MICROSECONDS
  ) {
    return "Go";
  }

  return "";
}

export function createRacePresentationSnapshot(
  snapshot: RaceSessionSnapshot,
  result: RaceProgressionResult = { kind: "none" },
): RacePresentationSnapshot {
  return {
    announcement: getAnnouncement(snapshot, result),
    countdownValue:
      snapshot.state === "countdown"
        ? Math.max(
            1,
            Math.ceil(
              snapshot.countdownRemainingMicroseconds /
                MICROSECONDS_PER_SECOND,
            ),
          )
        : null,
    cue: getCue(snapshot),
    currentLap: snapshot.currentLap,
    elapsedTime: formatRaceTime(
      snapshot.elapsedRaceMicroseconds,
      snapshot.state === "finished" ? 3 : 1,
    ),
    lapCount: snapshot.lapCount,
    lapTimes: snapshot.completedLapMicroseconds.map((lapTime) =>
      formatRaceTime(lapTime, 3),
    ),
    state: snapshot.state,
  };
}

export function racePresentationSnapshotsEqual(
  left: RacePresentationSnapshot,
  right: RacePresentationSnapshot,
) {
  return (
    left.announcement === right.announcement &&
    left.countdownValue === right.countdownValue &&
    left.cue === right.cue &&
    left.currentLap === right.currentLap &&
    left.elapsedTime === right.elapsedTime &&
    left.lapCount === right.lapCount &&
    left.state === right.state &&
    left.lapTimes.length === right.lapTimes.length &&
    left.lapTimes.every((lapTime, index) => lapTime === right.lapTimes[index])
  );
}

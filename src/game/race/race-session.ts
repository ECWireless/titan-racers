import {
  crossesDirectedRaceGate,
  type DirectedRaceGate,
  type RaceVector3,
} from "./race-gate";

export type RaceLifecycleState =
  | "loading"
  | "ready"
  | "countdown"
  | "racing"
  | "paused"
  | "recovering"
  | "finished";

export type RaceTransform = {
  position: RaceVector3;
  rotation: RaceVector3;
};

export type RaceCheckpoint = {
  gate: DirectedRaceGate;
  id: string;
  recovery: RaceTransform;
};

export type RaceSessionConfig = {
  checkpoints: RaceCheckpoint[];
  countdownSeconds: number;
  lapCount: number;
  recoverySeconds: number;
  startGate: DirectedRaceGate;
  startRecovery: RaceTransform;
};

export type RaceProgressionResult =
  | { kind: "checkpoint"; checkpointId: string }
  | { kind: "lap"; lap: number; lapMicroseconds: number }
  | {
      kind: "finished";
      lap: number;
      lapMicroseconds: number;
      totalMicroseconds: number;
    }
  | {
      kind: "rejected";
      reason:
        | "finish-before-checkpoints"
        | "lifecycle-inactive"
        | "out-of-order"
        | "repeated";
      targetId?: string;
    }
  | { kind: "none" };

export type RaceSessionSnapshot = {
  activeRecovery: { id: string; transform: RaceTransform };
  completedLapMicroseconds: number[];
  countdownRemainingMicroseconds: number;
  currentLap: number;
  elapsedRaceMicroseconds: number;
  expectedTargetId: string | null;
  lapCount: number;
  recoveryRemainingMicroseconds: number;
  recoveryCandidates: Array<{ id: string; transform: RaceTransform }>;
  resumableState: Exclude<
    RaceLifecycleState,
    "loading" | "ready" | "paused" | "finished"
  > | null;
  state: RaceLifecycleState;
};

const MICROSECONDS_PER_SECOND = 1_000_000;

function cloneVector(vector: RaceVector3): RaceVector3 {
  return { ...vector };
}

function cloneTransform(transform: RaceTransform): RaceTransform {
  return {
    position: cloneVector(transform.position),
    rotation: cloneVector(transform.rotation),
  };
}

function requirePositiveFinite(value: number, name: string) {
  if (!Number.isFinite(value) || value <= 0) {
    throw new Error(`${name} must be a positive finite number`);
  }
}

function toConfiguredMicroseconds(seconds: number, name: string) {
  requirePositiveFinite(seconds, name);
  return Math.round(seconds * MICROSECONDS_PER_SECOND);
}

export class RaceSession {
  private state: RaceLifecycleState = "loading";
  private resumableState: RaceSessionSnapshot["resumableState"] = null;
  private countdownRemainingMicroseconds: number;
  private recoveryRemainingMicroseconds = 0;
  private elapsedRaceMicroseconds = 0;
  private lapStartedAtMicroseconds = 0;
  private completedLapMicroseconds: number[] = [];
  private currentLap = 1;
  private expectedCheckpointIndex = 0;
  private activeRecovery: { id: string; transform: RaceTransform };
  private recoveryCandidates: Array<{ id: string; transform: RaceTransform }>;
  private subMicrosecondRemainder = 0;
  private readonly recoveryDurationMicroseconds: number;

  constructor(private readonly config: RaceSessionConfig) {
    if (!Number.isInteger(config.lapCount) || config.lapCount <= 0) {
      throw new Error("lapCount must be a positive integer");
    }
    if (config.checkpoints.length === 0) {
      throw new Error("RaceSession requires at least one checkpoint");
    }
    if (
      new Set(config.checkpoints.map(({ id }) => id)).size !==
      config.checkpoints.length
    ) {
      throw new Error("RaceSession checkpoint IDs must be unique");
    }

    this.countdownRemainingMicroseconds = toConfiguredMicroseconds(
      config.countdownSeconds,
      "countdownSeconds",
    );
    this.recoveryDurationMicroseconds = toConfiguredMicroseconds(
      config.recoverySeconds,
      "recoverySeconds",
    );
    this.activeRecovery = {
      id: config.startGate.id,
      transform: cloneTransform(config.startRecovery),
    };
    this.recoveryCandidates = [this.activeRecovery];
  }

  get snapshot(): RaceSessionSnapshot {
    return {
      activeRecovery: {
        id: this.activeRecovery.id,
        transform: cloneTransform(this.activeRecovery.transform),
      },
      completedLapMicroseconds: [...this.completedLapMicroseconds],
      countdownRemainingMicroseconds: this.countdownRemainingMicroseconds,
      currentLap: this.currentLap,
      elapsedRaceMicroseconds: this.elapsedRaceMicroseconds,
      expectedTargetId: this.expectedTargetId,
      lapCount: this.config.lapCount,
      recoveryRemainingMicroseconds: this.recoveryRemainingMicroseconds,
      recoveryCandidates: this.recoveryCandidates.map(({ id, transform }) => ({
        id,
        transform: cloneTransform(transform),
      })),
      resumableState: this.resumableState,
      state: this.state,
    };
  }

  get acceptsDriving() {
    return this.state === "racing";
  }

  markReady() {
    if (this.state !== "loading") {
      return false;
    }

    this.state = "ready";
    return true;
  }

  startCountdown() {
    if (this.state !== "ready") {
      return false;
    }

    this.state = "countdown";
    return true;
  }

  pause() {
    if (
      this.state !== "countdown" &&
      this.state !== "racing" &&
      this.state !== "recovering"
    ) {
      return false;
    }

    this.resumableState = this.state;
    this.state = "paused";
    return true;
  }

  resume() {
    if (this.state !== "paused" || this.resumableState === null) {
      return false;
    }

    this.state = this.resumableState;
    this.resumableState = null;
    return true;
  }

  restart() {
    if (this.state !== "finished") {
      return false;
    }

    this.state = "countdown";
    this.resumableState = null;
    this.countdownRemainingMicroseconds = toConfiguredMicroseconds(
      this.config.countdownSeconds,
      "countdownSeconds",
    );
    this.recoveryRemainingMicroseconds = 0;
    this.elapsedRaceMicroseconds = 0;
    this.lapStartedAtMicroseconds = 0;
    this.completedLapMicroseconds = [];
    this.currentLap = 1;
    this.expectedCheckpointIndex = 0;
    this.activeRecovery = {
      id: this.config.startGate.id,
      transform: cloneTransform(this.config.startRecovery),
    };
    this.recoveryCandidates = [this.activeRecovery];
    this.subMicrosecondRemainder = 0;
    return true;
  }

  requestRecovery() {
    if (this.state !== "racing") {
      return null;
    }

    this.state = "recovering";
    this.recoveryRemainingMicroseconds = this.recoveryDurationMicroseconds;
    return cloneTransform(this.activeRecovery.transform);
  }

  advanceTime(seconds: number) {
    if (!Number.isFinite(seconds) || seconds < 0) {
      throw new Error("Race time increments must be finite and non-negative");
    }
    if (
      seconds === 0 ||
      this.state === "loading" ||
      this.state === "ready" ||
      this.state === "paused" ||
      this.state === "finished"
    ) {
      return;
    }

    const exactMicroseconds =
      seconds * MICROSECONDS_PER_SECOND + this.subMicrosecondRemainder;
    let remainingMicroseconds = Math.floor(exactMicroseconds + 1e-9);
    this.subMicrosecondRemainder = exactMicroseconds - remainingMicroseconds;

    while (remainingMicroseconds > 0) {
      if (this.state === "countdown") {
        const consumed = Math.min(
          remainingMicroseconds,
          this.countdownRemainingMicroseconds,
        );
        this.countdownRemainingMicroseconds -= consumed;
        remainingMicroseconds -= consumed;

        if (this.countdownRemainingMicroseconds === 0) {
          this.state = "racing";
        }
        continue;
      }

      if (this.state === "racing") {
        this.elapsedRaceMicroseconds += remainingMicroseconds;
        remainingMicroseconds = 0;
        continue;
      }

      if (this.state === "recovering") {
        const consumed = Math.min(
          remainingMicroseconds,
          this.recoveryRemainingMicroseconds,
        );
        this.elapsedRaceMicroseconds += consumed;
        this.recoveryRemainingMicroseconds -= consumed;
        remainingMicroseconds -= consumed;

        if (this.recoveryRemainingMicroseconds === 0) {
          this.state = "racing";
        }
        continue;
      }

      remainingMicroseconds = 0;
    }
  }

  processMovement(
    previousPosition: RaceVector3,
    currentPosition: RaceVector3,
  ): RaceProgressionResult {
    if (this.state !== "racing") {
      return { kind: "rejected", reason: "lifecycle-inactive" };
    }

    const expectedGate = this.expectedGate;
    if (
      crossesDirectedRaceGate(expectedGate, previousPosition, currentPosition)
    ) {
      return this.acceptExpectedTarget();
    }

    if (
      crossesDirectedRaceGate(
        this.config.startGate,
        previousPosition,
        currentPosition,
      )
    ) {
      return { kind: "rejected", reason: "finish-before-checkpoints" };
    }

    for (const [index, checkpoint] of this.config.checkpoints.entries()) {
      if (
        checkpoint.gate.id === expectedGate.id ||
        !crossesDirectedRaceGate(
          checkpoint.gate,
          previousPosition,
          currentPosition,
        )
      ) {
        continue;
      }

      return {
        kind: "rejected",
        reason:
          index < this.expectedCheckpointIndex ? "repeated" : "out-of-order",
        targetId: checkpoint.id,
      };
    }

    return { kind: "none" };
  }

  private get expectedTargetId() {
    if (this.state === "finished") {
      return null;
    }

    return (
      this.config.checkpoints[this.expectedCheckpointIndex]?.id ??
      this.config.startGate.id
    );
  }

  private get expectedGate() {
    return (
      this.config.checkpoints[this.expectedCheckpointIndex]?.gate ??
      this.config.startGate
    );
  }

  private acceptExpectedTarget(): RaceProgressionResult {
    const checkpoint = this.config.checkpoints[this.expectedCheckpointIndex];
    if (checkpoint) {
      this.expectedCheckpointIndex += 1;
      this.activeRecovery = {
        id: checkpoint.id,
        transform: cloneTransform(checkpoint.recovery),
      };
      this.recoveryCandidates = [
        this.activeRecovery,
        ...this.recoveryCandidates.filter(({ id }) => id !== checkpoint.id),
      ];
      return { checkpointId: checkpoint.id, kind: "checkpoint" };
    }

    const completedLap = this.currentLap;
    const lapMicroseconds =
      this.elapsedRaceMicroseconds - this.lapStartedAtMicroseconds;
    this.completedLapMicroseconds.push(lapMicroseconds);
    this.activeRecovery = {
      id: this.config.startGate.id,
      transform: cloneTransform(this.config.startRecovery),
    };
    this.recoveryCandidates = [this.activeRecovery];

    if (completedLap === this.config.lapCount) {
      this.state = "finished";
      return {
        kind: "finished",
        lap: completedLap,
        lapMicroseconds,
        totalMicroseconds: this.elapsedRaceMicroseconds,
      };
    }

    this.currentLap += 1;
    this.expectedCheckpointIndex = 0;
    this.lapStartedAtMicroseconds = this.elapsedRaceMicroseconds;
    return { kind: "lap", lap: completedLap, lapMicroseconds };
  }
}

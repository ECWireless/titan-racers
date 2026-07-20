export type FixedStepFrame = {
  accumulatorFraction: number;
  droppedFrameSeconds: number;
  droppedSeconds: number;
  frameSeconds: number;
  steps: number;
};

export type FixedStepClockOptions = {
  fixedStepSeconds?: number;
  maxCatchUpSteps?: number;
  maxFrameSeconds?: number;
};

// The 1:4 linear RC reference has characteristic Froude-scaled motion times
// half as long as the former full-size fixture. Doubling the solver rate keeps
// approximately the same integration samples per suspension/rotation event.
export const DEFAULT_FIXED_STEP_SECONDS = 1 / 120;
const DEFAULT_MAX_CATCH_UP_STEPS = 8;
const DEFAULT_MAX_FRAME_SECONDS = 0.1;
const STEP_EPSILON = 1e-9;

export class FixedStepClock {
  readonly fixedStepSeconds: number;
  readonly maxCatchUpSteps: number;
  readonly maxFrameSeconds: number;

  private accumulatorSeconds = 0;
  private droppedSeconds = 0;

  constructor(options: FixedStepClockOptions = {}) {
    this.fixedStepSeconds =
      options.fixedStepSeconds ?? DEFAULT_FIXED_STEP_SECONDS;
    this.maxCatchUpSteps =
      options.maxCatchUpSteps ?? DEFAULT_MAX_CATCH_UP_STEPS;
    this.maxFrameSeconds = options.maxFrameSeconds ?? DEFAULT_MAX_FRAME_SECONDS;

    if (!Number.isFinite(this.fixedStepSeconds) || this.fixedStepSeconds <= 0) {
      throw new Error("fixedStepSeconds must be a positive finite number");
    }

    if (!Number.isInteger(this.maxCatchUpSteps) || this.maxCatchUpSteps <= 0) {
      throw new Error("maxCatchUpSteps must be a positive integer");
    }

    if (!Number.isFinite(this.maxFrameSeconds) || this.maxFrameSeconds <= 0) {
      throw new Error("maxFrameSeconds must be a positive finite number");
    }
  }

  advance(
    frameSeconds: number,
    fixedStep: (stepSeconds: number) => boolean | void,
  ) {
    const safeFrameSeconds = Number.isFinite(frameSeconds)
      ? Math.max(frameSeconds, 0)
      : 0;
    const acceptedFrameSeconds = Math.min(
      safeFrameSeconds,
      this.maxFrameSeconds,
    );
    let droppedThisFrame = safeFrameSeconds - acceptedFrameSeconds;

    this.accumulatorSeconds += acceptedFrameSeconds;

    let steps = 0;
    let stoppedEarly = false;
    while (
      this.accumulatorSeconds + STEP_EPSILON >= this.fixedStepSeconds &&
      steps < this.maxCatchUpSteps
    ) {
      const shouldContinue = fixedStep(this.fixedStepSeconds) !== false;
      this.accumulatorSeconds -= this.fixedStepSeconds;
      steps += 1;

      if (!shouldContinue) {
        stoppedEarly = true;
        this.accumulatorSeconds = 0;
        break;
      }
    }

    if (
      !stoppedEarly &&
      this.accumulatorSeconds + STEP_EPSILON >= this.fixedStepSeconds
    ) {
      const droppedWholeSteps =
        Math.floor(
          (this.accumulatorSeconds + STEP_EPSILON) / this.fixedStepSeconds,
        ) * this.fixedStepSeconds;

      this.accumulatorSeconds -= droppedWholeSteps;
      droppedThisFrame += droppedWholeSteps;
    }

    this.accumulatorSeconds = Math.max(this.accumulatorSeconds, 0);
    this.droppedSeconds += droppedThisFrame;

    return {
      accumulatorFraction: this.accumulatorSeconds / this.fixedStepSeconds,
      droppedFrameSeconds: droppedThisFrame,
      droppedSeconds: this.droppedSeconds,
      frameSeconds: acceptedFrameSeconds,
      steps,
    } satisfies FixedStepFrame;
  }

  reset() {
    this.accumulatorSeconds = 0;
    this.droppedSeconds = 0;
  }
}

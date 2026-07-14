import { z } from "zod";

export type GameplayInputFamily = "gamepad" | "keyboard" | "touch";

const runIdSchema = z.uuidv4();
const inputFamilySchema = z.enum(["keyboard", "touch", "gamepad"]);
export const gameplayRunFailureCodeSchema = z.enum([
  "physics_load_failed",
  "scene_initialization_failed",
  "webgl_context_lost",
  "webgl_context_restore_failed",
]);

const eventBase = {
  runId: runIdSchema,
  schemaVersion: z.literal(1),
} as const;

const runStartedEventSchema = z.strictObject({
  ...eventBase,
  courseId: z.literal("rough-course"),
  type: z.literal("run_started"),
});

const runtimeLoadedEventSchema = z.strictObject({
  ...eventBase,
  elapsedMs: z.number().int().nonnegative().max(600_000),
  type: z.literal("runtime_loaded"),
});

const raceStartedEventSchema = z.strictObject({
  ...eventBase,
  type: z.literal("race_started"),
});

const inputFamiliesSchema = z
  .array(inputFamilySchema)
  .max(3)
  .superRefine((families, context) => {
    if (new Set(families).size !== families.length) {
      context.addIssue({
        code: "custom",
        message: "Input families must be unique.",
      });
    }
  });

const completedRunSchema = z.strictObject({
  ...eventBase,
  completedRaceTimeMs: z.number().int().nonnegative().max(86_400_000),
  inputFamilies: inputFamiliesSchema,
  outcome: z.literal("completed"),
  recoveryCount: z.number().int().nonnegative().max(10_000),
  type: z.literal("run_ended"),
});

const exitedRunSchema = z.strictObject({
  ...eventBase,
  inputFamilies: inputFamiliesSchema,
  outcome: z.literal("exited"),
  recoveryCount: z.number().int().nonnegative().max(10_000),
  type: z.literal("run_ended"),
});

const failedRunSchema = z.strictObject({
  ...eventBase,
  failureCode: gameplayRunFailureCodeSchema,
  inputFamilies: inputFamiliesSchema,
  outcome: z.enum(["load_failed", "runtime_failed"]),
  recoveryCount: z.number().int().nonnegative().max(10_000),
  type: z.literal("run_ended"),
});

export const gameplayRunEventSchema = z.union([
  runStartedEventSchema,
  runtimeLoadedEventSchema,
  raceStartedEventSchema,
  completedRunSchema,
  exitedRunSchema,
  failedRunSchema,
]);

export type GameplayRunEvent = z.infer<typeof gameplayRunEventSchema>;
export type GameplayRunFailureCode = z.infer<
  typeof gameplayRunFailureCodeSchema
>;

export type GameplayTelemetrySink = (
  event: GameplayRunEvent,
  options: { terminal: boolean },
) => Promise<void> | void;

export class GameplayRunTelemetry {
  private delivery = Promise.resolve();
  private readonly inputFamilies = new Set<GameplayInputFamily>();
  private recoveryCount = 0;
  private runId: string | null = null;
  private startedAtMs = 0;
  private terminal = false;

  constructor(
    private readonly sink: GameplayTelemetrySink,
    private readonly createRunId: () => string = () => crypto.randomUUID(),
    private readonly now: () => number = () => performance.now(),
  ) {}

  start(courseId: string) {
    if (courseId !== "rough-course") {
      return;
    }
    this.runId = this.createRunId();
    this.inputFamilies.clear();
    this.recoveryCount = 0;
    this.terminal = false;
    this.startedAtMs = this.now();
    this.emit({
      courseId,
      runId: this.runId,
      schemaVersion: 1,
      type: "run_started",
    });
  }

  markRuntimeLoaded() {
    if (!this.runId || this.terminal) {
      return;
    }
    this.emit({
      elapsedMs: Math.min(
        600_000,
        Math.max(0, Math.round(this.now() - this.startedAtMs)),
      ),
      runId: this.runId,
      schemaVersion: 1,
      type: "runtime_loaded",
    });
  }

  markRaceStarted() {
    this.emitCurrent("race_started");
  }

  recordInputFamily(family: GameplayInputFamily) {
    if (!this.terminal) {
      this.inputFamilies.add(family);
    }
  }

  recordRecovery() {
    if (!this.terminal) {
      this.recoveryCount += 1;
    }
  }

  complete(completedRaceTimeMs: number) {
    this.end({ completedRaceTimeMs, outcome: "completed" });
  }

  exit() {
    this.end({ outcome: "exited" });
  }

  fail(
    outcome: "load_failed" | "runtime_failed",
    failureCode: GameplayRunFailureCode,
  ) {
    this.end({ failureCode, outcome });
  }

  private end(
    terminal:
      | { completedRaceTimeMs: number; outcome: "completed" }
      | { outcome: "exited" }
      | {
          failureCode: GameplayRunFailureCode;
          outcome: "load_failed" | "runtime_failed";
        },
  ) {
    if (!this.runId || this.terminal) {
      return;
    }

    this.terminal = true;
    this.emit(
      {
        ...terminal,
        inputFamilies: [...this.inputFamilies].sort(),
        recoveryCount: this.recoveryCount,
        runId: this.runId,
        schemaVersion: 1,
        type: "run_ended",
      } as GameplayRunEvent,
      true,
    );
  }

  private emitCurrent(type: "race_started") {
    if (!this.runId || this.terminal) {
      return;
    }

    this.emit({ runId: this.runId, schemaVersion: 1, type });
  }

  private emit(event: GameplayRunEvent, terminal = false) {
    this.delivery = this.delivery
      .then(() => this.sink(event, { terminal }))
      .then(() => undefined)
      .catch(() => undefined);
  }
}

export const httpGameplayTelemetrySink: GameplayTelemetrySink = async (
  event,
  { terminal },
) => {
  const testEnabled = Boolean(
    (
      window as typeof window & {
        __TITAN_RACERS_TELEMETRY_TEST__?: boolean;
      }
    ).__TITAN_RACERS_TELEMETRY_TEST__,
  );
  if (
    process.env.NEXT_PUBLIC_GAMEPLAY_TELEMETRY_ENABLED === "false" &&
    !testEnabled
  ) {
    return;
  }

  const response = await fetch("/api/telemetry/gameplay-runs", {
    body: JSON.stringify(event),
    cache: "no-store",
    headers: { "content-type": "application/json" },
    keepalive: terminal,
    method: "POST",
    signal: AbortSignal.timeout(5_000),
  });

  if (!response.ok) {
    throw new Error("Gameplay telemetry was not accepted.");
  }
};

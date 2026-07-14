import { randomUUID } from "node:crypto";

import { expect, test } from "@playwright/test";
import { eq } from "drizzle-orm";

import { getTelemetryDashboard } from "../src/app/api/admin/telemetry/route";
import { postGameplayRun } from "../src/app/api/telemetry/gameplay-runs/route";
import { db } from "../src/db/client";
import { gameplayRuns, users } from "../src/db/schema";
import {
  aggregateGameplayDashboard,
  gameplayDashboardSchema,
  type GameplayDashboardRun,
} from "../src/game/telemetry/gameplay-dashboard";
import {
  GameplayRunTelemetry,
  gameplayRunEventSchema,
  type GameplayRunEvent,
} from "../src/game/telemetry/gameplay-run-events";
import { recordGameplayRunEvent } from "../src/server/gameplay-telemetry-repository";

const ORIGIN = "http://127.0.0.1:3873";

function requestFor(payload: unknown, overrides: RequestInit = {}) {
  return new Request(`${ORIGIN}/api/telemetry/gameplay-runs`, {
    body: JSON.stringify(payload),
    headers: {
      "content-type": "application/json",
      origin: ORIGIN,
      "sec-fetch-site": "same-origin",
    },
    method: "POST",
    ...overrides,
  });
}

function run(
  startedAt: string,
  overrides: Partial<GameplayDashboardRun> = {},
): GameplayDashboardRun {
  return {
    attribution: "guest",
    completedRaceTimeMs: null,
    deploymentVersion: "deployment-a",
    endedAt: null,
    failureCode: null,
    inputFamilies: [],
    loadedAt: null,
    outcome: null,
    racingStartedAt: null,
    recoveryCount: 0,
    runtimeLoadTimeMs: null,
    startedAt: new Date(startedAt),
    ...overrides,
  };
}

test.describe("gameplay telemetry contract", () => {
  test("accepts bounded milestones and rejects arbitrary properties", () => {
    const runId = randomUUID();
    expect(
      gameplayRunEventSchema.parse({
        courseId: "rough-course",
        runId,
        schemaVersion: 1,
        type: "run_started",
      }),
    ).toMatchObject({ runId, type: "run_started" });

    expect(() =>
      gameplayRunEventSchema.parse({
        courseId: "rough-course",
        email: "not-allowed@example.invalid",
        runId,
        schemaVersion: 1,
        type: "run_started",
      }),
    ).toThrow();
    expect(() =>
      gameplayRunEventSchema.parse({
        courseId: "private-note-555-0100",
        runId,
        schemaVersion: 1,
        type: "run_started",
      }),
    ).toThrow();
    expect(() =>
      gameplayRunEventSchema.parse({
        courseId: "rough-course",
        runId: "9eadf9de-4f8c-11ef-9b8c-325096b39f47",
        schemaVersion: 1,
        type: "run_started",
      }),
    ).toThrow();
    expect(() =>
      gameplayRunEventSchema.parse({
        courseId: "rough-course",
        runId: "00000000-0000-0000-0000-000000000000",
        schemaVersion: 1,
        type: "run_started",
      }),
    ).toThrow();
    expect(() =>
      gameplayRunEventSchema.parse({
        inputFamilies: ["keyboard", "keyboard"],
        outcome: "exited",
        recoveryCount: 0,
        runId,
        schemaVersion: 1,
        type: "run_ended",
      }),
    ).toThrow();
    expect(() =>
      gameplayRunEventSchema.parse({
        failureCode: "raw exception text",
        inputFamilies: [],
        outcome: "load_failed",
        recoveryCount: 0,
        runId,
        schemaVersion: 1,
        type: "run_ended",
      }),
    ).toThrow();
  });

  test("reports one ordered summary per run and ignores work after terminal state", async () => {
    const events: GameplayRunEvent[] = [];
    const telemetry = new GameplayRunTelemetry(
      async (event) => {
        await Promise.resolve();
        events.push(event);
      },
      () => "11111111-1111-4111-8111-111111111111",
      (() => {
        const times = [1_000, 3_000];
        return () => times.shift() ?? 3_000;
      })(),
    );

    telemetry.start("rough-course");
    telemetry.markRuntimeLoaded();
    telemetry.recordInputFamily("keyboard");
    telemetry.recordInputFamily("keyboard");
    telemetry.recordInputFamily("gamepad");
    telemetry.recordRecovery();
    telemetry.markRaceStarted();
    telemetry.complete(92_345);
    telemetry.exit();
    await expect.poll(() => events.length).toBe(4);

    expect(events.map(({ type }) => type)).toEqual([
      "run_started",
      "runtime_loaded",
      "race_started",
      "run_ended",
    ]);
    expect(events.at(-1)).toMatchObject({
      completedRaceTimeMs: 92_345,
      inputFamilies: ["gamepad", "keyboard"],
      outcome: "completed",
      recoveryCount: 1,
    });
    expect(events[1]).toMatchObject({ elapsedMs: 2_000 });
  });

  test("never exposes sink failure to gameplay callers", async () => {
    const telemetry = new GameplayRunTelemetry(
      () => {
        throw new Error("telemetry unavailable");
      },
      randomUUID,
    );

    expect(() => {
      telemetry.start("rough-course");
      telemetry.markRuntimeLoaded();
      telemetry.exit();
    }).not.toThrow();
  });
});

test.describe("gameplay telemetry routes", () => {
  test("guards origin, media type, size, and strict schema before recording", async () => {
    const valid = {
      courseId: "rough-course",
      runId: randomUUID(),
      schemaVersion: 1,
      type: "run_started",
    } as const;
    const recorded: GameplayRunEvent[] = [];
    const record = async (event: GameplayRunEvent) => {
      recorded.push(event);
      return "created" as const;
    };

    expect(
      (
        await postGameplayRun(
          requestFor(valid, { headers: { "content-type": "text/plain", origin: ORIGIN } }),
          record,
        )
      ).status,
    ).toBe(415);
    expect(
      (
        await postGameplayRun(
          requestFor(valid, {
            headers: {
              "content-type": "application/json",
              origin: "https://foreign.example",
            },
          }),
          record,
        )
      ).status,
    ).toBe(403);
    expect(
      (
        await postGameplayRun(
          requestFor({ ...valid, arbitrary: "x" }),
          record,
        )
      ).status,
    ).toBe(400);
    expect(
      (
        await postGameplayRun(
          requestFor(valid, {
            headers: {
              "content-length": "5000",
              "content-type": "application/json",
              origin: ORIGIN,
            },
          }),
          record,
        )
      ).status,
    ).toBe(413);
    const undeclaredOversized = requestFor({
      ...valid,
      padding: "x".repeat(5_000),
    });
    expect(undeclaredOversized.headers.get("content-length")).toBeNull();
    expect((await postGameplayRun(undeclaredOversized, record)).status).toBe(
      413,
    );
    expect(
      (
        await postGameplayRun(
          requestFor({ ...valid, courseId: "private-note-555-0100" }),
          record,
        )
      ).status,
    ).toBe(400);
    expect((await postGameplayRun(requestFor(valid), record)).status).toBe(201);
    expect(recorded).toHaveLength(1);
  });

  test("protects dashboard reads with the database-backed role boundary", async () => {
    const request = new Request(`${ORIGIN}/api/admin/telemetry?range=30d`);
    const load = async () => aggregateGameplayDashboard([], "30d");

    expect(
      (
        await getTelemetryDashboard(request, {
          authorize: async () => ({ authorized: false, status: 401 }),
          load,
        })
      ).status,
    ).toBe(401);
    expect(
      (
        await getTelemetryDashboard(request, {
          authorize: async () => ({ authorized: false, status: 403 }),
          load,
        })
      ).status,
    ).toBe(403);
    expect(
      (
        await getTelemetryDashboard(request, {
          authorize: async () => ({ authorized: true, userId: randomUUID() }),
          load,
        })
      ).status,
    ).toBe(200);

    const invalidDashboard = {
      ...aggregateGameplayDashboard([], "30d"),
      failureGroups: [
        {
          count: 1,
          deploymentVersion: "deployment-a",
          failureCode: "raw exception text",
          lastOccurredAt: "2026-07-14T12:00:00.000Z",
          stage: "loading",
        },
      ],
    };
    const invalidResponse = await getTelemetryDashboard(request, {
      authorize: async () => ({ authorized: true, userId: randomUUID() }),
      load: async () => invalidDashboard,
    });
    expect(invalidResponse.status).toBe(500);
    expect(await invalidResponse.text()).not.toContain("raw exception text");
    expect(gameplayDashboardSchema.safeParse(invalidDashboard).success).toBe(
      false,
    );
  });
});

test("aggregates useful dashboard questions without exposing run identity", () => {
  const now = new Date("2026-07-14T12:00:00.000Z");
  const dashboard = aggregateGameplayDashboard(
    [
      run("2026-07-13T10:00:00.000Z", {
        completedRaceTimeMs: 100_000,
        endedAt: new Date("2026-07-13T10:02:00.000Z"),
        inputFamilies: ["keyboard"],
        loadedAt: new Date("2026-07-13T10:00:02.000Z"),
        outcome: "completed",
        racingStartedAt: new Date("2026-07-13T10:00:05.000Z"),
        runtimeLoadTimeMs: 2_000,
      }),
      run("2026-07-13T11:00:00.000Z", {
        attribution: "authenticated",
        completedRaceTimeMs: 120_000,
        endedAt: new Date("2026-07-13T11:03:00.000Z"),
        inputFamilies: ["touch", "gamepad"],
        loadedAt: new Date("2026-07-13T11:00:04.000Z"),
        outcome: "completed",
        racingStartedAt: new Date("2026-07-13T11:00:07.000Z"),
        recoveryCount: 2,
        runtimeLoadTimeMs: 4_000,
      }),
      run("2026-07-14T09:00:00.000Z", {
        endedAt: new Date("2026-07-14T09:00:02.000Z"),
        failureCode: "physics_load_failed",
        outcome: "load_failed",
      }),
      run("2026-07-14T09:05:00.000Z", {
        endedAt: new Date("2026-07-14T09:05:03.000Z"),
        failureCode: "physics_load_failed",
        outcome: "load_failed",
      }),
      run("2026-07-14T10:00:00.000Z", {
        loadedAt: new Date("2026-07-14T10:00:02.000Z"),
        racingStartedAt: new Date("2026-07-14T10:00:05.000Z"),
        runtimeLoadTimeMs: 2_000,
      }),
      run("2026-07-14T11:50:00.000Z", {
        loadedAt: new Date("2026-07-14T11:50:02.000Z"),
        racingStartedAt: new Date("2026-07-14T11:50:05.000Z"),
        runtimeLoadTimeMs: 2_000,
      }),
    ],
    "7d",
    now,
  );

  expect(dashboard.summary).toEqual({
    attempts: 6,
    completed: 2,
    completionRate: 1 / 3,
    loaded: 4,
    medianCompletedRaceTimeMs: 110_000,
    medianLoadTimeMs: 2_000,
    racing: 4,
  });
  expect(dashboard.outcomes).toMatchObject({
    active: 1,
    completed: 2,
    loadFailed: 2,
    unfinished: 1,
  });
  expect(dashboard.inputFamilies).toEqual({ gamepad: 1, keyboard: 1, touch: 1 });
  expect(dashboard.recoveries).toEqual({
    multiple: 1,
    one: 0,
    sampleSize: 2,
    zero: 1,
  });
  expect(dashboard.attribution).toEqual({ anonymous: 5, authenticated: 1 });
  expect(dashboard.funnel).toEqual({
    attempts: { count: 6 },
    completed: { conversionRate: 0.5, count: 2 },
    loaded: { conversionRate: 2 / 3, count: 4 },
    racing: { conversionRate: 1, count: 4 },
  });
  expect(dashboard.failureGroups).toEqual([
    {
      count: 2,
      deploymentVersion: "deployment-a",
      failureCode: "physics_load_failed",
      lastOccurredAt: "2026-07-14T09:05:03.000Z",
      stage: "loading",
    },
  ]);
  expect(JSON.stringify(dashboard)).not.toContain("userId");
});

test.describe("gameplay telemetry Postgres integration", () => {
  test.describe.configure({ mode: "serial" });

  test.beforeEach(async ({}, testInfo) => {
    test.skip(
      testInfo.project.name !== "desktop",
      "Database integration runs once in the desktop project.",
    );
    test.skip(
      !process.env.DATABASE_URL?.trim(),
      "DATABASE_URL is required for gameplay telemetry integration tests.",
    );
  });

  test("stores anonymous server-owned milestones idempotently and freezes terminal outcome", async () => {
    const runId = randomUUID();
    const originalDeployment = process.env.VERCEL_GIT_COMMIT_SHA;
    process.env.VERCEL_GIT_COMMIT_SHA = "server-owned-test-deployment";

    try {
      expect(
        await recordGameplayRunEvent(
          {
            courseId: "rough-course",
            runId,
            schemaVersion: 1,
            type: "run_started",
          },
          new Date("2026-07-14T10:00:00.000Z"),
        ),
      ).toBe("created");
      expect(
        await recordGameplayRunEvent(
          {
            courseId: "rough-course",
            runId,
            schemaVersion: 1,
            type: "run_started",
          },
          new Date("2026-07-14T10:00:01.000Z"),
        ),
      ).toBe("ignored");
      await recordGameplayRunEvent(
        { elapsedMs: 2_000, runId, schemaVersion: 1, type: "runtime_loaded" },
        new Date("2026-07-14T10:00:02.000Z"),
      );
      await recordGameplayRunEvent(
        { runId, schemaVersion: 1, type: "race_started" },
        new Date("2026-07-14T10:00:05.000Z"),
      );
      await recordGameplayRunEvent(
        {
          completedRaceTimeMs: 95_432,
          inputFamilies: ["keyboard", "gamepad"],
          outcome: "completed",
          recoveryCount: 1,
          runId,
          schemaVersion: 1,
          type: "run_ended",
        },
        new Date("2026-07-14T10:02:00.000Z"),
      );
      expect(
        await recordGameplayRunEvent(
          {
            inputFamilies: ["touch"],
            outcome: "exited",
            recoveryCount: 9,
            runId,
            schemaVersion: 1,
            type: "run_ended",
          },
          new Date("2026-07-14T10:03:00.000Z"),
        ),
      ).toBe("ignored");

      const [stored] = await db
        .select()
        .from(gameplayRuns)
        .where(eq(gameplayRuns.id, runId));
      expect(stored).toMatchObject({
        attribution: "guest",
        completedRaceTimeMs: 95_432,
        courseId: "rough-course",
        deploymentVersion: "server-owned-test-deployment",
        inputFamilies: ["keyboard", "gamepad"],
        outcome: "completed",
        recoveryCount: 1,
        runtimeLoadTimeMs: 2_000,
        userId: null,
      });
      expect(stored.startedAt.toISOString()).toBe("2026-07-14T10:00:00.000Z");
      expect(stored.loadedAt?.toISOString()).toBe("2026-07-14T10:00:02.000Z");
      expect(stored.racingStartedAt?.toISOString()).toBe(
        "2026-07-14T10:00:05.000Z",
      );
      expect(stored.endedAt?.toISOString()).toBe("2026-07-14T10:02:00.000Z");

      let immutableTerminalError: unknown;
      try {
        await db
          .update(gameplayRuns)
          .set({ recoveryCount: 2 })
          .where(eq(gameplayRuns.id, runId));
      } catch (error) {
        immutableTerminalError = error;
      }
      expect(immutableTerminalError).toBeInstanceOf(Error);
      expect(
        (immutableTerminalError as Error & { cause?: Error }).cause?.message,
      ).toMatch(/terminal gameplay runs are immutable/);
    } finally {
      if (originalDeployment === undefined) {
        delete process.env.VERCEL_GIT_COMMIT_SHA;
      } else {
        process.env.VERCEL_GIT_COMMIT_SHA = originalDeployment;
      }
      await db.delete(gameplayRuns).where(eq(gameplayRuns.id, runId));
    }
  });

  test("rejects out-of-order terminal states and resolves concurrent completion once", async () => {
    const invalidRunId = randomUUID();
    const concurrentRunId = randomUUID();

    try {
      await recordGameplayRunEvent(
        {
          courseId: "rough-course",
          runId: invalidRunId,
          schemaVersion: 1,
          type: "run_started",
        },
        new Date("2026-07-14T10:00:00.000Z"),
      );
      expect(
        await recordGameplayRunEvent(
          {
            completedRaceTimeMs: 50_000,
            inputFamilies: [],
            outcome: "completed",
            recoveryCount: 0,
            runId: invalidRunId,
            schemaVersion: 1,
            type: "run_ended",
          },
          new Date("2026-07-14T10:01:00.000Z"),
        ),
      ).toBe("ignored");
      expect(
        await recordGameplayRunEvent(
          {
            failureCode: "webgl_context_lost",
            inputFamilies: [],
            outcome: "runtime_failed",
            recoveryCount: 0,
            runId: invalidRunId,
            schemaVersion: 1,
            type: "run_ended",
          },
          new Date("2026-07-14T10:01:00.000Z"),
        ),
      ).toBe("ignored");
      expect(
        await recordGameplayRunEvent(
          {
            elapsedMs: 2_000,
            runId: invalidRunId,
            schemaVersion: 1,
            type: "runtime_loaded",
          },
          new Date("2026-07-14T09:59:59.000Z"),
        ),
      ).toBe("ignored");

      await recordGameplayRunEvent(
        {
          courseId: "rough-course",
          runId: concurrentRunId,
          schemaVersion: 1,
          type: "run_started",
        },
        new Date("2026-07-14T11:00:00.000Z"),
      );
      await recordGameplayRunEvent(
        {
          elapsedMs: 2_000,
          runId: concurrentRunId,
          schemaVersion: 1,
          type: "runtime_loaded",
        },
        new Date("2026-07-14T11:00:02.000Z"),
      );
      await recordGameplayRunEvent(
        { runId: concurrentRunId, schemaVersion: 1, type: "race_started" },
        new Date("2026-07-14T11:00:05.000Z"),
      );
      const completion: GameplayRunEvent = {
        completedRaceTimeMs: 50_000,
        inputFamilies: ["keyboard"],
        outcome: "completed",
        recoveryCount: 0,
        runId: concurrentRunId,
        schemaVersion: 1,
        type: "run_ended",
      };
      expect(
        (await Promise.all([
          recordGameplayRunEvent(
            completion,
            new Date("2026-07-14T11:01:00.000Z"),
          ),
          recordGameplayRunEvent(
            completion,
            new Date("2026-07-14T11:01:01.000Z"),
          ),
        ])).sort(),
      ).toEqual(["ignored", "updated"]);
    } finally {
      await db
        .delete(gameplayRuns)
        .where(eq(gameplayRuns.id, invalidRunId));
      await db
        .delete(gameplayRuns)
        .where(eq(gameplayRuns.id, concurrentRunId));
    }
  });

  test("keeps original attribution while allowing account deletion to erase the user link", async () => {
    const activeGuestRunId = randomUUID();
    const authenticatedRunId = randomUUID();
    const invalidAuthenticatedRunId = randomUUID();
    const userId = `telemetry-test-${randomUUID()}`;

    try {
      let invalidInsertError: unknown;
      try {
        await db.insert(gameplayRuns).values({
          attribution: "authenticated",
          courseId: "rough-course",
          deploymentVersion: "test",
          id: invalidAuthenticatedRunId,
          inputFamilies: [],
        });
      } catch (error) {
        invalidInsertError = error;
      }
      expect(invalidInsertError).toBeInstanceOf(Error);
      expect(
        (invalidInsertError as Error & { cause?: Error }).cause?.message,
      ).toMatch(/gameplay run initial attribution is invalid/);

      await db.insert(users).values({
        email: `${userId}@example.invalid`,
        emailVerified: true,
        id: userId,
        name: "Telemetry test user",
      });
      await db.insert(gameplayRuns).values([
        {
          courseId: "rough-course",
          deploymentVersion: "test",
          id: activeGuestRunId,
          inputFamilies: [],
        },
        {
          attribution: "authenticated",
          courseId: "rough-course",
          deploymentVersion: "test",
          id: authenticatedRunId,
          inputFamilies: [],
          userId,
        },
      ]);

      let relinkError: unknown;
      try {
        await db
          .update(gameplayRuns)
          .set({ userId })
          .where(eq(gameplayRuns.id, activeGuestRunId));
      } catch (error) {
        relinkError = error;
      }
      expect(relinkError).toBeInstanceOf(Error);
      expect(
        (relinkError as Error & { cause?: Error }).cause?.message,
      ).toMatch(/gameplay run attribution cannot be changed/);

      expect(
        await recordGameplayRunEvent({
          inputFamilies: [],
          outcome: "exited",
          recoveryCount: 0,
          runId: activeGuestRunId,
          schemaVersion: 1,
          type: "run_ended",
        }),
      ).toBe("updated");
      relinkError = undefined;
      try {
        await db
          .update(gameplayRuns)
          .set({ userId })
          .where(eq(gameplayRuns.id, activeGuestRunId));
      } catch (error) {
        relinkError = error;
      }
      expect(relinkError).toBeInstanceOf(Error);
      expect(
        (relinkError as Error & { cause?: Error }).cause?.message,
      ).toMatch(/gameplay run attribution cannot be changed/);

      await db.delete(users).where(eq(users.id, userId));
      const [anonymized] = await db
        .select({
          attribution: gameplayRuns.attribution,
          userId: gameplayRuns.userId,
        })
        .from(gameplayRuns)
        .where(eq(gameplayRuns.id, authenticatedRunId));
      expect(anonymized).toEqual({
        attribution: "authenticated",
        userId: null,
      });
    } finally {
      await db
        .delete(gameplayRuns)
        .where(eq(gameplayRuns.id, activeGuestRunId));
      await db
        .delete(gameplayRuns)
        .where(eq(gameplayRuns.id, authenticatedRunId));
      await db
        .delete(gameplayRuns)
        .where(eq(gameplayRuns.id, invalidAuthenticatedRunId));
      await db.delete(users).where(eq(users.id, userId));
    }
  });

  test("rejects non-allowlisted failure codes at the database boundary", async () => {
    const runId = randomUUID();
    let insertError: unknown;

    try {
      await db.insert(gameplayRuns).values({
        courseId: "rough-course",
        deploymentVersion: "test",
        endedAt: new Date("2026-07-14T10:01:00.000Z"),
        failureCode: "raw exception text",
        id: runId,
        inputFamilies: [],
        outcome: "load_failed",
        startedAt: new Date("2026-07-14T10:00:00.000Z"),
      });
    } catch (error) {
      insertError = error;
    }

    expect(insertError).toBeInstanceOf(Error);
    expect((insertError as Error & { cause?: Error }).cause?.message).toMatch(
      /gameplay_runs_failure_code_allowlist/,
    );
    await db.delete(gameplayRuns).where(eq(gameplayRuns.id, runId));
  });
});

test.describe("gameplay telemetry browser integration", () => {
  test("reports ordered run milestones without making racing depend on ingestion", async ({
    page,
  }) => {
    const events: GameplayRunEvent[] = [];
    await page.addInitScript(() => {
      (
        window as typeof window & {
          __TITAN_RACERS_TELEMETRY_TEST__?: boolean;
        }
      ).__TITAN_RACERS_TELEMETRY_TEST__ = true;
    });
    await page.route("**/api/telemetry/gameplay-runs", async (route) => {
      events.push(gameplayRunEventSchema.parse(route.request().postDataJSON()));
      await route.fulfill({ status: 202 });
    });

    await page.goto("/");
    await page.getByRole("button", { name: "Solo Time Trial" }).click();
    const canvas = page.getByTestId("solo-time-trial-canvas");
    await expect(canvas).toHaveAttribute("data-scene-ready", "true", {
      timeout: 15_000,
    });
    await expect.poll(() => events.map(({ type }) => type)).toContain(
      "runtime_loaded",
    );
    await expect.poll(() => events.map(({ type }) => type), { timeout: 6_000 }).toContain(
      "race_started",
    );

    await page.keyboard.down("KeyW");
    await page.waitForTimeout(100);
    await page.keyboard.up("KeyW");
    await page.keyboard.press("Escape");
    await expect(page.getByRole("dialog", { name: "Paused" })).toBeVisible();
    await page.getByRole("button", { name: "Exit", exact: true }).click();
    await expect(page.getByText("Choose game mode")).toBeVisible();
    await expect.poll(() => events.at(-1)?.type).toBe("run_ended");
    expect(events.map(({ type }) => type)).toEqual([
      "run_started",
      "runtime_loaded",
      "race_started",
      "run_ended",
    ]);
    expect(events.at(-1)).toMatchObject({
      inputFamilies: ["keyboard"],
      outcome: "exited",
    });
  });

  test("keeps the race playable when telemetry ingestion is unavailable", async ({
    page,
  }) => {
    await page.addInitScript(() => {
      (
        window as typeof window & {
          __TITAN_RACERS_TELEMETRY_TEST__?: boolean;
        }
      ).__TITAN_RACERS_TELEMETRY_TEST__ = true;
    });
    await page.route("**/api/telemetry/gameplay-runs", (route) => route.abort());
    await page.goto("/");
    await page.getByRole("button", { name: "Solo Time Trial" }).click();
    await expect(page.getByTestId("solo-time-trial-canvas")).toHaveAttribute(
      "data-scene-ready",
      "true",
      { timeout: 15_000 },
    );
    await expect(page.getByRole("region", { name: "Race status" })).toBeVisible();
  });

  test("renders the protected dashboard summary without exposing run IDs", async ({
    page,
  }) => {
    const dashboard = aggregateGameplayDashboard(
      [
        run("2026-07-14T10:00:00.000Z", {
          completedRaceTimeMs: 95_000,
          endedAt: new Date("2026-07-14T10:02:00.000Z"),
          inputFamilies: ["keyboard"],
          loadedAt: new Date("2026-07-14T10:00:02.000Z"),
          outcome: "completed",
          racingStartedAt: new Date("2026-07-14T10:00:05.000Z"),
          runtimeLoadTimeMs: 2_000,
        }),
        run("2026-07-14T11:00:00.000Z", {
          endedAt: new Date("2026-07-14T11:00:03.000Z"),
          failureCode: "scene_initialization_failed",
          outcome: "load_failed",
        }),
      ],
      "7d",
      new Date("2026-07-14T12:00:00.000Z"),
    );
    await page.route("**/api/admin/telemetry?range=7d", (route) =>
      route.fulfill({ body: JSON.stringify(dashboard), contentType: "application/json" }),
    );

    await page.goto("/admin/telemetry");
    await expect(
      page.getByRole("heading", { name: "Gameplay Telemetry" }),
    ).toBeVisible();
    await expect(page.getByRole("region", { name: "Run summary" })).toContainText(
      "Attempts",
    );
    await expect(page.getByRole("heading", { name: "Daily runs" })).toBeVisible();
    await expect(page.getByRole("heading", { name: "Run funnel" })).toBeVisible();
    await expect(page.getByText("Loaded", { exact: true })).toBeVisible();
    await expect(page.getByText("100% from prior stage")).toHaveCount(2);
    await expect(page.getByRole("heading", { name: "Controls used" })).toBeVisible();
    await expect(page.getByRole("heading", { name: "Grouped failures" })).toBeVisible();
    await expect(page.getByText("scene_initialization_failed")).toBeVisible();
    await expect(page.locator("body")).not.toContainText(
      "11111111-1111-4111-8111-111111111111",
    );
  });
});

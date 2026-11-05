import { randomBytes } from "node:crypto";

import { expect, type Locator, type Page, test } from "@playwright/test";

import { FALLS_VIEW_PARK_DOCUMENT } from "../src/game/course/course-document";
import { createBalancedKartDocument } from "../src/game/kart/balanced-kart-document";
import { deriveKartSnapshot } from "../src/game/kart/kart-derivation";
import { CURRENT_PHYSICS_VERSION } from "../src/game/physics/physics-version";
import { RACE_LAP_COUNT } from "../src/game/race/race-course";
import { createRoomCode, ROOM_PROTOCOL } from "../src/game/room/room-protocol";
import {
  randomRoomPlayerKey,
  signRoomToken,
} from "../src/game/room/room-signing";
import type { RaceDebugState } from "../src/game/testing/scene-test-adapter";
import { startRoomServer } from "./support/room-server";

// Two browsers race one room on a local room server. The token route is
// answered here: under Playwright's `next dev`, the same-origin guard
// refuses real browser POSTs.
test.describe.configure({ mode: "serial" });

// Matches NEXT_PUBLIC_ROOM_SERVER_URL in playwright.config.ts.
const ROOM_PORT = 8798;
const SECRET = randomBytes(32).toString("base64url");
const KART = createBalancedKartDocument("balanced-kart");
const KART_SNAPSHOT = deriveKartSnapshot(KART);
// Falls View Park with one checkpoint: software WebGL steps two pages
// slowly, so each lap is two gates.
const COURSE = {
  ...FALLS_VIEW_PARK_DOCUMENT,
  checkpoints: FALLS_VIEW_PARK_DOCUMENT.checkpoints.slice(0, 1),
};
const GATE_COUNT = RACE_LAP_COUNT * (COURSE.checkpoints.length + 1);

type Vector = { x: number; y: number; z: number };

let server: Awaited<ReturnType<typeof startRoomServer>> | undefined;

test.beforeAll(async () => {
  test.setTimeout(90_000);
  server = await startRoomServer({
    origins: ["http://127.0.0.1:3873", "http://localhost:3873"],
    port: ROOM_PORT,
    secret: SECRET,
  });
});

test.afterAll(async () => {
  await server?.stop();
});

async function joinAs(page: Page, code: string, username: string | null) {
  await Promise.all([
    page.route("**/api/karts/official", (route) =>
      route.fulfill({
        json: {
          karts: [
            {
              assemblerCredit: "Titan Racers",
              runtime: {
                derivationVersion: KART_SNAPSHOT.derivationVersion,
                document: KART,
                kartId: KART.kartId,
                publishedAt: "2026-07-25T00:05:00.000Z",
                resolvedSnapshot: KART_SNAPSHOT,
                resolvedSnapshotHash: "a".repeat(64),
                revision: 1,
                schemaVersion: KART.schemaVersion,
                thumbnailAvailable: false,
              },
            },
          ],
          source: "published",
        },
      }),
    ),
    page.route("**/api/courses/falls-view-park/published*", (route) =>
      route.fulfill({
        json: {
          courseId: COURSE.courseId,
          document: COURSE,
          publishedAt: "2026-07-12T00:05:00.000Z",
          revision: 1,
          schemaVersion: COURSE.schemaVersion,
        },
      }),
    ),
    page.route(`**/api/rooms/${code}/token`, async (route) =>
      route.fulfill({
        json: {
          token: await signRoomToken(SECRET, {
            protocol: ROOM_PROTOCOL,
            room: code,
            courseId: COURSE.courseId,
            courseRevision: 1,
            gateCount: GATE_COUNT,
            physicsVersion: CURRENT_PHYSICS_VERSION,
            karts: [{ id: KART.kartId, revision: 1 }],
            player: {
              key: randomRoomPlayerKey(),
              username,
              signedIn: username !== null,
            },
          }),
        },
      }),
    ),
  ]);
  await page.goto(`/room/${code}`);
}

async function raceState(canvas: Locator) {
  return canvas.evaluate(
    (element) =>
      new Promise<RaceDebugState>((resolve) => {
        element.dispatchEvent(
          new CustomEvent("getRaceDebugState", {
            detail: { respond: resolve },
          }),
        );
      }),
  );
}

/**
 * Steps a page's race once, optionally across a gate, and reads it with
 * the page's clock. Pages stay paused and undrawn from here on: two
 * software-WebGL scenes drawing at once starve each other.
 */
async function step(
  canvas: Locator,
  movement?: { previousPosition: Vector; currentPosition: Vector },
) {
  return canvas.evaluate(
    (element, requested) =>
      new Promise<{ at: number; state: RaceDebugState }>((resolve) => {
        element.dispatchEvent(
          new CustomEvent("setSimulationPaused", { detail: { paused: true } }),
        );
        element.dispatchEvent(
          new CustomEvent("setRenderingSuspended", {
            detail: { suspended: true },
          }),
        );
        if (requested) {
          element.dispatchEvent(
            new CustomEvent("setRaceDebugMovement", {
              detail: { ...requested, preserveMotion: false },
            }),
          );
        }
        element.dispatchEvent(
          new CustomEvent("stepSimulation", { detail: { steps: 1 } }),
        );
        element.dispatchEvent(
          new CustomEvent("getRaceDebugState", {
            detail: {
              respond: (state: RaceDebugState) =>
                resolve({ at: Date.now(), state }),
            },
          }),
        );
      }),
    movement ?? null,
  );
}

/** Moves the kart across a gate and steps once, so the race counts it. */
async function cross(
  canvas: Locator,
  { forward, position }: { forward: Vector; position: Vector },
) {
  const { state } = await step(canvas, {
    currentPosition: {
      x: position.x + forward.x,
      y: position.y + forward.y,
      z: position.z + forward.z,
    },
    previousPosition: {
      x: position.x - forward.x,
      y: position.y - forward.y,
      z: position.z - forward.z,
    },
  });
  return state.lastProgressionResult.kind;
}

const startYaw = (COURSE.start.rotation.y * Math.PI) / 180;
const START_TARGET = {
  forward: { x: -Math.sin(startYaw), y: 0, z: -Math.cos(startYaw) },
  position: {
    ...COURSE.start.position,
    y: COURSE.start.position.y + COURSE.start.gateHalfExtents.y,
  },
};

async function driveTwoLaps(canvas: Locator) {
  for (let lap = 1; lap <= RACE_LAP_COUNT; lap += 1) {
    for (const checkpoint of COURSE.checkpoints) {
      expect(await cross(canvas, checkpoint)).toBe("checkpoint");
    }
    expect(await cross(canvas, START_TARGET)).toBe(
      lap === RACE_LAP_COUNT ? "finished" : "lap",
    );
  }
}

test("two players race a room on one clock to the same results", async ({
  browser,
}) => {
  test.setTimeout(300_000);
  const code = createRoomCode();
  // Small windows: two software-WebGL races share one machine.
  const contexts = await Promise.all(
    [0, 1].map(() =>
      browser.newContext({ viewport: { width: 480, height: 320 } }),
    ),
  );
  const pages = await Promise.all(
    contexts.map((context) => context.newPage()),
  );
  const [host, guest] = pages;
  try {
    await joinAs(host, code, "ada");
    await expect(
      host.getByRole("heading", { name: "Private room" }),
    ).toBeVisible();
    await joinAs(guest, code, null);
    const hostRacers = host.getByRole("list", { name: "Racers in this room" });
    await expect(hostRacers).toContainText("@ada (you)");
    await expect(hostRacers).toContainText("Guest 1");
    await expect(host.getByRole("button", { name: "Start race" })).toBeDisabled();

    for (const page of pages) {
      await page.getByRole("button", { name: /Balanced Kart/ }).click();
    }
    await expect(hostRacers).toContainText("Ready · Balanced Kart");
    await expect(guest.getByText("The host starts the race.")).toBeVisible();
    await host.getByRole("button", { name: "Start race" }).click();

    const canvases = pages.map((page) =>
      page.getByTestId("solo-time-trial-canvas"),
    );
    for (const canvas of canvases) {
      await expect(canvas).toHaveAttribute("data-scene-ready", "true", {
        timeout: 120_000,
      });
    }
    // A page without focus when its countdown starts pauses, as a hidden
    // one would; the room's race runs on, and Resume rejoins it.
    for (const [index, canvas] of canvases.entries()) {
      await expect
        .poll(
          async () => {
            const { state } = await raceState(canvas);
            if (state === "paused") {
              await pages[index].getByRole("button", { name: "Resume" }).click();
            }
            return state;
          },
          { timeout: 60_000 },
        )
        .toBe("racing");
    }
    await expect(
      host.getByRole("region", { name: "Standings" }),
    ).toContainText("You");
    // Both race clocks read the room's, however late each counted down:
    // within the catch-up's 50 ms, a step, and the clock estimate's error.
    const [hostStart, guestStart] = (
      await Promise.all(canvases.map((canvas) => step(canvas)))
    ).map(({ at, state }) => at - state.elapsedRaceMicroseconds / 1_000);
    expect(Math.abs(hostStart - guestStart)).toBeLessThan(250);

    // The guest finishes first; both see the same places.
    await driveTwoLaps(canvases[1]);
    await expect(guest.getByText(/Finished · 1st/)).toBeVisible();
    await driveTwoLaps(canvases[0]);
    for (const page of pages) {
      const results = page.getByRole("list", { name: "This race results" });
      await expect(results).toBeVisible();
      await expect(results.getByRole("listitem")).toHaveCount(2);
      await expect(results.getByRole("listitem").first()).toContainText(
        "Guest 1",
      );
      await expect(results.getByRole("listitem").nth(1)).toContainText("@ada");
    }
    await expect
      .poll(() => server!.reports.length, { timeout: 10_000 })
      .toBe(1);

    // Race again returns both to the room, ready with the same kart.
    for (const page of pages) {
      await page.getByRole("button", { name: "Race again" }).click();
    }
    await expect(
      host.getByRole("heading", { name: "Private room" }),
    ).toBeVisible();
    await expect(
      host.getByRole("list", { name: "Last race results" }),
    ).toBeVisible();
    await expect(host.getByRole("button", { name: "Start race" })).toBeEnabled();
  } finally {
    await Promise.all(contexts.map((context) => context.close()));
  }
});

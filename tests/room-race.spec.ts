import { randomBytes } from "node:crypto";

import {
  expect,
  type Locator,
  type Page,
  test,
  type WebSocketRoute,
} from "@playwright/test";

import { FALLS_VIEW_PARK_DOCUMENT } from "../src/game/course/course-document";
import { createBalancedKartDocument } from "../src/game/kart/balanced-kart-document";
import { deriveKartSnapshot } from "../src/game/kart/kart-derivation";
import { CURRENT_PHYSICS_VERSION } from "../src/game/physics/physics-version";
import { RACE_LAP_COUNT } from "../src/game/race/race-course";
import { createRoomCourse } from "../src/game/room/room-course";
import {
  createRoomCode,
  parseServerMessage,
  ROOM_PROTOCOL,
  type RoomServerMessage,
} from "../src/game/room/room-protocol";
import {
  randomRoomPlayerKey,
  roomKartContact,
  signRoomToken,
} from "../src/game/room/room-signing";
import type { RaceAudioDebugState } from "../src/game/audio/race-audio";
import type {
  CollisionDebugState,
  KartDebugState,
  RaceDebugState,
} from "../src/game/testing/scene-test-adapter";
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

/** A join token for the test's room, as the app signs one. */
async function roomToken(code: string, username: string | null, key: string) {
  return signRoomToken(SECRET, {
    protocol: ROOM_PROTOCOL,
    room: code,
    courseId: COURSE.courseId,
    courseRevision: 1,
    course: createRoomCourse(COURSE),
    physicsVersion: CURRENT_PHYSICS_VERSION,
    karts: [
      {
        id: KART.kartId,
        revision: 1,
        contact: roomKartContact(KART_SNAPSHOT),
      },
    ],
    player: { key, username, signedIn: username !== null },
  });
}

async function joinAs(page: Page, code: string, username: string | null) {
  // One seat per page, as the app's keys give, so a reconnect retakes it.
  const key = randomRoomPlayerKey();
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
      route.fulfill({ json: { token: await roomToken(code, username, key) } }),
    ),
  ]);
  await page.goto(`/room/${code}`);
}

/**
 * Passes a page's room connections through, so the test can cut one and
 * keep it down for a while, as a dropped network would.
 */
async function cuttableRoom(page: Page) {
  let down = false;
  let live: { page: WebSocketRoute; server: WebSocketRoute } | null = null;
  const cut = () => {
    down = true;
    void live?.server.close({ code: 4100 });
    void live?.page.close({ code: 4100 });
    live = null;
  };
  await page.routeWebSocket(/\/v1\/rooms\//, (route) => {
    if (down) {
      void route.close({ code: 4100 });
      return;
    }
    live = { page: route, server: route.connectToServer() };
  });
  return {
    cut,
    restore() {
      down = false;
    },
  };
}

/**
 * Passes a page's room connection through, so the test can also send the
 * page a message as if from the room.
 */
async function injectableRoom(page: Page) {
  let live: WebSocketRoute | null = null;
  await page.routeWebSocket(/\/v1\/rooms\//, (route) => {
    route.connectToServer();
    live = route;
  });
  return {
    send(message: RoomServerMessage) {
      (live as WebSocketRoute | null)?.send(JSON.stringify(message));
    },
  };
}

/**
 * Another racer in the room, from Node: it pings each second, as a page
 * does while racing, and sends whatever states the test gives it.
 */
class Rival {
  readonly messages: RoomServerMessage[] = [];
  /** The room's clock less this one's, in ms. */
  offsetMs = 0;
  private readonly pings: ReturnType<typeof setInterval>;

  constructor(private readonly socket: WebSocket) {
    socket.addEventListener("message", (event) => {
      const message = parseServerMessage(event.data);
      if (!message) return;
      this.messages.push(message);
      if (message.type === "pong") {
        this.offsetMs = message.serverAt - (message.t + Date.now()) / 2;
      }
    });
    this.pings = setInterval(
      () => this.send({ type: "ping", t: Date.now() }),
      1_000,
    );
  }

  static async join(code: string) {
    const token = await roomToken(code, null, randomRoomPlayerKey());
    // Node's WebSocket (undici) takes headers, so it can send an Origin.
    const socket = new WebSocket(
      `ws://127.0.0.1:${ROOM_PORT}/v1/rooms/${code}?token=${token}`,
      { headers: { origin: "http://127.0.0.1:3873" } } as unknown as string[],
    );
    await new Promise((resolve) => socket.addEventListener("open", resolve));
    return new Rival(socket);
  }

  send(message: unknown) {
    if (this.socket.readyState === WebSocket.OPEN) {
      this.socket.send(JSON.stringify(message));
    }
  }

  async next(match: (message: RoomServerMessage) => boolean) {
    await expect.poll(() => this.messages.some(match)).toBe(true);
    return this.messages.find(match)!;
  }

  /** The room's race time now, in µs, given the race's start. */
  raceMicroseconds(racingAt: number) {
    return Math.round((Date.now() + this.offsetMs - racingAt) * 1_000);
  }

  leave() {
    clearInterval(this.pings);
    this.socket.close(1000);
  }
}

async function kartState(canvas: Locator) {
  return canvas.evaluate(
    (element) =>
      new Promise<KartDebugState>((resolve) => {
        element.dispatchEvent(
          new CustomEvent("getKartDebugState", {
            detail: { respond: resolve },
          }),
        );
      }),
  );
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

async function audioState(canvas: Locator) {
  return canvas.evaluate(
    (element) =>
      new Promise<RaceAudioDebugState | null>((resolve) => {
        element.dispatchEvent(
          new CustomEvent("getAudioDebugState", {
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

// The room checks that a kart could have got to each gate at 30 m/s, and
// Falls View Park's start and first checkpoint are 65 m apart.
const TRAVEL_MS = 2_500;
// A crossing step moves 0.2 m, under 30 m/s.
const CROSSING_METRES = 0.1;

/**
 * Waits as long as driving there would take, moves the kart to just before
 * a gate, and steps: the room hears it there at the time it arrived. Then
 * steps once across, so the race and the room count it.
 */
async function cross(
  canvas: Locator,
  { forward, position }: { forward: Vector; position: Vector },
) {
  await canvas.page().waitForTimeout(TRAVEL_MS);
  const along = (sign: number) => ({
    x: position.x + sign * CROSSING_METRES * forward.x,
    y: position.y + sign * CROSSING_METRES * forward.y,
    z: position.z + sign * CROSSING_METRES * forward.z,
  });
  await step(canvas, {
    currentPosition: along(-1),
    previousPosition: along(-1),
  });
  const { state } = await step(canvas, {
    currentPosition: along(1),
    previousPosition: along(-1),
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
    const guestRoom = await cuttableRoom(guest);
    await joinAs(host, code, "ada");
    await expect(
      host.getByRole("heading", { name: "Private room" }),
    ).toBeVisible();
    await joinAs(guest, code, null);
    // The host chooses the course; the guest sees it.
    await expect(
      host
        .getByRole("group", { name: "Choose the course" })
        .getByRole("button", { name: new RegExp(COURSE.name) }),
    ).toHaveAttribute("aria-pressed", "true");
    await expect(
      guest
        .getByRole("group", { name: "Course · chosen by the host" })
        .getByText(COURSE.name),
    ).toBeVisible();
    await expect(
      guest.getByRole("button", { name: new RegExp(COURSE.name) }),
    ).toHaveCount(0);
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
    // The host places the guest's voice, a few metres off on the grid.
    // (Its pitch and level follow drawn speed, which teleports here don't
    // give: remote-motor-voice.spec.ts covers those.)
    const placed = (await audioState(canvases[0]))?.opponents.p2;
    expect(placed?.mix.gain).toBeGreaterThan(0.3);

    // The guest's connection drops for a lap gate: its kart drives on, and
    // the room counts the gate once the page is back.
    const [checkpoint] = COURSE.checkpoints;
    expect(await cross(canvases[1], checkpoint)).toBe("checkpoint");
    guestRoom.cut();
    const reconnecting = guest.getByText("Reconnecting…").first();
    await expect(reconnecting).toBeVisible();
    expect(await cross(canvases[1], START_TARGET)).toBe("lap");
    guestRoom.restore();
    await expect(reconnecting).toBeHidden({ timeout: 15_000 });
    // The guest finishes first; both see the same places.
    expect(await cross(canvases[1], checkpoint)).toBe("checkpoint");
    expect(await cross(canvases[1], START_TARGET)).toBe("finished");
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

test("a kart is pushed at once by another, and a touch it missed once", async ({
  browser,
}) => {
  test.setTimeout(240_000);
  const code = createRoomCode();
  const context = await browser.newContext({
    viewport: { width: 480, height: 320 },
  });
  const page = await context.newPage();
  let rival: Rival | null = null;
  try {
    const room = await injectableRoom(page);
    await joinAs(page, code, "ada");
    await expect(
      page.getByRole("heading", { name: "Private room" }),
    ).toBeVisible();
    rival = await Rival.join(code);
    rival.send({ type: "choose_kart", kartId: KART.kartId });
    await page.getByRole("button", { name: /Balanced Kart/ }).click();
    await page.getByRole("button", { name: "Start race" }).click();
    const loading = (await rival.next(
      (message) => message.type === "room" && message.phase === "loading",
    )) as Extract<RoomServerMessage, { type: "room" }>;
    const raceId = loading.race!.id;
    rival.send({ type: "loaded", raceId });

    const canvas = page.getByTestId("solo-time-trial-canvas");
    await expect(canvas).toHaveAttribute("data-scene-ready", "true", {
      timeout: 120_000,
    });
    await expect
      .poll(
        async () => {
          const { state } = await raceState(canvas);
          if (state === "paused") {
            await page.getByRole("button", { name: "Resume" }).click();
          }
          return state;
        },
        { timeout: 60_000 },
      )
      .toBe("racing");
    // Undrawn, the page steps its physics in time, as a phone would.
    await canvas.evaluate((element) =>
      element.dispatchEvent(
        new CustomEvent("setRenderingSuspended", {
          detail: { suspended: true },
        }),
      ),
    );
    const racing = (await rival.next(
      (message) =>
        message.type === "room" && message.race?.racingAt != null,
    )) as Extract<RoomServerMessage, { type: "room" }>;
    const racingAt = racing.race!.racingAt!;

    // The rival waits a metre behind the page's kart...
    const kart = await kartState(canvas);
    const level = Math.hypot(kart.forward.x, kart.forward.z);
    const ahead = { x: kart.forward.x / level, z: kart.forward.z / level };
    const start = { x: kart.x - ahead.x, y: kart.y, z: kart.z - ahead.z };
    const { w, x, y, z } = kart.rotation;
    const send = (position: Vector, speed: number) =>
      rival!.send({
        type: "state",
        t: rival!.raceMicroseconds(racingAt),
        p: [position.x, position.y, position.z].map(
          (value) => Math.round(value * 1_000) / 1_000,
        ),
        q: [x, y, z, w].map((value) => Math.round(value * 1e4) / 1e4),
        v: [ahead.x * speed, 0, ahead.z * speed].map(
          (value) => Math.round(value * 100) / 100,
        ),
        w: [0, 0, 0],
        s: 0,
        r: false,
      });
    for (let index = 0; index < 15; index += 1) {
      send(start, 0);
      await page.waitForTimeout(33);
    }

    // ...when the room tells the page, once it's in touch, of a touch it
    // never had: pushed once, however often it hears it.
    await expect
      .poll(async () => (await raceState(canvas)).roomContacts?.ownSeeThrough)
      .toBe(false);
    const missed = {
      type: "contact" as const,
      id: 999,
      t: rival.raceMicroseconds(racingAt) - 20_000,
      with: "p2",
      n: [-ahead.x, 0, -ahead.z] as [number, number, number],
      p: [kart.x, kart.y, kart.z] as [number, number, number],
      c: 0.5,
      j: [0, 0.2, 0] as [number, number, number],
      k: [0, 0, 0] as [number, number, number],
    };
    room.send(missed);
    room.send(missed);
    await expect
      .poll(async () => (await raceState(canvas)).roomContacts?.fills)
      .toBe(1);

    // The rival runs into it from behind at 1.5 m/s, for 1.5 m.
    const driveMs = 1_000;
    const startedAt = Date.now();
    let reached = start;
    for (let elapsed = 0; elapsed < driveMs; elapsed = Date.now() - startedAt) {
      const metres = 1.5 * (elapsed / 1_000);
      reached = {
        x: start.x + ahead.x * metres,
        y: start.y,
        z: start.z + ahead.z * metres,
      };
      send(reached, 1.5);
      await page.waitForTimeout(33);
    }
    for (let index = 0; index < 15; index += 1) {
      send(reached, 0);
      await page.waitForTimeout(33);
    }

    // The page answered the touch itself, so the room's record of it
    // pushed nothing more; and its kart was pushed on ahead of the rival,
    // not passed through.
    const record = await rival.next((message) => message.type === "contact");
    expect(record).toMatchObject({ type: "contact", with: "p1" });
    // The page's copy of the record has had time to arrive too.
    await page.waitForTimeout(500);
    const { roomContacts } = await raceState(canvas);
    expect(roomContacts?.touchingSteps).toBeGreaterThan(0);
    expect(roomContacts?.fills).toBe(1);
    const pushed = await kartState(canvas);
    const gap =
      (pushed.x - reached.x) * ahead.x + (pushed.z - reached.z) * ahead.z;
    const length = 2 * roomKartContact(KART_SNAPSHOT).box[5];
    expect(gap).toBeGreaterThan(length - 0.03);
  } finally {
    rival?.leave();
    await context.close();
  }
});

/**
 * A page racing a room against a Node rival, from the lobby to racing, its
 * scene drawn so its opponents are shown. Returns what the door tests need.
 */
async function racingAgainstRival(page: Page, code: string) {
  await joinAs(page, code, "ada");
  await expect(page.getByRole("heading", { name: "Private room" })).toBeVisible();
  const rival = await Rival.join(code);
  rival.send({ type: "choose_kart", kartId: KART.kartId });
  await page.getByRole("button", { name: /Balanced Kart/ }).click();
  await page.getByRole("button", { name: "Start race" }).click();
  const loading = (await rival.next(
    (message) => message.type === "room" && message.phase === "loading",
  )) as Extract<RoomServerMessage, { type: "room" }>;
  rival.send({ type: "loaded", raceId: loading.race!.id });
  const canvas = page.getByTestId("solo-time-trial-canvas");
  await expect(canvas).toHaveAttribute("data-scene-ready", "true", {
    timeout: 120_000,
  });
  await expect
    .poll(
      async () => {
        const { state } = await raceState(canvas);
        if (state === "paused") {
          await page.getByRole("button", { name: "Resume" }).click();
        }
        return state;
      },
      { timeout: 60_000 },
    )
    .toBe("racing");
  const racing = (await rival.next(
    (message) => message.type === "room" && message.race?.racingAt != null,
  )) as Extract<RoomServerMessage, { type: "room" }>;
  return { canvas, racingAt: racing.race!.racingAt!, rival };
}

async function doorState(canvas: Locator, id: string) {
  const doors = await canvas.evaluate(
    (element) =>
      new Promise<CollisionDebugState["courseDoors"]>((resolve) => {
        element.dispatchEvent(
          new CustomEvent("getCollisionDebugState", {
            detail: {
              respond: (state: CollisionDebugState) => resolve(state.courseDoors),
            },
          }),
        );
      }),
  );
  return doors.find((door) => door.id === id)!;
}

const DOOR = COURSE.objects.find(({ id }) => id === "tunnel-door-4")!;
// In the tunnel, 0.6 m out from door 4's latch half, across the ground.
const BY_DOOR = {
  x: DOOR.transform.position.x + 0.6,
  z: DOOR.transform.position.z - 0.25,
};
// The room's 30 m/s check allows the drive from the grid to the door.
const DOOR_TRAVEL_MS =
  (Math.hypot(
    BY_DOOR.x - COURSE.start.position.x,
    BY_DOOR.z - COURSE.start.position.z,
  ) /
    20) *
  1_000;

test("a kart that opens a door tells the room, which keeps the opening", async ({
  browser,
}) => {
  test.setTimeout(240_000);
  const code = createRoomCode();
  const context = await browser.newContext({ viewport: { width: 480, height: 320 } });
  const page = await context.newPage();
  let rival: Rival | null = null;
  try {
    const race = await racingAgainstRival(page, code);
    rival = race.rival;
    const { canvas } = race;
    const { y } = await kartState(canvas);
    const pose = (speed: number) =>
      canvas.evaluate(
        (element, detail) =>
          element.dispatchEvent(new CustomEvent("setKartDebugPose", { detail })),
        {
          pose: {
            linearVelocity: { x: -speed, y: 0, z: 0 },
            position: { x: BY_DOOR.x, y, z: BY_DOOR.z },
            // Facing −X, at the door.
            rotation: { x: 0, y: 90, z: 0 },
          },
        },
      );
    // Paused while it "drives" there, the page sends no states; then the
    // room hears it by the door, at the time it arrived.
    await step(canvas);
    await page.waitForTimeout(DOOR_TRAVEL_MS);
    await pose(0);
    await step(canvas);
    await page.waitForTimeout(100);
    await step(canvas);
    await page.waitForTimeout(100);
    // A square hit at 9 m/s on the latch half breaks the latch.
    await pose(9);
    await canvas.evaluate((element) =>
      element.dispatchEvent(
        new CustomEvent("stepSimulation", { detail: { steps: 120 } }),
      ),
    );
    expect(await doorState(canvas, DOOR.id)).toMatchObject({
      latched: false,
      lampLit: true,
    });
    const opened = (await rival.next(
      (message) => message.type === "room" && (message.race?.doors.length ?? 0) > 0,
    )) as Extract<RoomServerMessage, { type: "room" }>;
    expect(opened.race!.doors).toEqual([
      expect.objectContaining({ door: DOOR.id, by: "p1" }),
    ]);
  } finally {
    rival?.leave();
    await context.close();
  }
});

test("another's opening swings the door once its opener is shown reaching it", async ({
  browser,
}) => {
  test.setTimeout(240_000);
  const code = createRoomCode();
  const context = await browser.newContext({ viewport: { width: 480, height: 320 } });
  const page = await context.newPage();
  let rival: Rival | null = null;
  try {
    const race = await racingAgainstRival(page, code);
    rival = race.rival;
    const { canvas, racingAt } = race;
    const { y } = await kartState(canvas);
    // The rival drives to the door as fast as the room allows...
    await page.waitForTimeout(DOOR_TRAVEL_MS);
    const send = () => {
      const t = rival!.raceMicroseconds(racingAt);
      rival!.send({
        type: "state",
        t,
        p: [BY_DOOR.x, y, BY_DOOR.z].map((value) => Math.round(value * 1_000) / 1_000),
        q: [0, 0.7071, 0, 0.7071],
        v: [0, 0, 0],
        w: [0, 0, 0],
        s: 0,
        r: false,
      });
      return t;
    };
    for (let index = 0; index < 10; index += 1) {
      send();
      await page.waitForTimeout(33);
    }
    expect((await doorState(canvas, DOOR.id)).latched).toBe(true);
    // ...and opens it, waiting there.
    rival.send({ type: "open", door: DOOR.id, t: send(), w: 3 });
    for (let index = 0; index < 45; index += 1) {
      send();
      await page.waitForTimeout(33);
    }
    await expect
      .poll(async () => (await doorState(canvas, DOOR.id)).latched)
      .toBe(false);
    const door = await doorState(canvas, DOOR.id);
    expect(door.lampLit).toBe(true);
    // It swung, as the opener's hit swung it, with its latch's clack.
    expect((await audioState(canvas))?.doors.map(({ kind }) => kind)).toContain(
      "latch",
    );
  } finally {
    rival?.leave();
    await context.close();
  }
});

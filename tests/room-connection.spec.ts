import { expect, test } from "@playwright/test";

import {
  ROOM_PROTOCOL,
  ROOM_RESEND_BATCH,
  type RoomServerMessage,
} from "../src/game/room/room-protocol";
import {
  applyRoomEvent,
  createRoomState,
  roomSnapshot,
  type RoomState,
} from "../src/game/room/room-rules";
import type { RoomToken } from "../src/game/room/room-signing";
import { kartAt, straightRoomCourse } from "./support/room-course";

// The page's room connection, in Node: a fake WebSocket and token route
// stand in for the browser's, so a drop and a reconnect can be timed.

class FakeSocket extends EventTarget {
  static readonly OPEN = 1;
  static sockets: FakeSocket[] = [];
  readyState = 0;
  readonly sent: Array<{ type: string } & Record<string, unknown>> = [];

  constructor(readonly url: string) {
    super();
    FakeSocket.sockets.push(this);
  }

  send(data: string) {
    this.sent.push(JSON.parse(data));
  }

  close() {
    this.readyState = 3;
  }

  open() {
    this.readyState = FakeSocket.OPEN;
    this.dispatchEvent(new Event("open"));
  }

  receive(message: RoomServerMessage) {
    this.dispatchEvent(
      Object.assign(new Event("message"), { data: JSON.stringify(message) }),
    );
  }

  /** The network drops: the page hears an abnormal close. */
  drop() {
    this.readyState = 3;
    this.dispatchEvent(Object.assign(new Event("close"), { code: 1006 }));
  }
}

const globals = globalThis as Record<string, unknown>;
const STUBBED = ["window", "document", "location", "WebSocket", "fetch"];
const saved = new Map(
  STUBBED.filter((key) => key in globals).map((key) => [key, globals[key]]),
);
/** Each spec's connections, closed after it so no timer outlives it. */
const opened: Array<{ close(): void }> = [];

test.beforeEach(() => {
  FakeSocket.sockets = [];
  globals.window = Object.assign(globalThis, {
    location: { search: "" },
  });
  globals.document = Object.assign(new EventTarget(), {
    visibilityState: "visible",
  });
  globals.WebSocket = FakeSocket;
  globals.fetch = async () => ({
    ok: true,
    json: async () => ({ token: "signed" }),
  });
});

test.afterEach(() => {
  for (const connection of opened.splice(0)) connection.close();
  for (const key of STUBBED) {
    if (saved.has(key)) globals[key] = saved.get(key);
    else delete globals[key];
  }
});

const RACE = "00000000-0000-4000-8000-000000000001";

function token(key: string): RoomToken {
  return {
    version: 1,
    protocol: ROOM_PROTOCOL,
    room: "abcdefghjk",
    expiresAt: 1,
    courseId: "falls-view-park",
    courseRevision: 1,
    course: straightRoomCourse(1, [2]),
    physicsVersion: "support-heave-v1",
    karts: [{ id: "kestrel", revision: 1 }],
    player: { key: key.padEnd(43, "x"), username: null, signedIn: false },
  };
}

/** A two-player room's snapshot: loading its race, or racing it. */
function snapshot(racing: boolean) {
  let state: RoomState = createRoomState(token("a"));
  const events = [
    { type: "join", now: 1, token: token("a") },
    { type: "join", now: 1, token: token("b") },
    { type: "choose_kart", now: 1, playerId: "p1", kartId: "kestrel" },
    { type: "choose_kart", now: 1, playerId: "p2", kartId: "kestrel" },
    { type: "start", now: 2, playerId: "p1", raceId: RACE },
    ...(racing
      ? ([
          { type: "loaded", now: 3, playerId: "p1", raceId: RACE },
          { type: "loaded", now: 3, playerId: "p2", raceId: RACE },
        ] as const)
      : []),
  ] as const;
  for (const event of events) state = applyRoomEvent(state, event).state;
  return roomSnapshot(state);
}

const settle = (ms: number) =>
  new Promise((resolve) => setTimeout(resolve, ms));

/** Opens a connection and its first socket, welcomed as p1. */
async function connected(racing: boolean) {
  const { RoomConnection } = await import("../src/game/room/room-connection");
  const connection = new RoomConnection("abcdefghjk", "ws://rooms.test");
  opened.push(connection);
  await connection.open();
  const [socket] = FakeSocket.sockets;
  socket.open();
  socket.receive({ type: "welcome", you: "p1", resume: null });
  socket.receive(snapshot(racing));
  return connection;
}

/** Drops the live socket and waits for the page's reconnect. */
async function reconnect() {
  const before = FakeSocket.sockets.length;
  FakeSocket.sockets.at(-1)!.drop();
  for (let waited = 0; FakeSocket.sockets.length === before; waited += 50) {
    if (waited > 2_000) throw new Error("No reconnect.");
    await settle(50);
  }
  const socket = FakeSocket.sockets.at(-1)!;
  socket.open();
  return socket;
}

test.describe("the page's room connection", () => {
  test("says again that it loaded, after a reconnect", async () => {
    const connection = await connected(false);
    // Sent as the connection drops: it may never arrive.
    connection.send({ type: "loaded", raceId: RACE });
    expect(connection.getView().status).toBe("open");
    const socket = await reconnect();
    expect(connection.getView().status).toBe("reconnecting");
    socket.receive({ type: "welcome", you: "p1", resume: null });
    expect(socket.sent).toContainEqual({ type: "loaded", raceId: RACE });
    expect(connection.getView().status).toBe("open");
    connection.close();
  });

  test("resends the states the room missed, then sends live ones", async () => {
    const connection = await connected(true);
    const state = (t: number) => ({ type: "state" as const, ...kartAt(t, 0) });
    for (let t = 1; t <= 5; t += 1) connection.send(state(t));
    const first = FakeSocket.sockets[0];
    expect(first.sent.filter(({ type }) => type === "state")).toHaveLength(5);

    first.drop();
    // Driving on while away; the room last accepted t = 3.
    for (let t = 6; t <= 30; t += 1) connection.send(state(t));
    const socket = await reconnect();
    // Before the room says what it missed, live states wait.
    connection.send(state(31));
    expect(socket.sent.filter(({ type }) => type.startsWith("state"))).toEqual(
      [],
    );
    socket.receive({ type: "welcome", you: "p1", resume: 3 });
    const batches = socket.sent.filter(({ type }) => type === "states");
    expect(batches.map(({ states }) => (states as Array<{ t: number }>).length))
      .toEqual([ROOM_RESEND_BATCH, 31 - 3 - ROOM_RESEND_BATCH]);
    expect(
      batches.flatMap(({ states }) =>
        (states as Array<{ t: number }>).map(({ t }) => t),
      ),
    ).toEqual(Array.from({ length: 28 }, (_, index) => index + 4));
    connection.send(state(32));
    expect(socket.sent.at(-1)).toMatchObject({ type: "state", t: 32 });
    connection.close();
  });
});

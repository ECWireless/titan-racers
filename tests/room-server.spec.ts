import { randomBytes } from "node:crypto";

import { expect, test } from "@playwright/test";

import {
  createRoomCode,
  parseServerMessage,
  ROOM_CLOSE,
  ROOM_PROTOCOL,
  roomRaceReportSchema,
  type RoomServerMessage,
} from "../src/game/room/room-protocol";
import {
  randomRoomPlayerKey,
  signRoomToken,
  verifyRoomReport,
  type RoomTokenFields,
} from "../src/game/room/room-signing";
import { crossingAt, kartAt, straightRoomCourse } from "./support/room-course";
import {
  freePort,
  type RoomServerReport,
  startRoomServer,
} from "./support/room-server";

// Two real clients against the room server under `wrangler dev`.
test.describe.configure({ mode: "serial" });

let PORT = 0;
const ORIGIN = "http://rooms.test";
const SECRET = randomBytes(32).toString("base64url");

let server: Awaited<ReturnType<typeof startRoomServer>> | undefined;
let reports: RoomServerReport[] = [];

test.beforeAll(async () => {
  test.setTimeout(90_000);
  PORT = await freePort();
  server = await startRoomServer({ origins: [ORIGIN], port: PORT, secret: SECRET });
  reports = server.reports;
});

test.afterAll(async () => {
  await server?.stop();
});

function tokenFields(
  room: string,
  player: Partial<RoomTokenFields["player"]> = {},
  overrides: Partial<RoomTokenFields> = {},
): RoomTokenFields {
  return {
    protocol: ROOM_PROTOCOL,
    room,
    courseId: "falls-view-park",
    courseRevision: 11,
    // One lap past a checkpoint at 2 m: two gates.
    course: straightRoomCourse(1, [2]),
    physicsVersion: "support-heave-v1",
    karts: [{ id: "kestrel", revision: 3 }],
    player: {
      key: randomRoomPlayerKey(),
      username: null,
      signedIn: false,
      ...player,
    },
    ...overrides,
  };
}

class Client {
  readonly messages: RoomServerMessage[] = [];
  readonly closed: Promise<number>;
  private waiters: Array<() => void> = [];

  constructor(readonly socket: WebSocket) {
    socket.addEventListener("message", (event) => {
      const message = parseServerMessage(event.data);
      expect(message, String(event.data)).not.toBeNull();
      this.messages.push(message!);
      for (const wake of this.waiters.splice(0)) wake();
    });
    this.closed = new Promise((resolve) =>
      socket.addEventListener("close", (event) => resolve(event.code)),
    );
  }

  static async join(token: string, origin = ORIGIN) {
    const url = `ws://127.0.0.1:${PORT}/v1/rooms/${JSON.parse(
      Buffer.from(token.split(".")[0], "base64url").toString(),
    ).room}?token=${token}`;
    // Node's WebSocket (undici) takes headers, so it can send an Origin.
    const socket = new WebSocket(url, {
      headers: { origin },
    } as unknown as string[]);
    return new Client(socket);
  }

  static async signed(fields: RoomTokenFields, now = Date.now()) {
    return Client.join(await signRoomToken(SECRET, fields, now));
  }

  send(message: unknown) {
    this.socket.send(JSON.stringify(message));
  }

  /** The first message, from the start, that matches. */
  async next<T extends RoomServerMessage>(
    match: (message: RoomServerMessage) => message is T,
    timeout?: number,
  ): Promise<T>;
  async next(
    match: (message: RoomServerMessage) => boolean,
    timeout?: number,
  ): Promise<RoomServerMessage>;
  async next(
    match: (message: RoomServerMessage) => boolean,
    timeout = 10_000,
  ) {
    const until = Date.now() + timeout;
    for (;;) {
      const found = this.messages.find(match);
      if (found) return found;
      if (Date.now() > until) {
        throw new Error(`No match in ${JSON.stringify(this.messages)}`);
      }
      await new Promise<void>((resolve) => {
        this.waiters.push(resolve);
        setTimeout(resolve, 200);
      });
    }
  }
}

type Snapshot = Extract<RoomServerMessage, { type: "room" }>;
const isRoom = (message: RoomServerMessage): message is Snapshot =>
  message.type === "room";

test("two players race a room from lobby to results", async () => {
  test.setTimeout(60_000);
  const room = createRoomCode();
  const ada = await Client.signed(
    tokenFields(room, { username: "ada", signedIn: true }),
  );
  await ada.next((message) => message.type === "welcome");
  const guest = await Client.signed(tokenFields(room));
  expect(
    await guest.next((message) => message.type === "welcome"),
  ).toEqual({ type: "welcome", you: "p2", resume: null });
  await ada.next((m) => isRoom(m) && m.players.length === 2);

  const sentAt = Date.now();
  ada.send({ type: "ping", t: sentAt });
  const pong = await ada.next((message) => message.type === "pong");
  expect(pong).toMatchObject({ t: sentAt });

  ada.send({ type: "choose_kart", kartId: "kestrel" });
  guest.send({ type: "choose_kart", kartId: "kestrel" });
  await ada.next(
    (m) => isRoom(m) && m.players.every(({ ready }) => ready),
  );
  // Only the host may start.
  guest.send({ type: "start" });
  ada.send({ type: "start" });
  const loading = await guest.next(
    (m): m is Snapshot => isRoom(m) && m.phase === "loading",
  );
  expect(loading.hostId).toBe("p1");
  const raceId = loading.race!.id;

  ada.send({ type: "loaded", raceId });
  guest.send({ type: "loaded", raceId });
  const countdown = await guest.next(
    (m): m is Snapshot => isRoom(m) && m.race?.racingAt != null,
  );
  const racingAt = countdown.race!.racingAt!;
  expect(racingAt - Date.now()).toBeGreaterThan(2_000);

  // Each state is checked before it is relayed: the first on its grid
  // slot, and none again at the same race time.
  const grid = kartAt(0, -1, { p: [-1, 0.2, -0.5] });
  ada.send({ type: "state", ...kartAt(0, 5) });
  ada.send({ type: "state", ...grid });
  ada.send({ type: "state", ...grid });
  expect(await guest.next((message) => message.type === "state")).toEqual({
    type: "state",
    from: "p1",
    ...grid,
  });

  await new Promise((resolve) =>
    setTimeout(resolve, racingAt - Date.now() + 600),
  );
  for (const [client, lead] of [
    [ada, 0],
    [guest, 300],
  ] as const) {
    await new Promise((resolve) => setTimeout(resolve, lead));
    const t = (Date.now() - racingAt - 50) * 1_000;
    client.send({ type: "state", ...crossingAt(t - 100_000, 2) });
    client.send({ type: "state", ...crossingAt(t, 0) });
  }
  const done = await ada.next(
    (m): m is Snapshot => isRoom(m) && m.lastRace !== null,
  );
  expect(done.phase).toBe("lobby");
  expect(done.lastRace?.endReason).toBe("all_finished");
  expect(done.lastRace?.entries.map(({ name }) => name)).toEqual([
    "@ada",
    "Guest 1",
  ]);
  // Ada's grid state and two crossings; her refused states went nowhere.
  expect(
    guest.messages.filter((m) => m.type === "state").map((m) => m.t),
  ).toHaveLength(3);

  await expect.poll(() => reports.length, { timeout: 10_000 }).toBe(1);
  const [{ signature, body }] = reports;
  expect(await verifyRoomReport(SECRET, signature, body)).toBe(true);
  const report = roomRaceReportSchema.parse(JSON.parse(body));
  expect(report).toMatchObject({ raceId, roomCode: room, courseRevision: 11 });
  expect(report.entries.map(({ signedIn }) => signedIn)).toEqual([
    true,
    false,
  ]);

  // Leaving frees the seat at once.
  ada.socket.close(1000);
  const after = await guest.next(
    (m): m is Snapshot => isRoom(m) && m.players.length === 1,
  );
  expect(after.hostId).toBe("p2");
  guest.socket.close(1000);
});

test("holds a dropped seat, resumes its race, and drops the silent", async () => {
  test.setTimeout(60_000);
  const room = createRoomCode();
  const key = randomRoomPlayerKey();
  const adaFields = tokenFields(room, { key, username: "ada", signedIn: true });
  const ada = await Client.signed(adaFields);
  await ada.next((message) => message.type === "welcome");
  const guest = await Client.signed(tokenFields(room));
  await guest.next((message) => message.type === "welcome");
  // The guest pings as a racing page does, until it falls silent below.
  const guestPings = setInterval(
    () => guest.send({ type: "ping", t: Date.now() }),
    500,
  );
  for (const client of [ada, guest]) {
    client.send({ type: "choose_kart", kartId: "kestrel" });
  }
  await ada.next((m) => isRoom(m) && m.players.every(({ ready }) => ready));
  ada.send({ type: "start" });
  const loading = await guest.next(
    (m): m is Snapshot => isRoom(m) && m.phase === "loading",
  );
  const raceId = loading.race!.id;
  for (const client of [ada, guest]) client.send({ type: "loaded", raceId });
  const racingAt = (
    await guest.next(
      (m): m is Snapshot => isRoom(m) && m.race?.racingAt != null,
    )
  ).race!.racingAt!;
  await new Promise((resolve) =>
    setTimeout(resolve, racingAt - Date.now() + 600),
  );
  const t = (Date.now() - racingAt - 50) * 1_000;
  ada.send({ type: "state", ...crossingAt(t, 2) });
  await guest.next((m) => m.type === "state" && m.t === t);

  // A dropped connection holds its seat; the host passes on meanwhile.
  ada.socket.close(4100);
  const away = await guest.next(
    (m): m is Snapshot =>
      isRoom(m) && m.players.some(({ connected }) => !connected),
  );
  expect(away.hostId).toBe("p2");
  expect(away.race?.entrants).toHaveLength(2);

  // Back, it hears where the room left off and resends the rest.
  const back = await Client.signed(adaFields);
  expect(await back.next((m) => m.type === "welcome")).toEqual({
    type: "welcome",
    you: "p1",
    resume: t,
  });
  // Back, it pings as a racing page does.
  const pings = setInterval(
    () => back.send({ type: "ping", t: Date.now() }),
    500,
  );
  // Away, it reset every 20 states (back to the checkpoint at 2 m) for
  // 25 batches, then crossed the line. Every batch stores a reset, more
  // than the live allowance's 20, which resends don't spend; and others
  // hear only what is recent enough to draw.
  await new Promise((resolve) => setTimeout(resolve, 5_500));
  for (let batch = 0; batch < 25; batch += 1) {
    back.send({
      type: "states",
      states: Array.from({ length: 20 }, (_, index) =>
        kartAt(t + 50_000 + (batch * 20 + index) * 9_000, 1, {
          p: [1, 0.5, 0],
          r: index === 0,
        }),
      ),
    });
  }
  const finishT = (Date.now() - racingAt - 50) * 1_000;
  back.send({ type: "states", states: [crossingAt(finishT, 0)] });
  const finished = await guest.next(
    (m): m is Snapshot =>
      isRoom(m) && m.race?.entrants[0].finishMicroseconds != null,
  );
  expect(finished.race?.entrants[0]).toMatchObject({
    id: "p1",
    finishMicroseconds: finishT,
  });
  expect(finished.hostId).toBe("p1");
  await guest.next((m) => m.type === "state" && m.t === finishT);
  expect(
    guest.messages.filter((m) => m.type === "state" && m.r),
  ).toHaveLength(0);

  // In a race, a connection silent for 5 s is dropped, holding its seat.
  clearInterval(guestPings);
  try {
    expect(await guest.closed).toBe(ROOM_CLOSE.silent);
    const silent = await back.next(
      (m): m is Snapshot =>
        isRoom(m) &&
        m.players.some(({ id, connected }) => id === "p2" && !connected),
      15_000,
    );
    expect(silent.race?.entrants[1]).toMatchObject({ id: "p2", left: false });
  } finally {
    clearInterval(pings);
  }
  back.socket.close(1000);
});

test("drops a silent lobby connection, even across hibernation", async () => {
  // Past the room's 10 s idle hibernation and its 30 s silence.
  test.setTimeout(70_000);
  const room = createRoomCode();
  const host = await Client.signed(tokenFields(room));
  await host.next((message) => message.type === "welcome");
  const guest = await Client.signed(tokenFields(room));
  await guest.next((message) => message.type === "welcome");
  // The guest pings as a lobby page does, rarely enough for the room to
  // sleep between; the host has vanished without a close.
  const pings = setInterval(
    () => guest.send({ type: "ping", t: Date.now() }),
    15_000,
  );
  try {
    expect(await host.closed).toBe(ROOM_CLOSE.silent);
    const away = await guest.next(
      (m): m is Snapshot =>
        isRoom(m) && m.players.some(({ connected }) => !connected),
      5_000,
    );
    expect(away.hostId).toBe("p2");
  } finally {
    clearInterval(pings);
  }
  guest.socket.close(1000);
});

test("refuses bad joins with a reason the page can show", async () => {
  const room = createRoomCode();
  const expired = await Client.signed(tokenFields(room), Date.now() - 120_000);
  expect(await expired.closed).toBe(ROOM_CLOSE.token);
  const elsewhere = await Client.join(
    await signRoomToken(SECRET, tokenFields(createRoomCode())),
  );
  const url = new URL(elsewhere.socket.url);
  elsewhere.socket.close();
  const mismatched = new Client(
    new WebSocket(
      `ws://127.0.0.1:${PORT}/v1/rooms/${room}${url.search}`,
      { headers: { origin: ORIGIN } } as unknown as string[],
    ),
  );
  expect(await mismatched.closed).toBe(ROOM_CLOSE.token);
  const newer = await Client.signed(
    tokenFields(room, {}, { protocol: ROOM_PROTOCOL + 1 }),
  );
  expect(await newer.closed).toBe(ROOM_CLOSE.version);
  const foreign = await Client.join(
    await signRoomToken(SECRET, tokenFields(room)),
    "https://elsewhere.example",
  );
  expect(await foreign.closed).toBe(1006);
});

test("fills at four, gives a new tab the seat, and drops bad messages", async () => {
  const room = createRoomCode();
  const key = randomRoomPlayerKey();
  const first = await Client.signed(
    tokenFields(room, { key, username: "ada", signedIn: true }),
  );
  await first.next((message) => message.type === "welcome");
  const others = await Promise.all(
    [1, 2, 3].map(() => Client.signed(tokenFields(room))),
  );
  for (const other of others) {
    await other.next((message) => message.type === "welcome");
  }
  const fifth = await Client.signed(tokenFields(room));
  expect(await fifth.closed).toBe(ROOM_CLOSE.full);

  const tab = await Client.signed(
    tokenFields(room, { key, username: "ada", signedIn: true }),
  );
  expect(await tab.next((message) => message.type === "welcome")).toEqual({
    type: "welcome",
    you: "p1",
    resume: null,
  });
  expect(await first.closed).toBe(ROOM_CLOSE.replaced);
  expect(
    (await tab.next((m): m is Snapshot => isRoom(m))).players,
  ).toHaveLength(4);

  others[0].socket.send("not json");
  expect(await others[0].closed).toBe(ROOM_CLOSE.protocol);
  await tab.next((m) => isRoom(m) && m.players.length === 3);
  // The new tab leaving frees the seat.
  tab.socket.close(1000);
  const left = await others[1].next(
    (m): m is Snapshot =>
      isRoom(m) &&
      m.players.length === 2 &&
      !m.players.some(({ id }) => id === "p1"),
  );
  // Seats are handed out in join order, and these three joined at once.
  const seats = await Promise.all(
    others.slice(1).map(async (client) => {
      const welcome = await client.next((m) => m.type === "welcome");
      return welcome.type === "welcome" ? Number(welcome.you.slice(1)) : 0;
    }),
  );
  expect(left.hostId).toBe(`p${Math.min(...seats)}`);
  for (const client of others.slice(1)) client.socket.close();
});

test("closes a socket that floods the room", async () => {
  const room = createRoomCode();
  const host = await Client.signed(tokenFields(room));
  await host.next((message) => message.type === "welcome");
  const flooder = await Client.signed(tokenFields(room));
  await flooder.next((message) => message.type === "welcome");
  for (let index = 0; index < 80; index += 1) {
    flooder.send({ type: "start" });
  }
  expect(await flooder.closed).toBe(ROOM_CLOSE.protocol);
  await host.next((m) => isRoom(m) && m.players.length === 1);
  host.socket.close();
});

import { expect, test } from "@playwright/test";

import {
  createRoomCode,
  isRoomCode,
  parseClientMessage,
  parseServerMessage,
  ROOM_FINISH_GRACE_MS,
  ROOM_LOAD_MS,
  ROOM_PROTOCOL,
  ROOM_RACE_LIMIT_MS,
  ROOM_START_DELAY_MS,
  roomRaceReportSchema,
  roomSnapshotSchema,
} from "../src/game/room/room-protocol";
import {
  applyRoomEvent,
  canRelayState,
  createRoomState,
  hostId,
  nextRoomDeadline,
  roomSnapshot,
  type RoomEvent,
  type RoomOutcome,
  type RoomState,
} from "../src/game/room/room-rules";
import type { RoomToken } from "../src/game/room/room-signing";

const RACE = "00000000-0000-4000-8000-000000000001";
const NEXT_RACE = "00000000-0000-4000-8000-000000000002";
const GATES = 6;

function token(
  key: string,
  player: Partial<RoomToken["player"]> = {},
  overrides: Partial<RoomToken> = {},
): RoomToken {
  return {
    version: 1,
    protocol: ROOM_PROTOCOL,
    room: "abcdefghjk",
    expiresAt: 1,
    courseId: "falls-view-park",
    courseRevision: 11,
    gateCount: GATES,
    physicsVersion: "support-heave-v1",
    karts: [
      { id: "kestrel", revision: 3 },
      { id: "mule", revision: 2 },
    ],
    player: {
      key: key.padEnd(43, "x"),
      username: null,
      signedIn: false,
      ...player,
    },
    ...overrides,
  };
}

/** Applies events in order, returning the last outcome. */
function run(state: RoomState, ...events: RoomEvent[]): RoomOutcome {
  let outcome: RoomOutcome = { state, changed: false };
  for (const event of events) outcome = applyRoomEvent(outcome.state, event);
  return outcome;
}

/** A room with players p1..pN joined and each kart chosen. */
function lobby(count: number, now = 1_000) {
  let state = createRoomState(token("a"));
  for (let index = 0; index < count; index += 1) {
    state = run(
      state,
      { type: "join", now, token: token(`k${index}`) },
      {
        type: "choose_kart",
        now,
        playerId: `p${index + 1}`,
        kartId: "kestrel",
      },
    ).state;
  }
  return state;
}

/** A started race with every entrant loaded, at its racing time. */
function racing(count: number) {
  let state = run(lobby(count), {
    type: "start",
    now: 2_000,
    playerId: "p1",
    raceId: RACE,
  }).state;
  for (let index = 1; index <= count; index += 1) {
    state = run(state, {
      type: "loaded",
      now: 3_000,
      playerId: `p${index}`,
      raceId: RACE,
    }).state;
  }
  return state;
}

const RACING_AT = 3_000 + ROOM_START_DELAY_MS;

function passGates(state: RoomState, playerId: string, upTo: number, at: number) {
  for (let gates = 1; gates <= upTo; gates += 1) {
    state = run(state, {
      type: "gate",
      now: at + gates,
      playerId,
      raceId: RACE,
      gates,
    }).state;
  }
  return state;
}

function finishAt(state: RoomState, playerId: string, now: number) {
  return run(passGates(state, playerId, GATES - 1, now - 100), {
    type: "finish",
    now,
    playerId,
    raceId: RACE,
    timeMicroseconds: (now - RACING_AT) * 1_000 - 50_000,
  });
}

test.describe("room joining", () => {
  test("names players, makes the first host, and fills at four", () => {
    let state = createRoomState(token("a"));
    const joins = [
      token("a", { username: "ada", signedIn: true }),
      token("b"),
      token("c", { signedIn: true }),
      token("d"),
    ].map((joining) => {
      const outcome = run(state, { type: "join", now: 1, token: joining });
      state = outcome.state;
      return outcome.joined;
    });
    expect(joins).toEqual([
      { playerId: "p1", replaced: false },
      { playerId: "p2", replaced: false },
      { playerId: "p3", replaced: false },
      { playerId: "p4", replaced: false },
    ]);
    expect(state.players.map(({ name }) => name)).toEqual([
      "@ada",
      "Guest 1",
      "Guest 2",
      "Guest 3",
    ]);
    expect(hostId(state)).toBe("p1");

    const full = run(state, { type: "join", now: 1, token: token("e") });
    expect(full.refused).toBe("full");
    expect(full.state.players).toHaveLength(4);

    const again = run(state, {
      type: "join",
      now: 1,
      token: token("a", { username: "ada", signedIn: true }),
    });
    expect(again.joined).toEqual({ playerId: "p1", replaced: true });
    expect(again.state.players).toHaveLength(4);
  });

  test("refuses another protocol or physics version", () => {
    const state = createRoomState(token("a"));
    for (const overrides of [
      { protocol: ROOM_PROTOCOL + 1 },
      { physicsVersion: "older-physics" },
      { courseId: "another-course" },
    ]) {
      expect(
        run(state, { type: "join", now: 1, token: token("b", {}, overrides) })
          .refused,
      ).toBe("version");
    }
  });

  test("passes the host on and never mutates the state it was given", () => {
    const state = lobby(3);
    const before = structuredClone(state);
    const outcome = run(state, { type: "leave", now: 5, playerId: "p1" });
    expect(hostId(outcome.state)).toBe("p2");
    expect(state).toEqual(before);
  });
});

test.describe("room start", () => {
  test("choosing a roster kart marks a player ready", () => {
    let state = run(lobby(0), { type: "join", now: 1, token: token("a") }).state;
    const unknown = run(state, {
      type: "choose_kart",
      now: 1,
      playerId: "p1",
      kartId: "community-kart",
    });
    expect(unknown.changed).toBe(false);
    state = run(state, {
      type: "choose_kart",
      now: 1,
      playerId: "p1",
      kartId: "mule",
    }).state;
    expect(state.players[0]).toMatchObject({ kartId: "mule", ready: true });
  });

  test("only the host starts, with at least two ready", () => {
    const one = lobby(1);
    expect(
      run(one, { type: "start", now: 2, playerId: "p1", raceId: RACE }).state
        .race,
    ).toBeNull();

    let state = run(lobby(2), { type: "join", now: 1, token: token("late") })
      .state;
    expect(
      run(state, { type: "start", now: 2, playerId: "p2", raceId: RACE }).state
        .race,
    ).toBeNull();
    state = run(state, {
      type: "start",
      now: 2_000,
      playerId: "p1",
      raceId: RACE,
    }).state;
    expect(state.race?.entrants.map(({ id, slot }) => [id, slot])).toEqual([
      ["p1", 0],
      ["p2", 1],
    ]);
    expect(state.race?.entrants[0].kartRevision).toBe(3);
    expect(nextRoomDeadline(state)).toBe(2_000 + ROOM_LOAD_MS);
    expect(roomSnapshot(state).phase).toBe("loading");

    // A player who wasn't ready may pick a kart for the next race.
    const waiting = run(state, {
      type: "choose_kart",
      now: 2_100,
      playerId: "p3",
      kartId: "mule",
    });
    expect(waiting.state.players[2].ready).toBe(true);
    const entrant = run(state, {
      type: "choose_kart",
      now: 2_100,
      playerId: "p1",
      kartId: "mule",
    });
    expect(entrant.changed).toBe(false);
  });

  test("racing starts a fixed delay after the last entrant loads", () => {
    const state = racing(2);
    expect(state.race?.racingAt).toBe(RACING_AT);
    expect(roomSnapshot(state).phase).toBe("racing");
    expect(nextRoomDeadline(state)).toBe(RACING_AT + ROOM_RACE_LIMIT_MS);
    expect(canRelayState(state, "p1")).toBe(true);
  });

  test("entrants still loading at the deadline sit the race out", () => {
    let state = run(lobby(3), {
      type: "start",
      now: 2_000,
      playerId: "p1",
      raceId: RACE,
    }).state;
    for (const playerId of ["p1", "p2"]) {
      state = run(state, {
        type: "loaded",
        now: 2_500,
        playerId,
        raceId: RACE,
      }).state;
    }
    expect(state.race?.racingAt).toBeNull();
    const deadline = 2_000 + ROOM_LOAD_MS;
    state = run(state, { type: "tick", now: deadline }).state;
    expect(state.race?.entrants.map(({ id }) => id)).toEqual(["p1", "p2"]);
    expect(state.race?.racingAt).toBe(deadline + ROOM_START_DELAY_MS);
    expect(state.players[2].ready).toBe(false);
  });

  test("a race with fewer than two loaded is called off", () => {
    let state = run(lobby(2), {
      type: "start",
      now: 2_000,
      playerId: "p1",
      raceId: RACE,
    }).state;
    state = run(
      state,
      { type: "loaded", now: 2_500, playerId: "p1", raceId: RACE },
      { type: "leave", now: 2_600, playerId: "p2" },
    ).state;
    expect(state.race).toBeNull();
    expect(state.lastRace).toBeNull();
    expect(state.players[0].ready).toBe(true);
  });
});

test.describe("room racing", () => {
  test("ignores gates before racing and out of order", () => {
    let state = racing(2);
    const early = run(state, {
      type: "gate",
      now: RACING_AT - 1,
      playerId: "p1",
      raceId: RACE,
      gates: 1,
    });
    expect(early.changed).toBe(false);
    const skipped = run(state, {
      type: "gate",
      now: RACING_AT + 10,
      playerId: "p1",
      raceId: RACE,
      gates: 2,
    });
    expect(skipped.changed).toBe(false);
    const stale = run(state, {
      type: "gate",
      now: RACING_AT + 10,
      playerId: "p1",
      raceId: NEXT_RACE,
      gates: 1,
    });
    expect(stale.changed).toBe(false);
    state = passGates(state, "p2", 2, RACING_AT + 10);
    expect(roomSnapshot(state).race?.entrants.map(({ id }) => id)).toEqual([
      "p2",
      "p1",
    ]);
  });

  test("a finish needs every gate before it", () => {
    const state = passGates(racing(2), "p1", GATES - 2, RACING_AT + 10);
    const outcome = run(state, {
      type: "finish",
      now: RACING_AT + 60_000,
      playerId: "p1",
      raceId: RACE,
      timeMicroseconds: 59_950_000,
    });
    expect(outcome.changed).toBe(false);
  });

  test("keeps a finish time near the server's and otherwise uses its own", () => {
    const now = RACING_AT + 60_000;
    const base = passGates(racing(3), "p1", GATES - 1, RACING_AT + 10);
    const finishWith = (timeMicroseconds: number) =>
      run(base, {
        type: "finish",
        now,
        playerId: "p1",
        raceId: RACE,
        timeMicroseconds,
      }).state.race?.entrants.find(({ id }) => id === "p1")
        ?.finishMicroseconds;
    expect(finishWith(59_900_000)).toBe(59_900_000);
    expect(finishWith(58_000_000)).toBe(58_000_000);
    expect(finishWith(57_000_000)).toBe(60_000_000);
    expect(finishWith(60_300_000)).toBe(60_000_000);
  });

  test("ends when everyone still racing has finished", () => {
    let state = finishAt(racing(2), "p2", RACING_AT + 60_000).state;
    expect(nextRoomDeadline(state)).toBe(
      RACING_AT + 60_000 + ROOM_FINISH_GRACE_MS,
    );
    expect(roomSnapshot(state).race?.endsBy).toBe(
      RACING_AT + 60_000 + ROOM_FINISH_GRACE_MS,
    );
    const outcome = finishAt(state, "p1", RACING_AT + 61_000);
    state = outcome.state;
    expect(state.race).toBeNull();
    expect(state.lastRace).toEqual({
      id: RACE,
      endReason: "all_finished",
      entries: [
        {
          place: 1,
          id: "p2",
          name: "Guest 2",
          kartId: "kestrel",
          timeMicroseconds: 59_950_000,
        },
        {
          place: 2,
          id: "p1",
          name: "Guest 1",
          kartId: "kestrel",
          timeMicroseconds: 60_950_000,
        },
      ],
    });
    expect(outcome.report).toMatchObject({
      raceId: RACE,
      roomCode: "abcdefghjk",
      courseRevision: 11,
      racingAt: RACING_AT,
      endedAt: RACING_AT + 61_000,
      endReason: "all_finished",
    });
    expect(roomRaceReportSchema.parse(outcome.report).entries[0]).toEqual({
      place: 1,
      kartId: "kestrel",
      kartRevision: 3,
      timeMicroseconds: 59_950_000,
      signedIn: false,
    });
    // Racers choose again for the next race, and keep their kart.
    expect(state.players.map(({ kartId, ready }) => [kartId, ready])).toEqual(
      [
        ["kestrel", false],
        ["kestrel", false],
      ],
    );
    expect(roomSnapshotSchema.parse(roomSnapshot(state)).phase).toBe("lobby");
    const again = run(state, {
      type: "choose_kart",
      now: RACING_AT + 70_000,
      playerId: "p1",
      kartId: "kestrel",
    });
    expect(again.state.players[0].ready).toBe(true);
  });

  test("ends 30 seconds after the first finisher, with the rest unfinished", () => {
    let state = finishAt(racing(3), "p3", RACING_AT + 60_000).state;
    state = passGates(state, "p1", 2, RACING_AT + 1_000);
    state = run(state, { type: "leave", now: RACING_AT + 65_000, playerId: "p2" })
      .state;
    expect(canRelayState(state, "p2")).toBe(false);
    const early = run(state, {
      type: "tick",
      now: RACING_AT + 60_000 + ROOM_FINISH_GRACE_MS - 1,
    });
    expect(early.report).toBeUndefined();
    const outcome = run(state, {
      type: "tick",
      now: RACING_AT + 60_000 + ROOM_FINISH_GRACE_MS,
    });
    expect(outcome.report?.endReason).toBe("after_first_finish");
    expect(
      outcome.state.lastRace?.entries.map(({ id, timeMicroseconds }) => [
        id,
        timeMicroseconds,
      ]),
    ).toEqual([
      ["p3", 59_950_000],
      ["p1", null],
      ["p2", null],
    ]);
  });

  test("ends at the time limit, or when everyone leaves", () => {
    const limit = run(racing(2), {
      type: "tick",
      now: RACING_AT + ROOM_RACE_LIMIT_MS,
    });
    expect(limit.report?.endReason).toBe("time_limit");

    // A finish close to the limit: the limit still came first.
    const nearLimit = finishAt(
      racing(2),
      "p1",
      RACING_AT + ROOM_RACE_LIMIT_MS - 10_000,
    ).state;
    const lateTick = run(nearLimit, {
      type: "tick",
      now: RACING_AT + ROOM_RACE_LIMIT_MS + ROOM_FINISH_GRACE_MS,
    });
    expect(lateTick.report?.endReason).toBe("time_limit");

    const empty = run(
      racing(2),
      { type: "leave", now: RACING_AT + 5, playerId: "p1" },
      { type: "leave", now: RACING_AT + 6, playerId: "p2" },
    );
    expect(empty.report?.endReason).toBe("everyone_left");
    expect(empty.state.players).toEqual([]);
  });
});

test.describe("room deadlines", () => {
  test("hold even when the event that notices them is late", () => {
    let state = run(lobby(2), {
      type: "start",
      now: 2_000,
      playerId: "p1",
      raceId: RACE,
    }).state;
    state = run(state, {
      type: "loaded",
      now: 2_500,
      playerId: "p1",
      raceId: RACE,
    }).state;
    const lateLoad = run(state, {
      type: "loaded",
      now: 2_000 + ROOM_LOAD_MS + 5_000,
      playerId: "p2",
      raceId: RACE,
    });
    expect(lateLoad.state.race).toBeNull();
    expect(lateLoad.changed).toBe(true);

    const graceEnd = RACING_AT + 60_000 + ROOM_FINISH_GRACE_MS;
    const afterGrace = finishAt(
      finishAt(racing(2), "p1", RACING_AT + 60_000).state,
      "p2",
      graceEnd + 1_000,
    );
    expect(afterGrace.state.lastRace?.endReason).toBe("after_first_finish");
    expect(afterGrace.state.lastRace?.entries[1].timeMicroseconds).toBeNull();

    const pastLimit = run(passGates(racing(2), "p1", GATES - 1, RACING_AT), {
      type: "finish",
      now: RACING_AT + ROOM_RACE_LIMIT_MS + 1_000,
      playerId: "p1",
      raceId: RACE,
      timeMicroseconds: ROOM_RACE_LIMIT_MS * 1_000,
    });
    expect(pastLimit.report?.endReason).toBe("time_limit");
    expect(roomRaceReportSchema.safeParse(pastLimit.report).success).toBe(true);
    expect(
      roomSnapshotSchema.safeParse(roomSnapshot(pastLimit.state)).success,
    ).toBe(true);
  });

  test("a new tab with fewer karts drops a kart it no longer offers", () => {
    let state = run(lobby(2), {
      type: "choose_kart",
      now: 1_500,
      playerId: "p2",
      kartId: "mule",
    }).state;
    state = run(state, {
      type: "join",
      now: 1_600,
      token: { ...token("k1"), karts: [{ id: "kestrel", revision: 4 }] },
    }).state;
    expect(state.players[1]).toMatchObject({ kartId: null, ready: false });
    const outcome = run(state, {
      type: "start",
      now: 2_000,
      playerId: "p1",
      raceId: RACE,
    });
    expect(outcome.state.race).toBeNull();
  });
});

test.describe("room protocol", () => {
  test("room codes are random and well formed", () => {
    const codes = new Set(Array.from({ length: 50 }, createRoomCode));
    expect(codes.size).toBe(50);
    for (const code of codes) expect(isRoomCode(code)).toBe(true);
    expect(isRoomCode("ABCDEFGHJK")).toBe(false);
    expect(isRoomCode("abcdefghi1")).toBe(false);
  });

  test("parses messages strictly", () => {
    expect(parseClientMessage('{"type":"start"}')).toEqual({ type: "start" });
    expect(
      parseClientMessage(
        JSON.stringify({
          type: "state",
          t: 1_000,
          p: [1, 2, 3],
          q: [0, 0, 0, 1],
          s: 4,
          r: false,
        }),
      ),
    ).not.toBeNull();
    for (const frame of [
      '{"type":"start","extra":1}',
      '{"type":"choose_kart"}',
      '{"type":"state","t":1,"p":[1,2],"q":[0,0,0,1],"s":0,"r":false}',
      "not json",
      JSON.stringify({ type: "ping", t: 1, pad: "x".repeat(1_100) }),
      42,
    ]) {
      expect(parseClientMessage(frame)).toBeNull();
    }
    expect(
      parseServerMessage(JSON.stringify(roomSnapshot(racing(2)))),
    ).not.toBeNull();
  });
});

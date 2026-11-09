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
  ROOM_SEAT_HOLD_MS,
  ROOM_START_DELAY_MS,
  roomRaceReportSchema,
  roomSnapshotSchema,
} from "../src/game/room/room-protocol";
import {
  applyRoomEvent,
  createRoomState,
  hostId,
  nextRoomDeadline,
  roomResume,
  roomSnapshot,
  type RoomEvent,
  type RoomKartState,
  type RoomOutcome,
  type RoomState,
} from "../src/game/room/room-rules";
import type { RoomToken } from "../src/game/room/room-signing";
import {
  crossingAt,
  kartAt,
  straightRoomCourse,
  TEST_KART_CONTACT,
} from "./support/room-course";

const RACE = "00000000-0000-4000-8000-000000000001";

// The start line at 0, checkpoints at 10 and 20, and two laps: six gates.
const COURSE = straightRoomCourse(2, [10, 20]);
const GATES = 6;
const GATE_X = [10, 20, 0];

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
    course: COURSE,
    physicsVersion: "support-heave-v1",
    karts: [
      { id: "kestrel", revision: 3, contact: TEST_KART_CONTACT },
      { id: "mule", revision: 2, contact: TEST_KART_CONTACT },
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

/** A state the room hears at `now`. */
function stateEvent(playerId: string, now: number, state: RoomKartState) {
  return { type: "state", now, playerId, state } satisfies RoomEvent;
}

/**
 * Crosses gates up to `upTo`, a second apart and each heard 50 ms after
 * its race time, the last at `lastHeardAt`.
 */
function passGates(
  state: RoomState,
  playerId: string,
  upTo: number,
  lastHeardAt: number,
) {
  let outcome: RoomOutcome = { state, changed: false };
  const passed =
    state.race?.entrants.find(({ id }) => id === playerId)?.gates ?? 0;
  for (let gates = passed + 1; gates <= upTo; gates += 1) {
    const now = lastHeardAt - (upTo - gates) * 1_000;
    const t = (now - RACING_AT - 50) * 1_000;
    outcome = run(
      outcome.state,
      stateEvent(playerId, now, crossingAt(t, GATE_X[(gates - 1) % 3])),
    );
  }
  return outcome;
}

/** Drives every gate, finishing 50 ms of race time before `now`. */
function finishAt(state: RoomState, playerId: string, now: number) {
  return passGates(state, playerId, GATES, now);
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
    // Through the countdown, karts wait on the grid at race time zero.
    const waiting = run(
      state,
      stateEvent("p1", RACING_AT - 2_000, kartAt(0, -1, { p: [-1, 0.2, -0.5] })),
    );
    expect(waiting).toMatchObject({ accepted: true, changed: false });
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
  test("relays and counts only states that follow the kart's last", () => {
    const state = racing(2);
    const accepted = (...events: RoomEvent[]) =>
      run(state, ...events).accepted === true;
    const second = (at: number) => RACING_AT + at / 1_000 + 50;
    // Its first state is checked against its grid slot, as far as 30 m/s
    // reaches in its race time.
    expect(accepted(stateEvent("p1", second(1e6), kartAt(1e6, 25)))).toBe(true);
    expect(accepted(stateEvent("p1", second(5e5), kartAt(5e5, 25)))).toBe(
      false,
    );
    // ...measured in three dimensions, past a reset's landing.
    const offGrid = (x: number, y: number) =>
      accepted(stateEvent("p1", second(1e6), kartAt(1e6, x, { p: [x, y, -0.5] })));
    expect(offGrid(19.3, 22.5)).toBe(true);
    expect(offGrid(20.8, 24)).toBe(false);
    // No state's race time runs ahead of the room's clock.
    expect(accepted(stateEvent("p1", RACING_AT + 500, kartAt(1e6, 0)))).toBe(
      false,
    );
    // Faster than 30 m/s from the last accepted state.
    const moving = run(state, stateEvent("p1", second(1e6), kartAt(1e6, 5)));
    const next = (event: RoomEvent) => run(moving.state, event);
    expect(next(stateEvent("p1", second(1.1e6), kartAt(1.1e6, 8))).accepted)
      .toBe(true);
    expect(
      next(stateEvent("p1", second(1.1e6), kartAt(1.1e6, 8.1))).accepted,
    ).toBeUndefined();
    // A state no later than the last.
    expect(
      next(stateEvent("p1", second(1e6), kartAt(1e6, 5))).accepted,
    ).toBeUndefined();
    // A gate out of order, or a crossing whose step before is too far.
    expect(next(stateEvent("p1", second(2e6), crossingAt(2e6, 20))).accepted)
      .toBeUndefined();
    expect(
      next(
        stateEvent(
          "p1",
          second(2e6),
          kartAt(2e6, 10.1, { g: [9.6, 0.5, 0] }),
        ),
      ).accepted,
    ).toBeUndefined();
    const crossed = next(stateEvent("p1", second(2e6), crossingAt(2e6, 10)));
    expect(crossed).toMatchObject({ accepted: true, changed: true });
    expect(crossed.state.race?.entrants[0]).toMatchObject({
      gates: 1,
      lastGate: { timeMicroseconds: 2e6 },
    });
    // A reset lands only on the newest reset point.
    const reset = (x: number) =>
      run(
        crossed.state,
        stateEvent("p1", second(3e6), kartAt(3e6, x, { p: [x, 1, 0], r: true })),
      ).accepted;
    expect(reset(-1)).toBeUndefined();
    expect(reset(9)).toBe(true);
    // A restart must not check later states from before the reset.
    expect(
      run(
        crossed.state,
        stateEvent("p1", second(3e6), kartAt(3e6, 9, { p: [9, 1, 0], r: true })),
      ),
    ).toMatchObject({ accepted: true, changed: false, persist: true });
    // Racers who left or finished send nothing more.
    const left = run(moving.state, {
      type: "leave",
      now: second(1.05e6),
      playerId: "p1",
    });
    expect(
      run(left.state, stateEvent("p1", second(1.1e6), kartAt(1.1e6, 8)))
        .accepted,
    ).toBeUndefined();
  });

  test("counts a crossing between accepted states when its own was refused", () => {
    let state = racing(2);
    const second = (at: number) => RACING_AT + at / 1_000 + 50;
    state = run(state, stateEvent("p1", second(1e6), kartAt(1e6, 9))).state;
    // The crossing's own state runs ahead of the room's clock: refused.
    const refused = run(
      state,
      stateEvent("p1", RACING_AT + 1_000, crossingAt(1.6e6, 10)),
    );
    expect(refused.accepted).toBeUndefined();
    // The next accepted state, past the gate, counts it.
    const counted = run(
      refused.state,
      stateEvent("p1", second(1.1e6), kartAt(1.1e6, 11)),
    );
    expect(counted).toMatchObject({ accepted: true, changed: true });
    expect(counted.state.race?.entrants[0]).toMatchObject({
      gates: 1,
      lastGate: { timeMicroseconds: 1.1e6 },
    });
    // Not twice.
    const onward = run(
      counted.state,
      stateEvent("p1", second(1.2e6), kartAt(1.2e6, 12)),
    );
    expect(onward.state.race?.entrants[0].gates).toBe(1);
  });

  test("ranks the unfinished by gates, then by when each passed its last", () => {
    let state = passGates(racing(3), "p2", 2, RACING_AT + 3_000).state;
    state = passGates(state, "p3", 2, RACING_AT + 4_000).state;
    state = passGates(state, "p1", 1, RACING_AT + 9_000).state;
    expect(roomSnapshot(state).race?.entrants.map(({ id }) => id)).toEqual([
      "p2",
      "p3",
      "p1",
    ]);
  });

  test("times a finish from the kart's own finishing state", () => {
    const base = passGates(racing(2), "p1", GATES - 1, RACING_AT + 10_000);
    // Heard late, as after a reconnect, it keeps its own time.
    const late = run(
      base.state,
      stateEvent("p1", RACING_AT + 20_000, crossingAt(11_000_000, 0)),
    );
    expect(late.state.race?.entrants[0]).toMatchObject({
      id: "p1",
      finishMicroseconds: 11_000_000,
      finishedAt: RACING_AT + 20_000,
    });
    expect(late.state.race?.firstFinishAt).toBe(RACING_AT + 20_000);
    // The page's repeat of it changes nothing.
    const repeated = run(
      late.state,
      stateEvent("p1", RACING_AT + 20_500, crossingAt(11_000_000, 0)),
    );
    expect(repeated).toMatchObject({ changed: false });
    expect(repeated.state.race).toEqual(late.state.race);
    // A finish refused for running ahead of the clock counts when the page
    // sends it again.
    const early = run(
      base.state,
      stateEvent("p1", RACING_AT + 10_500, crossingAt(11_000_000, 0)),
    );
    expect(early.state.race?.entrants[0].finishMicroseconds).toBeNull();
    expect(
      run(
        early.state,
        stateEvent("p1", RACING_AT + 11_100, crossingAt(11_000_000, 0)),
      ).state.race?.entrants[0].finishMicroseconds,
    ).toBe(11_000_000);
    // Its states end at the line.
    expect(
      run(late.state, stateEvent("p1", RACING_AT + 21_000, kartAt(12e6, 3)))
        .accepted,
    ).toBeUndefined();
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
    let state = passGates(racing(3), "p1", 2, RACING_AT + 3_000).state;
    // Leaving keeps the place its progress earned.
    state = passGates(state, "p2", 3, RACING_AT + 4_000).state;
    state = finishAt(state, "p3", RACING_AT + 60_000).state;
    state = run(state, { type: "leave", now: RACING_AT + 65_000, playerId: "p2" })
      .state;
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
      ["p2", null],
      ["p1", null],
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

    // Leaving before the start leaves nothing to record.
    const unraced = run(
      racing(2),
      { type: "leave", now: RACING_AT - 5, playerId: "p1" },
      { type: "leave", now: RACING_AT - 4, playerId: "p2" },
    );
    expect(unraced.state.race).toBeNull();
    expect(unraced.state.lastRace?.endReason).toBe("everyone_left");
    expect(unraced.report).toBeUndefined();
  });
});

test.describe("room doors", () => {
  // The test course's door stands at x 20, 1 m off the line.
  const second = (at: number) => RACING_AT + at / 1_000 + 50;
  const open = (playerId: string, now: number, t: number, door = "side-door") =>
    ({ type: "open", now, playerId, claim: { door, t, w: 2.5 } }) satisfies RoomEvent;
  const near = (playerId: string, state = racing(2)) =>
    run(state, stateEvent(playerId, second(1e6), kartAt(1e6, 19.5))).state;

  test("keep a door's first claim from a racing kart near it", () => {
    expect(roomSnapshot(racing(2)).race?.doors).toEqual([]);
    // Not yet racing, or with no accepted state, nothing opens.
    const loading = run(lobby(2), {
      type: "start",
      now: 2_000,
      playerId: "p1",
      raceId: RACE,
    }).state;
    expect(run(loading, open("p1", 2_500, 0)).changed).toBe(false);
    expect(run(racing(2), open("p1", second(1e6), 1e6)).changed).toBe(false);
    // From afar, of a door the course hasn't, or ahead of the room's clock.
    const far = run(racing(2), stateEvent("p1", second(1e6), kartAt(1e6, 10)));
    expect(run(far.state, open("p1", second(1.1e6), 1.1e6)).changed).toBe(false);
    expect(
      run(near("p1"), open("p1", second(1.1e6), 1.1e6, "back-door")).changed,
    ).toBe(false);
    expect(run(near("p1"), open("p1", second(1e6), 1.5e6)).changed).toBe(false);

    const opened = run(near("p1"), open("p1", second(1.02e6), 1.02e6));
    expect(opened.changed).toBe(true);
    const doors = [{ door: "side-door", t: 1.02e6, w: 2.5, by: "p1" }];
    expect(roomSnapshot(opened.state).race?.doors).toEqual(doors);
    expect(
      parseServerMessage(JSON.stringify(roomSnapshot(opened.state))),
    ).not.toBeNull();
    // A later claim, even from a kart beside it, changes nothing.
    const again = run(
      near("p2", opened.state),
      open("p2", second(1.05e6), 1.05e6),
    );
    expect(again.changed).toBe(false);
    expect(roomSnapshot(again.state).race?.doors).toEqual(doors);
  });

  test("parse a claim strictly", () => {
    const claim = { type: "open", door: "tunnel-door-4", t: 1_000, w: 3.2 };
    expect(parseClientMessage(JSON.stringify(claim))).toEqual(claim);
    for (const bad of [
      { ...claim, door: "Tunnel Door" },
      { ...claim, w: -1 },
      { ...claim, t: -5 },
      { ...claim, by: "p1" },
    ]) {
      expect(parseClientMessage(JSON.stringify(bad))).toBeNull();
    }
  });
});

test.describe("dropped connections", () => {
  test("hold a seat for 30 s, hosted meanwhile by the next connected", () => {
    let state = run(lobby(2), { type: "disconnect", now: 5_000, playerId: "p1" })
      .state;
    expect(roomSnapshot(state)).toMatchObject({
      hostId: "p2",
      players: [
        { id: "p1", connected: false, ready: true },
        { id: "p2", connected: true },
      ],
    });
    expect(nextRoomDeadline(state)).toBe(5_000 + ROOM_SEAT_HOLD_MS);
    // The same page (or account) comes back to its seat, and hosts again.
    const back = run(state, { type: "join", now: 6_000, token: token("k0") });
    expect(back.joined).toEqual({ playerId: "p1", replaced: true });
    expect(hostId(back.state)).toBe("p1");
    expect(nextRoomDeadline(back.state)).toBeNull();
    // Gone past the hold, the seat is given up.
    state = run(state, {
      type: "tick",
      now: 5_000 + ROOM_SEAT_HOLD_MS,
    }).state;
    expect(state.players.map(({ id }) => id)).toEqual(["p2"]);
  });

  test("a held seat sits out a race that starts without it", () => {
    let state = run(lobby(3), { type: "disconnect", now: 1_500, playerId: "p3" })
      .state;
    state = run(state, {
      type: "start",
      now: 2_000,
      playerId: "p1",
      raceId: RACE,
    }).state;
    expect(state.race?.entrants.map(({ id }) => id)).toEqual(["p1", "p2"]);
  });

  test("race on for a held seat, which resumes after its last state", () => {
    let state = racing(2);
    expect(roomResume(state, "p1")).toBe(-1);
    state = run(
      state,
      stateEvent("p1", RACING_AT + 1_050, kartAt(1e6, 5)),
      { type: "disconnect", now: RACING_AT + 2_000, playerId: "p1" },
    ).state;
    expect(roomResume(state, "p1")).toBe(1e6);
    // States from the outage still count when they arrive.
    const resumed = run(
      state,
      stateEvent("p1", RACING_AT + 9_000, crossingAt(2e6, 10)),
    );
    expect(resumed.state.race?.entrants[0].gates).toBe(1);
    // Past the hold, the racer has left, keeping its place.
    const gone = run(resumed.state, {
      type: "tick",
      now: RACING_AT + 2_000 + ROOM_SEAT_HOLD_MS,
    }).state;
    expect(gone.race?.entrants[0]).toMatchObject({ id: "p1", left: true });
    expect(roomResume(gone, "p1")).toBeNull();
    expect(roomResume(gone, "p2")).toBe(-1);
  });

  test("a page that can't race leaves the race at once", () => {
    let state = run(lobby(3), {
      type: "start",
      now: 2_000,
      playerId: "p1",
      raceId: RACE,
    }).state;
    state = run(
      state,
      { type: "loaded", now: 2_500, playerId: "p1", raceId: RACE },
      { type: "loaded", now: 2_600, playerId: "p2", raceId: RACE },
      { type: "sit_out", now: 2_700, playerId: "p3", raceId: RACE },
    ).state;
    // Everyone left has loaded, so racing starts without waiting.
    expect(state.race?.racingAt).toBe(2_700 + ROOM_START_DELAY_MS);
    expect(state.race?.entrants.map(({ id }) => id)).toEqual(["p1", "p2"]);
    expect(state.players[2]).toMatchObject({ id: "p3", ready: false });
    // Once racing, sitting out leaves the race.
    const left = run(state, {
      type: "sit_out",
      now: RACING_AT,
      playerId: "p2",
      raceId: RACE,
    }).state;
    expect(left.race?.entrants[1]).toMatchObject({ id: "p2", left: true });
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

    const pastLimit = run(
      passGates(racing(2), "p1", GATES - 1, RACING_AT + 10_000).state,
      stateEvent(
        "p1",
        RACING_AT + ROOM_RACE_LIMIT_MS + 1_000,
        crossingAt(ROOM_RACE_LIMIT_MS * 1_000, 0),
      ),
    );
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
      token: {
        ...token("k1"),
        karts: [{ id: "kestrel", revision: 4, contact: TEST_KART_CONTACT }],
      },
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
          v: [1, 0, -2],
          w: [0, 0.5, 0],
          s: 4,
          r: false,
          g: [1, 2, 2.9],
          o: true,
        }),
      ),
    ).not.toBeNull();
    for (const frame of [
      '{"type":"start","extra":1}',
      '{"type":"choose_kart"}',
      '{"type":"state","t":1,"p":[1,2,3],"q":[0,0,0,1],"s":0,"r":false}',
      // Spin is part of every state from protocol 3, and "out of touch" is
      // only ever said, never denied.
      '{"type":"state","t":1,"p":[1,2,3],"q":[0,0,0,1],"v":[0,0,0],"s":0,"r":false}',
      '{"type":"state","t":1,"p":[1,2,3],"q":[0,0,0,1],"v":[0,0,0],"w":[0,0,0],"s":0,"r":false,"o":false}',
      '{"type":"state","t":1,"p":[1,2,3],"q":[0,0,0,1],"v":[0,0,0],"w":[0,0,0],"s":0,"r":false,"g":[1,2]}',
      '{"type":"gate","raceId":"00000000-0000-4000-8000-000000000001","gates":1}',
      "not json",
      JSON.stringify({ type: "ping", t: 1, pad: "x".repeat(1_100) }),
      42,
    ]) {
      expect(parseClientMessage(frame)).toBeNull();
    }
    expect(
      parseServerMessage(JSON.stringify(roomSnapshot(racing(2)))),
    ).not.toBeNull();
    const contact = {
      type: "contact",
      id: 1,
      t: 2_000_000,
      with: "p2",
      n: [1, 0, 0],
      p: [3, 0.5, 0],
      c: 4.2,
      j: [-3.1, 0, 0.01],
      k: [0, 0.02, 0],
    };
    expect(parseServerMessage(JSON.stringify(contact))).toEqual(contact);
    for (const bad of [
      { ...contact, c: -1 },
      { ...contact, with: "someone" },
      { ...contact, damage: 1 },
    ]) {
      expect(parseServerMessage(JSON.stringify(bad))).toBeNull();
    }
  });
});

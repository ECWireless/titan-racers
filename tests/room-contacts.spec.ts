import { expect, test } from "@playwright/test";

import {
  contactEntrants,
  ROOM_CONTACT,
  RoomContacts,
  roomContactMessage,
  type RoomContact,
} from "../src/game/room/room-contacts";
import { sweepKartContact } from "../src/game/room/kart-contact";
import { ROOM_PROTOCOL } from "../src/game/room/room-protocol";
import {
  applyRoomEvent,
  createRoomState,
  type RoomEvent,
  type RoomKartState,
  type RoomState,
} from "../src/game/room/room-rules";
import { roomContactShape } from "../src/game/room/room-signing";
import {
  kartAt,
  straightRoomCourse,
  TEST_KART_CONTACT,
} from "./support/room-course";

const SHAPE = roomContactShape(TEST_KART_CONTACT);
/** Side by side, two karts' boxes just touch this far apart. */
const WIDTH = 2 * SHAPE.halfExtents.x;
const STATE_US = 33_333;
/** How late states arrive, unless a test says otherwise. */
const ON_TIME_US = 50_000;

type Drive = {
  /** Where the kart is at race time `t` (µs), and its yaw (rad). */
  at: (t: number) => { x: number; z?: number; yaw?: number };
  extra?: (t: number) => Partial<RoomKartState>;
  lateUs?: (t: number) => number;
  /** How often it sends, and from when; it sends nothing while silent. */
  everyUs?: number;
  fromUs?: number;
  silent?: (t: number) => boolean;
  /** States it resends after reconnecting, rather than sends live. */
  resent?: (t: number) => boolean;
};

function stateOf({ at, extra }: Drive, t: number): RoomKartState {
  const { x, z = 0, yaw = 0 } = at(t);
  // To the millimetre, as pages send them.
  const mm = (value: number) => Math.round(value * 1_000) / 1_000;
  return {
    t,
    p: [mm(x), 0.5, mm(z)],
    q: [0, Math.sin(yaw / 2), 0, Math.cos(yaw / 2)],
    v: [0, 0, 0],
    w: [0, 0, 0],
    s: 0,
    r: false,
    ...extra?.(t),
  };
}

/**
 * Feeds two karts' live states to the room in the order they arrive, each
 * kart's in the order it sent them, as one socket delivers; returns every
 * touch opened.
 */
function race(drives: Record<"a" | "b", Drive>, seconds: number) {
  const contacts = new RoomContacts();
  const arrivals: Array<{ id: "a" | "b"; t: number; arriveUs: number }> = [];
  for (const id of ["a", "b"] as const) {
    const { everyUs = STATE_US, fromUs = 0, silent, lateUs } = drives[id];
    let arrived = -Infinity;
    for (let t = fromUs; t <= seconds * 1_000_000; t += everyUs) {
      if (silent?.(t)) continue;
      arrived = Math.max(arrived, t + (lateUs?.(t) ?? ON_TIME_US));
      arrivals.push({ id, t, arriveUs: arrived });
    }
  }
  arrivals.sort((x, y) => x.arriveUs - y.arriveUs || x.id.localeCompare(y.id));
  const opened: RoomContact[] = [];
  for (const { id, t, arriveUs } of arrivals) {
    if (drives[id].resent?.(t)) {
      contacts.resent(id, stateOf(drives[id], t));
      continue;
    }
    opened.push(
      ...contacts.live({ id, shape: SHAPE }, stateOf(drives[id], t), arriveUs, [
        { id: id === "a" ? "b" : "a", shape: SHAPE },
      ]),
    );
  }
  return opened;
}

/** A faster kart driving through a slower one ahead, as scripted states. */
const rearEnd: Record<"a" | "b", Drive> = {
  a: { at: (t) => ({ x: 6 * (t / 1e6) }) },
  b: { at: (t) => ({ x: 0.6 + 3 * (t / 1e6) }) },
};

test.describe("the room's record of contacts", () => {
  for (const [name, lateA, lateB] of [
    ["a's", 20_000, 60_000],
    ["b's", 60_000, 20_000],
  ] as const) {
    test(`opens one record per touch when ${name} state shows it first`, () => {
      const opened = race(
        {
          a: { ...rearEnd.a, lateUs: () => lateA },
          b: { ...rearEnd.b, lateUs: () => lateB },
        },
        1,
      );

      expect(opened).toHaveLength(1);
      const [contact] = opened;
      // About 0.22 m to close at 3 m/s: some 73 ms in.
      expect(contact.t).toBeGreaterThan(40_000);
      expect(contact.t).toBeLessThan(110_000);
      expect(contact.response.closingSpeed).toBeCloseTo(3, 0);
      // Its normal runs from a toward b, whichever reported it.
      const towardB = contact.a === "a" ? 1 : -1;
      expect(contact.response.normal.x * towardB).toBeGreaterThan(0.99);
    });
  }

  test("a touch inside the first state's span is answered the same either way", () => {
    const shares = [
      [20_000, 60_000],
      [60_000, 20_000],
    ].map(([lateA, lateB]) => {
      const opened = race(
        {
          a: { ...rearEnd.a, lateUs: () => lateA },
          b: { at: (t) => ({ x: 0.4 + 3 * (t / 1e6) }), lateUs: () => lateB },
        },
        0.3,
      );
      expect(opened).toHaveLength(1);
      const { response, a } = opened[0];
      expect(response.closingSpeed).toBeCloseTo(3, 1);
      // What b takes, whichever kart reported it.
      return (a === "a" ? 1 : -1) * response.impulse.x;
    });

    expect(shares[0]).toBeGreaterThan(1);
    expect(shares[1] / shares[0]).toBeCloseTo(1, 1);
  });

  test("karts pressed together through braking stay one touch", () => {
    // Side by side, overlapping, both brake to rest at 500 ms; one stream
    // runs behind the other.
    const z = (t: number) => Math.min(20 * (t / 1e6), 10);
    const opened = race(
      {
        a: { at: (t) => ({ x: Math.min(0, -0.2 + 2 * (t / 1e6)), z: z(t) }), lateUs: () => 20_000 },
        b: { at: (t) => ({ x: WIDTH - 0.01, z: z(t) }), lateUs: () => 60_000 },
      },
      1,
    );

    expect(opened).toHaveLength(1);
  });

  test("a kart's path between another's sparse states is swept", () => {
    // A sends ten times a second; B, four times as often, swerves into A
    // and back between two of A's states.
    const opened = race(
      {
        a: { at: () => ({ x: 0 }), everyUs: 100_000 },
        b: {
          at: (t) => ({ x: t <= 100_000 ? 0.1 + (Math.abs(t - 50_000) / 50_000) * 0.6 : 0.7 }),
          everyUs: 25_000,
          lateUs: () => 20_000,
        },
      },
      0.3,
    );

    expect(opened).toHaveLength(1);
    expect(opened[0].t).toBeGreaterThan(25_000);
    expect(opened[0].t).toBeLessThan(50_000);
  });

  test("a bounce apart for one state is two touches", () => {
    // Side by side at 30 states a second, a edges into b, is 4 cm apart at
    // one state, and touches again.
    const x = (t: number) =>
      t < 66_000 ? 0.01 : t < 100_000 ? -0.04 : 0.01 + (t - 100_000) / 1e7;
    const opened = race(
      {
        a: { at: (t) => ({ x: x(t), z: 10 * (t / 1e6) }) },
        b: { at: (t) => ({ x: WIDTH, z: 10 * (t / 1e6) }) },
      },
      0.3,
    );

    expect(opened).toHaveLength(2);
  });

  test("two touches inside one sparse span are two records", () => {
    // A sends five times a second; B, at 40 a second, bumps it twice.
    const bump = (t: number) =>
      (t > 25_000 && t < 75_000) || (t > 125_000 && t < 175_000);
    const opened = race(
      {
        a: { at: () => ({ x: 0 }), everyUs: 200_000 },
        b: { at: (t) => ({ x: bump(t) ? WIDTH - 0.01 : WIDTH + 0.1 }), everyUs: 25_000 },
      },
      0.45,
    );

    expect(opened).toHaveLength(2);
  });

  test("a kart's first state inside another's span still lets the rest touch", () => {
    // A sends ten times a second; B starts sending a quarter of the way into
    // A's first span and crosses it at 20 m/s, clear again before B's states
    // can be swept against A's next.
    const opened = race(
      {
        a: { at: () => ({ x: 0 }), everyUs: 100_000 },
        b: {
          at: (t) => ({ x: 0.5 - 20 * ((t - 25_000) / 1e6) }),
          fromUs: 25_000,
          everyUs: 25_000,
        },
      },
      0.1,
    );

    expect(opened).toHaveLength(1);
  });

  test("records where a turning kart met another, as it met", () => {
    // A spins in place at 9 rad/s, sweeping a corner into B's side.
    const yaw = (t: number) => 0.2 + 9 * (t / 1e6);
    const opened = race(
      { a: { at: (t) => ({ x: -0.45, yaw: yaw(t) }) }, b: { at: () => ({ x: 0 }) } },
      0.1,
    );

    expect(opened).toHaveLength(1);
    const { t, point } = opened[0];
    const pose = (x: number, angle: number) => ({
      position: { x, y: 0.5, z: 0 },
      rotation: { w: Math.cos(angle / 2), x: 0, y: Math.sin(angle / 2), z: 0 },
    });
    const there = sweepKartContact(
      { shape: SHAPE, from: pose(-0.45, yaw(t)), to: pose(-0.45, yaw(t)) },
      { shape: SHAPE, from: pose(0, 0), to: pose(0, 0) },
    )!;
    // Where they press: the points touching, not the rest of the face.
    const pressing = there.points.filter(({ depth }) => depth > -0.002);
    expect(pressing.length).toBeGreaterThan(0);
    const centre = pressing.reduce(
      (sum, { point: p }) => ({
        x: sum.x + p.x / pressing.length,
        z: sum.z + p.z / pressing.length,
      }),
      { x: 0, z: 0 },
    );
    expect(Math.hypot(point.x - centre.x, point.z - centre.z)).toBeLessThan(0.01);
  });

  test("a kart that leaves is still touched up to its last state", () => {
    // Through the room's rules: B's state showing the touch arrives after
    // A has left the room.
    const token = (key: string) => ({
      version: 1 as const,
      protocol: ROOM_PROTOCOL,
      room: "abcdefghjk",
      expiresAt: 1,
      courseId: "falls-view-park",
      courseRevision: 1,
      course: straightRoomCourse(1, [2]),
      physicsVersion: "support-heave-v1",
      karts: [{ id: "kestrel", revision: 1, contact: TEST_KART_CONTACT }],
      player: { key: key.padEnd(43, "x"), username: null, signedIn: false },
    });
    let room: RoomState = createRoomState(token("a"));
    const apply = (event: RoomEvent) => {
      const outcome = applyRoomEvent(room, event);
      room = outcome.state;
      return outcome;
    };
    apply({ type: "join", now: 1, token: token("a") });
    apply({ type: "join", now: 1, token: token("b") });
    for (const playerId of ["p1", "p2"]) {
      apply({ type: "choose_kart", now: 2, playerId, kartId: "kestrel" });
    }
    apply({ type: "start", now: 3, playerId: "p1", raceId: "00000000-0000-4000-8000-000000000001" });
    for (const playerId of ["p1", "p2"]) {
      apply({ type: "loaded", now: 4, playerId, raceId: room.race!.id });
    }
    const racingAt = room.race!.racingAt!;

    const contacts = new RoomContacts();
    const opened: RoomContact[] = [];
    const send = (playerId: string, t: number, z: number, arriveUs: number) => {
      const state = kartAt(t, -1, { p: [-1, 0.2, z], v: [0, 0, 0] });
      const outcome = apply({ type: "state", now: racingAt + arriveUs / 1_000, playerId, state });
      expect(outcome.accepted).toBe(true);
      opened.push(
        ...contacts.live(
          { id: playerId, shape: SHAPE },
          state,
          arriveUs,
          contactEntrants(room)
            .filter(({ id }) => id !== playerId)
            .map(({ id }) => ({ id, shape: SHAPE })),
        ),
      );
    };
    // A waits on its grid slot; B drives across into it at 3 m/s, its
    // states 120 ms late.
    const arrivals: Array<{ at: number; run: () => void }> = [];
    for (let t = 0; t <= 300_000; t += STATE_US) {
      if (t <= 200_000) arrivals.push({ at: t + 20_000, run: () => send("p1", t, -0.5, t + 20_000) });
      arrivals.push({ at: t + 120_000, run: () => send("p2", t, 0.5 - 3 * (t / 1e6), t + 120_000) });
    }
    arrivals.push({ at: 260_000, run: () => void apply({ type: "leave", now: racingAt + 260, playerId: "p1" }) });
    arrivals.sort((x, y) => x.at - y.at);
    for (const { run } of arrivals) run();

    expect(room.race!.entrants[0].left).toBe(true);
    expect(opened).toHaveLength(1);
    expect(opened[0].t).toBeLessThan(200_000);
  });

  test("karts meeting and driving on just touching stay one touch", () => {
    // A catches B, pressing in a centimetre, then both drive on at 3 m/s
    // exactly a kart's width apart, their positions to the millimetre.
    const ahead = (t: number) => 0.6 + 3 * (t / 1e6);
    const opened = race(
      {
        a: {
          at: (t) => ({
            x: Math.min(6 * (t / 1e6), ahead(t) - WIDTH + (t < 100_000 ? 0.01 : 0)),
          }),
          lateUs: () => 20_000,
        },
        b: { at: (t) => ({ x: ahead(t) }), lateUs: () => 60_000 },
      },
      2,
    );

    expect(opened).toHaveLength(1);
  });

  test("karts pressed together between sparse states stay one touch", () => {
    const opened = race(
      {
        a: { at: (t) => ({ x: Math.min(0.01, -0.2 + t / 1e6) }), everyUs: 200_000, lateUs: () => 20_000 },
        b: { at: () => ({ x: WIDTH }), everyUs: 200_000, lateUs: () => 60_000 },
      },
      1,
    );

    expect(opened).toHaveLength(1);
  });

  test("records where the karts met, as they met", () => {
    // Driving on at 20 m/s while A edges into B's side.
    const opened = race(
      {
        a: { at: (t) => ({ x: t / 1e6, z: 20 * (t / 1e6) }) },
        b: { at: (t) => ({ x: 0.4, z: 20 * (t / 1e6) }) },
      },
      0.2,
    );

    expect(opened).toHaveLength(1);
    const { t, point } = opened[0];
    expect(point.z).toBeCloseTo(20 * (t / 1e6), 1);
  });

  test("a kart that stops sending still touches up to its last state", () => {
    // A finishes, or drops, just after B reaches it; B's state showing the
    // touch arrives after A's last.
    const opened = race(
      {
        a: { at: () => ({ x: 0.6 }), silent: (t) => t > 100_000 },
        b: { at: (t) => ({ x: 3 * (t / 1e6) }), lateUs: () => 120_000 },
      },
      0.3,
    );

    expect(opened).toHaveLength(1);
  });

  test("a kart whose first states are resent touches once it's clear", () => {
    const opened = race(
      {
        a: { at: (t) => ({ x: 6 * (t / 1e6) - 1 }), resent: (t) => t < 60_000 },
        b: { at: () => ({ x: 1 }) },
      },
      1,
    );

    expect(opened).toHaveLength(1);
  });

  test("a stream a quarter-second late doesn't record a touch again", () => {
    // B's view of the touch arrives after A's has moved on past it.
    const opened = race(
      { a: rearEnd.a, b: { ...rearEnd.b, lateUs: () => 180_000, everyUs: 50_000 } },
      1,
    );

    expect(opened).toHaveLength(1);
  });

  test("answers from the motion it saw, not a velocity a page claims", () => {
    // A stands still, saying it's doing 100 m/s; B drives into it at 3 m/s.
    const opened = race(
      {
        a: { at: () => ({ x: 0.6 }), extra: () => ({ v: [100, 0, 0], w: [0, 99, 0] }) },
        b: { at: (t) => ({ x: 3 * (t / 1e6) }) },
      },
      1,
    );

    expect(opened).toHaveLength(1);
    const { closingSpeed, impulse } = opened[0].response;
    expect(closingSpeed).toBeCloseTo(3, 0);
    // Two karts of about 1.85 kg meeting at 3 m/s.
    expect(Math.hypot(impulse.x, impulse.y, impulse.z)).toBeLessThan(4);
  });

  test("rubbing is one touch; parting and touching again is another", () => {
    const touching = (t: number) => t < 600_000 || t > 1_000_000;
    // Side by side, a edges into b's side, then pulls away and comes back.
    const edging = (t: number) => 0.2 * ((t % 600_000) / 1e6);
    const opened = race(
      {
        a: {
          at: (t) => ({
            x: touching(t) ? 0.005 + edging(t) : -0.3,
            z: 10 * (t / 1e6),
          }),
        },
        b: { at: (t) => ({ x: WIDTH + edging(t), z: 10 * (t / 1e6) }) },
      },
      1.5,
    );

    expect(opened.map(({ id }) => id)).toEqual([1, 2]);
    expect(opened[1].t).toBeGreaterThan(1_000_000);
  });

  test("seen apart, even briefly, karts touching again touch anew", () => {
    // Side by side at speed, a edges into b, pulls away for a moment, and
    // edges in again within 150 ms of last touching.
    const opened = race(
      {
        a: {
          at: (t) => ({
            x:
              t < 100_000
                ? -0.02 + 0.5 * (t / 1e6)
                : t < 166_000
                  ? -0.1
                  : -0.05 + (t - 166_000) / 1e6,
            z: 10 * (t / 1e6),
          }),
        },
        b: { at: (t) => ({ x: WIDTH, z: 10 * (t / 1e6) }) },
      },
      0.5,
    );

    expect(opened.map(({ id }) => id)).toEqual([1, 2]);
    // Within 150 ms of when they last touched, at 100 ms.
    expect(opened[1].t).toBeLessThan(100_000 + ROOM_CONTACT.partedUs);
  });

  test("a kart whose states arrive late is out of touch until they're on time", () => {
    const late = (lateUs: (t: number) => number) =>
      race({ a: { ...rearEnd.a, lateUs }, b: rearEnd.b }, 1);
    expect(late(() => 300_000)).toEqual([]);
    // Back under the limit, but not yet under the one it returns at.
    expect(late((t) => (t < 200_000 ? 300_000 : 200_000))).toEqual([]);
    // Back on time while still inside the kart it's driving through, it
    // stays see-through until it's clear, rather than shoving it.
    expect(
      race(
        {
          a: { ...rearEnd.a, lateUs: (t) => (t < 150_000 ? 300_000 : ON_TIME_US) },
          b: { at: (t) => ({ x: 0.6 + 5 * (t / 1e6) }) },
        },
        1.5,
      ),
    ).toEqual([]);

    // Back on time before it reaches a kart further ahead, it touches.
    const back = race(
      {
        a: { ...rearEnd.a, lateUs: (t) => (t < 1_000_000 ? 300_000 : 100_000) },
        b: { at: (t) => ({ x: 7.5 + t / 1e6 }) },
      },
      2,
    );
    expect(back).toHaveLength(1);
    expect(back[0].t).toBeGreaterThan(1_000_000);
  });

  test("a kart silent too long is out of touch until it's clear", () => {
    // B goes quiet. A, its states nearly a quarter-second late, reaches
    // where B was once B has been quiet too long by the room's clock, stops
    // inside it, and B comes back with A there.
    const opened = race(
      {
        a: { at: (t) => ({ x: Math.min(0.4, 6 * (t / 1e6) - 1.1) }), lateUs: () => 240_000 },
        b: { at: () => ({ x: 0.6 }), silent: (t) => t > 70_000 && t < 450_000 },
      },
      1,
    );

    expect(opened).toEqual([]);
  });

  test("karts both silent come back out of touch until they're clear", () => {
    // Both go quiet; A moves into where B was meanwhile, and both return.
    const quiet = (t: number) => t > 70_000 && t < 450_000;
    const opened = race(
      {
        a: { at: (t) => ({ x: t < 70_000 ? -0.2 : 0.4 }), silent: quiet },
        b: { at: () => ({ x: 0.6 }), silent: quiet },
      },
      1,
    );

    expect(opened).toEqual([]);
  });

  test("a kart's first state doesn't stand in for where it was before", () => {
    // B's states start at 100 ms, where A drove through just before; A's
    // late states of that arrive after B's first.
    const opened = race(
      {
        a: {
          at: (t) => ({ x: t < 100_000 ? 30 * (t / 1e6) - 1 : 2 }),
          lateUs: () => 200_000,
        },
        b: { at: () => ({ x: 0 }), fromUs: 100_000 },
      },
      0.5,
    );

    expect(opened).toEqual([]);
  });

  test("a reset into clear space among resent states isn't swept as motion", () => {
    // A reconnects, resending a reset to clear space short of B, and
    // stays there.
    const opened = race(
      {
        a: {
          at: (t) => ({ x: t < 66_000 ? 0 : 3 }),
          extra: (t) => ({ r: t === 66_666 }),
          resent: (t) => t > 60_000 && t < 120_000,
        },
        b: { at: () => ({ x: 4.3 }) },
      },
      0.5,
    );

    expect(opened).toEqual([]);
  });

  test("a reset among resent states isn't swept as motion", () => {
    // A reconnects; among the states it resends is a reset beside B, and its
    // next live state is inside B.
    const opened = race(
      {
        a: {
          at: (t) => ({ x: t < 225_000 ? 6 * (t / 1e6) : 4.05 }),
          extra: (t) => ({ r: t === 233_331 }),
          resent: (t) => t > 200_000 && t < 266_000,
        },
        b: { at: () => ({ x: 4.3 }) },
      },
      0.5,
    );

    expect(opened).toEqual([]);
  });

  test("a kart sending less often still touches once", () => {
    const opened = race({ a: rearEnd.a, b: { ...rearEnd.b, everyUs: 50_000 } }, 1);

    expect(opened).toHaveLength(1);
  });

  test("a kart whose page says it's out of touch passes through", () => {
    const opened = race(
      { a: { ...rearEnd.a, extra: () => ({ o: true }) }, b: rearEnd.b },
      1,
    );

    expect(opened).toEqual([]);
  });

  test("a kart just reset passes through until it's clear", () => {
    const opened = race(
      {
        // Reset onto b, waits there, then drives off and comes back.
        a: {
          at: (t) =>
            t < 400_000
              ? { x: 0 }
              : t < 800_000
                ? { x: -1 }
                : { x: -1 + 4 * ((t - 800_000) / 1e6) },
          extra: (t) => ({ r: t === 0 }),
        },
        b: { at: () => ({ x: 0.1 }) },
      },
      1.5,
    );

    expect(opened).toHaveLength(1);
    expect(opened[0].t).toBeGreaterThan(800_000);
  });

  test("sweeps every kart that loaded, even one finished, gone, or dropped", () => {
    const entrant = (id: string, more: object) => ({ id, loaded: true, left: false, finishMicroseconds: null, ...more });
    const race = {
      racingAt: 1,
      entrants: [
        entrant("p1", {}),
        entrant("p2", { finishMicroseconds: 61_000_000 }),
        entrant("p3", { left: true }),
        entrant("p4", { loaded: false }),
      ],
    };

    expect(
      contactEntrants({ race } as unknown as Parameters<typeof contactEntrants>[0]).map(({ id }) => id),
    ).toEqual(["p1", "p2", "p3"]);
    // Nothing touches before the race is racing.
    expect(
      contactEntrants({ race: { ...race, racingAt: null } } as unknown as Parameters<typeof contactEntrants>[0]),
    ).toEqual([]);
  });

  test("each page hears its own share of a touch", () => {
    const [contact] = race(rearEnd, 1);
    const toA = roomContactMessage(contact, contact.a);
    const toB = roomContactMessage(contact, contact.b);

    expect(toA).toMatchObject({ type: "contact", id: contact.id, with: contact.b });
    expect(toB).toMatchObject({ type: "contact", id: contact.id, with: contact.a });
    expect(toA.t).toBe(toB.t);
    // Where they met, as they met.
    toA.p.forEach((value, axis) =>
      expect(value).toBeCloseTo([contact.point.x, contact.point.y, contact.point.z][axis], 3),
    );
    toA.n.forEach((value, axis) => expect(value).toBeCloseTo(-toB.n[axis], 4));
    toA.j.forEach((value, axis) => expect(value).toBeCloseTo(-toB.j[axis], 4));
    // The kart behind is slowed; the one ahead pushed on.
    const behind = contact.a === "a" ? toA : toB;
    expect(behind.j[0]).toBeLessThan(0);
  });
});

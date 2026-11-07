import { expect, test } from "@playwright/test";

import {
  advanceKartPose,
  KART_CONTACT,
  withKartImpulse,
  type KartContactBody,
} from "../src/game/room/kart-contact";
import {
  OpponentMotion,
  type OpponentState,
} from "../src/game/room/opponent-motion";
import { PAGE_CONTACT, PageContacts } from "../src/game/room/page-contacts";
import {
  RoomContacts,
  roomContactMessage,
} from "../src/game/room/room-contacts";
import type { RoomContactRecord } from "../src/game/room/room-race";
import type { RoomKartState } from "../src/game/room/room-rules";
import { roomContactShape } from "../src/game/room/room-signing";
import { TEST_KART_CONTACT } from "./support/room-course";

// Each page's side of kart-to-kart contact. Two pages, each simulating its
// own kart as a free body, send states through a room with latency; each
// answers its own kart's touches against its estimate of the other, and
// the room's tracker sends both its records.

const SHAPE = roomContactShape(TEST_KART_CONTACT);
const STEP_SECONDS = 1 / 120;
const STEP_US = 1_000_000 / 120;
/** Karts face -z; one is this long. */
const LENGTH = 2 * SHAPE.halfExtents.z;

type Vector = { x: number; y: number; z: number };

function body(z: number, speed: number, x = 0): KartContactBody {
  return {
    position: { x, y: 0.5, z },
    rotation: { w: 1, x: 0, y: 0, z: 0 },
    velocity: { x: 0, y: 0, z: speed },
    spin: { x: 0, y: 0, z: 0 },
  };
}

const round = (value: number, places: number) =>
  Math.round(value * 10 ** places) / 10 ** places;

/** A kart's state as its page sends it, rounded as the protocol is. */
function sent(t: number, kart: KartContactBody, out = false) {
  const { position: p, rotation: q, velocity: v, spin: w } = kart;
  return {
    t: Math.round(t),
    p: [round(p.x, 3), round(p.y, 3), round(p.z, 3)],
    q: [round(q.x, 4), round(q.y, 4), round(q.z, 4), round(q.w, 4)],
    v: [round(v.x, 2), round(v.y, 2), round(v.z, 2)],
    w: [round(w.x, 2), round(w.y, 2), round(w.z, 2)],
    s: 0,
    r: false,
    ...(out ? { o: true as const } : {}),
  } satisfies RoomKartState;
}

function opponentState(state: RoomKartState): OpponentState {
  const [px, py, pz] = state.p;
  const [qx, qy, qz, qw] = state.q;
  return {
    t: state.t,
    position: { x: px, y: py, z: pz },
    rotation: { x: qx, y: qy, z: qz, w: qw },
    velocity: { x: state.v[0], y: state.v[1], z: state.v[2] },
    spin: { x: state.w[0], y: state.w[1], z: state.w[2] },
    steerDegrees: 0,
    reset: state.r,
    outOfTouch: state.o === true,
  };
}

type PageSetup = {
  body: KartContactBody;
  /** One way, each, in µs. */
  upUs: number;
  downUs: number;
  out?: boolean;
};

/**
 * Runs pages and a room for `seconds`: each page steps its kart at 120 Hz,
 * answering its touches against its estimate of every other, and sends a
 * state every fourth step.
 */
function race(setups: PageSetup[], seconds: number) {
  const room = new RoomContacts();
  const pages = setups.map((setup, index) => ({
    ...setup,
    id: "abcd"[index],
    contacts: new PageContacts(SHAPE),
    others: new Map<string, OpponentMotion>(),
    records: [] as RoomContactRecord[],
    touchedAtUs: null as number | null,
  }));
  for (const page of pages) {
    for (const other of pages) {
      if (other !== page) page.others.set(other.id, new OpponentMotion());
    }
  }
  const events: Array<{ atUs: number; run: () => void }> = [];
  const schedule = (atUs: number, run: () => void) => {
    let index = events.length;
    while (index > 0 && events[index - 1].atUs > atUs) index -= 1;
    events.splice(index, 0, { atUs, run });
  };
  const roomRecords: Array<{
    t: number;
    pair: string;
    closingSpeed: number;
  }> = [];
  // Each state goes up to the room, which may open records for the two
  // karts in a touch, and on to every other page.
  const send = (page: (typeof pages)[number], t: number) => {
    const state = sent(t, page.body, page.out);
    const arrivedUs = t + page.upUs;
    schedule(arrivedUs, () => {
      const others = pages
        .filter((other) => other !== page)
        .map(({ id }) => ({ id, shape: SHAPE }));
      for (const contact of room.live(
        { id: page.id, shape: SHAPE },
        state,
        arrivedUs,
        others,
      )) {
        roomRecords.push({
          t: contact.t,
          pair: [contact.a, contact.b].sort().join(""),
          closingSpeed: contact.response.closingSpeed,
        });
        for (const to of pages) {
          if (to.id !== contact.a && to.id !== contact.b) continue;
          schedule(arrivedUs + to.downUs, () =>
            to.records.push(roomContactMessage(contact, to.id)),
          );
        }
      }
    });
    for (const other of pages) {
      if (other === page) continue;
      const relayedUs = arrivedUs + other.downUs;
      schedule(relayedUs, () =>
        other.others.get(page.id)!.add(opponentState(state), relayedUs),
      );
    }
  };
  let closest = Infinity;
  const steps = Math.round(seconds / STEP_SECONDS);
  // Each sends where it starts, as from the grid.
  for (const page of pages) send(page, 0);
  for (let step = 0; step < steps; step += 1) {
    const atUs = step * STEP_US;
    while (events[0] && events[0].atUs <= atUs) events.shift()!.run();
    for (const page of pages) {
      const opponents = [...page.others].map(([id, estimate]) => ({
        id,
        shape: SHAPE,
        estimate,
      }));
      const answer = page.contacts.step({
        atUs,
        stepSeconds: STEP_SECONDS,
        body: page.body,
        out: page.out ?? false,
        reset: false,
        opponents,
      });
      const { impulse, turn } = answer;
      for (const record of page.records.splice(0)) {
        const push = page.contacts.fill(
          record,
          atUs,
          opponents.find(({ id }) => id === record.with),
        );
        if (!push) continue;
        for (const axis of ["x", "y", "z"] as const) {
          impulse[axis] += push.impulse[axis];
          turn[axis] += push.turn[axis];
        }
      }
      if (answer.touches.length > 0) page.touchedAtUs ??= atUs;
      const pushed = withKartImpulse(
        { shape: SHAPE, body: page.body },
        impulse,
        turn,
      );
      page.body = { ...pushed, ...advanceKartPose(pushed, STEP_SECONDS) };
    }
    for (const [index, page] of pages.entries()) {
      for (const other of pages.slice(index + 1)) {
        closest = Math.min(
          closest,
          Math.abs(page.body.position.z - other.body.position.z),
        );
      }
    }
    if (step % 4 === 3) for (const page of pages) send(page, atUs + STEP_US);
  }
  return { pages, roomRecords, closest };
}

const QUICK = { upUs: 30_000, downUs: 30_000 };

test.describe("a page's kart-to-kart contacts", () => {
  test("a head-on stops both karts at once, with nothing passing through", () => {
    // Closing at 10 m/s, twice a kart's top speed.
    const { pages, roomRecords, closest } = race(
      [
        { body: body(1.5, -5), ...QUICK },
        { body: body(-1.5, 5), ...QUICK },
      ],
      1,
    );
    const [a, b] = pages;
    // Each answered as they met, not a round trip later.
    const meetUs = ((3 - LENGTH) / 10) * 1_000_000;
    for (const page of pages) {
      expect(page.touchedAtUs).not.toBeNull();
      expect(Math.abs(page.touchedAtUs! - meetUs)).toBeLessThan(2 * STEP_US);
    }
    expect(closest).toBeGreaterThan(LENGTH - 0.02);
    // Neither still drives into the other, and momentum held.
    expect(a.body.velocity.z).toBeGreaterThan(-0.1);
    expect(b.body.velocity.z).toBeLessThan(0.1);
    expect(Math.abs(a.body.velocity.z + b.body.velocity.z)).toBeLessThan(0.1);
    // The room recorded it once, as hard as they met, though each page
    // had already answered it.
    expect(roomRecords).toHaveLength(1);
    expect(roomRecords[0].closingSpeed).toBeCloseTo(10, 0);
    expect(a.contacts.stats.fills + b.contacts.stats.fills).toBe(0);
  });

  test("a rear-end shares the push, as each kart's mass gives", () => {
    // One kart waits; the other runs into it at 3 m/s.
    const { pages, roomRecords, closest } = race(
      [
        { body: body(-1, 0), ...QUICK },
        { body: body(0, -3), ...QUICK },
      ],
      1,
    );
    const [ahead, behind] = pages;
    expect(closest).toBeGreaterThan(LENGTH - 0.02);
    // Equal karts, almost no bounce: both carry on at about half.
    expect(ahead.body.velocity.z).toBeCloseTo(-1.5, 0);
    expect(behind.body.velocity.z).toBeCloseTo(-1.5, 0);
    expect(ahead.body.velocity.z).toBeLessThanOrEqual(
      behind.body.velocity.z + 0.05,
    );
    expect(roomRecords).toHaveLength(1);
    expect(roomRecords[0].closingSpeed).toBeCloseTo(3, 0);
    expect(ahead.contacts.stats.fills + behind.contacts.stats.fills).toBe(0);
  });

  test("a pileup of three, each on its own page, never passes through", () => {
    // Two karts wait nose to tail; a third runs into the back of them.
    const gap = 0.002;
    const { pages, roomRecords, closest } = race(
      [
        { body: body(-1, 0), ...QUICK },
        { body: body(-1 + LENGTH + gap, 0), ...QUICK },
        { body: body(1, -4), ...QUICK },
      ],
      1.5,
    );
    // The kart knocked on hits the one ahead before that one's page can
    // know, so it sinks in by about the delay times the speed, but never
    // through: the push apart then parts them.
    expect(closest).toBeGreaterThan(LENGTH - 0.2);
    const zs = pages.map(({ body: { position } }) => position.z);
    expect(zs[1] - zs[0]).toBeGreaterThan(LENGTH - KART_CONTACT.slopMetres);
    expect(zs[2] - zs[1]).toBeGreaterThan(LENGTH - KART_CONTACT.slopMetres);
    // The two hit were pushed on, none came back at the one behind, and
    // most of the momentum carried through.
    const [front, middle, back] = pages.map(({ body }) => body.velocity.z);
    expect(front).toBeLessThan(-0.5);
    expect(middle).toBeLessThan(-0.5);
    expect(front).toBeLessThanOrEqual(middle + 0.05);
    expect(middle).toBeLessThanOrEqual(back + 0.05);
    const total = front + middle + back;
    expect(total).toBeGreaterThan(-4.05);
    expect(total).toBeLessThan(-2.5);
    // The room recorded both pairs that met.
    const pairs = roomRecords.map(({ pair }) => pair);
    expect(pairs).toContain("ab");
    expect(pairs).toContain("bc");
  });

  test("a page that sees the other too late to answer takes the room's record once", () => {
    // The waiting kart's page hears the other 0.3 s late, beyond the
    // lateness a contact allows; the room and the other page hear it soon.
    const { pages, roomRecords } = race(
      [
        { body: body(-1, 0), upUs: 30_000, downUs: 270_000 },
        { body: body(0, -3), ...QUICK },
      ],
      1,
    );
    const [ahead, behind] = pages;
    expect(ahead.touchedAtUs).toBeNull();
    expect(ahead.contacts.stats.fills).toBe(1);
    expect(roomRecords).toHaveLength(1);
    // Pushed on, late, by its share of the touch as the room saw it.
    expect(ahead.body.velocity.z).toBeCloseTo(-1.5, 0);
    expect(behind.touchedAtUs).not.toBeNull();
  });

  test("a kart out of touch passes through, on every page and in the room", () => {
    const { pages, roomRecords } = race(
      [
        { body: body(-1, 0), ...QUICK },
        { body: body(0, -3), ...QUICK, out: true },
      ],
      1,
    );
    const [ahead, behind] = pages;
    expect(ahead.touchedAtUs).toBeNull();
    expect(behind.touchedAtUs).toBeNull();
    expect(roomRecords).toHaveLength(0);
    expect(behind.body.position.z).toBeLessThan(ahead.body.position.z);
    expect(ahead.contacts.seeThrough("b")).toBe(true);
    expect(behind.contacts.ownSeeThrough).toBe(true);
  });
});

/** An opponent standing at `z`, its states arriving 30 ms late. */
function standing(z: number, toUs: number, extra: Partial<OpponentState> = {}) {
  const motion = new OpponentMotion();
  for (let t = 0; t <= toUs; t += 33_333) {
    motion.add(
      {
        t,
        position: { x: 0, y: 0.5, z },
        rotation: { w: 1, x: 0, y: 0, z: 0 },
        velocity: { x: 0, y: 0, z: 0 },
        spin: { x: 0, y: 0, z: 0 },
        steerDegrees: 0,
        reset: false,
        outOfTouch: false,
        ...extra,
      },
      t + 30_000,
    );
  }
  return motion;
}

function stepAgainst(
  contacts: PageContacts,
  estimate: OpponentMotion,
  atUs: number,
  own: KartContactBody,
  out = false,
) {
  return contacts.step({
    atUs,
    stepSeconds: STEP_SECONDS,
    body: own,
    out,
    reset: false,
    opponents: [{ id: "b", shape: SHAPE, estimate }],
  });
}

/** Just short of touching an opponent standing at -0.4, closing on it. */
const TOUCHING = -0.4 + LENGTH + 0.005;

function record(t: number, impulse: Vector, id = 1): RoomContactRecord {
  return {
    type: "contact",
    id,
    t,
    with: "b",
    n: [0, 0, -1],
    p: [0, 0.5, -0.2],
    c: 2,
    j: [impulse.x, impulse.y, impulse.z],
    k: [0, 0, 0],
  };
}

test.describe("a page's out-of-touch rules and the room's records", () => {
  test("pushes a missed record once, while fresh, and never one it answered", () => {
    const contacts = new PageContacts(SHAPE);
    const push = { x: 0, y: 0, z: -2 };
    expect(contacts.fill(record(1_000_000, push), 1_100_000)?.impulse).toEqual(
      push,
    );
    // The same record again.
    expect(contacts.fill(record(1_000_000, push), 1_100_000)).toBeNull();
    // A room that restarted numbers afresh: its ID again at another time
    // is another touch.
    expect(contacts.fill(record(1_050_000, push), 1_100_000)).not.toBeNull();
    // Too old to push now.
    const staleUs = 1_000_000 + PAGE_CONTACT.freshUs + 1;
    expect(contacts.fill(record(1_000_000, push, 2), staleUs)).toBeNull();
    expect(contacts.stats.fills).toBe(2);

    // A touch this page answered: the room's record of it adds nothing.
    const estimate = standing(-0.4, 2_000_000);
    const answer = stepAgainst(
      contacts,
      estimate,
      2_000_000,
      body(TOUCHING, -2),
    );
    expect(answer.touches).toHaveLength(1);
    expect(contacts.fill(record(2_050_000, push, 3), 2_200_000)).toBeNull();
    expect(contacts.stats.fills).toBe(2);
  });

  test("a pushed record carries the other kart's share, so it isn't answered again", () => {
    // The other kart, closing at 2 m/s from 5 cm behind as the record
    // arrives; its states, late, don't yet reach the touch.
    const estimate = new OpponentMotion();
    const behind = LENGTH + 0.05;
    for (let t = 0; t <= 1_000_000; t += 33_333) {
      const state = sent(t, body(behind + 2 * ((1_030_000 - t) / 1e6), -2));
      estimate.add(opponentState(state), t + 30_000);
    }
    const contacts = new PageContacts(SHAPE);
    // The room's record of a touch this page missed: it takes 1 m/s.
    const push = contacts.fill(
      record(1_010_000, { x: 0, y: 0, z: -SHAPE.mass }),
      1_030_000,
      { shape: SHAPE, estimate },
    )!;
    let own = withKartImpulse(
      { shape: SHAPE, body: body(0, 0) },
      push.impulse,
      push.turn,
    );
    let touches = 0;
    for (let step = 0; step < 20; step += 1) {
      const atUs = 1_030_000 + step * STEP_US;
      const answer = stepAgainst(contacts, estimate, atUs, own);
      touches += answer.touches.length;
      own = withKartImpulse(
        { shape: SHAPE, body: own },
        answer.impulse,
        answer.turn,
      );
      own = { ...own, ...advanceKartPose(own, STEP_SECONDS) };
    }
    expect(touches).toBe(0);
    expect(own.velocity.z).toBeCloseTo(-1, 6);
  });

  test("a pushed record leaves alone a kart whose states already show its answer", () => {
    // Its own page answered the touch at 0.98 s: its state at 1 s shows it
    // slowed from 2 m/s to 1.
    const estimate = new OpponentMotion();
    const add = (t: number, z: number, speed: number) =>
      estimate.add(opponentState(sent(t, body(z, speed))), t + 30_000);
    for (let t = 0; t <= 966_666; t += 33_333) add(t, 2 - 2 * (t / 1e6), -2);
    add(1_000_000, 0.03, -1);
    const contacts = new PageContacts(SHAPE);
    const missed = record(980_000, { x: 0, y: 0, z: -SHAPE.mass });
    const other = { shape: SHAPE, estimate };
    expect(contacts.fill(missed, 1_030_000, other)).not.toBeNull();
    expect(estimate.present(1_040_000)!.velocity.z).toBeCloseTo(-1, 6);
  });

  test("a record's carried share lasts only until the other kart's states pass the touch", () => {
    // Its newest state is from the touch itself, before its answer: carried.
    const estimate = new OpponentMotion();
    const add = (t: number, z: number, speed: number, reset = false) =>
      estimate.add(
        { ...opponentState(sent(t, body(z, speed))), reset },
        t + 30_000,
      );
    for (let t = 0; t <= 1_000_000; t += 100_000) add(t, 3 - 2 * (t / 1e6), -2);
    const contacts = new PageContacts(SHAPE);
    const missed = record(1_000_000, { x: 0, y: 0, z: -SHAPE.mass });
    contacts.fill(missed, 1_100_000, { shape: SHAPE, estimate });
    expect(estimate.present(1_110_000)!.velocity.z).toBeCloseTo(-1, 6);
    // A late state from after the touch, though before the push was
    // carried, shows its answer: the share goes.
    add(1_033_333, 0.99, -1);
    expect(estimate.present(1_110_000)!.velocity.z).toBeCloseTo(-1, 6);
    add(1_066_666, 0.96, -1);
    expect(estimate.present(1_110_000)!.velocity.z).toBeCloseTo(-1, 6);
    // A push of this page's own, then a reset: nothing carried past it.
    estimate.carry(1_120_000, { x: 0, y: 0, z: 3 }, { x: 0, y: 0, z: 0 });
    add(1_100_000, 5, 0, true);
    expect(estimate.present(1_130_000)!.velocity.z).toBeCloseTo(0, 6);
  });

  test("carries its push onto the other kart's estimate until that kart's states show it", () => {
    const contacts = new PageContacts(SHAPE);
    const estimate = standing(-0.4, 1_000_000);
    const answer = stepAgainst(
      contacts,
      estimate,
      1_000_000,
      body(TOUCHING, -2),
    );
    expect(answer.touches).toHaveLength(1);
    expect(answer.impulse.z).toBeGreaterThan(0);
    // The other kart, still to it, is now moving away by its share.
    const carried = estimate.present(1_100_000)!;
    expect(carried.velocity.z).toBeCloseTo(-answer.impulse.z / SHAPE.mass, 6);
    expect(carried.position.z).toBeLessThan(-0.4);
    // Its own state from after the touch replaces the share.
    estimate.add(opponentState(sent(1_033_333, body(-0.43, -0.9))), 1_063_333);
    expect(estimate.present(1_063_333)!.velocity.z).toBeCloseTo(-0.9, 6);
  });

  test("an opponent out of touch is see-through, and back only once clear", () => {
    const contacts = new PageContacts(SHAPE);
    // Its page says it can't answer in time; it sits inside this kart.
    const estimate = standing(-0.3, 1_000_000, { outOfTouch: true });
    const touchesAt = (atUs: number, own: KartContactBody) =>
      stepAgainst(contacts, estimate, atUs, own).touches.length;
    expect(touchesAt(1_000_000, body(0, -1))).toBe(0);
    expect(contacts.seeThrough("b")).toBe(true);
    // Back in touch, still inside: nothing pushes it out.
    estimate.add(opponentState(sent(1_033_333, body(-0.3, 0))), 1_063_333);
    expect(touchesAt(1_063_333, body(0, -1))).toBe(0);
    expect(contacts.seeThrough("b")).toBe(true);
    // Clear of it, it can touch again.
    expect(touchesAt(1_070_000, body(0.5, -1))).toBe(0);
    expect(contacts.seeThrough("b")).toBe(false);
    expect(touchesAt(1_080_000, body(-0.3 + LENGTH + 0.001, -2))).toBe(1);
  });

  test("an opponent's late states, or a reset, make it see-through", () => {
    const contacts = new PageContacts(SHAPE);
    const estimate = standing(-2, 1_000_000);
    stepAgainst(contacts, estimate, 1_000_000, body(0, 0));
    expect(contacts.seeThrough("b")).toBe(false);
    // Silent past the lateness a contact allows.
    stepAgainst(contacts, estimate, 1_300_000, body(0, 0));
    expect(contacts.seeThrough("b")).toBe(true);
    // Arriving 0.2 s late isn't quick enough to come back...
    estimate.add(opponentState(sent(1_333_333, body(-2, 0))), 1_533_333);
    stepAgainst(contacts, estimate, 1_533_333, body(0, 0));
    expect(contacts.seeThrough("b")).toBe(true);
    // ...0.1 s is.
    estimate.add(opponentState(sent(1_466_666, body(-2, 0))), 1_566_666);
    stepAgainst(contacts, estimate, 1_566_666, body(0, 0));
    expect(contacts.seeThrough("b")).toBe(false);
    // A reset onto this kart: see-through until clear.
    estimate.add(
      { ...opponentState(sent(1_500_000, body(-0.3, 0))), reset: true },
      1_600_000,
    );
    stepAgainst(contacts, estimate, 1_600_000, body(0, 0));
    expect(contacts.seeThrough("b")).toBe(true);
  });

  test("this kart out of touch, or just reset, passes through until clear", () => {
    const contacts = new PageContacts(SHAPE);
    const estimate = standing(-0.3, 1_000_000);
    const out = stepAgainst(contacts, estimate, 1_000_000, body(0, -1), true);
    expect(out.touches).toEqual([]);
    expect(contacts.ownSeeThrough).toBe(true);
    // In touch again, but inside the other kart.
    const inside = stepAgainst(contacts, estimate, 1_008_333, body(0, -1));
    expect(inside.touches).toEqual([]);
    expect(contacts.ownSeeThrough).toBe(true);
    stepAgainst(contacts, estimate, 1_016_666, body(1, 0));
    expect(contacts.ownSeeThrough).toBe(false);
    // Nor is a record of a touch pushed while it's out.
    const away = new PageContacts(SHAPE);
    stepAgainst(away, estimate, 1_000_000, body(0, -1), true);
    const missed = record(990_000, { x: 0, y: 0, z: 1 });
    expect(away.fill(missed, 1_000_000)).toBeNull();
  });
});

import {
  advanceKartPose,
  betweenKartPoses,
  carryKartPoint,
  KART_CONTACT,
  kartsWithin,
  resolveKartContact,
  sweepKartContact,
  type KartContact,
  type KartContactBody,
  type KartContactResponse,
  type KartPose,
  type KartContactShape,
} from "./kart-contact";
import type { RoomServerMessage } from "./room-protocol";
import type { RoomKartState, RoomState } from "./room-rules";
import type { RaceQuaternion, RaceVector3 } from "../race/race-gate";

/**
 * The room's record of each touch between karts (the kart-to-kart contact
 * standard). Each page answers its own kart's contacts at once; the room
 * finds the same touches in the live states it accepts, with the same
 * resolver, and opens one record per touch, sent to both pages as it opens:
 * the record later systems such as damage extend, and the push a page that
 * missed the touch applies.
 *
 * It answers from the motion it saw, each kart's checked positions and
 * rotations, never from the velocity a page reports, so a page can't push
 * another harder than its kart really moved; and only over time both karts'
 * states cover, never an estimate, so whichever kart's state arrives later
 * finds a touch. A kart out of touch (its
 * states late, silent too long, its page saying so, or just reset) neither
 * touches nor is touched, and comes back once it's clear of every other
 * kart. Free of any transport, and kept in memory only, so a room that
 * restarts mid-race may record a touch in progress twice.
 */

export const ROOM_CONTACT = {
  /** A kart whose states arrive, or stop, this late is out of touch... */
  lateUs: 250_000,
  /** ...until they arrive within this again. */
  backUs: 150_000,
  /** A touch ends once its karts have gone this long without touching. */
  partedUs: 150_000,
  /** How long each kart's states are kept behind its newest. */
  keepUs: 500_000,
  /** The fastest spin the room credits a kart with (rad/s). */
  maxSpin: 50,
};

export type RoomContact = {
  id: number;
  /** When and where they first touched, in race time. */
  t: number;
  point: RaceVector3;
  a: string;
  b: string;
  /** Its normal runs from a toward b; b takes the impulse, a its opposite. */
  response: KartContactResponse;
};

type Track = {
  /**
   * Each state's pose, with the motion that brought it there; `seen` says
   * there was one to see (a state after a reset, or the first, has none).
   */
  states: Array<{ t: number; body: KartContactBody; seen: boolean }>;
  late: boolean;
  /**
   * Out of touch. It comes back once it's clear of every other kart, so it
   * never returns inside one.
   */
  ghost: boolean;
  /** When it last came back into touch, in race time. */
  backAtUs: number;
};

type ContactKart = { id: string; shape: KartContactShape };

export class RoomContacts {
  private readonly tracks = new Map<string, Track>();
  /**
   * When each pair last touched, in race time, whichever kart's states
   * showed it, and when it was last seen apart after that. A touch is the
   * same one unless it comes after they were seen apart, or `partedUs`
   * after the last; a late kart's view of an earlier touch is the same one.
   */
  private readonly touched = new Map<
    string,
    { lastUs: number; apartUs: number }
  >();
  private nextId = 1;

  /** Starts afresh, for a new race. */
  clear() {
    this.tracks.clear();
    this.touched.clear();
    this.nextId = 1;
  }

  /**
   * A live state the room accepted from a kart, arriving at race time
   * `roomUs`, and every other kart in the race (one that has finished, left,
   * or dropped is swept only up to its last state, and is a ghost once
   * silent). It sweeps the kart's motion since its last state against where
   * each other kart was meanwhile, and returns the touches it opens.
   */
  live(
    kart: ContactKart,
    state: RoomKartState,
    roomUs: number,
    others: ContactKart[],
  ): RoomContact[] {
    const track = this.trackOf(kart.id);
    const previous = track.states.at(-1);
    const lateUs = roomUs - state.t;
    track.late =
      lateUs > (track.late ? ROOM_CONTACT.backUs : ROOM_CONTACT.lateUs);
    if (
      track.late ||
      state.o === true ||
      state.r ||
      // Back from a silence, it may be inside another kart. (Any kart still
      // sending has already made it a ghost; this covers both going quiet.)
      (previous && state.t - previous.t > ROOM_CONTACT.lateUs)
    ) {
      track.ghost = true;
    }
    const body = record(track, state);

    const tracked = others.flatMap((other) => {
      const otherTrack = this.tracks.get(other.id);
      if (!otherTrack) return [];
      // Silent too long by the room's clock, it's out of touch too.
      if (roomUs - otherTrack.states.at(-1)!.t > ROOM_CONTACT.lateUs) {
        otherTrack.ghost = true;
      }
      return [{ ...other, track: otherTrack }];
    });

    const opened: RoomContact[] = [];
    for (const other of tracked) {
      // Only a motion both karts made in touch can touch.
      if (
        !previous ||
        state.r ||
        track.ghost ||
        other.track.ghost ||
        previous.t < Math.max(track.backAtUs, other.track.backAtUs)
      ) {
        continue;
      }
      // Only as far as both karts' states show where they were, never an
      // estimate: the other kart's own next state sweeps the rest. Split at
      // the other kart's states between, so none of its known path is cut.
      const untilUs = Math.min(state.t, other.track.states.at(-1)!.t);
      if (untilUs <= previous.t) continue;
      const own = (atUs: number) =>
        atUs >= state.t
          ? body
          : betweenKartPoses(
              previous.body,
              body,
              (atUs - previous.t) / (state.t - previous.t),
            );
      const times = [
        previous.t,
        ...other.track.states
          .map(({ t }) => t)
          .filter((t) => t > previous.t && t < untilUs),
        untilUs,
      ];
      const key = [kart.id, other.id].sort().join(" ");
      for (let index = 0; index + 1 < times.length; index += 1) {
        const startUs = times[index];
        const endUs = times[index + 1];
        const fromB = poseAt(other.track, startUs);
        const toB = poseAt(other.track, endUs);
        // Before the other kart's first state: nothing known to sweep yet.
        if (!fromB || !toB) continue;
        const fromA = own(startUs);
        const toA = own(endUs);
        // Within the slop counts: pages stop karts just touching.
        const contact = sweepKartContact(
          { shape: kart.shape, from: fromA, to: toA },
          { shape: other.shape, from: fromB, to: toB },
          KART_CONTACT.slopMetres,
        );
        if (contact) {
          const touch = this.touch(key, kart, other, contact, {
            startUs,
            endUs,
            fromA,
            toA,
            fromB,
            toB,
          });
          if (touch) opened.push(touch);
        }
        // Touching or apart as the segment ends, where both are known: what
        // keeps a touch going, or shows they parted. Within the overlap left
        // alone they're still touching, so millimetre-rounded states of karts
        // driving on side by side don't part and touch again.
        const seen = this.touched.get(key);
        if (!seen) continue;
        const touchingAtEnd = kartsWithin(
          { shape: kart.shape, pose: toA },
          { shape: other.shape, pose: toB },
          KART_CONTACT.slopMetres,
        );
        if (touchingAtEnd) {
          if (!(seen.apartUs > seen.lastUs)) {
            seen.lastUs = Math.max(seen.lastUs, endUs);
          }
        } else if (endUs > seen.lastUs) {
          seen.apartUs = Math.max(seen.apartUs, endUs);
        }
      }
    }

    // Back in touch and clear of every other kart, it touches from here on.
    if (track.ghost && !track.late && state.o !== true && !state.r) {
      const clear = tracked.every(({ shape, track: otherTrack }) => {
        // Clear of everywhere the other may be: from its newest state to
        // where its motion carries it by now, since an estimate can't see it
        // stop. A kart silent longer is a ghost that must clear itself.
        const newest = otherTrack.states.at(-1)!;
        if (Math.abs(state.t - newest.t) > ROOM_CONTACT.lateUs) return true;
        const now = poseAt(otherTrack, state.t) ?? newest.body;
        return !sweepKartContact(
          { shape: kart.shape, from: body, to: body },
          { shape, from: newest.body, to: now },
        );
      });
      if (clear) {
        track.ghost = false;
        track.backAtUs = state.t;
      }
    }
    return opened;
  }

  /** The motion the room saw bring a kart to race time `atUs`, if any. */
  private motionInto(kartId: string, atUs: number) {
    const { states } = this.tracks.get(kartId)!;
    let index = states.length - 1;
    while (index > 0 && states[index].t > atUs) index -= 1;
    const { body, seen } = states[index];
    return seen ? { velocity: body.velocity, spin: body.spin } : null;
  }

  /**
   * A touch found in one segment both karts' states cover: the same touch
   * as the pair's last, which it extends, or a new one, which it opens.
   */
  private touch(
    key: string,
    kart: ContactKart,
    other: ContactKart,
    contact: KartContact,
    segment: {
      startUs: number;
      endUs: number;
      fromA: KartPose;
      toA: KartPose;
      fromB: KartPose;
      toB: KartPose;
    },
  ): RoomContact | null {
    const { startUs, endUs, fromA, toA, fromB, toB } = segment;
    const segmentUs = endUs - startUs;
    const touchUs = Math.round(startUs + contact.at * segmentUs);
    const seen = this.touched.get(key);
    const apartSince = seen !== undefined && seen.apartUs > seen.lastUs;
    // The same touch: soon after the last, or still pressed together at
    // this segment's start, with no separation seen between.
    if (
      seen &&
      !(apartSince && touchUs > seen.apartUs) &&
      (touchUs <= seen.lastUs + ROOM_CONTACT.partedUs || contact.at === 0)
    ) {
      if (!apartSince) seen.lastUs = Math.max(seen.lastUs, touchUs);
      return null;
    }
    // As they met: each kart with the motion the room saw bring it to the
    // segment, since the segment's own may already show the pages' answers;
    // or, without one, or one that doesn't close them (a kart turned back
    // into the other), the segment's own. Its nearest point just touching.
    const seconds = segmentUs / 1_000_000;
    const nearest = Math.max(...contact.points.map(({ depth }) => depth));
    const met =
      nearest < 0
        ? {
            ...contact,
            points: contact.points.map((point) => ({
              ...point,
              depth: point.depth - nearest,
            })),
          }
        : contact;
    const segmentA = moved(fromA, toA, seconds);
    const segmentB = moved(fromB, toB, seconds);
    const answer = (
      motionA: typeof segmentA,
      motionB: typeof segmentB,
    ) =>
      resolveKartContact(
        { shape: kart.shape, body: { ...fromA, ...motionA } },
        { shape: other.shape, body: { ...fromB, ...motionB } },
        met,
        seconds,
      );
    const response =
      answer(
        this.motionInto(kart.id, startUs) ?? segmentA,
        this.motionInto(other.id, startUs) ?? segmentB,
      ) ?? answer(segmentA, segmentB);
    if (!response) return null;
    this.touched.set(key, { lastUs: touchUs, apartUs: -Infinity });
    // Where they met: the answer's point, carried on with each kart to the
    // touch.
    const withA = carryKartPoint(
      response.point,
      fromA,
      betweenKartPoses(fromA, toA, contact.at),
    );
    const withB = carryKartPoint(
      response.point,
      fromB,
      betweenKartPoses(fromB, toB, contact.at),
    );
    const id = this.nextId;
    this.nextId += 1;
    return {
      id,
      t: touchUs,
      point: {
        x: (withA.x + withB.x) / 2,
        y: (withA.y + withB.y) / 2,
        z: (withA.z + withB.z) / 2,
      },
      a: kart.id,
      b: other.id,
      response,
    };
  }

  /**
   * A resent state the room accepted, from while its kart was away: history,
   * not motion to sweep, kept so its newest state (after any reset) is where
   * it really is. Others didn't see it meanwhile, so it's out of touch until
   * it's clear of them.
   */
  resent(kartId: string, state: RoomKartState) {
    const track = this.trackOf(kartId);
    record(track, state);
    track.ghost = true;
  }

  private trackOf(id: string) {
    let track = this.tracks.get(id);
    if (!track) {
      track = { states: [], late: false, ghost: false, backAtUs: -Infinity };
      this.tracks.set(id, track);
    }
    return track;
  }
}

/** Adds a state to a kart's track; returns its pose and motion. */
function record(track: Track, state: RoomKartState) {
  // A reset teleports: nothing before it is a motion to sweep.
  if (state.r) track.states = [];
  const previous = track.states.at(-1);
  const body = observed(state, previous);
  track.states.push({ t: state.t, body, seen: previous !== undefined });
  while (
    track.states.length > 2 &&
    track.states[0].t < state.t - ROOM_CONTACT.keepUs
  ) {
    track.states.shift();
  }
  return body;
}

/**
 * The racing race's karts the tracker sweeps: every one that loaded, even
 * one that has finished, left, or dropped, since it's swept only up to its
 * last state, so a touch another kart's later states show is still found,
 * and it's a ghost once silent.
 */
export function contactEntrants({ race }: Pick<RoomState, "race">) {
  return race && race.racingAt !== null
    ? race.entrants.filter(({ loaded }) => loaded)
    : [];
}

/** What one kart's page hears of a touch it's in. */
export function roomContactMessage(
  contact: RoomContact,
  playerId: string,
): Extract<RoomServerMessage, { type: "contact" }> {
  const { response } = contact;
  const first = playerId === contact.a;
  const toward = first ? 1 : -1;
  return {
    type: "contact",
    id: contact.id,
    t: contact.t,
    with: first ? contact.b : contact.a,
    n: triple(response.normal, toward, 4),
    p: triple(contact.point, 1, 3),
    c: round(Math.max(0, Math.min(200, response.closingSpeed)), 2),
    j: triple(response.impulse, -toward, 4, 999),
    k: triple(first ? response.turnA : response.turnB, 1, 4, 999),
  };
}

/**
 * A state's pose, with the motion the room saw bring it there from the
 * state before: still, without one.
 */
function observed(
  { t, p, q }: RoomKartState,
  previous?: { t: number; body: KartContactBody },
): KartContactBody {
  const pose = {
    position: { x: p[0], y: p[1], z: p[2] },
    rotation: normalize({ x: q[0], y: q[1], z: q[2], w: q[3] }),
  };
  if (!previous || t <= previous.t) {
    return { ...pose, velocity: ZERO, spin: ZERO };
  }
  return { ...pose, ...moved(previous.body, pose, (t - previous.t) / 1e6) };
}

/** The velocity and spin that carry one pose to another in `seconds`. */
function moved(from: KartPose, to: KartPose, seconds: number) {
  // The turn from one rotation to the other, the short way round.
  let turn = multiply(to.rotation, conjugate(from.rotation));
  if (turn.w < 0) turn = { w: -turn.w, x: -turn.x, y: -turn.y, z: -turn.z };
  const sine = Math.hypot(turn.x, turn.y, turn.z);
  const rate = Math.min(
    ROOM_CONTACT.maxSpin,
    (2 * Math.atan2(sine, turn.w)) / seconds,
  );
  return {
    velocity: {
      x: (to.position.x - from.position.x) / seconds,
      y: (to.position.y - from.position.y) / seconds,
      z: (to.position.z - from.position.z) / seconds,
    },
    spin:
      sine > 1e-9
        ? {
            x: (turn.x / sine) * rate,
            y: (turn.y / sine) * rate,
            z: (turn.z / sine) * rate,
          }
        : ZERO,
  };
}

/**
 * Where a kart was at race time `atUs`: between two of its states, or a
 * little past its newest one, carried on by the motion that brought it
 * there (only the clear check looks ahead); null outside them, or past a
 * lone state, whose motion isn't known.
 */
function poseAt({ states }: Track, atUs: number): KartPose | null {
  const newest = states.at(-1);
  if (!newest || atUs < states[0].t) return null;
  if (atUs === newest.t) return newest.body;
  if (atUs > newest.t) {
    const aheadUs = atUs - newest.t;
    if (aheadUs > ROOM_CONTACT.lateUs || states.length < 2) return null;
    return advanceKartPose(newest.body, aheadUs / 1e6);
  }
  const after = states.findIndex(({ t }) => t > atUs);
  const from = states[after - 1];
  const to = states[after];
  if (to.t - from.t > ROOM_CONTACT.lateUs) return null;
  return betweenKartPoses(from.body, to.body, (atUs - from.t) / (to.t - from.t));
}

const ZERO: RaceVector3 = { x: 0, y: 0, z: 0 };

function multiply(a: RaceQuaternion, b: RaceQuaternion): RaceQuaternion {
  return {
    w: a.w * b.w - a.x * b.x - a.y * b.y - a.z * b.z,
    x: a.w * b.x + a.x * b.w + a.y * b.z - a.z * b.y,
    y: a.w * b.y - a.x * b.z + a.y * b.w + a.z * b.x,
    z: a.w * b.z + a.x * b.y - a.y * b.x + a.z * b.w,
  };
}

function conjugate({ w, x, y, z }: RaceQuaternion): RaceQuaternion {
  return { w, x: -x, y: -y, z: -z };
}

function normalize(q: RaceQuaternion): RaceQuaternion {
  const size = Math.hypot(q.w, q.x, q.y, q.z) || 1;
  return { w: q.w / size, x: q.x / size, y: q.y / size, z: q.z / size };
}

function round(value: number, places: number) {
  return Number(value.toFixed(places)) || 0;
}

function triple(
  { x, y, z }: RaceVector3,
  by: number,
  places: number,
  most = Infinity,
): [number, number, number] {
  const fit = (value: number) =>
    round(Math.max(-most, Math.min(most, value * by)), places);
  return [fit(x), fit(y), fit(z)];
}

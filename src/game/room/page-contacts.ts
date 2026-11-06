import type { RaceVector3 } from "../race/race-gate";
import {
  advanceKartPose,
  kartsWithin,
  resolveKartContact,
  sweepKartContact,
  withKartImpulse,
  type KartContactBody,
  type KartContactShape,
} from "./kart-contact";
import type { OpponentEstimate } from "./opponent-motion";
import { ROOM_CONTACT } from "./room-contacts";
import type { RoomContactRecord } from "./room-race";

/**
 * A page's side of kart-to-kart contact (the kart-to-kart contact standard).
 * Each physics step it answers its own kart's touches with every opponent in
 * touch, at once, against where that opponent is now, and carries the
 * opponent's share on its estimate until the opponent's own states show it.
 * A room record of a touch it didn't answer is pushed once, while fresh.
 *
 * A kart out of touch neither touches nor is touched: this one when its
 * connection is too slow, it's finished, or it was just reset; an opponent
 * when its states run late, its page says so, or it was just reset. Either
 * comes back only once the two are clear, so nothing is pushed apart from
 * inside another kart. Free of the engine, so it's tested on its own.
 */

export const PAGE_CONTACT = {
  /** A room record older than this is no longer pushed... */
  freshUs: 500_000,
  /** ...nor one this near in time to a touch this page answered. */
  matchUs: 250_000,
  /** Touches answered are kept this long, to match the room's records. */
  keepUs: 2_000_000,
  /** A kart coming back in touch waits until the two are this far apart. */
  clearMetres: 0.05,
};

export type PageContactOpponent = {
  id: string;
  shape: KartContactShape;
  estimate: OpponentEstimate;
};

/** For `?perf=1` and tests. */
export type PageContactStats = {
  /** Steps this kart touched an opponent, summed over opponents. */
  touchingSteps: number;
  /** Room records of touches this page missed, pushed once each. */
  fills: number;
};

type Pair = {
  /** The opponent is out of touch, or back but not yet clear. */
  ghost: boolean;
  resets: number;
  /** When this page answered touches with it, as runs of steps. */
  touches: Array<{ fromUs: number; toUs: number }>;
};

export class PageContacts {
  private readonly pairs = new Map<string, Pair>();
  /** This kart is out of touch, or back but not yet clear of every other. */
  private ghost = false;
  private readonly seen = new Set<number>();
  readonly stats: PageContactStats = { touchingSteps: 0, fills: 0 };

  constructor(private readonly shape: KartContactShape) {}

  /**
   * One physics step from race time `atUs`, where `body` is this kart now:
   * its touches with each opponent, answered in turn. Returns this kart's
   * impulse and angular impulse, to apply before the step, and each touch's
   * closing speed. `out` says this kart is out of touch; `reset`, that it
   * was just reset.
   */
  step({
    atUs,
    stepSeconds,
    body,
    out,
    reset,
    opponents,
  }: {
    atUs: number;
    stepSeconds: number;
    body: KartContactBody;
    out: boolean;
    reset: boolean;
    opponents: readonly PageContactOpponent[];
  }) {
    if (out || reset) this.ghost = true;
    const own = { shape: this.shape, body };
    const impulse = { x: 0, y: 0, z: 0 };
    const turn = { x: 0, y: 0, z: 0 };
    const touches: Array<{ id: string; closingSpeed: number }> = [];
    const stepUs = stepSeconds * 1_000_000;
    let clear = true;
    for (const { id, shape, estimate } of opponents) {
      const from = estimate.present(atUs);
      if (!from) continue;
      const pair = this.pair(id, estimate.resets);
      pair.touches = pair.touches.filter(
        ({ toUs }) => toUs >= atUs - PAGE_CONTACT.keepUs,
      );
      const touchable = estimate.touchable(atUs);
      if (!touchable || estimate.resets !== pair.resets) pair.ghost = true;
      pair.resets = estimate.resets;
      const near = kartsWithin(
        { shape: this.shape, pose: own.body },
        { shape, pose: from },
        PAGE_CONTACT.clearMetres,
      );
      if (near) clear = false;
      else if (touchable) pair.ghost = false;
      if (pair.ghost || this.ghost) continue;

      const contact = sweepKartContact(
        {
          shape: this.shape,
          from: own.body,
          to: advanceKartPose(own.body, stepSeconds),
        },
        { shape, from, to: estimate.present(atUs + stepUs)! },
      );
      if (!contact) continue;
      const other = { shape, body: from };
      const response = resolveKartContact(own, other, contact, stepSeconds);
      if (!response) continue;
      // This kart takes the opposite of the other's impulse; each answer
      // moves it before the next, as each point's does within one.
      own.body = withKartImpulse(
        own,
        scale(response.impulse, -1),
        response.turnA,
      );
      addTo(impulse, scale(response.impulse, -1));
      addTo(turn, response.turnA);
      const pushed = withKartImpulse(other, response.impulse, response.turnB);
      estimate.carry(
        atUs,
        sub(pushed.velocity, from.velocity),
        sub(pushed.spin, from.spin),
      );
      const touchUs = atUs + contact.at * stepUs;
      const last = pair.touches.at(-1);
      if (last && touchUs - last.toUs <= ROOM_CONTACT.partedUs) {
        last.toUs = touchUs;
      } else {
        pair.touches.push({ fromUs: touchUs, toUs: touchUs });
      }
      this.stats.touchingSteps += 1;
      touches.push({ id, closingSpeed: response.closingSpeed });
    }
    if (this.ghost && !out && !reset && clear) this.ghost = false;
    return { impulse, turn, touches };
  }

  /**
   * The push to apply for a room record at race time `atUs`, once: null if
   * this page answered that touch, it's stale, this kart is out of touch,
   * or the record was seen before. Until the other kart's states reach the
   * touch, its opposite push is carried on its estimate, so this page
   * doesn't answer the same closing again; states from after it already
   * show what that kart did.
   */
  fill(
    record: RoomContactRecord,
    atUs: number,
    other?: Pick<PageContactOpponent, "shape" | "estimate">,
  ) {
    if (this.seen.has(record.id)) return null;
    this.seen.add(record.id);
    if (this.ghost || atUs - record.t > PAGE_CONTACT.freshUs) return null;
    const { matchUs } = PAGE_CONTACT;
    const answered = this.pairs
      .get(record.with)
      ?.touches.some(
        ({ fromUs, toUs }) =>
          record.t >= fromUs - matchUs && record.t <= toUs + matchUs,
      );
    if (answered) return null;
    this.stats.fills += 1;
    const impulse = vector(record.j);
    if (other && other.estimate.newestUs <= record.t) {
      other.estimate.carry(
        atUs,
        scale(impulse, -1 / other.shape.mass),
        { x: 0, y: 0, z: 0 },
        record.t,
      );
    }
    return { impulse, turn: vector(record.k), closingSpeed: record.c };
  }

  /** Whether an opponent is drawn see-through. */
  seeThrough(id: string) {
    return this.pairs.get(id)?.ghost ?? false;
  }

  /** Whether this kart is drawn see-through. */
  get ownSeeThrough() {
    return this.ghost;
  }

  private pair(id: string, resets: number) {
    let pair = this.pairs.get(id);
    if (!pair) {
      pair = { ghost: false, resets, touches: [] };
      this.pairs.set(id, pair);
    }
    return pair;
  }
}

function vector([x, y, z]: readonly [number, number, number]): RaceVector3 {
  return { x, y, z };
}

function addTo(target: RaceVector3, value: RaceVector3) {
  target.x += value.x;
  target.y += value.y;
  target.z += value.z;
}

function sub(a: RaceVector3, b: RaceVector3): RaceVector3 {
  return { x: a.x - b.x, y: a.y - b.y, z: a.z - b.z };
}

function scale(v: RaceVector3, by: number): RaceVector3 {
  return { x: v.x * by, y: v.y * by, z: v.z * by };
}

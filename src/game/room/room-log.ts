import {
  ROOM_CONTACT,
  type RoomTouchChange,
  type RoomTouchReason,
} from "./room-contacts";
import type { RoomEndReason } from "./room-protocol";
import type { RoomState } from "./room-rules";

/**
 * The room server's log lines (Cloudflare Workers Logs), one object each so
 * its fields can be queried. They name a seat only by the room's own ID
 * (`p1`, `p2`, …) and a race by its random ID: never a name, key, token,
 * room code, kart, or address.
 */
export type RoomLogLine =
  | {
      event: "out";
      race: string;
      seat: string;
      why: RoomTouchReason[];
      /** Race time, and how late its state reached the room. */
      raceMs: number;
      lateMs?: number;
      /** How far its state was from the one before. */
      gapMs?: number;
    }
  | { event: "in"; race: string; seat: string; raceMs: number; outMs: number }
  | { event: "race_start"; race: string; karts: number }
  | {
      event: "race_end";
      race: string;
      /** How it ended, or `cancelled` before anyone raced. */
      reason: RoomEndReason | "cancelled";
      seats: Record<string, RoomRaceTally>;
    }
  | {
      event: "joined" | "away" | "rejoined" | "left";
      seat: string;
      race?: string;
    }
  | { event: "closed" | "dropped"; seat: string; code: number }
  | { event: "silent"; seat: string };

/**
 * One seat's race: its outs by reason, the time it was out (counting outs
 * that ended), and live states refused.
 */
export type RoomRaceTally = {
  outs: Partial<Record<RoomTouchReason, number>>;
  outMs: number;
  refused: number;
  /** Outs and returns past the per-race line cap, counted only here. */
  unlogged: number;
};

/** Each seat's out and in lines a race logs; past it they're only counted. */
export const ROOM_LOG_TOUCH_LINES = 40;

const ms = (us: number) => Math.round(us / 1_000);

type Seat = {
  tally: RoomRaceTally;
  lines: number;
  /** Out for an expected reason, so neither it nor its return is logged. */
  quiet: boolean;
};

/**
 * Turns the room's changes into log lines: seats joining, dropping, coming
 * back, and leaving; each race's start, its karts going out of touch and
 * back, and its end with each entrant's tally. A race's tallies live in
 * memory, as a race keeps the room awake.
 */
export class RoomLog {
  private race: { id: string; seats: Map<string, Seat> } | null = null;

  constructor(private readonly write: (line: RoomLogLine) => void) {}

  /** The room's state before and after an event. */
  change(before: RoomState | null, after: RoomState) {
    const race = after.race ? { race: after.race.id } : {};
    const was = new Map((before?.players ?? []).map((p) => [p.id, p]));
    for (const player of after.players) {
      const previous = was.get(player.id);
      was.delete(player.id);
      const event = !previous
        ? "joined"
        : !previous.awaySince && player.awaySince
          ? "away"
          : previous.awaySince && !player.awaySince
            ? "rejoined"
            : null;
      if (event) this.write({ event, seat: player.id, ...race });
    }
    for (const seat of was.keys()) {
      this.write({ event: "left", seat, ...race });
    }

    const ended = before?.race;
    if (ended && ended.id !== after.race?.id) {
      this.write({
        event: "race_end",
        race: ended.id,
        reason:
          after.lastRace?.id === ended.id
            ? after.lastRace.endReason
            : "cancelled",
        seats: Object.fromEntries(
          ended.entrants.map(({ id }) => [id, this.seat(ended.id, id).tally]),
        ),
      });
      this.race = null;
    }
    const racing = after.race;
    if (
      racing?.racingAt != null &&
      (before?.race?.id !== racing.id || before.race.racingAt == null)
    ) {
      this.write({
        event: "race_start",
        race: racing.id,
        karts: racing.entrants.length,
      });
    }
  }

  /**
   * A kart going out of touch or back, in race `raceId`. `expected` marks
   * an out every race has (a kart's countdown or finish), which is neither
   * logged nor counted, and nor is a prompt return; one that comes back
   * late was out for more than its countdown, so its return is.
   */
  touch(raceId: string, change: RoomTouchChange, expected = false) {
    const seat = this.seat(raceId, change.kart);
    if (change.out && expected) seat.quiet = true;
    if (seat.quiet) {
      if (change.out) return;
      seat.quiet = false;
      if (change.outForUs <= ROOM_CONTACT.lateUs) return;
    }
    const { tally } = seat;
    if (change.out) {
      for (const reason of change.why) {
        tally.outs[reason] = (tally.outs[reason] ?? 0) + 1;
      }
    } else {
      tally.outMs += ms(change.outForUs);
    }
    if (seat.lines >= ROOM_LOG_TOUCH_LINES) {
      tally.unlogged += 1;
      return;
    }
    seat.lines += 1;
    const base = { race: raceId, seat: change.kart, raceMs: ms(change.atUs) };
    if (!change.out) {
      this.write({ event: "in", ...base, outMs: ms(change.outForUs) });
      return;
    }
    this.write({
      event: "out",
      ...base,
      why: change.why,
      ...(change.why.includes("late") && change.lateUs !== undefined
        ? { lateMs: ms(change.lateUs) }
        : {}),
      ...(change.why.includes("gap") && change.gapUs !== undefined
        ? { gapMs: ms(change.gapUs) }
        : {}),
    });
  }

  /** A live state the room refused, in race `raceId`. */
  refused(raceId: string, seat: string) {
    this.seat(raceId, seat).tally.refused += 1;
  }

  /** A socket closing, dropped for misbehaving, or gone silent. */
  socket(
    line: Extract<RoomLogLine, { event: "closed" | "dropped" | "silent" }>,
  ) {
    this.write(line);
  }

  /** A seat's tally this race, and what it has logged. */
  private seat(raceId: string, id: string) {
    if (this.race?.id !== raceId) this.race = { id: raceId, seats: new Map() };
    let seat = this.race.seats.get(id);
    if (!seat) {
      seat = {
        tally: { outs: {}, outMs: 0, refused: 0, unlogged: 0 },
        lines: 0,
        quiet: false,
      };
      this.race.seats.set(id, seat);
    }
    return seat;
  }
}

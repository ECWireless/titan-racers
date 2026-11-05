import {
  checkRaceStep,
  nearRaceResetPoint,
  raceGateCount,
  type RaceCheckSample,
  STEP_MICROSECONDS,
} from "../race/race-verification";
import {
  ROOM_FINISH_GRACE_MS,
  ROOM_LOAD_MS,
  ROOM_MAX_PLAYERS,
  ROOM_MIN_RACERS,
  ROOM_PROTOCOL,
  ROOM_RACE_LIMIT_MS,
  ROOM_START_DELAY_MS,
  type RoomClientMessage,
  type RoomEndReason,
  type RoomRaceReport,
  type RoomSnapshot,
} from "./room-protocol";
import type { RoomCourse, RoomToken } from "./room-signing";

/**
 * A private room's rules, free of any transport: each event takes the room
 * state and returns the next, so the room server only stores state, relays
 * the kart states it accepts, and broadcasts snapshots. Every wait has a
 * deadline, checked on every event; nextRoomDeadline says when to check
 * again if nothing happens.
 *
 * Each client drives its own kart, and the room decides what counts: it
 * checks every state against the one before, as solo's run check does a
 * recording, and times gates and finishes from the states that pass.
 */

/**
 * A state's race time may run this far ahead of the room's clock, since
 * the page's estimate of that clock is off by up to half a round trip.
 */
const ROOM_CLOCK_SLACK_US = 250_000;

type RoomKart = RoomToken["karts"][number];
export type RoomKartState = Omit<
  Extract<RoomClientMessage, { type: "state" }>,
  "type"
>;
/** An accepted state, as later states are checked against it. */
type CheckedState = Pick<RaceCheckSample, "position" | "timeMicroseconds">;

export type RoomPlayerState = {
  id: string;
  key: string;
  name: string;
  signedIn: boolean;
  karts: RoomKart[];
  kartId: string | null;
  ready: boolean;
};

export type RoomEntrantState = {
  id: string;
  /** Grid slot, in join order. */
  slot: number;
  name: string;
  signedIn: boolean;
  kartId: string;
  kartRevision: number;
  loaded: boolean;
  gates: number;
  /** The state that passed the latest gate, which orders the unfinished. */
  lastGate: CheckedState | null;
  /**
   * The latest accepted state. It changes with every state but is stored
   * only with a reset or the next change, so after a restart it can be an
   * older one on the same stretch, which only loosens the next check.
   */
  last: CheckedState | null;
  finishMicroseconds: number | null;
  finishedAt: number | null;
  left: boolean;
};

export type RoomState = {
  protocol: number;
  code: string;
  courseId: string;
  courseRevision: number;
  /** The first joiner's course, which every state is checked against. */
  course: RoomCourse;
  physicsVersion: string;
  /** In join order; the first player hosts. */
  players: RoomPlayerState[];
  nextPlayer: number;
  nextGuest: number;
  race: {
    id: string;
    entrants: RoomEntrantState[];
    loadDeadline: number;
    racingAt: number | null;
    firstFinishAt: number | null;
  } | null;
  lastRace: RoomSnapshot["lastRace"];
};

export type RoomEvent =
  | { type: "join"; now: number; token: RoomToken }
  | { type: "leave"; now: number; playerId: string }
  | { type: "tick"; now: number }
  | { type: "choose_kart"; now: number; playerId: string; kartId: string }
  | { type: "start"; now: number; playerId: string; raceId: string }
  | { type: "loaded"; now: number; playerId: string; raceId: string }
  | { type: "state"; now: number; playerId: string; state: RoomKartState };

export type RoomOutcome = {
  state: RoomState;
  /** The snapshot changed, so broadcast it. */
  changed: boolean;
  joined?: { playerId: string; replaced: boolean };
  /** A kart state passed its checks, so relay it. */
  accepted?: boolean;
  /**
   * Store the state without broadcasting it: an accepted reset, which a
   * restart must not forget, since later states are checked from it.
   */
  persist?: boolean;
  /** Why a join was refused; the socket closes with that code. */
  refused?: "full" | "version";
  /** A finished race, to send to the app. */
  report?: RoomRaceReport;
};

/** A new room, fixed to its first player's course and versions. */
export function createRoomState(token: RoomToken): RoomState {
  return {
    protocol: ROOM_PROTOCOL,
    code: token.room,
    courseId: token.courseId,
    courseRevision: token.courseRevision,
    course: token.course,
    physicsVersion: token.physicsVersion,
    players: [],
    nextPlayer: 1,
    nextGuest: 1,
    race: null,
    lastRace: null,
  };
}

export function hostId(state: RoomState) {
  return state.players[0]?.id ?? null;
}

export function nextRoomDeadline(state: RoomState) {
  const race = state.race;
  if (!race) return null;
  if (race.racingAt === null) return race.loadDeadline;
  return raceEndsBy(race.racingAt, race.firstFinishAt);
}

function raceEndsBy(racingAt: number, firstFinishAt: number | null) {
  const limit = racingAt + ROOM_RACE_LIMIT_MS;
  return firstFinishAt === null
    ? limit
    : Math.min(limit, firstFinishAt + ROOM_FINISH_GRACE_MS);
}

export function applyRoomEvent(
  current: RoomState,
  event: RoomEvent,
): RoomOutcome {
  const state = structuredClone(current);
  const outcome: RoomOutcome = { state, changed: false };
  // A deadline that passed before this event holds, however late the alarm.
  settle(outcome, event.now);
  let changed = false;
  switch (event.type) {
    case "join":
      join(outcome, event.token);
      break;
    case "leave":
      changed = leave(state, event.playerId);
      break;
    case "choose_kart":
      changed = chooseKart(state, event.playerId, event.kartId);
      break;
    case "start":
      changed = start(state, event);
      break;
    case "loaded":
      changed = loaded(state, event.playerId, event.raceId);
      break;
    case "state":
      changed = kartState(outcome, event);
      break;
    case "tick":
      break;
  }
  outcome.changed ||= changed;
  settle(outcome, event.now);
  return outcome;
}

function join(outcome: RoomOutcome, token: RoomToken) {
  const { state } = outcome;
  if (
    token.protocol !== state.protocol ||
    token.courseId !== state.courseId ||
    token.physicsVersion !== state.physicsVersion
  ) {
    outcome.refused = "version";
    return;
  }
  const existing = state.players.find(({ key }) => key === token.player.key);
  if (existing) {
    // The same account from another tab takes its seat.
    existing.karts = token.karts;
    if (!existing.karts.some(({ id }) => id === existing.kartId)) {
      existing.kartId = null;
      existing.ready = false;
    }
    outcome.joined = { playerId: existing.id, replaced: true };
    outcome.changed = true;
    return;
  }
  if (state.players.length >= ROOM_MAX_PLAYERS) {
    outcome.refused = "full";
    return;
  }
  const { username, signedIn, key } = token.player;
  const id = `p${state.nextPlayer}`;
  state.nextPlayer += 1;
  let name: string;
  if (username) {
    name = `@${username}`;
  } else {
    name = `Guest ${state.nextGuest}`;
    state.nextGuest += 1;
  }
  state.players.push({
    id,
    key,
    name,
    signedIn,
    karts: token.karts,
    kartId: null,
    ready: false,
  });
  outcome.joined = { playerId: id, replaced: false };
  outcome.changed = true;
}

function leave(state: RoomState, playerId: string) {
  const index = state.players.findIndex(({ id }) => id === playerId);
  if (index < 0) return false;
  state.players.splice(index, 1);
  const race = state.race;
  if (race) {
    if (race.racingAt === null) {
      // Leaving while loading sits the race out.
      race.entrants = race.entrants.filter(({ id }) => id !== playerId);
    } else {
      const entrant = race.entrants.find(({ id }) => id === playerId);
      if (entrant) entrant.left = true;
    }
  }
  return true;
}

function entrantOf(state: RoomState, playerId: string, raceId: string) {
  if (state.race?.id !== raceId) return null;
  const entrant = state.race.entrants.find(({ id }) => id === playerId);
  return entrant && !entrant.left ? entrant : null;
}

function chooseKart(state: RoomState, playerId: string, kartId: string) {
  const player = state.players.find(({ id }) => id === playerId);
  if (!player || !player.karts.some(({ id }) => id === kartId)) return false;
  if (state.race?.entrants.some(({ id }) => id === playerId)) return false;
  if (player.kartId === kartId && player.ready) return false;
  player.kartId = kartId;
  player.ready = true;
  return true;
}

function start(
  state: RoomState,
  { now, playerId, raceId }: { now: number; playerId: string; raceId: string },
) {
  if (state.race || hostId(state) !== playerId) return false;
  const ready = state.players.filter(
    (player) =>
      player.ready && player.karts.some(({ id }) => id === player.kartId),
  );
  if (ready.length < ROOM_MIN_RACERS) return false;
  state.race = {
    id: raceId,
    entrants: ready.map((player, slot) => ({
      id: player.id,
      slot,
      name: player.name,
      signedIn: player.signedIn,
      kartId: player.kartId!,
      kartRevision: player.karts.find(({ id }) => id === player.kartId)!
        .revision,
      loaded: false,
      gates: 0,
      lastGate: null,
      last: null,
      finishMicroseconds: null,
      finishedAt: null,
      left: false,
    })),
    loadDeadline: now + ROOM_LOAD_MS,
    racingAt: null,
    firstFinishAt: null,
  };
  state.lastRace = null;
  return true;
}

function loaded(state: RoomState, playerId: string, raceId: string) {
  const entrant = entrantOf(state, playerId, raceId);
  if (!entrant || entrant.loaded || state.race?.racingAt !== null) {
    return false;
  }
  entrant.loaded = true;
  return true;
}

function vector([x, y, z]: readonly [number, number, number]) {
  return { x, y, z };
}

/**
 * Checks one kart state; one that passes is relayed, and one that crosses
 * a gate counts it, timing the finish from its own race time. It must
 * follow the kart's last accepted state by the run check's rules, and its
 * race time may not run ahead of the room's clock. The first is checked
 * against its grid slot, as far as the speed cap reaches in its race time.
 * Returns whether the snapshot changed.
 */
function kartState(
  outcome: RoomOutcome,
  event: { now: number; playerId: string; state: RoomKartState },
) {
  const { state } = outcome;
  const race = state.race;
  if (!race || race.racingAt === null) return false;
  const entrant = race.entrants.find(({ id }) => id === event.playerId);
  if (!entrant?.loaded || entrant.left || entrant.finishMicroseconds !== null) {
    return false;
  }
  const { t, p, r, g } = event.state;
  // Through the countdown, a kart waits on the grid at race time zero.
  const roomMicroseconds = Math.max(0, event.now - race.racingAt) * 1_000;
  if (t > roomMicroseconds + ROOM_CLOCK_SLACK_US) return false;

  const sample = { timeMicroseconds: t, position: vector(p), reset: r };
  const samples: RaceCheckSample[] = g
    ? [
        {
          timeMicroseconds: t - STEP_MICROSECONDS,
          position: vector(g),
          reset: false,
          gate: false,
        },
        { ...sample, gate: true },
      ]
    : [{ ...sample, gate: false }];
  let previous = entrant.last ?? entrant.lastGate;
  for (const [index, next] of samples.entries()) {
    if (!previous) {
      // Only the race's first state has nothing before it.
      if (
        next.reset ||
        next.gate ||
        !nearRaceResetPoint(
          next.position,
          state.course.grid[entrant.slot],
          next.timeMicroseconds,
        )
      ) {
        return false;
      }
    } else if (
      checkRaceStep(
        state.course,
        entrant.gates,
        previous,
        next,
        // A crossing's step before may be the state just accepted.
        g && index === 0 ? 0 : STEP_MICROSECONDS,
      )
    ) {
      return false;
    }
    previous = next;
  }
  outcome.accepted = true;
  entrant.last = { timeMicroseconds: t, position: sample.position };
  if (r) outcome.persist = true;
  if (!g) return false;

  entrant.gates += 1;
  entrant.lastGate = entrant.last;
  if (entrant.gates === raceGateCount(state.course)) {
    entrant.finishMicroseconds = Math.max(1, t);
    entrant.finishedAt = event.now;
    race.firstFinishAt ??= event.now;
  }
  return true;
}

/** Applies every deadline and end rule that holds at `now`. */
function settle(outcome: RoomOutcome, now: number) {
  const { state } = outcome;
  const race = state.race;
  if (!race) return;

  if (race.racingAt === null) {
    const allLoaded = race.entrants.every(({ loaded }) => loaded);
    if (!allLoaded && now < race.loadDeadline) return;
    const sittingOut = new Set(
      race.entrants.filter(({ loaded }) => !loaded).map(({ id }) => id),
    );
    for (const player of state.players) {
      if (sittingOut.has(player.id)) player.ready = false;
    }
    race.entrants = race.entrants.filter(({ loaded }) => loaded);
    if (race.entrants.length < ROOM_MIN_RACERS) {
      state.race = null;
    } else {
      race.racingAt = now + ROOM_START_DELAY_MS;
    }
    outcome.changed = true;
    return;
  }

  const stillRacing = race.entrants.some(
    ({ finishMicroseconds, left }) => !left && finishMicroseconds === null,
  );
  let endReason: RoomEndReason | null = null;
  if (!stillRacing) {
    endReason = race.entrants.some(
      ({ finishMicroseconds }) => finishMicroseconds !== null,
    )
      ? "all_finished"
      : "everyone_left";
  } else if (now >= raceEndsBy(race.racingAt, race.firstFinishAt)) {
    // Whichever deadline came first, however late this check runs.
    endReason =
      race.firstFinishAt !== null &&
      race.firstFinishAt + ROOM_FINISH_GRACE_MS <
        race.racingAt + ROOM_RACE_LIMIT_MS
        ? "after_first_finish"
        : "time_limit";
  }
  if (endReason) endRace(outcome, endReason, now);
}

/**
 * Standing order: finishers by time, then everyone else, whether racing or
 * gone, by gates passed and who reached their last gate soonest in race
 * time.
 */
function compareStanding(a: RoomEntrantState, b: RoomEntrantState) {
  if (a.finishMicroseconds !== null || b.finishMicroseconds !== null) {
    if (a.finishMicroseconds === null) return 1;
    if (b.finishMicroseconds === null) return -1;
    return (
      a.finishMicroseconds - b.finishMicroseconds ||
      a.finishedAt! - b.finishedAt! ||
      a.slot - b.slot
    );
  }
  return (
    b.gates - a.gates ||
    (a.lastGate?.timeMicroseconds ?? Infinity) -
      (b.lastGate?.timeMicroseconds ?? Infinity) ||
    a.slot - b.slot
  );
}

function standings(entrants: RoomEntrantState[]) {
  return [...entrants].sort(compareStanding);
}

function endRace(outcome: RoomOutcome, endReason: RoomEndReason, now: number) {
  const { state } = outcome;
  const race = state.race!;
  const order = standings(race.entrants);
  state.lastRace = {
    id: race.id,
    endReason,
    entries: order.map((entrant, index) => ({
      place: index + 1,
      id: entrant.id,
      name: entrant.name,
      kartId: entrant.kartId,
      timeMicroseconds: entrant.finishMicroseconds,
    })),
  };
  // A race everyone left before the start raced no one, so isn't recorded.
  if (now >= race.racingAt!) {
    outcome.report = {
      version: 1,
      raceId: race.id,
      roomCode: state.code,
      courseId: state.courseId,
      courseRevision: state.courseRevision,
      physicsVersion: state.physicsVersion,
      racingAt: race.racingAt!,
      endedAt: now,
      endReason,
      entries: order.map((entrant, index) => ({
        place: index + 1,
        kartId: entrant.kartId,
        kartRevision: entrant.kartRevision,
        timeMicroseconds: entrant.finishMicroseconds,
        signedIn: entrant.signedIn,
      })),
    };
  }
  // Racers choose again for the next race; their kart stays picked.
  const entrantIds = new Set(race.entrants.map(({ id }) => id));
  for (const player of state.players) {
    if (entrantIds.has(player.id)) player.ready = false;
  }
  state.race = null;
  outcome.changed = true;
}

/** The snapshot every player in the room receives. */
export function roomSnapshot(state: RoomState): RoomSnapshot {
  const race = state.race;
  return {
    type: "room",
    code: state.code,
    courseId: state.courseId,
    courseRevision: state.courseRevision,
    hostId: hostId(state),
    phase: !race ? "lobby" : race.racingAt === null ? "loading" : "racing",
    players: state.players.map(({ id, name, kartId, ready }) => ({
      id,
      name,
      kartId,
      ready,
    })),
    race: race && {
      id: race.id,
      entrants: standings(race.entrants).map((entrant) => ({
        id: entrant.id,
        slot: entrant.slot,
        name: entrant.name,
        kartId: entrant.kartId,
        kartRevision: entrant.kartRevision,
        finishMicroseconds: entrant.finishMicroseconds,
        left: entrant.left,
      })),
      racingAt: race.racingAt,
      endsBy:
        race.racingAt === null
          ? null
          : raceEndsBy(race.racingAt, race.firstFinishAt),
    },
    lastRace: state.lastRace,
  };
}

import {
  ROOM_FINISH_GRACE_MS,
  ROOM_LOAD_MS,
  ROOM_MAX_PLAYERS,
  ROOM_MIN_RACERS,
  ROOM_PROTOCOL,
  ROOM_RACE_LIMIT_MS,
  ROOM_START_DELAY_MS,
  type RoomEndReason,
  type RoomRaceReport,
  type RoomSnapshot,
} from "./room-protocol";
import type { RoomToken } from "./room-signing";

/**
 * A private room's rules, free of any transport: each event takes the room
 * state and returns the next, so the room server only stores state, relays
 * kart states, and broadcasts snapshots. Every wait has a deadline, checked
 * on every event; nextRoomDeadline says when to check again if nothing
 * happens.
 */

/** A finish time may be this much earlier than the server heard it... */
const FINISH_EARLY_US = 2_000_000;
/** ...or this much later, since the client's clock reads the room's. */
const FINISH_LATE_US = 250_000;

export type RoomKart = RoomToken["karts"][number];

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
  lastGateAt: number | null;
  finishMicroseconds: number | null;
  finishedAt: number | null;
  left: boolean;
};

export type RoomState = {
  protocol: number;
  code: string;
  courseId: string;
  courseRevision: number;
  gateCount: number;
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
  | {
      type: "gate";
      now: number;
      playerId: string;
      raceId: string;
      gates: number;
    }
  | {
      type: "finish";
      now: number;
      playerId: string;
      raceId: string;
      timeMicroseconds: number;
    };

export type RoomOutcome = {
  state: RoomState;
  /** The snapshot changed, so broadcast it. */
  changed: boolean;
  joined?: { playerId: string; replaced: boolean };
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
    gateCount: token.gateCount,
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

/** Whether a player's kart states should reach the others. */
export function canRelayState(state: RoomState, playerId: string) {
  const entrant = state.race?.entrants.find(({ id }) => id === playerId);
  return Boolean(
    state.race?.racingAt != null && entrant && !entrant.left && entrant.loaded,
  );
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
    case "gate":
      changed = gate(state, event);
      break;
    case "finish":
      changed = finish(state, event);
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
      lastGateAt: null,
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

function racingEntrant(
  state: RoomState,
  playerId: string,
  raceId: string,
  now: number,
) {
  const racingAt = state.race?.racingAt;
  if (racingAt == null || now < racingAt) return null;
  const entrant = entrantOf(state, playerId, raceId);
  return entrant && entrant.finishMicroseconds === null ? entrant : null;
}

// Every gate but the last; the finish message passes the last.
function gate(
  state: RoomState,
  event: { now: number; playerId: string; raceId: string; gates: number },
) {
  const entrant = racingEntrant(state, event.playerId, event.raceId, event.now);
  if (
    !entrant ||
    event.gates !== entrant.gates + 1 ||
    event.gates >= state.gateCount
  ) {
    return false;
  }
  entrant.gates = event.gates;
  entrant.lastGateAt = event.now;
  return true;
}

function finish(
  state: RoomState,
  event: {
    now: number;
    playerId: string;
    raceId: string;
    timeMicroseconds: number;
  },
) {
  const entrant = racingEntrant(state, event.playerId, event.raceId, event.now);
  const race = state.race;
  if (!entrant || !race || entrant.gates !== state.gateCount - 1) {
    return false;
  }
  const heard = (event.now - race.racingAt!) * 1_000;
  const claimed = event.timeMicroseconds;
  entrant.finishMicroseconds =
    claimed >= heard - FINISH_EARLY_US && claimed <= heard + FINISH_LATE_US
      ? claimed
      : heard;
  entrant.finishedAt = event.now;
  entrant.gates = state.gateCount;
  entrant.lastGateAt = event.now;
  race.firstFinishAt ??= event.now;
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
 * Standing order: finishers by time, then those still racing, then those
 * who left, each by gates passed and who reached their last gate first.
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
  if (a.left !== b.left) return a.left ? 1 : -1;
  return (
    b.gates - a.gates ||
    (a.lastGateAt ?? Infinity) - (b.lastGateAt ?? Infinity) ||
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
    players: state.players.map(({ id, name, signedIn, kartId, ready }) => ({
      id,
      name,
      signedIn,
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
        loaded: entrant.loaded,
        gates: entrant.gates,
        finishMicroseconds: entrant.finishMicroseconds,
        left: entrant.left,
      })),
      loadDeadline: race.loadDeadline,
      racingAt: race.racingAt,
      endsBy:
        race.racingAt === null
          ? null
          : raceEndsBy(race.racingAt, race.firstFinishAt),
    },
    lastRace: state.lastRace,
  };
}

import { z } from "zod";

/**
 * The private-room wire protocol, shared by the app and the room server.
 * Messages are JSON text frames, `{ type, ... }`, checked strictly. One
 * version is live at a time: it travels in the signed join token, and the
 * room server refuses any other with ROOM_CLOSE.version. Raise it whenever
 * a message's shape or meaning changes, then deploy the room server and the
 * app back to back.
 */
export const ROOM_PROTOCOL = 1;

export const ROOM_MAX_PLAYERS = 4;
export const ROOM_MIN_RACERS = 2;
/** Entrants have this long to load before the race goes on without them. */
export const ROOM_LOAD_MS = 30_000;
/** Racing starts this long after the last entrant loads. */
export const ROOM_START_DELAY_MS = 4_000;
/** The race ends this long after its first finisher. */
export const ROOM_FINISH_GRACE_MS = 30_000;
/** No room race runs longer than this. */
export const ROOM_RACE_LIMIT_MS = 10 * 60_000;
/** Opponent states are sent this many times a second. */
export const ROOM_STATE_HZ = 10;
/** The longest text frame the room server accepts from a client. */
export const ROOM_MAX_CLIENT_FRAME_CHARS = 1_024;
/** The longest text frame a client accepts from the room server. */
const ROOM_MAX_SERVER_FRAME_CHARS = 16_384;

/** Close codes, each with its own player copy. */
export const ROOM_CLOSE = {
  closed: 4000,
  full: 4001,
  version: 4002,
  token: 4003,
  replaced: 4004,
  protocol: 4005,
} as const;
export type RoomCloseCode = (typeof ROOM_CLOSE)[keyof typeof ROOM_CLOSE];

// 31 letters and digits, without look-alikes (0/o, 1/i/l).
const ROOM_CODE_ALPHABET = "abcdefghjkmnpqrstuvwxyz23456789";
const ROOM_CODE_LENGTH = 10;
export const ROOM_CODE_PATTERN = /^[abcdefghjkmnpqrstuvwxyz2-9]{10}$/;

/** A random room code: about 50 bits, so a link can't be guessed. */
export function createRoomCode() {
  const limit = 256 - (256 % ROOM_CODE_ALPHABET.length);
  let code = "";
  while (code.length < ROOM_CODE_LENGTH) {
    for (const byte of crypto.getRandomValues(new Uint8Array(16))) {
      if (byte >= limit) continue;
      code += ROOM_CODE_ALPHABET[byte % ROOM_CODE_ALPHABET.length];
      if (code.length === ROOM_CODE_LENGTH) break;
    }
  }
  return code;
}

export function isRoomCode(value: unknown): value is string {
  return typeof value === "string" && ROOM_CODE_PATTERN.test(value);
}

const raceId = z.uuid();
const playerId = z.string().regex(/^p[1-9][0-9]{0,5}$/);
const kartId = z.string().min(1).max(80);
const bounded = (limit: number) => z.number().min(-limit).max(limit);
const microseconds = z.number().int().min(0).max(ROOM_RACE_LIMIT_MS * 1_000);
const gates = z.number().int().min(0).max(1_000);

/** A kart pose: race time, root position, visual rotation, steer, reset. */
const kartState = {
  t: microseconds,
  p: z.tuple([bounded(2e6), bounded(2e6), bounded(2e6)]),
  q: z.tuple([bounded(1.01), bounded(1.01), bounded(1.01), bounded(1.01)]),
  s: bounded(90),
  /** The first state after a reset teleport; never blend into it. */
  r: z.boolean(),
};

export const clientMessageSchema = z.discriminatedUnion("type", [
  z.strictObject({ type: z.literal("ping"), t: z.number() }),
  z.strictObject({ type: z.literal("choose_kart"), kartId }),
  z.strictObject({ type: z.literal("start") }),
  z.strictObject({ type: z.literal("loaded"), raceId }),
  z.strictObject({ type: z.literal("state"), ...kartState }),
  z.strictObject({ type: z.literal("gate"), raceId, gates }),
  z.strictObject({
    type: z.literal("finish"),
    raceId,
    timeMicroseconds: microseconds,
  }),
]);
export type RoomClientMessage = z.infer<typeof clientMessageSchema>;

const roomPlayer = z.strictObject({
  id: playerId,
  name: z.string().min(1).max(40),
  signedIn: z.boolean(),
  kartId: kartId.nullable(),
  ready: z.boolean(),
});

const raceEntrant = z.strictObject({
  id: playerId,
  /** Grid slot, in join order. */
  slot: z.number().int().min(0).max(ROOM_MAX_PLAYERS - 1),
  name: z.string().min(1).max(40),
  kartId,
  kartRevision: z.number().int().positive(),
  loaded: z.boolean(),
  gates,
  finishMicroseconds: microseconds.nullable(),
  left: z.boolean(),
});

export const ROOM_END_REASONS = [
  "all_finished",
  "after_first_finish",
  "time_limit",
  "everyone_left",
] as const;
export type RoomEndReason = (typeof ROOM_END_REASONS)[number];

const raceResultEntry = z.strictObject({
  place: z.number().int().min(1).max(ROOM_MAX_PLAYERS),
  id: playerId,
  name: z.string().min(1).max(40),
  kartId,
  timeMicroseconds: microseconds.nullable(),
});

const serverTime = z.number().int().positive();

export const roomSnapshotSchema = z.strictObject({
  type: z.literal("room"),
  code: z.string().regex(ROOM_CODE_PATTERN),
  courseId: z.string().min(1).max(80),
  courseRevision: z.number().int().positive(),
  hostId: playerId.nullable(),
  phase: z.enum(["lobby", "loading", "racing"]),
  players: z.array(roomPlayer).max(ROOM_MAX_PLAYERS),
  race: z
    .strictObject({
      id: raceId,
      /** Entrants in standing order. */
      entrants: z.array(raceEntrant).max(ROOM_MAX_PLAYERS),
      loadDeadline: serverTime,
      racingAt: serverTime.nullable(),
      /** When the race will end at the latest, once racing. */
      endsBy: serverTime.nullable(),
    })
    .nullable(),
  lastRace: z
    .strictObject({
      id: raceId,
      endReason: z.enum(ROOM_END_REASONS),
      entries: z.array(raceResultEntry).max(ROOM_MAX_PLAYERS),
    })
    .nullable(),
});
export type RoomSnapshot = z.infer<typeof roomSnapshotSchema>;

export const serverMessageSchema = z.discriminatedUnion("type", [
  z.strictObject({ type: z.literal("welcome"), you: playerId }),
  z.strictObject({
    type: z.literal("pong"),
    t: z.number(),
    serverAt: serverTime,
  }),
  roomSnapshotSchema,
  z.strictObject({ type: z.literal("state"), from: playerId, ...kartState }),
]);
export type RoomServerMessage = z.infer<typeof serverMessageSchema>;

/** Parses one text frame, or returns null for anything malformed. */
function parseFrame<T>(
  schema: z.ZodType<T>,
  frame: unknown,
  maxChars: number,
): T | null {
  if (typeof frame !== "string" || frame.length > maxChars) {
    return null;
  }
  let json: unknown;
  try {
    json = JSON.parse(frame);
  } catch {
    return null;
  }
  const parsed = schema.safeParse(json);
  return parsed.success ? parsed.data : null;
}

export function parseClientMessage(frame: unknown) {
  return parseFrame(clientMessageSchema, frame, ROOM_MAX_CLIENT_FRAME_CHARS);
}

export function parseServerMessage(frame: unknown) {
  return parseFrame(serverMessageSchema, frame, ROOM_MAX_SERVER_FRAME_CHARS);
}

/** What the room server reports to the app for each finished race. */
export const roomRaceReportSchema = z.strictObject({
  version: z.literal(1),
  raceId,
  roomCode: z.string().regex(ROOM_CODE_PATTERN),
  courseId: z.string().min(1).max(80),
  courseRevision: z.number().int().positive(),
  physicsVersion: z.string().min(1).max(80),
  racingAt: serverTime,
  endedAt: serverTime,
  endReason: z.enum(ROOM_END_REASONS),
  entries: z
    .array(
      z.strictObject({
        place: z.number().int().min(1).max(ROOM_MAX_PLAYERS),
        kartId,
        kartRevision: z.number().int().positive(),
        timeMicroseconds: microseconds.nullable(),
        signedIn: z.boolean(),
      }),
    )
    .min(1)
    .max(ROOM_MAX_PLAYERS),
});
export type RoomRaceReport = z.infer<typeof roomRaceReportSchema>;

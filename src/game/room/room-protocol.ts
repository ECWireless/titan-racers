import { z } from "zod";

import { kartStableIdSchema } from "../kart/kart-assembly-document";

/**
 * The private-room wire protocol, shared by the app and the room server.
 * Messages are JSON text frames, `{ type, ... }`, checked strictly. One
 * version is live at a time: it travels in the signed join token, and the
 * room server refuses any other with ROOM_CLOSE.version. Raise it whenever
 * a message's shape or meaning changes, then deploy the room server and the
 * app back to back.
 */
export const ROOM_PROTOCOL = 2;

export const ROOM_MAX_PLAYERS = 4;
export const ROOM_MIN_RACERS = 2;
/** Entrants have this long to load before the race goes on without them. */
export const ROOM_LOAD_MS = 30_000;
/** Racing starts this long after the last entrant loads. */
export const ROOM_START_DELAY_MS = 4_000;
/** The race ends this long after its first finisher. */
export const ROOM_FINISH_GRACE_MS = 30_000;
/**
 * A dropped connection keeps its seat this long, in the lobby or a race,
 * while the page reconnects.
 */
export const ROOM_SEAT_HOLD_MS = 30_000;
/** No room race runs longer than this. */
export const ROOM_RACE_LIMIT_MS = 10 * 60_000;
/** Opponent states are sent this many times a second. */
export const ROOM_STATE_HZ = 10;
/** The most states a page resends in one frame after it reconnects. */
export const ROOM_RESEND_BATCH = 20;
/** The longest text frame the room server accepts from a client. */
const ROOM_MAX_CLIENT_FRAME_CHARS = 4_096;
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
  /** The room heard nothing for too long; the page may reconnect. */
  silent: 4006,
} as const;

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
const kartId = kartStableIdSchema;
/** A course ID, as course documents spell them. */
export const roomCourseIdSchema = z
  .string()
  .min(1)
  .max(80)
  .regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/);
/** A physics version name, as physics-version.ts spells them. */
export const roomPhysicsVersionSchema = z
  .string()
  .min(1)
  .max(80)
  .regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/);
const bounded = (limit: number) => z.number().min(-limit).max(limit);
const microseconds = z.number().int().min(0).max(ROOM_RACE_LIMIT_MS * 1_000);
/** A stored revision: positive, and within Postgres's integer. */
export const roomRevisionSchema = z.number().int().positive().max(2 ** 31 - 1);

const position = z.tuple([bounded(2e6), bounded(2e6), bounded(2e6)]);

/**
 * A kart's state at one fixed step: race time, root position, visual
 * rotation, velocity, steer, and reset. The room checks each one; see
 * room-rules.ts.
 */
const kartStateFields = {
  t: microseconds,
  p: position,
  q: z.tuple([bounded(1.01), bounded(1.01), bounded(1.01), bounded(1.01)]),
  /** Metres a second, so a curve between two states needs no third. */
  v: z.tuple([bounded(100), bounded(100), bounded(100)]),
  s: bounded(90),
  /** The first state after a reset teleport; never blend into it. */
  r: z.boolean(),
  /**
   * The step that crosses a gate also carries where the kart was one step
   * before, so the room checks the same crossing the race did.
   */
  g: position.optional(),
};
const kartState = z.strictObject(kartStateFields);

const clientMessageSchema = z.discriminatedUnion("type", [
  z.strictObject({ type: z.literal("ping"), t: z.number() }),
  z.strictObject({ type: z.literal("choose_kart"), kartId }),
  z.strictObject({ type: z.literal("start") }),
  z.strictObject({ type: z.literal("loaded"), raceId }),
  z.strictObject({ type: z.literal("state"), ...kartStateFields }),
  /** States the room missed while this page was away, oldest first. */
  z.strictObject({
    type: z.literal("states"),
    states: z.array(kartState).min(1).max(ROOM_RESEND_BATCH),
  }),
  /** This page can't race this race (its course or kart failed). */
  z.strictObject({ type: z.literal("sit_out"), raceId }),
]);
export type RoomClientMessage = z.infer<typeof clientMessageSchema>;

const roomPlayer = z.strictObject({
  id: playerId,
  name: z.string().min(1).max(40),
  kartId: kartId.nullable(),
  ready: z.boolean(),
  /** False while the seat is held for a dropped connection. */
  connected: z.boolean(),
});

const raceEntrant = z.strictObject({
  id: playerId,
  /** Grid slot, in join order. */
  slot: z.number().int().min(0).max(ROOM_MAX_PLAYERS - 1),
  name: z.string().min(1).max(40),
  kartId,
  kartRevision: roomRevisionSchema,
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

// Milliseconds since 1970, before 2100.
const serverTime = z.number().int().positive().max(4_102_444_800_000);

export const roomSnapshotSchema = z.strictObject({
  type: z.literal("room"),
  code: z.string().regex(ROOM_CODE_PATTERN),
  courseId: roomCourseIdSchema,
  courseRevision: roomRevisionSchema,
  hostId: playerId.nullable(),
  phase: z.enum(["lobby", "loading", "racing"]),
  players: z.array(roomPlayer).max(ROOM_MAX_PLAYERS),
  race: z
    .strictObject({
      id: raceId,
      /** Entrants in standing order. */
      entrants: z.array(raceEntrant).max(ROOM_MAX_PLAYERS),
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

const serverMessageSchema = z.discriminatedUnion("type", [
  z.strictObject({
    type: z.literal("welcome"),
    you: playerId,
    /**
     * Racing on, the race time of the last state the room accepted from
     * this seat (-1 for none), so the page resends what came after.
     */
    resume: z.number().int().min(-1).max(ROOM_RACE_LIMIT_MS * 1_000).nullable(),
  }),
  z.strictObject({
    type: z.literal("pong"),
    t: z.number(),
    serverAt: serverTime,
  }),
  roomSnapshotSchema,
  z.strictObject({
    type: z.literal("state"),
    from: playerId,
    ...kartStateFields,
  }),
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
  courseId: roomCourseIdSchema,
  courseRevision: roomRevisionSchema,
  physicsVersion: roomPhysicsVersionSchema,
  racingAt: serverTime,
  endedAt: serverTime,
  endReason: z.enum(ROOM_END_REASONS),
  entries: z
    .array(
      z.strictObject({
        place: z.number().int().min(1).max(ROOM_MAX_PLAYERS),
        kartId,
        kartRevision: roomRevisionSchema,
        // A finish takes time; rules floor it at 1 µs.
        timeMicroseconds: microseconds.min(1).nullable(),
        signedIn: z.boolean(),
      }),
    )
    .min(1)
    .max(ROOM_MAX_PLAYERS),
});
export type RoomRaceReport = z.infer<typeof roomRaceReportSchema>;

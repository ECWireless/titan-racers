import { z } from "zod";

import { kartStableIdSchema } from "../kart/kart-assembly-document";
import {
  ROOM_CODE_PATTERN,
  ROOM_MAX_PLAYERS,
  roomCourseIdSchema,
  roomPhysicsVersionSchema,
  roomRevisionSchema,
} from "./room-protocol";

/**
 * Signatures between the app and the room server, on Web Crypto so the same
 * code runs in Node and in a Cloudflare Worker. Both sides hold
 * ROOM_SERVER_SECRET; each use derives a key of its own from it.
 */
export const ROOM_TOKEN_LIFETIME_MS = 60_000;
/** How far ahead of the room server's clock the app's may run. */
export const ROOM_TOKEN_CLOCK_SKEW_MS = 5_000;
/** Room tokens travel in a URL, which Cloudflare caps at 16 KB. */
export const ROOM_TOKEN_MAX_CHARS = 12_288;
/** A result report older or newer than this is refused. */
export const ROOM_REPORT_WINDOW_MS = 5 * 60_000;

const encoder = new TextEncoder();
const keys = new Map<string, Promise<CryptoKey>>();

function derivedKey(untrimmed: string, purpose: string) {
  const secret = untrimmed.trim();
  if (secret.length < 32) {
    throw new Error("ROOM_SERVER_SECRET must contain at least 32 characters.");
  }
  const id = `${purpose}\n${secret}`;
  let key = keys.get(id);
  if (!key) {
    key = (async () => {
      const base = await crypto.subtle.importKey(
        "raw",
        encoder.encode(secret),
        { name: "HMAC", hash: "SHA-256" },
        false,
        ["sign"],
      );
      const derived = await crypto.subtle.sign(
        "HMAC",
        base,
        encoder.encode(purpose),
      );
      return crypto.subtle.importKey(
        "raw",
        derived,
        { name: "HMAC", hash: "SHA-256" },
        false,
        ["sign", "verify"],
      );
    })();
    keys.set(id, key);
  }
  return key;
}

const TOKEN_PURPOSE = "titan-racers room token v1";
const PLAYER_PURPOSE = "titan-racers room player v1";
const REPORT_PURPOSE = "titan-racers room report v1";

function toBase64Url(bytes: Uint8Array) {
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary)
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/, "");
}

function fromBase64Url(text: string) {
  if (!/^[A-Za-z0-9_-]*$/.test(text) || text.length % 4 === 1) return null;
  const binary = atob(
    text.replace(/-/g, "+").replace(/_/g, "/") +
      "=".repeat((4 - (text.length % 4)) % 4),
  );
  return Uint8Array.from(binary, (char) => char.charCodeAt(0));
}

async function sign(secret: string, purpose: string, payload: string) {
  const key = await derivedKey(secret, purpose);
  return toBase64Url(
    new Uint8Array(
      await crypto.subtle.sign("HMAC", key, encoder.encode(payload)),
    ),
  );
}

// Web Crypto's verify compares in constant time.
async function verify(
  secret: string,
  purpose: string,
  payload: string,
  signature: string,
) {
  const bytes = fromBase64Url(signature);
  if (!bytes || bytes.length !== 32) return false;
  const key = await derivedKey(secret, purpose);
  return crypto.subtle.verify("HMAC", key, bytes, encoder.encode(payload));
}

const PLAYER_KEY_PATTERN = /^[A-Za-z0-9_-]{43}$/;

const vector = z.strictObject({
  x: z.number().min(-1e5).max(1e5),
  y: z.number().min(-1e5).max(1e5),
  z: z.number().min(-1e5).max(1e5),
});
const unit = z.number().min(-1.01).max(1.01);
const gate = z.strictObject({
  center: vector,
  forward: z.strictObject({ x: unit, y: unit, z: unit }),
  halfExtents: vector,
  worldToLocalRotation: z.strictObject({ w: unit, x: unit, y: unit, z: unit }),
});
/** The most checkpoints a room's course may have, so its token fits a URL. */
export const ROOM_COURSE_CHECKPOINT_LIMIT = 16;

/**
 * What the room checks each kart's states against: the course's gates and
 * reset points, as `createRaceSessionConfig` has them, and where each grid
 * slot starts.
 */
export const roomCourseSchema = z.strictObject({
  lapCount: z.number().int().min(1).max(10),
  grid: z.array(vector).length(ROOM_MAX_PLAYERS),
  startGate: gate,
  startRecovery: z.strictObject({ position: vector }),
  checkpoints: z
    .array(
      z.strictObject({
        gate,
        recovery: z.strictObject({ position: vector }),
      }),
    )
    .min(1)
    .max(ROOM_COURSE_CHECKPOINT_LIMIT),
});
export type RoomCourse = z.infer<typeof roomCourseSchema>;

const roomTokenSchema = z.strictObject({
  version: z.literal(1),
  protocol: z.number().int().positive(),
  room: z.string().regex(ROOM_CODE_PATTERN),
  expiresAt: z.number().int().positive(),
  courseId: roomCourseIdSchema,
  courseRevision: roomRevisionSchema,
  course: roomCourseSchema,
  physicsVersion: roomPhysicsVersionSchema,
  /** The official karts this player may race, at their published revisions. */
  karts: z
    .array(
      z.strictObject({
        id: kartStableIdSchema,
        revision: roomRevisionSchema,
      }),
    )
    .min(1)
    .max(16),
  player: z
    .strictObject({
      /** Stable for one account in one room; random for a guest. */
      key: z.string().regex(PLAYER_KEY_PATTERN),
      username: z
        .string()
        .regex(/^[a-z0-9_]{3,20}$/)
        .nullable(),
      signedIn: z.boolean(),
    })
    .refine(({ signedIn, username }) => signedIn || username === null, {
      message: "Guests have no username.",
    }),
});
export type RoomToken = z.infer<typeof roomTokenSchema>;
export type RoomTokenFields = Omit<RoomToken, "version" | "expiresAt">;

/** A token too long for its URL: its course has too much to carry. */
export class RoomTokenTooLongError extends Error {}

export async function signRoomToken(
  secret: string,
  fields: RoomTokenFields,
  now = Date.now(),
) {
  const token: RoomToken = roomTokenSchema.parse({
    ...fields,
    version: 1,
    expiresAt: now + ROOM_TOKEN_LIFETIME_MS,
  });
  const payload = toBase64Url(encoder.encode(JSON.stringify(token)));
  const signed = `${payload}.${await sign(secret, TOKEN_PURPOSE, payload)}`;
  if (signed.length > ROOM_TOKEN_MAX_CHARS) {
    throw new RoomTokenTooLongError();
  }
  return signed;
}

/** A token the app signed that has not expired, or null. */
export async function readRoomToken(
  secret: string,
  token: string,
  now = Date.now(),
) {
  if (token.length > ROOM_TOKEN_MAX_CHARS) return null;
  const [payload, signature, extra] = token.split(".");
  if (!payload || !signature || extra !== undefined) return null;
  if (!(await verify(secret, TOKEN_PURPOSE, payload, signature))) return null;
  const bytes = fromBase64Url(payload);
  if (!bytes) return null;
  let parsed;
  try {
    parsed = roomTokenSchema.safeParse(
      JSON.parse(new TextDecoder().decode(bytes)),
    );
  } catch {
    return null;
  }
  if (!parsed.success) return null;
  const { expiresAt } = parsed.data;
  return expiresAt < now ||
    expiresAt > now + ROOM_TOKEN_LIFETIME_MS + ROOM_TOKEN_CLOCK_SKEW_MS
    ? null
    : parsed.data;
}

/**
 * A signed-in account's key in one room. The room server can tell the same
 * account joining twice but never sees the account ID, and without the
 * secret, keys from different rooms can't be linked.
 */
export async function roomPlayerKey(
  secret: string,
  roomCode: string,
  userId: string,
) {
  return sign(secret, PLAYER_PURPOSE, `${roomCode}\n${userId}`);
}

export function randomRoomPlayerKey() {
  return toBase64Url(crypto.getRandomValues(new Uint8Array(32)));
}

export const ROOM_REPORT_SIGNATURE_HEADER = "x-room-signature";

/** The signature header for a result report's exact body. */
export async function signRoomReport(
  secret: string,
  body: string,
  now = Date.now(),
) {
  const signedAt = Math.floor(now);
  const signature = await sign(secret, REPORT_PURPOSE, `${signedAt}.${body}`);
  return `t=${signedAt},s=${signature}`;
}

/** Whether a report's body was signed by the room server, recently. */
export async function verifyRoomReport(
  secret: string,
  header: string | null,
  body: string,
  now = Date.now(),
) {
  const match = /^t=([1-9][0-9]{0,15}),s=([A-Za-z0-9_-]{43})$/.exec(
    header ?? "",
  );
  if (!match) return false;
  const signedAt = Number(match[1]);
  if (Math.abs(now - signedAt) > ROOM_REPORT_WINDOW_MS) return false;
  return verify(secret, REPORT_PURPOSE, `${signedAt}.${body}`, match[2]);
}

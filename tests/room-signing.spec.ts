import { expect, test } from "@playwright/test";

import { ROOM_PROTOCOL } from "../src/game/room/room-protocol";
import {
  randomRoomPlayerKey,
  readRoomToken,
  ROOM_REPORT_WINDOW_MS,
  ROOM_TOKEN_CLOCK_SKEW_MS,
  ROOM_TOKEN_LIFETIME_MS,
  roomPlayerKey,
  signRoomReport,
  signRoomToken,
  verifyRoomReport,
  type RoomTokenFields,
} from "../src/game/room/room-signing";

const SECRET = "a-room-server-secret-of-at-least-32-chars";
const NOW = 1_800_000_000_000;

function fields(player: Partial<RoomTokenFields["player"]> = {}) {
  return {
    protocol: ROOM_PROTOCOL,
    room: "abcdefghjk",
    courseId: "falls-view-park",
    courseRevision: 11,
    gateCount: 8,
    physicsVersion: "support-heave-v1",
    karts: [{ id: "kestrel", revision: 3 }],
    player: {
      key: randomRoomPlayerKey(),
      username: null,
      signedIn: false,
      ...player,
    },
  } satisfies RoomTokenFields;
}

test.describe("room tokens", () => {
  test("round-trip until they expire", async () => {
    const issued = fields({ username: "ada", signedIn: true });
    const token = await signRoomToken(SECRET, issued, NOW);
    expect(await readRoomToken(SECRET, token, NOW)).toEqual({
      ...issued,
      version: 1,
      expiresAt: NOW + ROOM_TOKEN_LIFETIME_MS,
    });
    expect(
      await readRoomToken(SECRET, token, NOW + ROOM_TOKEN_LIFETIME_MS),
    ).not.toBeNull();
    expect(
      await readRoomToken(SECRET, token, NOW + ROOM_TOKEN_LIFETIME_MS + 1),
    ).toBeNull();
    // The app's clock may run a little ahead, but not far.
    expect(
      await readRoomToken(SECRET, token, NOW - ROOM_TOKEN_CLOCK_SKEW_MS),
    ).not.toBeNull();
    expect(
      await readRoomToken(SECRET, token, NOW - ROOM_TOKEN_CLOCK_SKEW_MS - 1),
    ).toBeNull();
  });

  test("refuse tampering, another secret, and malformed tokens", async () => {
    const token = await signRoomToken(SECRET, fields(), NOW);
    const [payload, signature] = token.split(".");
    const forged = Buffer.from(
      Buffer.from(payload, "base64url")
        .toString("utf8")
        .replace('"signedIn":false', '"signedIn":true'),
    ).toString("base64url");
    for (const bad of [
      `${forged}.${signature}`,
      `${payload}.${signature.slice(0, -2)}AA`,
      `${payload}.${signature}.extra`,
      payload,
      "",
      "!!!.???",
    ]) {
      expect(await readRoomToken(SECRET, bad, NOW)).toBeNull();
    }
    expect(
      await readRoomToken(`${SECRET}-rotated`, token, NOW),
    ).toBeNull();
  });

  test("never give a guest a username, and need a long secret", async () => {
    await expect(
      signRoomToken(SECRET, fields({ username: "ada" }), NOW),
    ).rejects.toThrow();
    await expect(signRoomToken("short", fields(), NOW)).rejects.toThrow(
      /ROOM_SERVER_SECRET/,
    );
  });

  test("give an account one key per room", async () => {
    const key = await roomPlayerKey(SECRET, "abcdefghjk", "user-1");
    expect(key).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(await roomPlayerKey(SECRET, "abcdefghjk", "user-1")).toBe(key);
    expect(await roomPlayerKey(SECRET, "abcdefghjm", "user-1")).not.toBe(key);
    expect(await roomPlayerKey(SECRET, "abcdefghjk", "user-2")).not.toBe(key);
    expect(randomRoomPlayerKey()).not.toBe(randomRoomPlayerKey());
  });
});

test.describe("room reports", () => {
  test("verify the exact body, recently signed", async () => {
    const body = JSON.stringify({ raceId: "r", entries: [] });
    const header = await signRoomReport(SECRET, body, NOW);
    expect(header).toMatch(/^t=\d+,s=[A-Za-z0-9_-]{43}$/);
    expect(await verifyRoomReport(SECRET, header, body, NOW + 1_000)).toBe(
      true,
    );
    expect(await verifyRoomReport(SECRET, header, `${body} `, NOW)).toBe(false);
    expect(
      await verifyRoomReport(
        SECRET,
        header,
        body,
        NOW + ROOM_REPORT_WINDOW_MS + 1,
      ),
    ).toBe(false);
    expect(
      await verifyRoomReport(
        SECRET,
        header,
        body,
        NOW - ROOM_REPORT_WINDOW_MS - 1,
      ),
    ).toBe(false);
    expect(
      await verifyRoomReport(
        SECRET,
        header.replace(`t=${NOW}`, `t=${NOW + 1}`),
        body,
        NOW,
      ),
    ).toBe(false);
    expect(await verifyRoomReport(`${SECRET}!`, header, body, NOW)).toBe(false);
    expect(await verifyRoomReport(SECRET, null, body, NOW)).toBe(false);
    expect(await verifyRoomReport(SECRET, "t=1,s=x", body, NOW)).toBe(false);
  });
});

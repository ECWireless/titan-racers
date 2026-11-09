import { expect, test } from "@playwright/test";

import {
  FALLS_VIEW_PARK_DOCUMENT,
  getCourseStartTransform,
} from "../src/game/course/course-document";
import { createBalancedKartDocument } from "../src/game/kart/balanced-kart-document";
import { deriveKartSnapshot } from "../src/game/kart/kart-derivation";
import { kartContactShape } from "../src/game/room/kart-contact";
import { createRoomCourse } from "../src/game/room/room-course";
import { ROOM_DOOR_LIMIT, ROOM_PROTOCOL } from "../src/game/room/room-protocol";
import {
  randomRoomPlayerKey,
  readRoomToken,
  ROOM_COURSE_CHECKPOINT_LIMIT,
  RoomTokenTooLongError,
  ROOM_REPORT_WINDOW_MS,
  ROOM_TOKEN_CLOCK_SKEW_MS,
  ROOM_TOKEN_LIFETIME_MS,
  roomContactShape,
  roomKartContact,
  roomPlayerKey,
  signRoomReport,
  signRoomToken,
  verifyRoomReport,
  type RoomTokenFields,
} from "../src/game/room/room-signing";
import { straightRoomCourse, TEST_KART_CONTACT } from "./support/room-course";

const SECRET = "a-room-server-secret-of-at-least-32-chars";
const NOW = 1_800_000_000_000;

function fields(player: Partial<RoomTokenFields["player"]> = {}) {
  return {
    protocol: ROOM_PROTOCOL,
    room: "abcdefghjk",
    courseId: "falls-view-park",
    courseRevision: 11,
    course: straightRoomCourse(2, [10, 20]),
    physicsVersion: "support-heave-v1",
    karts: [{ id: "kestrel", revision: 3, contact: TEST_KART_CONTACT }],
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

  test("carry each kart's contact as its published snapshot gives it", async () => {
    const snapshot = deriveKartSnapshot(createBalancedKartDocument());
    expect(roomContactShape(roomKartContact(snapshot))).toEqual(
      kartContactShape(snapshot),
    );
    // Inertia the room couldn't invert is refused before it's signed.
    const flat = { ...TEST_KART_CONTACT, inertia: [1, 1, 1, 1, 0, 0] };
    await expect(
      signRoomToken(
        SECRET,
        { ...fields(), karts: [{ id: "kestrel", revision: 3, contact: flat }] } as RoomTokenFields,
        NOW,
      ),
    ).rejects.toThrow();
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

test.describe("room courses", () => {
  test("fit a token at the most checkpoints and doors a room allows", async () => {
    const [checkpoint] = FALLS_VIEW_PARK_DOCUMENT.checkpoints;
    // Far out and turned every way, so every number is long.
    const awkward = (index: number) => -9_876.543_21 + index / 7;
    const door = FALLS_VIEW_PARK_DOCUMENT.objects.find(({ door }) => door)!;
    const largest = createRoomCourse({
      ...FALLS_VIEW_PARK_DOCUMENT,
      objects: Array.from({ length: ROOM_DOOR_LIMIT }, (_, index) => ({
        ...door,
        // As long as a course object's ID may be.
        id: `door-${index}-`.padEnd(80, "x"),
        transform: {
          ...door.transform,
          position: { x: awkward(index), y: awkward(-index), z: awkward(index) },
        },
      })),
      checkpoints: Array.from(
        { length: ROOM_COURSE_CHECKPOINT_LIMIT },
        (_, index) => ({
          ...checkpoint,
          id: `checkpoint-${index}`,
          position: { x: awkward(index), y: awkward(-index), z: awkward(index) },
          rotation: { x: 13.7 + index, y: 47.3 - index, z: 5.1 * index },
          recovery: {
            ...checkpoint.recovery,
            position: { x: awkward(-index), y: 1 / 3, z: awkward(index) },
          },
        }),
      ),
    });
    const most = {
      ...fields({ username: "a".repeat(20), signedIn: true }),
      karts: Array.from({ length: 16 }, (_, index) => ({
        id: `kart-with-a-long-name-${index}`,
        revision: 2 ** 31 - 1,
        contact: TEST_KART_CONTACT,
      })),
    };
    for (const course of [
      createRoomCourse(FALLS_VIEW_PARK_DOCUMENT),
      largest,
    ]) {
      const token = await signRoomToken(SECRET, { ...most, course }, NOW);
      // JSON carries -0 as 0.
      expect((await readRoomToken(SECRET, token, NOW))?.course).toEqual(
        JSON.parse(JSON.stringify(course)),
      );
    }
    // With every number at full length, a course is too long for a URL.
    const lengthen = (value: unknown): unknown =>
      typeof value === "string"
        ? value
        : typeof value === "number"
        ? Math.abs(value) <= 1.01
          ? -0.123_456_789_012_345_67
          : -9_999.123_456_789_012
        : Array.isArray(value)
          ? value.map(lengthen)
          : Object.fromEntries(
              Object.entries(value as object).map(([key, child]) => [
                key,
                lengthen(child),
              ]),
            );
    const unrounded = {
      ...(lengthen(largest) as typeof largest),
      lapCount: largest.lapCount,
    };
    await expect(
      signRoomToken(SECRET, { ...most, course: unrounded }, NOW),
    ).rejects.toBeInstanceOf(RoomTokenTooLongError);
  });

  test("line up each grid slot as PlayCanvas would", async () => {
    const { Quat, Vec3 } = await import(
      "playcanvas/build/playcanvas/src/index.js"
    );
    const start = getCourseStartTransform(FALLS_VIEW_PARK_DOCUMENT);
    const rotation = new Quat().setFromEulerAngles(
      start.rotation.x,
      start.rotation.y,
      start.rotation.z,
    );
    // Two by two: 0.5 m either side of the line's centre, rows 0.8 m apart.
    const offsets = [
      [-0.5, 0],
      [0.5, 0],
      [-0.5, 0.8],
      [0.5, 0.8],
    ];
    createRoomCourse(FALLS_VIEW_PARK_DOCUMENT).grid.forEach((slot, index) => {
      const [right, back] = offsets[index];
      const offset = rotation.transformVector(new Vec3(right, 0, back));
      expect(slot.x).toBeCloseTo(start.position.x + offset.x, 9);
      expect(slot.y).toBeCloseTo(start.position.y + offset.y, 9);
      expect(slot.z).toBeCloseTo(start.position.z + offset.z, 9);
    });
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

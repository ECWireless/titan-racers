import { randomUUID } from "node:crypto";

import { expect, test } from "@playwright/test";
import { eq } from "drizzle-orm";

import { GET as getPublishedCourse } from "../src/app/api/courses/[courseId]/published/route";
import { POST as postRoomToken } from "../src/app/api/rooms/[code]/token/route";
import { POST as postRoomResults } from "../src/app/api/rooms/results/route";
import { db } from "../src/db/client";
import { roomRaceEntries, roomRaces, users } from "../src/db/schema";
import { FALLS_VIEW_PARK_DOCUMENT } from "../src/game/course/course-document";
import { FALLS_VIEW_PARK_COURSE_ID } from "../src/game/course/course-ids";
import { createBalancedKartDocument } from "../src/game/kart/balanced-kart-document";
import { OFFICIAL_KART_IDS } from "../src/game/kart/official-kart-roster";
import { CURRENT_PHYSICS_VERSION } from "../src/game/physics/physics-version";
import { createRoomCourse } from "../src/game/room/room-course";
import {
  createRoomCode,
  ROOM_PROTOCOL,
  type RoomRaceReport,
} from "../src/game/room/room-protocol";
import {
  readRoomToken,
  ROOM_REPORT_SIGNATURE_HEADER,
  roomPlayerKey,
  signRoomReport,
} from "../src/game/room/room-signing";
import {
  loadLatestCoursePublication,
  publishCourseRevision,
  saveCourseRevision,
} from "../src/server/course-repository";
import {
  publishKartRevision,
  saveKartRevision,
} from "../src/server/kart-repository";
import { testAuth } from "./support/test-auth";

const requiredIntegrationVariables = [
  "DATABASE_URL",
  "BETTER_AUTH_SECRET",
  "BETTER_AUTH_URL",
] as const;
const ORIGIN = process.env.BETTER_AUTH_URL ?? "http://127.0.0.1:3873";
// This test process only; the app reads it per request.
const SECRET = "rooms-spec-secret-of-at-least-32-characters";
process.env.ROOM_SERVER_SECRET = SECRET;

function tokenRequest(
  code: string,
  { body = "{}", headers = new Headers(), origin = ORIGIN } = {},
) {
  return postRoomToken(
    new Request(`${ORIGIN}/api/rooms/${code}/token`, {
      body,
      headers: new Headers([
        ...headers.entries(),
        ["content-type", "application/json"],
        ["origin", origin],
      ]),
      method: "POST",
    }),
    { params: Promise.resolve({ code }) },
  );
}

async function tokenFor(code: string, headers?: Headers, body?: string) {
  const response = await tokenRequest(code, { body, headers });
  expect(response.status).toBe(200);
  const { token } = (await response.json()) as { token: string };
  return (await readRoomToken(SECRET, token))!;
}

async function account({
  username = true,
  isAnonymous = false,
}: { username?: boolean; isAnonymous?: boolean } = {}) {
  const authContext = await testAuth.$context;
  const email = `${randomUUID()}@example.invalid`;
  let id: string;
  if (username) {
    id = (
      await authContext.test.saveUser(
        authContext.test.createUser({ email, name: "Room racer" }),
      )
    ).id;
  } else {
    id = randomUUID();
    await db
      .insert(users)
      .values({ email, emailVerified: true, id, isAnonymous, name: "racer" });
  }
  const { headers } = await authContext.test.login({ userId: id });
  const [row] = await db
    .select({ username: users.username })
    .from(users)
    .where(eq(users.id, id));
  return { headers, id, username: row.username };
}

/** A fresh published course and kart, so results never touch real rows. */
async function publishedRace() {
  const author = await account();
  const courseId = `rooms-${randomUUID()}`;
  const kartId = `rooms-${randomUUID()}`;
  await saveCourseRevision({
    authorUserId: author.id,
    document: { ...structuredClone(FALLS_VIEW_PARK_DOCUMENT), courseId },
    expectedRevision: null,
  });
  await publishCourseRevision({
    courseId,
    expectedPublicationId: null,
    publishedByUserId: author.id,
    revision: 1,
  });
  await saveKartRevision({
    authorUserId: author.id,
    document: createBalancedKartDocument(kartId),
    expectedRevision: null,
    ownerUserId: author.id,
  });
  await publishKartRevision({
    actorUserId: author.id,
    expectedPublicationEventId: null,
    kartId,
    revision: 1,
  });
  const racingAt = Date.now() - 90_000;
  return {
    version: 1,
    raceId: randomUUID(),
    roomCode: createRoomCode(),
    courseId,
    courseRevision: 1,
    physicsVersion: CURRENT_PHYSICS_VERSION,
    racingAt,
    endedAt: racingAt + 75_000,
    endReason: "after_first_finish",
    entries: [
      {
        place: 1,
        kartId,
        kartRevision: 1,
        timeMicroseconds: 44_500_000,
        signedIn: true,
      },
      {
        place: 2,
        kartId,
        kartRevision: 1,
        timeMicroseconds: null,
        signedIn: false,
      },
    ],
  } satisfies RoomRaceReport;
}

async function report(
  body: string,
  { signedAt = Date.now(), secret = SECRET } = {},
) {
  return postRoomResults(
    new Request(`${ORIGIN}/api/rooms/results`, {
      body,
      headers: {
        "content-type": "application/json",
        [ROOM_REPORT_SIGNATURE_HEADER]: await signRoomReport(
          secret,
          body,
          signedAt,
        ),
      },
      method: "POST",
    }),
  );
}

test.describe("private rooms", () => {
  test.beforeEach(() => {
    test.skip(
      requiredIntegrationVariables.some((name) => !process.env[name]?.trim()),
      "Database and auth environment variables are required for room tests.",
    );
  });

  test("signs a guest into the current course with the official karts", async () => {
    const code = createRoomCode();
    const token = await tokenFor(code);
    const publication = (await loadLatestCoursePublication(
      FALLS_VIEW_PARK_COURSE_ID,
    ))!;
    expect(token).toMatchObject({
      protocol: ROOM_PROTOCOL,
      room: code,
      courseId: FALLS_VIEW_PARK_COURSE_ID,
      courseRevision: publication.revision,
      // JSON carries -0 as 0.
      course: JSON.parse(JSON.stringify(createRoomCourse(publication.document))),
      physicsVersion: CURRENT_PHYSICS_VERSION,
      player: { username: null, signedIn: false },
    });
    expect(token.karts.map(({ id }) => id).sort()).toEqual(
      [...OFFICIAL_KART_IDS].sort(),
    );
    // A guest's key is new each time, so a refresh is a new seat...
    expect((await tokenFor(code)).player.key).not.toBe(token.player.key);
    // ...unless its page sends its seat secret, to retake its seat.
    const seat = (name: string) =>
      JSON.stringify({ seat: name.repeat(43).slice(0, 43) });
    const held = (await tokenFor(code, undefined, seat("a"))).player.key;
    expect(held).not.toBe(token.player.key);
    expect((await tokenFor(code, undefined, seat("a"))).player.key).toBe(held);
    expect((await tokenFor(code, undefined, seat("b"))).player.key).not.toBe(
      held,
    );
    expect(
      (await tokenFor(createRoomCode(), undefined, seat("a"))).player.key,
    ).not.toBe(held);
  });

  test("gives an account the same key in a room, and no account ID", async () => {
    const named = await account();
    const code = createRoomCode();
    const token = await tokenFor(code, named.headers);
    expect(token.player).toEqual({
      key: await roomPlayerKey(SECRET, code, named.id),
      username: named.username,
      signedIn: true,
    });
    expect(JSON.stringify(token)).not.toContain(named.id);
    expect((await tokenFor(code, named.headers)).player.key).toBe(
      token.player.key,
    );
    // An account's seat is its own, whatever secret its page holds.
    expect(
      (
        await tokenFor(
          code,
          named.headers,
          JSON.stringify({ seat: "c".repeat(43) }),
        )
      ).player.key,
    ).toBe(token.player.key);
    expect(
      (await tokenFor(createRoomCode(), named.headers)).player.key,
    ).not.toBe(token.player.key);

    // Accounts kept in a browser, and those without a username yet, are
    // signed in without a name.
    for (const unnamed of [
      await account({ username: false, isAnonymous: true }),
      await account({ username: false }),
    ]) {
      expect((await tokenFor(code, unnamed.headers)).player).toMatchObject({
        username: null,
        signedIn: true,
      });
    }
  });

  test("refuses joins it can't sign", async () => {
    expect((await tokenRequest("not-a-room")).status).toBe(404);
    const code = createRoomCode();
    for (const body of ['{"x":1}', '{"seat":"short"}', "not json"]) {
      expect((await tokenRequest(code, { body })).status).toBe(400);
    }
    expect(
      (await tokenRequest(code, { origin: "https://elsewhere.example" }))
        .status,
    ).toBe(403);
    const secret = process.env.ROOM_SERVER_SECRET;
    delete process.env.ROOM_SERVER_SECRET;
    try {
      expect((await tokenRequest(code)).status).toBe(503);
    } finally {
      process.env.ROOM_SERVER_SECRET = secret;
    }
  });

  test("stores a reported race once, without who raced", async () => {
    const race = await publishedRace();
    const body = JSON.stringify(race);
    const stored = await report(body);
    expect(stored.status).toBe(201);
    expect(await stored.json()).toEqual({ status: "stored" });
    expect((await report(body)).status).toBe(200);

    const [row] = await db
      .select()
      .from(roomRaces)
      .where(eq(roomRaces.id, race.raceId));
    expect(row).toMatchObject({
      roomCode: race.roomCode,
      courseId: race.courseId,
      courseRevision: 1,
      endReason: "after_first_finish",
      racingAt: new Date(race.racingAt),
      endedAt: new Date(race.endedAt),
    });
    const entries = await db
      .select()
      .from(roomRaceEntries)
      .where(eq(roomRaceEntries.raceId, race.raceId))
      .orderBy(roomRaceEntries.place);
    expect(entries).toEqual(
      race.entries.map((entry) => ({ raceId: race.raceId, ...entry })),
    );

    await expect(
      db
        .update(roomRaces)
        .set({ endReason: "time_limit" })
        .where(eq(roomRaces.id, race.raceId)),
    ).rejects.toThrow();
    await expect(
      db.delete(roomRaceEntries).where(eq(roomRaceEntries.raceId, race.raceId)),
    ).rejects.toThrow();
  });

  test("refuses reports it can't trust or store", async () => {
    const race = await publishedRace();
    const body = JSON.stringify(race);
    expect(
      (await report(body, { secret: `${SECRET}-other` })).status,
    ).toBe(401);
    expect(
      (await report(body, { signedAt: Date.now() - 6 * 60_000 })).status,
    ).toBe(401);
    for (const unreadable of [
      { version: 1 },
      { ...race, courseRevision: 2 ** 31 },
      {
        ...race,
        entries: [{ ...race.entries[0], timeMicroseconds: 0 }],
      },
      { ...race, racingAt: 8.64e15 + 1, endedAt: 8.64e15 + 1 },
      { ...race, courseId: "rooms\u0000" },
      { ...race, physicsVersion: "physics\u0000" },
      { ...race, entries: [{ ...race.entries[0], kartId: "kart\u0000" }] },
    ]) {
      expect((await report(JSON.stringify(unreadable))).status).toBe(400);
    }
    for (const invalid of [
      {
        ...race,
        entries: [{ ...race.entries[0], kartRevision: 99 }],
      },
      { ...race, courseRevision: 99 },
      { ...race, entries: [...race.entries].reverse() },
      {
        ...race,
        entries: race.entries.map((entry, index) => ({
          ...entry,
          place: index + 1,
          timeMicroseconds: index === 0 ? null : 40_000_000,
        })),
      },
      { ...race, endedAt: race.racingAt - 1 },
    ]) {
      expect(
        (await report(JSON.stringify({ ...invalid, raceId: randomUUID() })))
          .status,
      ).toBe(422);
    }
    const [row] = await db
      .select({ id: roomRaces.id })
      .from(roomRaces)
      .where(eq(roomRaces.id, race.raceId));
    expect(row).toBeUndefined();
  });

  test("serves a room the course revision it fixed", async () => {
    const race = await publishedRace();
    const get = (query: string) =>
      getPublishedCourse(
        new Request(`${ORIGIN}/api/courses/${race.courseId}/published${query}`),
        { params: Promise.resolve({ courseId: race.courseId }) },
      );
    const pinned = await get("?revision=1");
    expect(pinned.status).toBe(200);
    expect(await pinned.json()).toMatchObject({
      courseId: race.courseId,
      revision: 1,
    });
    expect((await get("?revision=2")).status).toBe(404);
    expect((await get("?revision=one")).status).toBe(400);
  });
});

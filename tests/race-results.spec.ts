import { randomUUID } from "node:crypto";

import { expect, test } from "@playwright/test";
import { eq } from "drizzle-orm";

import { POST as postRun } from "../src/app/api/runs/route";
import { postRunTicket } from "../src/app/api/runs/tickets/route";
import { db } from "../src/db/client";
import {
  boardBests,
  courseMedals,
  leaderboards,
  raceResults,
  users,
} from "../src/db/schema";
import { FALLS_VIEW_PARK_DOCUMENT } from "../src/game/course/course-document";
import {
  encodeGhostTrace,
  type GhostSample,
  ghostTraceToBase64,
} from "../src/game/ghost/ghost-trace";
import { createBalancedKartDocument } from "../src/game/kart/balanced-kart-document";
import { CURRENT_PHYSICS_VERSION } from "../src/game/physics/physics-version";
import { createRaceSessionConfig } from "../src/game/race/race-course";
import { earnedMedalTiers } from "../src/game/race/race-medals";
import {
  publishCourseRevision,
  saveCourseRevision,
} from "../src/server/course-repository";
import {
  publishKartRevision,
  saveKartRevision,
} from "../src/server/kart-repository";
import {
  checkSubmittedRun,
  recordRunSubmission,
} from "../src/server/race-results";
import { issueRunTicket, readRunTicket } from "../src/server/run-tickets";
import { anonymizeUserByEmail } from "../src/server/user-anonymization";
import { recordRace, routeThroughGates } from "./support/race-recording";
import { testAuth } from "./support/test-auth";

const requiredIntegrationVariables = [
  "DATABASE_URL",
  "BETTER_AUTH_SECRET",
  "BETTER_AUTH_URL",
] as const;
const ORIGIN = process.env.BETTER_AUTH_URL ?? "http://127.0.0.1:3873";
const CONFIG = createRaceSessionConfig(FALLS_VIEW_PARK_DOCUMENT);
const ROUTE = routeThroughGates(CONFIG);

function encode(samples: readonly GhostSample[]) {
  return ghostTraceToBase64(encodeGhostTrace(samples));
}

function race(speed: number) {
  return recordRace(CONFIG, ROUTE, { speed });
}

function post(path: string, headers: Headers, body: unknown) {
  return new Request(`${ORIGIN}${path}`, {
    body: JSON.stringify(body),
    headers: new Headers([
      ...headers.entries(),
      ["content-type", "application/json"],
      ["origin", ORIGIN],
    ]),
    method: "POST",
  });
}

async function racer({ username = true } = {}) {
  const authContext = await testAuth.$context;
  const email = `${randomUUID()}@example.invalid`;
  let id: string;
  if (username) {
    id = (
      await authContext.test.saveUser(
        authContext.test.createUser({ email, name: "Race results racer" }),
      )
    ).id;
  } else {
    // A racer who has not claimed a username yet.
    id = randomUUID();
    await db
      .insert(users)
      .values({ email, emailVerified: true, id, name: "Unnamed racer" });
  }
  const { headers } = await authContext.test.login({ userId: id });
  return { email, headers, id };
}

/** Falls View Park's gates under a fresh course ID, and a fresh kart. */
async function publishedBoard() {
  const author = await racer();
  const courseId = `race-results-${randomUUID()}`;
  const kartId = `race-results-${randomUUID()}`;
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
  const identity = {
    courseId,
    courseRevision: 1,
    kartId,
    kartRevision: 1,
    physicsVersion: CURRENT_PHYSICS_VERSION,
  };
  return {
    courseId,
    identity,
    kartId,
    // Issued well before the race could have finished.
    ticket: (userId: string, issuedAt = Date.now() - 10 * 60 * 1_000) =>
      issueRunTicket({ ...identity, userId }, issuedAt),
  };
}

async function submit(headers: Headers, ticket: string, recording: string) {
  return postRun(post("/api/runs", headers, { recording, ticket }));
}

test("medals are a finish, then bronze, silver, and gold near the developer time", () => {
  expect(earnedMedalTiers(1_000, null)).toEqual(["finish"]);
  expect(earnedMedalTiers(1_501, 1_000)).toEqual(["finish"]);
  expect(earnedMedalTiers(1_500, 1_000)).toEqual(["finish", "bronze"]);
  expect(earnedMedalTiers(1_200, 1_000)).toEqual([
    "finish",
    "bronze",
    "silver",
  ]);
  expect(earnedMedalTiers(1_060, 1_000)).toEqual([
    "finish",
    "bronze",
    "silver",
    "gold",
  ]);
});

test.describe("verified runs", () => {
  test.beforeEach(() => {
    test.skip(
      requiredIntegrationVariables.some((name) => !process.env[name]?.trim()),
      "Database and auth environment variables are required for run tests.",
    );
  });

  test("signs tickets only for named racers in races that count", async () => {
    const board = await publishedBoard();
    const eligibility = {
      courseIds: [board.courseId],
      kartIds: [board.kartId],
    };
    const ticketFor = (headers: Headers, body: object = board.identity) =>
      postRunTicket(post("/api/runs/tickets", headers, body), eligibility);

    // Races that cannot count get no ticket, without an error.
    const noTicket = async (response: Response) => {
      expect(response.status).toBe(200);
      return ((await response.json()) as { reason: string }).reason;
    };
    expect(await noTicket(await ticketFor(new Headers()))).toBe("login");
    const unnamed = await racer({ username: false });
    expect(await noTicket(await ticketFor(unnamed.headers))).toBe("username");

    const named = await racer();
    const response = await ticketFor(named.headers);
    expect(response.status).toBe(200);
    const { ticket } = (await response.json()) as { ticket: string };
    expect(readRunTicket(ticket)).toMatchObject({
      ...board.identity,
      userId: named.id,
    });
    const [payload, signature] = ticket.split(".");
    expect(readRunTicket(`${payload}A.${signature}`)).toBeNull();
    expect(readRunTicket(ticket, Date.now() + 3 * 60 * 60 * 1_000)).toBeNull();

    for (const body of [
      // Never published.
      { ...board.identity, courseRevision: 2 },
      { ...board.identity, kartRevision: 2 },
      { ...board.identity, physicsVersion: "earlier-physics" },
    ]) {
      expect(await noTicket(await ticketFor(named.headers, body))).toBe(
        "not-eligible",
      );
    }
    // Only the official course and karts count.
    const official = await postRunTicket(
      post("/api/runs/tickets", named.headers, board.identity),
    );
    expect(await noTicket(official)).toBe("not-eligible");
  });

  test("verifies a run, keeps each racer's best, and counts a ticket once", async () => {
    const board = await publishedBoard();
    const first = await racer();
    const slow = race(8);
    const fast = race(10);

    const ticket = board.ticket(first.id);
    const response = await submit(first.headers, ticket, encode(slow.samples));
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({
      entries: 1,
      medal: { newTiers: ["finish"], tier: "finish" },
      personalBest: { improved: true, timeMicroseconds: slow.timeMicroseconds },
      rank: 1,
      status: "verified",
      timeMicroseconds: slow.timeMicroseconds,
    });
    expect(
      (await submit(first.headers, ticket, encode(fast.samples))).status,
    ).toBe(409);

    const improved = await submit(
      first.headers,
      board.ticket(first.id),
      encode(fast.samples),
    );
    expect(await improved.json()).toMatchObject({
      medal: { newTiers: [], tier: "finish" },
      personalBest: { improved: true, timeMicroseconds: fast.timeMicroseconds },
    });
    const slower = await submit(
      first.headers,
      board.ticket(first.id),
      encode(slow.samples),
    );
    expect(await slower.json()).toMatchObject({
      personalBest: {
        improved: false,
        timeMicroseconds: fast.timeMicroseconds,
      },
      timeMicroseconds: slow.timeMicroseconds,
    });
    const [best] = await db
      .select({ ghost: boardBests.ghost })
      .from(boardBests)
      .where(eq(boardBests.userId, first.id));
    expect(ghostTraceToBase64(best.ghost)).toBe(encode(fast.samples));

    const second = await racer();
    const behind = await submit(
      second.headers,
      board.ticket(second.id),
      encode(slow.samples),
    );
    expect(await behind.json()).toMatchObject({ entries: 2, rank: 2 });
    const othersTicket = board.ticket(first.id);
    expect(
      (await submit(second.headers, othersTicket, encode(fast.samples))).status,
    ).toBe(403);

    // A tie ranks behind whoever set the time first.
    const third = await racer();
    const tied = await submit(
      third.headers,
      board.ticket(third.id),
      encode(fast.samples),
    );
    expect(await tied.json()).toMatchObject({ entries: 3, rank: 2 });
  });

  test("keeps one result per ticket and the fastest best when runs race", async () => {
    const board = await publishedBoard();
    const first = await racer();
    const second = await racer();
    const fast = race(10);
    const slow = race(8);
    const slowest = race(6);

    // Two first runs create the board together, and one ticket comes twice.
    const ticket = board.ticket(first.id);
    const statuses = await Promise.all([
      submit(first.headers, ticket, encode(fast.samples)),
      submit(first.headers, ticket, encode(fast.samples)),
      submit(second.headers, board.ticket(second.id), encode(slowest.samples)),
    ]);
    expect(statuses.map(({ status }) => status).sort()).toEqual([
      200, 200, 409,
    ]);
    // Two runs at once that both beat the racer's best keep the faster.
    const improvements = await Promise.all([
      submit(second.headers, board.ticket(second.id), encode(slow.samples)),
      submit(second.headers, board.ticket(second.id), encode(fast.samples)),
    ]);
    expect(improvements.map(({ status }) => status)).toEqual([200, 200]);

    await expect(
      db
        .select({ id: leaderboards.id })
        .from(leaderboards)
        .where(eq(leaderboards.courseId, board.courseId)),
    ).resolves.toHaveLength(1);
    await expect(
      db
        .select({ id: raceResults.id })
        .from(raceResults)
        .where(eq(raceResults.id, readRunTicket(ticket)!.id)),
    ).resolves.toHaveLength(1);
    const [best] = await db
      .select({
        ghost: boardBests.ghost,
        timeMicroseconds: boardBests.timeMicroseconds,
      })
      .from(boardBests)
      .where(eq(boardBests.userId, second.id));
    expect(best.timeMicroseconds).toBe(fast.timeMicroseconds);
    expect(ghostTraceToBase64(best.ghost)).toBe(encode(fast.samples));
    await expect(
      db.select().from(courseMedals).where(eq(courseMedals.userId, second.id)),
    ).resolves.toHaveLength(1);
  });

  test("stores why a run did not verify, without a best", async () => {
    const board = await publishedBoard();
    const me = await racer();
    const clean = race(10);
    const jumped = clean.samples.map((sample, index) => {
      if (index !== 40) return sample;
      const { x, y, z } = sample.position;
      return { ...sample, position: { x: x + 5, y, z } };
    });

    for (const [recording, reason, issuedAt] of [
      [encode(jumped), "too-fast", undefined],
      ["not-a-ghost", "bad-recording", undefined],
      // Issued just now, before a race this long could have finished.
      [encode(clean.samples), "too-early", Date.now()],
    ] as const) {
      const ticket = board.ticket(me.id, issuedAt);
      const response = await submit(me.headers, ticket, recording);
      expect(await response.json()).toEqual({ reason, status: "rejected" });
      const [row] = await db
        .select({
          rejection: raceResults.rejection,
          status: raceResults.status,
          timeMicroseconds: raceResults.timeMicroseconds,
        })
        .from(raceResults)
        .where(eq(raceResults.id, readRunTicket(ticket)!.id));
      expect(row).toEqual({
        rejection: reason,
        status: "rejected",
        timeMicroseconds: null,
      });
    }
    await expect(
      db.select().from(boardBests).where(eq(boardBests.userId, me.id)),
    ).resolves.toEqual([]);

    // Each outcome needs its own field.
    const [{ leaderboardId }] = await db
      .select({ leaderboardId: raceResults.leaderboardId })
      .from(raceResults)
      .where(eq(raceResults.userId, me.id))
      .limit(1);
    for (const status of ["verified", "rejected"] as const) {
      const failure = await db
        .insert(raceResults)
        .values({
          id: randomUUID(),
          kartId: board.kartId,
          kartRevision: 1,
          leaderboardId,
          status,
          ticketIssuedAt: new Date(),
          userId: me.id,
        })
        .catch((error: Error & { cause?: Error }) => error);
      expect((failure as Error & { cause?: Error }).cause?.message).toMatch(
        /race_results_outcome/,
      );
    }
  });

  test("grants each medal tier once, against the board's developer time", async () => {
    const board = await publishedBoard();
    const developer = await racer();
    const player = await racer();
    const developerTicket = board.ticket(developer.id);
    await submit(developer.headers, developerTicket, encode(race(10).samples));
    await db
      .update(leaderboards)
      .set({
        developerResultId: readRunTicket(developerTicket)!.id,
        developerSetAt: new Date(),
      })
      .where(eq(leaderboards.courseId, board.courseId));
    const medalFor = async (speed: number) =>
      (
        (await (
          await submit(
            player.headers,
            board.ticket(player.id),
            encode(race(speed).samples),
          )
        ).json()) as { medal: unknown }
      ).medal;

    // About 43% slower, then 5% slower, than the developer.
    expect(await medalFor(7)).toEqual({
      newTiers: ["finish", "bronze"],
      tier: "bronze",
    });
    expect(await medalFor(9.5)).toEqual({
      newTiers: ["silver", "gold"],
      tier: "gold",
    });
    expect(await medalFor(9.5)).toEqual({ newTiers: [], tier: "gold" });
    await expect(
      db.select().from(courseMedals).where(eq(courseMedals.userId, player.id)),
    ).resolves.toHaveLength(4);
  });

  test("anonymization removes bests and medals and refuses new ones", async () => {
    const board = await publishedBoard();
    const me = await racer();
    const ticket = board.ticket(me.id);
    const recording = encode(race(10).samples);
    expect((await submit(me.headers, ticket, recording)).status).toBe(200);
    const [{ leaderboardId }] = await db
      .select({ leaderboardId: boardBests.leaderboardId })
      .from(boardBests)
      .where(eq(boardBests.userId, me.id));

    await anonymizeUserByEmail(me.email);
    await expect(
      db.select().from(boardBests).where(eq(boardBests.userId, me.id)),
    ).resolves.toEqual([]);
    await expect(
      db.select().from(courseMedals).where(eq(courseMedals.userId, me.id)),
    ).resolves.toEqual([]);
    await expect(
      db.select().from(raceResults).where(eq(raceResults.userId, me.id)),
    ).resolves.toHaveLength(1);

    let failure: unknown;
    try {
      await db.insert(boardBests).values({
        achievedAt: new Date(),
        ghost: Buffer.from(recording, "base64"),
        leaderboardId,
        resultId: readRunTicket(ticket)!.id,
        timeMicroseconds: 1,
        userId: me.id,
      });
    } catch (error) {
      failure = error;
    }
    expect((failure as Error & { cause?: Error })?.cause?.message).toMatch(
      /anonymized racer accounts cannot gain/,
    );

    // A submission that waits on an anonymization in progress is refused.
    const other = await racer();
    const pending = readRunTicket(board.ticket(other.id))!;
    const run = await checkSubmittedRun(pending, recording);
    let submission: Promise<unknown> = Promise.resolve();
    await db.transaction(async (transaction) => {
      await transaction
        .update(users)
        .set({ anonymizedAt: new Date(), username: null })
        .where(eq(users.id, other.id));
      submission = recordRunSubmission(pending, run!).catch((error) => error);
      await new Promise((resolve) => setTimeout(resolve, 300));
    });
    expect(
      ((await submission) as Error & { cause?: Error })?.cause?.message,
    ).toMatch(/anonymized racer accounts cannot gain/);
    await expect(
      db.select().from(raceResults).where(eq(raceResults.userId, other.id)),
    ).resolves.toEqual([]);
  });
});

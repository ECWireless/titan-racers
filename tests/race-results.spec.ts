import { randomUUID } from "node:crypto";

import { expect, test } from "@playwright/test";
import { eq } from "drizzle-orm";

import { GET as getGhost } from "../src/app/api/leaderboards/[courseId]/ghost/route";
import { POST as postRun } from "../src/app/api/runs/route";
import { postRunTicket } from "../src/app/api/runs/tickets/route";
import { db } from "../src/db/client";
import {
  boardBests,
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
import {
  CoursePublicationOrderError,
  loadLatestCoursePublication,
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
import { leaderboardResponseSchema } from "../src/game/race/leaderboard";
import { medalForRank } from "../src/game/race/race-medals";
import { formatRaceTime } from "../src/game/race/race-presentation";
import { parseGhostRecord } from "../src/game/ghost/device-ghost";
import {
  loadBoardGhost,
  loadLeaderboard,
  loadRacerGhost,
  loadRacerStanding,
} from "../src/server/leaderboard";
import { drawSocialCard } from "../src/app/social-card/card";
import { ghostLinkMetadata } from "../src/lib/social-metadata";
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
    author,
    courseId,
    identity,
    kartId,
    // Issued well before the race could have finished.
    ticket: (userId: string | null, issuedAt = Date.now() - 10 * 60 * 1_000) =>
      issueRunTicket({ ...identity, userId }, issuedAt),
  };
}

/** Saves and publishes the course's next revision, keeping or starting a board. */
async function publishNext(
  board: Awaited<ReturnType<typeof publishedBoard>>,
  newLeaderboard: boolean,
) {
  const latest = (await loadLatestCoursePublication(board.courseId))!;
  const saved = await saveCourseRevision({
    authorUserId: board.author.id,
    document: {
      ...structuredClone(FALLS_VIEW_PARK_DOCUMENT),
      courseId: board.courseId,
    },
    expectedRevision: latest.revision,
  });
  await publishCourseRevision({
    courseId: board.courseId,
    expectedPublicationId: latest.publicationId,
    newLeaderboard,
    publishedByUserId: board.author.id,
    revision: saved.revision,
  });
  return saved.revision;
}

async function submit(headers: Headers, ticket: string, recording: string) {
  return postRun(post("/api/runs", headers, { recording, ticket }));
}

test.describe("verified runs", () => {
  test.beforeEach(() => {
    test.skip(
      requiredIntegrationVariables.some((name) => !process.env[name]?.trim()),
      "Database and auth environment variables are required for run tests.",
    );
  });

  test("signs tickets for races that count, naming only named racers", async () => {
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
      const body = (await response.json()) as { reason: string; ticket: null };
      expect(body.ticket).toBeNull();
      return body.reason;
    };
    // A guest's ticket, or an unnamed racer's, names no racer.
    const unnamed = await racer({ username: false });
    for (const [headers, reason] of [
      [new Headers(), "login"],
      [unnamed.headers, "username"],
    ] as const) {
      const body = (await (await ticketFor(headers)).json()) as {
        reason: string;
        ticket: string;
      };
      expect(body.reason).toBe(reason);
      expect(readRunTicket(body.ticket)).toMatchObject({
        ...board.identity,
        userId: null,
      });
      expect(
        readRunTicket(body.ticket, Date.now() + 31 * 60 * 1_000),
      ).toBeNull();
    }
    expect(
      await noTicket(
        await ticketFor(new Headers(), { ...board.identity, courseRevision: 2 }),
      ),
    ).toBe("not-eligible");

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
    const [{ username }] = await db
      .select({ username: users.username })
      .from(users)
      .where(eq(users.id, first.id));
    expect(await response.json()).toEqual({
      entries: 1,
      personalBest: { improved: true, timeMicroseconds: slow.timeMicroseconds },
      rank: 1,
      status: "verified",
      username,
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

  test("gives a guest's run to the racer who signs in within 30 minutes", async () => {
    const board = await publishedBoard();
    const recording = encode(race(10).samples);
    const guestTicket = board.ticket(null);

    // It waits for a signed-in racer with a username.
    expect((await submit(new Headers(), guestTicket, recording)).status).toBe(
      401,
    );
    const unnamed = await racer({ username: false });
    expect((await submit(unnamed.headers, guestTicket, recording)).status).toBe(
      428,
    );

    const me = await racer();
    const response = await submit(me.headers, guestTicket, recording);
    expect(await response.json()).toMatchObject({
      personalBest: { improved: true },
      rank: 1,
      status: "verified",
    });
    const resultOf = async (ticket: string) =>
      (
        await db
          .select({ claimed: raceResults.claimed, userId: raceResults.userId })
          .from(raceResults)
          .where(eq(raceResults.id, readRunTicket(ticket)!.id))
      )[0];
    expect(await resultOf(guestTicket)).toEqual({
      claimed: true,
      userId: me.id,
    });
    // It counts once, whoever sends it again.
    const other = await racer();
    expect((await submit(other.headers, guestTicket, recording)).status).toBe(
      409,
    );
    // A named racer's own ticket is not marked.
    const own = board.ticket(other.id);
    expect((await submit(other.headers, own, recording)).status).toBe(200);
    expect(await resultOf(own)).toEqual({ claimed: false, userId: other.id });

    // Thirty minutes after the run started, it is too late.
    const late = board.ticket(null, Date.now() - 31 * 60 * 1_000);
    expect((await submit(me.headers, late, recording)).status).toBe(400);
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

  test("anonymization removes bests and refuses new ones", async () => {
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
      submission = recordRunSubmission(pending, other.id, run!).catch(
        (error) => error,
      );
      await new Promise((resolve) => setTimeout(resolve, 300));
    });
    expect(
      ((await submission) as Error & { cause?: Error })?.cause?.message,
    ).toMatch(/anonymized racer accounts cannot gain/);
    await expect(
      db.select().from(raceResults).where(eq(raceResults.userId, other.id)),
    ).resolves.toEqual([]);
  });

  test("lists the board, with gold, silver, and bronze for the top three", async () => {
    const board = await publishedBoard();
    const entrants = [await racer(), await racer(), await racer(), await racer()];
    const ranks = [];
    for (const [index, entrant] of entrants.entries()) {
      // Each racer is slower than the last, so each lands one place lower.
      const response = await submit(
        entrant.headers,
        board.ticket(entrant.id),
        encode(race(10 - index).samples),
      );
      ranks.push(((await response.json()) as { rank: number }).rank);
    }
    expect(ranks).toEqual([1, 2, 3, 4]);
    expect(ranks.map(medalForRank)).toEqual(["gold", "silver", "bronze", null]);

    // The public board carries no racer or result IDs.
    const listed = leaderboardResponseSchema.parse(
      await loadLeaderboard(board.courseId, entrants[3].id),
    );
    expect(listed.board).toMatchObject({
      courseName: FALLS_VIEW_PARK_DOCUMENT.name,
      viewer: { rank: 4 },
    });
    expect(
      listed.board!.entries.map(({ kartName, rank, viewer }) => ({
        kartName,
        rank,
        viewer,
      })),
    ).toEqual(
      [1, 2, 3, 4].map((rank) => ({
        kartName: "Balanced Kart",
        rank,
        viewer: rank === 4,
      })),
    );
  });

  test("serves the course best to anyone and a racer's own best to them", async () => {
    const board = await publishedBoard();
    const fastest = await racer();
    const slower = await racer();
    const fast = race(10);
    const slow = race(8);
    await submit(fastest.headers, board.ticket(fastest.id), encode(fast.samples));
    await submit(slower.headers, board.ticket(slower.id), encode(slow.samples));

    const courseBest = await loadBoardGhost(board.courseId, 1, null);
    expect(courseBest?.timeMicroseconds).toBe(fast.timeMicroseconds);
    const ownBest = await loadBoardGhost(board.courseId, 1, slower.id);
    expect(ownBest?.timeMicroseconds).toBe(slow.timeMicroseconds);
    await expect(loadBoardGhost(board.courseId, 2, null)).resolves.toBeNull();

    // The client reads it as it reads a best kept on its device.
    const ghost = parseGhostRecord(
      JSON.parse(JSON.stringify(courseBest)),
      board.courseId,
      1,
    );
    expect(ghost?.samples).toHaveLength(fast.samples.length);
    expect(ghost?.kart.document.name).toBe("Balanced Kart");

    // The route serves only the official board, and your own best only to you.
    const ghostRoute = (courseId: string, query: string) =>
      getGhost(
        new Request(`${ORIGIN}/api/leaderboards/${courseId}/ghost?${query}`),
        { params: Promise.resolve({ courseId }) },
      );
    expect((await ghostRoute(board.courseId, "best=course&revision=1")).status).toBe(
      404,
    );
    const guestOwn = await ghostRoute(
      "falls-view-park",
      "best=mine&revision=1",
    );
    expect(await guestOwn.json()).toEqual({ ghost: null });
    expect(
      (await ghostRoute("falls-view-park", "best=fastest&revision=1")).status,
    ).toBe(400);

    // A ghost link names a racer by username and races their current best.
    const [{ username }] = await db
      .select({ username: users.username })
      .from(users)
      .where(eq(users.id, slower.id));
    const linked = await loadRacerGhost(board.courseId, username!);
    expect(linked?.timeMicroseconds).toBe(slow.timeMicroseconds);
    expect(JSON.stringify(linked)).not.toContain(slower.id);
    await expect(loadRacerGhost(board.courseId, "no_such_racer")).resolves.toBeNull();
    // Its preview names their time and rank, and draws as a card.
    const standing = await loadRacerStanding(board.courseId, username!);
    expect(standing).toEqual({
      courseName: FALLS_VIEW_PARK_DOCUMENT.name,
      entries: 2,
      rank: 2,
      timeMicroseconds: slow.timeMicroseconds,
      username,
    });
    const preview = ghostLinkMetadata(standing!);
    expect(preview.title).toBe(`Race @${username}'s ghost · Titan Racers`);
    expect(preview.description).toBe(
      `@${username} ran ${FALLS_VIEW_PARK_DOCUMENT.name} in ${formatRaceTime(slow.timeMicroseconds, 3)}, rank 2 of 2. Race their ghost and beat it.`,
    );
    const [image] = preview.openGraph!.images as Array<{ url: string }>;
    expect(image.url).toBe(
      `/social-card?racer=${username}&v=${slow.timeMicroseconds}-2-2`,
    );
    const card = await drawSocialCard(standing, {});
    expect(card.headers.get("content-type")).toBe("image/png");
    expect((await card.arrayBuffer()).byteLength).toBeGreaterThan(50_000);
    await expect(loadRacerStanding(board.courseId, "no_such_racer")).resolves.toBeNull();
    // Only an exact username: a link is never normalized to another racer.
    for (const racer of ["a", username!.toUpperCase()]) {
      expect(
        (await ghostRoute("falls-view-park", `best=racer&racer=${racer}`))
          .status,
      ).toBe(400);
    }
    expect(
      await (
        await ghostRoute("falls-view-park", "best=racer&racer=no_such_racer")
      ).json(),
    ).toEqual({ ghost: null });

    // Anonymization ends the link.
    const [{ email }] = await db
      .select({ email: users.email })
      .from(users)
      .where(eq(users.id, slower.id));
    await anonymizeUserByEmail(email);
    await expect(loadRacerGhost(board.courseId, username!)).resolves.toBeNull();
    await expect(loadRacerStanding(board.courseId, username!)).resolves.toBeNull();
  });

  test("keeps a board across publications until one starts a new one", async () => {
    const board = await publishedBoard();
    const { courseId } = board;
    const first = await racer();
    const second = await racer();
    const fast = race(10);
    const slow = race(8);
    // A ticket signed at a revision, and one asked for from the route.
    const ticketAt = (courseRevision: number, userId: string) =>
      issueRunTicket(
        { ...board.identity, courseRevision, userId },
        Date.now() - 10 * 60 * 1_000,
      );
    const routeTicket = async (courseRevision: number) =>
      (
        (await (
          await postRunTicket(
            post("/api/runs/tickets", first.headers, {
              ...board.identity,
              courseRevision,
            }),
            { courseIds: [courseId], kartIds: [board.kartId] },
          )
        ).json()) as { ticket: string | null }
      ).ticket;
    const boards = () =>
      db
        .select({
          courseRevision: leaderboards.courseRevision,
          number: leaderboards.number,
        })
        .from(leaderboards)
        .where(eq(leaderboards.courseId, courseId))
        .orderBy(leaderboards.number);

    await submit(first.headers, ticketAt(1, first.id), encode(fast.samples));

    // Publishing keeps the board: both revisions race on it.
    const kept = await publishNext(board, false);
    expect(await routeTicket(1)).not.toBeNull();
    expect(await routeTicket(kept)).not.toBeNull();
    const onKept = await submit(
      second.headers,
      ticketAt(kept, second.id),
      encode(slow.samples),
    );
    expect(await onKept.json()).toMatchObject({ entries: 2, rank: 2 });
    expect(
      (await loadLeaderboard(courseId, null)).board?.entries.map(
        ({ timeMicroseconds }) => timeMicroseconds,
      ),
    ).toEqual([fast.timeMicroseconds, slow.timeMicroseconds]);
    // The course best carries over, named for the revision raced.
    expect(await loadBoardGhost(courseId, kept, null)).toMatchObject({
      courseRevision: kept,
      timeMicroseconds: fast.timeMicroseconds,
    });
    expect(await boards()).toEqual([{ courseRevision: 1, number: 1 }]);

    // A new leaderboard closes the old one to new runs.
    const fresh = await publishNext(board, true);
    expect(await routeTicket(kept)).toBeNull();
    expect(await routeTicket(fresh)).not.toBeNull();
    expect((await loadLeaderboard(courseId, null)).board?.entries).toEqual([]);
    await expect(loadBoardGhost(courseId, fresh, null)).resolves.toBeNull();
    // A run already racing the old board still lands on it.
    const inFlight = await submit(
      first.headers,
      ticketAt(kept, first.id),
      encode(slow.samples),
    );
    expect(await inFlight.json()).toMatchObject({ entries: 2, rank: 1 });
    const onFresh = await submit(
      second.headers,
      ticketAt(fresh, second.id),
      encode(slow.samples),
    );
    expect(await onFresh.json()).toMatchObject({ entries: 1, rank: 1 });
    expect(await boards()).toEqual([
      { courseRevision: 1, number: 1 },
      { courseRevision: fresh, number: 2 },
    ]);
    // Publications only move forward.
    const latest = (await loadLatestCoursePublication(courseId))!;
    await expect(
      publishCourseRevision({
        courseId,
        expectedPublicationId: latest.publicationId,
        publishedByUserId: board.author.id,
        revision: kept,
      }),
    ).rejects.toBeInstanceOf(CoursePublicationOrderError);
  });

  test("numbers two boards created at once", async () => {
    // The first board never had a run, so a run still racing it and the
    // first run after the reset create both boards together.
    const board = await publishedBoard();
    const fresh = await publishNext(board, true);
    const first = await racer();
    const second = await racer();
    const ticketAt = (courseRevision: number, userId: string) =>
      issueRunTicket(
        { ...board.identity, courseRevision, userId },
        Date.now() - 10 * 60 * 1_000,
      );
    const statuses = await Promise.all([
      submit(first.headers, ticketAt(1, first.id), encode(race(10).samples)),
      submit(second.headers, ticketAt(fresh, second.id), encode(race(10).samples)),
    ]);
    expect(statuses.map(({ status }) => status)).toEqual([200, 200]);
    const numbers = await db
      .select({ number: leaderboards.number })
      .from(leaderboards)
      .where(eq(leaderboards.courseId, board.courseId));
    expect(numbers.map(({ number }) => number).sort()).toEqual([1, 2]);
  });
});

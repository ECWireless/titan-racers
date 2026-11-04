import { randomUUID } from "node:crypto";

import { expect, test } from "@playwright/test";
import { eq, sql } from "drizzle-orm";
import type { PoolClient } from "pg";

import { generatePrivateKey, privateKeyToAccount } from "viem/accounts";
import { createSiweMessage } from "viem/siwe";

import { POST as postAuth } from "../src/app/api/auth/[...all]/route";
import { POST as postLoginMethod } from "../src/app/api/profile/login-methods/route";
import {
  DELETE as cancelMergeRequest,
  POST as postMergeRequest,
} from "../src/app/api/profile/merge/route";
import { db, pool } from "../src/db/client";
import {
  boardBests,
  gameplayRuns,
  leaderboards,
  raceResults,
  racerFormerUsernames,
  racerMerges,
  sessions,
  users,
} from "../src/db/schema";
import { FALLS_VIEW_PARK_DOCUMENT } from "../src/game/course/course-document";
import { CURRENT_PHYSICS_VERSION } from "../src/game/physics/physics-version";
import { SIWE_CHAIN_ID } from "../src/lib/siwe";
import {
  publishCourseRevision,
  saveCourseRevision,
} from "../src/server/course-repository";
import { loadRacerStanding } from "../src/server/leaderboard";
import { anonymizeUserByUsername } from "../src/server/user-anonymization";

function postgresErrorCode(error: unknown): string | undefined {
  if (!error || typeof error !== "object") return undefined;
  if ("code" in error && typeof error.code === "string") return error.code;
  return "cause" in error ? postgresErrorCode(error.cause) : undefined;
}

async function failureCode(work: PromiseLike<unknown>) {
  try {
    await work;
  } catch (error) {
    return postgresErrorCode(error);
  }
  return "none";
}

async function racer(username: string | null = null) {
  const id = randomUUID();
  await db.insert(users).values({
    email: `${id}@example.invalid`,
    id,
    name: "Merge racer",
    username,
  });
  return id;
}

function freshUsername() {
  return `merge_${randomUUID().replaceAll("-", "").slice(0, 12)}`;
}

/** A result on a board under a fresh course ID; results are never deleted. */
async function result(userId: string) {
  const courseId = `racer-merges-${randomUUID()}`;
  await saveCourseRevision({
    // The course's author stays with its revision.
    authorUserId: await racer(),
    document: { ...structuredClone(FALLS_VIEW_PARK_DOCUMENT), courseId },
    expectedRevision: null,
  });
  const [board] = await db
    .insert(leaderboards)
    .values({ courseId, courseRevision: 1, physicsVersion: CURRENT_PHYSICS_VERSION })
    .returning({ id: leaderboards.id });
  const id = randomUUID();
  await db.insert(raceResults).values({
    id,
    kartId: "balanced",
    kartRevision: 1,
    leaderboardId: board.id,
    status: "verified",
    ticketIssuedAt: new Date(),
    timeMicroseconds: 60_000_000,
    userId,
  });
  return id;
}

async function asMerge<T>(from: string, to: string, work: (tx: typeof db) => Promise<T>) {
  return db.transaction(async (transaction) => {
    await transaction.execute(
      sql`select set_config('titan.racer_merge', ${`${from} ${to}`}, true)`,
    );
    return work(transaction as unknown as typeof db);
  });
}

test.describe("racer merge database rules", () => {
  test.beforeEach(() => {
    test.skip(!process.env.DATABASE_URL?.trim(), "DATABASE_URL is required.");
  });

  test("keeps a former username from being claimed or held twice", async () => {
    const username = freshUsername();
    const keeper = await racer();
    await db.insert(racerFormerUsernames).values({ userId: keeper, username });

    const claimer = await racer();
    const claim = db.update(users).set({ username }).where(eq(users.id, claimer));
    expect(await failureCode(claim)).toBe("23505");
    expect(await failureCode(racer(username))).toBe("23505");

    const current = freshUsername();
    const holder = await racer(current);
    expect(
      await failureCode(
        db.insert(racerFormerUsernames).values({ userId: holder, username: current }),
      ),
    ).toBe("23505");

    await db.delete(users).where(eq(users.id, claimer));
    await db.delete(users).where(eq(users.id, holder));
    // A former username goes with the racer it was kept for.
    await db.delete(users).where(eq(users.id, keeper));
    await expect(
      db.select().from(racerFormerUsernames).where(eq(racerFormerUsernames.username, username)),
    ).resolves.toEqual([]);
  });

  test("moves a result only to the racer a merge names, and changes nothing else", async () => {
    const from = await racer();
    const to = await racer();
    const other = await racer();
    const id = await result(from);
    const later = await result(from);
    // One connection throughout, so a setting that outlived its transaction
    // would show.
    const client = await pool.connect();
    const moveIn = async (setting: string | null, statement: string, resultId = id) => {
      await client.query("begin");
      try {
        if (setting) {
          await client.query("select set_config('titan.racer_merge', $1, true)", [setting]);
        }
        await client.query(statement, [resultId, to]);
        await client.query("commit");
        return "none";
      } catch (error) {
        await client.query("rollback");
        return (error as { message: string }).message;
      }
    };
    try {
      const move = "update race_results set user_id = $2 where id = $1";
      expect(await moveIn(null, move)).toContain("immutable");
      expect(await moveIn(`${from} ${other}`, move)).toContain("immutable");
      expect(
        await moveIn(
          `${from} ${to}`,
          "update race_results set user_id = $2, time_microseconds = 1000000 where id = $1",
        ),
      ).toContain("immutable");
      expect(
        await moveIn(`${from} ${to}`, "delete from race_results where id = $1 and $2 <> ''"),
      ).toContain("immutable");

      expect(await moveIn(`${from} ${to}`, move)).toBe("none");
      await expect(
        db.select({ userId: raceResults.userId }).from(raceResults).where(eq(raceResults.id, id)),
      ).resolves.toEqual([{ userId: to }]);
      // The setting ended with the merge's transaction.
      expect(await moveIn(null, move, later)).toContain("immutable");
    } finally {
      client.release();
    }
    await db.delete(users).where(eq(users.id, other));
  });

  test("makes a claim wait for a merge retiring the same username, then refuses it", async () => {
    for (const survivorHasUsername of [true, false]) {
      const username = freshUsername();
      const brought = await racer(username);
      const survivor = await racer(survivorHasUsername ? freshUsername() : null);
      const claimer = await racer();
      const merge = await pool.connect();
      let claim: PoolClient | undefined;
      let claiming: Promise<string | undefined> | undefined;
      let open = false;
      try {
        claim = await pool.connect();
        const { rows } = await claim.query<{ pid: number }>("select pg_backend_pid() as pid");
        const claimPid = rows[0].pid;
        await merge.query("begin");
        open = true;
        await merge.query("select lock_racer_username($1)", [username]);
        await merge.query("delete from users where id = $1", [brought]);

        claiming = claim
          .query("update users set username = $1 where id = $2", [username, claimer])
          .then(
            () => "none",
            (error: { code?: string }) => error.code,
          );
        // The claim is waiting on the merge's username lock.
        await expect
          .poll(
            async () =>
              (
                await db.execute(sql`
                  select 1 from pg_locks
                  where pid = ${claimPid} and locktype = 'advisory' and not granted
                `)
              ).rows.length,
            { timeout: 5_000 },
          )
          .toBe(1);

        if (survivorHasUsername) {
          await merge.query(
            "insert into racer_former_usernames (username, user_id) values ($1, $2)",
            [username, survivor],
          );
        } else {
          await merge.query("update users set username = $1 where id = $2", [
            username,
            survivor,
          ]);
        }
        await merge.query("commit");
        open = false;
        expect(await claiming).toBe("23505");
      } finally {
        // Never return a connection mid-transaction or still waiting.
        const rolledBack = open ? merge.query("rollback").then(() => true, () => false) : true;
        merge.release(!(await rolledBack));
        await claiming;
        claim?.release();
      }
      await db.delete(users).where(eq(users.id, claimer));
      await db.delete(users).where(eq(users.id, survivor));
    }
  });

  test("moves a run summary only to the racer a merge names", async () => {
    const from = await racer();
    const to = await racer();
    const id = randomUUID();
    await db.insert(gameplayRuns).values({
      attribution: "authenticated",
      courseId: "falls-view-park",
      deploymentVersion: "racer-merges-spec",
      id,
      inputFamilies: ["keyboard"],
      userId: from,
    });
    const move = (executor: typeof db) =>
      executor.update(gameplayRuns).set({ userId: to }).where(eq(gameplayRuns.id, id));

    await expect(move(db)).rejects.toThrow();
    await asMerge(from, to, move);
    await expect(
      db.select({ userId: gameplayRuns.userId }).from(gameplayRuns).where(eq(gameplayRuns.id, id)),
    ).resolves.toEqual([{ userId: to }]);

    await db.delete(gameplayRuns).where(eq(gameplayRuns.id, id));
    await db.delete(users).where(eq(users.id, from));
    await db.delete(users).where(eq(users.id, to));
  });
});

const ORIGIN = process.env.BETTER_AUTH_URL ?? "http://127.0.0.1:3873";

function request(
  path: string,
  init: { body?: unknown; cookie?: string; method?: string } = {},
) {
  return new Request(`${ORIGIN}${path}`, {
    body: JSON.stringify(init.body ?? {}),
    headers: {
      "content-type": "application/json",
      origin: ORIGIN,
      ...(init.cookie ? { cookie: init.cookie } : {}),
    },
    method: init.method ?? "POST",
  });
}

function sessionCookie(response: Response) {
  return response.headers
    .getSetCookie()
    .map((cookie) => cookie.split(";")[0])
    .join("; ");
}

async function browserRacer(username: string | null) {
  const response = await postAuth(request("/api/auth/sign-in/anonymous"));
  expect(response.status).toBe(200);
  const { user } = (await response.json()) as { user: { id: string } };
  if (username) {
    await db.update(users).set({ name: username, username }).where(eq(users.id, user.id));
  }
  return { cookie: sessionCookie(response), id: user.id };
}

async function signedWalletBody(wallet: ReturnType<typeof privateKeyToAccount>) {
  const nonceResponse = await postAuth(request("/api/auth/siwe/nonce"));
  const { nonce } = (await nonceResponse.json()) as { nonce: string };
  const message = createSiweMessage({
    address: wallet.address,
    chainId: SIWE_CHAIN_ID,
    domain: new URL(ORIGIN).host,
    issuedAt: new Date(),
    nonce,
    uri: ORIGIN,
    version: "1",
  });
  return { message, signature: await wallet.signMessage({ message }) };
}

async function walletSignIn(wallet: ReturnType<typeof privateKeyToAccount>, cookie?: string) {
  return postAuth(
    request("/api/auth/siwe/verify", { body: await signedWalletBody(wallet), cookie }),
  );
}

/** A racer with a wallet, and its username when given one. */
async function walletRacer(username: string | null) {
  const wallet = privateKeyToAccount(generatePrivateKey());
  const response = await walletSignIn(wallet);
  expect(response.status).toBe(200);
  const { user } = (await response.json()) as { user: { id: string } };
  if (username) {
    await db.update(users).set({ name: username, username }).where(eq(users.id, user.id));
  }
  return { id: user.id, wallet };
}

/** A published course with a current board, under a fresh course ID. */
async function publishedBoard() {
  const author = await racer();
  const courseId = `racer-merges-${randomUUID()}`;
  await saveCourseRevision({
    authorUserId: author,
    document: { ...structuredClone(FALLS_VIEW_PARK_DOCUMENT), courseId },
    expectedRevision: null,
  });
  await publishCourseRevision({
    courseId,
    expectedPublicationId: null,
    publishedByUserId: author,
    revision: 1,
  });
  const [board] = await db
    .insert(leaderboards)
    .values({ courseId, courseRevision: 1, physicsVersion: CURRENT_PHYSICS_VERSION })
    .returning({ id: leaderboards.id });
  return { courseId, id: board.id };
}

async function best(leaderboardId: number, userId: string, timeMicroseconds: number) {
  const id = randomUUID();
  await db.insert(raceResults).values({
    id,
    kartId: "balanced",
    kartRevision: 1,
    leaderboardId,
    status: "verified",
    ticketIssuedAt: new Date(),
    timeMicroseconds,
    userId,
  });
  await db.insert(boardBests).values({
    achievedAt: new Date(),
    ghost: Buffer.alloc(32),
    leaderboardId,
    resultId: id,
    timeMicroseconds,
    userId,
  });
  return id;
}

async function bestsOf(leaderboardId: number) {
  return db
    .select({ resultId: boardBests.resultId, userId: boardBests.userId })
    .from(boardBests)
    .where(eq(boardBests.leaderboardId, leaderboardId));
}

test.describe("bringing a racer kept in one browser into another", () => {
  test.beforeEach(() => {
    test.skip(
      ["DATABASE_URL", "BETTER_AUTH_SECRET", "BETTER_AUTH_URL"].some(
        (name) => !process.env[name]?.trim(),
      ),
      "Database and auth environment variables are required.",
    );
  });

  test("moves results, keeps the faster best, and keeps its username for the racer signed in to", async () => {
    const broughtName = freshUsername();
    const keptName = freshUsername();
    const brought = await browserRacer(broughtName);
    const kept = await walletRacer(keptName);
    const faster = await publishedBoard();
    const slower = await publishedBoard();
    const onlyBrought = await publishedBoard();
    const broughtFaster = await best(faster.id, brought.id, 50_000_000);
    await best(faster.id, kept.id, 60_000_000);
    await best(slower.id, brought.id, 70_000_000);
    const keptFaster = await best(slower.id, kept.id, 65_000_000);
    const onlyBroughtBest = await best(onlyBrought.id, brought.id, 80_000_000);

    // Signing in as another racer is refused until this browser's racer asks.
    expect((await walletSignIn(kept.wallet, brought.cookie)).status).toBe(400);
    const asked = await postMergeRequest(request("/api/profile/merge", { cookie: brought.cookie }));
    expect(asked.status).toBe(204);
    const signedIn = await walletSignIn(kept.wallet, brought.cookie);
    expect(signedIn.status).toBe(200);
    expect(((await signedIn.json()) as { user: { id: string } }).user.id).toBe(kept.id);

    await expect(db.select().from(users).where(eq(users.id, brought.id))).resolves.toEqual([]);
    await expect(
      db.select().from(sessions).where(eq(sessions.userId, brought.id)),
    ).resolves.toEqual([]);
    await expect(bestsOf(faster.id)).resolves.toEqual([
      { resultId: broughtFaster, userId: kept.id },
    ]);
    await expect(bestsOf(slower.id)).resolves.toEqual([{ resultId: keptFaster, userId: kept.id }]);
    await expect(bestsOf(onlyBrought.id)).resolves.toEqual([
      { resultId: onlyBroughtBest, userId: kept.id },
    ]);
    const results = await db
      .select({ userId: raceResults.userId })
      .from(raceResults)
      .where(eq(raceResults.leaderboardId, slower.id));
    expect(results).toEqual([{ userId: kept.id }, { userId: kept.id }]);

    // The old username's ghost link races the racer that kept it.
    await expect(loadRacerStanding(onlyBrought.courseId, broughtName)).resolves.toMatchObject({
      timeMicroseconds: 80_000_000,
      username: keptName,
    });
    const claimer = await racer();
    expect(
      await failureCode(
        db.update(users).set({ username: broughtName }).where(eq(users.id, claimer)),
      ),
    ).toBe("23505");
    await expect(
      db.select({ userId: racerMerges.userId }).from(racerMerges).where(eq(racerMerges.userId, kept.id)),
    ).resolves.toEqual([{ userId: kept.id }]);

    // Deleting the racer frees both of its usernames.
    await anonymizeUserByUsername(broughtName);
    await db.update(users).set({ username: broughtName }).where(eq(users.id, claimer));
    await db.delete(users).where(eq(users.id, claimer));
  });

  test("gives its username to a racer that has none, and refuses a racer already kept", async () => {
    const broughtName = freshUsername();
    const brought = await browserRacer(broughtName);
    const kept = await walletRacer(null);
    expect(
      (await postMergeRequest(request("/api/profile/merge", { cookie: brought.cookie }))).status,
    ).toBe(204);
    expect((await walletSignIn(kept.wallet, brought.cookie)).status).toBe(200);
    await expect(
      db.select({ username: users.username }).from(users).where(eq(users.id, kept.id)),
    ).resolves.toEqual([{ username: broughtName }]);

    const keptCookie = sessionCookie(await walletSignIn(kept.wallet));
    const refused = await postMergeRequest(request("/api/profile/merge", { cookie: keptCookie }));
    expect(refused.status).toBe(409);
  });

  test("lets a Google sign-in start only once asked, and a failed merge changes nothing", async () => {
    const brought = await browserRacer(null);
    const google = () =>
      postAuth(
        request("/api/auth/sign-in/social", {
          body: { callbackURL: "/profile", provider: "google" },
          cookie: brought.cookie,
        }),
      );
    expect((await google()).status).toBe(400);
    await postMergeRequest(request("/api/profile/merge", { cookie: brought.cookie }));
    expect((await google()).status).toBe(200);

    // A merge that fails changes nothing and leaves it signed in here.
    await saveCourseRevision({
      authorUserId: brought.id,
      document: { ...structuredClone(FALLS_VIEW_PARK_DOCUMENT), courseId: `racer-merges-${randomUUID()}` },
      expectedRevision: null,
    });
    const kept = await walletRacer(null);
    const failed = await walletSignIn(kept.wallet, brought.cookie);
    expect(failed.status).toBe(400);
    await expect(failed.json()).resolves.toMatchObject({ code: "RACER_MERGE_FAILED" });
    await expect(
      db.select({ id: sessions.id }).from(sessions).where(eq(sessions.userId, brought.id)),
    ).resolves.toHaveLength(1);
    // The failure kept the request, so a retry runs the merge again.
    await expect((await walletSignIn(kept.wallet, brought.cookie)).json()).resolves.toMatchObject({
      code: "RACER_MERGE_FAILED",
    });
  });

  test("refuses a racer that gained a login method after asking, then lets it switch", async () => {
    const brought = await browserRacer(null);
    const kept = await walletRacer(null);
    await postMergeRequest(request("/api/profile/merge", { cookie: brought.cookie }));
    const linked = await postLoginMethod(
      request("/api/profile/login-methods", {
        body: await signedWalletBody(privateKeyToAccount(generatePrivateKey())),
        cookie: brought.cookie,
      }),
    );
    expect(linked.status).toBe(200);

    const refused = await walletSignIn(kept.wallet, brought.cookie);
    await expect(refused.json()).resolves.toMatchObject({ code: "RACER_MERGE_FAILED" });
    await expect(
      db.select({ id: sessions.id }).from(sessions).where(eq(sessions.userId, brought.id)),
    ).resolves.toHaveLength(1);
    // It no longer asks, so it can switch racers as any kept racer can.
    expect((await walletSignIn(kept.wallet, brought.cookie)).status).toBe(200);
  });

  test("lets no later sign-in bring a racer in once it cancels", async () => {
    const brought = await browserRacer(null);
    const kept = await walletRacer(null);
    await postMergeRequest(request("/api/profile/merge", { cookie: brought.cookie }));
    const cancelled = await cancelMergeRequest(
      request("/api/profile/merge", { cookie: brought.cookie, method: "DELETE" }),
    );
    expect(cancelled.status).toBe(204);

    const refused = await walletSignIn(kept.wallet, brought.cookie);
    await expect(refused.json()).resolves.toMatchObject({ code: "SIGN_OUT_FIRST" });
    await expect(
      db.select({ id: users.id }).from(users).where(eq(users.id, brought.id)),
    ).resolves.toHaveLength(1);
    // Signed out, there is nothing to cancel.
    expect(
      (await cancelMergeRequest(request("/api/profile/merge", { method: "DELETE" }))).status,
    ).toBe(401);
  });
});

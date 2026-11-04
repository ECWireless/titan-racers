import { randomUUID } from "node:crypto";

import { expect, test } from "@playwright/test";
import { eq, sql } from "drizzle-orm";
import type { PoolClient } from "pg";

import { db, pool } from "../src/db/client";
import {
  gameplayRuns,
  leaderboards,
  raceResults,
  racerFormerUsernames,
  users,
} from "../src/db/schema";
import { FALLS_VIEW_PARK_DOCUMENT } from "../src/game/course/course-document";
import { CURRENT_PHYSICS_VERSION } from "../src/game/physics/physics-version";
import { saveCourseRevision } from "../src/server/course-repository";

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

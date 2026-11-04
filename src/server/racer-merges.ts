import { randomUUID } from "node:crypto";

import { and, eq, gt, inArray, sql } from "drizzle-orm";

import { db } from "@/db/client";
import {
  accounts,
  boardBests,
  gameplayRuns,
  passkeys,
  raceResults,
  racerFormerUsernames,
  racerMerges,
  users,
  verifications,
} from "@/db/schema";

// A merge runs during the sign-in that proves the other racer, so the
// request lasts only long enough to finish one.
const REQUEST_LIFETIME_MS = 10 * 60 * 1000;

function requestIdentifier(sessionId: string) {
  return `racer-merge:${sessionId}`;
}

export class RacerMergeError extends Error {}

/**
 * Asks to bring the racer behind this session into whichever racer signs
 * in next in this browser. Only the session itself proves the racer, so the
 * request belongs to that session and replaces any earlier one.
 */
export async function requestRacerMerge(sessionId: string, userId: string) {
  const identifier = requestIdentifier(sessionId);
  await db.transaction(async (transaction) => {
    await transaction
      .delete(verifications)
      .where(eq(verifications.identifier, identifier));
    await transaction.insert(verifications).values({
      expiresAt: new Date(Date.now() + REQUEST_LIFETIME_MS),
      id: randomUUID(),
      identifier,
      value: userId,
    });
  });
}

// A racer that can no longer be brought in stops asking, so later sign-ins
// behave as usual.
export async function cancelRacerMergeRequest(sessionId: string) {
  await db
    .delete(verifications)
    .where(eq(verifications.identifier, requestIdentifier(sessionId)));
}

export async function hasRacerMergeRequest(sessionId: string, userId: string) {
  const [request] = await db
    .select({ id: verifications.id })
    .from(verifications)
    .where(
      and(
        eq(verifications.identifier, requestIdentifier(sessionId)),
        eq(verifications.value, userId),
        gt(verifications.expiresAt, sql`now()`),
      ),
    )
    .limit(1);
  return Boolean(request);
}

/**
 * Brings a racer kept in one browser into the racer that just signed in
 * there, in one transaction that also uses up the session's request. Its
 * results and run summaries move over, each board keeps the faster best,
 * and its username stays with the racer that keeps everything. The
 * brought-in racer is then deleted. False when there is no live request; a
 * failure changes nothing.
 */
export async function mergeRacers(input: {
  fromUserId: string;
  sessionId: string;
  toUserId: string;
}) {
  const { fromUserId, toUserId } = input;
  if (fromUserId === toUserId) throw new RacerMergeError("A racer can't merge into itself.");
  return db.transaction(async (transaction) => {
    const [request] = await transaction
      .delete(verifications)
      .where(
        and(
          eq(verifications.identifier, requestIdentifier(input.sessionId)),
          eq(verifications.value, fromUserId),
          gt(verifications.expiresAt, sql`now()`),
        ),
      )
      .returning({ id: verifications.id });
    if (!request) return false;

    // Locked in ID order, so two merges touching one racer can't deadlock.
    const racers = await transaction
      .select({
        anonymizedAt: users.anonymizedAt,
        createdAt: users.createdAt,
        id: users.id,
        isAnonymous: users.isAnonymous,
        username: users.username,
      })
      .from(users)
      .where(inArray(users.id, [fromUserId, toUserId]))
      .orderBy(users.id)
      .for("update");
    const from = racers.find(({ id }) => id === fromUserId);
    const to = racers.find(({ id }) => id === toUserId);
    if (!from || !to || from.anonymizedAt || to.anonymizedAt) {
      throw new RacerMergeError("Both racers must exist.");
    }
    const {
      rows: [methods],
    } = await transaction.execute<{ brought_can_sign_in: boolean; kept_can_sign_in: boolean }>(sql`
      select
        exists (select 1 from ${accounts} where ${accounts.userId} = ${fromUserId})
          or exists (select 1 from ${passkeys} where ${passkeys.userId} = ${fromUserId}) as brought_can_sign_in,
        exists (select 1 from ${accounts} where ${accounts.userId} = ${toUserId})
          or exists (select 1 from ${passkeys} where ${passkeys.userId} = ${toUserId}) as kept_can_sign_in
    `);
    // Only a racer kept in one browser is brought in, and only into a racer
    // that can sign in again.
    if (!from.isAnonymous || methods.brought_can_sign_in || !methods.kept_can_sign_in) {
      throw new RacerMergeError("Only a racer kept in one browser can be brought in.");
    }

    await transaction.execute(
      sql`select set_config('titan.racer_merge', ${`${fromUserId} ${toUserId}`}, true)`,
    );
    // Each board keeps the faster best, or the earlier of two equal ones,
    // as boards rank them.
    await transaction.execute(sql`
      delete from ${boardBests} kept
      using ${boardBests} brought
      where kept.user_id = ${toUserId} and brought.user_id = ${fromUserId}
        and brought.leaderboard_id = kept.leaderboard_id
        and (brought.time_microseconds, brought.achieved_at)
          < (kept.time_microseconds, kept.achieved_at)
    `);
    await transaction.execute(sql`
      delete from ${boardBests} brought
      using ${boardBests} kept
      where brought.user_id = ${fromUserId} and kept.user_id = ${toUserId}
        and kept.leaderboard_id = brought.leaderboard_id
    `);
    await transaction
      .update(boardBests)
      .set({ userId: toUserId })
      .where(eq(boardBests.userId, fromUserId));
    await transaction
      .update(raceResults)
      .set({ userId: toUserId })
      .where(eq(raceResults.userId, fromUserId));
    await transaction
      .update(gameplayRuns)
      .set({ userId: toUserId })
      .where(eq(gameplayRuns.userId, fromUserId));
    await transaction
      .update(racerFormerUsernames)
      .set({ userId: toUserId })
      .where(eq(racerFormerUsernames.userId, fromUserId));

    // Its username is never free between leaving it and reaching the racer
    // that keeps it (migration 0028).
    if (from.username) {
      await transaction.execute(sql`select lock_racer_username(${from.username})`);
    }
    // Its sessions and role go with it. A kart or course it owned would
    // stop the delete; racers kept in one browser can't author yet.
    await transaction.delete(users).where(eq(users.id, fromUserId));
    if (from.username && to.username) {
      await transaction
        .insert(racerFormerUsernames)
        .values({ userId: toUserId, username: from.username });
    } else if (from.username) {
      await transaction
        .update(users)
        .set({ name: from.username, username: from.username })
        .where(eq(users.id, toUserId));
    }
    await transaction.insert(racerMerges).values({
      id: randomUUID(),
      mergedRacerCreatedAt: from.createdAt,
      userId: toUserId,
    });
    return true;
  });
}

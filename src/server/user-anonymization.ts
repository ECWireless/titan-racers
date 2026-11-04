import { and, eq, like, ne, or, sql } from "drizzle-orm";

import { db } from "@/db/client";
import {
  accounts,
  boardBests,
  passkeys,
  racerFormerUsernames,
  sessions,
  userRoles,
  users,
  verifications,
  walletAddresses,
} from "@/db/schema";

export class UserNotFoundError extends Error {
  constructor() {
    super("No application user exists for that email, wallet, or username.");
    this.name = "UserNotFoundError";
  }
}

type Transaction = Parameters<Parameters<typeof db.transaction>[0]>[0];

export async function anonymizeUserByEmail(rawEmail: string) {
  const email = rawEmail.trim().toLowerCase();
  return db.transaction(async (transaction) => {
    const [user] = await transaction
      .select({ id: users.id })
      .from(users)
      .where(sql`lower(${users.email}) = ${email}`)
      .limit(1);
    if (!user) throw new UserNotFoundError();
    return anonymizeUser(transaction, user.id);
  });
}

// Wallet-first racers have no real email, so they are found by any wallet.
export async function anonymizeUserByWallet(rawAddress: string) {
  const address = rawAddress.trim().toLowerCase();
  return db.transaction(async (transaction) => {
    const [wallet] = await transaction
      .select({ userId: walletAddresses.userId })
      .from(walletAddresses)
      .where(sql`lower(${walletAddresses.address}) = ${address}`)
      .limit(1);
    if (!wallet) throw new UserNotFoundError();
    return anonymizeUser(transaction, wallet.userId);
  });
}

// Racers kept in this browser have neither, so they are found by username,
// or by one a racer kept when another was brought into it.
export async function anonymizeUserByUsername(rawUsername: string) {
  const username = rawUsername.trim().toLowerCase().replace(/^@/, "");
  return db.transaction(async (transaction) => {
    const [user] = await transaction
      .select({ id: users.id })
      .from(users)
      .where(eq(users.username, username))
      .limit(1);
    const [former] = user
      ? []
      : await transaction
          .select({ id: racerFormerUsernames.userId })
          .from(racerFormerUsernames)
          .where(eq(racerFormerUsernames.username, username));
    const userId = user?.id ?? former?.id;
    if (!userId) throw new UserNotFoundError();
    return anonymizeUser(transaction, userId);
  });
}

async function anonymizeUser(transaction: Transaction, userId: string) {
  // Locking the racer first makes a concurrent sign-in or new login method
  // wait, then fail on the anonymized racer (migration 0020's triggers).
  const [{ email }] = await transaction
    .select({ email: users.email })
    .from(users)
    .where(eq(users.id, userId))
    .for("update");
  const wallets = await transaction
    .delete(walletAddresses)
    .where(eq(walletAddresses.userId, userId))
    .returning({ address: walletAddresses.address });

  await transaction.delete(sessions).where(eq(sessions.userId, userId));
  // Leaderboard bests and ghosts go; results stay under the opaque ID.
  await transaction.delete(boardBests).where(eq(boardBests.userId, userId));
  await transaction.delete(accounts).where(eq(accounts.userId, userId));
  await transaction.delete(passkeys).where(eq(passkeys.userId, userId));
  // Better Auth 1.6 keyed wallet nonces by address (`siwe:<address>:<chain>`),
  // and expired rows can linger, so rows from before 1.7 may still name the
  // wallet. 1.7 keys nonces by the nonce alone.
  await transaction
    .delete(verifications)
    .where(
      or(
        sql`lower(${verifications.identifier}) = ${email.toLowerCase()}`,
        // Passkey registration challenges name the racer by ID.
        like(verifications.value, `%"userData":{"id":"${userId}"%`),
        ...wallets.map(({ address }) =>
          like(verifications.identifier, `siwe:${address}:%`),
        ),
      ),
    );
  // A deleted racer's usernames are free again, including ones it kept.
  await transaction
    .delete(racerFormerUsernames)
    .where(eq(racerFormerUsernames.userId, userId));
  await transaction
    .delete(userRoles)
    .where(and(eq(userRoles.userId, userId), ne(userRoles.role, "player")));
  await transaction
    .update(users)
    .set({
      anonymizedAt: new Date(),
      email: `${userId}@deleted.invalid`,
      emailVerified: false,
      image: null,
      name: "Deleted racer",
      username: null,
    })
    .where(eq(users.id, userId));

  return { userId };
}

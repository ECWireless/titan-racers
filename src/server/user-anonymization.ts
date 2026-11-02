import { and, eq, like, ne, or, sql } from "drizzle-orm";

import { db } from "@/db/client";
import {
  accounts,
  sessions,
  userRoles,
  users,
  verifications,
  walletAddresses,
} from "@/db/schema";

export class UserNotFoundError extends Error {
  constructor() {
    super("No application user exists for that email or wallet.");
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

async function anonymizeUser(transaction: Transaction, userId: string) {
  const [{ email }] = await transaction
    .select({ email: users.email })
    .from(users)
    .where(eq(users.id, userId));
  const wallets = await transaction
    .delete(walletAddresses)
    .where(eq(walletAddresses.userId, userId))
    .returning({ address: walletAddresses.address });

  await transaction.delete(sessions).where(eq(sessions.userId, userId));
  await transaction.delete(accounts).where(eq(accounts.userId, userId));
  await transaction
    .delete(verifications)
    .where(
      or(
        sql`lower(${verifications.identifier}) = ${email.toLowerCase()}`,
        ...wallets.map(({ address }) =>
          like(verifications.identifier, `siwe:${address}:%`),
        ),
      ),
    );
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

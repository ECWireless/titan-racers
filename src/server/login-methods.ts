import { randomUUID } from "node:crypto";

import { and, asc, eq, sql } from "drizzle-orm";
import { getAddress } from "viem";
import {
  createSiweMessage,
  parseSiweMessage,
  type SiweMessage,
  validateSiweMessage,
} from "viem/siwe";

import { db } from "@/db/client";
import { accounts, users, walletAddresses } from "@/db/schema";
import { auth } from "@/lib/auth";
import {
  SIWE_CHAIN_ID,
  verifyWalletSignature,
  WALLET_EMAIL_DOMAIN,
} from "@/lib/siwe";

export type LoginMethod = {
  id: string;
  kind: "google" | "wallet";
  label: string;
};

export class WalletNotVerifiedError extends Error {}
export class WalletLinkedElsewhereError extends Error {}
export class LastLoginMethodError extends Error {}
export class LoginMethodNotFoundError extends Error {}

function walletAddressOf(accountId: string) {
  return accountId.split(":", 1)[0];
}

export async function listLoginMethods(userId: string): Promise<LoginMethod[]> {
  const rows = await db
    .select({
      accountId: accounts.accountId,
      id: accounts.id,
      providerId: accounts.providerId,
    })
    .from(accounts)
    .where(eq(accounts.userId, userId))
    .orderBy(asc(accounts.createdAt));
  return rows.map(({ accountId, id, providerId }) => {
    if (providerId !== "siwe") return { id, kind: "google", label: "Google" };
    const address = walletAddressOf(accountId);
    return {
      id,
      kind: "wallet",
      label: `${address.slice(0, 6)}…${address.slice(-4)}`,
    };
  });
}

// Better Auth's SIWE verify signs in as the wallet's racer and ignores the
// session, so linking checks the same nonce and message itself.
export async function linkWallet(
  userId: string,
  input: { message: string; signature: string },
) {
  const message = parseSiweMessage(input.message);
  let address: `0x${string}`;
  try {
    address = getAddress(message.address ?? "");
    // Only a canonical message counts: with a repeated field, viem and the
    // plugin could each read a different nonce from one signature.
    if (createSiweMessage(message as SiweMessage) !== input.message) {
      throw new WalletNotVerifiedError();
    }
  } catch {
    throw new WalletNotVerifiedError();
  }
  if (!message.nonce) throw new WalletNotVerifiedError();
  const context = await auth.$context;
  // The plugin stores each nonce under itself, not the wallet.
  const verification = await context.internalAdapter.consumeVerificationValue(
    `siwe:${message.nonce}`,
  );
  if (
    !verification ||
    message.chainId !== SIWE_CHAIN_ID ||
    !validateSiweMessage({
      address,
      domain: new URL(context.baseURL).host,
      message,
      nonce: verification.value,
    }) ||
    !(await verifyWalletSignature({
      address,
      chainId: SIWE_CHAIN_ID,
      message: input.message,
      signature: input.signature,
    }))
  ) {
    throw new WalletNotVerifiedError();
  }

  await db.transaction(async (transaction) => {
    const [inserted] = await transaction
      .insert(walletAddresses)
      .values({
        address,
        chainId: SIWE_CHAIN_ID,
        id: randomUUID(),
        userId,
      })
      .onConflictDoNothing()
      .returning({ id: walletAddresses.id });
    if (!inserted) {
      const [owner] = await transaction
        .select({ userId: walletAddresses.userId })
        .from(walletAddresses)
        .where(eq(walletAddresses.address, address));
      if (owner?.userId === userId) return;
      throw new WalletLinkedElsewhereError();
    }
    await transaction.insert(accounts).values({
      accountId: `${address}:${SIWE_CHAIN_ID}`,
      id: randomUUID(),
      providerId: "siwe",
      userId,
    });
  });
}

// Removes a login method unless it is the racer's last. A wallet's SIWE row
// goes with its account, or the plugin would still sign it in, and a
// placeholder email built from the wallet goes too, or the wallet could never
// create a new racer.
export async function unlinkLoginMethod(userId: string, accountRowId: string) {
  await db.transaction(async (transaction) => {
    await transaction.execute(
      sql`select 1 from ${users} where ${users.id} = ${userId} for update`,
    );
    const methods = await transaction
      .select({
        accountId: accounts.accountId,
        id: accounts.id,
        providerId: accounts.providerId,
      })
      .from(accounts)
      .where(eq(accounts.userId, userId));
    const method = methods.find(({ id }) => id === accountRowId);
    if (!method) throw new LoginMethodNotFoundError();
    if (methods.length <= 1) throw new LastLoginMethodError();

    await transaction.delete(accounts).where(eq(accounts.id, method.id));
    if (method.providerId === "siwe") {
      const address = walletAddressOf(method.accountId);
      await transaction
        .delete(walletAddresses)
        .where(
          and(
            eq(walletAddresses.userId, userId),
            eq(walletAddresses.address, address),
          ),
        );
      await transaction
        .update(users)
        .set({ email: `${userId}@${WALLET_EMAIL_DOMAIN}` })
        .where(
          and(
            eq(users.id, userId),
            eq(users.email, `${address}@${WALLET_EMAIL_DOMAIN}`.toLowerCase()),
          ),
        );
    }
  });
}

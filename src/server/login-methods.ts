import { randomUUID } from "node:crypto";

import { getAuthenticatorName } from "@better-auth/passkey";
import { and, eq, sql } from "drizzle-orm";
import { getAddress } from "viem";
import {
  createSiweMessage,
  parseSiweMessage,
  type SiweMessage,
  validateSiweMessage,
} from "viem/siwe";

import { db } from "@/db/client";
import { accounts, passkeys, users, walletAddresses } from "@/db/schema";
import { auth } from "@/lib/auth";
import {
  SIWE_CHAIN_ID,
  verifyWalletSignature,
  WALLET_EMAIL_DOMAIN,
} from "@/lib/siwe";

export type LoginMethod = {
  id: string;
  kind: "google" | "passkey" | "wallet";
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
  const [accountRows, passkeyRows] = await Promise.all([
    db
      .select({
        accountId: accounts.accountId,
        createdAt: accounts.createdAt,
        id: accounts.id,
        providerId: accounts.providerId,
      })
      .from(accounts)
      .where(eq(accounts.userId, userId)),
    db
      .select({
        aaguid: passkeys.aaguid,
        createdAt: passkeys.createdAt,
        id: passkeys.id,
      })
      .from(passkeys)
      .where(eq(passkeys.userId, userId)),
  ]);
  return [
    ...accountRows.map(({ accountId, createdAt, id, providerId }) => {
      if (providerId !== "siwe") {
        return { createdAt, id, kind: "google" as const, label: "Google" };
      }
      const address = walletAddressOf(accountId);
      return {
        createdAt,
        id,
        kind: "wallet" as const,
        label: `${address.slice(0, 6)}…${address.slice(-4)}`,
      };
    }),
    ...passkeyRows.map(({ aaguid, createdAt, id }) => ({
      createdAt,
      id,
      kind: "passkey" as const,
      // The password manager holding it, when its model is known.
      label: getAuthenticatorName(aaguid ?? undefined) ?? "Passkey",
    })),
  ]
    .sort((a, b) => (a.createdAt?.getTime() ?? 0) - (b.createdAt?.getTime() ?? 0))
    // Passkeys with the same label are numbered so each can be told apart.
    .map(({ id, kind, label }, _index, methods) => {
      if (kind !== "passkey") return { id, kind, label };
      const twins = methods.filter((method) => method.label === label);
      const numbered =
        twins.length > 1
          ? `${label} ${twins.findIndex((method) => method.id === id) + 1}`
          : label;
      return {
        id,
        kind,
        label: label === "Passkey" ? numbered : `Passkey · ${numbered}`,
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

// Removes a login method unless it is the racer's last; passkeys count. A
// wallet's SIWE row goes with its account, or the plugin would still sign it
// in, and a placeholder email built from the wallet goes too, or the wallet
// could never create a new racer.
export async function unlinkLoginMethod(userId: string, methodId: string) {
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
    const userPasskeys = await transaction
      .select({ id: passkeys.id })
      .from(passkeys)
      .where(eq(passkeys.userId, userId));
    const passkeyMethod = userPasskeys.find(({ id }) => id === methodId);
    const method = methods.find(({ id }) => id === methodId);
    if (!method && !passkeyMethod) throw new LoginMethodNotFoundError();
    if (methods.length + userPasskeys.length <= 1) {
      throw new LastLoginMethodError();
    }
    if (!method) {
      await transaction.delete(passkeys).where(eq(passkeys.id, methodId));
      return;
    }

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

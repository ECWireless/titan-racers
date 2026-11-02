import { expect, test } from "@playwright/test";
import { eq } from "drizzle-orm";
import { generatePrivateKey, privateKeyToAccount } from "viem/accounts";
import { createSiweMessage } from "viem/siwe";

import { POST as postAuth } from "../src/app/api/auth/[...all]/route";
import { GET as getProfile } from "../src/app/api/profile/route";
import { db } from "../src/db/client";

import { accounts, sessions, users, walletAddresses } from "../src/db/schema";
import { SIWE_CHAIN_ID } from "../src/lib/siwe";
import { anonymizeUserByWallet } from "../src/server/user-anonymization";

const requiredIntegrationVariables = [
  "DATABASE_URL",
  "BETTER_AUTH_SECRET",
  "BETTER_AUTH_URL",
  "GOOGLE_CLIENT_ID",
  "GOOGLE_CLIENT_SECRET",
] as const;
const ORIGIN = process.env.BETTER_AUTH_URL ?? "http://127.0.0.1:3873";
const DOMAIN = new URL(ORIGIN).host;

type Wallet = ReturnType<typeof privateKeyToAccount>;

function authPost(path: string, body: unknown) {
  return postAuth(
    new Request(`${ORIGIN}/api/auth${path}`, {
      body: JSON.stringify(body),
      headers: { "content-type": "application/json", origin: ORIGIN },
      method: "POST",
    }),
  );
}

async function signedWalletBody(
  wallet: Wallet,
  {
    chainId = SIWE_CHAIN_ID,
    domain = DOMAIN,
    signer = wallet,
  }: { chainId?: number; domain?: string; signer?: Wallet } = {},
) {
  const nonceResponse = await authPost("/siwe/nonce", {
    chainId,
    walletAddress: wallet.address,
  });
  expect(nonceResponse.status).toBe(200);
  const { nonce } = (await nonceResponse.json()) as { nonce: string };
  const message = createSiweMessage({
    address: wallet.address,
    chainId,
    domain,
    issuedAt: new Date(),
    nonce,
    uri: ORIGIN,
    version: "1",
  });
  return {
    chainId,
    message,
    signature: await signer.signMessage({ message }),
    walletAddress: wallet.address,
  };
}

function sessionCookie(response: Response) {
  return response.headers
    .getSetCookie()
    .map((cookie) => cookie.split(";")[0])
    .join("; ");
}

function newWallet() {
  return privateKeyToAccount(generatePrivateKey());
}

test.describe("wallet login", () => {
  test.beforeEach(() => {
    test.skip(
      requiredIntegrationVariables.some((name) => !process.env[name]?.trim()),
      "Database and auth environment variables are required for wallet login tests.",
    );
  });

  test("a new wallet creates a racer and signs back into it", async () => {
    const wallet = newWallet();
    const first = await authPost("/siwe/verify", await signedWalletBody(wallet));
    expect(first.status).toBe(200);
    const { user } = (await first.json()) as { user: { id: string } };

    const [created] = await db
      .select()
      .from(users)
      .where(eq(users.id, user.id));
    expect(created).toMatchObject({ image: null, name: "racer", username: null });
    expect(created.email).toBe(
      `${wallet.address}@wallet.invalid`.toLowerCase(),
    );
    await expect(
      db
        .select({ address: walletAddresses.address, chainId: walletAddresses.chainId })
        .from(walletAddresses)
        .where(eq(walletAddresses.userId, user.id)),
    ).resolves.toEqual([{ address: wallet.address, chainId: SIWE_CHAIN_ID }]);
    await expect(
      db
        .select({ providerId: accounts.providerId })
        .from(accounts)
        .where(eq(accounts.userId, user.id)),
    ).resolves.toEqual([{ providerId: "siwe" }]);

    const profile = await getProfile(
      new Request(`${ORIGIN}/api/profile`, {
        headers: { cookie: sessionCookie(first) },
      }),
    );
    expect(profile.status).toBe(200);
    const identity = (await profile.json()) as { suggestedUsername: string };
    expect(identity.suggestedUsername).toMatch(/^racer\d{4}$/);

    const second = await authPost("/siwe/verify", await signedWalletBody(wallet));
    expect(second.status).toBe(200);
    await expect(second.json()).resolves.toMatchObject({
      user: { id: user.id },
    });
  });

  test("rejects replayed, foreign, wrong-site, and wrong-chain signatures", async () => {
    const wallet = newWallet();

    const replayed = await signedWalletBody(wallet);
    expect((await authPost("/siwe/verify", replayed)).status).toBe(200);
    expect((await authPost("/siwe/verify", replayed)).status).toBe(401);

    const stranger = newWallet();
    for (const body of [
      await signedWalletBody(stranger, { signer: newWallet() }),
      await signedWalletBody(stranger, { domain: "evil.example" }),
      await signedWalletBody(stranger, { chainId: 10 }),
    ]) {
      expect((await authPost("/siwe/verify", body)).status).toBe(401);
    }
    await expect(
      db
        .select()
        .from(walletAddresses)
        .where(eq(walletAddresses.address, stranger.address)),
    ).resolves.toEqual([]);
  });

  test("anonymizing by wallet removes the wallet and its sign-in", async () => {
    const wallet = newWallet();
    const response = await authPost("/siwe/verify", await signedWalletBody(wallet));
    const { user } = (await response.json()) as { user: { id: string } };

    await expect(
      anonymizeUserByWallet(wallet.address.toLowerCase()),
    ).resolves.toEqual({ userId: user.id });
    for (const table of [walletAddresses, accounts, sessions]) {
      await expect(
        db.select().from(table).where(eq(table.userId, user.id)),
      ).resolves.toEqual([]);
    }
    const [anonymized] = await db
      .select({ email: users.email, name: users.name })
      .from(users)
      .where(eq(users.id, user.id));
    expect(anonymized).toEqual({
      email: `${user.id}@deleted.invalid`,
      name: "Deleted racer",
    });

    const again = await authPost("/siwe/verify", await signedWalletBody(wallet));
    expect(again.status).toBe(200);
    const { user: fresh } = (await again.json()) as { user: { id: string } };
    expect(fresh.id).not.toBe(user.id);
  });
});

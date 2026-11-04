import { randomUUID } from "node:crypto";

import { expect, test } from "@playwright/test";
import { eq } from "drizzle-orm";
import { generatePrivateKey, privateKeyToAccount } from "viem/accounts";
import { createSiweMessage } from "viem/siwe";

import { POST as postAuth } from "../src/app/api/auth/[...all]/route";
import {
  DELETE as deleteLoginMethod,
  POST as postLoginMethod,
} from "../src/app/api/profile/login-methods/route";
import { GET as getProfile } from "../src/app/api/profile/route";
import { db } from "../src/db/client";

import {
  accounts,
  sessions,
  users,
  verifications,
  walletAddresses,
} from "../src/db/schema";
import { SIWE_CHAIN_ID } from "../src/lib/siwe";
import { anonymizeUserByWallet } from "../src/server/user-anonymization";
import { testAuth } from "./support/test-auth";

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
  const nonceResponse = await authPost("/siwe/nonce", {});
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
  return { message, signature: await signer.signMessage({ message }) };
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

function loginMethodsRequest(method: "DELETE" | "POST", cookie: string, body: unknown) {
  return new Request(`${ORIGIN}/api/profile/login-methods`, {
    body: JSON.stringify(body),
    headers: { "content-type": "application/json", cookie, origin: ORIGIN },
    method,
  });
}

// A Google-first racer with a live session.
async function googleRacer() {
  const context = await testAuth.$context;
  const user = await context.test.saveUser(
    context.test.createUser({ email: `${randomUUID()}@example.invalid` }),
  );
  await db.insert(accounts).values({
    accountId: `google-${user.id}`,
    id: randomUUID(),
    providerId: "google",
    userId: user.id,
  });
  const { headers } = await context.test.login({ userId: user.id });
  return { cookie: headers.get("cookie") ?? "", id: user.id };
}

type LoginMethodsBody = { loginMethods: { id: string; kind: string; label: string }[] };

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
    // Better Auth 1.6 named nonces after the wallet.
    const legacyNonce = `siwe:${wallet.address}:${SIWE_CHAIN_ID}`;
    await db.insert(verifications).values({
      expiresAt: new Date(Date.now() - 60_000),
      id: randomUUID(),
      identifier: legacyNonce,
      value: "abcdefgh12345678",
    });

    await expect(
      anonymizeUserByWallet(wallet.address.toLowerCase()),
    ).resolves.toEqual({ userId: user.id });
    for (const table of [walletAddresses, accounts, sessions]) {
      await expect(
        db.select().from(table).where(eq(table.userId, user.id)),
      ).resolves.toEqual([]);
    }
    await expect(
      db
        .select()
        .from(verifications)
        .where(eq(verifications.identifier, legacyNonce)),
    ).resolves.toEqual([]);
    const [anonymized] = await db
      .select({ email: users.email, name: users.name })
      .from(users)
      .where(eq(users.id, user.id));
    expect(anonymized).toEqual({
      email: `${user.id}@deleted.invalid`,
      name: "Deleted racer",
    });
    for (const write of [
      db.insert(accounts).values({
        accountId: `google-${user.id}`,
        id: randomUUID(),
        providerId: "google",
        userId: user.id,
      }),
      db.insert(sessions).values({
        expiresAt: new Date(Date.now() + 60_000),
        id: randomUUID(),
        token: randomUUID(),
        userId: user.id,
      }),
      db.insert(walletAddresses).values({
        address: newWallet().address,
        chainId: SIWE_CHAIN_ID,
        id: randomUUID(),
        userId: user.id,
      }),
    ]) {
      await expect(write).rejects.toThrow();
    }

    const again = await authPost("/siwe/verify", await signedWalletBody(wallet));
    expect(again.status).toBe(200);
    const { user: fresh } = (await again.json()) as { user: { id: string } };
    expect(fresh.id).not.toBe(user.id);
  });

  test("links a wallet to the signed-in racer, never to another racer", async () => {
    const racer = await googleRacer();
    const wallet = newWallet();
    const body = await signedWalletBody(wallet);

    const linked = await postLoginMethod(
      loginMethodsRequest("POST", racer.cookie, body),
    );
    expect(linked.status).toBe(200);
    const { loginMethods } = (await linked.json()) as LoginMethodsBody;
    expect(loginMethods.map(({ kind, label }) => ({ kind, label }))).toEqual([
      { kind: "google", label: "Google" },
      {
        kind: "wallet",
        label: `${wallet.address.slice(0, 6)}…${wallet.address.slice(-4)}`,
      },
    ]);
    expect(
      (
        await postLoginMethod(loginMethodsRequest("POST", racer.cookie, body))
      ).status,
    ).toBe(401);

    const signIn = await authPost("/siwe/verify", await signedWalletBody(wallet));
    await expect(signIn.json()).resolves.toMatchObject({ user: { id: racer.id } });

    const other = await authPost("/siwe/verify", await signedWalletBody(newWallet()));
    const taken = await postLoginMethod(
      loginMethodsRequest("POST", sessionCookie(other), await signedWalletBody(wallet)),
    );
    expect(taken.status).toBe(409);
    await expect(
      db
        .select({ userId: walletAddresses.userId })
        .from(walletAddresses)
        .where(eq(walletAddresses.address, wallet.address)),
    ).resolves.toEqual([{ userId: racer.id }]);
  });

  test("links only a canonical, unused message signed by the wallet", async () => {
    const racer = await googleRacer();
    const wallet = newWallet();
    const link = (body: unknown) =>
      postLoginMethod(loginMethodsRequest("POST", racer.cookie, body));

    // Sign-in gives this wallet its own racer; its nonce is then spent.
    const usedAtSignIn = await signedWalletBody(newWallet());
    expect((await authPost("/siwe/verify", usedAtSignIn)).status).toBe(200);
    // A repeated Nonce field, where viem and the plugin read different nonces.
    const { nonce: second } = (await (await authPost("/siwe/nonce", {})).json()) as {
      nonce: string;
    };
    const canonical = await signedWalletBody(wallet);
    const repeated = `${canonical.message}\nNonce: ${second}`;
    for (const body of [
      usedAtSignIn,
      await signedWalletBody(wallet, { signer: newWallet() }),
      await signedWalletBody(wallet, { domain: "evil.example" }),
      await signedWalletBody(wallet, { chainId: 10 }),
      { message: repeated, signature: await wallet.signMessage({ message: repeated }) },
    ]) {
      expect((await link(body)).status).toBe(401);
    }
    await expect(
      db
        .select()
        .from(walletAddresses)
        .where(eq(walletAddresses.userId, racer.id)),
    ).resolves.toEqual([]);
  });

  test("unlinks while another login method remains", async () => {
    const racer = await googleRacer();
    const wallet = newWallet();
    const linked = await postLoginMethod(
      loginMethodsRequest("POST", racer.cookie, await signedWalletBody(wallet)),
    );
    const [google, walletMethod] = ((await linked.json()) as LoginMethodsBody)
      .loginMethods;

    const unlinked = await deleteLoginMethod(
      loginMethodsRequest("DELETE", racer.cookie, { id: walletMethod.id }),
    );
    expect(unlinked.status).toBe(200);
    await expect(unlinked.json()).resolves.toEqual({ loginMethods: [google] });
    await expect(
      db
        .select()
        .from(walletAddresses)
        .where(eq(walletAddresses.userId, racer.id)),
    ).resolves.toEqual([]);

    const last = await deleteLoginMethod(
      loginMethodsRequest("DELETE", racer.cookie, { id: google.id }),
    );
    expect(last.status).toBe(409);

    const signIn = await authPost("/siwe/verify", await signedWalletBody(wallet));
    const { user } = (await signIn.json()) as { user: { id: string } };
    expect(user.id).not.toBe(racer.id);
  });

  test("an unlinked first wallet can start a new racer", async () => {
    const wallet = newWallet();
    const signIn = await authPost("/siwe/verify", await signedWalletBody(wallet));
    const { user } = (await signIn.json()) as { user: { id: string } };
    await db.insert(accounts).values({
      accountId: `google-${user.id}`,
      id: randomUUID(),
      providerId: "google",
      userId: user.id,
    });
    const [walletAccount] = await db
      .select({ id: accounts.id })
      .from(accounts)
      .where(eq(accounts.accountId, `${wallet.address}:${SIWE_CHAIN_ID}`));

    const unlinked = await deleteLoginMethod(
      loginMethodsRequest("DELETE", sessionCookie(signIn), {
        id: walletAccount.id,
      }),
    );
    expect(unlinked.status).toBe(200);

    const again = await authPost("/siwe/verify", await signedWalletBody(wallet));
    expect(again.status).toBe(200);
    const { user: fresh } = (await again.json()) as { user: { id: string } };
    expect(fresh.id).not.toBe(user.id);
  });

  test("starts Google linking, allows one Google, and blocks Better Auth's own unlink", async () => {
    const racer = await googleRacer();
    const authRequest = (path: string, body: unknown) =>
      postAuth(
        new Request(`${ORIGIN}/api/auth${path}`, {
          body: JSON.stringify(body),
          headers: {
            "content-type": "application/json",
            cookie: racer.cookie,
            origin: ORIGIN,
          },
          method: "POST",
        }),
      );

    const link = await authRequest("/link-social", {
      callbackURL: "/profile",
      provider: "google",
    });
    expect(link.status).toBe(200);
    const { url } = (await link.json()) as { url: string };
    expect(new URL(url).hostname).toBe("accounts.google.com");

    const unlink = await authRequest("/unlink-account", { providerId: "google" });
    expect(unlink.status).toBe(404);

    await expect(
      db.insert(accounts).values({
        accountId: `second-google-${racer.id}`,
        id: randomUUID(),
        providerId: "google",
        userId: racer.id,
      }),
    ).rejects.toThrow();
  });
});

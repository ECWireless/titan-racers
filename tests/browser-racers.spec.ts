import { randomInt, randomUUID } from "node:crypto";

import { expect, test } from "@playwright/test";
import { betterAuth } from "better-auth/minimal";
import { eq, inArray, like } from "drizzle-orm";
import { generatePrivateKey, privateKeyToAccount } from "viem/accounts";
import { createSiweMessage } from "viem/siwe";

import { GET as getAuth, POST as postAuth } from "../src/app/api/auth/[...all]/route";
import {
  DELETE as deleteLoginMethod,
  POST as postLoginMethod,
} from "../src/app/api/profile/login-methods/route";
import { GET as getProfile } from "../src/app/api/profile/route";
import { db } from "../src/db/client";
import { accounts, rateLimits, sessions, users, walletAddresses } from "../src/db/schema";
import { auth } from "../src/lib/auth";
import { SIWE_CHAIN_ID } from "../src/lib/siwe";
import { testAuth } from "./support/test-auth";

const requiredIntegrationVariables = [
  "DATABASE_URL",
  "BETTER_AUTH_SECRET",
  "BETTER_AUTH_URL",
  "GOOGLE_CLIENT_ID",
  "GOOGLE_CLIENT_SECRET",
] as const;
const ORIGIN = process.env.BETTER_AUTH_URL ?? "http://127.0.0.1:3873";
const FOUR_HUNDRED_DAYS = 400 * 24 * 60 * 60;

const created: string[] = [];

function request(path: string, init: { body?: unknown; cookie?: string; ip?: string; method?: string } = {}) {
  return new Request(`${ORIGIN}${path}`, {
    body: JSON.stringify(init.body ?? {}),
    headers: {
      "content-type": "application/json",
      origin: ORIGIN,
      ...(init.cookie ? { cookie: init.cookie } : {}),
      ...(init.ip ? { "x-forwarded-for": init.ip } : {}),
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

async function browserRacer() {
  const response = await postAuth(request("/api/auth/sign-in/anonymous"));
  expect(response.status).toBe(200);
  const { user } = (await response.json()) as { user: { id: string } };
  created.push(user.id);
  return { cookie: sessionCookie(response), id: user.id, response };
}

async function signedWalletBody(wallet = privateKeyToAccount(generatePrivateKey())) {
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

test.describe("racers kept in this browser", () => {
  test.beforeEach(() => {
    test.skip(
      requiredIntegrationVariables.some((name) => !process.env[name]?.trim()),
      "Database and auth environment variables are required for browser racer tests.",
    );
  });

  test.afterAll(async () => {
    if (!created.length) return;
    await db.delete(accounts).where(inArray(accounts.userId, created));
    await db.delete(users).where(inArray(users.id, created));
  });

  test("starts a racer with no login method that lasts 400 days", async () => {
    const racer = await browserRacer();
    const sessionToken = racer.response.headers
      .getSetCookie()
      .find((cookie) => cookie.includes("session_token="));
    expect(sessionToken).toContain(`Max-Age=${FOUR_HUNDRED_DAYS}`);

    const [row] = await db
      .select({ isAnonymous: users.isAnonymous, name: users.name, username: users.username })
      .from(users)
      .where(eq(users.id, racer.id));
    expect(row).toEqual({ isAnonymous: true, name: "racer", username: null });
    // Nothing reads where or on what a session started, so it isn't kept.
    await expect(
      db
        .select({ ipAddress: sessions.ipAddress, userAgent: sessions.userAgent })
        .from(sessions)
        .where(eq(sessions.userId, racer.id)),
    ).resolves.toEqual([{ ipAddress: null, userAgent: null }]);

    const profile = await getProfile(
      new Request(`${ORIGIN}/api/profile`, { headers: { cookie: racer.cookie } }),
    );
    await expect(profile.json()).resolves.toMatchObject({
      loginMethods: [],
      status: "incomplete",
      suggestedUsername: expect.stringMatching(/^racer\d{4}$/),
    });
  });

  test("renews a day-old session to 400 days and clears what an earlier build kept", async () => {
    const racer = await browserRacer();
    // As if two days had passed on a session the earlier build wrote.
    await db
      .update(sessions)
      .set({
        expiresAt: new Date(Date.now() + (FOUR_HUNDRED_DAYS - 2 * 24 * 60 * 60) * 1000),
        ipAddress: "203.0.113.9",
        userAgent: "Old browser",
      })
      .where(eq(sessions.userId, racer.id));
    const renewed = await getAuth(
      new Request(`${ORIGIN}/api/auth/get-session`, { headers: { cookie: racer.cookie } }),
    );
    expect(renewed.status).toBe(200);
    expect(
      renewed.headers.getSetCookie().find((cookie) => cookie.includes("session_token=")),
    ).toContain(`Max-Age=${FOUR_HUNDRED_DAYS}`);
    const [row] = await db
      .select({ expiresAt: sessions.expiresAt, ipAddress: sessions.ipAddress, userAgent: sessions.userAgent })
      .from(sessions)
      .where(eq(sessions.userId, racer.id));
    expect(row.ipAddress).toBeNull();
    expect(row.userAgent).toBeNull();
    expect(row.expiresAt.getTime()).toBeGreaterThan(Date.now() + (FOUR_HUNDRED_DAYS - 60) * 1000);
  });

  test("starts only when signed out, and is never deleted", async () => {
    const racer = await browserRacer();
    const again = await postAuth(
      request("/api/auth/sign-in/anonymous", { cookie: racer.cookie }),
    );
    expect(again.status).toBe(400);
    expect(again.headers.getSetCookie()).toEqual([]);

    const context = await testAuth.$context;
    const google = await context.test.saveUser(
      context.test.createUser({ email: `${randomUUID()}@example.invalid` }),
    );
    created.push(google.id);
    const { headers } = await context.test.login({ userId: google.id });
    const fromGoogle = await postAuth(
      request("/api/auth/sign-in/anonymous", {
        cookie: headers.get("cookie") ?? "",
      }),
    );
    expect(fromGoogle.status).toBe(400);

    const deleted = await postAuth(
      request("/api/auth/delete-anonymous-user", { cookie: racer.cookie }),
    );
    expect(deleted.status).toBe(404);
    await expect(
      db.select({ id: users.id }).from(users).where(eq(users.id, racer.id)),
    ).resolves.toEqual([{ id: racer.id }]);
  });

  test("no other sign-in replaces it until it has a login method", async () => {
    const racer = await browserRacer();
    const wallet = privateKeyToAccount(generatePrivateKey());
    const refused = await postAuth(
      request("/api/auth/siwe/verify", {
        body: await signedWalletBody(wallet),
        cookie: racer.cookie,
      }),
    );
    expect(refused.status).toBe(400);
    expect(refused.headers.getSetCookie()).toEqual([]);
    // Refused before the wallet got a racer of its own.
    await expect(
      db
        .select()
        .from(walletAddresses)
        .where(eq(walletAddresses.address, wallet.address)),
    ).resolves.toEqual([]);
    const google = await postAuth(
      request("/api/auth/sign-in/social", {
        body: { callbackURL: "/", provider: "google" },
        cookie: racer.cookie,
      }),
    );
    expect(google.status).toBe(400);

    // Once kept, signing in as another racer is fine again.
    expect(
      (
        await postLoginMethod(
          request("/api/profile/login-methods", {
            body: await signedWalletBody(wallet),
            cookie: racer.cookie,
          }),
        )
      ).status,
    ).toBe(200);
    const other = await postAuth(
      request("/api/auth/siwe/verify", {
        body: await signedWalletBody(),
        cookie: racer.cookie,
      }),
    );
    expect(other.status).toBe(200);
    created.push(((await other.json()) as { user: { id: string } }).user.id);
  });

  test("keeps its ID when it adds a wallet, which then can't be removed", async () => {
    const racer = await browserRacer();
    const linked = await postLoginMethod(
      request("/api/profile/login-methods", {
        body: await signedWalletBody(),
        cookie: racer.cookie,
      }),
    );
    expect(linked.status).toBe(200);
    const { loginMethods } = (await linked.json()) as {
      loginMethods: { id: string; kind: string }[];
    };
    expect(loginMethods.map(({ kind }) => kind)).toEqual(["wallet"]);
    await expect(
      db
        .select({ isAnonymous: users.isAnonymous, userId: accounts.userId })
        .from(accounts)
        .innerJoin(users, eq(users.id, accounts.userId))
        .where(eq(accounts.id, loginMethods[0].id)),
    ).resolves.toEqual([{ isAnonymous: true, userId: racer.id }]);

    const removed = await deleteLoginMethod(
      request("/api/profile/login-methods", {
        body: { id: loginMethods[0].id },
        cookie: racer.cookie,
        method: "DELETE",
      }),
    );
    expect(removed.status).toBe(409);
  });

  test("lets one network start 10 racers an hour, counted in the database", async () => {
    // Production enables the limiter; this copy of the configuration does too.
    const limited = betterAuth({
      ...auth.options,
      rateLimit: { ...auth.options.rateLimit, enabled: true },
    });
    // IPv6 addresses count by their /64 network, stored expanded.
    const [a, b] = [randomInt(0x10000), randomInt(0x10000)].map((group) =>
      group.toString(16).padStart(4, "0"),
    );
    const network = `2001:db8:${a}:${b}`;
    const key = `2001:0db8:${a}:${b}:0000:0000:0000:0000|/sign-in/anonymous`;
    try {
      for (let index = 0; index < 10; index += 1) {
        const response = await limited.handler(
          request("/api/auth/sign-in/anonymous", { ip: `${network}::${index + 1}` }),
        );
        expect(response.status).toBe(200);
        created.push(((await response.json()) as { user: { id: string } }).user.id);
      }
      const eleventh = await limited.handler(
        request("/api/auth/sign-in/anonymous", { ip: `${network}::99` }),
      );
      expect(eleventh.status).toBe(429);
      // Only sign-ins are counted, so other paths never add a row.
      for (const path of ["/not-a-route", "/sign-in/not-a-route", "/callback/not-a-provider"]) {
        const unknown = await limited.handler(
          request(`/api/auth${path}`, { ip: `${network}::99` }),
        );
        expect(unknown.status).not.toBe(200);
      }
      await expect(
        db
          .select({ count: rateLimits.count })
          .from(rateLimits)
          .where(like(rateLimits.key, `${key.split("|")[0]}|%`)),
      ).resolves.toEqual([{ count: 10 }]);
    } finally {
      await db.delete(rateLimits).where(like(rateLimits.key, `${key.split("|")[0]}|%`));
    }
  });
});

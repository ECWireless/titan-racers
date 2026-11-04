import {
  createHash,
  generateKeyPairSync,
  randomBytes,
  randomUUID,
  sign,
} from "node:crypto";

import { expect, test } from "@playwright/test";
import { betterAuth } from "better-auth/minimal";
import { eq, inArray, like } from "drizzle-orm";

import { GET as getAuth, POST as postAuth } from "../src/app/api/auth/[...all]/route";
import { DELETE as deleteLoginMethod } from "../src/app/api/profile/login-methods/route";
import { GET as getProfile, PUT as putProfile } from "../src/app/api/profile/route";
import { db } from "../src/db/client";
import { passkeys, rateLimits, users, verifications } from "../src/db/schema";
import { auth } from "../src/lib/auth";
import { anonymizeUserByUsername } from "../src/server/user-anonymization";

const requiredIntegrationVariables = [
  "DATABASE_URL",
  "BETTER_AUTH_SECRET",
  "BETTER_AUTH_URL",
  "GOOGLE_CLIENT_ID",
  "GOOGLE_CLIENT_SECRET",
] as const;
const ORIGIN = process.env.BETTER_AUTH_URL ?? "http://127.0.0.1:3873";
const RP_ID = new URL(ORIGIN).hostname;

const created: string[] = [];

// Just enough CBOR (RFC 8949) for a "none" attestation and a COSE key.
function cbor(value: unknown): Buffer {
  const head = (major: number, length: number) =>
    length < 24
      ? Buffer.from([(major << 5) | length])
      : length < 256
        ? Buffer.from([(major << 5) | 24, length])
        : Buffer.from([(major << 5) | 25, length >> 8, length & 255]);
  if (typeof value === "number") {
    return value >= 0 ? head(0, value) : head(1, -1 - value);
  }
  if (typeof value === "string") {
    const bytes = Buffer.from(value);
    return Buffer.concat([head(3, bytes.length), bytes]);
  }
  if (Buffer.isBuffer(value)) return Buffer.concat([head(2, value.length), value]);
  if (value instanceof Map) {
    return Buffer.concat([
      head(5, value.size),
      ...[...value].flatMap(([key, entry]) => [cbor(key), cbor(entry)]),
    ]);
  }
  throw new Error("Unsupported CBOR value.");
}

const sha256 = (data: Buffer | string) => createHash("sha256").update(data).digest();
const b64url = (data: Buffer) => data.toString("base64url");

// A software passkey, like the ones a device's password manager holds.
function softwarePasskey() {
  const { privateKey, publicKey } = generateKeyPairSync("ec", { namedCurve: "P-256" });
  const jwk = publicKey.export({ format: "jwk" });
  const coseKey = cbor(
    new Map<number, unknown>([
      [1, 2],
      [3, -7],
      [-1, 1],
      [-2, Buffer.from(jwk.x!, "base64url")],
      [-3, Buffer.from(jwk.y!, "base64url")],
    ]),
  );
  return { credentialId: randomBytes(32), coseKey, privateKey, signCount: 0 };
}
type SoftwarePasskey = ReturnType<typeof softwarePasskey>;

function clientData(type: string, challenge: string, origin: string) {
  return Buffer.from(JSON.stringify({ challenge, crossOrigin: false, origin, type }));
}

function registration(key: SoftwarePasskey, challenge: string, origin = ORIGIN) {
  const length = Buffer.alloc(2);
  length.writeUInt16BE(key.credentialId.length);
  const authData = Buffer.concat([
    sha256(RP_ID),
    // User present and verified, attested credential data included.
    Buffer.from([0x45]),
    Buffer.alloc(4),
    Buffer.alloc(16),
    length,
    key.credentialId,
    key.coseKey,
  ]);
  return {
    authenticatorAttachment: "platform",
    clientExtensionResults: {},
    id: b64url(key.credentialId),
    rawId: b64url(key.credentialId),
    response: {
      attestationObject: b64url(
        cbor(new Map<string, unknown>([["fmt", "none"], ["attStmt", new Map()], ["authData", authData]])),
      ),
      clientDataJSON: b64url(clientData("webauthn.create", challenge, origin)),
      transports: ["internal"],
    },
    type: "public-key",
  };
}

function assertion(key: SoftwarePasskey, challenge: string) {
  key.signCount += 1;
  const counter = Buffer.alloc(4);
  counter.writeUInt32BE(key.signCount);
  const authenticatorData = Buffer.concat([sha256(RP_ID), Buffer.from([0x05]), counter]);
  const clientDataJSON = clientData("webauthn.get", challenge, ORIGIN);
  return {
    clientExtensionResults: {},
    id: b64url(key.credentialId),
    rawId: b64url(key.credentialId),
    response: {
      authenticatorData: b64url(authenticatorData),
      clientDataJSON: b64url(clientDataJSON),
      signature: b64url(
        sign("sha256", Buffer.concat([authenticatorData, sha256(clientDataJSON)]), key.privateKey),
      ),
    },
    type: "public-key",
  };
}

function cookiesOf(response: Response, earlier = "") {
  const jar = new Map(
    earlier
      .split("; ")
      .filter(Boolean)
      .map((pair) => [pair.split("=")[0], pair] as const),
  );
  for (const cookie of response.headers.getSetCookie()) {
    const pair = cookie.split(";")[0];
    jar.set(pair.split("=")[0], pair);
  }
  return [...jar.values()].join("; ");
}

function request(
  path: string,
  init: { body?: unknown; cookie?: string; ip?: string; method?: string } = {},
) {
  const method = init.method ?? (init.body === undefined ? "GET" : "POST");
  return new Request(`${ORIGIN}${path}`, {
    ...(method === "GET" ? {} : { body: JSON.stringify(init.body ?? {}) }),
    headers: {
      "content-type": "application/json",
      origin: ORIGIN,
      ...(init.cookie ? { cookie: init.cookie } : {}),
      ...(init.ip ? { "x-forwarded-for": init.ip } : {}),
    },
    method,
  });
}

async function browserRacer(username: string) {
  const response = await postAuth(request("/api/auth/sign-in/anonymous", { body: {} }));
  const { user } = (await response.json()) as { user: { id: string } };
  created.push(user.id);
  const cookie = cookiesOf(response);
  expect(
    (await putProfile(request("/api/profile", { body: { username }, cookie, method: "PUT" })))
      .status,
  ).toBe(200);
  return { cookie, id: user.id };
}

// Registers a passkey for the racer; returns the verify response.
async function addPasskey(
  cookie: string,
  key: SoftwarePasskey,
  origin = ORIGIN,
  verifyCookie?: (challengeCookie: string) => string,
) {
  const options = await getAuth(
    request("/api/auth/passkey/generate-register-options?name=keeper", { cookie }),
  );
  expect(options.status).toBe(200);
  const body = (await options.json()) as {
    authenticatorSelection: Record<string, string>;
    challenge: string;
    rp: { id: string };
    user: { id: string; name: string };
  };
  const verified = await postAuth(
    request("/api/auth/passkey/verify-registration", {
      body: { response: registration(key, body.challenge, origin) },
      cookie: verifyCookie ? verifyCookie(cookiesOf(options)) : cookiesOf(options, cookie),
    }),
  );
  return { options: body, verified };
}

async function signInWith(key: SoftwarePasskey, cookie = "") {
  const challenge = await getAuth(request("/api/auth/passkey/generate-authenticate-options"));
  const { challenge: value } = (await challenge.json()) as { challenge: string };
  const response = { response: assertion(key, value) };
  const signIn = await postAuth(
    request("/api/auth/passkey/verify-authentication", {
      body: response,
      cookie: cookiesOf(challenge, cookie),
    }),
  );
  return { response, signIn, challengeCookie: cookiesOf(challenge, cookie) };
}

// The pending registration challenges that name this racer.
function challengesFor(userId: string) {
  return db
    .select({ value: verifications.value })
    .from(verifications)
    .where(like(verifications.value, `%${userId}%`));
}

function uniqueUsername() {
  return `pk_${randomUUID().replaceAll("-", "").slice(0, 12)}`;
}

test.describe("passkeys", () => {
  test.beforeEach(() => {
    test.skip(
      requiredIntegrationVariables.some((name) => !process.env[name]?.trim()),
      "Database and auth environment variables are required for passkey tests.",
    );
  });

  test.afterAll(async () => {
    if (created.length) await db.delete(users).where(inArray(users.id, created));
  });

  test("keep a browser racer, sign back in, and can't be its last method removed", async () => {
    const racer = await browserRacer(uniqueUsername());
    const key = softwarePasskey();
    const { options, verified } = await addPasskey(racer.cookie, key);
    // A saved passkey bound to this site, named after the racer, with a
    // random user handle rather than the racer's ID.
    expect(options.rp.id).toBe(RP_ID);
    expect(options.authenticatorSelection).toMatchObject({ residentKey: "required" });
    expect(options.user.name).toBe("keeper");
    expect(options.user.id).not.toContain(racer.id);
    expect(verified.status).toBe(200);

    const profile = await getProfile(request("/api/profile", { cookie: racer.cookie }));
    const { loginMethods } = (await profile.json()) as {
      loginMethods: { id: string; kind: string; label: string }[];
    };
    expect(loginMethods.map(({ kind, label }) => ({ kind, label }))).toEqual([
      { kind: "passkey", label: "Passkey" },
    ]);

    // Signing in from a fresh browser lands on the same racer, once per
    // challenge.
    const { challengeCookie, response, signIn } = await signInWith(key);
    expect(signIn.status).toBe(200);
    await expect(signIn.json()).resolves.toMatchObject({ user: { id: racer.id } });
    const replayed = await postAuth(
      request("/api/auth/passkey/verify-authentication", {
        body: response,
        cookie: challengeCookie,
      }),
    );
    expect(replayed.status).toBe(400);

    const removed = await deleteLoginMethod(
      request("/api/profile/login-methods", {
        body: { id: loginMethods[0].id },
        cookie: racer.cookie,
        method: "DELETE",
      }),
    );
    expect(removed.status).toBe(409);
    const pluginRemove = await postAuth(
      request("/api/auth/passkey/delete-passkey", {
        body: { id: loginMethods[0].id },
        cookie: racer.cookie,
      }),
    );
    expect(pluginRemove.status).toBe(404);

    // With a second passkey, either can go.
    expect((await addPasskey(racer.cookie, softwarePasskey())).verified.status).toBe(200);
    expect(
      (
        await deleteLoginMethod(
          request("/api/profile/login-methods", {
            body: { id: loginMethods[0].id },
            cookie: racer.cookie,
            method: "DELETE",
          }),
        )
      ).status,
    ).toBe(200);
  });

  test("keeps no email with a challenge, and binds it to the racer who asked", async () => {
    const racer = await browserRacer(uniqueUsername());
    const other = await browserRacer(uniqueUsername());
    // The other racer's session can't finish this racer's registration.
    const { verified } = await addPasskey(
      racer.cookie,
      softwarePasskey(),
      ORIGIN,
      (challengeCookie) => `${other.cookie}; ${challengeCookie.split("; ").find((pair) => pair.includes("passkey"))}`,
    );
    expect(verified.status).toBe(401);

    await getAuth(request("/api/auth/passkey/generate-register-options?name=keeper", { cookie: racer.cookie }));
    const pending = await challengesFor(racer.id);
    expect(pending.length).toBeGreaterThan(0);
    for (const { value } of pending) {
      expect(JSON.parse(value).userData).toEqual({ id: racer.id });
    }
  });

  test("a racer kept only in this browser can't be replaced by a passkey sign-in", async () => {
    const keeper = await browserRacer(uniqueUsername());
    const key = softwarePasskey();
    expect((await addPasskey(keeper.cookie, key)).verified.status).toBe(200);
    const onlyHere = await browserRacer(uniqueUsername());
    const { signIn } = await signInWith(key, onlyHere.cookie);
    expect(signIn.status).toBe(400);
    expect(
      signIn.headers.getSetCookie().filter((cookie) => cookie.includes("session_token=")),
    ).toEqual([]);
  });

  test("limits passkey option requests, which each store a challenge", async () => {
    const limited = betterAuth({
      ...auth.options,
      rateLimit: { ...auth.options.rateLimit, enabled: true },
    });
    const racer = await browserRacer(uniqueUsername());
    const ip = `198.51.100.${Math.floor(Math.random() * 250) + 1}`;
    try {
      for (let index = 0; index < 10; index += 1) {
        const response = await limited.handler(
          request("/api/auth/passkey/generate-register-options?name=keeper", { cookie: racer.cookie, ip }),
        );
        expect(response.status).toBe(200);
      }
      const eleventh = await limited.handler(
        request("/api/auth/passkey/generate-register-options?name=keeper", { cookie: racer.cookie, ip }),
      );
      expect(eleventh.status).toBe(429);
      expect(await challengesFor(racer.id)).toHaveLength(10);
    } finally {
      await db.delete(rateLimits).where(like(rateLimits.key, `${ip}|%`));
    }
  });

  test("refuses a passkey made for another site", async () => {
    const racer = await browserRacer(uniqueUsername());
    const { verified } = await addPasskey(racer.cookie, softwarePasskey(), "https://evil.example");
    expect(verified.status).toBe(400);
    await expect(
      db.select().from(passkeys).where(eq(passkeys.userId, racer.id)),
    ).resolves.toEqual([]);
  });

  test("anonymizing by username removes its passkeys, and none can be added after", async () => {
    const username = uniqueUsername();
    const racer = await browserRacer(username);
    expect((await addPasskey(racer.cookie, softwarePasskey())).verified.status).toBe(200);
    // A passkey started but never finished leaves a challenge behind.
    await getAuth(request("/api/auth/passkey/generate-register-options?name=keeper", { cookie: racer.cookie }));

    await expect(anonymizeUserByUsername(`@${username.toUpperCase()}`)).resolves.toEqual({
      userId: racer.id,
    });
    await expect(
      db.select().from(passkeys).where(eq(passkeys.userId, racer.id)),
    ).resolves.toEqual([]);
    await expect(challengesFor(racer.id)).resolves.toEqual([]);
    await expect(
      db.insert(passkeys).values({
        backedUp: false,
        counter: 0,
        credentialID: b64url(randomBytes(32)),
        deviceType: "singleDevice",
        id: randomUUID(),
        publicKey: "key",
        userId: racer.id,
      }),
    ).rejects.toThrow();
  });
});

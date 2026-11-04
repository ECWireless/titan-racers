import { drizzleAdapter } from "@better-auth/drizzle-adapter";
import { passkey } from "@better-auth/passkey";
import {
  APIError,
  createAuthMiddleware,
  getSessionFromCtx,
} from "better-auth/api";
import { generateRandomString } from "better-auth/crypto";
import { betterAuth } from "better-auth/minimal";
import { anonymous } from "better-auth/plugins/anonymous";
import { siwe } from "better-auth/plugins/siwe";

import { and, eq, notExists } from "drizzle-orm";

import { db } from "@/db/client";
import { accounts, authSchema, passkeys, users } from "@/db/schema";
import { createRacerUsernameSeed } from "@/lib/racer-username";
import {
  isWalletAddress,
  verifyWalletSignature,
  WALLET_EMAIL_DOMAIN,
} from "@/lib/siwe";

const unavailableValue = "unavailable-until-runtime-environment-is-configured";
const baseURL = process.env.BETTER_AUTH_URL ?? "http://localhost:3000";
const DAY_SECONDS = 24 * 60 * 60;
const KEEP_DEFAULT_LIMIT = (_request: Request, current: { max: number; window: number }) =>
  current;
// Each request for passkey options stores a challenge, and a racer needs
// only a few.
const PASSKEY_OPTIONS_LIMIT = { max: 10, window: 60 };

// The passkey plugin keeps the racer's email with each registration
// challenge; it needs only the racer's ID.
function withoutPasskeyIdentity(value: string) {
  try {
    const challenge = JSON.parse(value) as {
      type?: unknown;
      userData?: { id?: unknown };
    };
    if (challenge.type !== "registration" || !challenge.userData) return value;
    return JSON.stringify({ ...challenge, userData: { id: challenge.userData.id } });
  } catch {
    return value;
  }
}

// A racer kept only in this browser can't sign back in, so no other sign-in
// may replace its session.
async function isOnlyInThisBrowser(userId: string) {
  const [racer] = await db
    .select({ id: users.id })
    .from(users)
    .where(
      and(
        eq(users.id, userId),
        eq(users.isAnonymous, true),
        notExists(
          db.select().from(accounts).where(eq(accounts.userId, users.id)),
        ),
        notExists(
          db.select().from(passkeys).where(eq(passkeys.userId, users.id)),
        ),
      ),
    );
  return Boolean(racer);
}

export const auth = betterAuth({
  appName: "Titan Racers",
  baseURL,
  secret: process.env.BETTER_AUTH_SECRET ?? unavailableValue,
  database: drizzleAdapter(db, {
    provider: "pg",
    schema: authSchema,
    usePlural: true,
  }),
  user: {
    additionalFields: {
      username: {
        input: false,
        required: false,
        returned: true,
        type: "string",
      },
    },
  },
  // Our profile route lists and removes login methods, so the last one
  // always stays. A racer kept in this browser is never deleted.
  disabledPaths: [
    "/unlink-account",
    "/delete-anonymous-user",
    "/passkey/delete-passkey",
    "/passkey/list-user-passkeys",
    "/passkey/update-passkey",
  ],
  session: {
    // A racer kept in this browser exists only through this cookie, so it
    // lasts as long as browsers allow and renews at most daily on use.
    expiresIn: 400 * DAY_SECONDS,
    // A racer kept in this browser can't sign in again to prove a fresh
    // session, so adding a passkey, like linking Google or a wallet, needs
    // only a live one.
    freshAge: 0,
    updateAge: DAY_SECONDS,
  },
  rateLimit: {
    // On in production only. Counts are shared by every server instance.
    // Requests are counted before routing, by their exact path, so only
    // these sign-in paths are; any other path, unknown ones included,
    // never writes a row. The first matching rule applies.
    customRules: {
      "/sign-in/anonymous": { max: 10, window: 60 * 60 },
      "/sign-in/social": KEEP_DEFAULT_LIMIT,
      "/callback/google": KEEP_DEFAULT_LIMIT,
      "/siwe/nonce": KEEP_DEFAULT_LIMIT,
      "/siwe/verify": KEEP_DEFAULT_LIMIT,
      "/passkey/generate-authenticate-options": PASSKEY_OPTIONS_LIMIT,
      "/passkey/generate-register-options": PASSKEY_OPTIONS_LIMIT,
      "/passkey/verify-authentication": KEEP_DEFAULT_LIMIT,
      "/**": false,
    },
    storage: "database",
  },
  hooks: {
    before: createAuthMiddleware(async (ctx) => {
      const signsIn = [
        "/sign-in/anonymous",
        "/sign-in/social",
        "/siwe/verify",
        "/passkey/verify-authentication",
      ];
      if (!signsIn.includes(ctx.path)) return;
      const current = await getSessionFromCtx(ctx, { disableRefresh: true });
      if (!current) return;
      // A racer kept in this browser starts only when signed out, so it
      // never replaces a signed-in racer.
      if (ctx.path === "/sign-in/anonymous") {
        throw new APIError("BAD_REQUEST", {
          message: "Sign out before starting a new racer.",
        });
      }
      // Refused before a wallet sign-in creates its racer; the session hook
      // below also covers sign-ins already under way.
      if (await isOnlyInThisBrowser(current.user.id)) {
        throw new APIError("BAD_REQUEST", {
          message: "Sign out of this browser's racer first.",
        });
      }
    }),
  },
  account: {
    // Only a signed-in racer's explicit link adds Google; a matching email
    // never links, and wallet-first racers have a placeholder email.
    accountLinking: {
      allowDifferentEmails: true,
      disableImplicitLinking: true,
      enabled: true,
    },
    encryptOAuthTokens: true,
    updateAccountOnSignIn: false,
  },
  socialProviders: {
    google: {
      clientId: process.env.GOOGLE_CLIENT_ID ?? unavailableValue,
      clientSecret: process.env.GOOGLE_CLIENT_SECRET ?? unavailableValue,
      mapProfileToUser: (profile) => ({
        image: undefined,
        name: createRacerUsernameSeed(profile.given_name),
      }),
      prompt: "select_account",
    },
  },
  plugins: [
    // The racer is the lasting ID: methods link to it, and nothing merges
    // it into another racer or deletes it.
    anonymous({
      disableDeleteAnonymousUser: true,
      generateName: () => "racer",
    }),
    // Bound to this site's own origin and domain, never the request's.
    passkey({
      authenticatorSelection: {
        residentKey: "required",
        userVerification: "preferred",
      },
      origin: new URL(baseURL).origin,
      rpID: new URL(baseURL).hostname,
      rpName: "Titan Racers",
    }),
    siwe({
      domain: new URL(baseURL).host,
      emailDomainName: WALLET_EMAIL_DOMAIN,
      getNonce: async () => generateRandomString(32, "a-z", "A-Z", "0-9"),
      verifyMessage: verifyWalletSignature,
    }),
  ],
  databaseHooks: {
    verification: {
      create: {
        before: async (verification) => ({
          data: {
            ...verification,
            value: withoutPasskeyIdentity(verification.value),
          },
        }),
      },
    },
    session: {
      create: {
        before: async (session, context) => {
          const current = context
            ? await getSessionFromCtx(context, { disableRefresh: true })
            : null;
          if (
            current &&
            current.user.id !== session.userId &&
            (await isOnlyInThisBrowser(current.user.id))
          ) {
            throw new APIError("BAD_REQUEST", {
              message: "Sign out of this browser's racer first.",
            });
          }
          // Nothing reads where or on what a session started.
          return { data: { ...session, ipAddress: null, userAgent: null } };
        },
      },
    },
    user: {
      create: {
        before: async (user) => ({
          data: {
            ...user,
            image: null,
            // A wallet-first racer's name is its address; never suggest it
            // as a public username.
            name: isWalletAddress(user.name)
              ? "racer"
              : createRacerUsernameSeed(user.name),
          },
        }),
      },
      update: {
        before: async (user) => {
          if (
            user.name !== undefined ||
            user.username !== undefined ||
            (user.image !== undefined && user.image !== null)
          ) {
            throw new APIError("BAD_REQUEST", {
              message: "Racer identity is managed through account onboarding.",
            });
          }
          return { data: user };
        },
      },
    },
    account: {
      create: {
        before: async (account) => ({
          data: {
            ...account,
            accessToken: null,
            accessTokenExpiresAt: null,
            idToken: null,
            refreshToken: null,
            refreshTokenExpiresAt: null,
          },
        }),
      },
      update: {
        before: async (account) => ({
          data: {
            ...account,
            accessToken: null,
            accessTokenExpiresAt: null,
            idToken: null,
            refreshToken: null,
            refreshTokenExpiresAt: null,
          },
        }),
      },
    },
  },
});

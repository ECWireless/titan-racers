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
  cancelRacerMergeRequest,
  hasRacerMergeRequest,
  mergeRacers,
  RacerMergeError,
} from "@/server/racer-merges";
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
// Each wallet nonce or passkey options request stores a challenge without
// needing a session, and a racer needs only a few.
const CHALLENGE_LIMIT = { max: 10, window: 60 };

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
// may replace its session unless it asked to be brought into that racer.
export async function isOnlyInThisBrowser(userId: string) {
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
    // An unused alias of /siwe/nonce.
    "/siwe/get-nonce",
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
      "/siwe/nonce": CHALLENGE_LIMIT,
      "/siwe/verify": KEEP_DEFAULT_LIMIT,
      "/passkey/generate-authenticate-options": CHALLENGE_LIMIT,
      "/passkey/generate-register-options": CHALLENGE_LIMIT,
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
          message: "Sign out before starting a new account.",
        });
      }
      // Refused before a wallet sign-in creates its racer, unless this
      // browser's racer asked to be brought into the racer signing in; the
      // session hook below also covers sign-ins already under way.
      if (
        (await isOnlyInThisBrowser(current.user.id)) &&
        !(await hasRacerMergeRequest(current.session.id, current.user.id))
      ) {
        throw new APIError("BAD_REQUEST", {
          code: "SIGN_OUT_FIRST",
          message: "Sign out of this browser's account first.",
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
          const switching = current && current.user.id !== session.userId;
          // A racer that asked is brought into the racer signing in before
          // that racer's session exists, so a failed merge leaves it signed
          // in here. The merge itself refuses a racer that gained a login
          // method since asking.
          if (
            switching &&
            (await hasRacerMergeRequest(current.session.id, current.user.id))
          ) {
            let merged;
            try {
              merged = await mergeRacers({
                fromUserId: current.user.id,
                sessionId: current.session.id,
                toUserId: session.userId,
              });
            } catch (error) {
              // Query errors carry their parameters, so only the kind is logged.
              console.error("Racer merge failed", {
                code: (error as { cause?: { code?: unknown } })?.cause?.code,
                name: error instanceof Error ? error.name : typeof error,
                reason: error instanceof RacerMergeError ? error.message : undefined,
              });
              if (error instanceof RacerMergeError) {
                await cancelRacerMergeRequest(current.session.id);
              }
              throw new APIError("BAD_REQUEST", {
                code: "RACER_MERGE_FAILED",
                message: "Your accounts couldn't be merged. Please retry.",
              });
            }
            // The request ran out just as it was used.
            if (!merged) {
              throw new APIError("BAD_REQUEST", {
                code: "RACER_MERGE_FAILED",
                message: "Your accounts couldn't be merged. Please retry.",
              });
            }
          } else if (switching && (await isOnlyInThisBrowser(current.user.id))) {
            // With a code, a Google sign-in comes back to its error page,
            // the profile when it was meant to bring this racer in.
            throw new APIError("BAD_REQUEST", {
              code: "SIGN_OUT_FIRST",
              message: "Sign out of this browser's account first.",
            });
          }
          // Nothing reads where or on what a session started.
          return { data: { ...session, ipAddress: null, userAgent: null } };
        },
      },
      // Sessions an earlier build wrote lose theirs when they renew.
      update: {
        before: async (session) => ({
          data: { ...session, ipAddress: null, userAgent: null },
        }),
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
              message: "Your username is chosen during account setup.",
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

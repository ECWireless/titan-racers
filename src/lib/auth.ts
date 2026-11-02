import { drizzleAdapter } from "@better-auth/drizzle-adapter";
import { APIError } from "better-auth/api";
import { generateRandomString } from "better-auth/crypto";
import { betterAuth } from "better-auth/minimal";
import { siwe } from "better-auth/plugins/siwe";

import { db } from "@/db/client";
import { authSchema } from "@/db/schema";
import { createRacerUsernameSeed } from "@/lib/racer-username";
import {
  isWalletAddress,
  verifyWalletSignature,
  WALLET_EMAIL_DOMAIN,
} from "@/lib/siwe";

const unavailableValue = "unavailable-until-runtime-environment-is-configured";
const baseURL = process.env.BETTER_AUTH_URL ?? "http://localhost:3000";

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
  // Our profile route unlinks so a wallet's SIWE row goes with its account.
  disabledPaths: ["/unlink-account"],
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
    siwe({
      domain: new URL(baseURL).host,
      emailDomainName: WALLET_EMAIL_DOMAIN,
      getNonce: async () => generateRandomString(32, "a-z", "A-Z", "0-9"),
      verifyMessage: verifyWalletSignature,
    }),
  ],
  databaseHooks: {
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

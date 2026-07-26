import { randomInt } from "node:crypto";

import { and, eq, isNull } from "drizzle-orm";

import { db } from "@/db/client";
import { users } from "@/db/schema";
import {
  createRacerUsernameSeed,
  createSuffixedRacerUsername,
  racerUsernameSchema,
} from "@/lib/racer-username";

export class RacerIdentityNotFoundError extends Error {
  constructor() {
    super("The authenticated racer account does not exist.");
    this.name = "RacerIdentityNotFoundError";
  }
}

export class RacerUsernameAlreadyClaimedError extends Error {
  constructor() {
    super("This account already has an immutable username.");
    this.name = "RacerUsernameAlreadyClaimedError";
  }
}

export class RacerUsernameTakenError extends Error {
  constructor() {
    super("That username is already taken.");
    this.name = "RacerUsernameTakenError";
  }
}

function postgresErrorCode(error: unknown): string | undefined {
  if (!error || typeof error !== "object") return undefined;
  if ("code" in error && typeof error.code === "string") return error.code;
  return "cause" in error ? postgresErrorCode(error.cause) : undefined;
}

async function usernameIsAvailable(username: string) {
  const [existing] = await db
    .select({ id: users.id })
    .from(users)
    .where(eq(users.username, username))
    .limit(1);
  return !existing;
}

async function availableUsernameSuggestion(seed: string) {
  const normalizedSeed = createRacerUsernameSeed(seed);
  if (
    normalizedSeed !== "racer" &&
    (await usernameIsAvailable(normalizedSeed))
  ) {
    return normalizedSeed;
  }

  for (let attempt = 0; attempt < 40; attempt += 1) {
    const candidate = createSuffixedRacerUsername(
      normalizedSeed,
      randomInt(0, 10_000),
    );
    if (await usernameIsAvailable(candidate)) return candidate;
  }

  throw new Error("An available racer username could not be suggested.");
}

export type RacerIdentity =
  | { status: "complete"; username: string }
  | { status: "incomplete"; suggestedUsername: string };

export async function loadRacerIdentity(
  userId: string,
): Promise<RacerIdentity> {
  const [user] = await db
    .select({ name: users.name, username: users.username })
    .from(users)
    .where(eq(users.id, userId))
    .limit(1);
  if (!user) throw new RacerIdentityNotFoundError();
  if (user.username) {
    return { status: "complete", username: user.username };
  }
  return {
    status: "incomplete",
    suggestedUsername: await availableUsernameSuggestion(user.name),
  };
}

export async function claimRacerUsername(userId: string, rawUsername: string) {
  const username = racerUsernameSchema.parse(rawUsername);
  const [current] = await db
    .select({ username: users.username })
    .from(users)
    .where(eq(users.id, userId))
    .limit(1);
  if (!current) throw new RacerIdentityNotFoundError();
  if (current.username === username) return username;
  if (current.username) throw new RacerUsernameAlreadyClaimedError();

  try {
    const [updated] = await db
      .update(users)
      .set({ name: username, username })
      .where(and(eq(users.id, userId), isNull(users.username)))
      .returning({ username: users.username });
    if (!updated?.username) throw new RacerUsernameAlreadyClaimedError();
    return updated.username;
  } catch (error) {
    if (postgresErrorCode(error) === "23505") {
      throw new RacerUsernameTakenError();
    }
    throw error;
  }
}

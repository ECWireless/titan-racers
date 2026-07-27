import { z } from "zod";

export const RACER_USERNAME_MIN_LENGTH = 3;
export const RACER_USERNAME_MAX_LENGTH = 20;
export const RACER_USERNAME_REQUIREMENTS =
  "Use 3–20 letters, numbers, or internal underscores.";
export const RACER_USERNAME_RESERVED =
  "That username is reserved. Choose another.";

const reservedUsernames = new Set([
  "admin",
  "administrator",
  "deleted",
  "moderator",
  "official",
  "racer",
  "root",
  "staff",
  "support",
  "system",
  "titanracers",
]);
const reservedUsernameTokens = new Set([
  "admin",
  "administrator",
  "moderator",
  "official",
  "root",
  "staff",
  "support",
  "system",
  "titan",
]);
const usernamePattern =
  /^(?!.*__)[a-z0-9](?:[a-z0-9_]{1,18}[a-z0-9])$/;

export function normalizeRacerUsername(value: string) {
  return value
    .normalize("NFKD")
    .replace(/\p{M}/gu, "")
    .toLocaleLowerCase("en-US")
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/_+/g, "_")
    .replace(/^_|_$/g, "")
    .slice(0, RACER_USERNAME_MAX_LENGTH)
    .replace(/_$/g, "");
}

function canonicalReservedUsername(value: string) {
  return value.replace(/_/g, "");
}

export function isReservedRacerUsername(value: string) {
  const canonical = canonicalReservedUsername(value);
  return (
    reservedUsernames.has(canonical) ||
    canonical.includes("titanracers") ||
    value.split("_").some((token) => reservedUsernameTokens.has(token))
  );
}

export const racerUsernameSchema = z
  .string()
  .transform(normalizeRacerUsername)
  .pipe(
    z
      .string()
      .regex(usernamePattern, RACER_USERNAME_REQUIREMENTS)
      .refine(
        (value) => !isReservedRacerUsername(value),
        RACER_USERNAME_RESERVED,
      ),
  );

export function createRacerUsernameSeed(value: unknown) {
  if (typeof value !== "string") return "racer";
  const normalized = normalizeRacerUsername(value);
  return racerUsernameSchema.safeParse(normalized).success
    ? normalized
    : "racer";
}

export function createSuffixedRacerUsername(seed: string, suffix: number) {
  const safeSeed = createRacerUsernameSeed(seed);
  const base = safeSeed === "racer" ? safeSeed : safeSeed.slice(0, 16);
  const digits = Math.max(0, Math.min(9_999, Math.trunc(suffix)))
    .toString()
    .padStart(4, "0");
  return `${base}${digits}`;
}

export function safeRacerReturnTo(value: string | null | undefined) {
  if (!value || value.length > 200 || /[\\\u0000-\u001f\u007f]/u.test(value)) {
    return "/";
  }
  try {
    const applicationOrigin = new URL("https://titan-racers.invalid");
    const resolved = new URL(value, applicationOrigin);
    if (!value.startsWith("/") || resolved.origin !== applicationOrigin.origin) {
      return "/";
    }
    return `${resolved.pathname}${resolved.search}${resolved.hash}`;
  } catch {
    return "/";
  }
}

export function racerOnboardingPath(returnTo = "/") {
  return `/onboarding?returnTo=${encodeURIComponent(
    safeRacerReturnTo(returnTo),
  )}`;
}

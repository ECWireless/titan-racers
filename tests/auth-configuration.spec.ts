import { readFileSync } from "node:fs";
import { join } from "node:path";

import { expect, test } from "@playwright/test";

import { auth } from "../src/lib/auth";
import {
  createRacerUsernameSeed,
  createSuffixedRacerUsername,
  normalizeRacerUsername,
  racerUsernameSchema,
  RACER_USERNAME_REQUIREMENTS,
  RACER_USERNAME_RESERVED,
  safeRacerReturnTo,
} from "../src/lib/racer-username";
import { authorizationErrorResponse } from "../src/server/authorization";

test("requires explicit Google account selection", () => {
  expect(auth.options.socialProviders?.google).toMatchObject({
    prompt: "select_account",
  });
});

test("prevents caching transient authorization failures", () => {
  for (const status of [401, 403, 428, 503] as const) {
    const response = authorizationErrorResponse(status);

    expect(response.status).toBe(status);
    expect(response.headers.get("cache-control")).toBe("no-store");
  }
});

test("normalizes editable username seeds to lowercase ASCII", () => {
  expect(normalizeRacerUsername("  Élliott   Racer  ")).toBe("elliott_racer");
  expect(racerUsernameSchema.parse("  Nova---Racer  ")).toBe("nova_racer");
  expect(createRacerUsernameSeed("Elliott Conway")).toBe("elliott_conway");
  expect(createSuffixedRacerUsername("Very Long Racer Name", 42)).toBe(
    "very_long_racer_0042",
  );
});

test("rejects malformed and reserved usernames", () => {
  for (const username of ["", "ab"]) {
    expect(racerUsernameSchema.safeParse(username).success).toBe(false);
  }
  expect(racerUsernameSchema.parse("_Racer__One_")).toBe("racer_one");
  expect(racerUsernameSchema.safeParse("Titan_Racers").error?.issues[0]?.message).toBe(
    RACER_USERNAME_RESERVED,
  );
  for (const username of [
    "titanracers_admin",
    "official_support",
    "support_team",
  ]) {
    expect(racerUsernameSchema.safeParse(username).error?.issues[0]?.message).toBe(
      RACER_USERNAME_RESERVED,
    );
  }
  expect(racerUsernameSchema.safeParse("xy").error?.issues[0]?.message).toBe(
    RACER_USERNAME_REQUIREMENTS,
  );
});

test("keeps onboarding return paths on the application origin", () => {
  expect(safeRacerReturnTo("/admin/karts?tab=official#balanced")).toBe(
    "/admin/karts?tab=official#balanced",
  );
  for (const returnTo of [
    "https://evil.example",
    "//evil.example",
    "/\\evil.example",
    "/\t/evil.example",
  ]) {
    expect(safeRacerReturnTo(returnTo)).toBe("/");
  }
});

test("uses only the Google given name as the provisional private seed", () => {
  const mapProfileToUser =
    auth.options.socialProviders?.google?.mapProfileToUser;
  expect(mapProfileToUser).toBeDefined();
  const profile = {
    email: "elliott@example.invalid",
    given_name: "Élliott",
    name: "Élliott Conway",
    sub: "google-subject",
  } as Parameters<NonNullable<typeof mapProfileToUser>>[0];

  expect(mapProfileToUser?.(profile)).toEqual({
    image: undefined,
    name: "elliott",
  });
});

test("minimizes legacy names to private first-name seeds and clears avatars", () => {
  const migration = readFileSync(
    join(process.cwd(), "drizzle/0012_racer_usernames.sql"),
    "utf8",
  );

  expect(migration).toContain(`SET "name" = coalesce(
      substring(btrim("name") from '^[^[:space:]]+'),
      'racer'
    ),
    "image" = null`);
  expect(migration).not.toContain(`SET "name" = 'racer'`);
});

test("defensively scrubs provider names before user creation", async () => {
  const beforeCreate = auth.options.databaseHooks?.user?.create?.before;
  expect(beforeCreate).toBeDefined();

  await expect(
    beforeCreate?.({
      createdAt: new Date(),
      email: "racer@example.invalid",
      emailVerified: true,
      id: "racer-id",
      image: "https://example.invalid/google-profile.png",
      name: "  Élliott Conway  ",
      updatedAt: new Date(),
    }),
  ).resolves.toMatchObject({
    data: { image: null, name: "elliott_conway" },
  });
});

test("blocks generic Better Auth identity updates after account creation", async () => {
  const beforeUpdate = auth.options.databaseHooks?.user?.update?.before;
  expect(beforeUpdate).toBeDefined();

  await expect(beforeUpdate?.({ name: "new_name" })).rejects.toMatchObject({
    message: "Racer identity is managed through account onboarding.",
  });
  await expect(beforeUpdate?.({ username: "new_username" })).rejects.toMatchObject({
    message: "Racer identity is managed through account onboarding.",
  });
  await expect(
    beforeUpdate?.({ image: "https://example.invalid/avatar.png" }),
  ).rejects.toMatchObject({
    message: "Racer identity is managed through account onboarding.",
  });
  await expect(beforeUpdate?.({ image: null })).resolves.toEqual({
    data: { image: null },
  });
});

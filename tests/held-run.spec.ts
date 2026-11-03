import { expect, test } from "@playwright/test";

import { holdRun } from "../src/game/race/held-run";

const NOW = 1_800_000_000_000;

function run(ticket: string, timeMicroseconds: number, expiresAt = NOW + 60_000) {
  return { expiresAt, recording: "recording", ticket, timeMicroseconds };
}

function useStorage(localStorage: Partial<Storage> | (() => never)) {
  (globalThis as { window?: unknown }).window =
    typeof localStorage === "function"
      ? {
          get localStorage() {
            return localStorage();
          },
        }
      : { localStorage };
}

test.afterEach(() => {
  delete (globalThis as { window?: unknown }).window;
});

test("keeps the fastest run still in time", () => {
  const items = new Map<string, string>();
  useStorage({
    getItem: (key) => items.get(key) ?? null,
    removeItem: (key) => void items.delete(key),
    setItem: (key, value) => void items.set(key, value),
  });

  expect(holdRun(run("first", 90), NOW)?.ticket).toBe("first");
  // A slower run leaves the faster one waiting.
  expect(holdRun(run("slower", 95), NOW)?.ticket).toBe("first");
  // A run whose ticket ran out during the race is not kept.
  expect(holdRun(run("late", 80, NOW), NOW)).toBeNull();
  expect(holdRun(run("faster", 85), NOW)?.ticket).toBe("faster");
  // Once the held run expires, a slower one takes its place.
  expect(holdRun(run("later", 99, NOW + 120_000), NOW + 61_000)?.ticket).toBe(
    "later",
  );
});

test("keeps nothing, without throwing, when storage is blocked", () => {
  useStorage(() => {
    throw new DOMException("Blocked", "SecurityError");
  });
  expect(holdRun(run("first", 90), NOW)).toBeNull();
});

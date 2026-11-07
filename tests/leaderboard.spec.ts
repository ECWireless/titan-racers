import { expect, type Page, test } from "@playwright/test";

import {
  installStandardGamepadFixture,
  setStandardTestGamepad,
} from "./helpers/standard-gamepad";

// Two earlier course versions, newest first.
const EARLIER = [
  {
    firstTimeAt: "2026-11-02T15:00:00.000Z",
    lastTimeAt: "2026-11-03T10:00:00.000Z",
    number: 2,
  },
  {
    firstTimeAt: "2026-10-30T15:00:00.000Z",
    lastTimeAt: "2026-10-30T18:00:00.000Z",
    number: 1,
  },
];

// Username, best time, fastest lap, and whether it is the viewer's.
const RACERS = [
  ["quick_racer", 78_500_000, 38_900_000, false],
  ["steady_racer", 92_250_000, 44_000_000, true],
  ["third_racer", 101_000_000, 49_500_000, false],
  ["new_racer", 130_000_000, 38_100_000, false],
] as const;

function board({ earlier = [] as typeof EARLIER, listed = true } = {}) {
  const entry = (
    [username, timeMicroseconds, fastestLapMicroseconds, viewer]: (typeof RACERS)[number],
    index: number,
  ) => ({
    fastestLapMicroseconds,
    kartName: "Balanced Kart",
    rank: index + 1,
    timeMicroseconds,
    username,
    viewer: listed && viewer,
  });
  return {
    earlier,
    board: {
      courseName: "Falls View Park",
      entries: RACERS.map(entry),
      lapEntries: [...RACERS].sort((left, right) => left[2] - right[2]).map(entry),
      viewer: listed
        ? {
            fastestLap: { rank: 3, timeMicroseconds: 44_000_000 },
            rank: 2,
            timeMicroseconds: 92_250_000,
          }
        : {
            fastestLap: { rank: 58, timeMicroseconds: 61_000_000 },
            rank: 61,
            timeMicroseconds: 190_000_000,
          },
    },
  };
}

// A run kept on this device from a race before signing in.
async function keepRun(page: Page, timeMicroseconds: number) {
  await page.addInitScript(
    ([run]) => localStorage.setItem("titan-racers.held-run.v1", run),
    [
      JSON.stringify({
        expiresAt: Date.now() + 20 * 60 * 1_000,
        recording: "test-recording",
        ticket: "guest-ticket",
        timeMicroseconds,
      }),
    ],
  );
}

const keptRun = (page: Page) =>
  page.evaluate(() => localStorage.getItem("titan-racers.held-run.v1"));

test.describe("leaderboard page", () => {
  test("lists best times, the podium, and the viewer's row", async ({
    page,
  }) => {
    await page.route("**/api/leaderboards/falls-view-park", (route) =>
      route.fulfill({ json: board() }),
    );
    await page.goto("/leaderboard");

    await expect(
      page.getByRole("heading", { level: 1, name: "Falls View Park" }),
    ).toBeVisible();
    const rows = page
      .getByRole("list", { name: "Best times" })
      .getByRole("listitem");
    await expect(rows).toHaveCount(4);
    await expect(rows.nth(0)).toContainText("@quick_racer");
    await expect(rows.nth(0)).toContainText("1:18.500");
    for (const [index, medal] of ["Gold", "Silver", "Bronze"].entries()) {
      await expect(
        rows.nth(index).getByRole("img", { name: `${index + 1}, ${medal}` }),
      ).toBeVisible();
    }
    await expect(rows.nth(3).getByRole("img")).toHaveCount(0);
    await expect(rows.nth(1)).toHaveAttribute("aria-current", "true");
    await expect(page.getByText(/Your best/)).toHaveCount(0);
    await expect(rows.nth(0)).toContainText("Fastest lap 0:38.900");
  });

  test("ranks by fastest lap, without medals, and keeps the choice in the address", async ({
    page,
  }) => {
    await page.route("**/api/leaderboards/falls-view-park", (route) =>
      route.fulfill({ json: board({ listed: false }) }),
    );
    await page.goto("/leaderboard");
    const total = page.getByRole("button", { name: "Total time" });
    await expect(total).toHaveAttribute("aria-pressed", "true");

    // Both rankings came with the board, so switching asks for nothing.
    const requests: string[] = [];
    page.on("request", (request) => requests.push(request.url()));
    await page.getByRole("button", { name: "Fastest lap" }).click();
    await expect(page).toHaveURL(/\/leaderboard\?sort=lap$/);
    const rows = page
      .getByRole("list", { name: "Fastest laps" })
      .getByRole("listitem");
    await expect(rows).toHaveCount(4);
    await expect(rows.nth(0)).toContainText("@new_racer");
    await expect(rows.nth(0)).toContainText("0:38.100");
    await expect(rows.nth(0)).toContainText("Total 2:10.000");
    await expect(page.getByRole("img", { name: /Gold/ })).toHaveCount(0);
    await expect(page.getByText("Your fastest lap: 1:01.000, rank 58")).toBeVisible();
    expect(requests).toEqual([]);

    // A link to it opens on the same ranking.
    await page.reload();
    await expect(page.getByRole("button", { name: "Fastest lap" })).toHaveAttribute(
      "aria-pressed",
      "true",
    );
    await total.click();
    await expect(page).toHaveURL(/\/leaderboard$/);
    await expect(page.getByRole("list", { name: "Best times" })).toBeVisible();
  });

  test("steps a controller down the board from the viewer's row, one stop a row", async ({
    page,
  }) => {
    await installStandardGamepadFixture(page);
    await page.route("**/api/leaderboards/falls-view-park", (route) =>
      route.fulfill({ json: board() }),
    );
    await page.goto("/leaderboard");
    const rows = page
      .getByRole("list", { name: "Best times" })
      .getByRole("listitem");
    await expect(rows).toHaveCount(4);
    const race = (row: number) =>
      rows.nth(row).getByRole("link", { name: /^Race @/ });
    const press = async (button: number) => {
      await setStandardTestGamepad(page);
      await page.waitForTimeout(50);
      await setStandardTestGamepad(page, { buttons: { [button]: 1 } });
      await page.waitForTimeout(50);
      // Released at once, so a slow frame cannot hold it into a repeat.
      await setStandardTestGamepad(page);
    };
    // Moves start from the viewer's row (rank 2) and go Race to Race.
    await press(13);
    await expect(race(2)).toBeFocused();
    await press(13);
    await expect(race(3)).toBeFocused();
    await press(12);
    await press(12);
    await expect(race(1)).toBeFocused();
    await press(15);
    await expect(
      rows.nth(1).getByRole("button", { name: /^Copy @/ }),
    ).toBeFocused();

    // The arrow keys move the same way.
    await page.keyboard.press("ArrowLeft");
    await expect(race(1)).toBeFocused();
    await page.keyboard.press("ArrowDown");
    await expect(race(2)).toBeFocused();
  });

  test("shows the viewer's rank below the top of the board", async ({
    page,
  }) => {
    await page.route("**/api/leaderboards/falls-view-park", (route) =>
      route.fulfill({ json: board({ listed: false }) }),
    );
    await page.goto("/leaderboard");
    await expect(page.getByText("Your best: 3:10.000, rank 61")).toBeVisible();
    await expect(page.locator("[aria-current]")).toHaveCount(0);
  });

  test("shows an empty board", async ({ page }) => {
    await page.route("**/api/leaderboards/falls-view-park", (route) =>
      route.fulfill({
        json: {
          board: {
            courseName: "Falls View Park",
            entries: [],
            lapEntries: [],
            viewer: null,
          },
          earlier: [],
        },
      }),
    );
    await page.goto("/leaderboard");
    await expect(page.getByText("No times yet")).toBeVisible();
  });

  test("puts a run kept from before signing in on the board first", async ({
    page,
  }) => {
    await keepRun(page, 92_250_000);
    const requests: string[] = [];
    await page.route("**/api/runs", async (route) => {
      requests.push("run");
      expect(route.request().postDataJSON()).toEqual({
        recording: "test-recording",
        ticket: "guest-ticket",
      });
      await route.fulfill({
        json: {
          entries: 4,
          personalBest: { improved: true, timeMicroseconds: 92_250_000 },
          rank: 2,
          status: "verified",
          username: "steady_racer",
        },
      });
    });
    await page.route("**/api/leaderboards/falls-view-park", (route) => {
      requests.push("board");
      return route.fulfill({ json: board() });
    });
    await page.goto("/leaderboard");
    // Loaded, so the loading status is gone.
    await expect(page.getByRole("list", { name: "Best times" })).toBeVisible();

    await expect(page.getByRole("status")).toHaveText(
      "Your 1:32.250 is on the leaderboard, rank 2 of 4.",
    );
    await expect(page.locator("[aria-current]")).toContainText("@steady_racer");
    expect(requests.slice(0, 2)).toEqual(["run", "board"]);
    expect(await keptRun(page)).toBeNull();
  });

  test("asks to sign in while a kept run waits", async ({ page }) => {
    await keepRun(page, 65_000_000);
    await page.route("**/api/runs", (route) =>
      route.fulfill({ json: { error: "Authentication required." }, status: 401 }),
    );
    await page.route("**/api/leaderboards/falls-view-park", (route) =>
      route.fulfill({ json: board({ listed: false }) }),
    );
    await page.goto("/leaderboard");
    await expect(page.getByRole("list", { name: "Best times" })).toBeVisible();

    const status = page.getByRole("status");
    await expect(status).toContainText(
      "Sign in to put your 1:05.000 on the leaderboard.",
    );
    await expect(status.getByRole("link", { name: "Sign in" })).toHaveAttribute(
      "href",
      "/onboarding?returnTo=%2Fleaderboard",
    );
    expect(await keptRun(page)).not.toBeNull();
  });

  test("races or copies a racer's ghost link from their row", async ({ page }) => {
    await page.context().grantPermissions(["clipboard-read", "clipboard-write"]);
    await page.route("**/api/leaderboards/falls-view-park", (route) =>
      route.fulfill({ json: board() }),
    );
    await page.goto("/leaderboard");
    const row = page
      .getByRole("list", { name: "Best times" })
      .getByRole("listitem")
      .first();

    await expect(
      row.getByRole("link", { name: "Race @quick_racer's ghost" }),
    ).toHaveAttribute("href", "/?ghost=quick_racer&from=leaderboard");
    await row
      .getByRole("button", { name: "Copy @quick_racer's ghost link" })
      .click();
    // The button itself says so, briefly.
    await expect(row.getByText("Copied", { exact: true })).toBeAttached();
    expect(await page.evaluate(() => navigator.clipboard.readText())).toMatch(
      /^https?:\/\/[^/]+\/\?ghost=quick_racer$/,
    );
  });

  test("offers earlier course versions quietly, read-only", async ({ page }) => {
    await page.route(
      (url) => url.pathname === "/api/leaderboards/falls-view-park",
      (route) => {
        const requested = new URL(route.request().url()).searchParams.get(
          "board",
        );
        if (requested === "9") {
          return route.fulfill({ json: { error: "No such leaderboard." }, status: 404 });
        }
        return requested === "2"
          ? route.fulfill({ json: board({ earlier: EARLIER }) })
          : route.fulfill({
              json: {
                board: {
                  courseName: "Falls View Park",
                  entries: [],
                  lapEntries: [],
                  viewer: null,
                },
                earlier: EARLIER,
              },
            });
      },
    );
    // A link to a version with no times left shows the latest board.
    await page.goto("/leaderboard?board=9");
    await expect(page).toHaveURL(/\/leaderboard$/);
    await expect(page.getByText("No times yet")).toBeVisible();
    // The latest board needs no label.
    await expect(page.getByText(/^Earlier course version/)).toHaveCount(0);

    const earlierButton = page.getByRole("button", { name: "Course versions" });
    const versions = page.locator("#course-versions").getByRole("link");
    // Escape closes the list without leaving the page.
    await earlierButton.click();
    // The latest first, then each earlier one.
    await expect(versions).toHaveCount(3);
    await expect(versions.first()).toHaveText("Latest course version");
    await expect(versions.first()).toHaveAttribute("aria-current", "page");
    await page.keyboard.press("Escape");
    await expect(versions).toHaveCount(0);
    await expect(page).toHaveURL(/\/leaderboard$/);
    await earlierButton.click();
    await expect(versions.nth(1)).toContainText("Course version ·");
    await versions.nth(1).click();
    await expect(page).toHaveURL(/\/leaderboard\?board=2$/);
    await expect(page.getByText(/^Earlier course version · times from/)).toBeVisible();
    const rows = page
      .getByRole("list", { name: "Best times" })
      .getByRole("listitem");
    await expect(rows).toHaveCount(4);
    // Its podium is honoured, but its ghosts raced an older layout.
    await expect(rows.nth(0).getByRole("img", { name: "1, Gold" })).toBeVisible();
    await expect(page.getByRole("link", { name: /ghost/ })).toHaveCount(0);
    await expect(page.getByRole("button", { name: /ghost link/ })).toHaveCount(0);
    // The rows themselves are the stops, starting from your own (rank 2).
    await page.evaluate(() => (document.activeElement as HTMLElement | null)?.blur());
    await page.keyboard.press("ArrowDown");
    await expect(rows.nth(1)).toBeFocused();
    await page.keyboard.press("ArrowDown");
    await expect(rows.nth(2)).toBeFocused();

    await earlierButton.click();
    await versions.first().click();
    await expect(page).toHaveURL(/\/leaderboard$/);
    await expect(page.getByText("No times yet")).toBeVisible();
  });
});

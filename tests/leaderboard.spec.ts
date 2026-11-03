import { expect, type Page, test } from "@playwright/test";

import {
  installStandardGamepadFixture,
  setStandardTestGamepad,
} from "./helpers/standard-gamepad";

function board({ listed = true } = {}) {
  return {
    board: {
      courseName: "Falls View Park",
      entries: [
        ["quick_racer", 78_500_000, false],
        ["steady_racer", 92_250_000, true],
        ["third_racer", 101_000_000, false],
        ["new_racer", 130_000_000, false],
      ].map(([username, timeMicroseconds, viewer], index) => ({
        kartName: "Balanced Kart",
        rank: index + 1,
        timeMicroseconds,
        username,
        viewer: listed && viewer,
      })),
      viewer: listed
        ? { rank: 2, timeMicroseconds: 92_250_000 }
        : { rank: 61, timeMicroseconds: 190_000_000 },
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
      await expect(rows.nth(index)).toContainText(`Balanced Kart · ${medal}`);
    }
    await expect(rows.nth(3)).not.toContainText("·");
    await expect(rows.nth(1)).toHaveAttribute("aria-current", "true");
    await expect(page.getByText(/Your best/)).toHaveCount(0);
  });

  test("steps a controller down the board from the viewer's row", async ({
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
    // Moves start from the viewer's row (rank 2).
    await setStandardTestGamepad(page);
    await page.waitForTimeout(50);
    await setStandardTestGamepad(page, { buttons: { 13: 1 } });
    await expect(rows.nth(2)).toBeFocused();
    await setStandardTestGamepad(page);
    await page.waitForTimeout(50);
    await setStandardTestGamepad(page, { buttons: { 12: 1 } });
    await expect(rows.nth(1)).toBeFocused();
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
          board: { courseName: "Falls View Park", entries: [], viewer: null },
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
});

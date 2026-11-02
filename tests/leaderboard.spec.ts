import { expect, test } from "@playwright/test";

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
});

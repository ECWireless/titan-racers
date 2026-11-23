import { expect, type Page, test } from "@playwright/test";

import scoreFixtures from "./fixtures/scores.json" with { type: "json" };
import {
  installStandardGamepadFixture,
  setStandardTestGamepad,
} from "./helpers/standard-gamepad";

const FALLS_VIEW_PARK_BOARD = "/leaderboard?course=falls-view-park";

/** The scores every board's course selector is drawn from. */
async function mockScores(page: Page, scores: unknown = scoreFixtures.scores) {
  await page.route("**/api/scores", (route) => route.fulfill({ json: scores }));
}

/** The fixtures' stand-in second course: no picture, and no times yet. */
async function mockSecondCourse(page: Page) {
  await page.route("**/api/leaderboards/second-course", (route) =>
    route.fulfill({
      json: {
        board: {
          courseName: "Second Course",
          entries: [],
          lapEntries: [],
          viewer: null,
        },
        earlier: [],
      },
    }),
  );
}

const courseChoices = (page: Page) =>
  page.getByRole("navigation", { name: "Leaderboards" });

/** One press of a controller button, released at once. */
async function pressButton(page: Page, button: number) {
  await setStandardTestGamepad(page);
  await page.waitForTimeout(50);
  await setStandardTestGamepad(page, { buttons: { [button]: 1 } });
  await page.waitForTimeout(50);
  // Released at once, so a slow frame cannot hold it into a repeat.
  await setStandardTestGamepad(page);
}

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

// A run kept on this device from a race before signing in. Runs kept
// before they named their course raced Falls View Park.
async function keepRun(
  page: Page,
  timeMicroseconds: number,
  { courseId }: { courseId?: string } = {},
) {
  await page.addInitScript(
    ([run]) => localStorage.setItem("titan-racers.held-run.v1", run),
    [
      JSON.stringify({
        ...(courseId ? { courseId } : {}),
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

test.describe("score board", () => {
  test("ranks accounts by score, without medals, and marks the viewer's row", async ({
    page,
  }) => {
    await mockScores(page);
    await page.goto("/leaderboard");

    await expect(
      page.getByRole("heading", { level: 1, name: "High scores" }),
    ).toBeVisible();
    const rows = page.getByRole("list", { name: "High scores" }).getByRole("listitem");
    await expect(rows).toHaveCount(25);
    // Equal scores share a rank, and the next rank skips past them.
    await expect(rows.nth(0)).toHaveText("1@mossbank495");
    await expect(rows.nth(1)).toHaveText("1@quick_racer495");
    await expect(rows.nth(2)).toHaveText("3@lowgear_lu378");
    await expect(page.getByRole("main").getByRole("img", { name: /Gold|Silver|Bronze/ })).toHaveCount(0);
    await expect(page.locator("li[aria-current]")).toHaveText(
      "11@steady_racerYou126",
    );
    // Where a score comes from, in the player's words.
    const main = page.getByRole("main");
    await expect(main).toContainText(
      "Scores come from the top 20 on each course's current leaderboard: the higher you place, the higher your score.",
    );
    await expect(main).toContainText("can fall when someone passes you");
    await expect(main).not.toContainText(
      /points|royalt|licen[cs]e|ticket|claim/i,
    );
  });

  test.describe("on a phone", () => {
    test.use({ hasTouch: true, viewport: { height: 844, width: 390 } });

    test("takes the viewer from their score to their row, below the screen", async ({
      page,
    }) => {
      await mockScores(page);
      await page.goto("/leaderboard");
      const own = page.locator("li[aria-current]");
      await expect(own).not.toBeInViewport();
      await page
        .getByRole("button", {
          name: "Your score: 126, rank 11 of 25. Show your row",
        })
        .tap();
      await expect(own).toBeInViewport();
      await expect(own).toBeFocused();
      // Nothing is wider than the screen.
      expect(
        await page.evaluate(() => document.documentElement.scrollWidth),
      ).toBeLessThanOrEqual(390);
    });

    test("opens each course's board from its picture, and the scores again", async ({
      page,
    }) => {
      await mockScores(page);
      await mockSecondCourse(page);
      await page.route("**/api/leaderboards/falls-view-park", (route) =>
        route.fulfill({ json: board() }),
      );
      await page.goto("/leaderboard");
      const choices = courseChoices(page);
      await expect(choices.getByRole("link")).toHaveText([
        /High scores/,
        "Falls View Park",
        "Second Course",
      ]);
      const scores = choices.getByRole("link", { name: "High scores" });
      const fallsViewPark = choices.getByRole("link", { name: "Falls View Park" });
      const secondCourse = choices.getByRole("link", { name: "Second Course" });
      await expect(scores).toHaveAttribute("aria-current", "page");
      // A course without a picture yet still has its choice.
      await expect(fallsViewPark.locator("img")).toHaveCount(1);
      await expect(secondCourse.locator("img")).toHaveCount(0);

      await fallsViewPark.tap();
      await expect(page).toHaveURL(/\/leaderboard\?course=falls-view-park$/);
      await expect(fallsViewPark).toHaveAttribute("aria-current", "page");
      await expect(scores).not.toHaveAttribute("aria-current");
      await expect(
        page.getByRole("heading", { level: 1, name: "Falls View Park" }),
      ).toBeVisible();
      await expect(
        page.getByRole("list", { name: "Best times" }).getByRole("listitem"),
      ).toHaveCount(4);

      await secondCourse.tap();
      await expect(page).toHaveURL(
        /\/leaderboard\?course=second-course$/,
      );
      await expect(
        page.getByRole("heading", { level: 1, name: "Second Course" }),
      ).toBeVisible();
      await expect(page.getByText("No times yet")).toBeVisible();

      await scores.tap();
      await expect(page).toHaveURL(/\/leaderboard$/);
      await expect(page.getByRole("list", { name: "High scores" })).toBeVisible();
      // Each choice is a step the browser can go back over.
      await page.goBack();
      await expect(
        page.getByRole("heading", { level: 1, name: "Second Course" }),
      ).toBeVisible();
    });
  });

  test("shows an account without a score its 0 and how to get one", async ({
    page,
  }) => {
    await mockScores(page, scoreFixtures.scoresSignedInZero);
    await page.goto("/leaderboard");
    await expect(page.getByRole("list", { name: "High scores" })).toBeVisible();
    await expect(page.getByText("Your score0")).toBeVisible();
    await expect(
      page.getByText("Set a top-20 time on any course to get a score."),
    ).toBeVisible();
    await expect(page.getByRole("link", { name: "Race" })).toHaveAttribute(
      "href",
      "/",
    );
    await expect(page.locator("li[aria-current]")).toHaveCount(0);
  });

  test("asks a guest to sign in for a score of their own", async ({ page }) => {
    await mockScores(page, scoreFixtures.scoresGuest);
    await page.goto("/leaderboard");
    await expect(page.getByRole("list", { name: "High scores" })).toBeVisible();
    await expect(page.getByText("Your score", { exact: true })).toHaveCount(0);
    await expect(page.getByRole("link", { name: "Sign in" })).toHaveAttribute(
      "href",
      "/onboarding?returnTo=%2Fleaderboard",
    );
  });

  test("shows an empty score board, and still offers the courses when scores fail", async ({
    page,
  }) => {
    await mockScores(page, scoreFixtures.scoresEmpty);
    await page.goto("/leaderboard");
    await expect(page.getByText("No scores yet")).toBeVisible();
    await expect(page.getByText("Your score0")).toBeVisible();

    await page.unroute("**/api/scores");
    await page.route("**/api/scores", (route) => route.fulfill({ status: 500 }));
    await page.reload();
    await expect(
      page.getByText("High scores are unavailable right now."),
    ).toBeVisible();
    await expect(
      courseChoices(page).getByRole("link", { name: "Falls View Park" }),
    ).toHaveAttribute("href", FALLS_VIEW_PARK_BOARD);

    // Another course's link still leaves that course a choice to return to.
    await mockSecondCourse(page);
    await page.goto("/leaderboard?course=second-course");
    await expect(page.getByText("No times yet")).toBeVisible();
    await expect(
      courseChoices(page).getByRole("link", { name: "Second Course" }),
    ).toHaveAttribute("aria-current", "page");
  });

  test("opens from home's Leaderboard button", async ({ page }) => {
    await mockScores(page);
    await page.goto("/");
    await expect(
      page.locator('[data-controller-menu-ready="true"]'),
    ).toBeVisible();
    await page.getByRole("main").getByRole("link", { name: "Leaderboard" }).click();
    // The development server may build the page on its first visit.
    await expect(page).toHaveURL(/\/leaderboard$/, { timeout: 30_000 });
    await expect(
      page.getByRole("heading", { level: 1, name: "High scores" }),
    ).toBeVisible();
  });

  test("moves a controller and the arrow keys through the scores, the courses, and a course's board", async ({
    page,
  }) => {
    await installStandardGamepadFixture(page);
    // The viewer's row with two above it and one below.
    await mockScores(page, {
      ...scoreFixtures.scores,
      entries: scoreFixtures.scores.entries.slice(10, 14),
    });
    await mockSecondCourse(page);
    await page.route("**/api/leaderboards/falls-view-park", (route) =>
      route.fulfill({ json: board({ listed: false }) }),
    );
    await page.goto("/leaderboard");
    const rows = page.getByRole("list", { name: "High scores" }).getByRole("listitem");
    await expect(rows).toHaveCount(4);
    const choices = courseChoices(page);

    // Moves start from the viewer's row and step a row at a time.
    await pressButton(page, 13);
    await expect(rows.nth(3)).toBeFocused();
    await pressButton(page, 12);
    await pressButton(page, 12);
    await pressButton(page, 12);
    await expect(rows.nth(0)).toBeFocused();
    // Above the rows are the viewer's score, then the choices: the one
    // nearest above it, and the others to its sides.
    await pressButton(page, 12);
    await expect(page.getByRole("button", { name: /^Your score/ })).toBeFocused();
    await pressButton(page, 12);
    const fallsViewPark = choices.getByRole("link", { name: "Falls View Park" });
    await expect(fallsViewPark).toBeFocused();
    await pressButton(page, 14);
    await expect(choices.getByRole("link", { name: "High scores" })).toBeFocused();
    await pressButton(page, 15);
    await expect(fallsViewPark).toBeFocused();
    // A opens the course's board, and the arrow keys reach into it.
    await pressButton(page, 0);
    await expect(page).toHaveURL(/\/leaderboard\?course=falls-view-park$/);
    await expect(
      page.getByRole("list", { name: "Best times" }).getByRole("listitem"),
    ).toHaveCount(4);
    await expect(fallsViewPark).toBeFocused();
    await page.keyboard.press("ArrowLeft");
    await page.keyboard.press("ArrowDown");
    await expect(
      page.getByRole("group", { name: "Rank by" }).locator(":focus"),
    ).toHaveCount(1);
    await page.keyboard.press("ArrowUp");
    await expect(choices.getByRole("link", { name: "High scores" })).toBeFocused();
    await page.keyboard.press("ArrowRight");
    await page.keyboard.press("ArrowRight");
    const secondCourse = choices.getByRole("link", { name: "Second Course" });
    await expect(secondCourse).toBeFocused();
    await page.keyboard.press("Enter");
    await expect(page.getByText("No times yet")).toBeVisible();
    // With no place of their own to start from, moves start on the open
    // choice.
    await page.evaluate(() => (document.activeElement as HTMLElement | null)?.blur());
    await pressButton(page, 14);
    await expect(fallsViewPark).toBeFocused();
    // B leaves for home.
    await pressButton(page, 1);
    await expect(page).toHaveURL(/\/$/);
  });

  test("shows the scores for a link to a course without a leaderboard", async ({
    page,
  }) => {
    await mockScores(page);
    await page.goto("/leaderboard?course=rough-course");
    await expect(page).toHaveURL(/\/leaderboard$/);
    await expect(
      page.getByRole("heading", { level: 1, name: "High scores" }),
    ).toBeVisible();
    // Also when the scores cannot be loaded to say so, and when the link
    // names one of its earlier boards.
    await page.unroute("**/api/scores");
    await page.route("**/api/scores", (route) => route.fulfill({ status: 500 }));
    await page.goto("/leaderboard?course=rough-course&board=3");
    await expect(page).toHaveURL(/\/leaderboard$/);
    await expect(
      page.getByText("High scores are unavailable right now."),
    ).toBeVisible();
  });
});

test.describe("course leaderboard", () => {
  test.beforeEach(({ page }) => mockScores(page));

  test("lists best times, the podium, and the viewer's row", async ({
    page,
  }) => {
    await page.route("**/api/leaderboards/falls-view-park", (route) =>
      route.fulfill({ json: board() }),
    );
    await page.goto(FALLS_VIEW_PARK_BOARD);

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
    await page.goto(FALLS_VIEW_PARK_BOARD);
    const total = page.getByRole("button", { name: "Total time" });
    await expect(total).toHaveAttribute("aria-pressed", "true");

    // Both rankings came with the board, so switching asks for nothing.
    const requests: string[] = [];
    page.on("request", (request) => requests.push(request.url()));
    await page.getByRole("button", { name: "Fastest lap" }).click();
    await expect(page).toHaveURL(
      /\/leaderboard\?course=falls-view-park&sort=lap$/,
    );
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
    await expect(page).toHaveURL(/\/leaderboard\?course=falls-view-park$/);
    await expect(page.getByRole("list", { name: "Best times" })).toBeVisible();
  });

  test("steps a controller down the board from the viewer's row, one stop a row", async ({
    page,
  }) => {
    await installStandardGamepadFixture(page);
    await page.route("**/api/leaderboards/falls-view-park", (route) =>
      route.fulfill({ json: board() }),
    );
    await page.goto(FALLS_VIEW_PARK_BOARD);
    const rows = page
      .getByRole("list", { name: "Best times" })
      .getByRole("listitem");
    await expect(rows).toHaveCount(4);
    const race = (row: number) =>
      rows.nth(row).getByRole("link", { name: /^Race @/ });
    const press = (button: number) => pressButton(page, button);
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
    await page.goto(FALLS_VIEW_PARK_BOARD);
    await expect(page.getByText("Your best: 3:10.000, rank 61")).toBeVisible();
    await expect(page.locator("li[aria-current]")).toHaveCount(0);
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
    await page.goto(FALLS_VIEW_PARK_BOARD);
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
    await page.route("**/api/scores", (route) => {
      requests.push("scores");
      return route.fulfill({ json: scoreFixtures.scores });
    });
    await page.goto(FALLS_VIEW_PARK_BOARD);
    // Loaded, so the loading status is gone.
    await expect(page.getByRole("list", { name: "Best times" })).toBeVisible();

    await expect(page.getByRole("status")).toHaveText(
      "Your 1:32.250 is on the leaderboard, rank 2 of 4.",
    );
    await expect(page.locator("li[aria-current]")).toContainText("@steady_racer");
    // Before the board and the scores, so both count it.
    expect(requests[0]).toBe("run");
    expect([...requests].sort()).toEqual(["board", "run", "scores"]);
    expect(await keptRun(page)).toBeNull();
  });

  test("sends a kept run before the scores, and says what became of it on its course's board", async ({
    page,
  }) => {
    await keepRun(page, 92_250_000);
    const requests: string[] = [];
    await page.route("**/api/runs", (route) => {
      requests.push("run");
      return route.fulfill({
        json: {
          entries: 4,
          personalBest: { improved: true, timeMicroseconds: 92_250_000 },
          rank: 2,
          status: "verified",
          username: "steady_racer",
        },
      });
    });
    await page.route("**/api/scores", (route) => {
      requests.push("scores");
      return route.fulfill({ json: scoreFixtures.scores });
    });
    await page.route("**/api/leaderboards/falls-view-park", (route) =>
      route.fulfill({ json: board() }),
    );
    await mockSecondCourse(page);
    await page.goto("/leaderboard");
    await expect(page.getByRole("list", { name: "High scores" })).toBeVisible();
    expect(requests).toEqual(["run", "scores"]);
    expect(await keptRun(page)).toBeNull();

    // The score board names the course, since its own ranks are by score.
    const status = page.getByRole("status");
    await expect(status).toHaveText(
      "Your 1:32.250 is on Falls View Park's leaderboard, rank 2 of 4.",
    );
    // Another course's board says nothing of it; its own still does.
    const choices = courseChoices(page);
    await choices.getByRole("link", { name: "Second Course" }).click();
    await expect(page.getByText("No times yet")).toBeVisible();
    await expect(status).toHaveText("");
    await choices.getByRole("link", { name: "Falls View Park" }).click();
    await expect(page.getByRole("list", { name: "Best times" })).toBeVisible();
    await expect(status).toHaveText(
      "Your 1:32.250 is on the leaderboard, rank 2 of 4.",
    );
  });

  test("asks to sign in while a kept run waits", async ({ page }) => {
    await keepRun(page, 65_000_000);
    await page.route("**/api/runs", (route) =>
      route.fulfill({ json: { error: "Authentication required." }, status: 401 }),
    );
    await page.route("**/api/leaderboards/falls-view-park", (route) =>
      route.fulfill({ json: board({ listed: false }) }),
    );
    await page.goto(FALLS_VIEW_PARK_BOARD);
    await expect(page.getByRole("list", { name: "Best times" })).toBeVisible();

    const status = page.getByRole("status");
    await expect(status).toContainText(
      "Sign in to put your 1:05.000 on the leaderboard.",
    );
    // Signing in comes back to this course's board, which sends the run.
    await expect(status.getByRole("link", { name: "Sign in" })).toHaveAttribute(
      "href",
      "/onboarding?returnTo=%2Fleaderboard%3Fcourse%3Dfalls-view-park",
    );
    expect(await keptRun(page)).not.toBeNull();

    // The score board asks the same, in place of its own prompt.
    await page.unroute("**/api/scores");
    await mockScores(page, scoreFixtures.scoresGuest);
    await page.goto("/leaderboard");
    await expect(page.getByRole("list", { name: "High scores" })).toBeVisible();
    await expect(page.getByRole("link", { name: "Sign in" })).toHaveAttribute(
      "href",
      "/onboarding?returnTo=%2Fleaderboard%3Fcourse%3Dfalls-view-park",
    );
    await expect(status).toContainText(
      "Sign in to put your 1:05.000 on Falls View Park's leaderboard.",
    );
  });

  test("says what became of a kept run on the board of the course it raced", async ({
    page,
  }) => {
    await keepRun(page, 65_000_000, { courseId: "second-course" });
    await page.route("**/api/runs", (route) =>
      route.fulfill({ json: { error: "Authentication required." }, status: 401 }),
    );
    await mockScores(page, scoreFixtures.scoresGuest);
    await mockSecondCourse(page);
    await page.route("**/api/leaderboards/falls-view-park", (route) =>
      route.fulfill({ json: board({ listed: false }) }),
    );
    await page.goto("/leaderboard");
    await expect(page.getByRole("list", { name: "High scores" })).toBeVisible();

    const status = page.getByRole("status");
    await expect(status).toContainText(
      "Sign in to put your 1:05.000 on Second Course's leaderboard.",
    );
    await expect(status.getByRole("link", { name: "Sign in" })).toHaveAttribute(
      "href",
      "/onboarding?returnTo=%2Fleaderboard%3Fcourse%3Dsecond-course",
    );
    // Falls View Park's board says nothing of it; its own course's does.
    const choices = courseChoices(page);
    await choices.getByRole("link", { name: "Falls View Park" }).click();
    await expect(page.getByRole("list", { name: "Best times" })).toBeVisible();
    await expect(status).toHaveText("");
    await choices.getByRole("link", { name: "Second Course" }).click();
    await expect(page.getByText("No times yet")).toBeVisible();
    await expect(status).toContainText(
      "Sign in to put your 1:05.000 on the leaderboard.",
    );
  });

  test("races or copies a racer's ghost link from their row", async ({ page }) => {
    await page.context().grantPermissions(["clipboard-read", "clipboard-write"]);
    await page.route("**/api/leaderboards/falls-view-park", (route) =>
      route.fulfill({ json: board() }),
    );
    await page.goto(FALLS_VIEW_PARK_BOARD);
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
    // A link to a version with no times left shows the latest board. Links
    // from before the score board name no course, and still open this one.
    await page.goto("/leaderboard?board=9");
    await expect(page).toHaveURL(/\/leaderboard\?course=falls-view-park$/);
    await expect(
      courseChoices(page).getByRole("link", { name: "Falls View Park" }),
    ).toHaveAttribute("aria-current", "page");
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
    await expect(page).toHaveURL(/\/leaderboard\?course=falls-view-park$/);
    await earlierButton.click();
    await expect(versions.nth(1)).toContainText("Course version ·");
    await versions.nth(1).click();
    await expect(page).toHaveURL(
      /\/leaderboard\?course=falls-view-park&board=2$/,
    );
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
    await expect(page).toHaveURL(/\/leaderboard\?course=falls-view-park$/);
    await expect(page.getByText("No times yet")).toBeVisible();
  });

  test("opens Falls View Park's board from links made before the score board", async ({
    page,
  }) => {
    const boards: (string | null)[] = [];
    await page.route(
      (url) => url.pathname === "/api/leaderboards/falls-view-park",
      (route) => {
        boards.push(new URL(route.request().url()).searchParams.get("board"));
        return route.fulfill({ json: board({ earlier: EARLIER }) });
      },
    );
    const title = page.getByRole("heading", { level: 1, name: "Falls View Park" });
    const earlierNote = page.getByText(/^Earlier course version · times from/);

    await page.goto("/leaderboard?sort=lap");
    await expect(title).toBeVisible();
    await expect(page.getByRole("list", { name: "Fastest laps" })).toBeVisible();
    await expect(earlierNote).toHaveCount(0);
    // Its ghosts are still there to race.
    await expect(
      page.getByRole("link", { name: "Race @new_racer's ghost" }),
    ).toBeVisible();

    await page.goto("/leaderboard?board=2");
    await expect(title).toBeVisible();
    await expect(page.getByRole("list", { name: "Best times" })).toBeVisible();
    await expect(earlierNote).toBeVisible();
    await expect(
      page.getByRole("img", { name: "1, Gold" }),
    ).toBeVisible();

    await page.goto("/leaderboard?board=2&sort=lap");
    await expect(title).toBeVisible();
    await expect(page.getByRole("list", { name: "Fastest laps" })).toBeVisible();
    await expect(earlierNote).toBeVisible();
    expect(boards).toEqual([null, "2", "2"]);
    // The address is left as it was given.
    await expect(page).toHaveURL(/\/leaderboard\?board=2&sort=lap$/);
    // Choosing the open course again keeps its version and ranking.
    await courseChoices(page).getByRole("link", { name: "Falls View Park" }).click();
    await expect(page).toHaveURL(/\/leaderboard\?board=2&sort=lap$/);
    await expect(earlierNote).toBeVisible();
  });
});

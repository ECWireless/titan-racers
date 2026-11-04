import { randomUUID } from "node:crypto";

import { expect, test } from "@playwright/test";
import { inArray } from "drizzle-orm";

import { getAdminOverview } from "../src/app/api/admin/overview/route";
import { db } from "../src/db/client";
import {
  accounts,
  gameplayRuns,
  leaderboards,
  passkeys,
  raceResults,
  users,
} from "../src/db/schema";
import { FALLS_VIEW_PARK_DOCUMENT } from "../src/game/course/course-document";
import { BALANCED_KART_ID } from "../src/game/kart/balanced-kart-document";
import { SPEED_KART_ID } from "../src/game/kart/speed-kart-document";
import { CURRENT_PHYSICS_VERSION } from "../src/game/physics/physics-version";
import {
  adminOverviewSchema,
  parseReportingTimeZone,
} from "../src/game/telemetry/admin-overview";
import {
  loadAdminOverview,
  loadRangeStart,
} from "../src/server/admin-overview-repository";
import { saveCourseRevision } from "../src/server/course-repository";

const ORIGIN = "http://localhost:3000";

test.describe("admin overview contract", () => {
  test("accepts IANA time zones and refuses offsets and junk", () => {
    expect(parseReportingTimeZone("America/Denver")).toBe("America/Denver");
    expect(parseReportingTimeZone("UTC")).toBe("UTC");
    // Names without a region are zones too, under their Region/City name.
    for (const value of ["CET", "EST5EDT", "GMT"]) {
      expect(parseReportingTimeZone(value)).toMatch(/^(UTC|\w+\/\w+)/);
    }
    for (const value of ["+05:00", "-07", "GMT+5", "UTC-3", "Not/AZone", "", "UTC; select 1", "Denver"]) {
      expect(parseReportingTimeZone(value)).toBeNull();
    }
  });

  test("answers admins only, with no caching, and validates its input and output", async () => {
    const empty = {
      activity: [],
      bucket: "day",
      ghosts: { courseBest: 0, leaderboardRacer: 0, none: 0, ownBest: 0, sharedLink: 0 },
      karts: [],
      leaderboard: { afterSignIn: 0, courseRecords: 0, personalBests: 0, rejected: 0, verified: 0 },
      racers: { active: 0, signUps: { browser: 0, browserKept: 0, google: 0, passkey: 0, wallet: 0 } },
      races: { finished: 0, guest: 0, raceAgain: 0, resultsShared: 0, signedIn: 0, started: 0 },
      range: "30d",
      timeZone: "America/Denver",
    };
    const admin = async () => ({ authorized: true as const, userId: "admin" });
    const loads: Array<[string, string]> = [];
    const load = async (range: string, timeZone: string) => {
      loads.push([range, timeZone]);
      return empty;
    };
    const request = (query: string) =>
      new Request(`${ORIGIN}/api/admin/overview${query}`);

    for (const status of [401, 403, 428] as const) {
      const response = await getAdminOverview(request("?range=30d"), {
        authorize: async () => ({ authorized: false, status }),
        load,
      });
      expect(response.status).toBe(status);
    }
    expect(loads).toEqual([]);

    for (const query of ["?range=90d", "?tz=%2B05%3A00", "?tz=Mars%2FOlympus"]) {
      expect((await getAdminOverview(request(query), { authorize: admin, load })).status).toBe(
        400,
      );
    }
    expect(
      (
        await getAdminOverview(request("?range=30d"), {
          authorize: admin,
          load: async () => ({ ...empty, userIds: ["leak"] }),
        })
      ).status,
    ).toBe(500);
    const failed = await getAdminOverview(request("?range=30d"), {
      authorize: admin,
      load: async () => {
        throw new Error("time zone not recognized");
      },
    });
    expect(failed.status).toBe(500);
    expect(failed.headers.get("cache-control")).toBe("no-store");

    const response = await getAdminOverview(
      request("?range=30d&tz=America%2FDenver"),
      { authorize: admin, load },
    );
    expect(response.status).toBe(200);
    expect(response.headers.get("cache-control")).toBe("no-store");
    expect(adminOverviewSchema.parse(await response.json())).toEqual(empty);
    expect((await getAdminOverview(request("?tz=CET"), { authorize: admin, load })).status).toBe(
      200,
    );
    expect(loads).toEqual([
      ["30d", "America/Denver"],
      ["7d", parseReportingTimeZone("CET")!],
    ]);
  });
});

test.describe("admin overview Postgres integration", () => {
  test.beforeEach(() => {
    test.skip(
      !process.env.DATABASE_URL?.trim(),
      "DATABASE_URL is required for admin overview integration tests.",
    );
  });

  // Everything happens in early 2001, on a fresh course, so other races
  // and boards stay out of the counts. 2001-01-01 was a Monday.
  const now = new Date("2001-01-07T12:00:00Z");

  test("starts a range at the first instant of its first local day", async () => {
    // Havana falls back from 01:00 to midnight on 2026-11-01, so that day
    // begins at 04:00 UTC, not at the second midnight an hour later.
    expect(
      await loadRangeStart("7d", "America/Havana", new Date("2026-11-07T12:00:00Z")),
    ).toEqual(new Date("2026-11-01T04:00:00Z"));
    // Casey Station turned its clocks back three hours early on 2020-03-08,
    // so that day began at 13:00 UTC the day before, not at 16:00.
    expect(
      await loadRangeStart("7d", "Antarctica/Casey", new Date("2020-03-14T12:00:00Z")),
    ).toEqual(new Date("2020-03-07T13:00:00Z"));
    // Where midnight never happens, the day begins at 01:00.
    expect(
      await loadRangeStart("7d", "America/Havana", new Date("2026-03-14T12:00:00Z")),
    ).toEqual(new Date("2026-03-08T05:00:00Z"));
    expect(
      await loadRangeStart("7d", "America/Denver", new Date("2001-01-07T12:00:00Z")),
    ).toEqual(new Date("2001-01-01T07:00:00Z"));
  });

  test("counts races, racers, and leaderboard runs by calendar day in the admin's time zone", async () => {
    const courseId = `admin-overview-${randomUUID()}`;
    const author = `admin-overview-author-${randomUUID()}`;
    const racerA = `admin-overview-a-${randomUUID()}`;
    const racerB = `admin-overview-b-${randomUUID()}`;
    const earlier = `admin-overview-earlier-${randomUUID()}`;
    const browserC = `admin-overview-c-${randomUUID()}`;
    const browserD = `admin-overview-d-${randomUUID()}`;
    const browserE = `admin-overview-e-${randomUUID()}`;
    const passkeyOnly = `admin-overview-f-${randomUUID()}`;
    const runIds: string[] = [];
    try {
      // Sign-ups count every racer, so compare with the count before ours.
      const { signUps } = (await loadAdminOverview("7d", "America/Denver", now, courseId))
        .racers;
      await db.insert(users).values([
        { email: `${author}@example.invalid`, id: author, name: "Author" },
        // Racers A and B joined this week, with Google and a wallet.
        { createdAt: new Date("2001-01-03T12:00:00Z"), email: `${racerA}@example.invalid`, id: racerA, name: "A" },
        { createdAt: new Date("2001-01-04T12:00:00Z"), email: `${racerB}@example.invalid`, id: racerB, name: "B" },
        { createdAt: new Date("2000-12-01T12:00:00Z"), email: `${earlier}@example.invalid`, id: earlier, name: "Earlier" },
        // C, D, and E started on one browser; D kept it with a wallet, E
        // with a passkey.
        { createdAt: new Date("2001-01-04T12:00:00Z"), email: `${browserC}@example.invalid`, id: browserC, isAnonymous: true, name: "C" },
        { createdAt: new Date("2001-01-04T12:00:00Z"), email: `${browserD}@example.invalid`, id: browserD, isAnonymous: true, name: "D" },
        { createdAt: new Date("2001-01-04T12:00:00Z"), email: `${browserE}@example.invalid`, id: browserE, isAnonymous: true, name: "E" },
        // F joined with Google, added a passkey, then unlinked Google.
        { createdAt: new Date("2001-01-04T12:00:00Z"), email: `${passkeyOnly}@example.invalid`, id: passkeyOnly, name: "F" },
      ]);
      await db.insert(passkeys).values(
        [browserE, passkeyOnly].map((userId) => ({
          backedUp: true,
          counter: 0,
          credentialID: `admin-overview-${randomUUID()}`,
          deviceType: "multiDevice",
          id: randomUUID(),
          publicKey: "key",
          userId,
        })),
      );
      await db.insert(accounts).values([
        { accountId: racerA, id: randomUUID(), providerId: "google", userId: racerA },
        // B joined with a wallet, then linked Google: counted once, as a wallet.
        { accountId: racerB, createdAt: new Date("2001-01-04T12:00:00Z"), id: randomUUID(), providerId: "siwe", userId: racerB },
        { accountId: `google-${racerB}`, createdAt: new Date("2001-01-05T12:00:00Z"), id: randomUUID(), providerId: "google", userId: racerB },
        { accountId: earlier, id: randomUUID(), providerId: "google", userId: earlier },
        { accountId: browserD, createdAt: new Date("2001-01-05T12:00:00Z"), id: randomUUID(), providerId: "siwe", userId: browserD },
      ]);
      await saveCourseRevision({
        authorUserId: author,
        document: { ...structuredClone(FALLS_VIEW_PARK_DOCUMENT), courseId },
        expectedRevision: null,
      });

      const run = (
        startedAt: string,
        details: Partial<typeof gameplayRuns.$inferInsert> = {},
      ) => {
        const id = randomUUID();
        runIds.push(id);
        return {
          courseId,
          deploymentVersion: "test",
          id,
          inputFamilies: [],
          startedAt: new Date(startedAt),
          ...details,
        };
      };
      const finished = (startedAt: string) => {
        const at = new Date(startedAt);
        return {
          completedRaceTimeMs: 60_000,
          endedAt: new Date(at.getTime() + 90_000),
          loadedAt: new Date(at.getTime() + 5_000),
          outcome: "completed" as const,
          racingStartedAt: new Date(at.getTime() + 10_000),
        };
      };
      await db.insert(gameplayRuns).values([
        // Two weeks before the week of Dec 25, leaving an empty week.
        run("2000-12-12T12:00:00Z"),
        // 23:59 on Dec 31 in Denver: before the week.
        run("2001-01-01T06:59:00Z"),
        // Midnight on Jan 1 in Denver: the week's first minute.
        run("2001-01-01T07:00:00Z"),
        // 23:30 on Jan 6 in Denver, though Jan 7 in UTC.
        run("2001-01-07T06:30:00Z", {
          ...finished("2001-01-07T06:30:00Z"),
          attribution: "authenticated",
          ghost: "own_best",
          kartId: BALANCED_KART_ID,
          raceAgain: true,
          shared: true,
          userId: racerA,
        }),
        run("2001-01-07T08:00:00Z", {
          attribution: "authenticated",
          endedAt: new Date("2001-01-07T08:01:00Z"),
          ghost: "none",
          kartId: SPEED_KART_ID,
          outcome: "exited",
          raceAgain: false,
          userId: racerA,
        }),
        run("2001-01-07T09:00:00Z", {
          ...finished("2001-01-07T09:00:00Z"),
          attribution: "authenticated",
          ghost: "shared_link",
          kartId: BALANCED_KART_ID,
          raceAgain: false,
          userId: racerB,
        }),
      ]);

      const [board] = await db
        .insert(leaderboards)
        .values({ courseId, courseRevision: 1, physicsVersion: CURRENT_PHYSICS_VERSION })
        .returning({ id: leaderboards.id });
      const result = (
        userId: string,
        submittedAt: string,
        seconds: number | null,
        claimed = false,
      ) => {
        const id = randomUUID();
        return {
          claimed,
          id,
          kartId: BALANCED_KART_ID,
          kartRevision: 1,
          leaderboardId: board.id,
          rejection: seconds === null ? ("bad-recording" as const) : null,
          status: seconds === null ? ("rejected" as const) : ("verified" as const),
          submittedAt: new Date(submittedAt),
          ticketIssuedAt: new Date(submittedAt),
          timeMicroseconds: seconds === null ? null : seconds * 1_000_000,
          userId,
        };
      };
      await db.insert(raceResults).values([
        // Before the week: A sets the board's best.
        result(racerA, "2000-12-30T12:00:00Z", 50),
        // B's first run is a personal best, not a record.
        result(racerB, "2001-01-02T12:00:00Z", 60),
        // Slower than A's own best: neither.
        result(racerA, "2001-01-03T12:00:00Z", 55),
        result(racerA, "2001-01-04T12:00:00Z", null, true),
        // Sent after signing in, and faster than everyone: both.
        result(racerB, "2001-01-05T12:00:00Z", 45, true),
        // A tie is not a new best.
        result(racerB, "2001-01-06T12:00:00Z", 45),
      ]);

      const denver = adminOverviewSchema.parse(
        await loadAdminOverview("7d", "America/Denver", now, courseId),
      );
      const zero = { finished: 0, signedInRacers: 0, started: 0 };
      expect(denver.bucket).toBe("day");
      expect(denver.activity).toEqual([
        { date: "2001-01-01", ...zero, started: 1 },
        { date: "2001-01-02", ...zero },
        { date: "2001-01-03", ...zero },
        { date: "2001-01-04", ...zero },
        { date: "2001-01-05", ...zero },
        { date: "2001-01-06", finished: 1, signedInRacers: 1, started: 1 },
        { date: "2001-01-07", finished: 1, signedInRacers: 2, started: 2 },
      ]);
      expect(denver.races).toEqual({
        finished: 2,
        guest: 1,
        raceAgain: 1,
        resultsShared: 1,
        signedIn: 3,
        started: 4,
      });
      expect(denver.racers).toEqual({
        active: 2,
        signUps: {
          browser: signUps.browser + 3,
          browserKept: signUps.browserKept + 2,
          google: signUps.google + 1,
          passkey: signUps.passkey + 1,
          wallet: signUps.wallet + 1,
        },
      });
      expect(denver.leaderboard).toEqual({
        afterSignIn: 2,
        courseRecords: 1,
        personalBests: 2,
        rejected: 1,
        verified: 4,
      });
      expect(denver.karts.map(({ kartId, races }) => [kartId, races])).toEqual([
        [BALANCED_KART_ID, 2],
        [SPEED_KART_ID, 1],
        [expect.any(String), 0],
      ]);
      expect(denver.karts[0].name).toBe("Balanced Kart");
      expect(denver.ghosts).toEqual({
        courseBest: 0,
        leaderboardRacer: 0,
        none: 1,
        ownBest: 1,
        sharedLink: 1,
      });

      // In UTC the week starts seven hours earlier and the late run moves a day.
      const utc = await loadAdminOverview("7d", "UTC", now, courseId);
      expect(utc.races.started).toBe(5);
      expect(utc.activity.map(({ date, started }) => [date, started])).toEqual([
        ["2001-01-01", 2],
        ["2001-01-02", 0],
        ["2001-01-03", 0],
        ["2001-01-04", 0],
        ["2001-01-05", 0],
        ["2001-01-06", 0],
        ["2001-01-07", 3],
      ]);

      // All time counts by week, Monday first, from the first race's week.
      const all = await loadAdminOverview("all", "America/Denver", now, courseId);
      expect(all.bucket).toBe("week");
      expect(all.activity.map(({ date, started }) => [date, started])).toEqual([
        ["2000-12-11", 1],
        ["2000-12-18", 0],
        ["2000-12-25", 1],
        ["2001-01-01", 4],
      ]);
      expect(all.leaderboard).toMatchObject({ courseRecords: 2, personalBests: 3, verified: 5 });
      // A course with no races at all shows this week, empty.
      const empty = await loadAdminOverview("all", "America/Denver", now, `${courseId}-none`);
      expect(empty.activity).toEqual([
        { date: "2001-01-01", finished: 0, signedInRacers: 0, started: 0 },
      ]);
    } finally {
      // Results are immutable, so they, their board, and their racers stay
      // under the fresh course; without login methods the racers no longer
      // count as sign-ups. The browser racers raced nowhere, so they go.
      if (runIds.length) await db.delete(gameplayRuns).where(inArray(gameplayRuns.id, runIds));
      await db.delete(accounts).where(inArray(accounts.userId, [racerA, racerB, earlier, browserD]));
      await db.delete(users).where(inArray(users.id, [browserC, browserD, browserE, passkeyOnly]));
    }
  });
});

test.describe("admin overview page", () => {
  test.use({ timezoneId: "America/Denver" });

  const overview = {
    activity: [
      { date: "2026-11-02", finished: 3, signedInRacers: 1, started: 5 },
      { date: "2026-11-03", finished: 0, signedInRacers: 0, started: 0 },
      { date: "2026-11-04", finished: 4, signedInRacers: 2, started: 6 },
    ],
    bucket: "day",
    ghosts: { courseBest: 2, leaderboardRacer: 1, none: 6, ownBest: 1, sharedLink: 1 },
    karts: [
      { kartId: BALANCED_KART_ID, name: "Balanced Kart", races: 7 },
      { kartId: SPEED_KART_ID, name: "Speed Kart", races: 4 },
    ],
    leaderboard: { afterSignIn: 1, courseRecords: 1, personalBests: 3, rejected: 2, verified: 5 },
    racers: { active: 2, signUps: { browser: 2, browserKept: 1, google: 3, passkey: 1, wallet: 1 } },
    races: { finished: 7, guest: 8, raceAgain: 4, resultsShared: 2, signedIn: 3, started: 11 },
    range: "7d",
    timeZone: "America/Denver",
  };

  test("asks a signed-out visitor to sign in and come back here", async ({ page }) => {
    await page.route("**/api/admin/overview?*", (route) =>
      route.fulfill({ json: { error: "Authentication required." }, status: 401 }),
    );
    let signIn: unknown;
    await page.route("**/api/auth/sign-in/social", (route) => {
      signIn = route.request().postDataJSON();
      return route.fulfill({ json: { url: "http://127.0.0.1:3873/?oauth=started" } });
    });
    await page.goto("/admin");
    await expect(page.getByRole("heading", { name: "Dashboard" })).toBeVisible();
    await page.getByRole("button", { name: "Continue with Google" }).click();
    await expect(page).toHaveURL(/oauth=started/);
    expect(signIn).toEqual({
      callbackURL: "/admin",
      newUserCallbackURL: "/onboarding?returnTo=%2Fadmin",
      provider: "google",
    });
  });

  test("won't switch accounts away from a racer kept only in this browser", async ({ page }) => {
    await page.route("**/api/admin/overview?*", (route) =>
      route.fulfill({ json: { error: "Required role missing." }, status: 403 }),
    );
    await page.route("**/api/profile", (route) =>
      route.fulfill({ json: { loginMethods: [], status: "complete", username: "nova_racer" } }),
    );
    let signOuts = 0;
    await page.route("**/api/auth/sign-out", (route) => {
      signOuts += 1;
      return route.fulfill({ json: { success: true } });
    });
    await page.goto("/admin");
    await page.getByRole("button", { name: "Choose another account" }).click();
    await expect(
      page.getByText("This racer lives only in this browser, so switching accounts would lose it."),
    ).toBeVisible();
    expect(signOuts).toBe(0);
  });

  test("shows the period's races, racers, leaderboard, karts, and sharing", async ({ page }) => {
    const requested: string[] = [];
    await page.route("**/api/admin/overview?*", (route) => {
      const url = new URL(route.request().url());
      requested.push(`${url.searchParams.get("range")} ${url.searchParams.get("tz")}`);
      return route.fulfill({
        json: { ...overview, range: url.searchParams.get("range") },
      });
    });
    await page.goto("/admin");

    const glance = page.getByRole("region", { name: "At a glance" });
    await expect(glance).toContainText("Races started11");
    await expect(glance).toContainText("64% of races started");
    await expect(glance).toContainText("27% of races signed in");
    await expect(glance).toContainText("Sign-ups7");
    await expect(page.getByText("in America/Denver")).toBeVisible();

    const races = page.getByRole("region", { name: "Races each day" });
    await races.getByText("Table view").click();
    await expect(races.getByRole("row").nth(1)).toContainText("Mon, Nov 2");
    await expect(races.getByRole("row").nth(3)).toHaveText(/Wed, Nov 4\s*4\s*2\s*6/);

    const racing = page.getByRole("region", { name: "Who's racing" });
    await expect(racing).toContainText("Guest races8 · 73%");
    await expect(racing).toContainText("Passkey only1");
    await expect(racing).toContainText("This-browser sign-ups2");
    await expect(racing).toContainText("Kept with a login method1");
    await expect(page.getByRole("region", { name: "Leaderboard" })).toContainText(
      "New course records1",
    );
    await expect(page.getByRole("region", { name: "Races per kart" })).toContainText(
      "Balanced Kart7",
    );
    await expect(page.getByRole("region", { name: "Replays and sharing" })).toContainText(
      "Links copied2",
    );
    await expect(page.getByRole("link", { name: "Telemetry" })).toHaveAttribute(
      "href",
      "/admin/telemetry",
    );

    await page.getByRole("button", { name: "30 days" }).click();
    await expect(page.getByRole("button", { name: "30 days" })).toHaveAttribute(
      "aria-pressed",
      "true",
    );
    await expect
      .poll(() => requested)
      .toEqual(["7d America/Denver", "30d America/Denver"]);
  });
});

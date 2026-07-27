import { expect, type Page, test } from "@playwright/test";

import { RACER_USERNAME_REQUIREMENTS } from "../src/lib/racer-username";

const profileApiPattern = "**/api/profile";

async function installStandardGamepadFixture(page: Page) {
  await page.addInitScript(() => {
    const testWindow = window as typeof window & {
      __TR_GAMEPADS__?: Gamepad[];
    };
    testWindow.__TR_GAMEPADS__ = [];
    Object.defineProperty(navigator, "getGamepads", {
      configurable: true,
      value: () => testWindow.__TR_GAMEPADS__ ?? [],
    });
  });
}

async function setStandardTestGamepad(
  page: Page,
  buttonValues: Record<number, number> = {},
) {
  await page.evaluate((nextButtonValues) => {
    const testWindow = window as typeof window & {
      __TR_GAMEPADS__?: Gamepad[];
    };
    testWindow.__TR_GAMEPADS__ = [
      {
        axes: [0, 0, 0, 0],
        buttons: Array.from({ length: 17 }, (_, index) => {
          const value = nextButtonValues[index] ?? 0;
          return { pressed: value > 0, touched: value > 0, value };
        }),
        connected: true,
        id: "Automated standard controller",
        index: 0,
        mapping: "standard",
        timestamp: performance.now(),
      } as unknown as Gamepad,
    ];
  }, buttonValues);
}

async function fulfillIncompleteProfile(page: Page, suggestion = "elliott4821") {
  await page.route(profileApiPattern, async (route) => {
    if (route.request().method() === "GET") {
      await route.fulfill({
        body: JSON.stringify({
          status: "incomplete",
          suggestedUsername: suggestion,
        }),
        contentType: "application/json",
        status: 200,
      });
      return;
    }
    await route.fallback();
  });
}

test.describe("racer onboarding and profile", () => {
  test("loads an editable suggestion and claims its normalized username", async ({
    page,
  }) => {
    let savedPayload: unknown;
    await fulfillIncompleteProfile(page);
    await page.route(profileApiPattern, async (route) => {
      if (route.request().method() !== "PUT") {
        await route.fallback();
        return;
      }
      savedPayload = route.request().postDataJSON();
      await route.fulfill({
        body: JSON.stringify({
          status: "complete",
          username: "nova_racer",
        }),
        contentType: "application/json",
        status: 200,
      });
    });

    await page.goto("/onboarding?returnTo=%2Fadmin%2Fkarts");
    const input = page.getByRole("textbox", { name: "Username" });
    await expect(input).toHaveValue("elliott4821");

    await input.fill("  Nova---Racer  ");
    await expect(page.getByText("Public credit: @nova_racer")).toBeVisible();
    await page.getByRole("button", { name: "Create racer account" }).click();

    expect(savedPayload).toEqual({ username: "nova_racer" });
    await expect(page.getByText("@nova_racer")).toBeVisible();
    await expect(
      page.getByText("Usernames are permanent after account creation"),
    ).toBeVisible();
    await expect(
      page.getByRole("link", { name: "Continue" }),
    ).toHaveAttribute("href", "/admin/karts");
  });

  test("shows an existing username as immutable on the profile page", async ({
    page,
  }) => {
    await page.route(profileApiPattern, async (route) => {
      await route.fulfill({
        body: JSON.stringify({ status: "complete", username: "nova_racer" }),
        contentType: "application/json",
        status: 200,
      });
    });

    await page.goto("/profile");
    await expect(page.getByText("@nova_racer")).toBeVisible();
    await expect(page.getByRole("textbox")).toHaveCount(0);
    await expect(page.getByRole("button", { name: /save|create/i })).toHaveCount(0);
  });

  test("starts Google sign-in through onboarding for signed-out racers", async ({
    page,
  }) => {
    await page.route(profileApiPattern, async (route) => {
      await route.fulfill({
        body: JSON.stringify({ error: "Authentication required." }),
        contentType: "application/json",
        status: 401,
      });
    });
    await page.route("**/api/auth/sign-in/social", async (route) => {
      expect(route.request().postDataJSON()).toEqual({
        callbackURL: "/onboarding?returnTo=%2Fprofile",
        newUserCallbackURL: "/onboarding?returnTo=%2Fprofile",
        provider: "google",
      });
      await route.fulfill({
        body: JSON.stringify({
          url: "http://127.0.0.1:3873/onboarding?oauth=started",
        }),
        contentType: "application/json",
        status: 200,
      });
    });

    await page.goto("/profile");
    await expect(
      page.getByText("Sign in with Google, then choose the username"),
    ).toBeVisible();
    await page.getByRole("button", { name: "Continue with Google" }).click();
    await expect(page).toHaveURL(/oauth=started/);
  });

  test("rejects invalid usernames before sending a claim", async ({ page }) => {
    let claimRequests = 0;
    await fulfillIncompleteProfile(page);
    await page.route(profileApiPattern, async (route) => {
      if (route.request().method() !== "PUT") {
        await route.fallback();
        return;
      }
      claimRequests += 1;
      await route.fulfill({ status: 500 });
    });

    await page.goto("/onboarding");
    await page.getByRole("textbox", { name: "Username" }).fill("ab");
    await page.getByRole("button", { name: "Create racer account" }).click();

    await expect(page.locator("p[role='alert']")).toHaveText(
      RACER_USERNAME_REQUIREMENTS,
    );
    expect(claimRequests).toBe(0);
  });

  test("keeps the entered username when the claim is already taken", async ({
    page,
  }) => {
    await fulfillIncompleteProfile(page);
    await page.route(profileApiPattern, async (route) => {
      if (route.request().method() !== "PUT") {
        await route.fallback();
        return;
      }
      await route.fulfill({
        body: JSON.stringify({
          code: "USERNAME_TAKEN",
          error: "That username is already taken.",
        }),
        contentType: "application/json",
        status: 409,
      });
    });

    await page.goto("/onboarding");
    const input = page.getByRole("textbox", { name: "Username" });
    await input.fill("wanted_name");
    await page.getByRole("button", { name: "Create racer account" }).click();

    await expect(input).toHaveValue("wanted_name");
    await expect(page.locator("p[role='alert']")).toHaveText(
      "That username is already taken.",
    );
  });

  test("uses stable copy for malformed claim responses", async ({ page }) => {
    await fulfillIncompleteProfile(page);
    await page.route(profileApiPattern, async (route) => {
      if (route.request().method() !== "PUT") {
        await route.fallback();
        return;
      }
      await route.fulfill({
        body: "<html>upstream failure</html>",
        contentType: "text/html",
        status: 500,
      });
    });

    await page.goto("/onboarding");
    await page.getByRole("button", { name: "Create racer account" }).click();
    await expect(page.locator("p[role='alert']")).toHaveText(
      "Your username could not be created. Your entry is still here.",
    );
  });

  test("locks the username snapshot while account creation is pending", async ({
    page,
  }) => {
    let releaseClaim: (() => void) | undefined;
    const claimReleased = new Promise<void>((resolve) => {
      releaseClaim = resolve;
    });
    await fulfillIncompleteProfile(page);
    await page.route(profileApiPattern, async (route) => {
      if (route.request().method() !== "PUT") {
        await route.fallback();
        return;
      }
      await claimReleased;
      await route.fulfill({
        body: JSON.stringify({
          status: "complete",
          username: "locked_snapshot",
        }),
        contentType: "application/json",
        status: 200,
      });
    });

    await page.goto("/onboarding");
    const input = page.getByRole("textbox", { name: "Username" });
    await input.fill("  Locked Snapshot  ");
    await page.getByRole("button", { name: "Create racer account" }).click();

    await expect(input).toBeDisabled();
    await expect(
      page.getByRole("button", { name: "Creating account…" }),
    ).toBeDisabled();
    releaseClaim?.();
    await expect(page.getByText("@locked_snapshot")).toBeVisible();
  });

  test("supports controller create and back navigation", async ({
    page,
  }, testInfo) => {
    test.skip(
      testInfo.project.name === "mobile",
      "Controller desktop fixture.",
    );
    await installStandardGamepadFixture(page);
    await fulfillIncompleteProfile(page, "controller_racer");
    await page.route(profileApiPattern, async (route) => {
      if (route.request().method() !== "PUT") {
        await route.fallback();
        return;
      }
      await route.fulfill({
        body: JSON.stringify({
          status: "complete",
          username: "controller_racer",
        }),
        contentType: "application/json",
        status: 200,
      });
    });

    await page.goto("/onboarding");
    const profile = page.locator('[data-controller-menu-ready="true"]');
    const create = page.getByRole("button", { name: "Create racer account" });
    await expect(profile).toHaveCount(1);

    await setStandardTestGamepad(page);
    await page.waitForTimeout(50);
    await setStandardTestGamepad(page, { 13: 1 });
    await expect(create).toBeFocused();
    await setStandardTestGamepad(page);
    await page.waitForTimeout(50);
    await setStandardTestGamepad(page, { 0: 1 });
    await expect(page.getByText("@controller_racer")).toBeVisible();
    await setStandardTestGamepad(page);
    await page.waitForTimeout(50);
    await setStandardTestGamepad(page, { 1: 1 });
    await expect(page).toHaveURL(/\/$/);
  });

  test("rejects unsafe onboarding return paths", async ({ page }) => {
    await page.route(profileApiPattern, async (route) => {
      await route.fulfill({
        body: JSON.stringify({ status: "complete", username: "safe_racer" }),
        contentType: "application/json",
        status: 200,
      });
    });
    for (const returnTo of [
      "https://evil.example",
      "/\\evil.example",
      "/\t/evil.example",
    ]) {
      await page.goto(`/onboarding?returnTo=${encodeURIComponent(returnTo)}`);
      await expect(page.getByRole("link", { name: "Continue" })).toHaveAttribute(
        "href",
        "/",
      );
    }
  });

  test("fits the onboarding panel within the viewport", async ({ page }) => {
    await fulfillIncompleteProfile(page, "responsive_racer");

    await page.goto("/onboarding");
    await expect(page.getByRole("textbox", { name: "Username" })).toBeVisible();
    const metrics = await page.evaluate(() => ({
      bodyWidth: document.body.scrollWidth,
      viewportHeight: window.innerHeight,
      viewportWidth: window.innerWidth,
    }));
    expect(metrics.bodyWidth).toBeLessThanOrEqual(metrics.viewportWidth);
    await expect(page.locator("main")).toHaveCSS(
      "min-height",
      `${metrics.viewportHeight}px`,
    );
  });
});

import { expect, test, type Page } from "@playwright/test";

import { deriveKartSnapshot } from "../src/game/kart/kart-derivation";
import {
  createOfficialKartDocument,
  type OfficialKartId,
} from "../src/game/kart/official-kart-roster";
import {
  installStandardGamepadFixture,
  pressStandardGamepadButton,
  setStandardTestGamepad,
} from "./helpers/standard-gamepad";

function createPersistedRevision(kartId: OfficialKartId) {
  const document = createOfficialKartDocument(kartId);
  const resolvedSnapshot = deriveKartSnapshot(document);
  return {
    authorUserId: "admin-test-user",
    createdAt: "2026-07-26T12:00:00.000Z",
    derivationVersion: resolvedSnapshot.derivationVersion,
    document,
    kartId,
    ownerUserId: "admin-test-user",
    publication: null,
    resolvedSnapshot,
    resolvedSnapshotHash: "0".repeat(64),
    revision: 1,
    schemaVersion: document.schemaVersion,
    thumbnailAvailable: false,
  };
}

async function useOfficialDraftStatuses(page: Page) {
  await page.route("**/api/admin/karts/*", async (route) => {
    const kartId = new URL(route.request().url()).pathname.split("/").at(-1);
    await route.fulfill({
      body: JSON.stringify(
        kartId === "balanced-kart"
          ? createPersistedRevision(kartId)
          : { error: "Kart not found." },
      ),
      contentType: "application/json",
      status: kartId === "balanced-kart" ? 200 : 404,
    });
  });
}

test("routes the Kart Builder button through the official admin roster", async ({
  page,
}) => {
  await useOfficialDraftStatuses(page);
  await page.goto("/");

  await page.getByRole("button", { name: "Open utility menu" }).click();
  const kartBuilder = page.getByRole("link", { name: "Kart Builder" });
  await expect(kartBuilder).toHaveAttribute("href", "/admin/karts");
  await kartBuilder.click();

  await expect(page).toHaveURL(/\/admin\/karts$/);
  await expect(
    page.getByRole("heading", { name: "Official Karts" }),
  ).toBeVisible();
  for (const [name, kartId, action] of [
    ["Balanced Kart", "balanced-kart", "Edit"],
    ["Speed Kart", "speed-kart", "Create"],
    ["Handling Kart", "handling-kart", "Create"],
  ] as const) {
    const card = page.getByRole("article").filter({ hasText: name });
    await expect(card.getByRole("heading", { name })).toBeVisible();
    await expect(
      card.getByRole("link", { name: action }),
    ).toHaveAttribute("href", `/admin/karts/${kartId}`);
    await expect(card.getByText("acceleration", { exact: true })).toBeVisible();
    await expect(card.getByText("handling", { exact: true })).toBeVisible();
    await expect(card.getByText("speed", { exact: true })).toBeVisible();
    await expect(card.getByText("stability", { exact: true })).toBeVisible();
  }
  await expect(
    page
      .getByRole("article")
      .filter({ hasText: "Balanced Kart" })
      .locator('[data-kart-thumbnail-source="generated"]'),
  ).toBeVisible();
  for (const name of ["Speed Kart", "Handling Kart"]) {
    await expect(
      page
        .getByRole("article")
        .filter({ hasText: name })
        .locator('[data-kart-thumbnail-source="placeholder"]'),
    ).toBeVisible();
  }

  const documentWidth = await page.evaluate(
    () => document.documentElement.scrollWidth,
  );
  expect(documentWidth).toBeLessThanOrEqual(page.viewportSize()?.width ?? 0);
});

test("navigates into and back from the official roster with a controller", async ({
  page,
}, testInfo) => {
  test.skip(
    testInfo.project.name !== "desktop",
    "Controller navigation only needs one desktop fixture.",
  );
  await useOfficialDraftStatuses(page);
  await installStandardGamepadFixture(page);
  await page.goto("/");
  const home = page.locator('[data-controller-menu-ready="true"]');
  await expect(home).toHaveCount(1);
  await setStandardTestGamepad(page);
  await page.waitForTimeout(50);

  const utilityMenu = page.getByRole("button", { name: "Open utility menu" });
  await pressStandardGamepadButton(page, 12);
  await expect(utilityMenu).toBeFocused();
  await pressStandardGamepadButton(page, 0);
  const kartBuilder = page.getByRole("link", { name: "Kart Builder" });
  await pressStandardGamepadButton(page, 13);
  await pressStandardGamepadButton(page, 13);
  await expect(kartBuilder).toBeFocused();
  await pressStandardGamepadButton(page, 0);
  await expect(page).toHaveURL(/\/admin\/karts$/);

  const roster = page.locator('[data-controller-menu-ready="true"]');
  await expect(roster).toHaveCount(1);
  await setStandardTestGamepad(page);
  await page.waitForTimeout(50);
  await pressStandardGamepadButton(page, 1);
  await expect(page).toHaveURL(/\/$/);
  await expect(home).toHaveCount(1);
  await setStandardTestGamepad(page);
  await page.waitForTimeout(50);

  await pressStandardGamepadButton(page, 12);
  await expect(utilityMenu).toBeFocused();
  await pressStandardGamepadButton(page, 0);
  await pressStandardGamepadButton(page, 13);
  await pressStandardGamepadButton(page, 13);
  await expect(kartBuilder).toBeFocused();
  await pressStandardGamepadButton(page, 0);
  await expect(page).toHaveURL(/\/admin\/karts$/);
  await expect(roster).toHaveCount(1);
  await setStandardTestGamepad(page);
  await page.waitForTimeout(50);
  await pressStandardGamepadButton(page, 0);
  await expect(page).toHaveURL(/\/admin\/karts\/balanced-kart$/);
});

test("resolves draft actions independently across auth and network failures", async ({
  page,
}) => {
  await page.context().addCookies([
    {
      name: "qa-session",
      url: "http://127.0.0.1:3001",
      value: "present",
    },
  ]);
  let releaseBalanced: (() => void) | undefined;
  const balancedGate = new Promise<void>((resolve) => {
    releaseBalanced = resolve;
  });
  await page.route("**/api/admin/karts/*", async (route) => {
    expect(route.request().headers()["cookie"]).toContain("qa-session=present");
    const kartId = new URL(route.request().url()).pathname.split("/").at(-1);
    if (kartId === "balanced-kart") {
      await balancedGate;
      await route.fulfill({
        body: JSON.stringify(createPersistedRevision(kartId)),
        contentType: "application/json",
        status: 200,
      });
    } else if (kartId === "speed-kart") {
      await route.fulfill({ body: "{}", status: 401 });
    } else {
      await route.abort("failed");
    }
  });

  await page.goto("/admin/karts");
  const balanced = page.getByRole("article").filter({ hasText: "Balanced Kart" });
  const speed = page.getByRole("article").filter({ hasText: "Speed Kart" });
  const handling = page
    .getByRole("article")
    .filter({ hasText: "Handling Kart" });
  await expect(speed.getByRole("link", { name: "Sign in" })).toBeVisible();
  await expect(
    handling.getByRole("link", { name: "Open builder" }),
  ).toBeVisible();
  await expect(
    balanced.getByRole("link", { name: "Checking…" }),
  ).toBeVisible();

  releaseBalanced?.();
  await expect(
    balanced.getByRole("link", { name: "Edit" }),
  ).toBeVisible();
});

test("maps onboarding, forbidden, and missing draft checks safely", async ({
  page,
}) => {
  await page.route("**/api/admin/karts/*", async (route) => {
    const kartId = new URL(route.request().url()).pathname.split("/").at(-1);
    await route.fulfill({
      body: "{}",
      status:
        kartId === "balanced-kart" ? 428 : kartId === "speed-kart" ? 403 : 404,
    });
  });

  await page.goto("/admin/karts");
  const actionFor = (name: string) =>
    page.getByRole("article").filter({ hasText: name }).getByRole("link");
  await expect(actionFor("Balanced Kart")).toHaveText("Complete account");
  await expect(actionFor("Balanced Kart")).toHaveAttribute(
    "href",
    "/onboarding?returnTo=%2Fadmin%2Fkarts%2Fbalanced-kart",
  );
  await expect(actionFor("Speed Kart")).toHaveText("Sign in");
  await expect(actionFor("Handling Kart")).toHaveText("Create");
});

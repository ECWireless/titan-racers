import { expect, test } from "@playwright/test";

import { ROUGH_COURSE_DOCUMENT } from "../src/game/course/course-document";

const courseApiPattern = "**/api/admin/courses/rough-course";

test.describe("protected course editor access", () => {
  test("keeps the editor shell hidden until an admin revision loads", async ({
    page,
  }) => {
    await page.route(courseApiPattern, async (route) => {
      await route.fulfill({
        body: JSON.stringify({ error: "Authentication required." }),
        contentType: "application/json",
        status: 401,
      });
    });

    await page.goto("/editor");

    await expect(
      page.getByText("Sign in with an approved admin account to continue."),
    ).toBeVisible();
    await expect(
      page.getByRole("button", { name: "Continue with Google" }),
    ).toBeVisible();
    await expect(page.getByTestId("course-editor-shell")).toHaveCount(0);
  });

  test("starts Google sign-in when Better Auth returns redirect metadata", async ({
    page,
  }) => {
    await page.route(courseApiPattern, async (route) => {
      await route.fulfill({
        body: JSON.stringify({ error: "Authentication required." }),
        contentType: "application/json",
        status: 401,
      });
    });
    await page.route("**/api/auth/sign-in/social", async (route) => {
      await route.fulfill({
        body: JSON.stringify({
          redirect: true,
          url: "http://127.0.0.1:3873/editor?oauth=started",
        }),
        contentType: "application/json",
        status: 200,
      });
    });

    await page.goto("/editor");
    await page.getByRole("button", { name: "Continue with Google" }).click();

    await expect(page).toHaveURL(/oauth=started/);
    await expect(
      page.getByText("Sign in with an approved admin account to continue."),
    ).toBeVisible();
  });

  test("explains a signed-in account without the admin role", async ({ page }) => {
    await page.route(courseApiPattern, async (route) => {
      await route.fulfill({
        body: JSON.stringify({ error: "Required role missing." }),
        contentType: "application/json",
        status: 403,
      });
    });
    await page.route("**/api/auth/sign-out", async (route) => {
      await route.fulfill({
        body: JSON.stringify({ success: true }),
        contentType: "application/json",
        status: 200,
      });
    });

    await page.goto("/editor");

    await expect(
      page.getByText("This account does not have course-editor access."),
    ).toBeVisible();
    await expect(page.getByTestId("course-editor-shell")).toHaveCount(0);
    await page.getByRole("button", { name: "Sign out" }).click();
    await expect(
      page.getByText("Sign in with an approved admin account to continue."),
    ).toBeVisible();
  });

  test("lets an authorized admin initialize a missing seed course", async ({
    page,
  }) => {
    let courseExists = false;
    let savePayload: unknown;

    await page.route(courseApiPattern, async (route) => {
      if (route.request().method() === "PUT") {
        savePayload = route.request().postDataJSON();
        courseExists = true;
        await route.fulfill({
          body: JSON.stringify({
            authorUserId: "admin-test-user",
            courseId: ROUGH_COURSE_DOCUMENT.courseId,
            createdAt: new Date("2026-07-12T00:00:00.000Z").toISOString(),
            document: ROUGH_COURSE_DOCUMENT,
            revision: 1,
            schemaVersion: ROUGH_COURSE_DOCUMENT.schemaVersion,
          }),
          contentType: "application/json",
          status: 201,
        });
        return;
      }

      await route.fulfill({
        body: JSON.stringify(
          courseExists ? { unexpected: true } : { error: "Course not found." },
        ),
        contentType: "application/json",
        status: courseExists ? 500 : 404,
      });
    });

    await page.goto("/editor");
    await expect(
      page.getByText("No rough-course revision exists yet."),
    ).toBeVisible();
    await page.getByRole("button", { name: "Initialize seed course" }).click();

    await expect(page.getByTestId("course-editor-shell")).toBeVisible();
    expect(savePayload).toMatchObject({
      document: { courseId: "rough-course", schemaVersion: 1 },
      expectedRevision: null,
    });
  });

  test("reloads the winning revision after a competing seed initialization", async ({
    page,
  }) => {
    let initializationAttempted = false;

    await page.route(courseApiPattern, async (route) => {
      if (route.request().method() === "PUT") {
        initializationAttempted = true;
        await route.fulfill({
          body: JSON.stringify({ error: "Revision conflict." }),
          contentType: "application/json",
          status: 409,
        });
        return;
      }

      if (!initializationAttempted) {
        await route.fulfill({
          body: JSON.stringify({ error: "Course not found." }),
          contentType: "application/json",
          status: 404,
        });
        return;
      }

      await route.fulfill({
        body: JSON.stringify({
          authorUserId: "winning-admin",
          courseId: ROUGH_COURSE_DOCUMENT.courseId,
          createdAt: new Date("2026-07-12T00:00:00.000Z").toISOString(),
          document: ROUGH_COURSE_DOCUMENT,
          revision: 1,
          schemaVersion: ROUGH_COURSE_DOCUMENT.schemaVersion,
        }),
        contentType: "application/json",
        status: 200,
      });
    });

    await page.goto("/editor");
    await page.getByRole("button", { name: "Initialize seed course" }).click();

    await expect(page.getByTestId("course-editor-shell")).toBeVisible();
    await expect(page.getByText("Rough Test Loop")).toBeVisible();
  });

  test("loads the protected revision into the responsive editor shell", async ({
    page,
  }, testInfo) => {
    await page.route(courseApiPattern, async (route) => {
      await route.fulfill({
        body: JSON.stringify({
          authorUserId: "admin-test-user",
          courseId: ROUGH_COURSE_DOCUMENT.courseId,
          createdAt: new Date("2026-07-12T00:00:00.000Z").toISOString(),
          document: ROUGH_COURSE_DOCUMENT,
          revision: 3,
          schemaVersion: ROUGH_COURSE_DOCUMENT.schemaVersion,
        }),
        contentType: "application/json",
        status: 200,
      });
    });

    await page.goto("/editor");

    await expect(page.getByTestId("course-editor-shell")).toBeVisible();
    await expect(page.getByText("Rough Test Loop")).toBeVisible();
    await expect(
      page.getByText("Loaded revision workspace"),
    ).toBeVisible();
    await expect(page.getByRole("button", { name: "Undo" })).toBeDisabled();
    await expect(page.getByRole("button", { name: "Redo" })).toBeDisabled();

    if (testInfo.project.name === "mobile") {
      const courseButton = page.getByRole("button", {
        name: "Course",
        exact: true,
      });
      await courseButton.click();
      const dialog = page.getByRole("dialog", { name: "Course" });
      await expect(dialog).toBeVisible();
      await expect(page.getByRole("button", { name: "Close panel" })).toBeFocused();
      await expect(dialog.getByText("Course objects")).toBeVisible();
      await expect(
        dialog.getByRole("button", { name: /Course objects/ }),
      ).toHaveCount(0);
      await page.keyboard.press("Escape");
      await expect(dialog).toHaveCount(0);
      await expect(courseButton).toBeFocused();
      await page.getByRole("button", { name: "Inspector" }).click();
      const inspectorDialog = page.getByRole("dialog", { name: "Inspector" });
      await expect(inspectorDialog).toBeVisible();
      await expect(inspectorDialog.getByText("Loaded · clean")).toBeVisible();
      await page.getByRole("button", { name: "Close panel" }).click();
      await courseButton.click();
      await expect(page.getByRole("dialog", { name: "Course" })).toBeVisible();
      await page.setViewportSize({ width: 1200, height: 800 });
      await expect(page.getByRole("dialog")).toHaveCount(0);
      await expect(page.locator("header")).toHaveJSProperty("inert", false);
      await expect(page.getByRole("link", { name: "Exit" })).toBeEnabled();
    } else {
      await expect(page.getByTestId("editor-revision")).toHaveText(
        "Revision 3",
      );
      await expect(page.getByText("Course objects")).toBeVisible();
      await expect(page.getByText("Loaded · clean")).toBeVisible();
    }
  });

  test("signs out from the protected workspace", async ({ page }) => {
    let signOutHeaders: Record<string, string> = {};
    let signOutPayload: unknown;
    await page.route(courseApiPattern, async (route) => {
      await route.fulfill({
        body: JSON.stringify({
          authorUserId: "admin-test-user",
          courseId: ROUGH_COURSE_DOCUMENT.courseId,
          createdAt: new Date("2026-07-12T00:00:00.000Z").toISOString(),
          document: ROUGH_COURSE_DOCUMENT,
          revision: 3,
          schemaVersion: ROUGH_COURSE_DOCUMENT.schemaVersion,
        }),
        contentType: "application/json",
        status: 200,
      });
    });
    await page.route("**/api/auth/sign-out", async (route) => {
      signOutHeaders = route.request().headers();
      signOutPayload = route.request().postDataJSON();
      await route.fulfill({
        body: JSON.stringify({ success: true }),
        contentType: "application/json",
        status: 200,
      });
    });

    await page.goto("/editor");
    await page.getByRole("button", { name: "Sign out" }).click();

    await expect(
      page.getByText("Sign in with an approved admin account to continue."),
    ).toBeVisible();
    await expect(page.getByTestId("course-editor-shell")).toHaveCount(0);
    expect(signOutHeaders["content-type"]).toContain("application/json");
    expect(signOutPayload).toEqual({});
  });
});

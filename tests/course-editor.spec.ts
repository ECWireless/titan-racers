import { expect, type Locator, test } from "@playwright/test";

import { ROUGH_COURSE_DOCUMENT } from "../src/game/course/course-document";
import { COURSE_EDITOR_CHECKPOINT_LIMIT } from "../src/game/editor/course-editor-document";

const courseApiPattern = "**/api/admin/courses/rough-course";
const coursePublicationApiPattern =
  "**/api/admin/courses/rough-course/publication";

function courseAtCheckpointLimit() {
  const document = structuredClone(ROUGH_COURSE_DOCUMENT);
  const template = document.checkpoints[0]!;
  document.checkpoints = Array.from(
    { length: COURSE_EDITOR_CHECKPOINT_LIMIT },
    (_, index) => ({
      ...structuredClone(template),
      id: `limit-checkpoint-${index + 1}`,
      order: index + 1,
      position: { ...template.position, z: index },
    }),
  );
  const objectTemplate = document.objects[0]!;
  document.objects = Array.from(
    { length: 500 },
    (_, index) => ({
      ...structuredClone(objectTemplate),
      id: `limit-object-${index + 1}`,
      transform: {
        ...structuredClone(objectTemplate.transform),
        position: { ...objectTemplate.transform.position, x: index % 100 },
      },
    }),
  );
  return document;
}

async function waitForEditorScene(canvas: Locator) {
  await expect(canvas).toHaveAttribute("data-scene-ready", "true");
}

async function getCourseEditorSelectionPoint(
  canvas: Locator,
  selection: { id: string; kind: "checkpoint" | "object" | "start" },
) {
  await waitForEditorScene(canvas);
  return canvas.evaluate(
    (element, requestedSelection) =>
      new Promise<{ x: number; y: number } | null>((resolve) => {
        element.dispatchEvent(
          new CustomEvent("getCourseEditorSelectionPoint", {
            detail: { respond: resolve, selection: requestedSelection },
          }),
        );
      }),
    selection,
  );
}

async function getCourseEditorTranslateGizmoPoints(
  canvas: Locator,
  axis: "x" | "y" | "z",
) {
  await waitForEditorScene(canvas);
  return canvas.evaluate(
    (element, requestedAxis) =>
      new Promise<{
        head: { x: number; y: number } | null;
        origin: { x: number; y: number } | null;
      } | null>((resolve) => {
        element.dispatchEvent(
          new CustomEvent("getCourseEditorTranslateGizmoPoints", {
            detail: { axis: requestedAxis, respond: resolve },
          }),
        );
      }),
    axis,
  );
}

async function getCourseEditorScaleGizmoPoints(
  canvas: Locator,
  axis: "x" | "y" | "z",
) {
  await waitForEditorScene(canvas);
  return canvas.evaluate(
    (element, requestedAxis) =>
      new Promise<{
        handle: { x: number; y: number } | null;
        origin: { x: number; y: number } | null;
      } | null>((resolve) => {
        element.dispatchEvent(
          new CustomEvent("getCourseEditorScaleGizmoPoints", {
            detail: { axis: requestedAxis, respond: resolve },
          }),
        );
      }),
    axis,
  );
}

async function getCourseEditorSelectionMappingCount(canvas: Locator) {
  await waitForEditorScene(canvas);
  return canvas.evaluate(
    (element) =>
      new Promise<number>((resolve) => {
        element.dispatchEvent(
          new CustomEvent("getCourseEditorSelectionMappingCount", {
            detail: { respond: resolve },
          }),
        );
      }),
  );
}

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

  test("rejects schema-valid revisions above the editor object budget", async ({
    page,
  }) => {
    const template = ROUGH_COURSE_DOCUMENT.objects[0];
    const oversizedDocument = {
      ...ROUGH_COURSE_DOCUMENT,
      objects: Array.from({ length: 501 }, (_, index) => ({
        ...structuredClone(template),
        id: `editor-budget-${index + 1}`,
      })),
    };
    await page.route(courseApiPattern, async (route) => {
      await route.fulfill({
        body: JSON.stringify({
          authorUserId: "admin-test-user",
          courseId: ROUGH_COURSE_DOCUMENT.courseId,
          createdAt: new Date("2026-07-12T00:00:00.000Z").toISOString(),
          document: oversizedDocument,
          revision: 3,
          schemaVersion: ROUGH_COURSE_DOCUMENT.schemaVersion,
        }),
        contentType: "application/json",
        status: 200,
      });
    });

    await page.goto("/editor");
    await expect(
      page.getByText("The course revision response was unavailable or invalid."),
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

  test("lets a signed-in account without the admin role choose another Google account", async ({
    page,
  }) => {
    const authRequests: string[] = [];
    await page.route(courseApiPattern, async (route) => {
      await route.fulfill({
        body: JSON.stringify({ error: "Required role missing." }),
        contentType: "application/json",
        status: 403,
      });
    });
    await page.route("**/api/auth/sign-out", async (route) => {
      authRequests.push("sign-out");
      await route.fulfill({
        body: JSON.stringify({ success: true }),
        contentType: "application/json",
        status: 200,
      });
    });
    await page.route("**/api/auth/sign-in/social", async (route) => {
      authRequests.push("sign-in");
      await route.fulfill({
        body: JSON.stringify({
          redirect: true,
          url: "http://127.0.0.1:3873/editor?oauth=account-switch",
        }),
        contentType: "application/json",
        status: 200,
      });
    });

    await page.goto("/editor");

    await expect(
      page.getByText(
        "This account does not have course-editor access. Choose another Google account to continue.",
      ),
    ).toBeVisible();
    await expect(page.getByTestId("course-editor-shell")).toHaveCount(0);
    await page
      .getByRole("button", { name: "Choose another Google account" })
      .click();
    await expect(page).toHaveURL(/oauth=account-switch/);
    expect(authRequests).toEqual(["sign-out", "sign-in"]);
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
    await waitForEditorScene(page.getByTestId("course-editor-canvas"));
    await expect(page.getByRole("button", { name: "Undo" })).toBeDisabled();
    await expect(page.getByRole("button", { name: "Redo" })).toBeDisabled();
    await expect(page.getByTestId("course-editor-canvas")).toHaveAttribute(
      "data-colliders-visible",
      "false",
    );
    const moveTool = page.getByRole("button", { name: "Move" });
    await moveTool.focus();
    const moveTooltipId = await moveTool.getAttribute("aria-describedby");
    await expect(page.locator(`[id="${moveTooltipId}"]`)).toBeVisible();
    await expect(page.locator(`[id="${moveTooltipId}"]`)).toHaveText(
      "Move selection (1)",
    );
    const scaleTool = page.getByRole("button", {
      exact: true,
      name: "Scale",
    });
    await scaleTool.focus();
    await expect(scaleTool).toHaveAttribute("aria-disabled", "true");
    const scaleTooltipId = await scaleTool.getAttribute("aria-describedby");
    await expect(page.locator(`[id="${scaleTooltipId}"]`)).toBeVisible();
    await expect(page.locator(`[id="${scaleTooltipId}"]`)).toHaveText(
      "Scale is unavailable for the start position",
    );
    await expect(
      page.getByRole("button", { name: "Frame selection" }),
    ).not.toHaveAttribute("aria-pressed");
    await page.getByRole("button", { name: "Exit course editor" }).focus();
    await page.keyboard.press("2");
    await expect(page.getByRole("button", { name: "Rotate" })).toHaveAttribute(
      "aria-pressed",
      "true",
    );
    const canvas = page.getByTestId("course-editor-canvas");
    await canvas.focus();
    await page.keyboard.press("1");
    await expect(moveTool).toHaveAttribute(
      "aria-pressed",
      "true",
    );
    await moveTool.click();
    await page.getByRole("button", { name: "Camera controls" }).click();
    const cameraControls = page.getByRole("region", {
      name: "Camera controls",
    });
    await expect(cameraControls).toContainText(
      "1 finger orbit · 2 finger pan · pinch zoom",
    );
    await expect(cameraControls).toContainText(
      "Right-drag orbit · Shift-drag pan · wheel zoom",
    );
    await page.getByRole("button", { name: "Close camera controls" }).click();

    if (testInfo.project.name === "mobile") {
      const courseButton = page.getByRole("button", {
        name: "Course",
        exact: true,
      });
      await courseButton.click();
      const dialog = page.getByRole("dialog", { name: "Course" });
      await expect(dialog).toBeVisible();
      await expect(page.getByTestId("editor-toolbar-shell")).toHaveJSProperty(
        "inert",
        true,
      );
      await expect(page.getByRole("button", { name: "Close panel" })).toBeFocused();
      await expect(dialog.getByRole("heading", { name: "Add object" })).toBeVisible();
      await expect(dialog.getByRole("button", { name: "block" })).toBeVisible();
      await expect(
        dialog.getByRole("heading", { name: "Environment" }),
      ).toBeVisible();
      await page.keyboard.press("Escape");
      await expect(dialog).toHaveCount(0);
      await expect(courseButton).toBeFocused();
      await page.getByRole("button", { name: "Inspector" }).click();
      const inspectorPanel = page.getByRole("complementary", {
        name: "Inspector",
      });
      await expect(inspectorPanel).toBeVisible();
      await expect(page.getByTestId("course-editor-canvas")).toBeVisible();
      await expect
        .poll(() =>
          page.evaluate(
            () =>
              document.documentElement.scrollWidth -
              document.documentElement.clientWidth,
          ),
        )
        .toBe(0);
      const viewportBounds = await page
        .getByTestId("course-editor-canvas")
        .boundingBox();
      const inspectorBounds = await inspectorPanel.boundingBox();
      expect(viewportBounds).not.toBeNull();
      expect(inspectorBounds).not.toBeNull();
      expect(viewportBounds!.y + viewportBounds!.height).toBeLessThanOrEqual(
        inspectorBounds!.y + 1,
      );
      await page.setViewportSize({ width: 915, height: 412 });
      const landscapeViewportBounds = await page
        .getByTestId("course-editor-canvas")
        .boundingBox();
      const landscapeInspectorBounds = await inspectorPanel.boundingBox();
      expect(landscapeViewportBounds).not.toBeNull();
      expect(landscapeInspectorBounds).not.toBeNull();
      expect(
        landscapeViewportBounds!.x + landscapeViewportBounds!.width,
      ).toBeLessThanOrEqual(landscapeInspectorBounds!.x + 1);
      expect(landscapeViewportBounds!.height).toBeGreaterThan(200);
      expect(landscapeInspectorBounds!.height).toBeGreaterThan(200);
      await page.setViewportSize({ width: 412, height: 839 });
      await expect(inspectorPanel.getByTestId("editor-selection")).toHaveText(
        "start-position",
      );
      await page.getByRole("button", { name: "Close panel" }).click();
      await courseButton.click();
      await expect(page.getByRole("dialog", { name: "Course" })).toBeVisible();
      await page.setViewportSize({ width: 1200, height: 800 });
      await expect(page.getByRole("dialog")).toHaveCount(0);
      await expect(page.locator("header")).toHaveJSProperty("inert", false);
      await expect(
        page.getByRole("button", { name: "Exit course editor" }),
      ).toBeEnabled();
    } else {
      await expect(page.getByTestId("editor-revision")).toHaveText(
        "Draft r3 · Published none",
      );
      await expect(page.getByRole("button", { name: "block" })).toBeVisible();
      await expect(page.getByRole("heading", { name: "Environment" })).toBeVisible();
      await expect(page.getByTestId("editor-selection")).toHaveText(
        "start-position",
      );
    }
  });

  test("disables creation and explains the editor limits", async ({
    page,
  }, testInfo) => {
    testInfo.setTimeout(120_000);
    const document = courseAtCheckpointLimit();
    await page.route(courseApiPattern, async (route) => {
      await route.fulfill({
        body: JSON.stringify({
          authorUserId: "admin-test-user",
          courseId: document.courseId,
          createdAt: new Date("2026-07-12T00:00:00.000Z").toISOString(),
          document,
          revision: 3,
          schemaVersion: document.schemaVersion,
        }),
        contentType: "application/json",
        status: 200,
      });
    });

    await page.goto("/editor");
    if (testInfo.project.name === "mobile") {
      await page.getByRole("button", { name: "Course", exact: true }).click();
    }
    const panel =
      testInfo.project.name === "mobile"
        ? page.getByRole("dialog", { name: "Course" })
        : page;
    const addCheckpoint = panel.getByRole("button", {
      name: "Add checkpoint",
    });
    await expect(addCheckpoint).toBeDisabled();
    await expect(addCheckpoint).toHaveAttribute(
      "title",
      `Checkpoint limit reached (${COURSE_EDITOR_CHECKPOINT_LIMIT})`,
    );
    await expect(
      panel.getByText(
        `Checkpoint limit reached (${COURSE_EDITOR_CHECKPOINT_LIMIT})`,
        { exact: true },
      ),
    ).toBeVisible();
    const blockPreset = panel.getByRole("button", { name: "block" });
    await expect(blockPreset).toBeDisabled();
    await expect(blockPreset).toHaveAttribute(
      "title",
      "Editor object limit reached (500)",
    );
    await expect(
      panel.getByText("Editor object limit reached (500)", { exact: true }),
    ).toBeVisible();
  });

  test("saves a private draft and advances the clean revision", async ({
    page,
  }, testInfo) => {
    test.skip(testInfo.project.name !== "desktop", "Draft API coverage runs once.");
    let savedPayload: { document: typeof ROUGH_COURSE_DOCUMENT; expectedRevision: number } | null = null;

    await page.route(courseApiPattern, async (route) => {
      if (route.request().method() === "PUT") {
        savedPayload = route.request().postDataJSON();
        await route.fulfill({
          body: JSON.stringify({
            authorUserId: "admin-test-user",
            courseId: ROUGH_COURSE_DOCUMENT.courseId,
            createdAt: new Date("2026-07-12T00:05:00.000Z").toISOString(),
            document: savedPayload!.document,
            revision: 4,
            schemaVersion: ROUGH_COURSE_DOCUMENT.schemaVersion,
          }),
          contentType: "application/json",
          status: 200,
        });
        return;
      }

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
    await page.getByRole("button", { name: "block" }).click();
    const saveButton = page.getByRole("button", { name: "Save draft" });
    await expect(saveButton).toBeEnabled();
    await saveButton.click();

    await expect(page.getByTestId("editor-revision")).toHaveText(
      "Draft r4 · Published none",
    );
    await expect(saveButton).toBeDisabled();
    expect(savedPayload).toMatchObject({ expectedRevision: 3 });
    expect(savedPayload!.document.objects.at(-1)?.id).toBe("block-1");
  });

  test("publishes only the clean saved draft and updates live status", async ({
    page,
  }, testInfo) => {
    let publishPayload: unknown;
    let releasePublication = () => {};
    const publicationGate = new Promise<void>((resolve) => {
      releasePublication = resolve;
    });
    await page.route(courseApiPattern, async (route) => {
      await route.fulfill({
        body: JSON.stringify({
          authorUserId: "admin-test-user",
          courseId: ROUGH_COURSE_DOCUMENT.courseId,
          createdAt: new Date("2026-07-12T00:00:00.000Z").toISOString(),
          document: ROUGH_COURSE_DOCUMENT,
          publication: {
            publicationId: 8,
            publishedAt: new Date("2026-07-12T00:00:00.000Z").toISOString(),
            publishedByUserId: "admin-test-user",
            revision: 2,
          },
          revision: 3,
          schemaVersion: ROUGH_COURSE_DOCUMENT.schemaVersion,
        }),
        contentType: "application/json",
        status: 200,
      });
    });
    await page.route(coursePublicationApiPattern, async (route) => {
      publishPayload = route.request().postDataJSON();
      await publicationGate;
      await route.fulfill({
        body: JSON.stringify({
          authorUserId: "admin-test-user",
          courseId: ROUGH_COURSE_DOCUMENT.courseId,
          createdAt: new Date("2026-07-12T00:00:00.000Z").toISOString(),
          document: ROUGH_COURSE_DOCUMENT,
          publicationId: 9,
          publishedAt: new Date("2026-07-12T00:05:00.000Z").toISOString(),
          publishedByUserId: "admin-test-user",
          revision: 3,
          schemaVersion: ROUGH_COURSE_DOCUMENT.schemaVersion,
        }),
        contentType: "application/json",
        status: 201,
      });
    });

    await page.goto("/editor");
    await expect(page.getByTestId("editor-revision")).toContainText(
      "Draft r3 · Published r2",
    );
    if (testInfo.project.name === "mobile") {
      await page.getByRole("button", { name: "Course actions" }).click();
    }
    let publish = page.getByRole("button", { name: "Publish saved draft" });
    await expect(publish).toBeEnabled();
    await publish.click();
    await expect(page.getByTestId("publication-status")).toContainText(
      "Publishing course",
    );
    releasePublication();
    await expect(page.getByTestId("editor-revision")).toContainText(
      "Draft r3 · Published r3",
    );
    await expect(page.getByTestId("publication-status")).toContainText(
      "Draft r3 is now available to guest racing.",
    );
    if (testInfo.project.name === "mobile") {
      await page.getByRole("button", { name: "Course actions" }).click();
      publish = page.getByRole("button", { name: "Draft r3 is published" });
      await expect(publish).toContainText("Draft r3 is already live");
    }
    await expect(publish).toBeDisabled();
    expect(publishPayload).toEqual({
      expectedPublicationId: 8,
      revision: 3,
    });

    if (testInfo.project.name === "mobile") {
      await page.getByRole("button", { name: "Course actions" }).click();
      await page.getByRole("button", { name: "Course", exact: true }).click();
      await page
        .getByRole("dialog", { name: "Course" })
        .getByRole("button", { name: "block" })
        .click();
      await page.getByRole("button", { name: "Course actions" }).click();
      publish = page.getByRole("button", { name: "Save before publishing" });
      await expect(publish).toContainText("Save the draft before publishing");
    } else {
      await page.getByRole("button", { name: "block" }).click();
    }
    await expect(publish).toBeDisabled();
  });

  test("reports publication conflicts separately from draft failures", async ({
    page,
  }, testInfo) => {
    test.skip(testInfo.project.name !== "desktop", "Conflict feedback runs once.");
    await page.route(courseApiPattern, async (route) => {
      await route.fulfill({
        body: JSON.stringify({
          authorUserId: "admin-test-user",
          courseId: ROUGH_COURSE_DOCUMENT.courseId,
          createdAt: new Date("2026-07-12T00:00:00.000Z").toISOString(),
          document: ROUGH_COURSE_DOCUMENT,
          publication: {
            publicationId: 8,
            publishedAt: new Date("2026-07-12T00:00:00.000Z").toISOString(),
            publishedByUserId: "admin-test-user",
            revision: 2,
          },
          revision: 3,
          schemaVersion: ROUGH_COURSE_DOCUMENT.schemaVersion,
        }),
        contentType: "application/json",
        status: 200,
      });
    });
    await page.route(coursePublicationApiPattern, async (route) => {
      await route.fulfill({
        body: JSON.stringify({ error: "Publication conflict." }),
        contentType: "application/json",
        status: 409,
      });
    });

    await page.goto("/editor");
    await page.getByRole("button", { name: "Publish saved draft" }).click();
    const publicationError = page.getByRole("alert").filter({
      hasText: "Publication failed",
    });
    await expect(publicationError).toContainText(
      "Another administrator published this course first.",
    );
    await expect(
      publicationError.getByRole("button", { name: "Reload status" }),
    ).toBeVisible();
    await expect(page.getByText("Draft action failed")).toHaveCount(0);
  });

  test("persists collapsed Course and Inspector sections in the browser", async ({
    page,
  }, testInfo) => {
    test.skip(testInfo.project.name !== "desktop", "Preference coverage runs once.");
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
    const outline = page.getByRole("button", { name: "Course outline" });
    const position = page.getByRole("button", { name: "Position", exact: true });
    await expect(outline).toHaveAttribute("aria-expanded", "true");
    await expect(position).toHaveAttribute("aria-expanded", "true");
    await outline.click();
    await position.click();
    await page.reload();

    await expect(outline).toHaveAttribute("aria-expanded", "false");
    await expect(position).toHaveAttribute("aria-expanded", "false");
    await expect(page.getByRole("button", { name: "Start Spawn" })).toHaveCount(0);
    await expect(page.getByRole("button", { name: "Position x increase" })).toHaveCount(0);
  });

  test("serializes delayed draft saves and blocks duplicate shortcuts", async ({
    page,
  }, testInfo) => {
    test.skip(testInfo.project.name !== "desktop", "Save serialization runs once.");
    let releaseSave!: () => void;
    const saveGate = new Promise<void>((resolve) => {
      releaseSave = resolve;
    });
    let putCount = 0;

    await page.route(courseApiPattern, async (route) => {
      if (route.request().method() === "PUT") {
        putCount += 1;
        const payload = route.request().postDataJSON();
        await saveGate;
        await route.fulfill({
          body: JSON.stringify({
            authorUserId: "admin-test-user",
            courseId: ROUGH_COURSE_DOCUMENT.courseId,
            createdAt: new Date("2026-07-12T00:05:00.000Z").toISOString(),
            document: payload.document,
            revision: 4,
            schemaVersion: ROUGH_COURSE_DOCUMENT.schemaVersion,
          }),
          contentType: "application/json",
          status: 200,
        });
        return;
      }
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
    await page.getByRole("button", { name: "block" }).click();
    await page.getByRole("button", { name: "Save draft" }).click();
    await expect.poll(() => putCount).toBe(1);
    await expect(page.getByTestId("editor-toolbar-shell")).toHaveJSProperty(
      "inert",
      true,
    );
    await page.keyboard.press("Control+s");
    await page.keyboard.press("Control+s");
    expect(putCount).toBe(1);

    releaseSave();
    await expect(page.getByTestId("editor-revision")).toHaveText(
      "Draft r4 · Published none",
    );
    await expect(page.getByRole("button", { name: "Save draft" })).toBeDisabled();
  });

  test("blocks authoring while the latest draft is loading", async ({
    page,
  }, testInfo) => {
    test.skip(testInfo.project.name !== "desktop", "Latest-draft locking runs once.");
    let getCount = 0;
    let releaseLatest!: () => void;
    const latestGate = new Promise<void>((resolve) => {
      releaseLatest = resolve;
    });
    const latestDocument = {
      ...structuredClone(ROUGH_COURSE_DOCUMENT),
      name: "Latest Locked Draft",
    };

    await page.route(courseApiPattern, async (route) => {
      if (route.request().method() === "GET") {
        getCount += 1;
        if (getCount > 1) {
          await latestGate;
        }
      }
      await route.fulfill({
        body: JSON.stringify({
          authorUserId: "admin-test-user",
          courseId: ROUGH_COURSE_DOCUMENT.courseId,
          createdAt: new Date("2026-07-12T00:00:00.000Z").toISOString(),
          document: getCount > 1 ? latestDocument : ROUGH_COURSE_DOCUMENT,
          revision: getCount > 1 ? 4 : 3,
          schemaVersion: ROUGH_COURSE_DOCUMENT.schemaVersion,
        }),
        contentType: "application/json",
        status: 200,
      });
    });

    await page.goto("/editor");
    await page.getByRole("button", { name: "block" }).click();
    await page.getByRole("button", { name: "Course actions" }).click();
    await page.getByRole("button", { name: "Load latest draft" }).click();
    await page
      .getByRole("dialog", { name: "Discard unsaved changes?" })
      .getByRole("button", { name: "Load latest draft" })
      .click();
    await expect.poll(() => getCount).toBe(2);
    await expect(page.getByTestId("editor-toolbar-shell")).toHaveJSProperty(
      "inert",
      true,
    );
    await expect(page.getByRole("button", { name: "Undo" })).toBeDisabled();

    releaseLatest();
    await expect(page.getByText("Latest Locked Draft")).toBeVisible();
    await expect(page.getByTestId("editor-revision")).toHaveText(
      "Draft r4 · Published none",
    );
    await expect(
      page.getByRole("button", { name: "Course actions" }),
    ).toBeFocused();
  });

  test("keeps header and bottom actions inside narrow mobile viewports", async ({
    page,
  }, testInfo) => {
    test.skip(testInfo.project.name !== "mobile", "Narrow action coverage is mobile-only.");
    await page.route(courseApiPattern, async (route) => {
      await route.fulfill({
        body: JSON.stringify({
          authorUserId: "admin-test-user",
          courseId: ROUGH_COURSE_DOCUMENT.courseId,
          createdAt: new Date("2026-07-12T00:00:00.000Z").toISOString(),
          document: ROUGH_COURSE_DOCUMENT,
          revision: 7,
          schemaVersion: ROUGH_COURSE_DOCUMENT.schemaVersion,
        }),
        contentType: "application/json",
        status: 200,
      });
    });

    for (const width of [350, 375, 412]) {
      await page.setViewportSize({ width, height: 760 });
      await page.goto("/editor");
      await expect(page.getByTestId("course-editor-shell")).toBeVisible();
      await expect
        .poll(() =>
          page.evaluate(
            () =>
              document.documentElement.scrollWidth -
              document.documentElement.clientWidth,
          ),
        )
        .toBe(0);

      const actions = [
        page.getByRole("button", { name: "Exit course editor" }),
        page.getByRole("button", { name: "Undo" }),
        page.getByRole("button", { name: "Redo" }),
        page.getByRole("button", { name: "Save draft" }),
        page.getByRole("button", { name: "Course actions" }),
        page.getByRole("button", { name: "Course", exact: true }),
        page.getByRole("button", { name: "Inspector" }),
      ];
      for (const action of actions) {
        const bounds = await action.boundingBox();
        expect(bounds).not.toBeNull();
        expect(bounds!.x).toBeGreaterThanOrEqual(0);
        expect(bounds!.x + bounds!.width).toBeLessThanOrEqual(width);
      }

      await page.getByRole("button", { name: "Course actions" }).click();
      const signOut = page.getByRole("button", { name: "Sign out" });
      await expect(signOut).toBeVisible();
      await expect
        .poll(() =>
          signOut.evaluate((element) => {
            const bounds = element.getBoundingClientRect();
            const hit = document.elementFromPoint(
              bounds.left + bounds.width / 2,
              bounds.top + bounds.height / 2,
            );
            return hit === element || element.contains(hit);
          }),
        )
        .toBe(true);
      await page.keyboard.press("Escape");
      await expect(signOut).toHaveCount(0);
      await expect(
        page.getByRole("button", { name: "Course actions" }),
      ).toBeFocused();
      await page.getByRole("button", { name: "Course actions" }).click();
      await page.getByRole("button", { name: "Move" }).click();
      await expect(signOut).toHaveCount(0);
    }
  });

  test("preserves local work on conflict and confirms loading the winning draft", async ({
    page,
  }, testInfo) => {
    test.skip(testInfo.project.name !== "desktop", "Conflict coverage runs once.");
    let conflicted = false;
    let putCount = 0;
    const winningDocument = {
      ...structuredClone(ROUGH_COURSE_DOCUMENT),
      name: "Winning Draft",
    };

    await page.route(courseApiPattern, async (route) => {
      if (route.request().method() === "PUT") {
        putCount += 1;
        conflicted = true;
        await route.fulfill({
          body: JSON.stringify({ error: "Revision conflict." }),
          contentType: "application/json",
          status: 409,
        });
        return;
      }
      await route.fulfill({
        body: JSON.stringify({
          authorUserId: conflicted ? "winning-admin" : "admin-test-user",
          courseId: ROUGH_COURSE_DOCUMENT.courseId,
          createdAt: new Date("2026-07-12T00:00:00.000Z").toISOString(),
          document: conflicted ? winningDocument : ROUGH_COURSE_DOCUMENT,
          revision: conflicted ? 4 : 3,
          schemaVersion: ROUGH_COURSE_DOCUMENT.schemaVersion,
        }),
        contentType: "application/json",
        status: 200,
      });
    });

    await page.goto("/editor");
    await page.getByRole("button", { name: "block" }).click();
    await page.getByRole("button", { name: "Save draft" }).click();
    const alert = page
      .getByTestId("course-editor-shell")
      .getByRole("alert");
    await expect(alert).toContainText("Your local changes are intact");
    await expect(page.getByRole("button", { name: "Undo" })).toBeEnabled();
    await alert.getByRole("button", { name: "Load latest draft" }).click();
    const dialog = page.getByRole("dialog", { name: "Discard unsaved changes?" });
    await expect(dialog).toBeVisible();
    await expect(
      page.getByTestId("course-editor-shell").getByRole("alert"),
    ).toHaveCount(0);
    await page.keyboard.press("Control+z");
    await page.keyboard.press("Control+s");
    await expect(page.getByRole("button", { name: "Undo" })).toBeEnabled();
    expect(putCount).toBe(1);
    const keepEditing = dialog.getByRole("button", { name: "Keep editing" });
    const loadLatest = dialog.getByRole("button", { name: "Load latest draft" });
    await expect(keepEditing).toBeFocused();
    await page.keyboard.press("Shift+Tab");
    await expect(loadLatest).toBeFocused();
    await page.keyboard.press("Tab");
    await expect(keepEditing).toBeFocused();
    await loadLatest.click();

    await expect(page.getByText("Winning Draft")).toBeVisible();
    await expect(page.getByTestId("editor-revision")).toHaveText(
      "Draft r4 · Published none",
    );
    await expect(page.getByRole("button", { name: "Undo" })).toBeDisabled();
    await expect(
      page.getByRole("button", { name: "Course actions" }),
    ).toBeFocused();
  });

  test("authors and resets lighting, downloads a backup, and reverts local work", async ({
    page,
  }, testInfo) => {
    test.skip(testInfo.project.name !== "desktop", "Draft recovery coverage runs once.");
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
    const ambientIntensity = page.getByRole("spinbutton", {
      name: "Ambient intensity",
    });
    await ambientIntensity.fill("4.1");
    await expect(ambientIntensity).toHaveValue("4");
    await expect(page.getByRole("button", { name: "Save draft" })).toBeEnabled();
    await page.getByRole("button", { name: "Reset lighting" }).click();
    await expect(ambientIntensity).toHaveValue("1");

    await page.getByRole("button", { name: "block" }).click();
    await page.getByRole("button", { name: "Course actions" }).click();
    const downloadPromise = page.waitForEvent("download");
    await page.getByRole("button", { name: "Download backup" }).click();
    const download = await downloadPromise;
    expect(download.suggestedFilename()).toBe("rough-course.draft-r3.json");

    await page.getByRole("button", { name: "Course actions" }).click();
    await page.getByRole("button", { name: "Revert changes" }).click();
    const dialog = page.getByRole("dialog", { name: "Discard unsaved changes?" });
    await expect(dialog).toBeVisible();
    await dialog.getByRole("button", { name: "Revert changes" }).click();
    await expect(page.getByRole("button", { name: "Undo" })).toBeDisabled();
    await expect(page.getByRole("button", { name: /block-1/ })).toHaveCount(0);
  });

  test("confirms dirty exit and sign-out and guards browser unload", async ({
    page,
  }, testInfo) => {
    test.skip(testInfo.project.name !== "desktop", "Dirty navigation coverage runs once.");
    let signOutCount = 0;
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
      signOutCount += 1;
      await route.fulfill({
        body: JSON.stringify({ success: true }),
        contentType: "application/json",
        status: 200,
      });
    });

    await page.goto("/editor");
    await page.getByRole("button", { name: "block" }).click();
    expect(
      await page.evaluate(() => {
        const event = new Event("beforeunload", { cancelable: true });
        window.dispatchEvent(event);
        return event.defaultPrevented;
      }),
    ).toBe(true);

    const exit = page.getByRole("button", { name: "Exit course editor" });
    await exit.click();
    let dialog = page.getByRole("dialog", { name: "Discard unsaved changes?" });
    await dialog.getByRole("button", { name: "Keep editing" }).click();
    await expect(exit).toBeFocused();

    await page.getByRole("button", { name: "Sign out" }).click();
    dialog = page.getByRole("dialog", { name: "Discard unsaved changes?" });
    await expect(dialog).toContainText("Signing out now");
    await dialog.getByRole("button", { name: "Keep editing" }).click();
    expect(signOutCount).toBe(0);

    await exit.click();
    await page
      .getByRole("dialog", { name: "Discard unsaved changes?" })
      .getByRole("button", { name: "Exit editor" })
      .click();
    await expect(page).toHaveURL(/\/$/);
  });

  test("selects and authors course objects across desktop and mobile controls", async ({
    page,
  }, testInfo) => {
    testInfo.setTimeout(45_000);
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
    const canvas = page.getByTestId("course-editor-canvas");
    await waitForEditorScene(canvas);

    if (testInfo.project.name === "desktop") {
      const barrelPoint = await getCourseEditorSelectionPoint(canvas, {
        id: "obstacle-barrel-a",
        kind: "object",
      });
      expect(barrelPoint).not.toBeNull();
      await canvas.click({ position: barrelPoint! });
      await expect(canvas).toHaveAttribute(
        "data-selected-id",
        "obstacle-barrel-a",
      );
    }

    if (testInfo.project.name === "mobile") {
      await page.getByRole("button", { name: "Course", exact: true }).click();
      await page
        .getByRole("dialog", { name: "Course" })
        .getByRole("button", { name: "block" })
        .click();
    } else {
      await page.getByRole("button", { name: "block" }).click();
    }

    await expect(canvas).toHaveAttribute("data-selected-id", "block-1");
    await expect(page.getByRole("button", { name: "Undo" })).toBeEnabled();
    if (testInfo.project.name === "desktop") {
      await page.keyboard.press("2");
      await expect(canvas).toHaveAttribute("data-tool", "rotate");
      await page.keyboard.press("3");
      await expect(canvas).toHaveAttribute("data-tool", "scale");
      await page.keyboard.press("Control+1");
      await expect(canvas).toHaveAttribute("data-tool", "scale");
    }
    if (testInfo.project.name === "mobile") {
      await expect(canvas).toBeFocused();
      await page.getByRole("button", { name: "Course", exact: true }).click();
      await page
        .getByRole("dialog", { name: "Course" })
        .getByRole("button", { name: "Start Spawn" })
        .click();
      await expect(canvas).toHaveAttribute("data-selected-id", "start-position");
      const blockPoint = await getCourseEditorSelectionPoint(canvas, {
        id: "block-1",
        kind: "object",
      });
      expect(blockPoint).not.toBeNull();
      await canvas.click({ position: blockPoint! });
      await expect(canvas).toHaveAttribute("data-selected-id", "block-1");
    }
    if (testInfo.project.name === "mobile") {
      await page.getByRole("button", { name: "Inspector" }).click();
    }
    const inspector =
      testInfo.project.name === "mobile"
        ? page.getByRole("complementary", { name: "Inspector" })
        : page.getByRole("complementary", { name: "Inspector" });
    await expect(inspector.getByTestId("editor-selection")).toHaveText("block-1");
    await inspector.getByRole("button", { name: "Position x increase" }).click();
    await expect(inspector.getByTestId("position-x-value")).toHaveText("0.25");
    await inspector.getByRole("textbox", { name: "Object name" }).fill("Pit block");
    await inspector.getByRole("textbox", { name: "Object name" }).press("1");
    await expect(inspector.getByRole("textbox", { name: "Object name" })).toHaveValue(
      "Pit block1",
    );
    if (testInfo.project.name === "desktop") {
      await expect(canvas).toHaveAttribute("data-tool", "scale");
    }
    await inspector.getByRole("textbox", { name: "Object name" }).fill("Pit block");
    await inspector.getByRole("button", { name: "Apply" }).click();
    await expect(inspector.getByRole("textbox", { name: "Object name" })).toHaveValue(
      "Pit block",
    );
    await inspector.getByRole("button", { name: "Scale x increase" }).click();
    await expect(inspector.getByTestId("scale-x-value")).toHaveText("2.20");
    await expect(inspector.getByTestId("scale-y-value")).toHaveText("1.00");

    if (testInfo.project.name === "mobile") {
      await inspector.getByRole("button", { name: "Close panel" }).click();
    }
    await page
      .getByTestId("editor-toolbar-shell")
      .getByRole("button", { exact: true, name: "Scale" })
      .click();
    await expect(canvas).toHaveAttribute("data-tool", "scale");
    await page.getByRole("button", { name: "Snap On" }).click();
    await expect(page.getByRole("button", { name: "Snap Off" })).toHaveAttribute(
      "aria-pressed",
      "false",
    );
    await expect(canvas).toHaveAttribute("data-snap-enabled", "false");
    const hiddenSelectionMappingCount =
      await getCourseEditorSelectionMappingCount(canvas);
    for (let cycle = 0; cycle < 3; cycle += 1) {
      await page.getByRole("button", { name: "Show collision shapes" }).click();
      await expect(
        page.getByRole("button", { name: "Hide collision shapes" }),
      ).toHaveAttribute("aria-pressed", "true");
      await expect(canvas).toHaveAttribute("data-colliders-visible", "true");
      expect(await getCourseEditorSelectionMappingCount(canvas)).toBeGreaterThan(
        hiddenSelectionMappingCount,
      );
      await page.getByRole("button", { name: "Hide collision shapes" }).click();
      await expect(canvas).toHaveAttribute("data-colliders-visible", "false");
      expect(await getCourseEditorSelectionMappingCount(canvas)).toBe(
        hiddenSelectionMappingCount,
      );
    }
    await page.getByRole("button", { name: "Undo" }).click();
    await page.getByRole("button", { name: "Undo" }).click();
    await page.getByRole("button", { name: "Undo" }).click();

    if (testInfo.project.name === "mobile") {
      await page.getByRole("button", { name: "Inspector" }).click();
    }
    const restoredInspector =
      testInfo.project.name === "mobile"
        ? page.getByRole("complementary", { name: "Inspector" })
        : page.getByRole("complementary", { name: "Inspector" });
    await expect(restoredInspector.getByTestId("position-x-value")).toHaveText(
      "0.00",
    );
    await expect(
      restoredInspector.getByRole("textbox", { name: "Object name" }),
    ).toHaveValue("block-1");
    await expect(restoredInspector.getByTestId("scale-x-value")).toHaveText(
      "2.00",
    );
    await restoredInspector
      .getByRole("button", { name: "Delete selected" })
      .click();
    await expect(canvas).toHaveAttribute("data-selected-id", "start-position");
    await page.getByRole("button", { name: "Undo" }).click();

    if (testInfo.project.name === "mobile") {
      await page.getByRole("button", { name: "Course", exact: true }).click();
      await page
        .getByRole("dialog", { name: "Course" })
        .getByRole("button", { name: "Add checkpoint" })
        .click();
    } else {
      await page.getByRole("button", { name: "Add checkpoint" }).click();
    }
    await expect(canvas).toHaveAttribute("data-selected-id", "checkpoint-1");

    if (testInfo.project.name === "mobile") {
      await page.getByRole("button", { name: "Inspector" }).click();
    }
    const checkpointInspector =
      testInfo.project.name === "mobile"
        ? page.getByRole("complementary", { name: "Inspector" })
        : page.getByRole("complementary", { name: "Inspector" });
    await checkpointInspector
      .getByRole("button", { name: "Rotation y increase" })
      .click();
    await checkpointInspector
      .getByRole("button", { name: "Delete selected" })
      .click();
    await expect(canvas).toHaveAttribute("data-selected-id", "start-position");
  });

  test("commits PlayCanvas translate and per-axis scale gizmo drags as undoable edits", async ({
    page,
  }, testInfo) => {
    test.skip(
      testInfo.project.name !== "desktop",
      "The direct gizmo regression runs once; mobile precision controls have separate coverage.",
    );
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
    const canvas = page.getByTestId("course-editor-canvas");
    await waitForEditorScene(canvas);
    await page.getByRole("button", { name: "block" }).click();
    const points = await getCourseEditorTranslateGizmoPoints(canvas, "x");
    const box = await canvas.boundingBox();
    expect(points?.head).not.toBeNull();
    expect(points?.origin).not.toBeNull();
    expect(box).not.toBeNull();

    const xDelta = points!.head!.x - points!.origin!.x;
    const yDelta = points!.head!.y - points!.origin!.y;
    const length = Math.hypot(xDelta, yDelta);
    const startX = box!.x + points!.head!.x;
    const startY = box!.y + points!.head!.y;
    await page.mouse.move(startX, startY);
    await page.mouse.down();
    await page.mouse.move(
      startX + (xDelta / length) * 55,
      startY + (yDelta / length) * 55,
      { steps: 8 },
    );
    await page.mouse.up();

    await expect(page.getByTestId("position-x-value")).not.toHaveText("0.00");
    await expect(page.getByRole("button", { name: "Undo" })).toBeEnabled();
    await page.getByRole("button", { name: "Undo" }).click();
    await expect(page.getByTestId("position-x-value")).toHaveText("0.00");

    await page
      .getByTestId("editor-toolbar-shell")
      .getByRole("button", { exact: true, name: "Scale" })
      .click();
    const scalePoints = await getCourseEditorScaleGizmoPoints(canvas, "x");
    expect(scalePoints?.handle).not.toBeNull();
    expect(scalePoints?.origin).not.toBeNull();
    const scaleXDelta = scalePoints!.handle!.x - scalePoints!.origin!.x;
    const scaleYDelta = scalePoints!.handle!.y - scalePoints!.origin!.y;
    const scaleLength = Math.hypot(scaleXDelta, scaleYDelta);
    const scaleStartX = box!.x + scalePoints!.handle!.x;
    const scaleStartY = box!.y + scalePoints!.handle!.y;
    await page.mouse.move(scaleStartX, scaleStartY);
    await page.mouse.down();
    await page.mouse.move(
      scaleStartX + (scaleXDelta / scaleLength) * 45,
      scaleStartY + (scaleYDelta / scaleLength) * 45,
      { steps: 8 },
    );
    await page.mouse.up();

    await expect(page.getByTestId("scale-x-value")).not.toHaveText("2.00");
    await expect(page.getByTestId("scale-y-value")).toHaveText("1.00");
    await expect(page.getByTestId("scale-z-value")).toHaveText("2.00");
    await page.getByRole("button", { name: "Undo" }).click();
    await expect(page.getByTestId("scale-x-value")).toHaveText("2.00");
    await expect(page.getByTestId("scale-y-value")).toHaveText("1.00");

    await page.mouse.move(box!.x + 20, box!.y + 20);
    await page.mouse.down({ button: "right" });
    await expect(canvas).toHaveCSS("cursor", "grabbing");
    await page.mouse.up({ button: "right" });
    await expect(canvas).toHaveCSS("cursor", "default");
    await page.keyboard.down("Shift");
    await page.mouse.down();
    await expect(canvas).toHaveCSS("cursor", "move");
    await page.mouse.up();
    await page.keyboard.up("Shift");
    await expect(canvas).toHaveCSS("cursor", "default");
  });

  test("keeps authored start height stable during direct gizmo edits", async ({
    page,
  }, testInfo) => {
    test.skip(
      testInfo.project.name !== "desktop",
      "The direct start-marker gizmo regression only needs to run once.",
    );
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
    const canvas = page.getByTestId("course-editor-canvas");
    await waitForEditorScene(canvas);
    const points = await getCourseEditorTranslateGizmoPoints(canvas, "x");
    const box = await canvas.boundingBox();
    expect(points?.head).not.toBeNull();
    expect(points?.origin).not.toBeNull();
    expect(box).not.toBeNull();
    const xDelta = points!.head!.x - points!.origin!.x;
    const yDelta = points!.head!.y - points!.origin!.y;
    const length = Math.hypot(xDelta, yDelta);
    const startX = box!.x + points!.head!.x;
    const startY = box!.y + points!.head!.y;
    await page.mouse.move(startX, startY);
    await page.mouse.down();
    await page.mouse.move(
      startX + (xDelta / length) * 45,
      startY + (yDelta / length) * 45,
      { steps: 8 },
    );
    await page.mouse.up();

    await expect(page.getByTestId("position-x-value")).not.toHaveText("0.00");
    await expect(page.getByTestId("position-y-value")).toHaveText("0.00");
    await page.getByRole("button", { name: "Undo" }).click();
    await expect(page.getByTestId("position-x-value")).toHaveText("0.00");
    await expect(page.getByTestId("position-y-value")).toHaveText("0.00");
  });

  test("does not turn multi-touch camera gestures or cancellation into selection taps", async ({
    page,
  }, testInfo) => {
    test.skip(
      testInfo.project.name !== "mobile",
      "The multi-touch release-order regression only needs the touch project.",
    );
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
    const canvas = page.getByTestId("course-editor-canvas");
    await waitForEditorScene(canvas);
    await page.getByRole("button", { name: "Course", exact: true }).click();
    await page
      .getByRole("dialog", { name: "Course" })
      .getByRole("button", { name: "block" })
      .click();
    await expect(canvas).toHaveAttribute("data-selected-id", "block-1");
    const startPoint = await getCourseEditorSelectionPoint(canvas, {
      id: ROUGH_COURSE_DOCUMENT.start.id,
      kind: "start",
    });
    expect(startPoint).not.toBeNull();
    const bounds = await canvas.boundingBox();
    expect(bounds).not.toBeNull();
    const session = await page.context().newCDPSession(page);
    const stationary = {
      id: 2,
      x: bounds!.x + startPoint!.x,
      y: bounds!.y + startPoint!.y,
    };
    const moving = {
      id: 1,
      x: stationary.x + 70,
      y: stationary.y,
    };
    await session.send("Input.dispatchTouchEvent", {
      touchPoints: [moving, stationary],
      type: "touchStart",
    });
    await session.send("Input.dispatchTouchEvent", {
      touchPoints: [{ ...moving, x: moving.x + 25, y: moving.y + 10 }, stationary],
      type: "touchMove",
    });
    await session.send("Input.dispatchTouchEvent", {
      touchPoints: [],
      type: "touchEnd",
    });
    await session.send("Input.dispatchTouchEvent", {
      touchPoints: [{ ...stationary, id: 3 }],
      type: "touchStart",
    });
    await session.send("Input.dispatchTouchEvent", {
      touchPoints: [],
      type: "touchCancel",
    });
    await session.detach();

    await expect(canvas).toHaveAttribute("data-selected-id", "block-1");
  });

  test("signs out from the protected workspace", async ({ page }, testInfo) => {
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
    if (testInfo.project.name === "mobile") {
      await page.getByRole("button", { name: "Course actions" }).click();
      await page.getByRole("button", { name: "Sign out" }).click();
    } else {
      await page.getByRole("button", { name: "Sign out" }).click();
    }

    await expect(
      page.getByText("Sign in with an approved admin account to continue."),
    ).toBeVisible();
    await expect(page.getByTestId("course-editor-shell")).toHaveCount(0);
    expect(signOutHeaders["content-type"]).toContain("application/json");
    expect(signOutPayload).toEqual({});
  });
});

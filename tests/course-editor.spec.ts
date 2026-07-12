import { expect, type Locator, test } from "@playwright/test";

import { ROUGH_COURSE_DOCUMENT } from "../src/game/course/course-document";

const courseApiPattern = "**/api/admin/courses/rough-course";

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
    await page.getByRole("link", { name: "Exit" }).focus();
    await page.keyboard.press("2");
    await expect(moveTool).toHaveAttribute("aria-pressed", "true");
    const canvas = page.getByTestId("course-editor-canvas");
    await canvas.focus();
    await page.keyboard.press("2");
    await expect(page.getByRole("button", { name: "Rotate" })).toHaveAttribute(
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
      await expect(page.getByRole("link", { name: "Exit" })).toBeEnabled();
    } else {
      await expect(page.getByTestId("editor-revision")).toHaveText(
        "Revision 3",
      );
      await expect(page.getByRole("button", { name: "block" })).toBeVisible();
      await expect(page.getByTestId("editor-selection")).toHaveText(
        "start-position",
      );
    }
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
    await page.getByRole("button", { exact: true, name: "Scale" }).click();
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

    await page.getByRole("button", { exact: true, name: "Scale" }).click();
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

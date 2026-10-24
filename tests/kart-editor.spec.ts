import { expect, test, type Locator, type Page } from "@playwright/test";

import { ROUGH_COURSE_DOCUMENT } from "../src/game/course/course-document";
import { replaceKartComponentDefinition } from "../src/game/editor/kart-editor-document";
import { KART_EDITOR_TRANSLATE_SNAP } from "../src/game/editor/kart-editor-scene";
import { createBalancedKartDocument } from "../src/game/kart/balanced-kart-document";
import { createSpeedKartDocument } from "../src/game/kart/speed-kart-document";
import type { KartAssemblyDocument } from "../src/game/kart/kart-assembly-document";
import {
  deriveKartSnapshot,
  type ResolvedKartSnapshot,
} from "../src/game/kart/kart-derivation";
import type { KartPublicationEvent } from "../src/game/kart/kart-publication";
import {
  KART_THUMBNAIL_HEIGHT,
  KART_THUMBNAIL_MAX_BYTES,
  KART_THUMBNAIL_RENDER_VERSION,
  KART_THUMBNAIL_WIDTH,
} from "../src/game/kart/kart-thumbnail-contract";
import { parseKartThumbnailUpload } from "../src/server/kart-thumbnail";
import {
  disconnectStandardTestGamepad,
  installStandardGamepadFixture,
  pressStandardGamepadButton,
  setStandardTestGamepad,
} from "./helpers/standard-gamepad";
import { createValidKartAssembly } from "./support/kart-assembly";

const kartApiPattern = "**/api/admin/karts/balanced-kart";
const publishedKartApiPattern = "**/api/karts/balanced-kart/published";
const publishedSandboxApiPattern = "**/api/courses/rough-course/published";

async function usePublishedSandboxCourse(page: Page) {
  const document = structuredClone(ROUGH_COURSE_DOCUMENT);
  document.name = "Published Sandbox QA";
  await page.route(publishedSandboxApiPattern, async (route) => {
    await route.fulfill({
      body: JSON.stringify({
        courseId: document.courseId,
        document,
        publishedAt: "2026-07-24T00:00:00.000Z",
        revision: 21,
        schemaVersion: document.schemaVersion,
      }),
      contentType: "application/json",
      status: 200,
    });
  });
  return document;
}

function createKartPublication(revision: number): KartPublicationEvent {
  return {
    action: "publish",
    actorUserId: "admin-test-user",
    eventId: revision,
    kartId: "balanced-kart",
    occurredAt: "2026-07-24T00:00:00.000Z",
    revision,
  };
}

async function usePublishedKart(
  page: Page,
  document: KartAssemblyDocument,
  revision: number,
) {
  const resolvedSnapshot = deriveKartSnapshot(document);
  await page.route(publishedKartApiPattern, async (route) => {
    await route.fulfill({
      body: JSON.stringify({
        derivationVersion: resolvedSnapshot.derivationVersion,
        document,
        kartId: document.kartId,
        publishedAt: "2026-07-24T00:00:00.000Z",
        resolvedSnapshot,
        resolvedSnapshotHash: "0".repeat(64),
        revision,
        schemaVersion: document.schemaVersion,
      }),
      contentType: "application/json",
      status: 200,
    });
  });
}

type MaterialColor = { x: number; y: number; z: number } | null;

async function getKartVisualColors(canvas: Locator) {
  return canvas.evaluate(
    (element) =>
      new Promise<{
        component: MaterialColor;
        primitive: MaterialColor;
      }>((resolve) => {
        element.dispatchEvent(
          new CustomEvent("getKartVisualDebugState", {
            detail: { respond: resolve },
          }),
        );
      }),
  );
}

async function getKartEditorInstanceVisualColor(
  canvas: Locator,
  instanceId: string,
) {
  return canvas.evaluate(
    (element, requestedInstanceId) =>
      new Promise<{ x: number; y: number; z: number } | null>((resolve) => {
        element.dispatchEvent(
          new CustomEvent("getKartEditorInstanceVisualColor", {
            detail: { instanceId: requestedInstanceId, respond: resolve },
          }),
        );
      }),
    instanceId,
  );
}

async function getKartEditorInstanceVisualState(
  canvas: Locator,
  instanceId: string,
) {
  return canvas.evaluate(
    (element, requestedInstanceId) =>
      new Promise<{
        coiloverEmissive: number[] | null;
        coiloverParentName: string | null;
      }>((resolve) => {
        element.dispatchEvent(
          new CustomEvent("getKartEditorInstanceVisualState", {
            detail: { instanceId: requestedInstanceId, respond: resolve },
          }),
        );
      }),
    instanceId,
  );
}

async function getKartEditorTranslateGizmoPoints(
  canvas: Locator,
  axis: "x" | "y" | "z",
) {
  return canvas.evaluate(
    (element, requestedAxis) =>
      new Promise<{
        head: { x: number; y: number } | null;
        origin: { x: number; y: number } | null;
      } | null>((resolve) => {
        element.dispatchEvent(
          new CustomEvent("getKartEditorTranslateGizmoPoints", {
            detail: { axis: requestedAxis, respond: resolve },
          }),
        );
      }),
    axis,
  );
}

async function getKartRuntimePhysics(canvas: Locator) {
  return canvas.evaluate(
    (element) =>
      new Promise<{
        developmentValues: { maximumDriveForce: number };
        maxForwardSpeed: number;
      }>((resolve) => {
        element.dispatchEvent(
          new CustomEvent("getKartDebugState", {
            detail: { respond: resolve },
          }),
        );
      }),
  );
}

function expectMaterialColor(color: MaterialColor, hex: string) {
  expect(color).not.toBeNull();
  const value = Number.parseInt(hex.slice(1), 16);
  expect(color?.x).toBeCloseTo(((value >> 16) & 0xff) / 255, 5);
  expect(color?.y).toBeCloseTo(((value >> 8) & 0xff) / 255, 5);
  expect(color?.z).toBeCloseTo((value & 0xff) / 255, 5);
}

function createPersistedBalancedRevision(
  document = createBalancedKartDocument(),
  publication: KartPublicationEvent | null = null,
  revision = 1,
) {
  const resolvedSnapshot = deriveKartSnapshot(document);

  return {
    authorUserId: "admin-test-user",
    createdAt: "2026-07-24T00:00:00.000Z",
    derivationVersion: resolvedSnapshot.derivationVersion,
    document,
    kartId: document.kartId,
    ownerUserId: "admin-test-user",
    publication,
    resolvedSnapshot,
    resolvedSnapshotHash: "0".repeat(64),
    revision,
    schemaVersion: document.schemaVersion,
  };
}

test.describe("protected kart builder access", () => {
  test("uses millimeter-scale translation snapping", () => {
    expect(KART_EDITOR_TRANSLATE_SNAP).toBe(0.005);
  });

  test("keeps the builder hidden from unauthenticated visitors", async ({
    page,
  }, testInfo) => {
    test.skip(
      testInfo.project.name !== "desktop",
      "Access-state coverage only needs to run once.",
    );
    await page.route(kartApiPattern, async (route) => {
      await route.fulfill({
        body: JSON.stringify({ error: "Authentication required." }),
        contentType: "application/json",
        status: 401,
      });
    });

    await page.goto("/admin/karts/balanced-kart");

    await expect(
      page.getByText("Sign in with an approved admin account to continue."),
    ).toBeVisible();
    await expect(
      page.getByRole("button", { name: "Continue with Google" }),
    ).toBeVisible();
    await expect(
      page.getByRole("heading", { name: "Balanced Kart" }),
    ).toHaveCount(0);
  });

  test("initializes an official ID from its matching roster assembly", async ({
    page,
  }, testInfo) => {
    test.skip(
      testInfo.project.name !== "desktop",
      "Official draft initialization only needs to run once.",
    );
    const speedDocument = createSpeedKartDocument();
    let requestCount = 0;
    await page.route("**/api/admin/karts/speed-kart", async (route) => {
      requestCount += 1;
      if (route.request().method() === "GET") {
        await route.fulfill({
          body: JSON.stringify({ error: "Kart not found." }),
          contentType: "application/json",
          status: 404,
        });
        return;
      }
      expect(route.request().postDataJSON()).toEqual({
        document: speedDocument,
        expectedRevision: null,
      });
      await route.fulfill({
        body: JSON.stringify(
          createPersistedBalancedRevision(speedDocument, null),
        ),
        contentType: "application/json",
        status: 201,
      });
    });

    await page.goto("/admin/karts/speed-kart");
    await page.getByRole("button", { name: "Create Speed Kart draft" }).click();

    await expect(
      page.getByRole("heading", { name: "Speed Kart" }),
    ).toBeVisible();
    expect(requestCount).toBe(2);
  });

  test("loads the validated assembly and saved-kart test control", async ({
    page,
  }, testInfo) => {
    let telemetryRequestCount = 0;
    const publishedKart = createBalancedKartDocument();
    const sandboxCourse = await usePublishedSandboxCourse(page);
    await usePublishedKart(page, publishedKart, 1);
    await page.route("**/api/telemetry/gameplay-runs", async (route) => {
      telemetryRequestCount += 1;
      await route.fulfill({ body: "{}", status: 202 });
    });
    await page.route(kartApiPattern, async (route) => {
      await route.fulfill({
        body: JSON.stringify(
          createPersistedBalancedRevision(
            publishedKart,
            createKartPublication(1),
          ),
        ),
        contentType: "application/json",
        status: 200,
      });
    });

    await page.goto("/admin/karts/balanced-kart");

    await expect(
      page.getByRole("heading", { name: "Balanced Kart" }),
    ).toBeVisible();
    await expect(page.getByTestId("kart-editor-revision")).toContainText(
      "Draft r1 · Published r1",
    );
    const viewport = page.getByLabel("Kart assembly viewport");
    await expect(viewport).toHaveAttribute("data-editor-status", "ready");
    const scaleButton = page.getByRole("button", { name: "Scale" });
    await expect(scaleButton).toBeDisabled();
    await expect(scaleButton).toHaveAttribute(
      "title",
      "Select a box primitive to scale",
    );
    await page.keyboard.press("2");
    await expect(page.getByRole("button", { name: "Rotate" })).toHaveAttribute(
      "aria-pressed",
      "true",
    );

    if (testInfo.project.name === "mobile") {
      const inspectorButton = page.getByRole("button", { name: "Inspector" });
      await inspectorButton.click();
      await expect(page.getByTestId("kart-editor-header")).toHaveAttribute(
        "inert",
        "",
      );
      await expect(
        page.getByText("Assembly is valid and deterministically derived."),
      ).toBeVisible();
      await page.keyboard.press("Escape");
      await expect(inspectorButton).toBeFocused();
      expect(
        await page.evaluate(
          () =>
            document.documentElement.scrollWidth <=
            document.documentElement.clientWidth,
        ),
      ).toBe(true);
      return;
    }

    await page.getByRole("button", { name: "Test saved kart" }).click();
    await expect(page.getByTestId("solo-time-trial-canvas")).toHaveAttribute(
      "data-course-document-name",
      sandboxCourse.name,
    );
    await expect(
      page.getByText("Saved r1 on sandbox course · Balanced Kart"),
    ).toBeVisible();
    await page.keyboard.press("Escape");
    await page.getByRole("button", { name: "Exit", exact: true }).click();
    await expect(viewport).toHaveAttribute("data-editor-status", "ready");
    await expect(
      page.getByRole("button", { name: "Test saved kart" }),
    ).toBeFocused();
    expect(telemetryRequestCount).toBe(0);

    await page
      .getByLabel("Kart and assembly")
      .getByRole("button", { name: /motor-main/ })
      .click();
    await expect(scaleButton).toHaveAttribute(
      "title",
      "Approved components have fixed dimensions",
    );
    const structuralParent = page.getByLabel("Structural parent");
    await expect(structuralParent).toHaveValue("chassis-plate");
    const positionX = page
      .getByRole("group", { name: "Position (m)" })
      .getByLabel("x");
    await positionX.fill("1");
    await expect(viewport).toHaveAttribute(
      "data-selection-validity",
      "invalid",
    );
    await expect(
      page.getByText("Outside attachment range", { exact: true }),
    ).toBeVisible();
    await positionX.fill("0.005");
    await expect(viewport).toHaveAttribute(
      "data-selection-validity",
      "attachable",
    );
    await page.getByRole("button", { name: "Attach to chassis-plate" }).click();
    await expect(viewport).toHaveAttribute("data-selection-validity", "valid");
    await expect(
      page.getByText("Assembly is valid and deterministically derived."),
    ).toBeVisible();

    await page
      .getByLabel("Kart and assembly")
      .getByRole("button", { name: /wheel-front-left/ })
      .click();
    await expect(viewport).toHaveAttribute(
      "data-mirror-counterpart-ids",
      "wheel-front-right",
    );

    const cameraRevision = await viewport.getAttribute("data-camera-revision");
    await page.keyboard.press("f");
    await expect(viewport).not.toHaveAttribute(
      "data-camera-revision",
      cameraRevision ?? "",
    );
  });

  test("moves and highlights procedural coilovers with their suspension roots", async ({
    page,
  }, testInfo) => {
    test.skip(
      testInfo.project.name !== "desktop",
      "Procedural hierarchy coverage only needs to run once.",
    );
    await page.route(kartApiPattern, async (route) => {
      await route.fulfill({
        body: JSON.stringify(createPersistedBalancedRevision()),
        contentType: "application/json",
        status: 200,
      });
    });

    await page.goto("/admin/karts/balanced-kart");
    const viewport = page.getByLabel("Kart assembly viewport");
    await expect(viewport).toHaveAttribute("data-editor-status", "ready");
    await page
      .getByLabel("Kart and assembly")
      .getByRole("button", { name: /suspension-front-left/ })
      .click();

    const selected = await getKartEditorInstanceVisualState(
      viewport,
      "suspension-front-left",
    );
    expect(selected.coiloverParentName).toBe("suspension-front-left");
    expect(selected.coiloverEmissive).toEqual([0.08, 0.65, 0.9]);
    const mirror = await getKartEditorInstanceVisualState(
      viewport,
      "suspension-front-right",
    );
    expect(mirror.coiloverParentName).toBe("suspension-front-right");
    expect(mirror.coiloverEmissive).toEqual([1, 0.36, 0.04]);

    const points = await getKartEditorTranslateGizmoPoints(viewport, "x");
    const box = await viewport.boundingBox();
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
    try {
      await expect(viewport).toHaveAttribute(
        "data-transform-validity",
        "valid",
      );
      const heldSelection = await getKartEditorInstanceVisualState(
        viewport,
        "suspension-front-left",
      );
      expect(heldSelection.coiloverEmissive).toEqual([0.08, 0.65, 0.9]);
      await page.mouse.move(
        startX + (xDelta / length) * 45,
        startY + (yDelta / length) * 45,
        { steps: 8 },
      );
      await expect(viewport).toHaveAttribute(
        "data-transform-validity",
        "invalid",
      );
      const invalid = await getKartEditorInstanceVisualState(
        viewport,
        "suspension-front-left",
      );
      expect(invalid.coiloverEmissive).toEqual([0.95, 0.03, 0.02]);
    } finally {
      await page.mouse.up();
    }
  });

  test("preserves historical suspension revisions until the editor explicitly upgrades them", async ({
    page,
  }, testInfo) => {
    test.skip(
      testInfo.project.name !== "desktop",
      "Historical component revision coverage only needs to run once.",
    );
    // Approved suspension defaults assume the fixture's 8 cm lower arms.
    let historicalDocument = createValidKartAssembly({
      kartId: "balanced-kart",
    });
    historicalDocument = replaceKartComponentDefinition(
      historicalDocument,
      "suspension-front-left",
      "suspension.compliant-long",
      1,
    );
    historicalDocument = replaceKartComponentDefinition(
      historicalDocument,
      "suspension-rear-left",
      "suspension.compliant-long",
      1,
    );
    await page.route(kartApiPattern, async (route) => {
      await route.fulfill({
        body: JSON.stringify(
          createPersistedBalancedRevision(historicalDocument),
        ),
        contentType: "application/json",
        status: 200,
      });
    });

    await page.goto("/admin/karts/balanced-kart");
    const viewport = page.getByLabel("Kart assembly viewport");
    await expect(viewport).toHaveAttribute("data-editor-status", "ready");
    await page
      .getByLabel("Kart and assembly")
      .getByRole("button", { name: /suspension-front-left/ })
      .click();

    const variant = page.getByLabel("Choose variant");
    await expect(variant).toHaveValue("suspension.compliant-long@1");
    await expect(
      variant.locator('option[value="suspension.compliant-long@1"]'),
    ).toHaveAttribute("disabled", "");
    await expect(
      variant.locator('option[value="suspension.compliant-long@3"]'),
    ).toHaveText(
      "Compliant long-travel suspension — More bump compliance with controlled rebound and slightly more mass.",
    );

    await variant.selectOption("suspension.compliant-long@3");
    await expect(variant).toHaveValue("suspension.compliant-long@3");
    await expect(page.getByText("Unsaved changes", { exact: true })).toBeVisible();
  });

  test("launches the exact saved kart on the current sandbox course", async ({
    page,
  }, testInfo) => {
    test.skip(
      testInfo.project.name !== "desktop",
      "Saved runtime coverage only needs to run once.",
    );
    let telemetryRequestCount = 0;
    const authoredDraft = createBalancedKartDocument();
    authoredDraft.name = "Unpublished Blue Draft";
    authoredDraft.visualIdentity.primaryColor = "#0000ff";
    authoredDraft.primitiveInstances[0].visualColor = "#1188cc";
    const publishedKart = createBalancedKartDocument();
    publishedKart.name = "Published Neon Kart";
    const savedRevision = createPersistedBalancedRevision(
      authoredDraft,
      createKartPublication(1),
      2,
    );
    const savedSnapshot = structuredClone(
      savedRevision.resolvedSnapshot,
    ) as unknown as ResolvedKartSnapshot;
    savedSnapshot.physicalProfile.drivetrain.maximumDriveForce = 12.345;
    const sandboxCourse = await usePublishedSandboxCourse(page);
    await usePublishedKart(page, publishedKart, 1);
    await page.route("**/api/telemetry/gameplay-runs", async (route) => {
      telemetryRequestCount += 1;
      await route.fulfill({ body: "{}", status: 202 });
    });
    await page.route(kartApiPattern, async (route) => {
      await route.fulfill({
        body: JSON.stringify({
          ...savedRevision,
          resolvedSnapshot: savedSnapshot,
        }),
        contentType: "application/json",
        status: 200,
      });
    });

    await page.goto("/admin/karts/balanced-kart");
    await page.getByRole("button", { name: "Test saved kart" }).click();
    const canvas = page.getByTestId("solo-time-trial-canvas");
    await expect(canvas).toHaveAttribute("data-scene-ready", "true");
    await expect(canvas).toHaveAttribute(
      "data-course-document-name",
      sandboxCourse.name,
    );
    await expect(canvas).toHaveAttribute(
      "data-kart-document-name",
      "Unpublished Blue Draft",
    );
    await expect(canvas).toHaveAttribute("data-kart-primary-color", "#0000ff");
    const runtimePhysics = await getKartRuntimePhysics(canvas);
    expect(runtimePhysics.developmentValues.maximumDriveForce).toBe(12.345);
    expectMaterialColor((await getKartVisualColors(canvas)).primitive, "#1188cc");
    await expect(
      page.getByText("Saved r2 on sandbox course · Unpublished Blue Draft"),
    ).toBeVisible();
    await page.keyboard.press("Escape");
    await page.getByRole("button", { name: "Exit", exact: true }).click();
    await expect(
      page.getByRole("button", { name: "Test saved kart" }),
    ).toBeFocused();
    expect(telemetryRequestCount).toBe(0);
  });

  test("persists an authored instance color through saved runtime rendering", async ({
    page,
  }, testInfo) => {
    test.skip(
      testInfo.project.name !== "desktop",
      "Per-instance rendering coverage only needs to run once.",
    );
    const authoredColor = "#e34f27";
    const savedState: { document: KartAssemblyDocument | null } = {
      document: null,
    };
    const initialDocument = createBalancedKartDocument();
    await usePublishedSandboxCourse(page);
    await page.route(kartApiPattern, async (route) => {
      if (route.request().method() === "PUT") {
        const body = route.request().postDataJSON() as {
          document: KartAssemblyDocument;
        };
        savedState.document = body.document;
        await route.fulfill({
          body: JSON.stringify(
            createPersistedBalancedRevision(body.document, null, 2),
          ),
          contentType: "application/json",
          status: 200,
        });
        return;
      }
      await route.fulfill({
        body: JSON.stringify(
          createPersistedBalancedRevision(initialDocument),
        ),
        contentType: "application/json",
        status: 200,
      });
    });

    await page.goto("/admin/karts/balanced-kart");
    await page
      .getByLabel("Kart and assembly")
      .getByRole("button", { name: /battery-main/ })
      .click();
    const colorInput = page.getByLabel("Selected component color");
    await colorInput.fill(authoredColor);
    await expect(colorInput).toHaveValue(authoredColor);
    const editorCanvas = page.getByLabel("Kart assembly viewport");
    expectMaterialColor(
      await getKartEditorInstanceVisualColor(editorCanvas, "battery-main"),
      authoredColor,
    );

    await page.getByRole("button", { name: "Save draft" }).click();
    await expect(page.getByText("Draft revision 2 saved.")).toBeVisible();
    expect(
      savedState.document?.componentInstances.find(
        ({ id }) => id === "battery-main",
      )?.visualColor,
    ).toBe(authoredColor);
    await colorInput.fill("#22cc88");
    await expect(
      page.getByTestId("kart-editor-header").getByText("Unsaved changes"),
    ).toBeVisible();
    await page.getByRole("button", { name: "Test saved kart" }).click();
    const runtimeCanvas = page.getByTestId("solo-time-trial-canvas");
    await expect(runtimeCanvas).toHaveAttribute("data-scene-ready", "true");
    expectMaterialColor(
      (await getKartVisualColors(runtimeCanvas)).component,
      authoredColor,
    );
  });

  test("completes a durable save when thumbnail encoding stalls", async ({
    page,
  }, testInfo) => {
    test.skip(
      testInfo.project.name !== "desktop",
      "The bounded browser encoder fallback only needs one rendered fixture.",
    );
    await page.addInitScript(
      ({ height, width }) => {
        const originalToBlob = HTMLCanvasElement.prototype.toBlob;
        HTMLCanvasElement.prototype.toBlob = function (
          callback,
          type,
          quality,
        ) {
          if (this.height === height && this.width === width) return;
          Reflect.apply(originalToBlob, this, [callback, type, quality]);
        };
      },
      { height: KART_THUMBNAIL_HEIGHT, width: KART_THUMBNAIL_WIDTH },
    );
    const initialDocument = createBalancedKartDocument();
    await page.route(kartApiPattern, async (route) => {
      if (route.request().method() === "PUT") {
        const body = route.request().postDataJSON() as {
          document: KartAssemblyDocument;
        };
        await route.fulfill({
          body: JSON.stringify(
            createPersistedBalancedRevision(body.document, null, 2),
          ),
          contentType: "application/json",
          status: 200,
        });
        return;
      }
      await route.fulfill({
        body: JSON.stringify(createPersistedBalancedRevision(initialDocument)),
        contentType: "application/json",
        status: 200,
      });
    });

    await page.goto("/admin/karts/balanced-kart");
    await page.getByLabel("Name").fill("Bounded thumbnail save");
    await page.getByLabel("Name").blur();
    await page.getByRole("button", { name: "Save draft" }).click();
    await expect(page.getByText("Draft revision 2 saved.")).toBeVisible({
      timeout: 5_000,
    });
    await expect(
      page.getByRole("button", { name: "Test saved kart" }),
    ).toBeEnabled();
  });

  test("saves, publishes, and unpublishes an authored revision", async ({
    page,
  }, testInfo) => {
    test.skip(
      testInfo.project.name !== "desktop",
      "Mutation workflow coverage only needs to run once.",
    );
    let releaseSave!: () => void;
    const saveGate = new Promise<void>((resolve) => {
      releaseSave = resolve;
    });
    await page.route(kartApiPattern, async (route) => {
      if (route.request().method() === "PUT") {
        await saveGate;
        const body = route.request().postDataJSON() as {
          document: ReturnType<typeof createBalancedKartDocument>;
          expectedRevision: number;
        };
        const saved = createPersistedBalancedRevision();
        await route.fulfill({
          body: JSON.stringify({
            ...saved,
            document: body.document,
            resolvedSnapshot: deriveKartSnapshot(body.document),
            revision: body.expectedRevision + 1,
          }),
          contentType: "application/json",
          status: 200,
        });
        return;
      }
      await route.fulfill({
        body: JSON.stringify(createPersistedBalancedRevision()),
        contentType: "application/json",
        status: 200,
      });
    });
    let publicationEventId = 0;
    await page.route(`${kartApiPattern}/publication`, async (route) => {
      const body = route.request().postDataJSON() as {
        action: "publish" | "unpublish";
        revision?: number;
      };
      publicationEventId += 1;
      await route.fulfill({
        body: JSON.stringify({
          action: body.action,
          actorUserId: "admin-test-user",
          eventId: publicationEventId,
          kartId: "balanced-kart",
          occurredAt: `2026-07-24T00:00:0${publicationEventId}.000Z`,
          revision: body.action === "publish" ? body.revision : null,
        }),
        contentType: "application/json",
        status: 200,
      });
    });
    let thumbnailPayload:
      | { contentType: string; data: string; renderVersion: number }
      | undefined;
    await page.route(
      `${kartApiPattern}/revisions/2/thumbnail`,
      async (route) => {
        thumbnailPayload = route.request().postDataJSON() as typeof thumbnailPayload;
        await route.fulfill({
          body: JSON.stringify({
            createdAt: "2026-07-24T00:00:02.000Z",
            imageSha256: "f".repeat(64),
            renderVersion: KART_THUMBNAIL_RENDER_VERSION,
          }),
          contentType: "application/json",
          status: 201,
        });
      },
    );

    await page.goto("/admin/karts/balanced-kart");
    await expect(
      page.getByRole("button", { name: "Test saved kart" }),
    ).toBeEnabled();
    const name = page.getByLabel("Name");
    await name.fill("Balanced Kart QA");
    await name.blur();

    await page.getByRole("button", { name: "Exit" }).click();
    await page.getByRole("button", { name: "Keep editing" }).click();
    await expect(page).toHaveURL(/\/admin\/karts\/balanced-kart$/);

    await page.getByRole("button", { name: "Kart actions" }).click();
    await page.keyboard.press("Control+s");
    await expect(
      page.getByRole("button", { name: "Revert changes" }),
    ).toHaveCount(0);
    await expect(page.getByRole("button", { name: "Exit" })).toBeDisabled();
    await expect(page.getByLabel("Kart assembly viewport")).toHaveAttribute(
      "aria-disabled",
      "true",
    );
    releaseSave();
    await expect(page.getByText("Draft revision 2 saved.")).toBeVisible();
    await expect.poll(() => thumbnailPayload).toBeTruthy();
    const thumbnailImage = Buffer.from(thumbnailPayload!.data, "base64");
    expect(thumbnailPayload).toMatchObject({
      contentType: "image/png",
      renderVersion: KART_THUMBNAIL_RENDER_VERSION,
    });
    expect(() => parseKartThumbnailUpload(thumbnailPayload)).not.toThrow();
    expect(thumbnailImage.length).toBeLessThanOrEqual(
      KART_THUMBNAIL_MAX_BYTES,
    );
    expect(thumbnailImage.readUInt32BE(16)).toBe(KART_THUMBNAIL_WIDTH);
    expect(thumbnailImage.readUInt32BE(20)).toBe(KART_THUMBNAIL_HEIGHT);

    await page.getByRole("button", { name: "Publish saved draft" }).click();
    await expect(page.getByText("Revision 2 published.")).toBeVisible();
    await expect(page.getByText("Published r2")).toBeVisible();
    await expect(
      page.getByRole("button", { name: "Test saved kart" }),
    ).toBeEnabled();

    await page.getByLabel("Description").fill("Unsaved local descriptor");
    await page.getByLabel("Description").blur();
    await page.getByRole("button", { name: "Kart actions" }).click();
    await expect(page.getByRole("button", { name: "Unpublish" })).toBeEnabled();

    await page.getByRole("button", { name: "Unpublish" }).click();
    await page.getByRole("button", { name: "Keep published" }).click();
    await expect(page.getByText("Published r2")).toBeVisible();

    await page.getByRole("button", { name: "Kart actions" }).click();
    await page.getByRole("button", { name: "Unpublish" }).click();
    await page.getByRole("button", { name: "Unpublish kart" }).click();
    await expect(page.getByText("Kart unpublished.")).toBeVisible();
    await expect(page.getByText("Published none")).toBeVisible();
    await expect(
      page.getByRole("button", { name: "Test saved kart" }),
    ).toBeEnabled();
  });

  test("supports testing and publishing a valid asymmetric draft", async ({
    page,
  }, testInfo) => {
    test.skip(
      testInfo.project.name !== "desktop",
      "Asymmetric runtime coverage only needs to run once.",
    );
    const document = structuredClone(
      createBalancedKartDocument(),
    ) as KartAssemblyDocument;
    const topDeck = document.primitiveInstances.find(
      ({ id }) => id === "top-deck",
    );
    if (!topDeck) throw new Error("Balanced top deck is missing.");
    topDeck.transform.position.x += 0.01;
    const topDeckMount = document.structuralAttachments.find(
      ({ child }) => child.instanceId === "top-deck",
    );
    if (!topDeckMount) {
      throw new Error("Balanced top-deck mount is missing.");
    }
    topDeckMount.parent.anchor.x += 0.01;
    expect(
      deriveKartSnapshot(document).massProperties.inertiaTensor.xy,
    ).not.toBeCloseTo(
      deriveKartSnapshot(createBalancedKartDocument()).massProperties
        .inertiaTensor.xy,
      9,
    );
    await usePublishedSandboxCourse(page);

    await page.route(kartApiPattern, async (route) => {
      if (route.request().method() === "PUT") {
        const body = route.request().postDataJSON() as {
          document: KartAssemblyDocument;
          expectedRevision: number;
        };
        await route.fulfill({
          body: JSON.stringify(
            createPersistedBalancedRevision(body.document, null, 2),
          ),
          contentType: "application/json",
          status: 200,
        });
        return;
      }
      await route.fulfill({
        body: JSON.stringify(createPersistedBalancedRevision(document)),
        contentType: "application/json",
        status: 200,
      });
    });

    await page.goto("/admin/karts/balanced-kart");
    await expect(
      page.getByRole("button", { name: "Test saved kart" }),
    ).toBeEnabled();
    await expect(
      page.getByRole("button", { name: "Publish saved draft" }),
    ).toBeEnabled();
    await page.getByLabel("Name").fill("Asymmetric private draft");
    await page.getByLabel("Name").blur();
    await expect(
      page.getByRole("button", { name: "Save draft" }),
    ).toBeEnabled();
    await expect(
      page.getByRole("button", { name: "Publish saved draft" }),
    ).toBeDisabled();
    await page.getByRole("button", { name: "Save draft" }).click();
    await expect(page.getByText("Draft revision 2 saved.")).toBeVisible();
    await expect(
      page.getByRole("button", { name: "Test saved kart" }),
    ).toBeEnabled();
    await expect(
      page.getByRole("button", { name: "Publish saved draft" }),
    ).toBeEnabled();
  });

  test("keeps the saved kart testable while asymmetric edits are unsaved", async ({
    page,
  }, testInfo) => {
    test.skip(
      testInfo.project.name !== "desktop",
      "Saved-versus-unsaved runtime coverage only needs to run once.",
    );
    const savedDocument = createBalancedKartDocument();
    await usePublishedSandboxCourse(page);
    await page.route(kartApiPattern, async (route) => {
      await route.fulfill({
        body: JSON.stringify(createPersistedBalancedRevision(savedDocument)),
        contentType: "application/json",
        status: 200,
      });
    });

    await page.goto("/admin/karts/balanced-kart");
    await page
      .getByLabel("Kart and assembly")
      .getByRole("button", { name: /top-deck/ })
      .click();
    await page
      .getByRole("group", { name: "Position (m)" })
      .getByLabel("x")
      .fill("0.01");
    await expect(
      page.getByText("Assembly is valid and deterministically derived."),
    ).toBeVisible();
    await expect(
      page.getByText(/cannot be published until PR 3.5/),
    ).toHaveCount(0);
    await expect(
      page.getByRole("button", { name: "Test saved kart" }),
    ).toBeEnabled();
    await expect(
      page.getByText(
        "Drive saved revision 1 on the current sandbox course. Unsaved changes are not included.",
      ),
    ).toBeVisible();

    await page.getByRole("button", { name: "Test saved kart" }).click();
    const canvas = page.getByTestId("solo-time-trial-canvas");
    await expect(canvas).toHaveAttribute("data-scene-ready", "true");
    await expect(canvas).toHaveAttribute(
      "data-kart-document-name",
      savedDocument.name,
    );
  });

  test("preserves issued IDs after loading the latest draft", async ({
    page,
  }, testInfo) => {
    test.skip(
      testInfo.project.name !== "desktop",
      "Issued-ID coverage only needs to run once.",
    );
    await page.route(kartApiPattern, async (route) => {
      await route.fulfill({
        body: JSON.stringify(createPersistedBalancedRevision()),
        contentType: "application/json",
        status: 200,
      });
    });

    await page.goto("/admin/karts/balanced-kart");
    await page.getByRole("button", { name: "+ Guard tube" }).click();
    await page.getByRole("button", { name: "Delete primitive" }).click();
    await page.getByRole("button", { name: "Kart actions" }).click();
    await page.getByRole("button", { name: "Load latest draft" }).click();
    await page
      .getByRole("dialog")
      .getByRole("button", { name: "Load latest draft" })
      .click();
    await page.getByRole("button", { name: "+ Guard tube" }).click();
    await expect(
      page
        .getByLabel("Kart and assembly")
        .getByRole("button", { name: /cylinder-guard-2/ }),
    ).toBeVisible();
  });

  test("loads the bundled official design as an undoable unsaved change", async ({
    page,
  }, testInfo) => {
    test.skip(
      testInfo.project.name !== "desktop",
      "Official design loading only needs to run once.",
    );
    await page.route(kartApiPattern, async (route) => {
      await route.fulfill({
        body: JSON.stringify(
          createPersistedBalancedRevision({
            ...createBalancedKartDocument(),
            name: "Stale Balanced Draft",
          }),
        ),
        contentType: "application/json",
        status: 200,
      });
    });

    await page.goto("/admin/karts/balanced-kart");
    const saveButton = page.getByRole("button", { name: "Save draft" });
    await expect(page.getByLabel("Name")).toHaveValue("Stale Balanced Draft");
    await expect(saveButton).toBeDisabled();

    await page.getByRole("button", { name: "Kart actions" }).click();
    await page.getByRole("button", { name: "Load official design" }).click();
    await expect(page.getByLabel("Name")).toHaveValue(
      createBalancedKartDocument().name,
    );
    await expect(saveButton).toBeEnabled();

    await page.getByRole("button", { name: "Undo" }).click();
    await expect(page.getByLabel("Name")).toHaveValue("Stale Balanced Draft");
    await expect(saveButton).toBeDisabled();
  });

  test("keeps local editor history mounted when sign-out fails", async ({
    page,
  }, testInfo) => {
    test.skip(
      testInfo.project.name !== "desktop",
      "Sign-out recovery coverage only needs to run once.",
    );
    let releaseSignOut!: () => void;
    const signOutGate = new Promise<void>((resolve) => {
      releaseSignOut = resolve;
    });
    await page.route(kartApiPattern, async (route) => {
      await route.fulfill({
        body: JSON.stringify(createPersistedBalancedRevision()),
        contentType: "application/json",
        status: 200,
      });
    });
    await page.route("**/api/auth/sign-out", async (route) => {
      await signOutGate;
      await route.fulfill({
        body: JSON.stringify({ error: "Sign out failed." }),
        contentType: "application/json",
        status: 500,
      });
    });

    await page.goto("/admin/karts/balanced-kart");
    await page.getByLabel("Name").fill("Unsaved local kart");
    await page.getByLabel("Name").blur();
    await page.getByRole("button", { name: "Sign out" }).click();
    await page
      .getByRole("dialog")
      .getByRole("button", { name: "Sign out" })
      .click();
    await expect(page.getByLabel("Kart assembly viewport")).toHaveAttribute(
      "aria-disabled",
      "true",
    );
    await page.keyboard.press("Control+z");
    await page.keyboard.press("Control+s");
    await expect(page.getByLabel("Name")).toHaveValue("Unsaved local kart");
    releaseSignOut();
    await expect(
      page.getByText("Sign out failed. Local changes are intact", {
        exact: false,
      }),
    ).toBeVisible();
    await expect(
      page.getByRole("heading", { name: "Unsaved local kart" }),
    ).toBeVisible();
    await expect(page.getByLabel("Name")).toHaveValue("Unsaved local kart");
  });

  test("does not dirty history when identity fields blur unchanged", async ({
    page,
  }, testInfo) => {
    test.skip(
      testInfo.project.name !== "desktop",
      "Identity history coverage only needs to run once.",
    );
    await page.route(kartApiPattern, async (route) => {
      await route.fulfill({
        body: JSON.stringify(createPersistedBalancedRevision()),
        contentType: "application/json",
        status: 200,
      });
    });

    await page.goto("/admin/karts/balanced-kart");
    await page.getByLabel("Name").focus();
    await page.getByLabel("Name").blur();
    await expect(
      page.getByRole("button", { name: "Save draft" }),
    ).toBeDisabled();
  });

  test("supports controller viewport movement, snapped transforms, and modal cancellation", async ({
    page,
  }, testInfo) => {
    test.skip(
      testInfo.project.name !== "desktop",
      "Controller editor coverage only needs to run once.",
    );
    const initialDocument = createBalancedKartDocument();
    await installStandardGamepadFixture(page);
    await page.route(kartApiPattern, async (route) => {
      await route.fulfill({
        body: JSON.stringify(
          createPersistedBalancedRevision(initialDocument),
        ),
        contentType: "application/json",
        status: 200,
      });
    });

    await page.goto("/admin/karts/balanced-kart");
    const canvas = page.getByLabel("Kart assembly viewport");
    await expect(canvas).toHaveAttribute("data-editor-status", "ready");
    await page
      .getByLabel("Kart and assembly")
      .getByRole("button", { name: /top-deck/ })
      .click();
    await page.getByRole("button", { name: "Frame selection" }).click();
    const positionInputs = page
      .getByRole("group", { name: "Position (m)" })
      .locator("input");
    const initialPosition = await positionInputs.evaluateAll((inputs) =>
      inputs.map((input) => Number((input as HTMLInputElement).value)),
    );
    await page
      .getByLabel("Kart and assembly")
      .getByRole("button", { name: /wheel-front-left/ })
      .click();

    await setStandardTestGamepad(page);
    await expect(page.getByTestId("kart-controller-status")).toBeVisible();
    await expect(page.getByTestId("kart-controller-axis")).toHaveAttribute(
      "data-axis",
      "x",
    );
    await page.getByRole("button", { name: "Exit kart editor" }).focus();
    await pressStandardGamepadButton(page, 15);
    expect(
      await page.evaluate(() => document.activeElement?.getAttribute("aria-label")),
    ).not.toBe("Exit kart editor");
    expect(
      await page.evaluate(() =>
        document.activeElement?.getAttribute("aria-disabled"),
      ),
    ).not.toBe("true");
    await expect(page.locator("main")).toHaveAttribute(
      "data-controller-navigation",
      "true",
    );
    await canvas.focus();
    await pressStandardGamepadButton(page, 0);
    await expect(canvas).toHaveAttribute("data-controller-engaged", "true");
    await expect(page.getByTestId("kart-controller-reticle")).toBeVisible();
    await pressStandardGamepadButton(page, 0);
    await expect(canvas).toHaveAttribute("data-selection-id", "top-deck");

    const cameraRevision = await canvas.getAttribute("data-camera-revision");
    const cameraPivotBeforePan = JSON.parse(
      (await canvas.getAttribute("data-camera-pivot")) ?? "[0,0,0]",
    ) as number[];
    await setStandardTestGamepad(page, { axes: [0, -0.85, 0, 0] });
    await expect(canvas).not.toHaveAttribute(
      "data-camera-revision",
      cameraRevision ?? "",
    );
    await setStandardTestGamepad(page);
    await page.waitForTimeout(50);
    const cameraPivotAfterPan = JSON.parse(
      (await canvas.getAttribute("data-camera-pivot")) ?? "[0,0,0]",
    ) as number[];
    expect(cameraPivotAfterPan[2]).toBeLessThan(cameraPivotBeforePan[2]);

    await pressStandardGamepadButton(page, 12);
    await expect(page.getByTestId("kart-controller-axis")).toHaveAttribute(
      "data-axis",
      "y",
    );
    await expect
      .poll(async () => {
        const position = await positionInputs.evaluateAll((inputs) =>
          inputs.map((input) => Number((input as HTMLInputElement).value)),
        );
        return position.some(
          (value, index) =>
            Math.abs(
              Math.abs(value - initialPosition[index]) -
                KART_EDITOR_TRANSLATE_SNAP,
            ) < 1e-9,
        );
      })
      .toBe(true);
    await pressStandardGamepadButton(page, 5);
    await expect(page.getByRole("button", { name: "Rotate" })).toHaveAttribute(
      "aria-pressed",
      "true",
    );
    await pressStandardGamepadButton(page, 4);
    await expect(
      page.getByRole("button", { name: "Move" }),
    ).toHaveAttribute("aria-pressed", "true");
    await pressStandardGamepadButton(page, 5);
    await pressStandardGamepadButton(page, 2);
    await expect(page.getByTestId("kart-controller-axis")).toHaveAttribute(
      "data-axis",
      "z",
    );
    await expect(page.getByTestId("kart-controller-status")).toContainText(
      /rotate Z/i,
    );

    await pressStandardGamepadButton(page, 1);
    await expect(canvas).toHaveAttribute("data-controller-engaged", "false");
    await page.getByRole("button", { name: "Exit kart editor" }).click();
    await expect(
      page.getByRole("heading", { name: "Discard unsaved changes?" }),
    ).toBeVisible();
    await setStandardTestGamepad(page);
    await page.waitForTimeout(50);
    await pressStandardGamepadButton(page, 1);
    await expect(
      page.getByRole("heading", { name: "Discard unsaved changes?" }),
    ).toHaveCount(0);
    await expect(canvas).toBeVisible();
    await expect(
      page.getByRole("button", { name: "Exit kart editor" }),
    ).toBeFocused();
    await page.getByRole("button", { name: "Exit kart editor" }).click();
    await expect(
      page.getByRole("heading", { name: "Discard unsaved changes?" }),
    ).toBeVisible();
    await page.keyboard.press("Escape");
    await expect(
      page.getByRole("heading", { name: "Discard unsaved changes?" }),
    ).toHaveCount(0);
    await expect(
      page.getByRole("button", { name: "Exit kart editor" }),
    ).toBeFocused();
    await disconnectStandardTestGamepad(page);
    await expect(page.getByTestId("kart-controller-status")).toHaveCount(0);
  });
});

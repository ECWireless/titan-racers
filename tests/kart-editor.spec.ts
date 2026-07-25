import { expect, test, type Locator, type Page } from "@playwright/test";

import { ROUGH_COURSE_DOCUMENT } from "../src/game/course/course-document";
import { createBalancedKartDocument } from "../src/game/kart/balanced-kart-document";
import { KART_EDITOR_TRANSLATE_SNAP } from "../src/game/editor/kart-editor-scene";
import type { KartAssemblyDocument } from "../src/game/kart/kart-assembly-document";
import { getApprovedKartComponent } from "../src/game/kart/kart-component-registry";
import {
  deriveKartSnapshot,
  type ResolvedKartSnapshot,
} from "../src/game/kart/kart-derivation";
import { hasRuntimeCompatibleInertia } from "../src/game/kart/kart-runtime-compatibility";
import type { KartPublicationEvent } from "../src/game/kart/kart-publication";

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
        bodywork: MaterialColor;
        component: MaterialColor;
        suspension: MaterialColor;
        suspensionCastsShadows: boolean | null;
        suspensionCoil: MaterialColor;
        suspensionCoilCastsShadows: boolean | null;
        suspensionCoilEnd: MaterialColor;
        suspensionCoilReceivesShadows: boolean | null;
        suspensionCoilSegmentCount: number;
        suspensionCoilWireDiameter: number | null;
        suspensionDamperDiameter: number | null;
        suspensionReceivesShadows: boolean | null;
        wheel: MaterialColor;
        wheelHubPosition: MaterialColor;
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
    const toolbarBox = await page
      .getByTestId("kart-editor-toolbar")
      .boundingBox();
    expect(toolbarBox?.x).toBeCloseTo(0, 0);
    expect(toolbarBox?.width).toBeCloseTo(page.viewportSize()?.width ?? 0, 0);
    await page.getByRole("button", { name: "Camera controls" }).click();
    await expect(
      page.getByRole("region", { name: "Camera controls" }),
    ).toBeVisible();
    await page.getByRole("button", { name: "Close camera controls" }).click();
    await expect(
      page.getByRole("button", { name: "Test saved kart" }),
    ).toBeEnabled();
    await expect(
      page.getByText(
        "Drive saved revision 1 on the current sandbox course. Unsaved changes are not included.",
      ),
    ).toBeVisible();
    const viewport = page.getByLabel("Kart assembly viewport");
    await expect(viewport).toHaveAttribute("data-editor-status", "ready");
    await expect(viewport).toHaveAttribute("data-selection-id", "");
    const scaleButton = page.getByRole("button", { name: "Scale" });
    await expect(scaleButton).toBeDisabled();
    await expect(scaleButton).toHaveAttribute(
      "title",
      "Select a box primitive to scale",
    );
    await expect(scaleButton).toHaveAttribute(
      "aria-describedby",
      "kart-scale-unavailable-reason",
    );
    await expect(scaleButton).toHaveCSS("cursor", "not-allowed");
    await scaleButton.focus();
    await expect(scaleButton).toBeFocused();
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
        page.getByRole("button", { name: "Close inspector" }),
      ).toBeFocused();
      await expect(
        page.getByText("Assembly is valid and deterministically derived."),
      ).toBeVisible();
      await page.keyboard.press("Escape");
      await expect(inspectorButton).toBeFocused();
      await expect(page.getByTestId("kart-editor-header")).not.toHaveAttribute(
        "inert",
        "",
      );

      const outlineButton = page.getByRole("button", {
        name: "Kart & parts",
      });
      await outlineButton.click();
      await expect(
        page.getByRole("button", { name: "Close kart and assembly" }),
      ).toBeFocused();
      await page.keyboard.press("Escape");
      await expect(outlineButton).toBeFocused();

      expect(
        await page.evaluate(
          () =>
            document.documentElement.scrollWidth <=
            document.documentElement.clientWidth,
        ),
      ).toBe(true);
      const cameraRevisionBeforeGesture = await viewport.getAttribute(
        "data-camera-revision",
      );
      await viewport.dispatchEvent("pointerdown", {
        button: 0,
        clientX: 120,
        clientY: 120,
        pointerId: 1,
        pointerType: "touch",
      });
      await viewport.dispatchEvent("pointermove", {
        button: 0,
        clientX: 150,
        clientY: 135,
        pointerId: 1,
        pointerType: "touch",
      });
      await viewport.dispatchEvent("pointercancel", {
        button: 0,
        clientX: 150,
        clientY: 135,
        pointerId: 1,
        pointerType: "touch",
      });
      await expect(viewport).toHaveAttribute("data-editor-status", "ready");
      await expect(viewport).not.toHaveAttribute(
        "data-camera-revision",
        cameraRevisionBeforeGesture ?? "",
      );

      await inspectorButton.click();
      await expect(
        page.getByRole("dialog", { name: "Inspector" }),
      ).toBeVisible();
      await page.setViewportSize({ height: 800, width: 1280 });
      await expect(page.getByRole("dialog", { name: "Inspector" })).toHaveCount(
        0,
      );
      await expect(
        page.getByTestId("kart-editor-viewport-region"),
      ).not.toHaveAttribute("inert", "");
    }

    if (testInfo.project.name === "desktop") {
      await page.getByRole("button", { name: "Test saved kart" }).click();
      await expect(page.getByLabel("Kart assembly viewport")).toHaveCount(0);
      await expect(page.getByTestId("solo-time-trial-canvas")).toHaveAttribute(
        "data-scene-ready",
        "true",
      );
      await expect(page.getByTestId("solo-time-trial-canvas")).toHaveAttribute(
        "data-course-document-name",
        sandboxCourse.name,
      );
      await expect(
        page.getByText("Saved r1 on sandbox course · Balanced Kart"),
      ).toBeVisible();
      await page.keyboard.press("Delete");
      await page.waitForTimeout(100);
      expect(telemetryRequestCount).toBe(0);
      await page.keyboard.press("Escape");
      await page.getByRole("button", { name: "Exit", exact: true }).click();
      await expect(page.getByTestId("solo-time-trial-canvas")).toHaveCount(0);
      await expect(viewport).toHaveAttribute("data-editor-status", "ready");
      await expect(
        page.getByRole("button", { name: "Test saved kart" }),
      ).toBeEnabled();
      await expect(
        page.getByRole("button", { name: "Test saved kart" }),
      ).toBeFocused();

      await expect(page.getByLabel("Description")).toBeVisible();
      await expect(page.getByLabel("Primary kart color")).toHaveCount(0);
      await expect(page.getByLabel("Accent kart color")).toHaveCount(0);
      await expect(
        page.getByText("Assembly is valid and deterministically derived."),
      ).toBeVisible();
      const desktopLayout = await page.evaluate(() => {
        const main = document.querySelector("main");
        const panels = [
          document.querySelector('[aria-label="Kart and assembly"]'),
          document.querySelector('[aria-label="Inspector"]'),
        ];
        return {
          mainBottom: main?.getBoundingClientRect().bottom ?? 0,
          mainHeight: main?.getBoundingClientRect().height ?? 0,
          panelOverflow: panels.map((panel) =>
            panel ? getComputedStyle(panel).overflowY : "",
          ),
          viewportHeight: window.innerHeight,
        };
      });
      expect(desktopLayout.mainHeight).toBeCloseTo(
        desktopLayout.viewportHeight,
        0,
      );
      expect(desktopLayout.mainBottom).toBeLessThanOrEqual(
        desktopLayout.viewportHeight + 1,
      );
      expect(desktopLayout.panelOverflow).toEqual(["auto", "auto"]);

      const addConstructionSection = page.getByRole("button", {
        name: "Add construction",
        exact: true,
      });
      await expect(addConstructionSection).toHaveAttribute(
        "aria-expanded",
        "true",
      );
      await addConstructionSection.click();
      await expect(
        page.getByRole("button", { name: "+ Structure plate" }),
      ).toBeHidden();
      await addConstructionSection.click();

      await page.getByRole("button", { name: "+ Structure plate" }).click();
      await expect(viewport).toHaveAttribute(
        "data-selection-validity",
        "invalid",
      );
      await scaleButton.click();
      await expect(scaleButton).toHaveAttribute("aria-pressed", "true");
      await page.getByRole("button", { name: "Undo" }).click();
      await expect(viewport).toHaveAttribute("data-selection-id", "");
      await expect(page.getByRole("button", { name: "Move" })).toHaveAttribute(
        "aria-pressed",
        "true",
      );

      await page
        .getByLabel("Kart and assembly")
        .getByRole("button", { name: /motor-main/ })
        .click();
      await expect(page.getByLabel("Selected component color")).toHaveCSS(
        "cursor",
        "pointer",
      );
      await expect(viewport).toHaveAttribute(
        "data-selection-validity",
        "valid",
      );
      await expect(page.getByRole("button", { name: "Scale" })).toBeDisabled();
      await expect(page.getByRole("button", { name: "Scale" })).toHaveAttribute(
        "title",
        "Approved components have fixed dimensions",
      );
      const inspectorSection = page
        .getByLabel("Inspector")
        .getByRole("button", { name: "Inspector", exact: true });
      await expect(inspectorSection).toHaveAttribute("aria-expanded", "true");
      await expect(page.getByLabel("Choose variant")).toHaveValue(
        "motor.brushless-standard",
      );
      await expect(
        page.getByText("Physical attributes", { exact: true }),
      ).toBeVisible();
      await expect(
        page.getByLabel("Inspector").getByText("1500 rpm/V", { exact: true }),
      ).toBeVisible();
      await inspectorSection.click();
      await expect(page.getByLabel("Choose variant")).toBeHidden();
      await inspectorSection.click();
      await expect(page.getByLabel("Choose variant")).toBeVisible();
      for (const title of [
        "Derived construction",
        "Derived runtime behavior",
        "Practical stats",
      ]) {
        await expect(
          page.getByRole("button", { name: title, exact: true }),
        ).toHaveAttribute("aria-expanded", "true");
      }
      await expect(
        page.getByText(
          "Normalized comparisons derived from acceleration, steering curvature, no-load road speed, and static stability.",
        ),
      ).toBeVisible();
      const structuralParent = page.getByLabel("Structural parent");
      const variantBox = await page.getByLabel("Choose variant").boundingBox();
      const physicalAttributesBox = await page
        .getByText("Physical attributes", { exact: true })
        .boundingBox();
      const structuralParentBox = await structuralParent.boundingBox();
      expect(variantBox?.y ?? Infinity).toBeLessThan(
        structuralParentBox?.y ?? -Infinity,
      );
      expect(physicalAttributesBox?.y ?? Infinity).toBeLessThan(
        structuralParentBox?.y ?? -Infinity,
      );
      await expect(page.getByRole("button", { name: /^\+5mm / })).toHaveCount(
        0,
      );
      await expect(structuralParent).toHaveValue("chassis-plate");
      await expect(structuralParent).toBeDisabled();
      const detachButton = page.getByRole("button", {
        name: "Detach from chassis-plate",
      });
      await expect(detachButton).toBeEnabled();
      await expect(detachButton.locator("svg")).toBeVisible();
      await expect(detachButton).toHaveAttribute(
        "title",
        "Detach from chassis-plate",
      );
      const parentBox = await structuralParent.boundingBox();
      const positionBox = await page
        .getByRole("group", { name: "Position (m)" })
        .boundingBox();
      expect(parentBox?.y ?? Infinity).toBeLessThan(
        positionBox?.y ?? -Infinity,
      );
      await expect(
        page.getByLabel("Keep mirrored component aligned"),
      ).toHaveCount(0);
      const positionEditor = page.getByRole("group", { name: "Position (m)" });
      await positionEditor.getByLabel("x").fill("0.005");
      await expect(
        page.getByText("Outside attachment range", { exact: true }),
      ).toHaveCount(0);
      await expect(
        page.getByText("Assembly is valid and deterministically derived."),
      ).toBeVisible();
      await positionEditor.getByLabel("x").fill("1");
      await expect(viewport).toHaveAttribute(
        "data-selection-validity",
        "invalid",
      );
      await expect(
        page.getByText("Outside attachment range", { exact: true }),
      ).toBeVisible();
      await expect(
        page.getByText("Structural Attachments", { exact: true }),
      ).toBeVisible();
      const detachedAttachButton = page.getByRole("button", {
        name: "Attach to chassis-plate",
      });
      await expect(detachedAttachButton).toBeDisabled();
      await expect(detachedAttachButton).toHaveAttribute(
        "title",
        "Move the component within the target parent’s attachment range",
      );
      await positionEditor.getByLabel("x").fill("0.005");
      await expect(viewport).toHaveAttribute(
        "data-selection-validity",
        "attachable",
      );
      await expect(
        page.getByText("Outside attachment range", { exact: true }),
      ).toHaveCount(0);
      await expect(
        page.getByText("Ready to attach", { exact: true }),
      ).toBeVisible();
      await detachedAttachButton.click();
      await expect(viewport).toHaveAttribute(
        "data-selection-validity",
        "valid",
      );
      await expect(
        page.getByText("Assembly is valid and deterministically derived."),
      ).toBeVisible();
      await page
        .getByRole("button", { name: "Detach from chassis-plate" })
        .click();
      await expect(structuralParent).toBeEnabled();
      await structuralParent.selectOption("battery-main");
      const battery = createBalancedKartDocument().componentInstances.find(
        ({ id }) => id === "battery-main",
      );
      if (!battery) throw new Error("Balanced battery is missing.");
      for (const axis of ["x", "y", "z"] as const) {
        await positionEditor
          .getByLabel(axis)
          .fill(String(battery.transform.position[axis]));
      }
      await expect(structuralParent).toHaveValue("battery-main");
      await expect(viewport).toHaveAttribute(
        "data-selection-validity",
        "attachable",
      );
      await page
        .getByRole("button", { name: "Attach to battery-main" })
        .click();
      await expect(
        page.getByText("Assembly is valid and deterministically derived."),
      ).toBeVisible();

      await page
        .getByLabel("Kart and assembly")
        .getByRole("button", { name: /upper-housing/ })
        .click();
      const bodywork = createBalancedKartDocument().primitiveInstances.find(
        ({ id }) => id === "upper-housing",
      );
      const bumper = createBalancedKartDocument().primitiveInstances.find(
        ({ id }) => id === "rear-bumper",
      );
      if (
        !bodywork ||
        bodywork.shape !== "box" ||
        !bumper ||
        bumper.shape !== "cylinder"
      ) {
        throw new Error("Balanced Kart construction geometry is unavailable.");
      }
      const bodyworkPosition = {
        x: bumper.transform.position.x,
        y: bumper.transform.position.y,
        z: bumper.transform.position.z + bumper.radius + bodywork.size.z / 2,
      };
      for (const axis of ["x", "y", "z"] as const) {
        await positionEditor
          .getByLabel(axis)
          .fill(String(bodyworkPosition[axis]));
      }
      await structuralParent.selectOption(bumper.id);
      await expect(viewport).toHaveAttribute(
        "data-selection-validity",
        "attachable",
      );
      await expect(
        page.getByText("Outside attachment range", { exact: true }),
      ).toHaveCount(0);
      const bumperAttachButton = page.getByRole("button", {
        name: `Attach to ${bumper.id}`,
      });
      await expect(bumperAttachButton).toBeEnabled();
      await positionEditor
        .getByLabel("x")
        .fill(String(bodyworkPosition.x + 0.001));
      await expect(structuralParent).toHaveValue(bumper.id);
      await expect(viewport).toHaveAttribute(
        "data-selection-validity",
        "attachable",
      );
      await bumperAttachButton.click();
      await expect(viewport).toHaveAttribute(
        "data-selection-validity",
        "valid",
      );
      await expect(
        page.getByText("Assembly is valid and deterministically derived."),
      ).toBeVisible();

      await page
        .getByLabel("Kart and assembly")
        .getByRole("button", { name: /front-bumper/ })
        .click();
      await expect(page.getByRole("button", { name: "Scale" })).toBeDisabled();
      await expect(page.getByRole("button", { name: "Scale" })).toHaveAttribute(
        "title",
        "Edit cylinder radius and height in the Inspector",
      );
      await page
        .getByLabel("Kart and assembly")
        .getByRole("button", { name: /wheel-front-left/ })
        .click();
      await expect(
        page.getByLabel("Keep mirrored component aligned"),
      ).toBeChecked();
      await expect(
        page.getByText("Mirrored component", { exact: true }),
      ).toBeVisible();
      await expect(
        page
          .getByLabel("Inspector")
          .getByText("wheel-front-right", { exact: true }),
      ).toBeVisible();
      await expect(viewport).toHaveAttribute(
        "data-mirror-counterpart-ids",
        "wheel-front-right",
      );
      const mirrorButton = page.getByRole("button", {
        name: "Mirror across center plane",
      });
      await expect(mirrorButton).toBeDisabled();
      await expect(mirrorButton.locator("svg")).toBeVisible();
      await expect(mirrorButton).toHaveAttribute(
        "title",
        "This component already has a mirrored counterpart",
      );
      await page
        .getByLabel("Kart and assembly")
        .getByRole("button", { name: /suspension-front-left/ })
        .click();
      await expect(page.getByLabel("Choose variant")).toHaveValue(
        "suspension.firm-short",
      );
      await expect(
        page.getByText("Focused suspension mounting", { exact: true }),
      ).toHaveCount(0);
      await expect(
        page
          .getByLabel("Structural parent")
          .locator('option[value="wheel-front-left"]'),
      ).toHaveCount(0);
      await expect(
        page
          .getByLabel("Structural parent")
          .locator('option[value="suspension-front-right"]'),
      ).toHaveCount(0);
      await page
        .getByLabel("Kart and assembly")
        .getByRole("button", { name: /upper-housing/ })
        .click();
      await expect(page.getByRole("button", { name: "Scale" })).toBeEnabled();
      await expect(
        page.getByText("Physical attributes", { exact: true }),
      ).toBeVisible();
      await expect(
        page
          .getByLabel("Inspector")
          .getByText("Polycarbonate shell", { exact: true }),
      ).toBeVisible();
      await expect(
        page.getByLabel("Inspector").getByText("1200 kg/m³", { exact: true }),
      ).toBeVisible();
      const deleteButton = page.getByRole("button", {
        name: "Delete primitive",
      });
      await expect(deleteButton.locator("svg")).toBeVisible();
      await expect(deleteButton).toHaveAttribute(
        "title",
        "Delete this primitive (Delete)",
      );
      const cameraRevisionBeforePartFrame = await viewport.getAttribute(
        "data-camera-revision",
      );
      await page.keyboard.press("f");
      await expect(viewport).not.toHaveAttribute(
        "data-camera-revision",
        cameraRevisionBeforePartFrame ?? "",
      );
      const partPivot = JSON.parse(
        (await viewport.getAttribute("data-camera-pivot")) ?? "[]",
      ) as number[];
      const upperHousing = createBalancedKartDocument().primitiveInstances.find(
        ({ id }) => id === "upper-housing",
      );
      if (!upperHousing) throw new Error("Balanced upper housing is missing.");
      expect(partPivot[0]).toBeCloseTo(bodyworkPosition.x + 0.001, 5);
      expect(partPivot[1]).toBeCloseTo(bodyworkPosition.y, 5);
      expect(partPivot[2]).toBeCloseTo(bodyworkPosition.z, 5);

      await viewport.click({ position: { x: 8, y: 8 } });
      await expect(viewport).toHaveAttribute("data-selection-id", "");
      await expect(
        page.getByText(
          "Select a component or primitive in the outline or viewport.",
        ),
      ).toBeVisible();
      const cameraRevisionBeforeKartFrame = await viewport.getAttribute(
        "data-camera-revision",
      );
      await page.getByRole("button", { name: "Frame selection" }).click();
      await expect(viewport).not.toHaveAttribute(
        "data-camera-revision",
        cameraRevisionBeforeKartFrame ?? "",
      );
      const kartPivot = JSON.parse(
        (await viewport.getAttribute("data-camera-pivot")) ?? "[]",
      ) as number[];
      const documentBoundsCenter = JSON.parse(
        (await viewport.getAttribute("data-document-bounds-center")) ?? "[]",
      ) as number[];
      expect(documentBoundsCenter).toHaveLength(3);
      documentBoundsCenter.forEach((coordinate, axis) => {
        expect(kartPivot[axis]).toBeCloseTo(coordinate, 5);
      });
    }
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
    authoredDraft.visualIdentity.accentColor = "#ffffff";
    authoredDraft.primitiveInstances.forEach((instance) => {
      if (instance.role === "bodywork") instance.visualColor = "#1188cc";
    });
    authoredDraft.componentInstances.forEach((instance) => {
      const definition = getApprovedKartComponent(instance.definition);
      if (definition?.category === "suspension") {
        instance.visualColor = "#aa44dd";
      } else if (definition?.category === "wheel-tire") {
        instance.visualColor = "#2244ff";
      } else {
        instance.visualColor = "#cc7722";
      }
    });
    const publishedKart = createBalancedKartDocument();
    publishedKart.name = "Published Neon Kart";
    publishedKart.visualIdentity.primaryColor = "#00ff00";
    publishedKart.visualIdentity.accentColor = "#ff00ff";
    publishedKart.primitiveInstances.forEach((instance) => {
      if (instance.role === "bodywork") instance.visualColor = "#22dd88";
    });
    publishedKart.componentInstances.forEach((instance) => {
      const definition = getApprovedKartComponent(instance.definition);
      if (definition?.category === "suspension") {
        instance.visualColor = "#dd22ee";
      } else if (definition?.category === "wheel-tire") {
        instance.visualColor = "#3366ff";
      } else {
        instance.visualColor = "#ee5533";
      }
    });
    const savedRevision = createPersistedBalancedRevision(
      authoredDraft,
      createKartPublication(1),
      2,
    );
    const savedSnapshot = structuredClone(
      savedRevision.resolvedSnapshot,
    ) as unknown as ResolvedKartSnapshot;
    savedSnapshot.physicalProfile.drivetrain.maximumDriveForce = 12.345;
    savedSnapshot.physicalProfile.drivetrain.noLoadSpeed = 9.876;
    const sandboxCourse = await usePublishedSandboxCourse(page);
    await usePublishedKart(page, publishedKart, 1);
    await page.route("**/api/telemetry/gameplay-runs", async (route) => {
      telemetryRequestCount += 1;
      await route.fulfill({ body: "{}", status: 202 });
    });
    await page.route(kartApiPattern, async (route) => {
      await route.fulfill({
        body: JSON.stringify(
          { ...savedRevision, resolvedSnapshot: savedSnapshot },
        ),
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
    await expect(canvas).toHaveAttribute("data-kart-accent-color", "#ffffff");
    await expect(canvas).toHaveAttribute(
      "data-kart-component-color",
      "#cc7722",
    );
    await expect(canvas).toHaveAttribute(
      "data-kart-component-count",
      String(authoredDraft.componentInstances.length),
    );
    await expect(canvas).toHaveAttribute(
      "data-kart-primitive-count",
      String(authoredDraft.primitiveInstances.length),
    );
    await expect(canvas).toHaveAttribute(
      "data-kart-suspension-color",
      "#aa44dd",
    );
    await expect(canvas).toHaveAttribute("data-kart-wheel-color", "#2244ff");
    await expect(canvas).toHaveAttribute("data-collision-fixtures", "false");
    const runtimePhysics = await getKartRuntimePhysics(canvas);
    expect(runtimePhysics.developmentValues.maximumDriveForce).toBe(12.345);
    expect(runtimePhysics.maxForwardSpeed).toBe(9.88);
    const visualColors = await getKartVisualColors(canvas);
    expectMaterialColor(visualColors.bodywork, "#1188cc");
    expectMaterialColor(visualColors.component, "#cc7722");
    expectMaterialColor(visualColors.suspension, "#aa44dd");
    expect(visualColors.suspensionCastsShadows).toBe(false);
    expect(visualColors.suspensionDamperDiameter).toBeCloseTo(0.018, 5);
    expect(visualColors.suspensionReceivesShadows).toBe(false);
    expectMaterialColor(visualColors.suspensionCoil, "#aa44dd");
    expect(visualColors.suspensionCoilCastsShadows).toBe(false);
    expect(visualColors.suspensionCoilReceivesShadows).toBe(false);
    expect(visualColors.suspensionCoilSegmentCount).toBe(32);
    expect(visualColors.suspensionCoilWireDiameter).toBeCloseTo(0.005, 5);
    expectMaterialColor(visualColors.wheel, "#2244ff");
    const wheelStation =
      deriveKartSnapshot(authoredDraft).geometry.wheelStations[0];
    expect(wheelStation).toBeDefined();
    expect(visualColors.suspensionCoilEnd).not.toBeNull();
    expect(visualColors.wheelHubPosition).not.toBeNull();
    expect(visualColors.suspensionCoilEnd?.x).toBeCloseTo(
      wheelStation?.suspension.springArmAnchor.x ?? 0,
      5,
    );
    expect(visualColors.suspensionCoilEnd?.z).toBeCloseTo(
      wheelStation?.suspension.springArmAnchor.z ?? 0,
      5,
    );
    const wheelDisplacement =
      (visualColors.wheelHubPosition?.y ?? 0) -
      (wheelStation?.suspension.hubAnchor.y ?? 0);
    const springDisplacement =
      (visualColors.suspensionCoilEnd?.y ?? 0) -
      (wheelStation?.suspension.springArmAnchor.y ?? 0);
    expect(springDisplacement).toBeCloseTo(
      wheelDisplacement * (wheelStation?.suspension.motionRatio ?? 0),
      5,
    );
    await expect(canvas).toHaveAccessibleName(
      "Solo Time Trial race: Saved r2 on sandbox course · Unpublished Blue Draft",
    );
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

    await page.goto("/admin/karts/balanced-kart");
    await expect(
      page.getByRole("button", { name: "Test saved kart" }),
    ).toBeEnabled();
    const name = page.getByLabel("Name");
    await name.fill("Balanced Kart QA");
    await name.blur();

    page.once("dialog", (dialog) => void dialog.dismiss());
    await page.getByRole("button", { name: "Exit" }).click();
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

    page.once("dialog", (dialog) => void dialog.dismiss());
    await page.getByRole("button", { name: "Unpublish" }).click();
    await expect(page.getByText("Published r2")).toBeVisible();

    await page.getByRole("button", { name: "Kart actions" }).click();
    page.once("dialog", (dialog) => void dialog.accept());
    await page.getByRole("button", { name: "Unpublish" }).click();
    await expect(page.getByText("Kart unpublished.")).toBeVisible();
    await expect(page.getByText("Published none")).toBeVisible();
    await expect(
      page.getByRole("button", { name: "Test saved kart" }),
    ).toBeEnabled();
  });

  test("saves a valid asymmetric draft but keeps publication gated", async ({
    page,
  }, testInfo) => {
    test.skip(
      testInfo.project.name !== "desktop",
      "Draft compatibility coverage only needs to run once.",
    );
    const document = structuredClone(
      createBalancedKartDocument(),
    ) as KartAssemblyDocument;
    const upperHousing = document.primitiveInstances.find(
      ({ id }) => id === "upper-housing",
    );
    if (!upperHousing) throw new Error("Balanced upper housing is missing.");
    upperHousing.transform.position.x += 0.01;
    const upperHousingMount = document.structuralAttachments.find(
      ({ child }) => child.instanceId === "upper-housing",
    );
    if (!upperHousingMount) {
      throw new Error("Balanced upper-housing mount is missing.");
    }
    upperHousingMount.parent.anchor.x += 0.01;
    expect(hasRuntimeCompatibleInertia(deriveKartSnapshot(document))).toBe(
      false,
    );

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
    ).toBeDisabled();
    await expect(
      page.getByText(
        "Saved revision 1 cannot be tested until PR 3.4 adds principal-axis integration.",
      ),
    ).toBeVisible();
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
    ).toBeDisabled();
    await expect(
      page.getByText(
        "Saved revision 2 cannot be tested until PR 3.4 adds principal-axis integration.",
      ),
    ).toBeVisible();
  });

  test("keeps a compatible saved kart testable while unsaved edits are incompatible", async ({
    page,
  }, testInfo) => {
    test.skip(
      testInfo.project.name !== "desktop",
      "Saved-versus-unsaved compatibility coverage only needs to run once.",
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
      .getByRole("button", { name: /upper-housing/ })
      .click();
    await page
      .getByRole("group", { name: "Position (m)" })
      .getByLabel("x")
      .fill("0.01");
    await expect(
      page.getByText("Assembly is valid and deterministically derived."),
    ).toBeVisible();
    await expect(
      page.getByText(
        /This asymmetric mass layout can be saved as a private draft, but it cannot be published/,
      ),
    ).toBeVisible();
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
    page.once("dialog", (dialog) => void dialog.accept());
    await page.getByRole("button", { name: "Kart actions" }).click();
    await page.getByRole("button", { name: "Load latest draft" }).click();
    await page.getByRole("button", { name: "+ Guard tube" }).click();
    await expect(
      page
        .getByLabel("Kart and assembly")
        .getByRole("button", { name: /cylinder-guard-2/ }),
    ).toBeVisible();
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
    page.once("dialog", (dialog) => void dialog.accept());
    await page.getByRole("button", { name: "Sign out" }).click();
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
});

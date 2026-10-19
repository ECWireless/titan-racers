import { expect, type Locator, type Page, test } from "@playwright/test";

import { ROUGH_COURSE_DOCUMENT } from "../src/game/course/course-document";
import { deriveKartCcdConfiguration } from "../src/game/collision/kart-collision-model";
import { createKartDevelopmentValues } from "../src/game/kart/kart-development-values";
import { createBalancedKartDocument } from "../src/game/kart/balanced-kart-document";
import { createHandlingKartDocument } from "../src/game/kart/handling-kart-document";
import { createSpeedKartDocument } from "../src/game/kart/speed-kart-document";
import {
  deriveKartSnapshot,
  type ResolvedKartSnapshot,
} from "../src/game/kart/kart-derivation";
import {
  REFERENCE_KART_MASS_SCALE,
  scaleReferenceKartLength,
} from "../src/game/kart/kart-reference-construction";
import type {
  KartDebugState,
  RaceDebugState,
} from "../src/game/testing/scene-test-adapter";
import { DEFAULT_FIXED_STEP_SECONDS } from "../src/game/runtime/fixed-step-clock";

import {
  PHYSICS_GROUP,
  PHYSICS_MASK,
} from "../src/game/physics/collision-groups";

const BALANCED_KART_DOCUMENT = createBalancedKartDocument();
const BALANCED_KART_SNAPSHOT = deriveKartSnapshot(BALANCED_KART_DOCUMENT);
const HANDLING_KART_DOCUMENT = createHandlingKartDocument();
const HANDLING_KART_SNAPSHOT = deriveKartSnapshot(HANDLING_KART_DOCUMENT);
const SPEED_KART_DOCUMENT = createSpeedKartDocument();
const SPEED_KART_SNAPSHOT = deriveKartSnapshot(SPEED_KART_DOCUMENT);
const BALANCED_KART_DEVELOPMENT_VALUES = createKartDevelopmentValues(
  BALANCED_KART_SNAPSHOT.physicalProfile,
);
const BALANCED_KART_CONTACT_PLANE_Y =
  BALANCED_KART_SNAPSHOT.geometry.wheelStations.reduce(
    (sum, wheel) => sum + wheel.position.y - wheel.radius,
    0,
  ) / BALANCED_KART_SNAPSHOT.geometry.wheelStations.length;
const BALANCED_KART_UPRIGHT_ROOT_HEIGHT =
  BALANCED_KART_SNAPSHOT.massProperties.centerOfMass.y -
  BALANCED_KART_CONTACT_PLANE_Y;
const BALANCED_KART_CCD_CONFIGURATION = deriveKartCcdConfiguration({
  smallestRelevantCrossSection:
    BALANCED_KART_SNAPSHOT.geometry.smallestRelevantCrossSection,
});
// The kart's leading collision face, including the derived wheel guard.
function getBalancedCollisionHalfExtent(axis: "x" | "z") {
  const { wheelGuard } = BALANCED_KART_SNAPSHOT.geometry;
  return Math.max(
    Math.abs(wheelGuard.transform.position[axis]) + wheelGuard.size[axis] / 2,
    ...BALANCED_KART_SNAPSHOT.geometry.collisionCompound.map((primitive) => {
      const geometryHalfExtent =
        primitive.shape === "box"
          ? primitive.size[axis] / 2
          : primitive.axis === axis
            ? primitive.height / 2
            : primitive.radius;
      return Math.abs(primitive.transform.position[axis]) + geometryHalfExtent;
    }),
  );
}
const BALANCED_KART_COLLISION_HALF_EXTENT_Z =
  getBalancedCollisionHalfExtent("z");
const CCD_THIN_WALL_NEAR_FACE_X = -32.95;
const CCD_THIN_WALL_FAR_FACE_X = -33.05;
const CCD_THIN_WALL_APPROACH_SPEED = 20.4;
const CCD_THIN_WALL_APPROACH_CENTER_X =
  CCD_THIN_WALL_NEAR_FACE_X + BALANCED_KART_COLLISION_HALF_EXTENT_Z;
// Discrete contacts may overlap the wall by up to one step of travel; see
// PR 4.2.3 for leading-edge sweeps.
const CCD_THIN_WALL_MAXIMUM_CONTACT_PENETRATION =
  CCD_THIN_WALL_APPROACH_SPEED * DEFAULT_FIXED_STEP_SECONDS;
// Keep the established runtime-fixture coordinate name while sourcing it from
// the authored default rather than the removed transitional construction.
const REFERENCE_KART_UPRIGHT_ROOT_HEIGHT = BALANCED_KART_UPRIGHT_ROOT_HEIGHT;

/** Degrees between an orientation and a pure yaw about +Y. */
function angleFromYawDegrees(
  rotation: { w: number; x: number; y: number; z: number },
  yawDegrees: number,
) {
  const half = (yawDegrees * Math.PI) / 360;
  const [c, s] = [Math.cos(half), Math.sin(half)];
  // conjugate(yaw) * rotation
  const w = c * rotation.w + s * rotation.y;
  const x = c * rotation.x - s * rotation.z;
  const y = c * rotation.y - s * rotation.w;
  const z = c * rotation.z + s * rotation.x;
  return (2 * Math.atan2(Math.hypot(x, y, z), Math.abs(w)) * 180) / Math.PI;
}

async function waitForSceneReady(canvas: Locator) {
  await expect(canvas).toHaveAttribute("data-scene-ready", "true");
}

async function setStandardTestGamepad(
  page: Page,
  {
    axes = [0, 0, 0, 0],
    buttons: buttonValues = {},
  }: {
    axes?: number[];
    buttons?: Record<number, number>;
  } = {},
) {
  await page.evaluate(
    ({ axes: nextAxes, buttonValues: nextButtonValues }) => {
      const buttons = Array.from({ length: 17 }, (_, index) => {
        const value = nextButtonValues[index] ?? 0;
        return { pressed: value > 0, touched: value > 0, value };
      });
      const testWindow = window as typeof window & {
        __TR_GAMEPADS__?: Gamepad[];
      };
      testWindow.__TR_GAMEPADS__ = [
        {
          axes: nextAxes,
          buttons,
          connected: true,
          id: "Automated standard controller",
          index: 0,
          mapping: "standard",
          timestamp: performance.now(),
        } as unknown as Gamepad,
      ];
    },
    { axes, buttonValues },
  );
}

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

async function disconnectStandardTestGamepad(page: Page) {
  await page.evaluate(() => {
    const testWindow = window as typeof window & {
      __TR_GAMEPADS__?: Gamepad[];
    };
    testWindow.__TR_GAMEPADS__ = [];
    window.dispatchEvent(new Event("gamepaddisconnected"));
  });
}

async function getKartScreenPoint(canvas: Locator) {
  await waitForSceneReady(canvas);
  return canvas.evaluate(
    (element) =>
      new Promise<{ x: number; y: number } | null>((resolve) => {
        element.dispatchEvent(
          new CustomEvent("getKartScreenPoint", {
            detail: { respond: resolve },
          }),
        );
      }),
  );
}

async function getCollisionDebugState(canvas: Locator) {
  await waitForSceneReady(canvas);

  return canvas.evaluate(
    (element) =>
      new Promise<{
        ambientLightB: number;
        ambientLightG: number;
        ambientLightR: number;
        barrelCollisionAxis: number | null;
        barrelCollisionHeight: number | null;
        barrelCollisionRadius: number | null;
        barrelMaterialMapped: boolean;
        barrelPhysicsFriction: number | null;
        barrelPhysicsGroup: number | null;
        barrelPhysicsMask: number | null;
        barrelPhysicsRestitution: number | null;
        courseEntityCount: number;
        directionalLightCount: number;
        fillLightCastsShadows: boolean | null;
        groundCollisionHalfExtentX: number | null;
        groundCollisionOffsetY: number | null;
        groundCollisionShape: string | null;
        groundIsDrivable: boolean;
        keyLightCastsShadows: boolean | null;
        keyLightIntensity: number | null;
        keyLightRotationX: number | null;
        keyLightRotationY: number | null;
        keyLightShadowResolution: number | null;
        obstacleAInteractionRadius: number | null;
        obstacleAX: number | null;
        obstacleBlocksKart: boolean;
        obstacleCount: number;
        rampCount: number;
        startClear: boolean;
        startLineHasCollision: boolean;
        startLineHasRigidBody: boolean;
        startLineVisualCenterY: number | null;
        startLineVisualThickness: number | null;
        startMarkerVisualCenterY: number;
        startMarkerVisualThickness: number;
      }>((resolve) => {
        element.dispatchEvent(
          new CustomEvent("getCollisionDebugState", {
            detail: {
              respond: resolve,
            },
          }),
        );
      }),
  );
}

async function getCameraDebugState(canvas: Locator) {
  await waitForSceneReady(canvas);

  return canvas.evaluate(
    (element) =>
      new Promise<{
        airborneBlend: number;
        angularSpeed: number;
        cameraPosition: { x: number; y: number; z: number };
        chaseHeading: { x: number; y: number; z: number };
        desiredPosition: { x: number; y: number; z: number };
        fov: number;
        forwardSpeed: number;
        impactOffset: { x: number; y: number; z: number };
        lookTarget: { x: number; y: number; z: number };
        maximumSpeed: number;
        obstructed: boolean;
        obstructionDistance: number | null;
        planarSpeed: number;
        signedSlipDegrees: number;
        snapCount: number;
        stabilizationBlend: number;
        trailingDistance: number;
        uprightness: number;
      }>((resolve) => {
        element.dispatchEvent(
          new CustomEvent("getCameraDebugState", {
            detail: { respond: resolve },
          }),
        );
      }),
  );
}

async function getCollisionResponseDebugState(canvas: Locator) {
  await waitForSceneReady(canvas);

  return canvas.evaluate(
    (element) =>
      new Promise<{
        ccdMotionThreshold: number | null;
        ccdSweptSphereRadius: number | null;
        contactedEntityNames: string[];
        impactFrameCount: number;
        maximumAngularSpeedAfterImpact: number;
        maximumApproachSpeed: number;
        maximumImpulse: number;
        postLinearVelocity: { x: number; y: number; z: number };
        preLinearVelocity: { x: number; y: number; z: number };
      }>((resolve) => {
        element.dispatchEvent(
          new CustomEvent("getCollisionResponseDebugState", {
            detail: { respond: resolve },
          }),
        );
      }),
  );
}

async function getKartDebugState(canvas: Locator) {
  await waitForSceneReady(canvas);

  return canvas.evaluate(
    (element) =>
      new Promise<KartDebugState>((resolve) => {
        element.dispatchEvent(
          new CustomEvent("getKartDebugState", {
            detail: {
              respond: resolve,
            },
          }),
        );
      }),
  );
}

async function getPresentationDebugState(canvas: Locator) {
  await waitForSceneReady(canvas);

  return canvas.evaluate(
    (element) =>
      new Promise<{
        cameraTrackedPosition: { x: number; y: number; z: number };
        physicsPosition: { x: number; y: number; z: number };
        visualPosition: { x: number; y: number; z: number };
      }>((resolve) => {
        element.dispatchEvent(
          new CustomEvent("getPresentationDebugState", {
            detail: { respond: resolve },
          }),
        );
      }),
  );
}

async function getRaceDebugState(canvas: Locator) {
  await waitForSceneReady(canvas);

  return canvas.evaluate(
    (element) =>
      new Promise<RaceDebugState>((resolve) => {
        element.dispatchEvent(
          new CustomEvent("getRaceDebugState", {
            detail: { respond: resolve },
          }),
        );
      }),
  );
}

async function setRaceDebugMovement(
  canvas: Locator,
  previousPosition: { x: number; y: number; z: number },
  currentPosition: { x: number; y: number; z: number },
  preserveMotion = false,
) {
  await waitForSceneReady(canvas);
  await canvas.evaluate(
    (element, movement) => {
      element.dispatchEvent(
        new CustomEvent("setRaceDebugMovement", { detail: movement }),
      );
    },
    { currentPosition, preserveMotion, previousPosition },
  );
}

async function requestRaceRecovery(canvas: Locator) {
  await waitForSceneReady(canvas);
  await canvas.evaluate((element) => {
    element.dispatchEvent(new CustomEvent("requestRaceRecovery"));
  });
}

async function setKartDebugPose(
  canvas: Locator,
  pose: {
    angularVelocity?: { x: number; y: number; z: number };
    ccdEnabled?: boolean;
    linearVelocity?: { x: number; y: number; z: number };
    position: { x: number; y: number; z: number };
    rotation: { x: number; y: number; z: number };
  },
) {
  await waitForSceneReady(canvas);

  await canvas.evaluate((element, requestedPose) => {
    element.dispatchEvent(
      new CustomEvent("setKartDebugPose", {
        detail: {
          pose: requestedPose,
        },
      }),
    );
  }, pose);
}

async function setSimulationPaused(canvas: Locator, paused: boolean) {
  await waitForSceneReady(canvas);
  await canvas.evaluate((element, requestedPaused) => {
    element.dispatchEvent(
      new CustomEvent("setSimulationPaused", {
        detail: { paused: requestedPaused },
      }),
    );
  }, paused);
}

async function resetKart(canvas: Locator) {
  await waitForSceneReady(canvas);
  await canvas.evaluate((element) => {
    element.dispatchEvent(new CustomEvent("resetKart"));
  });
}

async function stepSimulation(canvas: Locator, steps = 1) {
  await canvas.evaluate((element, requestedSteps) => {
    element.dispatchEvent(
      new CustomEvent("stepSimulation", {
        detail: { steps: requestedSteps },
      }),
    );
  }, steps);
}

async function stepSimulationWithKartSamples(canvas: Locator, steps: number) {
  return canvas.evaluate(
    (element, requestedSteps) =>
      new Promise<KartDebugState[]>((resolve) => {
        element.dispatchEvent(
          new CustomEvent("stepSimulationWithKartSamples", {
            detail: { respond: resolve, steps: requestedSteps },
          }),
        );
      }),
    steps,
  );
}

async function advanceRaceToRacing(canvas: Locator) {
  await setSimulationPaused(canvas, true);
  const countdown = await getRaceDebugState(canvas);
  const steps =
    Math.ceil(
      countdown.countdownRemainingMicroseconds /
        (DEFAULT_FIXED_STEP_SECONDS * 1_000_000),
    ) + 1;

  await stepSimulation(canvas, steps);
  await expect
    .poll(async () => (await getRaceDebugState(canvas)).state)
    .toBe("racing");
}

async function crossRaceTarget(
  canvas: Locator,
  target: {
    forward: { x: number; y: number; z: number };
    position: { x: number; y: number; z: number };
  },
  offset = { x: 0, y: 0, z: 0 },
  preserveMotion = false,
) {
  await setRaceDebugMovement(
    canvas,
    {
      x: target.position.x + offset.x - target.forward.x,
      y: target.position.y + offset.y - target.forward.y,
      z: target.position.z + offset.z - target.forward.z,
    },
    {
      x: target.position.x + offset.x + target.forward.x,
      y: target.position.y + offset.y + target.forward.y,
      z: target.position.z + offset.z + target.forward.z,
    },
    preserveMotion,
  );
  await stepSimulation(canvas);
  return getRaceDebugState(canvas);
}

async function useBundledRoughCourse(page: Page) {
  await page.route("**/api/courses/rough-course/published", async (route) => {
    await route.fulfill({
      body: JSON.stringify({
        courseId: "rough-course",
        document: ROUGH_COURSE_DOCUMENT,
        publishedAt: new Date("2026-07-12T00:05:00.000Z").toISOString(),
        revision: 1,
        schemaVersion: 2,
      }),
      contentType: "application/json",
      status: 200,
    });
  });
}

async function useBundledBalancedKart(
  page: Page,
  thumbnailAvailable = false,
) {
  await page.route("**/api/karts/official", async (route) => {
    await route.fulfill({
      body: JSON.stringify({
        karts: [
          {
            assemblerCredit: "Titan Racers",
            runtime: {
              derivationVersion: BALANCED_KART_SNAPSHOT.derivationVersion,
              document: BALANCED_KART_DOCUMENT,
              kartId: BALANCED_KART_DOCUMENT.kartId,
              publishedAt: new Date("2026-07-25T00:05:00.000Z").toISOString(),
              resolvedSnapshot: BALANCED_KART_SNAPSHOT,
              resolvedSnapshotHash: "a".repeat(64),
              revision: 1,
              schemaVersion: BALANCED_KART_DOCUMENT.schemaVersion,
              thumbnailAvailable,
            },
          },
        ],
        source: "published",
      }),
      contentType: "application/json",
      status: 200,
    });
  });
}

async function useBundledHandlingKart(page: Page) {
  await page.unroute("**/api/karts/official");
  await page.route("**/api/karts/official", async (route) => {
    await route.fulfill({
      body: JSON.stringify({
        karts: [
          {
            assemblerCredit: "Titan Racers",
            runtime: {
              derivationVersion: HANDLING_KART_SNAPSHOT.derivationVersion,
              document: HANDLING_KART_DOCUMENT,
              kartId: HANDLING_KART_DOCUMENT.kartId,
              publishedAt: new Date("2026-07-25T00:05:00.000Z").toISOString(),
              resolvedSnapshot: HANDLING_KART_SNAPSHOT,
              resolvedSnapshotHash: "f".repeat(64),
              revision: 1,
              schemaVersion: HANDLING_KART_DOCUMENT.schemaVersion,
              thumbnailAvailable: false,
            },
          },
        ],
        source: "published",
      }),
      contentType: "application/json",
      status: 200,
    });
  });
}

async function usePublishedBalancedAndSpeedKarts(page: Page) {
  return routePublishedBalancedAndSpeedKartsWithThumbnails(page, {});
}

async function routePublishedBalancedAndSpeedKartsWithThumbnails(
  page: Page,
  {
    balanced = false,
    speed = false,
  }: { balanced?: boolean; speed?: boolean },
) {
  await page.route("**/api/karts/official", async (route) => {
    await route.fulfill({
      body: JSON.stringify({
        karts: [
          {
            assemblerCredit: "Balanced Assembler",
            runtime: {
              derivationVersion: BALANCED_KART_SNAPSHOT.derivationVersion,
              document: BALANCED_KART_DOCUMENT,
              kartId: BALANCED_KART_DOCUMENT.kartId,
              publishedAt: "2026-07-25T00:05:00.000Z",
              resolvedSnapshot: BALANCED_KART_SNAPSHOT,
              resolvedSnapshotHash: "d".repeat(64),
              revision: 2,
              schemaVersion: BALANCED_KART_DOCUMENT.schemaVersion,
              thumbnailAvailable: balanced,
            },
          },
          {
            assemblerCredit: "Speed Assembler",
            runtime: {
              derivationVersion: SPEED_KART_SNAPSHOT.derivationVersion,
              document: SPEED_KART_DOCUMENT,
              kartId: SPEED_KART_DOCUMENT.kartId,
              publishedAt: "2026-07-25T00:10:00.000Z",
              resolvedSnapshot: SPEED_KART_SNAPSHOT,
              resolvedSnapshotHash: "e".repeat(64),
              revision: 3,
              schemaVersion: SPEED_KART_DOCUMENT.schemaVersion,
              thumbnailAvailable: speed,
            },
          },
        ],
        source: "published",
      }),
      contentType: "application/json",
      status: 200,
    });
  });
}

async function delayNextKartThumbnailEncoding(page: Page, delayMs: number) {
  await page.addInitScript(
    ({ height, width, waitMs }) => {
      const originalToBlob = HTMLCanvasElement.prototype.toBlob;
      let delayed = false;
      HTMLCanvasElement.prototype.toBlob = function (
        callback,
        type,
        quality,
      ) {
        if (!delayed && this.height === height && this.width === width) {
          delayed = true;
          setTimeout(() => {
            Reflect.apply(originalToBlob, this, [callback, type, quality]);
          }, waitMs);
          return;
        }
        Reflect.apply(originalToBlob, this, [callback, type, quality]);
      };
    },
    {
      height: 360,
      waitMs: delayMs,
      width: 640,
    },
  );
}

test.describe("home screen", () => {
  test.describe.configure({ mode: "serial" });
  test.beforeEach(async ({ page }) => {
    await Promise.all([
      useBundledRoughCourse(page),
      useBundledBalancedKart(page),
    ]);
  });

  test("shows player-first mode selection with coming soon feedback", async ({
    page,
  }) => {
    await page.goto("/");

    await expect(page.getByAltText("Titan Racers")).toBeVisible();
    await expect(page.getByText("Choose game mode")).toBeVisible();
    const utilityMenu = page.getByRole("button", {
      name: "Open utility menu",
    });
    await expect(utilityMenu).toBeVisible();
    await expect(utilityMenu).toHaveAttribute("aria-expanded", "false");
    await expect(
      page.getByRole("link", { name: "Course Editor" }),
    ).toHaveCount(0);
    await utilityMenu.click();
    await expect(
      page.getByRole("button", { name: "Close utility menu" }),
    ).toHaveAttribute("aria-expanded", "true");
    await expect(
      page.getByRole("link", { name: "Course Editor" }),
    ).toBeVisible();
    await expect(page.getByRole("link", { name: "Kart Builder" })).toBeVisible();
    await expect(page.getByRole("link", { name: "Profile" })).toBeVisible();
    await expect(page.getByRole("link", { name: "Telemetry" })).toHaveCount(0);
    expect(
      await page.evaluate(() => document.documentElement.scrollWidth),
    ).toBeLessThanOrEqual(page.viewportSize()?.width ?? 0);
    await page.keyboard.press("Escape");
    await expect(utilityMenu).toBeFocused();
    await expect(
      page.getByRole("link", { name: "Course Editor" }),
    ).toHaveCount(0);

    const raceFriends = page.getByRole("button", { name: "Race Friends" });
    const soloTimeTrial = page.getByRole("button", { name: "Solo Time Trial" });

    await expect(raceFriends).toBeVisible();
    await expect(soloTimeTrial).toBeVisible();

    await raceFriends.click();
    await expect(page.getByRole("status")).toHaveText("coming soon");
  });

  test("selects and races only currently published official karts", async ({
    page,
  }) => {
    await usePublishedBalancedAndSpeedKarts(page);

    await page.goto("/");
    const selection = page.getByRole("group", {
      name: "Official kart selection",
    });
    const balanced = selection
      .getByRole("button")
      .filter({ hasText: "Balanced Kart" });
    const speed = selection
      .getByRole("button")
      .filter({ hasText: "Speed Kart" });

    await expect(balanced).toContainText("Assembled by Balanced Assembler");
    await expect(speed).toContainText("Assembled by Speed Assembler");
    await expect(selection).not.toContainText("Handling Kart");
    await expect(
      balanced.locator('[data-kart-thumbnail-source="generated"]'),
    ).toBeVisible();
    await expect(
      speed.locator('[data-kart-thumbnail-source="generated"]'),
    ).toBeVisible();
    await expect(balanced).toHaveAttribute("aria-pressed", "true");
    await speed.click();
    await expect(speed).toHaveAttribute("aria-pressed", "true");

    await page.getByRole("button", { name: "Solo Time Trial" }).click();
    await expect(page.getByTestId("solo-time-trial-canvas")).toHaveAttribute(
      "data-kart-document-name",
      "Speed Kart",
    );
  });

  test("selects and races a published kart with a controller", async ({
    page,
  }, testInfo) => {
    test.skip(
      testInfo.project.name === "mobile",
      "Controller desktop fixture.",
    );

    await installStandardGamepadFixture(page);
    await usePublishedBalancedAndSpeedKarts(page);
    await page.goto("/");

    const selection = page.getByRole("group", {
      name: "Official kart selection",
    });
    const speed = selection
      .getByRole("button")
      .filter({ hasText: "Speed Kart" });
    await expect(speed).toBeVisible();

    await setStandardTestGamepad(page);
    await page.waitForTimeout(50);
    await setStandardTestGamepad(page, { buttons: { 14: 1 } });
    await expect(speed).toBeFocused();
    await setStandardTestGamepad(page);
    await page.waitForTimeout(50);
    await setStandardTestGamepad(page, { buttons: { 0: 1 } });
    await expect(speed).toHaveAttribute("aria-pressed", "true");

    await setStandardTestGamepad(page);
    await page.waitForTimeout(50);
    await setStandardTestGamepad(page, { buttons: { 15: 1 } });
    const soloTimeTrial = page.getByRole("button", {
      name: "Solo Time Trial",
    });
    await expect(soloTimeTrial).toBeFocused();
    await setStandardTestGamepad(page);
    await page.waitForTimeout(50);
    await setStandardTestGamepad(page, { buttons: { 0: 1 } });

    await expect(page.getByTestId("solo-time-trial-canvas")).toHaveAttribute(
      "data-kart-document-name",
      "Speed Kart",
    );
  });

  test("does not restore intentionally unpublished official karts", async ({
    page,
  }) => {
    await page.route("**/api/karts/official", async (route) => {
      await route.fulfill({
        body: JSON.stringify({ karts: [], source: "published" }),
        contentType: "application/json",
        status: 200,
      });
    });

    await page.goto("/");
    await expect(
      page.getByText("No official karts are currently published."),
    ).toBeVisible();
    await expect(
      page.getByRole("button", { name: "Solo Time Trial" }),
    ).toBeDisabled();
    await expect(
      page.getByRole("group", { name: "Official kart selection" }),
    ).toHaveCount(0);
  });

  test("opens the full-screen solo time trial canvas", async ({ page }) => {
    const browserErrors: string[] = [];
    page.on("console", (message) => {
      if (message.type() === "error") browserErrors.push(message.text());
    });
    page.on("pageerror", (error) => browserErrors.push(error.message));
    await page.goto("/");

    const soloTimeTrial = page.getByRole("button", { name: "Solo Time Trial" });
    await soloTimeTrial.click();

    const canvas = page.getByTestId("solo-time-trial-canvas");
    await expect(canvas).toBeVisible();

    const box = await canvas.boundingBox();
    const viewport = page.viewportSize();

    expect(box).not.toBeNull();
    expect(viewport).not.toBeNull();
    expect(Math.round(box?.width ?? 0)).toBe(viewport?.width);
    expect(Math.round(box?.height ?? 0)).toBe(viewport?.height);
    expect(browserErrors).toEqual([]);
  });

  test("keeps a late thumbnail fallback isolated from race startup", async ({
    page,
  }) => {
    const browserErrors: string[] = [];
    let requestedRevision: string | null = null;
    page.on("console", (message) => {
      if (message.type() === "error") browserErrors.push(message.text());
    });
    page.on("pageerror", (error) => browserErrors.push(error.message));
    await delayNextKartThumbnailEncoding(page, 500);
    await routePublishedBalancedAndSpeedKartsWithThumbnails(page, {
      balanced: true,
    });
    await page.route(
      "**/api/karts/balanced-kart/thumbnail?revision=2",
      async (route) => {
        requestedRevision = new URL(route.request().url()).searchParams.get(
          "revision",
        );
        await new Promise((resolve) => setTimeout(resolve, 150));
        await route.abort("failed");
      },
    );

    await page.goto("/");
    await expect(
      page.locator('[data-kart-thumbnail-source="persisted"]').first(),
    ).toBeVisible();
    await expect(
      page.locator('[data-kart-thumbnail-source="rendering"]').first(),
    ).toBeVisible();
    await expect.poll(() => requestedRevision).toBe("2");
    await page.getByRole("button", { name: "Solo Time Trial" }).click();
    await expect(page.getByTestId("solo-time-trial-canvas")).toBeVisible();
    expect(browserErrors.join("\n")).not.toMatch(
      /syncHierarchy|__destroy__|Unable to render kart thumbnail/,
    );
  });

  test("releases a thumbnail pause when home unmounts during queue drain", async ({
    page,
  }, testInfo) => {
    test.skip(
      testInfo.project.name !== "desktop",
      "Client-navigation lifecycle coverage only needs one browser fixture.",
    );
    await delayNextKartThumbnailEncoding(page, 750);
    // Bundled karts have no stored images, so every card renders locally.
    await page.route("**/api/karts/official", (route) =>
      route.fulfill({ status: 503 }),
    );
    await page.goto("/");
    await expect(
      page.locator('[data-kart-thumbnail-source="rendering"]').first(),
    ).toBeVisible();
    await page.getByRole("button", { name: "Solo Time Trial" }).click();
    await page.getByRole("button", { name: "Open utility menu" }).click();
    await page.getByRole("link", { name: "Profile" }).click();
    await expect(page).toHaveURL(/\/profile$/);

    await page.goBack();
    await expect(page).toHaveURL("/");
    // Queued local renders drain one PlayCanvas application at a time.
    await expect(
      page.locator('[data-kart-thumbnail-source="generated"]').first(),
    ).toBeVisible({ timeout: 15_000 });
  });

  test("shows locale-aware speed in the race HUD", async ({
    page,
  }, testInfo) => {
    test.skip(
      testInfo.project.name !== "desktop",
      "The browser speed readout only needs one rendered locale fixture.",
    );
    await page.goto("/");
    await page.getByRole("button", { name: "Solo Time Trial" }).click();
    const canvas = page.getByTestId("solo-time-trial-canvas");
    await setSimulationPaused(canvas, true);
    const kart = await getKartDebugState(canvas);
    await setKartDebugPose(canvas, {
      linearVelocity: {
        x: kart.forward.x * 10,
        y: 0,
        z: kart.forward.z * 10,
      },
      position: { x: kart.x, y: kart.y, z: kart.z },
      rotation: {
        x: kart.rotationX,
        y: kart.rotationY,
        z: kart.rotationZ,
      },
    });
    await stepSimulation(canvas);

    await expect(page.getByTestId("race-speed")).toHaveText("22mph");
    await expect(
      page.getByLabel("Speed 22 mph", { exact: true }),
    ).toBeVisible();
  });

  test("constructs guest racing from the published course revision", async ({
    page,
  }) => {
    const publishedDocument = structuredClone(ROUGH_COURSE_DOCUMENT);
    publishedDocument.lighting.ambient.color = { b: 0.4, g: 0.3, r: 0.2 };
    await page.route("**/api/courses/rough-course/published", async (route) => {
      await route.fulfill({
        body: JSON.stringify({
          courseId: "rough-course",
          document: publishedDocument,
          publishedAt: new Date("2026-07-12T00:05:00.000Z").toISOString(),
          revision: 3,
          schemaVersion: 2,
        }),
        contentType: "application/json",
        status: 200,
      });
    });

    await page.goto("/");
    await page.getByRole("button", { name: "Solo Time Trial" }).click();
    const canvas = page.getByTestId("solo-time-trial-canvas");
    const state = await getCollisionDebugState(canvas);
    expect(state.ambientLightR).toBeCloseTo(0.2);
    expect(state.ambientLightG).toBeCloseTo(0.3);
    expect(state.ambientLightB).toBeCloseTo(0.4);
  });

  test("constructs guest racing from the published kart revision", async ({
    page,
  }) => {
    const publishedDocument = structuredClone(BALANCED_KART_DOCUMENT);
    const publishedSnapshot = structuredClone(
      BALANCED_KART_SNAPSHOT,
    ) as unknown as ResolvedKartSnapshot;
    publishedDocument.visualIdentity.primaryColor = "#125599";
    publishedDocument.componentInstances[0].visualColor = "#c83b32";
    publishedSnapshot.physicalProfile.drivetrain.maximumDriveForce = 12.345;
    publishedSnapshot.physicalProfile.drivetrain.noLoadSpeed = 9.876;
    await page.route("**/api/karts/official", async (route) => {
      await route.fulfill({
        body: JSON.stringify({
          karts: [
            {
              assemblerCredit: "Published Assembler",
              runtime: {
                derivationVersion: publishedSnapshot.derivationVersion,
                document: publishedDocument,
                kartId: publishedDocument.kartId,
                publishedAt: new Date(
                  "2026-07-25T00:05:00.000Z",
                ).toISOString(),
                resolvedSnapshot: publishedSnapshot,
                resolvedSnapshotHash: "b".repeat(64),
                revision: 4,
                schemaVersion: publishedDocument.schemaVersion,
              },
            },
          ],
          source: "published",
        }),
        contentType: "application/json",
        status: 200,
      });
    });

    await page.goto("/");
    await page.getByRole("button", { name: "Solo Time Trial" }).click();
    const canvas = page.getByTestId("solo-time-trial-canvas");
    await expect(canvas).toHaveAttribute("data-kart-primary-color", "#125599");
    await expect(canvas).toHaveAttribute(
      "data-kart-component-color",
      "#c83b32",
    );
    await waitForSceneReady(canvas);
    const kartState = await getKartDebugState(canvas);
    expect(kartState.developmentValues.maximumDriveForce).toBe(12.345);
    expect(kartState.maxForwardSpeed).toBe(9.88);
  });

  test("uses the bundled roster when the official roster is unavailable", async ({
    page,
  }) => {
    await page.route("**/api/karts/official", async (route) => {
      await route.fulfill({
        body: JSON.stringify({ error: "Official kart roster unavailable." }),
        contentType: "application/json",
        status: 503,
      });
    });

    await page.goto("/");
    await page.getByRole("button", { name: "Solo Time Trial" }).click();
    const canvas = page.getByTestId("solo-time-trial-canvas");
    await expect(canvas).toHaveAttribute(
      "data-kart-primary-color",
      BALANCED_KART_DOCUMENT.visualIdentity.primaryColor,
    );
    await expect(canvas).toHaveAttribute(
      "data-kart-document-name",
      BALANCED_KART_DOCUMENT.name,
    );
  });

  test("returns to the bundled course when a later publication fetch fails", async ({
    page,
  }) => {
    const publishedDocument = structuredClone(ROUGH_COURSE_DOCUMENT);
    publishedDocument.lighting.ambient.color = { b: 0.4, g: 0.3, r: 0.2 };
    let requestCount = 0;
    await page.route("**/api/courses/rough-course/published", async (route) => {
      requestCount += 1;
      if (requestCount > 1) {
        await route.fulfill({
          body: JSON.stringify({ error: "Published course not found." }),
          contentType: "application/json",
          status: 404,
        });
        return;
      }
      await route.fulfill({
        body: JSON.stringify({
          courseId: "rough-course",
          document: publishedDocument,
          publishedAt: new Date("2026-07-12T00:05:00.000Z").toISOString(),
          revision: 3,
          schemaVersion: 2,
        }),
        contentType: "application/json",
        status: 200,
      });
    });

    await page.goto("/");
    await page.getByRole("button", { name: "Solo Time Trial" }).click();
    let canvas = page.getByTestId("solo-time-trial-canvas");
    let state = await getCollisionDebugState(canvas);
    expect(state.ambientLightR).toBeCloseTo(0.2);

    await page.keyboard.press("Escape");
    await page.getByRole("button", { name: "Exit", exact: true }).click();
    await page.getByRole("button", { name: "Solo Time Trial" }).click();
    canvas = page.getByTestId("solo-time-trial-canvas");
    state = await getCollisionDebugState(canvas);
    expect(state.ambientLightR).toBeCloseTo(
      ROUGH_COURSE_DOCUMENT.lighting.ambient.color.r,
    );
    expect(state.ambientLightG).toBeCloseTo(
      ROUGH_COURSE_DOCUMENT.lighting.ambient.color.g,
    );
    expect(state.ambientLightB).toBeCloseTo(
      ROUGH_COURSE_DOCUMENT.lighting.ambient.color.b,
    );
    expect(requestCount).toBe(2);
  });

  test("shows an accessible error and reloads after kart physics cannot load", async ({
    page,
  }) => {
    await installStandardGamepadFixture(page);
    await page.route("**/vendor/ammo/**", (route) => route.abort());
    await page.goto("/");
    await page.getByRole("button", { name: "Solo Time Trial" }).click();

    await expect(
      page.getByRole("alert").filter({ hasText: "Unable to start the race" }),
    ).toBeVisible();
    await page.unroute("**/vendor/ammo/**");
    await expect(
      page.locator('[data-controller-menu-ready="true"]'),
    ).toHaveCount(1);
    await setStandardTestGamepad(page);
    await page.waitForTimeout(50);
    await setStandardTestGamepad(page, { buttons: { 0: 1 } });
    await expect(page.getByText("Choose game mode")).toBeVisible();
    await setStandardTestGamepad(page);
    await expect(
      page.locator('[data-controller-menu-ready="true"]'),
    ).toHaveCount(1);
    await page.getByRole("button", { name: "Solo Time Trial" }).click();
    await expect(page.getByTestId("solo-time-trial-canvas")).toHaveAttribute(
      "data-scene-ready",
      "true",
      { timeout: 15_000 },
    );
  });

  test("can exit safely while kart physics is still loading", async ({
    page,
  }) => {
    let releaseRequest: () => void = () => undefined;
    const blockedRequest = new Promise<void>((resolve) => {
      releaseRequest = resolve;
    });
    const pageErrors: Error[] = [];

    page.on("pageerror", (error) => pageErrors.push(error));
    await installStandardGamepadFixture(page);
    await page.route("**/vendor/ammo/**", async (route) => {
      await blockedRequest;
      await route.abort();
    });
    await page.goto("/");
    await page.getByRole("button", { name: "Solo Time Trial" }).click();

    await expect(page.getByRole("status")).toHaveText(
      "Preparing kart physics…",
    );
    await expect(
      page.locator('[data-controller-menu-ready="true"]'),
    ).toHaveCount(1);
    await setStandardTestGamepad(page);
    await page.waitForTimeout(50);
    await setStandardTestGamepad(page, { buttons: { 0: 1 } });
    await expect(page.getByText("Choose game mode")).toBeVisible();
    await setStandardTestGamepad(page);

    releaseRequest();
    await page.unrouteAll({ behavior: "wait" });
    expect(pageErrors).toEqual([]);
  });

  test("exits a failed race with controller focus or back", async ({
    page,
  }) => {
    await installStandardGamepadFixture(page);
    await page.route("**/vendor/ammo/**", (route) => route.abort());
    await page.goto("/");
    await page.getByRole("button", { name: "Solo Time Trial" }).click();

    const failedAlert = page
      .getByRole("alert")
      .filter({ hasText: "Unable to start the race" });
    await expect(failedAlert).toBeVisible();
    await expect(
      page.locator('[data-controller-menu-ready="true"]'),
    ).toHaveCount(1);
    await setStandardTestGamepad(page);
    await page.waitForTimeout(50);
    await setStandardTestGamepad(page, { buttons: { 13: 1 } });
    const exit = page.getByRole("button", { name: "Exit" });
    await expect(exit).toBeFocused();
    await setStandardTestGamepad(page);
    await page.waitForTimeout(50);
    await setStandardTestGamepad(page, { buttons: { 0: 1 } });
    await expect(page.getByText("Choose game mode")).toBeVisible();

    await page.reload();
    await expect(page.getByText("Choose game mode")).toBeVisible();
    await setStandardTestGamepad(page);
    await page.getByRole("button", { name: "Solo Time Trial" }).click();
    await expect(failedAlert).toBeVisible();
    await expect(
      page.locator('[data-controller-menu-ready="true"]'),
    ).toHaveCount(1);
    await page.waitForTimeout(50);
    await setStandardTestGamepad(page, { buttons: { 1: 1 } });
    await expect(page.getByText("Choose game mode")).toBeVisible();
  });

  test("destroys the runtime when scene setup fails after initialization", async ({
    page,
  }) => {
    await page.addInitScript(() => {
      (
        window as typeof window & {
          __TITAN_RACERS_SCENE_TEST__?: {
            forcePostRuntimeFailure: boolean;
            runtimeDestroyCount: number;
          };
        }
      ).__TITAN_RACERS_SCENE_TEST__ = {
        forcePostRuntimeFailure: true,
        runtimeDestroyCount: 0,
      };
    });
    await page.goto("/");
    await page.getByRole("button", { name: "Solo Time Trial" }).click();

    await expect(
      page.getByRole("alert").filter({ hasText: "Unable to start the race" }),
    ).toBeVisible();
    await expect
      .poll(() =>
        page.evaluate(
          () =>
            (
              window as typeof window & {
                __TITAN_RACERS_SCENE_TEST__?: {
                  runtimeDestroyCount?: number;
                };
              }
            ).__TITAN_RACERS_SCENE_TEST__?.runtimeDestroyCount ?? 0,
        ),
      )
      .toBe(1);
  });

  test("shows a controlled failure when race-session setup throws", async ({
    page,
  }) => {
    await page.addInitScript(() => {
      (
        window as typeof window & {
          __TITAN_RACERS_SCENE_TEST__?: {
            forceRaceSessionFailure: boolean;
            runtimeDestroyCount: number;
          };
        }
      ).__TITAN_RACERS_SCENE_TEST__ = {
        forceRaceSessionFailure: true,
        runtimeDestroyCount: 0,
      };
    });
    await page.goto("/");
    await page.getByRole("button", { name: "Solo Time Trial" }).click();

    await expect(
      page.getByRole("alert").filter({ hasText: "Unable to start the race" }),
    ).toBeVisible();
    await expect
      .poll(() =>
        page.evaluate(
          () =>
            (
              window as typeof window & {
                __TITAN_RACERS_SCENE_TEST__?: {
                  runtimeDestroyCount?: number;
                };
              }
            ).__TITAN_RACERS_SCENE_TEST__?.runtimeDestroyCount ?? 0,
        ),
      )
      .toBe(1);
  });

  test("runs the deterministic two-lap race lifecycle through ordered gates", async ({
    page,
  }, testInfo) => {
    testInfo.setTimeout(120_000);
    test.skip(
      testInfo.project.name !== "desktop",
      "Race progression integration only needs to run once.",
    );

    await installStandardGamepadFixture(page);
    await page.goto("/");
    await page.getByRole("button", { name: "Solo Time Trial" }).click();
    const canvas = page.getByTestId("solo-time-trial-canvas");
    await setSimulationPaused(canvas, true);
    await resetKart(canvas);
    const initialKart = await getKartDebugState(canvas);
    await advanceRaceToRacing(canvas);
    const raceStatus = page.getByRole("region", { name: "Race status" });
    const raceAnnouncement = page.locator(
      "p[role='status'][aria-live='polite']",
    );
    await expect(raceStatus).toContainText("Lap01/02");
    await expect(raceStatus).not.toContainText("Gates");

    const startYaw = (ROUGH_COURSE_DOCUMENT.start.rotation.y * Math.PI) / 180;
    const startTarget = {
      forward: { x: -Math.sin(startYaw), y: 0, z: -Math.cos(startYaw) },
      position: {
        x: ROUGH_COURSE_DOCUMENT.start.position.x,
        y:
          ROUGH_COURSE_DOCUMENT.start.position.y +
          ROUGH_COURSE_DOCUMENT.start.gateHalfExtents.y,
        z: ROUGH_COURSE_DOCUMENT.start.position.z,
      },
    };
    const checkpoints = ROUGH_COURSE_DOCUMENT.checkpoints;
    const checkpointOffsets = [
      { x: 0, y: 0, z: 1 },
      { x: 1, y: 0, z: 0 },
      { x: 0, y: 0, z: -1 },
      { x: 0, y: 0, z: 1 },
      { x: -1, y: 0, z: 0 },
      { x: 0, y: 0, z: -1 },
    ];

    let race = await getRaceDebugState(canvas);
    for (let lap = 1; lap <= 2; lap += 1) {
      for (const [index, checkpoint] of checkpoints.entries()) {
        race = await crossRaceTarget(
          canvas,
          checkpoint,
          checkpointOffsets[index],
        );
        expect(race.lastProgressionResult).toEqual({
          checkpointId: checkpoint.id,
          kind: "checkpoint",
        });
      }
      race = await crossRaceTarget(canvas, startTarget);
      if (lap === 1) {
        expect(race).toMatchObject({
          currentLap: 2,
          lastProgressionResult: { kind: "lap", lap: 1 },
        });
        await expect(raceStatus).toContainText("Lap02/02");
        await expect(raceAnnouncement).toHaveText("Lap 2 of 2");
      }
    }
    expect(race).toMatchObject({
      completedLapMicroseconds: [expect.any(Number), expect.any(Number)],
      lastProgressionResult: { kind: "finished", lap: 2 },
      state: "finished",
    });

    const finishDialog = page.getByRole("dialog", { name: "Finish" });
    await expect(finishDialog).toBeVisible();
    await expect(raceAnnouncement).toHaveText(/^Race finished in 0:/);
    await expect(finishDialog.getByRole("listitem")).toHaveCount(2);
    await expect(
      finishDialog.getByRole("button", { name: "Race again" }),
    ).toBeFocused();
    await expect(
      finishDialog.locator('[data-controller-menu-ready="true"]'),
    ).toHaveCount(1);
    await setSimulationPaused(canvas, false);
    await setStandardTestGamepad(page, { buttons: { 0: 1 } });
    await expect(finishDialog).not.toBeVisible();
    await expect
      .poll(async () => (await getRaceDebugState(canvas)).state)
      .toBe("countdown");
    await expect(raceStatus).toContainText("Lap01/02");
    await expect(canvas).toBeFocused();

    const restartedKart = await getKartDebugState(canvas);
    expect(Math.abs(restartedKart.speed)).toBeLessThan(0.05);
    expect(restartedKart.angularSpeed).toBeLessThan(0.02);
    expect(Math.abs(restartedKart.x - initialKart.x)).toBeLessThan(
      scaleReferenceKartLength(0.1),
    );
    expect(Math.abs(restartedKart.z - initialKart.z)).toBeLessThan(
      scaleReferenceKartLength(0.1),
    );
  });

  test("keeps the rough-race HUD clear of mobile utilities", async ({
    page,
  }, testInfo) => {
    test.skip(testInfo.project.name !== "mobile", "Mobile HUD layout only.");
    await page.setViewportSize({ height: 700, width: 350 });
    await page.goto("/");
    await page.getByRole("button", { name: "Solo Time Trial" }).click();

    const canvas = page.getByTestId("solo-time-trial-canvas");
    await setSimulationPaused(canvas, true);
    const raceStatus = page.getByRole("region", { name: "Race status" });
    const cluster = raceStatus.locator(".race-status-cluster");
    const reset = page.getByRole("button", { name: "Reset kart" });
    const pause = page.getByRole("button", { name: "Pause race" });

    await expect(raceStatus).toContainText("Lap01/02");
    await expect(raceStatus).toContainText("Race time0:00.0");
    await expect(raceStatus).not.toContainText("Gates");
    await expect(page.locator(".race-lifecycle-cue span")).toHaveText(
      /^[123]$/,
    );

    const [clusterBox, resetBox, pauseBox] = await Promise.all([
      cluster.boundingBox(),
      reset.boundingBox(),
      pause.boundingBox(),
    ]);
    expect(clusterBox).not.toBeNull();
    expect(resetBox).not.toBeNull();
    expect(pauseBox).not.toBeNull();
    expect((resetBox?.x ?? 0) + (resetBox?.width ?? 0)).toBeLessThanOrEqual(
      clusterBox?.x ?? 0,
    );
    expect((clusterBox?.x ?? 0) + (clusterBox?.width ?? 0)).toBeLessThanOrEqual(
      pauseBox?.x ?? 0,
    );
  });

  test("recovers at the latest supported checkpoint and pauses stabilization", async ({
    page,
  }, testInfo) => {
    testInfo.setTimeout(60_000);
    test.skip(
      testInfo.project.name !== "desktop",
      "Race recovery integration only needs to run once.",
    );

    await page.goto("/");
    await page.getByRole("button", { name: "Solo Time Trial" }).click();
    const canvas = page.getByTestId("solo-time-trial-canvas");

    await setSimulationPaused(canvas, true);
    expect(await getRaceDebugState(canvas)).toMatchObject({
      state: "countdown",
    });
    await setKartDebugPose(canvas, {
      angularVelocity: { x: 3, y: 2, z: 1 },
      linearVelocity: { x: 5, y: -2, z: 4 },
      position: { x: -12, y: -20, z: 5 },
      rotation: { x: 15, y: 20, z: -10 },
    });
    await requestRaceRecovery(canvas);

    const preRaceReset = await getPresentationDebugState(canvas);
    expect(preRaceReset.visualPosition.x).toBeCloseTo(
      ROUGH_COURSE_DOCUMENT.start.position.x,
    );
    expect(preRaceReset.visualPosition.z).toBeCloseTo(
      ROUGH_COURSE_DOCUMENT.start.position.z,
    );
    expect(await getRaceDebugState(canvas)).toMatchObject({
      state: "countdown",
    });

    await advanceRaceToRacing(canvas);

    const firstCheckpoint = ROUGH_COURSE_DOCUMENT.checkpoints[0];
    await crossRaceTarget(canvas, firstCheckpoint);
    await setKartDebugPose(canvas, {
      angularVelocity: { x: 3, y: 2, z: 1 },
      linearVelocity: { x: 5, y: -2, z: 4 },
      position: { x: -12, y: 4, z: 5 },
      rotation: { x: 15, y: 20, z: -10 },
    });
    await requestRaceRecovery(canvas);
    await requestRaceRecovery(canvas);

    const recovering = await getRaceDebugState(canvas);
    const recoveredKart = await getKartDebugState(canvas);
    const presentation = await getPresentationDebugState(canvas);
    expect(recovering).toMatchObject({
      activeRecovery: { id: firstCheckpoint.id },
      expectedTargetId: ROUGH_COURSE_DOCUMENT.checkpoints[1].id,
      recoveryRemainingMicroseconds: 500_000,
      state: "recovering",
    });
    expect(recoveredKart).toMatchObject({
      angularSpeed: 0,
      speed: 0,
      verticalVelocity: 0,
    });
    expect(recoveredKart.forward.x).toBeCloseTo(-Math.SQRT1_2, 1);
    expect(recoveredKart.forward.z).toBeCloseTo(Math.SQRT1_2, 1);
    expect(presentation.visualPosition.x).toBeCloseTo(
      firstCheckpoint.recovery.position.x,
    );
    expect(presentation.visualPosition.z).toBeCloseTo(
      firstCheckpoint.recovery.position.z,
    );
    expect(presentation.cameraTrackedPosition).toEqual(
      presentation.visualPosition,
    );

    await stepSimulation(canvas, 10);
    const beforePause = await getRaceDebugState(canvas);
    await page
      .locator(".race-pause-button")
      .evaluate((button: HTMLButtonElement) => button.click());
    await expect(page.getByRole("dialog", { name: "Paused" })).toBeVisible();
    expect(await getRaceDebugState(canvas)).toMatchObject({
      recoveryRemainingMicroseconds: beforePause.recoveryRemainingMicroseconds,
      resumableState: "recovering",
      state: "paused",
    });
    await stepSimulation(canvas, 20);
    expect(
      (await getRaceDebugState(canvas)).recoveryRemainingMicroseconds,
    ).toBe(beforePause.recoveryRemainingMicroseconds);

    await page.getByRole("button", { name: "Resume" }).click();
    const resuming = await getRaceDebugState(canvas);
    expect(resuming).toMatchObject({
      elapsedRaceMicroseconds: beforePause.elapsedRaceMicroseconds,
      resumableState: "recovering",
      state: "resuming",
    });
    await expect(page.locator(".race-lifecycle-cue")).toBeVisible();
    await expect
      .poll(async () => (await getRaceDebugState(canvas)).state)
      .not.toBe("resuming");
    await setSimulationPaused(canvas, true);
    await stepSimulation(canvas, 40);
    const recovered = await getRaceDebugState(canvas);
    expect(recovered).toMatchObject({
      expectedTargetId: ROUGH_COURSE_DOCUMENT.checkpoints[1].id,
      recoveryRemainingMicroseconds: 0,
      state: "racing",
    });
    expect(recovered.elapsedRaceMicroseconds).toBeGreaterThan(
      beforePause.elapsedRaceMicroseconds,
    );
  });

  test("keeps the mobile solo canvas sized and kart centered", async ({
    page,
  }, testInfo) => {
    test.skip(
      testInfo.project.name !== "mobile",
      "Mobile rendering path only.",
    );

    await page.goto("/");

    await page.getByRole("button", { name: "Solo Time Trial" }).click();

    const canvas = page.getByTestId("solo-time-trial-canvas");
    await expect(canvas).toBeVisible();

    const box = await canvas.boundingBox();
    const viewport = page.viewportSize();

    expect(box).not.toBeNull();
    expect(viewport).not.toBeNull();
    expect(Math.round(box?.width ?? 0)).toBe(viewport?.width);
    expect(Math.round(box?.height ?? 0)).toBe(viewport?.height);

    const canvasSize = await canvas.evaluate((element) => {
      const htmlCanvas = element as HTMLCanvasElement;

      return {
        clientHeight: htmlCanvas.clientHeight,
        clientWidth: htmlCanvas.clientWidth,
        height: htmlCanvas.height,
        width: htmlCanvas.width,
      };
    });

    expect(canvasSize.clientWidth).toBe(viewport?.width);
    expect(canvasSize.clientHeight).toBe(viewport?.height);
    expect(canvasSize.width).toBeGreaterThan(0);
    expect(canvasSize.height).toBeGreaterThan(0);

    const kartPoint = await getKartScreenPoint(canvas);

    expect(kartPoint).not.toBeNull();
    expect(Math.abs((kartPoint?.x ?? 0) - (box?.width ?? 0) / 2)).toBeLessThan(
      (box?.width ?? 0) * 0.12,
    );
    expect(kartPoint?.y ?? 0).toBeGreaterThan((box?.height ?? 0) * 0.35);
    expect(kartPoint?.y ?? 0).toBeLessThan((box?.height ?? 0) * 0.78);
  });

  test("accelerates the solo kart through the tuned movement controller", async ({
    page,
  }) => {
    await page.goto("/");

    await page.getByRole("button", { name: "Solo Time Trial" }).click();

    const canvas = page.getByTestId("solo-time-trial-canvas");
    await expect(canvas).toBeVisible();

    await expect
      .poll(async () => getKartDebugState(canvas))
      .toMatchObject({ supportCount: 4 });
    const startState = await getKartDebugState(canvas);

    await canvas.click();
    await page.keyboard.down("ArrowUp");

    try {
      await expect
        .poll(async () => {
          const state = await getKartDebugState(canvas);

          return state.speed;
        })
        .toBeGreaterThan(startState.speed);
      await expect
        .poll(async () => {
          const state = await getKartDebugState(canvas);

          return Math.hypot(state.x - startState.x, state.z - startState.z);
        })
        .toBeGreaterThan(scaleReferenceKartLength(0.75));
    } finally {
      await page.keyboard.up("ArrowUp");
    }

    const movedState = await getKartDebugState(canvas);
    expect(movedState.speed).toBeGreaterThan(startState.speed);
    expect(Math.abs(movedState.y - startState.y)).toBeLessThan(
      scaleReferenceKartLength(0.1),
    );
    expect(Math.abs(movedState.verticalVelocity)).toBeLessThan(0.5);
    expect(
      Math.hypot(movedState.x - startState.x, movedState.z - startState.z),
    ).toBeGreaterThan(scaleReferenceKartLength(0.75));

    await page.keyboard.press("r");
    await expect
      .poll(async () => {
        const state = await getKartDebugState(canvas);
        return Math.hypot(state.x - startState.x, state.z - startState.z);
      })
      .toBeLessThan(scaleReferenceKartLength(0.1));
  });

  test("keeps the Handling Kart drivable through launch", async ({
    page,
  }) => {
    await useBundledHandlingKart(page);
    await page.goto("/");
    await page.getByRole("button", { name: "Solo Time Trial" }).click();

    const canvas = page.getByTestId("solo-time-trial-canvas");
    await advanceRaceToRacing(canvas);
    await canvas.click();
    await page.keyboard.down("ArrowUp");

    let samples: KartDebugState[] = [];
    try {
      samples = await stepSimulationWithKartSamples(
        canvas,
        Math.ceil(2 / DEFAULT_FIXED_STEP_SECONDS),
      );
    } finally {
      await page.keyboard.up("ArrowUp");
    }

    const minimumUpY = Math.min(...samples.map(({ up }) => up.y));
    let currentAirborneSteps = 0;
    let maximumAirborneSteps = 0;
    for (const { supportCount } of samples) {
      currentAirborneSteps = supportCount === 0 ? currentAirborneSteps + 1 : 0;
      maximumAirborneSteps = Math.max(
        maximumAirborneSteps,
        currentAirborneSteps,
      );
    }
    const maximumAngularSpeed = Math.max(
      ...samples.map(({ angularSpeed }) => angularSpeed),
    );
    const supportedStepRatio =
      samples.filter(({ supportCount }) => supportCount >= 2).length /
      samples.length;
    const finalState = samples.at(-1);
    const evidence = JSON.stringify({
      finalState,
      maximumAirborneSteps,
      maximumAngularSpeed,
      minimumUpY,
      supportedStepRatio,
    });

    expect(finalState?.speed, evidence).toBeGreaterThan(1);
    expect(finalState?.supportCount, evidence).toBeGreaterThanOrEqual(2);
    expect(minimumUpY, evidence).toBeGreaterThan(0.85);
    expect(supportedStepRatio, evidence).toBeGreaterThan(0.9);
    expect(maximumAirborneSteps, evidence).toBeLessThan(
      Math.ceil(0.1 / DEFAULT_FIXED_STEP_SECONDS),
    );
    expect(maximumAngularSpeed, evidence).toBeLessThan(5);
  });

  test("steers the front wheels while turning the solo kart", async ({
    page,
  }) => {
    await page.goto("/");

    await page.getByRole("button", { name: "Solo Time Trial" }).click();

    const canvas = page.getByTestId("solo-time-trial-canvas");
    await expect(canvas).toBeVisible();

    const startState = await getKartDebugState(canvas);

    await canvas.click();
    await page.keyboard.down("ArrowUp");
    await page.keyboard.down("ArrowLeft");

    let turnedState = await getKartDebugState(canvas);

    try {
      await expect
        .poll(async () => {
          turnedState = await getKartDebugState(canvas);

          return turnedState.steerAngle;
        })
        .toBeGreaterThan(0);
      await expect
        .poll(async () => {
          turnedState = await getKartDebugState(canvas);

          return Math.hypot(
            turnedState.x - startState.x,
            turnedState.z - startState.z,
          );
        })
        .toBeGreaterThan(0.5);
    } finally {
      await page.keyboard.up("ArrowLeft");
      await page.keyboard.up("ArrowUp");
    }

    expect(turnedState.steerAngle).toBeGreaterThan(0);
    expect(turnedState.steerAngle).toBeLessThanOrEqual(
      BALANCED_KART_SNAPSHOT.physicalProfile.steering.maximumCenterAngle,
    );
    expect(
      Math.hypot(turnedState.x - startState.x, turnedState.z - startState.z),
    ).toBeGreaterThan(0.5);
  });

  test("brakes before engaging reverse", async ({ page }) => {
    await page.goto("/");

    await page.getByRole("button", { name: "Solo Time Trial" }).click();

    const canvas = page.getByTestId("solo-time-trial-canvas");
    await waitForSceneReady(canvas);
    await canvas.click();
    await page.keyboard.down("ArrowUp");

    try {
      await expect
        .poll(async () => (await getKartDebugState(canvas)).speed)
        .toBeGreaterThan(2);
    } finally {
      await page.keyboard.up("ArrowUp");
    }

    const preBrakingLoads = (await getKartDebugState(canvas)).wheelLoads;
    const preBrakingFrontMinusRear =
      (preBrakingLoads["front-left"] ?? 0) +
      (preBrakingLoads["front-right"] ?? 0) -
      (preBrakingLoads["rear-left"] ?? 0) -
      (preBrakingLoads["rear-right"] ?? 0);

    await page.keyboard.down("ArrowDown");

    try {
      await expect
        .poll(async () => {
          const { wheelLoads } = await getKartDebugState(canvas);
          const frontLoad =
            (wheelLoads["front-left"] ?? 0) + (wheelLoads["front-right"] ?? 0);
          const rearLoad =
            (wheelLoads["rear-left"] ?? 0) + (wheelLoads["rear-right"] ?? 0);

          return frontLoad - rearLoad - preBrakingFrontMinusRear;
        })
        .toBeGreaterThan(40 * REFERENCE_KART_MASS_SCALE);
      await expect
        .poll(async () => (await getKartDebugState(canvas)).speed)
        .toBeLessThan(0.5);
      await expect
        .poll(async () => (await getKartDebugState(canvas)).speed)
        .toBeLessThan(-0.4);
    } finally {
      await page.keyboard.up("ArrowDown");
    }
  });

  test("shows derived construction, runtime behavior, and practical stats while testing", async ({
    page,
  }, testInfo) => {
    testInfo.setTimeout(60_000);
    await page.goto("/");
    await page.getByRole("button", { name: "Solo Time Trial" }).click();

    const canvas = page.getByTestId("solo-time-trial-canvas");
    const touchControls = page.getByRole("group", {
      name: "Touch driving controls",
    });
    if (testInfo.project.name === "mobile") {
      await expect(touchControls).toBeVisible();
    }
    await expect(
      page.getByRole("button", { name: "Kart stats" }),
    ).toHaveCount(0);
    await expect(canvas).toHaveAttribute("aria-keyshortcuts", "T");
    const tuningHint = page.getByText(/T · Stats/);
    if (testInfo.project.name === "desktop") {
      await expect(tuningHint).toBeVisible();
    } else {
      await expect(tuningHint).toBeHidden();
    }
    await waitForSceneReady(canvas);
    await canvas.focus();
    await page.keyboard.press("t");

    const drawer = page.getByRole("region", {
      name: "Kart stats",
    });
    const close = page.getByRole("button", { name: "Close" });
    await expect(drawer).toBeVisible();
    await expect(close).toBeFocused();
    await expect(
      drawer.getByRole("button", { name: /Derived construction/ }),
    ).toBeVisible();
    await expect(
      drawer.getByRole("button", { name: /Derived runtime behavior/ }),
    ).toBeVisible();
    await expect(
      drawer.getByRole("button", { name: /Practical stats/ }),
    ).toBeVisible();
    await expect(drawer).toContainText(
      `${BALANCED_KART_SNAPSHOT.massProperties.totalMass.toFixed(3)} kg`,
    );
    await expect(drawer).toContainText(
      `${BALANCED_KART_SNAPSHOT.physicalProfile.drivetrain.maximumDriveForce.toFixed(2)} N`,
    );
    for (const [label, value] of Object.entries(
      BALANCED_KART_SNAPSHOT.playerStats,
    )) {
      const stat = drawer.getByText(label, { exact: true }).locator("..");
      await expect(stat).toBeVisible();
      await expect(stat.getByText(`${value}/100`, { exact: true })).toBeVisible();
    }
    await expect(drawer).not.toContainText("Movement");
    await expect(drawer).not.toContainText("They cannot be overridden here.");
    await expect(drawer.locator('button[aria-label^="Explain "]')).toHaveCount(
      0,
    );
    if (testInfo.project.name === "mobile") {
      await expect(touchControls).toBeHidden();
    }
    await expect(page.getByRole("dialog", { name: "Paused" })).toHaveCount(0);
    const bounds = await drawer.boundingBox();
    const viewport = page.viewportSize();
    expect(bounds).not.toBeNull();
    expect(viewport).not.toBeNull();
    expect(bounds?.x ?? -1).toBeGreaterThanOrEqual(0);
    expect(bounds?.y ?? -1).toBeGreaterThanOrEqual(0);
    expect((bounds?.x ?? 0) + (bounds?.width ?? 0)).toBeLessThanOrEqual(
      viewport?.width ?? 0,
    );
    expect((bounds?.y ?? 0) + (bounds?.height ?? 0)).toBeLessThanOrEqual(
      viewport?.height ?? 0,
    );

    await expect((await getKartDebugState(canvas)).developmentValues).toEqual(
      BALANCED_KART_DEVELOPMENT_VALUES,
    );

    await close.click();
    await expect(drawer).toHaveCount(0);
    await expect(canvas).toBeFocused();
    await expect(
      page.getByRole("button", { name: "Kart stats" }),
    ).toHaveCount(0);
    if (testInfo.project.name === "mobile") {
      await expect(touchControls).toBeVisible();
    }

    await setSimulationPaused(canvas, false);
    await page.keyboard.press("t");
    await expect(drawer).toBeVisible();
    await page.keyboard.press("t");
    await expect(drawer).toHaveCount(0);
    await expect(canvas).toBeFocused();
    await page.keyboard.press("t");
    await expect(drawer).toBeVisible();
    await page.keyboard.press("Escape");
    await expect(page.getByRole("dialog", { name: "Paused" })).toBeVisible();
    await expect(drawer).toHaveCount(0);
    await expect(canvas).not.toHaveAttribute("aria-keyshortcuts");
    await page.getByRole("button", { name: "Resume" }).click();
    await expect(drawer).toHaveCount(0);
    await expect(canvas).toHaveAttribute("aria-keyshortcuts", "T");
    if (testInfo.project.name === "mobile") {
      await expect(touchControls).toBeVisible();
    }
  });

  test("resets an upside-down kart with orientation and momentum cleared", async ({
    page,
  }) => {
    await page.goto("/");

    await page.getByRole("button", { name: "Solo Time Trial" }).click();

    const canvas = page.getByTestId("solo-time-trial-canvas");
    await expect(canvas).toBeVisible();
    await advanceRaceToRacing(canvas);
    await setKartDebugPose(canvas, {
      angularVelocity: { x: 2, y: 1, z: 3 },
      linearVelocity: { x: 4, y: -8, z: 2 },
      position: { x: 38, y: -10.1, z: 8 },
      rotation: { x: 0, y: 0, z: 180 },
    });

    const fallingState = await getKartDebugState(canvas);

    expect(fallingState.isOverGround).toBe(false);
    expect(Math.abs(fallingState.rotationZ)).toBeGreaterThan(170);
    expect(fallingState.angularSpeed).toBeGreaterThan(1);

    await stepSimulation(canvas);

    const resetState = await getKartDebugState(canvas);

    expect(resetState.x).toBeCloseTo(
      BALANCED_KART_SNAPSHOT.massProperties.centerOfMass.z,
      2,
    );
    expect(resetState.y).toBeCloseTo(BALANCED_KART_UPRIGHT_ROOT_HEIGHT, 2);
    expect(resetState.z).toBeCloseTo(0, 2);
    // Euler angles are degenerate at 90° yaw, so compare quaternions.
    expect(angleFromYawDegrees(resetState.rotation, 90)).toBeLessThan(0.05);
    expect(Math.abs(resetState.verticalVelocity)).toBeLessThanOrEqual(
      resetState.developmentValues.gravity * DEFAULT_FIXED_STEP_SECONDS + 0.01,
    );
    expect(resetState.angularSpeed).toBeLessThan(0.05);
  });

  test("physically rights an upside-down kart in place across supported input", async ({
    page,
  }, testInfo) => {
    testInfo.setTimeout(60_000);
    await page.goto("/");
    await page.getByRole("button", { name: "Solo Time Trial" }).click();

    const canvas = page.getByTestId("solo-time-trial-canvas");
    await advanceRaceToRacing(canvas);
    await setSimulationPaused(canvas, true);
    await setKartDebugPose(canvas, {
      angularVelocity: { x: 0, y: 0, z: 0 },
      linearVelocity: { x: scaleReferenceKartLength(0.8), y: 0, z: 0 },
      position: {
        x: 4,
        y: scaleReferenceKartLength(0.46),
        z: 0,
      },
      rotation: { x: 0, y: 90, z: 180 },
    });
    await stepSimulation(canvas, 5);

    const inverted = await getKartDebugState(canvas);
    expect(inverted.up.y).toBeLessThan(-0.8);
    expect(inverted.manualRightingCount).toBe(0);
    expect(await getRaceDebugState(canvas)).toMatchObject({ state: "racing" });

    if (testInfo.project.name === "mobile") {
      const kartPoint = await getKartScreenPoint(canvas);
      const canvasBounds = await canvas.boundingBox();
      const tap = {
        button: 0,
        clientX: (canvasBounds?.x ?? 0) + (kartPoint?.x ?? 0),
        clientY: (canvasBounds?.y ?? 0) + (kartPoint?.y ?? 0),
        isPrimary: false,
        pointerId: 32,
        pointerType: "touch",
      };
      await canvas.dispatchEvent("pointerdown", tap);
      await canvas.dispatchEvent("pointerup", tap);
    } else {
      await canvas.focus();
      await page.keyboard.press("r");
    }

    await stepSimulation(canvas);
    const impulseState = await getKartDebugState(canvas);
    expect(impulseState.manualRightingCount).toBe(1);
    expect(impulseState.manualRightingCooldownSeconds).toBeGreaterThan(0);
    expect(impulseState.angularSpeed).toBeGreaterThan(0.2);
    expect(impulseState.up.y).toBeLessThan(0);
    expect(impulseState.x).toBeCloseTo(inverted.x, 0);
    expect(impulseState.z).toBeCloseTo(inverted.z, 0);
    expect(await getRaceDebugState(canvas)).toMatchObject({ state: "racing" });

    const rightingSamples = await stepSimulationWithKartSamples(canvas, 600);
    const upright = rightingSamples.find(
      (sample) => sample.up.y > 0.7 && sample.supportCount > 0,
    );
    expect(upright).toBeDefined();
    const settledUpright = rightingSamples.at(-1);
    expect(settledUpright?.up.y).toBeGreaterThan(0.7);
    expect(settledUpright?.supportCount).toBeGreaterThan(0);
    expect(Math.abs((upright?.x ?? 0) - inverted.x)).toBeLessThan(
      scaleReferenceKartLength(2),
    );
    expect(Math.abs((upright?.z ?? 0) - inverted.z)).toBeLessThan(
      scaleReferenceKartLength(2),
    );
    expect(await getRaceDebugState(canvas)).toMatchObject({ state: "racing" });

    if (testInfo.project.name === "desktop") {
      await setKartDebugPose(canvas, {
        angularVelocity: { x: 0, y: 0, z: 0 },
        linearVelocity: { x: 0, y: 0, z: 0 },
        position: {
          x: 4,
          y: REFERENCE_KART_UPRIGHT_ROOT_HEIGHT,
          z: 0,
        },
        rotation: { x: 0, y: 90, z: 0 },
      });
      await stepSimulation(canvas, 2);
      await page.keyboard.press("r");
      await stepSimulation(canvas);
      expect((await getKartDebugState(canvas)).manualRightingCount).toBe(1);
      expect(await getRaceDebugState(canvas)).toMatchObject({
        state: "recovering",
      });
    }
  });

  test("preserves airborne rotation and lands without an upright snap", async ({
    page,
  }) => {
    test.setTimeout(60_000);
    await page.goto("/");

    await page.getByRole("button", { name: "Solo Time Trial" }).click();

    const canvas = page.getByTestId("solo-time-trial-canvas");
    await setSimulationPaused(canvas, true);
    await setKartDebugPose(canvas, {
      angularVelocity: { x: 0, y: 0, z: 2 },
      linearVelocity: { x: 0, y: 0, z: 0 },
      position: { x: 0, y: 2, z: 8 },
      rotation: { x: 0, y: 0, z: 15 },
    });

    const launchState = await getKartDebugState(canvas);

    await stepSimulation(canvas, 6);

    const airborneState = await getKartDebugState(canvas);

    expect(airborneState.supportCount).toBe(0);
    expect(airborneState.y).toBeLessThan(launchState.y);
    expect(
      Math.abs(airborneState.rotationZ - launchState.rotationZ),
    ).toBeGreaterThan(4.5);

    const landingSamples = await stepSimulationWithKartSamples(canvas, 300);
    const landedState = landingSamples.at(-1)!;
    const maximumUpStep = Math.max(
      ...landingSamples
        .slice(1)
        .map((state, index) =>
          Math.abs(state.up.y - landingSamples[index].up.y),
        ),
    );

    expect(landedState.y).toBeLessThan(1);
    expect(Math.abs(landedState.verticalVelocity)).toBeLessThan(0.05);
    expect(landedState.angularSpeed).toBeLessThan(0.05);
    expect(maximumUpStep).toBeLessThan(0.35);
    expect(Math.abs(landedState.up.y)).toBeGreaterThan(0.9);
    if (landedState.up.y > 0) {
      expect(Math.abs(landedState.rotationZ)).toBeLessThan(10);
    } else {
      expect(Math.abs(landedState.rotationZ)).toBeGreaterThan(170);
    }
  });

  test("corrects the chase camera against the visible wall and releases it", async ({
    page,
  }) => {
    await page.goto("/");
    await page.getByRole("button", { name: "Solo Time Trial" }).click();

    const canvas = page.getByTestId("solo-time-trial-canvas");
    await setSimulationPaused(canvas, true);
    await setKartDebugPose(canvas, {
      position: { x: 0, y: REFERENCE_KART_UPRIGHT_ROOT_HEIGHT, z: -16.5 },
      rotation: { x: 0, y: 180, z: 0 },
    });

    const obstructedCamera = await getCameraDebugState(canvas);

    expect(obstructedCamera.obstructed).toBe(true);
    expect(obstructedCamera.obstructionDistance).not.toBeNull();
    expect(obstructedCamera.obstructionDistance).toBeLessThan(6);

    await setKartDebugPose(canvas, {
      position: { x: 0, y: REFERENCE_KART_UPRIGHT_ROOT_HEIGHT, z: -7 },
      rotation: { x: 0, y: 180, z: 0 },
    });

    const clearCamera = await getCameraDebugState(canvas);

    expect(clearCamera.obstructed).toBe(false);
    expect(clearCamera.obstructionDistance).toBeNull();
    expect(clearCamera.snapCount).toBeGreaterThan(obstructedCamera.snapCount);

    await setKartDebugPose(canvas, {
      position: { x: 0, y: REFERENCE_KART_UPRIGHT_ROOT_HEIGHT, z: -17 },
      rotation: { x: 0, y: 180, z: 0 },
    });

    const closeCamera = await getCameraDebugState(canvas);

    expect(closeCamera.obstructed).toBe(true);
    expect(closeCamera.obstructionDistance).not.toBeNull();
    expect(closeCamera.obstructionDistance).toBeGreaterThanOrEqual(0);
    expect(closeCamera.obstructionDistance).toBeLessThan(1);
  });

  test("registers course collision and lighting setup", async ({ page }) => {
    await page.route("**/api/courses/rough-course/published", async (route) => {
      await route.fulfill({
        body: JSON.stringify({ error: "Published course not found." }),
        contentType: "application/json",
        status: 404,
      });
    });
    await page.goto("/");

    await page.getByRole("button", { name: "Solo Time Trial" }).click();

    const canvas = page.getByTestId("solo-time-trial-canvas");
    const collisionState = await getCollisionDebugState(canvas);

    expect(collisionState.ambientLightR).toBeCloseTo(0.34);
    expect(collisionState.ambientLightG).toBeCloseTo(0.39);
    expect(collisionState.ambientLightB).toBeCloseTo(0.46);
    expect(collisionState.barrelCollisionAxis).toBe(1);
    expect(collisionState.barrelCollisionHeight).toBe(0.9);
    expect(collisionState.barrelCollisionRadius).toBe(0.45);
    expect(collisionState.barrelMaterialMapped).toBe(true);
    expect(collisionState.barrelPhysicsFriction).toBe(0.7);
    expect(collisionState.barrelPhysicsGroup).toBe(PHYSICS_GROUP.solidObstacle);
    expect(collisionState.barrelPhysicsMask).toBe(PHYSICS_MASK.solidObstacle);
    expect(collisionState.barrelPhysicsRestitution).toBe(0);
    expect(collisionState.courseEntityCount).toBe(13);
    expect(collisionState.directionalLightCount).toBe(2);
    expect(collisionState.keyLightIntensity).toBeCloseTo(0.78);
    expect(collisionState.keyLightRotationX).toBeCloseTo(52);
    expect(collisionState.keyLightRotationY).toBeCloseTo(38);
    expect(collisionState.keyLightCastsShadows).toBe(true);
    expect(collisionState.keyLightShadowResolution).toBe(1024);
    expect(collisionState.fillLightCastsShadows).toBe(false);
    expect(collisionState.groundCollisionShape).toBe("box");
    expect(collisionState.groundCollisionHalfExtentX).toBe(44);
    expect(collisionState.groundCollisionOffsetY).toBe(0.01);
    expect(collisionState.groundIsDrivable).toBe(true);
    expect(collisionState.obstacleAInteractionRadius).toBe(0.9);
    expect(collisionState.obstacleCount).toBe(2);
    expect(collisionState.rampCount).toBe(1);
    expect(collisionState.obstacleBlocksKart).toBe(true);
    expect(collisionState.startClear).toBe(true);
    expect(collisionState.startLineHasCollision).toBe(false);
    expect(collisionState.startLineHasRigidBody).toBe(false);
    expect(collisionState.startLineVisualCenterY).toBeCloseTo(0.05);
    expect(collisionState.startLineVisualThickness).toBeCloseTo(0.002);
    expect(collisionState.startMarkerVisualCenterY).toBeCloseTo(0.05);
    expect(collisionState.startMarkerVisualThickness).toBeCloseTo(0.002);
  });

  test("keeps CCD active above top speed across a thin barrier", async ({
    page,
  }) => {
    await page.goto("/?collision-fixtures");
    await page.getByRole("button", { name: "Solo Time Trial" }).click();

    const canvas = page.getByTestId("solo-time-trial-canvas");

    await setSimulationPaused(canvas, true);
    await setKartDebugPose(canvas, {
      linearVelocity: { x: -CCD_THIN_WALL_APPROACH_SPEED, y: 0, z: 0 },
      position: { x: -29.5, y: REFERENCE_KART_UPRIGHT_ROOT_HEIGHT, z: 24 },
      rotation: { x: 0, y: 90, z: 0 },
    });
    await stepSimulation(canvas, 30);

    const collision = await getCollisionResponseDebugState(canvas);
    const kart = await getKartDebugState(canvas);

    expect(collision.ccdMotionThreshold).toBeCloseTo(
      BALANCED_KART_CCD_CONFIGURATION.motionThreshold,
      2,
    );
    expect(collision.ccdSweptSphereRadius).toBeCloseTo(
      BALANCED_KART_CCD_CONFIGURATION.sweptSphereRadius,
      2,
    );
    expect(collision.contactedEntityNames).toContain("collision-ccd-thin-wall");
    expect(collision.maximumApproachSpeed).toBeGreaterThan(
      BALANCED_KART_DEVELOPMENT_VALUES.maxForwardSpeed,
    );
    expect(kart.x).toBeGreaterThan(
      CCD_THIN_WALL_APPROACH_CENTER_X -
        CCD_THIN_WALL_MAXIMUM_CONTACT_PENETRATION,
    );
    // The leading face never reaches the wall's far side.
    expect(kart.x - BALANCED_KART_COLLISION_HALF_EXTENT_Z).toBeGreaterThan(
      CCD_THIN_WALL_FAR_FACE_X,
    );
  });

  test("pauses and resumes from the mobile race HUD", async ({
    page,
  }, testInfo) => {
    test.skip(testInfo.project.name !== "mobile", "Mobile pause control only.");
    await page.setViewportSize({ height: 800, width: 1280 });

    await page.goto("/");
    await page.getByRole("button", { name: "Solo Time Trial" }).click();

    const canvas = page.getByTestId("solo-time-trial-canvas");
    await expect(canvas).toHaveAccessibleName("Solo Time Trial race");
    const pause = page.getByRole("button", { name: "Pause race" });
    await expect(pause).toBeVisible();
    const pauseBounds = await pause.boundingBox();
    expect(pauseBounds).not.toBeNull();
    expect(
      (pauseBounds?.x ?? 0) + (pauseBounds?.width ?? 0),
    ).toBeLessThanOrEqual(1280);
    await pause.click();
    const dialog = page.getByRole("dialog", { name: "Paused" });
    await expect(dialog).toBeVisible();
    await expect(dialog).toContainText("Resume when you're ready");
    const resume = dialog.getByRole("button", { name: "Resume" });
    const exit = dialog.getByRole("button", { name: "Exit" });
    await expect(resume).toBeFocused();
    await page.keyboard.press("Shift+Tab");
    await expect(exit).toBeFocused();
    await page.keyboard.press("Tab");
    await expect(resume).toBeFocused();

    await resume.click();
    await expect(page.getByText("Paused", { exact: true })).not.toBeVisible();
    await expect(canvas).toBeFocused();
    await expect(pause).toBeVisible();
  });

  test("recovers a lost WebGL context into an explicit pause and preserves resize state", async ({
    page,
  }, testInfo) => {
    test.skip(
      testInfo.project.name !== "desktop",
      "Graphics-context recovery only needs one Chromium coverage path.",
    );

    await page.goto("/");
    await page.getByRole("button", { name: "Solo Time Trial" }).click();
    const canvas = page.getByTestId("solo-time-trial-canvas");
    await waitForSceneReady(canvas);

    const contextLossSupported = await canvas.evaluate((element) => {
      const context = (element as HTMLCanvasElement).getContext("webgl2");
      const extension = context?.getExtension("WEBGL_lose_context");
      if (!extension) {
        return false;
      }
      (
        window as typeof window & {
          __TR_WEBGL_LOSE_CONTEXT__?: WEBGL_lose_context;
        }
      ).__TR_WEBGL_LOSE_CONTEXT__ = extension;
      extension.loseContext();
      return true;
    });
    test.skip(!contextLossSupported, "WEBGL_lose_context is unavailable.");

    await expect(
      page.getByText("Restoring graphics", { exact: true }),
    ).toBeVisible();
    await page.evaluate(() => {
      (
        window as typeof window & {
          __TR_WEBGL_LOSE_CONTEXT__?: WEBGL_lose_context;
        }
      ).__TR_WEBGL_LOSE_CONTEXT__?.restoreContext();
    });

    const pauseDialog = page.getByRole("dialog", { name: "Paused" });
    await expect(pauseDialog).toBeVisible();
    await expect
      .poll(async () => (await getRaceDebugState(canvas)).state)
      .toBe("paused");

    await page.setViewportSize({ height: 700, width: 900 });
    await expect
      .poll(() =>
        canvas.evaluate((element) => ({
          clientHeight: (element as HTMLCanvasElement).clientHeight,
          clientWidth: (element as HTMLCanvasElement).clientWidth,
          height: (element as HTMLCanvasElement).height,
          width: (element as HTMLCanvasElement).width,
        })),
      )
      .toEqual({
        clientHeight: 700,
        clientWidth: 900,
        height: 700,
        width: 900,
      });
    expect((await getRaceDebugState(canvas)).state).toBe("paused");

    await pauseDialog.getByRole("button", { name: "Resume" }).click();
    await expect(pauseDialog).not.toBeVisible();
  });

  test("falls back to reload or exit when a lost WebGL context does not restore", async ({
    page,
  }, testInfo) => {
    test.skip(
      testInfo.project.name !== "desktop",
      "Graphics-context failure only needs one Chromium coverage path.",
    );
    const telemetryEvents: unknown[] = [];
    await page.addInitScript(() => {
      (
        window as typeof window & {
          __TITAN_RACERS_SCENE_TEST__?: {
            contextRestoreTimeoutMs: number;
          };
          __TITAN_RACERS_TELEMETRY_TEST__?: boolean;
        }
      ).__TITAN_RACERS_SCENE_TEST__ = { contextRestoreTimeoutMs: 50 };
      (
        window as typeof window & {
          __TITAN_RACERS_TELEMETRY_TEST__?: boolean;
        }
      ).__TITAN_RACERS_TELEMETRY_TEST__ = true;
    });
    await page.route("**/api/telemetry/gameplay-runs", async (route) => {
      telemetryEvents.push(route.request().postDataJSON());
      await route.fulfill({ status: 202 });
    });

    await page.goto("/");
    await page.getByRole("button", { name: "Solo Time Trial" }).click();
    const canvas = page.getByTestId("solo-time-trial-canvas");
    await waitForSceneReady(canvas);
    const contextLossSupported = await canvas.evaluate((element) => {
      const extension = (element as HTMLCanvasElement)
        .getContext("webgl2")
        ?.getExtension("WEBGL_lose_context");
      extension?.loseContext();
      return Boolean(extension);
    });
    test.skip(!contextLossSupported, "WEBGL_lose_context is unavailable.");

    const failedAlert = page
      .getByRole("alert")
      .filter({ hasText: "Unable to continue the race" });
    await expect(failedAlert).toBeVisible();
    await expect(page.getByRole("button", { name: "Reload" })).toBeVisible();
    await expect(page.getByRole("button", { name: "Exit" })).toBeVisible();
    await expect(canvas).not.toHaveAttribute("data-scene-ready", "true");
    await expect
      .poll(() =>
        telemetryEvents.find(
          (event) =>
            typeof event === "object" &&
            event !== null &&
            "outcome" in event &&
            event.outcome === "runtime_failed",
        ),
      )
      .toMatchObject({
        failureCode: "webgl_context_lost",
        outcome: "runtime_failed",
        type: "run_ended",
      });
  });

  test("keeps the drive cursor hidden and restores it while paused", async ({
    page,
  }, testInfo) => {
    test.skip(
      testInfo.project.name === "mobile",
      "Touch viewports do not expose a persistent mouse cursor.",
    );

    await page.goto("/");
    await page.getByRole("button", { name: "Solo Time Trial" }).click();

    const canvas = page.getByTestId("solo-time-trial-canvas");
    await waitForSceneReady(canvas);
    await canvas.focus();
    await expect(canvas).toHaveCSS("cursor", "none");
    await expect(page.locator(".race-pause-button")).toBeHidden();

    await page.mouse.move(520, 320);
    await expect(canvas).toHaveCSS("cursor", "none");
    await page.keyboard.press("Escape");
    await expect(page.getByText("Paused", { exact: true })).toBeVisible();
    await expect(canvas).toHaveCSS("cursor", "default");
    await expect(page.getByRole("button", { name: "Edit" })).toHaveCount(0);

    await page.keyboard.press("Escape");
    await expect(page.getByText("Paused", { exact: true })).not.toBeVisible();
    await expect(canvas).toHaveCSS("cursor", "none");
    await page.waitForTimeout(250);
    await expect(page.getByText("Paused", { exact: true })).not.toBeVisible();
  });

  test("drives continuously in two axes with the touch joystick and accessible pedals", async ({
    page,
  }, testInfo) => {
    test.skip(testInfo.project.name !== "mobile", "Touch controls only.");

    await page.goto("/");
    await page.getByRole("button", { name: "Solo Time Trial" }).click();

    const canvas = page.getByTestId("solo-time-trial-canvas");
    await waitForSceneReady(canvas);
    await expect
      .poll(async () => getKartDebugState(canvas))
      .toMatchObject({ supportCount: 4 });

    const accelerate = page.getByRole("button", { name: "Accelerate" });
    const joystick = page.getByRole("group", { name: "Drive joystick" });
    const brake = page.getByRole("button", { name: "Brake / Reverse" });
    const reset = page.getByRole("button", { name: "Reset kart" });
    await expect(joystick).toHaveAccessibleDescription(/Touch gesture only:/);
    for (const control of [accelerate, joystick, brake, reset]) {
      const bounds = await control.boundingBox();
      expect(bounds?.width ?? 0).toBeGreaterThanOrEqual(44);
      expect(bounds?.height ?? 0).toBeGreaterThanOrEqual(44);
    }

    const start = await getKartDebugState(canvas);
    const joystickBounds = await joystick.boundingBox();
    const centerX = (joystickBounds?.x ?? 0) + (joystickBounds?.width ?? 0) / 2;
    const centerY =
      (joystickBounds?.y ?? 0) + (joystickBounds?.height ?? 0) / 2;
    const travel = (joystickBounds?.width ?? 0) * 0.3;
    const forwardVelocity = async () => {
      const state = await getKartDebugState(canvas);
      return (
        state.linearVelocity.x * state.forward.x +
        state.linearVelocity.y * state.forward.y +
        state.linearVelocity.z * state.forward.z
      );
    };

    await joystick.dispatchEvent("pointerdown", {
      buttons: 1,
      clientX: centerX + travel * 0.54,
      clientY: centerY - travel * 0.54,
      pointerId: 11,
      pointerType: "touch",
    });
    await expect(joystick).toHaveAttribute("data-active", "true");
    await expect
      .poll(async () => (await getKartDebugState(canvas)).speed)
      .toBeGreaterThan(start.speed + 0.5);
    await expect
      .poll(async () => Math.abs((await getKartDebugState(canvas)).steerAngle))
      .toBeGreaterThan(1);
    await joystick.dispatchEvent("pointerup", {
      pointerId: 11,
      pointerType: "touch",
    });
    await expect(joystick).toHaveAttribute("data-active", "false");
    await expect(joystick).toHaveAttribute("data-throttle", "0");

    await joystick.dispatchEvent("pointerdown", {
      buttons: 1,
      clientX: centerX - travel * 0.54,
      clientY: centerY,
      pointerId: 12,
      pointerType: "touch",
    });
    await expect(joystick).toHaveAttribute("data-steer", "-0.3");
    await joystick.dispatchEvent("pointercancel", {
      pointerId: 12,
      pointerType: "touch",
    });
    await expect(joystick).toHaveAttribute("data-steer", "0");

    await reset.click();
    await joystick.dispatchEvent("pointerdown", {
      buttons: 1,
      clientX: centerX,
      clientY: centerY + travel * 1.2,
      pointerId: 13,
      pointerType: "touch",
    });
    await expect(joystick).toHaveAttribute("data-throttle", "-1");
    await expect.poll(forwardVelocity).toBeLessThan(-0.5);
    await joystick.dispatchEvent("pointercancel", {
      pointerId: 13,
      pointerType: "touch",
    });

    await accelerate.focus();
    await page.keyboard.down("Space");
    await expect(accelerate).toHaveAttribute("aria-pressed", "true");
    await page.keyboard.up("Space");
    await expect(accelerate).toHaveAttribute("aria-pressed", "false");
    await joystick.focus();
    await page.keyboard.down("ArrowLeft");
    await expect(joystick).toHaveAttribute("data-steer", "-1");
    await page.keyboard.up("ArrowLeft");

    await page.setViewportSize({ height: 450, width: 900 });
    const landscapeJoystick = await joystick.boundingBox();
    const landscapeAccelerate = await accelerate.boundingBox();
    expect(
      (landscapeJoystick?.y ?? 0) + (landscapeJoystick?.height ?? 0),
    ).toBeLessThanOrEqual(450);
    expect(
      (landscapeJoystick?.x ?? 0) + (landscapeJoystick?.width ?? 0),
    ).toBeLessThan(landscapeAccelerate?.x ?? 900);
  });

  test("drives and pauses with a standard-mapped controller snapshot", async ({
    page,
  }, testInfo) => {
    test.skip(
      testInfo.project.name === "mobile",
      "Controller desktop fixture.",
    );

    await installStandardGamepadFixture(page);
    await page.goto("/");
    await page.getByRole("button", { name: "Solo Time Trial" }).click();

    const canvas = page.getByTestId("solo-time-trial-canvas");
    await waitForSceneReady(canvas);
    await expect
      .poll(async () => getKartDebugState(canvas))
      .toMatchObject({ supportCount: 4 });
    const start = await getKartDebugState(canvas);

    await setStandardTestGamepad(page, {
      axes: [0.55, 0, 0, 0],
      buttons: { 7: 1 },
    });
    await expect
      .poll(async () => (await getKartDebugState(canvas)).speed)
      .toBeGreaterThan(start.speed + 0.5);
    await expect
      .poll(async () => Math.abs((await getKartDebugState(canvas)).steerAngle))
      .toBeGreaterThan(1);

    await setStandardTestGamepad(page, { buttons: { 0: 1 } });
    await expect
      .poll(async () => {
        const state = await getKartDebugState(canvas);
        return Math.hypot(state.x - start.x, state.z - start.z);
      })
      .toBeLessThan(0.1);

    await setStandardTestGamepad(page);
    await page.waitForTimeout(100);
    await setStandardTestGamepad(page, { buttons: { 9: 1 } });
    const pauseDialog = page.getByRole("dialog", { name: "Paused" });
    await expect(pauseDialog).toBeVisible();
    await pauseDialog.getByRole("button", { name: "Resume" }).click();
    await page.waitForTimeout(250);
    await expect(pauseDialog).not.toBeVisible();
  });

  test("opens protected editors from the home screen with a controller", async ({
    page,
  }, testInfo) => {
    test.skip(
      testInfo.project.name === "mobile",
      "Controller desktop fixture.",
    );

    await installStandardGamepadFixture(page);
    await page.goto("/");
    const home = page.locator('[data-controller-menu-ready="true"]');
    await expect(home).toHaveCount(1);
    await setStandardTestGamepad(page);
    await page.waitForTimeout(50);
    await setStandardTestGamepad(page, { buttons: { 12: 1 } });
    const menuButton = page.getByRole("button", { name: "Open utility menu" });
    await expect(menuButton).toBeFocused();
    await setStandardTestGamepad(page);
    await page.waitForTimeout(50);
    await setStandardTestGamepad(page, { buttons: { 0: 1 } });
    await expect(
      page.getByRole("button", { name: "Close utility menu" }),
    ).toBeFocused();
    await setStandardTestGamepad(page);
    await page.waitForTimeout(50);
    await setStandardTestGamepad(page, { buttons: { 1: 1 } });
    await expect(
      page.getByRole("button", { name: "Open utility menu" }),
    ).toBeFocused();
    await expect(
      page.getByRole("link", { name: "Course Editor" }),
    ).toHaveCount(0);
    await setStandardTestGamepad(page);
    await page.waitForTimeout(50);
    await setStandardTestGamepad(page, { buttons: { 0: 1 } });
    await expect(
      page.getByRole("button", { name: "Close utility menu" }),
    ).toBeFocused();
    const courseEditor = page.getByRole("link", { name: "Course Editor" });
    const kartBuilder = page.getByRole("link", { name: "Kart Builder" });
    const profile = page.getByRole("link", { name: "Profile" });
    await setStandardTestGamepad(page);
    await page.waitForTimeout(50);
    await setStandardTestGamepad(page, { buttons: { 13: 1 } });
    await expect(profile).toBeFocused();
    await setStandardTestGamepad(page);
    await page.waitForTimeout(50);
    await setStandardTestGamepad(page, { buttons: { 13: 1 } });
    await expect(kartBuilder).toBeFocused();
    await setStandardTestGamepad(page);
    await page.waitForTimeout(50);
    await setStandardTestGamepad(page, { buttons: { 13: 1 } });
    await expect(courseEditor).toBeFocused();
    await setStandardTestGamepad(page);
    await page.waitForTimeout(50);
    await expect(home).toHaveAttribute("data-controller-navigation", "true");
    await expect(courseEditor).toHaveCSS("cursor", "none");

    await page.mouse.move(4, 4);
    await expect(home).toHaveAttribute(
      "data-controller-pointer-active",
      "true",
    );
    await expect(home).not.toHaveAttribute(
      "data-controller-pointer-active",
      "true",
      { timeout: 2_000 },
    );

    await page.evaluate(() => window.dispatchEvent(new Event("blur")));
    await expect(home).not.toHaveAttribute(
      "data-controller-navigation",
      "true",
    );
    await setStandardTestGamepad(page);
    await page.waitForTimeout(50);
    await setStandardTestGamepad(page, { buttons: { 12: 1 } });
    await expect(kartBuilder).toBeFocused();
    await expect(home).toHaveAttribute("data-controller-navigation", "true");
    await setStandardTestGamepad(page);
    await page.waitForTimeout(50);
    await disconnectStandardTestGamepad(page);
    await expect(home).not.toHaveAttribute(
      "data-controller-navigation",
      "true",
    );
    await setStandardTestGamepad(page);
    await page.waitForTimeout(50);
    await setStandardTestGamepad(page, { buttons: { 13: 1 } });
    await expect(courseEditor).toBeFocused();
    await setStandardTestGamepad(page);
    await page.waitForTimeout(50);
    await setStandardTestGamepad(page, { buttons: { 0: 1 } });
    await expect(page).toHaveURL(/\/editor$/);
  });

  test("requires neutral controller input after pointer ownership", async ({
    page,
  }, testInfo) => {
    test.skip(
      testInfo.project.name === "mobile",
      "Controller desktop fixture.",
    );

    await installStandardGamepadFixture(page);
    await page.goto("/");
    const home = page.locator('[data-controller-menu-ready="true"]');
    await expect(home).toHaveCount(1);
    await page.getByRole("button", { name: "Open utility menu" }).click();
    const courseEditor = page.getByRole("link", { name: "Course Editor" });
    const kartBuilder = page.getByRole("link", { name: "Kart Builder" });
    await courseEditor.focus();
    await setStandardTestGamepad(page);
    await page.waitForTimeout(50);

    await courseEditor.evaluate((element) => {
      const testWindow = window as typeof window & {
        __TR_GAMEPADS__?: Gamepad[];
      };
      const gamepad = testWindow.__TR_GAMEPADS__?.[0];
      if (!gamepad) throw new Error("Expected a standard test gamepad.");
      const buttons = [...gamepad.buttons] as Array<{
        pressed: boolean;
        touched: boolean;
        value: number;
      }>;
      buttons[12] = { pressed: true, touched: true, value: 1 };
      testWindow.__TR_GAMEPADS__ = [{ ...gamepad, buttons } as Gamepad];
      element.dispatchEvent(
        new PointerEvent("pointerdown", {
          bubbles: true,
          pointerType: "mouse",
        }),
      );
    });

    await expect(home).not.toHaveAttribute(
      "data-controller-navigation",
      "true",
    );
    await page.waitForTimeout(500);
    await expect(courseEditor).toBeFocused();

    await setStandardTestGamepad(page);
    await page.waitForTimeout(50);
    await setStandardTestGamepad(page, { buttons: { 12: 1 } });
    await expect(kartBuilder).toBeFocused();
  });

  test("navigates guest menus end-to-end with a standard controller snapshot", async ({
    page,
  }, testInfo) => {
    test.skip(
      testInfo.project.name === "mobile",
      "Controller desktop fixture.",
    );

    await installStandardGamepadFixture(page);
    await page.goto("/");
    await expect(
      page.locator('[data-controller-menu-ready="true"]'),
    ).toHaveCount(1);
    await setStandardTestGamepad(page);
    await page.waitForTimeout(50);

    const soloTimeTrial = page.getByRole("button", {
      name: "Solo Time Trial",
    });
    await setStandardTestGamepad(page, { buttons: { 13: 1 } });
    await expect(soloTimeTrial).toBeFocused();
    await setStandardTestGamepad(page);
    await page.waitForTimeout(50);
    await setStandardTestGamepad(page, { buttons: { 0: 1 } });

    const canvas = page.getByTestId("solo-time-trial-canvas");
    await expect(canvas).toBeVisible();
    await setStandardTestGamepad(page);
    await waitForSceneReady(canvas);
    await page.waitForTimeout(50);

    const pauseDialog = page.getByRole("dialog", { name: "Paused" });
    const resume = pauseDialog.getByRole("button", { name: "Resume" });
    const exit = pauseDialog.getByRole("button", { name: "Exit" });

    await setStandardTestGamepad(page, { buttons: { 9: 1 } });
    await expect(pauseDialog).toBeVisible();
    await expect(
      pauseDialog.locator('[data-controller-menu-ready="true"]'),
    ).toHaveCount(1);
    await expect(resume).toHaveCSS("outline-style", "solid");
    await expect(resume).toHaveCSS("outline-width", "2px");
    await setStandardTestGamepad(page);
    await page.waitForTimeout(50);

    await setStandardTestGamepad(page, { buttons: { 13: 1 } });
    await expect(exit).toBeFocused();
    await setStandardTestGamepad(page);
    await page.waitForTimeout(50);
    await setStandardTestGamepad(page, { buttons: { 13: 1 } });
    await expect(resume).toBeFocused();
    await setStandardTestGamepad(page);
    await page.waitForTimeout(50);
    await setStandardTestGamepad(page, { buttons: { 0: 1 } });
    await expect(pauseDialog).not.toBeVisible();
    await setStandardTestGamepad(page);
    await page.waitForTimeout(100);

    await setStandardTestGamepad(page, { buttons: { 9: 1 } });
    await expect(pauseDialog).toBeVisible();
    await setStandardTestGamepad(page);
    await page.waitForTimeout(50);
    await setStandardTestGamepad(page, { buttons: { 1: 1 } });
    await expect(pauseDialog).not.toBeVisible();
    await setStandardTestGamepad(page);
    await page.waitForTimeout(100);

    await setStandardTestGamepad(page, { buttons: { 9: 1 } });
    await expect(pauseDialog).toBeVisible();
    await setStandardTestGamepad(page);
    await page.waitForTimeout(50);
    await setStandardTestGamepad(page, { buttons: { 13: 1 } });
    await expect(exit).toBeFocused();
    await setStandardTestGamepad(page);
    await page.waitForTimeout(50);
    await setStandardTestGamepad(page, { buttons: { 0: 1 } });
    await expect(
      page.getByRole("button", { name: "Solo Time Trial" }),
    ).toBeVisible();
  });

});

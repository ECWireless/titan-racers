import { expect, type Locator, type Page, test } from "@playwright/test";

import { ROUGH_COURSE_DOCUMENT } from "../src/game/course/course-document";
import {
  DEFAULT_KART_DEVELOPMENT_VALUES,
  KART_DEVELOPMENT_VALUE_METADATA,
  type KartDevelopmentValues,
} from "../src/game/kart/kart-development-values";
import { KART_SUSPENSION_REST_TRAVEL } from "../src/game/kart/kart-dimensions";
import {
  REFERENCE_KART_CONSTRUCTION,
  REFERENCE_KART_MASS_SCALE,
  REFERENCE_KART_TIME_SCALE,
  REFERENCE_KART_UPRIGHT_ROOT_HEIGHT,
  scaleReferenceKartLength,
} from "../src/game/kart/kart-reference-construction";
import { STEERING_CENTER_TO_FULL_RESPONSE_SECONDS } from "../src/game/kart/kart-steering";
import type {
  KartDebugState,
  RaceDebugState,
} from "../src/game/testing/scene-test-adapter";
import { DEFAULT_FIXED_STEP_SECONDS } from "../src/game/runtime/fixed-step-clock";

import {
  PHYSICS_GROUP,
  PHYSICS_MASK,
} from "../src/game/physics/collision-groups";

// Angular rates scale inversely with the reference fixture's Froude time.
// Preserve the Phase 2 collision-response envelopes after the miniature
// conversion instead of comparing the smaller kart to full-size rates.
const MAX_CONTROLLED_COLLISION_ANGULAR_SPEED =
  15 / REFERENCE_KART_TIME_SCALE;
const MAX_FAST_COLLISION_ANGULAR_SPEED = 25 / REFERENCE_KART_TIME_SCALE;

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
        cameraPosition: { x: number; y: number; z: number };
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
        trailingDistance: number;
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

async function getSuspensionDebugState(canvas: Locator) {
  await waitForSceneReady(canvas);

  return canvas.evaluate(
    (element) =>
      new Promise<{
        maximumCompression: number;
        maximumSupportedWheels: number;
        minimumChassisClearance: number;
        minimumSupportedWheels: number;
      }>((resolve) => {
        element.dispatchEvent(
          new CustomEvent("getSuspensionDebugState", {
            detail: { respond: resolve },
          }),
        );
      }),
  );
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

async function setKartDevelopmentValues(
  canvas: Locator,
  values: Partial<KartDevelopmentValues>,
) {
  await waitForSceneReady(canvas);
  await canvas.evaluate((element, requestedValues) => {
    element.dispatchEvent(
      new CustomEvent("setKartDevelopmentValues", {
        detail: { values: requestedValues },
      }),
    );
  }, values);
}

async function setStartPosition(
  canvas: Locator,
  position: { x: number; z: number },
) {
  await waitForSceneReady(canvas);
  await canvas.evaluate((element, requestedPosition) => {
    element.dispatchEvent(
      new CustomEvent("setStartPosition", {
        detail: { position: requestedPosition },
      }),
    );
  }, position);
}

async function setCourseObjectDebugTransform(
  canvas: Locator,
  objectId: "obstacle-barrel-a" | "obstacle-barrel-b",
  transform: {
    position?: { x: number; y: number; z: number };
    rotation?: { x: number; y: number; z: number };
  },
) {
  await waitForSceneReady(canvas);
  await canvas.evaluate(
    (element, request) => {
      element.dispatchEvent(
        new CustomEvent("setCourseObjectDebugTransform", {
          detail: request,
        }),
      );
    },
    { objectId, transform },
  );
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

test.describe("home screen", () => {
  test.describe.configure({ mode: "serial" });
  test.beforeEach(async ({ page }) => {
    await useBundledRoughCourse(page);
  });

  test("shows player-first mode selection with coming soon feedback", async ({
    page,
  }) => {
    await page.goto("/");

    await expect(page.getByAltText("Titan Racers")).toBeVisible();
    await expect(page.getByText("Choose game mode")).toBeVisible();
    await expect(
      page.getByRole("link", { name: "Course Editor" }),
    ).toBeVisible();
    await expect(page.getByRole("link", { name: "Telemetry" })).toHaveCount(0);

    const raceFriends = page.getByRole("button", { name: "Race Friends" });
    const soloTimeTrial = page.getByRole("button", { name: "Solo Time Trial" });

    await expect(raceFriends).toBeVisible();
    await expect(soloTimeTrial).toBeVisible();

    await raceFriends.click();
    await expect(page.getByRole("status")).toHaveText("coming soon");
  });

  test("opens the full-screen solo time trial canvas", async ({ page }) => {
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
    testInfo.setTimeout(180_000);
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
    const initialRace = await getRaceDebugState(canvas);
    await stepSimulation(
      canvas,
      Math.ceil(
        initialRace.countdownRemainingMicroseconds /
          (DEFAULT_FIXED_STEP_SECONDS * 1_000_000),
      ) + 1,
    );
    await expect
      .poll(async () => (await getRaceDebugState(canvas)).state)
      .toBe("racing");
    const raceStatus = page.getByRole("region", { name: "Race status" });
    const raceAnnouncement = page.getByRole("status");
    const lifecycleCue = page.locator(".race-lifecycle-cue span");
    await expect(raceStatus).toContainText("Lap01/02");
    await expect(raceStatus).toContainText("Race time0:00.0");
    await expect(raceStatus).not.toContainText("Gates");
    await expect(lifecycleCue).toHaveText("Go!");
    await expect(lifecycleCue).toHaveCSS(
      "animation-name",
      "race-lifecycle-cue-reveal",
    );
    await page.emulateMedia({ reducedMotion: "reduce" });
    await expect(lifecycleCue).toHaveCSS("animation-name", "none");
    await page.emulateMedia({ reducedMotion: "no-preference" });

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

    expect(
      (await crossRaceTarget(canvas, checkpoints[1])).lastProgressionResult,
    ).toEqual({
      kind: "rejected",
      reason: "out-of-order",
      targetId: checkpoints[1].id,
    });
    expect(
      (await crossRaceTarget(canvas, startTarget)).lastProgressionResult,
    ).toEqual({
      kind: "rejected",
      reason: "finish-before-checkpoints",
    });
    await expect(raceAnnouncement).toHaveText("Lap route incomplete");
    await stepSimulation(canvas, 2);
    await expect(raceAnnouncement).toHaveText("Lap route incomplete");

    let race = await crossRaceTarget(canvas, checkpoints[0]);
    expect(race).toMatchObject({
      activeRecovery: { id: checkpoints[0].id },
      currentLap: 1,
      expectedTargetId: checkpoints[1].id,
      lastProgressionResult: {
        checkpointId: checkpoints[0].id,
        kind: "checkpoint",
      },
    });
    expect(
      (await crossRaceTarget(canvas, checkpoints[0])).lastProgressionResult,
    ).toEqual({
      kind: "rejected",
      reason: "repeated",
      targetId: checkpoints[0].id,
    });

    for (const [index, checkpoint] of checkpoints.entries()) {
      if (index === 0) {
        continue;
      }

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
    expect(race).toMatchObject({
      currentLap: 2,
      expectedTargetId: checkpoints[0].id,
      lastProgressionResult: { kind: "lap", lap: 1 },
      state: "racing",
    });
    await expect(raceStatus).toContainText("Lap02/02");
    await expect(lifecycleCue).toHaveText("Lap 2");
    await expect(lifecycleCue).toHaveCSS(
      "animation-name",
      "race-lifecycle-cue-reveal",
    );
    await expect(raceAnnouncement).toHaveText("Lap 2 of 2");
    await stepSimulation(canvas, 2);
    await expect(raceAnnouncement).toHaveText("Lap 2 of 2");

    for (const [index, checkpoint] of checkpoints.entries()) {
      race = await crossRaceTarget(
        canvas,
        checkpoint,
        checkpointOffsets[index],
      );
      expect(race.lastProgressionResult.kind).toBe("checkpoint");
    }
    await setKartDebugPose(canvas, {
      angularVelocity: { x: 2, y: 3, z: 1 },
      linearVelocity: { x: 4, y: 2, z: -3 },
      position: { x: 25, y: 3, z: 25 },
      rotation: { x: 12, y: 40, z: -8 },
    });
    await setStandardTestGamepad(page, { buttons: { 9: 1 } });
    race = await crossRaceTarget(
      canvas,
      startTarget,
      { x: 0, y: 0, z: 0 },
      true,
    );
    expect(race).toMatchObject({
      completedLapMicroseconds: [expect.any(Number), expect.any(Number)],
      expectedTargetId: null,
      lastProgressionResult: { kind: "finished", lap: 2 },
      state: "finished",
    });
    const finishedKart = await getKartDebugState(canvas);
    expect(
      Math.hypot(
        finishedKart.linearVelocity.x,
        finishedKart.linearVelocity.y,
        finishedKart.linearVelocity.z,
      ),
    ).toBeGreaterThan(1);
    expect(
      Math.hypot(
        finishedKart.angularVelocity.x,
        finishedKart.angularVelocity.y,
        finishedKart.angularVelocity.z,
      ),
    ).toBeGreaterThan(1);
    const finishDialog = page.getByRole("dialog", { name: "Finish" });
    const pauseDialog = page.getByRole("dialog", { name: "Paused" });
    await expect(finishDialog).toBeVisible();
    await expect(pauseDialog).not.toBeVisible();
    await expect(raceAnnouncement).toHaveText(/^Race finished in 0:/);
    const lapTimes = finishDialog.getByRole("listitem");
    await expect(lapTimes).toHaveCount(2);
    await expect(lapTimes.first()).toContainText("Lap 1");
    await expect(lapTimes.last()).toContainText("Lap 2");
    const raceAgain = finishDialog.getByRole("button", {
      name: "Race again",
    });
    const finishExit = finishDialog.getByRole("button", { name: "Exit" });
    await expect(raceAgain).toBeFocused();
    await setStandardTestGamepad(page);
    await expect(
      finishDialog.locator('[data-controller-menu-ready="true"]'),
    ).toHaveCount(1);
    await page.waitForTimeout(50);
    await setStandardTestGamepad(page, { buttons: { 13: 1 } });
    await expect(finishExit).toBeFocused();
    await setStandardTestGamepad(page);
    await page.waitForTimeout(50);
    await setStandardTestGamepad(page, { buttons: { 13: 1 } });
    await expect(raceAgain).toBeFocused();
    await setStandardTestGamepad(page);
    await page.waitForTimeout(50);
    await setSimulationPaused(canvas, false);
    await page.evaluate(() => window.dispatchEvent(new Event("blur")));
    await setStandardTestGamepad(page, { buttons: { 0: 1, 7: 1 } });
    await expect(finishDialog).not.toBeVisible();
    await expect
      .poll(async () => (await getRaceDebugState(canvas)).state)
      .toBe("countdown");
    const restartedCountdown = (await getRaceDebugState(canvas))
      .countdownRemainingMicroseconds;
    await expect(raceStatus).toContainText("Lap01/02");
    await expect(raceStatus).not.toContainText("Gates");
    await expect(canvas).toBeFocused();

    const restartedKart = await getKartDebugState(canvas);
    const restartedPresentation = await getPresentationDebugState(canvas);
    expect(restartedKart).toMatchObject({
      linearVelocity: { x: 0, y: 0, z: 0 },
      speed: 0,
      verticalVelocity: 0,
    });
    expect(restartedKart.angularSpeed).toBeLessThan(0.02);
    expect(Math.abs(restartedKart.angularVelocity.x)).toBeLessThan(0.02);
    expect(Math.abs(restartedKart.angularVelocity.y)).toBeLessThan(0.02);
    expect(Math.abs(restartedKart.angularVelocity.z)).toBeLessThan(0.02);
    expect(Math.abs(restartedKart.x - initialKart.x)).toBeLessThan(
      scaleReferenceKartLength(0.1),
    );
    expect(Math.abs(restartedKart.z - initialKart.z)).toBeLessThan(
      scaleReferenceKartLength(0.1),
    );
    expect(restartedKart.forward.x).toBeCloseTo(initialKart.forward.x, 1);
    expect(restartedKart.forward.y).toBeCloseTo(initialKart.forward.y, 1);
    expect(restartedKart.forward.z).toBeCloseTo(initialKart.forward.z, 1);
    expect(restartedPresentation.cameraTrackedPosition).toEqual(
      restartedPresentation.visualPosition,
    );

    await expect
      .poll(
        async () =>
          (await getRaceDebugState(canvas)).countdownRemainingMicroseconds,
      )
      .toBeLessThan(restartedCountdown);

    await advanceRaceToRacing(canvas);
    await stepSimulation(canvas, 20);
    expect((await getKartDebugState(canvas)).speed).toBeLessThan(0.5);
    await setStandardTestGamepad(page);
    await stepSimulation(canvas);

    for (let lap = 0; lap < 2; lap += 1) {
      for (const [index, checkpoint] of checkpoints.entries()) {
        await crossRaceTarget(canvas, checkpoint, checkpointOffsets[index]);
      }
      race = await crossRaceTarget(canvas, startTarget);
    }
    expect(race.state).toBe("finished");
    await expect(finishDialog).toBeVisible();
    await setStandardTestGamepad(page);
    await expect(
      finishDialog.locator('[data-controller-menu-ready="true"]'),
    ).toHaveCount(1);
    await page.waitForTimeout(50);
    await setStandardTestGamepad(page, { buttons: { 1: 1 } });
    await expect(
      page.getByRole("button", { name: "Solo Time Trial" }),
    ).toBeVisible();
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

  test("settles at rest without chassis drift or rotation", async ({
    page,
  }) => {
    await page.goto("/");

    await page.getByRole("button", { name: "Solo Time Trial" }).click();

    const canvas = page.getByTestId("solo-time-trial-canvas");

    await expect
      .poll(async () => getKartDebugState(canvas))
      .toMatchObject({ supportCount: 4 });

    const settledState = await getKartDebugState(canvas);

    await page.waitForTimeout(1_500);

    const laterState = await getKartDebugState(canvas);

    expect(
      Math.hypot(laterState.x - settledState.x, laterState.z - settledState.z),
    ).toBeLessThan(0.03);
    expect(Math.abs(laterState.y - settledState.y)).toBeLessThan(0.03);
    expect(laterState.angularSpeed).toBeLessThan(0.08);
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
    expect(turnedState.steerAngle).toBeLessThanOrEqual(18);
    expect(
      Math.hypot(turnedState.x - startState.x, turnedState.z - startState.z),
    ).toBeGreaterThan(0.5);
  });

  test("applies speed-sensitive steering authority in the live controller", async ({
    page,
  }) => {
    await page.goto("/");
    await page.getByRole("button", { name: "Solo Time Trial" }).click();

    const canvas = page.getByTestId("solo-time-trial-canvas");
    await advanceRaceToRacing(canvas);
    await setSimulationPaused(canvas, true);

    const baseline = await getKartDebugState(canvas);
    const position = { x: 0, y: REFERENCE_KART_UPRIGHT_ROOT_HEIGHT, z: -12 };
    const rotation = {
      x: baseline.rotationX,
      y: baseline.rotationY,
      z: baseline.rotationZ,
    };

    for (const [speed, expectedMaximum] of [
      [0, 18],
      [8.5, 3.74],
      [17, 2.62],
    ] as const) {
      await setKartDebugPose(canvas, {
        linearVelocity: {
          x: baseline.forward.x * speed,
          y: 0,
          z: baseline.forward.z * speed,
        },
        position,
        rotation,
      });
      await stepSimulation(canvas);

      const state = await getKartDebugState(canvas);
      expect(state.speed).toBeCloseTo(speed, 1);
      expect(state.maximumSteerAngle).toBeCloseTo(expectedMaximum, 1);
    }

    await canvas.click();
    await page.keyboard.down("ArrowLeft");
    try {
      await stepSimulation(canvas, 4);
    } finally {
      await page.keyboard.up("ArrowLeft");
    }

    const highSpeedSteering = await getKartDebugState(canvas);
    expect(highSpeedSteering.steerAngle).toBeGreaterThan(0);
    expect(highSpeedSteering.maximumSteerAngle).toBeGreaterThan(2.4);
    expect(highSpeedSteering.maximumSteerAngle).toBeLessThan(8);
    expect(highSpeedSteering.steerAngle).toBeLessThanOrEqual(
      highSpeedSteering.maximumSteerAngle,
    );
  });

  test("steers the inside and outside front wheels through Ackermann geometry", async ({
    page,
  }) => {
    await page.goto("/");
    await page.getByRole("button", { name: "Solo Time Trial" }).click();

    const canvas = page.getByTestId("solo-time-trial-canvas");
    await advanceRaceToRacing(canvas);
    await setSimulationPaused(canvas, true);
    await canvas.click();
    await page.keyboard.down("ArrowLeft");
    try {
      await stepSimulation(
        canvas,
        Math.ceil(
          STEERING_CENTER_TO_FULL_RESPONSE_SECONDS /
            DEFAULT_FIXED_STEP_SECONDS,
        ) + 1,
      );
    } finally {
      await page.keyboard.up("ArrowLeft");
    }

    const state = await getKartDebugState(canvas);
    const leftAngle = state.wheelSteerAngles["front-left"] ?? 0;
    const rightAngle = state.wheelSteerAngles["front-right"] ?? 0;
    const centerRadians = (state.steerAngle * Math.PI) / 180;
    const { trackWidth, wheelbase } =
      REFERENCE_KART_CONSTRUCTION.steeringGeometry;
    const centerTurnRadius = wheelbase / Math.tan(centerRadians);
    const expectedInnerAngle =
      (Math.atan(wheelbase / (centerTurnRadius - trackWidth / 2)) * 180) /
      Math.PI;
    const expectedOuterAngle =
      (Math.atan(wheelbase / (centerTurnRadius + trackWidth / 2)) * 180) /
      Math.PI;

    expect(state.steerAngle).toBeCloseTo(18, 1);
    expect(leftAngle).toBeCloseTo(expectedInnerAngle, 1);
    expect(rightAngle).toBeCloseTo(expectedOuterAngle, 1);
    expect(leftAngle).toBeGreaterThan(rightAngle);
    expect(state.wheelSteerAngles["rear-left"]).toBe(0);
    expect(state.wheelSteerAngles["rear-right"]).toBe(0);
  });

  test("holds a stable powered turn above half speed without brake input", async ({
    page,
  }) => {
    await page.goto("/");
    await page.getByRole("button", { name: "Solo Time Trial" }).click();

    const canvas = page.getByTestId("solo-time-trial-canvas");
    await advanceRaceToRacing(canvas);
    await setSimulationPaused(canvas, true);
    const baseline = await getKartDebugState(canvas);
    await setKartDebugPose(canvas, {
      angularVelocity: { x: 0, y: 0, z: 0 },
      linearVelocity: { x: 0, y: 0, z: 0 },
      position: { x: 40, y: REFERENCE_KART_UPRIGHT_ROOT_HEIGHT, z: -12 },
      rotation: {
        x: baseline.rotationX,
        y: baseline.rotationY,
        z: baseline.rotationZ,
      },
    });
    await stepSimulation(
      canvas,
      Math.ceil(REFERENCE_KART_TIME_SCALE / DEFAULT_FIXED_STEP_SECONDS),
    );
    await canvas.click();
    await page.keyboard.down("ArrowUp");
    await stepSimulation(
      canvas,
      Math.ceil(3 / DEFAULT_FIXED_STEP_SECONDS),
    );
    const preTurnState = await getKartDebugState(canvas);
    expect(
      preTurnState.speed,
      JSON.stringify(preTurnState),
    ).toBeGreaterThan(
      preTurnState.maxForwardSpeed * 0.5,
    );
    await page.keyboard.down("ArrowLeft");

    let samples: KartDebugState[] = [];
    try {
      samples = await stepSimulationWithKartSamples(
        canvas,
        Math.ceil(
          (2.5 * REFERENCE_KART_TIME_SCALE) / DEFAULT_FIXED_STEP_SECONDS,
        ),
      );
    } finally {
      await page.keyboard.up("ArrowLeft");
      await page.keyboard.up("ArrowUp");
    }

    let maximumChassisSlip = 0;
    let maximumRearSlip = 0;
    let maximumAngularSpeed = 0;
    let maximumNonYawAngularSpeed = 0;
    let maximumVerticalSpeed = 0;
    let maximumY = Number.NEGATIVE_INFINITY;
    let minimumChassisClearance = Number.POSITIVE_INFINITY;
    let minimumSupportCount = 4;
    let minimumUpY = 1;
    let minimumContactNormalY = 1;
    let minimumY = Number.POSITIVE_INFINITY;
    let supportedSampleCount = 0;
    for (const state of samples) {
      const right = {
        x: state.forward.y * state.up.z - state.forward.z * state.up.y,
        y: state.forward.z * state.up.x - state.forward.x * state.up.z,
        z: state.forward.x * state.up.y - state.forward.y * state.up.x,
      };
      const longitudinalSpeed =
        state.linearVelocity.x * state.forward.x +
        state.linearVelocity.y * state.forward.y +
        state.linearVelocity.z * state.forward.z;
      const lateralSpeed =
        state.linearVelocity.x * right.x +
        state.linearVelocity.y * right.y +
        state.linearVelocity.z * right.z;
      maximumChassisSlip = Math.max(
        maximumChassisSlip,
        Math.atan2(Math.abs(lateralSpeed), Math.max(longitudinalSpeed, 0.1)),
      );
      maximumRearSlip = Math.max(
        maximumRearSlip,
        state.wheelSlipAngles["rear-left"] ?? 0,
        state.wheelSlipAngles["rear-right"] ?? 0,
      );
      maximumY = Math.max(maximumY, state.y);
      maximumAngularSpeed = Math.max(maximumAngularSpeed, state.angularSpeed);
      const yawAngularSpeed =
        state.angularVelocity.x * state.up.x +
        state.angularVelocity.y * state.up.y +
        state.angularVelocity.z * state.up.z;
      maximumNonYawAngularSpeed = Math.max(
        maximumNonYawAngularSpeed,
        Math.hypot(
          state.angularVelocity.x - state.up.x * yawAngularSpeed,
          state.angularVelocity.y - state.up.y * yawAngularSpeed,
          state.angularVelocity.z - state.up.z * yawAngularSpeed,
        ),
      );
      maximumVerticalSpeed = Math.max(
        maximumVerticalSpeed,
        Math.abs(state.verticalVelocity),
      );
      minimumChassisClearance = Math.min(
        minimumChassisClearance,
        state.chassisClearance,
      );
      minimumSupportCount = Math.min(minimumSupportCount, state.supportCount);
      minimumUpY = Math.min(minimumUpY, state.up.y);
      Object.values(state.wheelContactNormals).forEach((normal) => {
        if (normal) {
          minimumContactNormalY = Math.min(minimumContactNormalY, normal.y);
        }
      });
      minimumY = Math.min(minimumY, state.y);
      if (state.supportCount >= 2) {
        supportedSampleCount += 1;
      }
    }

    const finalState = samples.at(-1);
    const firstIncompleteSupportState = samples.find(
      (state) => state.supportCount < 4,
    );
    const firstAirborneState = samples.find(
      (state) => state.supportCount === 0,
    );
    const maximumAngularState = samples.reduce((maximum, state) =>
      state.angularSpeed > maximum.angularSpeed ? state : maximum,
    );
    const supportedSampleRatio = supportedSampleCount / samples.length;
    const evidence = JSON.stringify({
      actualTurnRadius: finalState?.actualTurnRadius,
      finalSpeed: finalState?.speed,
      finalSupportCount: finalState?.supportCount,
      firstAirborneState,
      firstIncompleteSupportState,
      geometricTurnRadius: finalState?.geometricTurnRadius,
      maximumChassisSlip,
      maximumAngularSpeed,
      maximumAngularState,
      maximumNonYawAngularSpeed,
      maximumRearSlip,
      maximumVerticalSpeed,
      minimumChassisClearance,
      minimumSupportCount,
      minimumUpY,
      minimumContactNormalY,
      suspensionReboundRange: maximumY - minimumY,
      supportedSampleRatio,
      yawRate: finalState?.yawRate,
    });
    expect(finalState?.geometricTurnRadius, evidence).not.toBeNull();
    expect(finalState?.actualTurnRadius, evidence).not.toBeNull();
    expect(Math.abs(finalState?.yawRate ?? 0), evidence).toBeGreaterThan(0.01);
    expect(
      Math.abs(
        (finalState?.actualTurnRadius ?? 0) -
          Math.abs((finalState?.speed ?? 0) / (finalState?.yawRate ?? 1)),
      ),
      evidence,
    ).toBeLessThanOrEqual(
      Math.max((finalState?.actualTurnRadius ?? 0) * 0.02, 0.2),
    );
    expect(maximumChassisSlip, evidence).toBeLessThan(12 * (Math.PI / 180));
    expect(maximumRearSlip, evidence).toBeLessThan(15 * (Math.PI / 180));
    expect(finalState?.speed, evidence).toBeGreaterThan(2);
    expect(minimumUpY, evidence).toBeGreaterThan(0.8);
    expect(minimumContactNormalY, evidence).toBeGreaterThan(0.9);
    expect(minimumSupportCount, evidence).toBeGreaterThanOrEqual(2);
    expect(maximumNonYawAngularSpeed, evidence).toBeLessThan(1.25);
    expect(maximumVerticalSpeed, evidence).toBeLessThanOrEqual(0.1);
    expect(maximumY - minimumY, evidence).toBeLessThan(
      scaleReferenceKartLength(0.08),
    );
    expect(supportedSampleRatio, evidence).toBe(1);
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

  test("transfers suspension load rearward under acceleration", async ({
    page,
  }) => {
    await page.goto("/");

    await page.getByRole("button", { name: "Solo Time Trial" }).click();

    const canvas = page.getByTestId("solo-time-trial-canvas");
    await waitForSceneReady(canvas);
    await canvas.click();
    await page.keyboard.down("ArrowUp");

    try {
      await expect
        .poll(async () => {
          const { wheelLoads } = await getKartDebugState(canvas);
          const rearLoad =
            (wheelLoads["rear-left"] ?? 0) + (wheelLoads["rear-right"] ?? 0);
          const frontLoad =
            (wheelLoads["front-left"] ?? 0) + (wheelLoads["front-right"] ?? 0);

          return rearLoad - frontLoad;
        })
        .toBeGreaterThan(40 * REFERENCE_KART_MASS_SCALE);
    } finally {
      await page.keyboard.up("ArrowUp");
    }
  });

  test("loses speed faster to aerodynamic drag at higher coasting speed", async ({
    page,
  }) => {
    await page.goto("/");
    await page.getByRole("button", { name: "Solo Time Trial" }).click();

    const canvas = page.getByTestId("solo-time-trial-canvas");
    await advanceRaceToRacing(canvas);
    await setSimulationPaused(canvas, true);
    const baseline = await getKartDebugState(canvas);

    async function measureSpeedLoss(initialSpeed: number) {
      await setKartDebugPose(canvas, {
        angularVelocity: { x: 0, y: 0, z: 0 },
        linearVelocity: {
          x: baseline.forward.x * initialSpeed,
          y: 0,
          z: baseline.forward.z * initialSpeed,
        },
        position: { x: 0, y: REFERENCE_KART_UPRIGHT_ROOT_HEIGHT, z: -12 },
        rotation: {
          x: baseline.rotationX,
          y: baseline.rotationY,
          z: baseline.rotationZ,
        },
      });
      await stepSimulation(canvas, 60);

      return initialSpeed - (await getKartDebugState(canvas)).speed;
    }

    const lowSpeedLoss = await measureSpeedLoss(4);
    const highSpeedLoss = await measureSpeedLoss(14);

    expect(lowSpeedLoss).toBeGreaterThan(0);
    expect(highSpeedLoss).toBeGreaterThan(lowSpeedLoss * 1.35);
  });

  test("accelerates toward but remains below the motor no-load speed", async ({
    page,
  }) => {
    await page.goto("/");

    await page.getByRole("button", { name: "Solo Time Trial" }).click();

    const canvas = page.getByTestId("solo-time-trial-canvas");
    await advanceRaceToRacing(canvas);
    await setKartDebugPose(canvas, {
      angularVelocity: { x: 0, y: 0, z: 0 },
      linearVelocity: { x: 0, y: 0, z: 0 },
      position: { x: 0, y: REFERENCE_KART_UPRIGHT_ROOT_HEIGHT, z: 0 },
      rotation: { x: 0, y: 90, z: 0 },
    });
    await stepSimulation(
      canvas,
      Math.ceil(1 / DEFAULT_FIXED_STEP_SECONDS),
    );
    await canvas.click();
    await page.keyboard.down("ArrowUp");

    let samples: KartDebugState[] = [];
    try {
      samples = await stepSimulationWithKartSamples(
        canvas,
        Math.ceil(3 / DEFAULT_FIXED_STEP_SECONDS),
      );
    } finally {
      await page.keyboard.up("ArrowUp");
    }

    const state = await getKartDebugState(canvas);
    const minimumSupportCount = Math.min(
      ...samples.map((sample) => sample.supportCount),
    );
    const minimumUpY = Math.min(...samples.map((sample) => sample.up.y));
    const maximumAngularSpeed = Math.max(
      ...samples.map((sample) => sample.angularSpeed),
    );
    const maximumVerticalSpeed = Math.max(
      ...samples.map((sample) => Math.abs(sample.verticalVelocity)),
    );
    const minimumY = Math.min(...samples.map((sample) => sample.y));
    const maximumY = Math.max(...samples.map((sample) => sample.y));
    const highSpeedSamples = samples.filter(
      (sample) => Math.abs(sample.speed) >= sample.maxForwardSpeed * 0.5,
    );
    const highSpeedMinimumClearance = Math.min(
      ...highSpeedSamples.map((sample) => sample.chassisClearance),
    );
    const highSpeedMaximumAngularSpeed = Math.max(
      ...highSpeedSamples.map((sample) => sample.angularSpeed),
    );
    const highSpeedMaximumVerticalSpeed = Math.max(
      ...highSpeedSamples.map((sample) => Math.abs(sample.verticalVelocity)),
    );
    const highSpeedMinimumY = Math.min(
      ...highSpeedSamples.map((sample) => sample.y),
    );
    const highSpeedMaximumY = Math.max(
      ...highSpeedSamples.map((sample) => sample.y),
    );
    const highSpeedHubRanges = Object.fromEntries(
      ["front-left", "front-right", "rear-left", "rear-right"].map(
        (wheelName) => {
          const values = highSpeedSamples.map(
            (sample) => sample.wheelHubYs[wheelName] ?? 0,
          );
          return [wheelName, Math.max(...values) - Math.min(...values)];
        },
      ),
    );
    const highSpeedSupportSignatures = [
      ...new Set(
        highSpeedSamples.map((sample) =>
          [...sample.supportEntityNames].sort().join("|"),
        ),
      ),
    ];
    const firstDroppedSupport = samples.find(
      (sample) => sample.supportCount < 4,
    );
    const maximumAngularState = samples.reduce((maximum, sample) =>
      sample.angularSpeed > maximum.angularSpeed ? sample : maximum,
    );
    const stabilityEvidence = JSON.stringify({
      final: state,
      firstDroppedSupport,
      highSpeedHubRanges,
      highSpeedMaximumAngularSpeed,
      highSpeedMaximumVerticalSpeed,
      highSpeedMinimumClearance,
      highSpeedSupportSignatures,
      highSpeedVerticalRange: highSpeedMaximumY - highSpeedMinimumY,
      maximumAngularSpeed,
      maximumAngularState,
      maximumVerticalSpeed,
      minimumSupportCount,
      minimumUpY,
      verticalRange: maximumY - minimumY,
    });
    expect(state.up.y, stabilityEvidence).toBeGreaterThan(0.9);
    expect(state.angularSpeed, stabilityEvidence).toBeLessThan(1);
    expect(
      Math.abs(state.y - REFERENCE_KART_UPRIGHT_ROOT_HEIGHT),
      stabilityEvidence,
    ).toBeLessThan(scaleReferenceKartLength(0.5));
    expect(minimumSupportCount, stabilityEvidence).toBe(4);
    expect(minimumUpY, stabilityEvidence).toBeGreaterThan(0.9);
    expect(maximumAngularSpeed, stabilityEvidence).toBeLessThan(1);
    expect(maximumVerticalSpeed, stabilityEvidence).toBeLessThan(0.5);
    expect(maximumY - minimumY, stabilityEvidence).toBeLessThan(
      scaleReferenceKartLength(0.25),
    );
    expect(state.speed, stabilityEvidence).toBeGreaterThan(
      state.maxForwardSpeed * 0.7,
    );
    expect(state.speed).toBeLessThan(state.maxForwardSpeed);
  });

  test("reverses toward but remains below the motor no-load speed", async ({
    page,
  }) => {
    await page.goto("/");

    await page.getByRole("button", { name: "Solo Time Trial" }).click();

    const canvas = page.getByTestId("solo-time-trial-canvas");
    await advanceRaceToRacing(canvas);
    await setKartDebugPose(canvas, {
      angularVelocity: { x: 0, y: 0, z: 0 },
      linearVelocity: { x: 0, y: 0, z: 0 },
      position: { x: -43, y: REFERENCE_KART_UPRIGHT_ROOT_HEIGHT, z: -12 },
      rotation: { x: 0, y: 90, z: 0 },
    });
    await stepSimulation(
      canvas,
      Math.ceil(1 / DEFAULT_FIXED_STEP_SECONDS),
    );
    await canvas.click();
    await page.keyboard.down("ArrowDown");

    try {
      await stepSimulation(
        canvas,
        Math.ceil(5 / DEFAULT_FIXED_STEP_SECONDS),
      );
      const state = await getKartDebugState(canvas);

      const stabilityEvidence = JSON.stringify(state);
      expect(state.up.y, stabilityEvidence).toBeGreaterThan(0.9);
      expect(state.angularSpeed, stabilityEvidence).toBeLessThan(1);
      expect(
        Math.abs(state.y - REFERENCE_KART_UPRIGHT_ROOT_HEIGHT),
      ).toBeLessThan(scaleReferenceKartLength(0.5));
      expect(state.developmentValues.maxForwardSpeed).toBe(17);
      expect(-state.speed).toBeGreaterThan(
        state.developmentValues.maxForwardSpeed * 0.75,
      );
      expect(-state.speed).toBeLessThan(state.developmentValues.maxForwardSpeed);

      const camera = await getCameraDebugState(canvas);

      expect(camera.maximumSpeed).toBe(17);
      expect(camera.forwardSpeed).toBeLessThan(-1);
      expect(camera.trailingDistance).toBeGreaterThanOrEqual(
        scaleReferenceKartLength(7.5) - 0.01,
      );

      const cameraToKart = {
        x: state.x - camera.cameraPosition.x,
        y: state.y - camera.cameraPosition.y,
        z: state.z - camera.cameraPosition.z,
      };
      const viewDirection = {
        x: camera.lookTarget.x - camera.cameraPosition.x,
        y: camera.lookTarget.y - camera.cameraPosition.y,
        z: camera.lookTarget.z - camera.cameraPosition.z,
      };
      const kartViewDepth =
        cameraToKart.x * viewDirection.x +
        cameraToKart.y * viewDirection.y +
        cameraToKart.z * viewDirection.z;

      expect(kartViewDepth).toBeGreaterThan(0);
    } finally {
      await page.keyboard.up("ArrowDown");
    }
  });

  test("steers while driving in reverse", async ({ page }) => {
    await page.goto("/");

    await page.getByRole("button", { name: "Solo Time Trial" }).click();

    const canvas = page.getByTestId("solo-time-trial-canvas");
    await advanceRaceToRacing(canvas);
    await setKartDebugPose(canvas, {
      position: { x: 0, y: REFERENCE_KART_UPRIGHT_ROOT_HEIGHT, z: -12 },
      rotation: { x: 0, y: 90, z: 0 },
    });
    await stepSimulation(canvas, 5);
    const startState = await getKartDebugState(canvas);

    await canvas.click();
    await page.keyboard.down("ArrowDown");
    await page.keyboard.down("ArrowLeft");

    try {
      await stepSimulation(canvas, 120);
    } finally {
      await page.keyboard.up("ArrowLeft");
      await page.keyboard.up("ArrowDown");
    }

    const reversedState = await getKartDebugState(canvas);

    expect(reversedState.supportCount).toBe(4);
    expect(reversedState.speed).toBeLessThan(-1);
    expect(reversedState.steerAngle).toBeGreaterThan(5);
    expect(
      Math.abs(reversedState.rotationY - startState.rotationY),
    ).toBeGreaterThan(3);
  });

  test("saturates then sheds lateral slip with lateral load transfer", async ({
    page,
  }) => {
    await page.goto("/");

    await page.getByRole("button", { name: "Solo Time Trial" }).click();

    const canvas = page.getByTestId("solo-time-trial-canvas");
    await setSimulationPaused(canvas, true);
    await setKartDebugPose(canvas, {
      linearVelocity: { x: 0, y: 0, z: 5 },
      position: { x: 0, y: scaleReferenceKartLength(0.33), z: -12 },
      rotation: { x: 0, y: 90, z: 0 },
    });
    const slidingSamples = await stepSimulationWithKartSamples(
      canvas,
      Math.ceil(0.25 / DEFAULT_FIXED_STEP_SECONDS),
    );

    const slidingState = slidingSamples.reduce((maximum, sample) =>
      sample.maximumLateralSpeed > maximum.maximumLateralSpeed
        ? sample
        : maximum,
    );
    const peakLateralLoadDifference = Math.max(
      ...slidingSamples.map((sample) => {
        const leftLoad =
          (sample.wheelLoads["front-left"] ?? 0) +
          (sample.wheelLoads["rear-left"] ?? 0);
        const rightLoad =
          (sample.wheelLoads["front-right"] ?? 0) +
          (sample.wheelLoads["rear-right"] ?? 0);

        return Math.abs(leftLoad - rightLoad);
      }),
    );
    const slidingEvidence = JSON.stringify({
      peakLateralLoadDifference,
      samples: slidingSamples.filter((_, index) => index % 5 === 0),
      slidingState,
    });

    expect(
      slidingState.supportCount,
      `sliding=${JSON.stringify(slidingState)}`,
    ).toBeGreaterThanOrEqual(3);
    expect(slidingState.maximumLateralSpeed).toBeGreaterThanOrEqual(2.8);
    expect(slidingState.maximumTireForceUtilization).toBe(1);
    expect(slidingState.saturatedTireCount).toBeGreaterThan(0);
    expect(
      peakLateralLoadDifference,
      slidingEvidence,
    ).toBeGreaterThan(40 * REFERENCE_KART_MASS_SCALE);

    await stepSimulation(
      canvas,
      Math.ceil(2 / DEFAULT_FIXED_STEP_SECONDS),
    );

    const recoveredState = await getKartDebugState(canvas);
    const recoveryEvidence = JSON.stringify({
      recoveredState,
      slidingState,
    });

    expect(recoveredState.supportCount, recoveryEvidence).toBe(4);
    expect(recoveredState.maximumLateralSpeed, recoveryEvidence).toBeLessThan(
      slidingState.maximumLateralSpeed * 0.35,
    );
    expect(recoveredState.maximumSlipAngle, recoveryEvidence).toBeLessThan(
      slidingState.maximumSlipAngle * 0.35,
    );
    expect(recoveredState.driftSmokeWheelNames, recoveryEvidence).toHaveLength(
      0,
    );
  });

  test("keeps service braking stable while handbraking creates controllable rear slip", async ({
    page,
  }, testInfo) => {
    testInfo.setTimeout(60_000);
    await page.goto("/");
    await page.getByRole("button", { name: "Solo Time Trial" }).click();

    const canvas = page.getByTestId("solo-time-trial-canvas");
    await advanceRaceToRacing(canvas);
    await setSimulationPaused(canvas, true);
    const baseline = await getKartDebugState(canvas);
    const baselineRightY =
      baseline.forward.z * baseline.up.x - baseline.forward.x * baseline.up.z;
    const baselineRollDegrees =
      Math.asin(Math.min(Math.max(baselineRightY, -1), 1)) * (180 / Math.PI);

    async function runScenario(keys: string[]) {
      await setKartDebugPose(canvas, {
        angularVelocity: { x: 0, y: 0, z: 0 },
        linearVelocity: {
          x: baseline.forward.x * 14,
          y: 0,
          z: baseline.forward.z * 14,
        },
        position: { x: 0, y: REFERENCE_KART_UPRIGHT_ROOT_HEIGHT, z: -12 },
        rotation: {
          x: baseline.rotationX,
          y: baseline.rotationY,
          z: baseline.rotationZ,
        },
      });
      await canvas.click();
      for (const key of keys) {
        await page.keyboard.down(key);
      }

      let maximumFrontSlip = 0;
      let maximumChassisLateralSpeed = 0;
      let maximumLateralLoadDifference = 0;
      let maximumRearSlip = 0;
      let maximumRearTireForceUtilization = 0;
      let maximumRollChange = 0;
      let maximumSmokeLevel = 0;
      let maximumSlip = 0;
      let maximumSuspensionDifference = 0;
      let maximumYawChange = 0;
      let maximumYawStepChange = 0;
      let previousYaw = baseline.rotationY;
      let retainedPlanarSpeed = 0;
      let smokeLevelTotal = 0;
      const smokeWheelNames = new Set<string>();
      try {
        const states = await stepSimulationWithKartSamples(canvas, 60);
        for (const state of states) {
          retainedPlanarSpeed = Math.hypot(
            state.linearVelocity.x,
            state.linearVelocity.z,
          );
          const currentRight = {
            x: state.forward.y * state.up.z - state.forward.z * state.up.y,
            y: state.forward.z * state.up.x - state.forward.x * state.up.z,
            z: state.forward.x * state.up.y - state.forward.y * state.up.x,
          };
          maximumChassisLateralSpeed = Math.max(
            maximumChassisLateralSpeed,
            Math.abs(
              state.linearVelocity.x * currentRight.x +
                state.linearVelocity.y * currentRight.y +
                state.linearVelocity.z * currentRight.z,
            ),
          );
          state.driftSmokeWheelNames.forEach((wheelName) =>
            smokeWheelNames.add(wheelName),
          );
          maximumSmokeLevel = Math.max(
            maximumSmokeLevel,
            ...Object.values(state.driftSmokeLevels),
          );
          smokeLevelTotal += Object.values(state.driftSmokeLevels).reduce(
            (total, level) => total + level,
            0,
          );
          maximumSlip = Math.max(maximumSlip, state.maximumSlipAngle);
          maximumFrontSlip = Math.max(
            maximumFrontSlip,
            state.wheelSlipAngles["front-left"] ?? 0,
            state.wheelSlipAngles["front-right"] ?? 0,
          );
          maximumRearSlip = Math.max(
            maximumRearSlip,
            state.wheelSlipAngles["rear-left"] ?? 0,
            state.wheelSlipAngles["rear-right"] ?? 0,
          );
          maximumRearTireForceUtilization = Math.max(
            maximumRearTireForceUtilization,
            state.wheelTireForceUtilizations["rear-left"] ?? 0,
            state.wheelTireForceUtilizations["rear-right"] ?? 0,
          );
          const leftLoad =
            (state.wheelLoads["front-left"] ?? 0) +
            (state.wheelLoads["rear-left"] ?? 0);
          const rightLoad =
            (state.wheelLoads["front-right"] ?? 0) +
            (state.wheelLoads["rear-right"] ?? 0);
          maximumLateralLoadDifference = Math.max(
            maximumLateralLoadDifference,
            Math.abs(leftLoad - rightLoad),
          );
          const leftHubY =
            ((state.wheelHubYs["front-left"] ?? 0) +
              (state.wheelHubYs["rear-left"] ?? 0)) /
            2;
          const rightHubY =
            ((state.wheelHubYs["front-right"] ?? 0) +
              (state.wheelHubYs["rear-right"] ?? 0)) /
            2;
          maximumSuspensionDifference = Math.max(
            maximumSuspensionDifference,
            Math.abs(leftHubY - rightHubY),
          );
          const rollDegrees =
            Math.asin(Math.min(Math.max(currentRight.y, -1), 1)) *
            (180 / Math.PI);
          const rollChange = Math.abs(rollDegrees - baselineRollDegrees);
          maximumRollChange = Math.max(maximumRollChange, rollChange);
          const yawChange = Math.abs(
            ((((state.rotationY - baseline.rotationY + 180) % 360) + 360) %
              360) -
              180,
          );
          maximumYawChange = Math.max(maximumYawChange, yawChange);
          const yawStepChange = Math.abs(
            ((((state.rotationY - previousYaw + 180) % 360) + 360) % 360) - 180,
          );
          maximumYawStepChange = Math.max(maximumYawStepChange, yawStepChange);
          previousYaw = state.rotationY;
        }
      } finally {
        for (const key of [...keys].reverse()) {
          await page.keyboard.up(key);
        }
      }

      return {
        maximumChassisLateralSpeed,
        maximumFrontSlip,
        maximumLateralLoadDifference,
        maximumRearSlip,
        maximumRearTireForceUtilization,
        maximumRollChange,
        maximumSmokeLevel,
        maximumSlip,
        maximumSuspensionDifference,
        maximumYawChange,
        maximumYawStepChange,
        retainedPlanarSpeed,
        smokeLevelTotal,
        smokeWheelNames: [...smokeWheelNames],
      };
    }

    const natural = await runScenario(["ArrowUp", "ArrowLeft"]);
    const serviceBrake = await runScenario([
      "ArrowUp",
      "ArrowDown",
      "ArrowLeft",
    ]);
    const handbrake = await runScenario(["ArrowUp", "ArrowLeft", "Shift"]);
    const evidence = JSON.stringify({ handbrake, natural, serviceBrake });
    const peakSlipAngle =
      DEFAULT_KART_DEVELOPMENT_VALUES.peakSlipAngleDegrees * (Math.PI / 180);

    expect(natural.maximumSlip, evidence).toBeGreaterThan(0.02);
    // A transient ordinary turn may cross the exact force peak without
    // approaching the later sliding plateau. Keep that overshoot bounded while
    // the scenario comparisons below prove the handbrake remains distinct.
    expect(natural.maximumSlip, evidence).toBeLessThan(peakSlipAngle * 1.5);
    expect(handbrake.maximumRearSlip, evidence).toBeGreaterThan(
      serviceBrake.maximumRearSlip * 1.5,
    );
    expect(handbrake.maximumRearTireForceUtilization, evidence).toBeGreaterThanOrEqual(
      0.995,
    );
    expect(
      serviceBrake.maximumChassisLateralSpeed,
      evidence,
    ).toBeLessThan(natural.maximumChassisLateralSpeed * 0.8);
    expect(handbrake.maximumChassisLateralSpeed, evidence).toBeGreaterThan(
      serviceBrake.maximumChassisLateralSpeed * 2,
    );
    expect(serviceBrake.retainedPlanarSpeed, evidence).toBeGreaterThan(7.5);
    expect(handbrake.retainedPlanarSpeed, evidence).toBeGreaterThan(11);
    expect(handbrake.maximumSmokeLevel, evidence).toBeGreaterThanOrEqual(1);
    expect(handbrake.maximumYawChange, evidence).toBeGreaterThan(
      natural.maximumYawChange * 1.8,
    );
    expect(handbrake.maximumYawChange, evidence).toBeLessThan(
      natural.maximumYawChange * 3.5,
    );
    expect(serviceBrake.maximumYawStepChange, evidence).toBeLessThan(2);
    expect(handbrake.maximumYawStepChange, evidence).toBeLessThan(2);
    expect(handbrake.maximumRollChange, evidence).toBeGreaterThan(0.25);
    expect(handbrake.maximumRollChange, evidence).toBeLessThan(20);
    expect(handbrake.maximumLateralLoadDifference, evidence).toBeGreaterThan(
      80 * REFERENCE_KART_MASS_SCALE,
    );
    expect(handbrake.maximumSuspensionDifference, evidence).toBeGreaterThan(
      scaleReferenceKartLength(0.015),
    );
    expect(serviceBrake.smokeWheelNames, evidence).toEqual([]);
    expect(handbrake.smokeWheelNames.length, evidence).toBeGreaterThan(0);
    expect(
      handbrake.smokeWheelNames.every((wheelName) =>
        wheelName.startsWith("rear"),
      ),
      evidence,
    ).toBe(true);

    await resetKart(canvas);
    expect((await getKartDebugState(canvas)).driftSmokeWheelNames).toEqual([]);
  });

  test("releases rear slip faster after handbrake release and counter-steer", async ({
    page,
  }) => {
    await page.goto("/");
    await page.getByRole("button", { name: "Solo Time Trial" }).click();

    const canvas = page.getByTestId("solo-time-trial-canvas");
    await advanceRaceToRacing(canvas);
    await setSimulationPaused(canvas, true);
    const baseline = await getKartDebugState(canvas);

    const getRearSlip = (state: KartDebugState) =>
      Math.max(
        state.wheelSlipAngles["rear-left"] ?? 0,
        state.wheelSlipAngles["rear-right"] ?? 0,
      );
    const average = (values: number[]) =>
      values.reduce((total, value) => total + value, 0) / values.length;

    async function runRecovery(
      recoverySegments: Array<{ keys: string[]; steps: number }>,
    ) {
      await setKartDebugPose(canvas, {
        angularVelocity: { x: 0, y: 0, z: 0 },
        linearVelocity: {
          x: baseline.forward.x * 14,
          y: 0,
          z: baseline.forward.z * 14,
        },
        position: { x: 0, y: REFERENCE_KART_UPRIGHT_ROOT_HEIGHT, z: -12 },
        rotation: {
          x: baseline.rotationX,
          y: baseline.rotationY,
          z: baseline.rotationZ,
        },
      });
      await canvas.click();
      const inductionKeys = ["ArrowUp", "ArrowLeft", "Shift"];
      for (const key of inductionKeys) {
        await page.keyboard.down(key);
      }
      try {
        await stepSimulation(canvas, 18);
      } finally {
        for (const key of [...inductionKeys].reverse()) {
          await page.keyboard.up(key);
        }
      }

      const releaseState = await getKartDebugState(canvas);
      const samples: KartDebugState[] = [];
      for (const segment of recoverySegments) {
        for (const key of segment.keys) {
          await page.keyboard.down(key);
        }
        try {
          samples.push(
            ...(await stepSimulationWithKartSamples(canvas, segment.steps)),
          );
        } finally {
          for (const key of [...segment.keys].reverse()) {
            await page.keyboard.up(key);
          }
        }
      }

      const terminalSamples = samples.slice(-6);
      return {
        releaseRearSlip: getRearSlip(releaseState),
        terminalRearSlip: average(terminalSamples.map(getRearSlip)),
        terminalYawRate: average(
          terminalSamples.map((state) => Math.abs(state.yawRate)),
        ),
      };
    }

    const sustained = await runRecovery([
      { keys: ["ArrowUp", "ArrowLeft", "Shift"], steps: 36 },
    ]);
    const recovered = await runRecovery([
      { keys: ["ArrowRight"], steps: 12 },
      { keys: [], steps: 24 },
    ]);
    const evidence = JSON.stringify({ recovered, sustained });

    expect(
      Math.abs(recovered.releaseRearSlip - sustained.releaseRearSlip),
      evidence,
    ).toBeLessThanOrEqual(0.02);
    expect(recovered.terminalRearSlip, evidence).toBeLessThan(
      sustained.terminalRearSlip * 0.6,
    );
    expect(recovered.terminalYawRate, evidence).toBeLessThan(
      sustained.terminalYawRate * 0.6,
    );
  });

  test("derives mobile rear braking continuously from forward brake and steer", async ({
    page,
  }, testInfo) => {
    test.skip(testInfo.project.name !== "mobile", "Touch controls only.");

    await page.goto("/");
    await page.getByRole("button", { name: "Solo Time Trial" }).click();

    const canvas = page.getByTestId("solo-time-trial-canvas");
    await advanceRaceToRacing(canvas);
    await setSimulationPaused(canvas, true);
    const baseline = await getKartDebugState(canvas);
    await setKartDebugPose(canvas, {
      angularVelocity: { x: 0, y: 0, z: 0 },
      linearVelocity: {
        x: baseline.forward.x * 14,
        y: 0,
        z: baseline.forward.z * 14,
      },
      position: { x: 0, y: REFERENCE_KART_UPRIGHT_ROOT_HEIGHT, z: -12 },
      rotation: {
        x: baseline.rotationX,
        y: baseline.rotationY,
        z: baseline.rotationZ,
      },
    });

    const joystick = page.getByRole("group", { name: "Drive joystick" });
    const brake = page.getByRole("button", { name: "Brake / Reverse" });
    const bounds = await joystick.boundingBox();
    expect(bounds).not.toBeNull();
    const centerX = (bounds?.x ?? 0) + (bounds?.width ?? 0) * 0.5;
    const centerY = (bounds?.y ?? 0) + (bounds?.height ?? 0) * 0.5;
    const travel = (bounds?.width ?? 0) * 0.3;

    await brake.dispatchEvent("pointerdown", {
      buttons: 1,
      pointerId: 40,
      pointerType: "touch",
    });
    await joystick.dispatchEvent("pointerdown", {
      buttons: 1,
      clientX: centerX + travel * 0.8,
      clientY: centerY - travel * 0.6,
      pointerId: 41,
      pointerType: "touch",
    });
    const states = await stepSimulationWithKartSamples(canvas, 90);
    await joystick.dispatchEvent("pointerup", {
      pointerId: 41,
      pointerType: "touch",
    });
    await brake.dispatchEvent("pointerup", {
      pointerId: 40,
      pointerType: "touch",
    });

    const maximumSlip = Math.max(
      ...states.map((state) => state.maximumSlipAngle),
    );
    const maximumRearTireForceUtilization = Math.max(
      ...states.flatMap((state) => [
        state.wheelTireForceUtilizations["rear-left"] ?? 0,
        state.wheelTireForceUtilizations["rear-right"] ?? 0,
      ]),
    );
    const maximumChassisLateralSpeed = Math.max(
      ...states.map((state) => {
        const right = {
          x: state.forward.y * state.up.z - state.forward.z * state.up.y,
          y: state.forward.z * state.up.x - state.forward.x * state.up.z,
          z: state.forward.x * state.up.y - state.forward.y * state.up.x,
        };
        return Math.abs(
          state.linearVelocity.x * right.x +
            state.linearVelocity.y * right.y +
            state.linearVelocity.z * right.z,
        );
      }),
    );
    const smokeWheelNames = new Set(
      states.flatMap((state) => state.driftSmokeWheelNames),
    );
    const finalState = states.at(-1);
    const retainedPlanarSpeed = Math.hypot(
      finalState?.linearVelocity.x ?? 0,
      finalState?.linearVelocity.z ?? 0,
    );
    const evidence = JSON.stringify({
      maximumChassisLateralSpeed,
      maximumRearTireForceUtilization,
      maximumSlip,
      retainedPlanarSpeed,
      smokeWheelNames: [...smokeWheelNames],
    });

    expect(maximumRearTireForceUtilization, evidence).toBeGreaterThanOrEqual(
      0.995,
    );
    expect(maximumSlip, evidence).toBeGreaterThan(0.045);
    expect(maximumChassisLateralSpeed, evidence).toBeGreaterThan(0.35);
    expect(retainedPlanarSpeed, evidence).toBeGreaterThan(7.5);
    expect(smokeWheelNames.size, evidence).toBeGreaterThan(0);
    expect(
      [...smokeWheelNames].every((wheelName) => wheelName.startsWith("rear")),
      evidence,
    ).toBe(true);
  });

  test("applies development values through the scene test adapter", async ({
    page,
  }) => {
    await page.goto("/");

    await page.getByRole("button", { name: "Solo Time Trial" }).click();
    const canvas = page.getByTestId("solo-time-trial-canvas");
    expect((await getKartDebugState(canvas)).maxForwardSpeed).toBe(17);

    await setKartDevelopmentValues(canvas, { maxForwardSpeed: 11 });
    await expect
      .poll(async () => (await getKartDebugState(canvas)).maxForwardSpeed)
      .toBe(11);

    await setKartDevelopmentValues(canvas, { maxForwardSpeed: 17 });
    await expect
      .poll(async () => (await getKartDebugState(canvas)).maxForwardSpeed)
      .toBe(17);
  });

  test("stylizes countdown smoke without inventing straight braking slip", async ({
    page,
  }) => {
    await page.goto("/");
    await page.getByRole("button", { name: "Solo Time Trial" }).click();

    const canvas = page.getByTestId("solo-time-trial-canvas");
    await waitForSceneReady(canvas);
    await setSimulationPaused(canvas, true);
    await canvas.click();
    await page.keyboard.down("ArrowUp");

    try {
      await stepSimulation(canvas, 2);
    } finally {
      await page.keyboard.up("ArrowUp");
    }

    const countdownState = await getKartDebugState(canvas);

    expect((await getRaceDebugState(canvas)).state).toBe("countdown");
    expect(Math.abs(countdownState.speed)).toBeLessThan(0.1);
    expect(countdownState.driftSmokeWheelNames.sort()).toEqual([
      "rear-left",
      "rear-right",
    ]);
    expect(
      Object.values(countdownState.driftSmokeLevels).every(
        (level) => level === 2,
      ),
    ).toBe(true);
    await stepSimulation(canvas);
    expect((await getKartDebugState(canvas)).driftSmokeWheelNames).toEqual([]);

    await advanceRaceToRacing(canvas);
    const baseline = await getKartDebugState(canvas);
    await setKartDebugPose(canvas, {
      linearVelocity: {
        x: baseline.forward.x * 14,
        y: 0,
        z: baseline.forward.z * 14,
      },
      position: { x: 0, y: REFERENCE_KART_UPRIGHT_ROOT_HEIGHT, z: -12 },
      rotation: {
        x: baseline.rotationX,
        y: baseline.rotationY,
        z: baseline.rotationZ,
      },
    });
    await stepSimulation(canvas, 5);
    await page.keyboard.down("ArrowDown");

    let brakingSamples: KartDebugState[] = [];
    try {
      brakingSamples = await stepSimulationWithKartSamples(canvas, 12);
    } finally {
      await page.keyboard.up("ArrowDown");
    }

    const brakingEvidence = JSON.stringify(
      brakingSamples.map((state) => ({
        lateralScrubPowers: state.wheelLateralScrubPowers,
        maximumSlipAngle: state.maximumSlipAngle,
        smoke: state.driftSmokeWheelNames,
        speed: state.speed,
      })),
    );
    expect(
      brakingSamples.every(
        (state) => state.driftSmokeWheelNames.length === 0,
      ),
      brakingEvidence,
    ).toBe(true);
    expect(
      Math.max(...brakingSamples.map((state) => state.maximumSlipAngle)),
    ).toBeLessThan((4 * Math.PI) / 180);
  });

  test("inspects resolved kart dynamics without production overrides", async ({
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
    await expect(page.getByRole("button", { name: "Kart dynamics inspector" })).toHaveCount(
      0,
    );
    await expect(canvas).toHaveAttribute("aria-keyshortcuts", "T");
    const tuningHint = page.getByText(/T · Dynamics/);
    if (testInfo.project.name === "desktop") {
      await expect(tuningHint).toBeVisible();
    } else {
      await expect(tuningHint).toBeHidden();
    }
    await waitForSceneReady(canvas);
    await canvas.focus();
    await page.keyboard.press("t");

    const drawer = page.getByRole("region", { name: "Kart dynamics inspector" });
    const close = page.getByRole("button", { name: "Close" });
    await expect(drawer).toBeVisible();
    await expect(close).toBeFocused();
    for (const key of Object.keys(DEFAULT_KART_DEVELOPMENT_VALUES) as Array<
      keyof KartDevelopmentValues
    >) {
      await expect(page.getByTestId(`kart-tuning-${key}`)).toHaveCount(1);
      await expect(page.getByTestId(`kart-tuning-${key}`)).toHaveText(
        String(DEFAULT_KART_DEVELOPMENT_VALUES[key]),
      );
      await expect(page.getByTestId(`kart-tuning-owner-${key}`)).toContainText(
        KART_DEVELOPMENT_VALUE_METADATA[key].owner,
      );
    }
    await expect(drawer.locator('button[aria-label^="Explain "]')).toHaveCount(
      Object.keys(DEFAULT_KART_DEVELOPMENT_VALUES).length,
    );
    if (testInfo.project.name === "mobile") {
      await expect(touchControls).toBeHidden();
    }
    const handbrakeForceHelp = page.getByRole("button", {
      name: "Explain Handbrake force",
    });
    await handbrakeForceHelp.focus();
    const tooltip = page.getByRole("tooltip");
    await expect(tooltip).toContainText("driven rear wheels");
    if (testInfo.project.name === "desktop") {
      await page.mouse.move(0, 0);
      await expect(tooltip).toBeVisible();
    }
    if (testInfo.project.name === "mobile") {
      await handbrakeForceHelp.press("Escape");
    } else {
      await page.keyboard.press("Escape");
    }
    await expect(page.getByRole("tooltip")).toHaveCount(0);
    await expect(drawer).toBeVisible();
    await expect(page.getByRole("dialog", { name: "Paused" })).toHaveCount(0);
    if (testInfo.project.name === "desktop") {
      await canvas.focus();
      await handbrakeForceHelp.focus();
      await expect(tooltip).toBeVisible();
      await page.keyboard.press("Escape");
    } else {
      await handbrakeForceHelp.tap();
      await expect(tooltip).toBeVisible();
      await handbrakeForceHelp.press("Escape");
    }
    await expect(page.getByRole("tooltip")).toHaveCount(0);
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

    await expect(drawer.getByRole("spinbutton")).toHaveCount(0);
    await expect(
      drawer.getByRole("button", { name: "Reset all defaults" }),
    ).toHaveCount(0);
    await expect(drawer).toContainText("They cannot be overridden here.");
    await expect((await getKartDebugState(canvas)).developmentValues).toEqual(
      DEFAULT_KART_DEVELOPMENT_VALUES,
    );

    await close.click();
    await expect(drawer).toHaveCount(0);
    await expect(canvas).toBeFocused();
    await expect(page.getByRole("button", { name: "Kart dynamics inspector" })).toHaveCount(
      0,
    );
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
      REFERENCE_KART_CONSTRUCTION.massProperties.centerOfMassOffset.z,
      2,
    );
    expect(resetState.y).toBeCloseTo(
      REFERENCE_KART_UPRIGHT_ROOT_HEIGHT,
      2,
    );
    expect(resetState.z).toBeCloseTo(0, 2);
    expect(Math.abs(resetState.rotationX)).toBeLessThan(0.05);
    expect(Math.abs(resetState.rotationY - 90)).toBeLessThan(0.05);
    expect(Math.abs(resetState.rotationZ)).toBeLessThan(0.05);
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
      expect(kartPoint).not.toBeNull();
      expect(canvasBounds).not.toBeNull();
      const clientX = (canvasBounds?.x ?? 0) + (kartPoint?.x ?? 0);
      const clientY = (canvasBounds?.y ?? 0) + (kartPoint?.y ?? 0);

      await canvas.dispatchEvent("pointerdown", {
        button: 0,
        clientX: (canvasBounds?.x ?? 0) + 2,
        clientY: (canvasBounds?.y ?? 0) + 2,
        isPrimary: false,
        pointerId: 30,
        pointerType: "touch",
      });
      await canvas.dispatchEvent("pointerup", {
        button: 0,
        clientX: (canvasBounds?.x ?? 0) + 2,
        clientY: (canvasBounds?.y ?? 0) + 2,
        isPrimary: false,
        pointerId: 30,
        pointerType: "touch",
      });
      await stepSimulation(canvas);
      expect((await getKartDebugState(canvas)).manualRightingCount).toBe(0);

      await canvas.dispatchEvent("pointerdown", {
        button: 0,
        clientX,
        clientY,
        isPrimary: true,
        pointerId: 31,
        pointerType: "touch",
      });
      await canvas.dispatchEvent("pointermove", {
        button: 0,
        clientX: clientX + 20,
        clientY,
        isPrimary: true,
        pointerId: 31,
        pointerType: "touch",
      });
      await canvas.dispatchEvent("pointerup", {
        button: 0,
        clientX: clientX + 20,
        clientY,
        isPrimary: true,
        pointerId: 31,
        pointerType: "touch",
      });
      await stepSimulation(canvas);
      expect((await getKartDebugState(canvas)).manualRightingCount).toBe(0);

      await canvas.dispatchEvent("pointerdown", {
        button: 0,
        clientX,
        clientY,
        isPrimary: false,
        pointerId: 32,
        pointerType: "touch",
      });
      await canvas.dispatchEvent("pointerup", {
        button: 0,
        clientX,
        clientY,
        isPrimary: false,
        pointerId: 32,
        pointerType: "touch",
      });
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

    if (testInfo.project.name === "desktop") {
      await page.keyboard.press("r");
      await stepSimulation(canvas);
      expect((await getKartDebugState(canvas)).manualRightingCount).toBe(1);
      expect(await getRaceDebugState(canvas)).toMatchObject({ state: "racing" });
    }

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

  test("physically rights an angled upside-down kart from two-point support", async ({
    page,
  }, testInfo) => {
    test.skip(
      testInfo.project.name !== "desktop",
      "The deterministic physics edge case only needs one Chromium path.",
    );

    await page.goto("/");
    await page.getByRole("button", { name: "Solo Time Trial" }).click();

    const canvas = page.getByTestId("solo-time-trial-canvas");
    await advanceRaceToRacing(canvas);
    await setSimulationPaused(canvas, true);
    await setKartDebugPose(canvas, {
      angularVelocity: { x: 0, y: 0, z: 0 },
      linearVelocity: { x: 0, y: 0, z: 0 },
      position: {
        x: 4,
        y: scaleReferenceKartLength(1.2),
        z: 0,
      },
      rotation: { x: 0, y: 0, z: 125 },
    });
    await stepSimulation(canvas, 120);

    const inverted = await getKartDebugState(canvas);
    expect(inverted.up.y).toBeLessThan(-0.5);
    await canvas.focus();
    await page.keyboard.press("r");
    await stepSimulation(canvas);
    expect((await getKartDebugState(canvas)).manualRightingCount).toBe(1);

    const samples = await stepSimulationWithKartSamples(canvas, 180);
    const upright = samples.find(
      (sample) => sample.up.y > 0.7 && sample.supportCount > 0,
    );
    expect(upright).toBeDefined();
    expect(Math.abs((upright?.x ?? 0) - inverted.x)).toBeLessThan(
      scaleReferenceKartLength(2),
    );
    expect(Math.abs((upright?.z ?? 0) - inverted.z)).toBeLessThan(
      scaleReferenceKartLength(2),
    );
    expect(await getRaceDebugState(canvas)).toMatchObject({ state: "racing" });
  });

  test("tips from partial wheel support at the platform edge", async ({
    page,
  }) => {
    await page.goto("/");

    await page.getByRole("button", { name: "Solo Time Trial" }).click();

    const canvas = page.getByTestId("solo-time-trial-canvas");
    await setSimulationPaused(canvas, true);
    await setKartDebugPose(canvas, {
      position: { x: 43.9, y: REFERENCE_KART_UPRIGHT_ROOT_HEIGHT, z: 8 },
      rotation: { x: 0, y: 0, z: 0 },
    });
    await stepSimulation(canvas);

    expect((await getKartDebugState(canvas)).supportedWheelNames).toEqual([
      "front-left",
      "rear-left",
    ]);

    await setKartDebugPose(canvas, {
      position: {
        x: 44.05,
        y: REFERENCE_KART_UPRIGHT_ROOT_HEIGHT,
        z: 8,
      },
      rotation: { x: 0, y: 90, z: 0 },
    });
    await stepSimulation(canvas);

    expect((await getKartDebugState(canvas)).supportedWheelNames).toEqual([
      "front-left",
      "front-right",
    ]);

    await setKartDebugPose(canvas, {
      position: {
        x: 44.05,
        y: REFERENCE_KART_UPRIGHT_ROOT_HEIGHT,
        z: 8,
      },
      rotation: { x: 0, y: 0, z: 0 },
    });

    let edgeState = await getKartDebugState(canvas);

    for (
      let step = 0;
      step < 120 &&
      Math.max(Math.abs(edgeState.rotationX), Math.abs(edgeState.rotationZ)) <=
        4;
      step += 1
    ) {
      await stepSimulation(canvas);
      edgeState = await getKartDebugState(canvas);
    }

    expect(
      Math.max(Math.abs(edgeState.rotationX), Math.abs(edgeState.rotationZ)),
    ).toBeGreaterThan(4);
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

    let landedState = airborneState;

    for (
      let batch = 0;
      batch < 12 && landedState.supportCount === 0;
      batch += 1
    ) {
      await stepSimulation(canvas, 10);
      landedState = await getKartDebugState(canvas);
    }

    expect(landedState.supportCount).toBeGreaterThan(0);
    expect(landedState.y).toBeLessThan(1);
    expect(Math.abs(landedState.rotationZ)).toBeGreaterThan(5);
  });

  test("keeps the camera on interpolated presentation and snaps reset state", async ({
    page,
  }) => {
    await page.goto("/");
    await page.getByRole("button", { name: "Solo Time Trial" }).click();

    const canvas = page.getByTestId("solo-time-trial-canvas");
    await advanceRaceToRacing(canvas);
    await setKartDebugPose(canvas, {
      linearVelocity: { x: 3, y: 0, z: 0 },
      position: { x: 0, y: 2, z: 8 },
      rotation: { x: 0, y: 0, z: 0 },
    });
    await stepSimulation(canvas, 6);

    const movingPresentation = await getPresentationDebugState(canvas);

    expect(
      Math.abs(
        movingPresentation.physicsPosition.x -
          movingPresentation.visualPosition.x,
      ),
    ).toBeGreaterThan(0.01);
    expect(movingPresentation.cameraTrackedPosition).toEqual(
      movingPresentation.visualPosition,
    );

    await setKartDebugPose(canvas, {
      angularVelocity: { x: 1, y: 2, z: 3 },
      linearVelocity: { x: 3, y: -8, z: 2 },
      position: { x: 38, y: -10.1, z: 8 },
      rotation: { x: 0, y: 0, z: 180 },
    });
    await stepSimulation(canvas);

    const resetPresentation = await getPresentationDebugState(canvas);

    expect(resetPresentation.visualPosition).toEqual({ x: 0, y: 0.11, z: 0 });
    expect(resetPresentation.physicsPosition).not.toEqual(
      resetPresentation.visualPosition,
    );
    expect(resetPresentation.cameraTrackedPosition).toEqual(
      resetPresentation.visualPosition,
    );
  });

  test("drives chase framing from speed and actual planar slip", async ({
    page,
  }, testInfo) => {
    await page.goto("/");
    await page.getByRole("button", { name: "Solo Time Trial" }).click();

    const canvas = page.getByTestId("solo-time-trial-canvas");
    await setSimulationPaused(canvas, true);
    await setKartDebugPose(canvas, {
      linearVelocity: { x: -12, y: 0, z: 7 },
      position: { x: 0, y: REFERENCE_KART_UPRIGHT_ROOT_HEIGHT, z: 0 },
      rotation: { x: 0, y: 90, z: 0 },
    });
    for (let frame = 0; frame < 10; frame += 1) {
      await stepSimulation(canvas, 3);
    }

    const movingCamera = await getCameraDebugState(canvas);

    expect(movingCamera.planarSpeed).toBeGreaterThan(8);
    expect(Math.abs(movingCamera.signedSlipDegrees)).toBeGreaterThan(5);
    const baseFov = testInfo.project.name === "mobile" ? 58 : 45;
    const maximumFov = testInfo.project.name === "mobile" ? 63 : 51;

    expect(movingCamera.fov).toBeGreaterThan(baseFov);
    expect(movingCamera.fov).toBeLessThanOrEqual(maximumFov);
    expect(
      Math.hypot(
        movingCamera.cameraPosition.x - movingCamera.desiredPosition.x,
        movingCamera.cameraPosition.y - movingCamera.desiredPosition.y,
        movingCamera.cameraPosition.z - movingCamera.desiredPosition.z,
      ),
    ).toBeLessThan(2);
  });

  test("starts with a wider construction-scaled chase frame", async ({
    page,
  }, testInfo) => {
    await page.goto("/");
    await page.getByRole("button", { name: "Solo Time Trial" }).click();

    const canvas = page.getByTestId("solo-time-trial-canvas");
    const camera = await getCameraDebugState(canvas);
    const expectedDistance = scaleReferenceKartLength(
      testInfo.project.name === "mobile" ? 8.5 : 7.5,
    );

    expect(camera.trailingDistance).toBeGreaterThanOrEqual(
      expectedDistance - 0.01,
    );
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

  test("keeps the kart visible inside the camera-test corner", async ({
    page,
  }) => {
    await page.goto("/");
    await page.getByRole("button", { name: "Solo Time Trial" }).click();

    const canvas = page.getByTestId("solo-time-trial-canvas");
    await setSimulationPaused(canvas, true);
    await setKartDebugPose(canvas, {
      position: { x: 6, y: REFERENCE_KART_UPRIGHT_ROOT_HEIGHT, z: -16 },
      rotation: { x: 0, y: 90, z: 0 },
    });

    const cornerCamera = await getCameraDebugState(canvas);

    expect(cornerCamera.obstructed).toBe(true);
    expect(cornerCamera.obstructionDistance).not.toBeNull();
    expect(cornerCamera.obstructionDistance).toBeGreaterThan(1);
    expect(cornerCamera.obstructionDistance).toBeLessThan(6);

    await setKartDebugPose(canvas, {
      position: { x: 2, y: REFERENCE_KART_UPRIGHT_ROOT_HEIGHT, z: -12 },
      rotation: { x: 0, y: -90, z: 0 },
    });

    expect((await getCameraDebugState(canvas)).obstructed).toBe(false);
  });

  test("adds one bounded camera response for a hard impact", async ({
    page,
  }) => {
    await page.goto("/?collision-fixtures");
    await page.getByRole("button", { name: "Solo Time Trial" }).click();

    const canvas = page.getByTestId("solo-time-trial-canvas");
    await setSimulationPaused(canvas, true);
    await setKartDebugPose(canvas, {
      linearVelocity: { x: 0, y: 0, z: 17 },
      position: { x: 4, y: REFERENCE_KART_UPRIGHT_ROOT_HEIGHT, z: 25.5 },
      rotation: { x: 0, y: 0, z: 0 },
    });
    await stepSimulation(canvas, 36);

    const impactCamera = await getCameraDebugState(canvas);
    const impactMagnitude = Math.hypot(
      impactCamera.impactOffset.x,
      impactCamera.impactOffset.y,
      impactCamera.impactOffset.z,
    );

    expect(impactMagnitude).toBeGreaterThan(scaleReferenceKartLength(0.1));
    expect(impactMagnitude).toBeLessThanOrEqual(
      scaleReferenceKartLength(0.22),
    );

    for (let frame = 0; frame < 8; frame += 1) {
      await stepSimulation(canvas, 3);
    }

    const recoveredCamera = await getCameraDebugState(canvas);

    expect(
      Math.hypot(
        recoveredCamera.impactOffset.x,
        recoveredCamera.impactOffset.y,
        recoveredCamera.impactOffset.z,
      ),
    ).toBeLessThan(impactMagnitude);
  });

  test("keeps airborne framing world-up and blends back after landing", async ({
    page,
  }) => {
    test.setTimeout(60_000);
    await page.goto("/");
    await page.getByRole("button", { name: "Solo Time Trial" }).click();

    const canvas = page.getByTestId("solo-time-trial-canvas");
    await setSimulationPaused(canvas, true);
    await setKartDebugPose(canvas, {
      angularVelocity: { x: 0.2, y: 0.1, z: 0.3 },
      linearVelocity: { x: 3, y: -1, z: 0 },
      position: { x: -10, y: 1, z: 0 },
      rotation: { x: 10, y: 90, z: 12 },
    });

    const airborneCamera = await getCameraDebugState(canvas);

    expect(airborneCamera.airborneBlend).toBe(1);
    expect(airborneCamera.cameraPosition.y).toBeGreaterThan(
      1 + scaleReferenceKartLength(3),
    );

    let kart = await getKartDebugState(canvas);

    for (let batch = 0; batch < 15 && kart.supportCount === 0; batch += 1) {
      await stepSimulation(canvas, 8);
      kart = await getKartDebugState(canvas);
    }

    expect(kart.supportCount).toBeGreaterThan(0);

    await stepSimulation(canvas, Math.ceil(3 / DEFAULT_FIXED_STEP_SECONDS));
    const landedCamera = await getCameraDebugState(canvas);
    const settledKart = await getKartDebugState(canvas);
    const landingEvidence = JSON.stringify({ landedCamera, settledKart });

    expect(landedCamera.airborneBlend, landingEvidence).toBeLessThan(0.35);
    expect(Number.isFinite(landedCamera.cameraPosition.x)).toBe(true);
    expect(Number.isFinite(landedCamera.cameraPosition.y)).toBe(true);
    expect(Number.isFinite(landedCamera.cameraPosition.z)).toBe(true);
  });

  test("applies the authored start through the scene test adapter", async ({
    page,
  }) => {
    await page.goto("/");
    await page.getByRole("button", { name: "Solo Time Trial" }).click();

    const canvas = page.getByTestId("solo-time-trial-canvas");
    await setSimulationPaused(canvas, true);
    await setStartPosition(canvas, { x: 0.5, z: 0.5 });
    await resetKart(canvas);

    const presentation = await getPresentationDebugState(canvas);
    expect(presentation.visualPosition.x).toBeCloseTo(0.5);
    expect(presentation.visualPosition.z).toBeCloseTo(0.5);
  });

  test("releases an elevated rotated test kart into physical floor contact", async ({
    page,
  }) => {
    await page.goto("/");
    await page.getByRole("button", { name: "Solo Time Trial" }).click();

    const canvas = page.getByTestId("solo-time-trial-canvas");
    await setSimulationPaused(canvas, true);
    await setKartDebugPose(canvas, {
      position: { x: 0, y: 3.43, z: 0 },
      rotation: { x: 45, y: 0, z: 0 },
    });
    await stepSimulation(canvas, 150);

    const kart = await getKartDebugState(canvas);
    expect(kart.y).toBeGreaterThan(-1);
    expect(kart.supportCount).toBeGreaterThan(0);
  });

  test("registers course obstacle collision", async ({ page }) => {
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

  test("resolves a high-speed straight wall impact without tunneling", async ({
    page,
  }) => {
    await page.goto("/?collision-fixtures");
    await page.getByRole("button", { name: "Solo Time Trial" }).click();

    const canvas = page.getByTestId("solo-time-trial-canvas");

    await setSimulationPaused(canvas, true);
    await setKartDebugPose(canvas, {
      linearVelocity: { x: 0, y: 0, z: 17 },
      position: { x: 4, y: REFERENCE_KART_UPRIGHT_ROOT_HEIGHT, z: 25.5 },
      rotation: { x: 0, y: 0, z: 0 },
    });
    await stepSimulation(canvas, 36);

    const collision = await getCollisionResponseDebugState(canvas);
    const kart = await getKartDebugState(canvas);

    expect(collision.contactedEntityNames).toContain("collision-response-wall");
    expect(collision.maximumApproachSpeed).toBeGreaterThan(12);
    expect(collision.maximumImpulse).toBeGreaterThan(0);
    expect(kart.z).toBeLessThan(28.5);
    expect(Math.abs(collision.postLinearVelocity.z)).toBeLessThan(5);
  });

  test("preserves tangential motion through a glancing wall impact", async ({
    page,
  }) => {
    await page.goto("/?collision-fixtures");
    await page.getByRole("button", { name: "Solo Time Trial" }).click();

    const canvas = page.getByTestId("solo-time-trial-canvas");

    await setSimulationPaused(canvas, true);
    await setKartDebugPose(canvas, {
      linearVelocity: { x: 12, y: 0, z: 5 },
      position: { x: -0.5, y: REFERENCE_KART_UPRIGHT_ROOT_HEIGHT, z: 27.65 },
      rotation: { x: 0, y: 90, z: 0 },
    });
    await stepSimulation(canvas, 40);

    const collision = await getCollisionResponseDebugState(canvas);
    const kart = await getKartDebugState(canvas);

    expect(collision.contactedEntityNames).toContain("collision-response-wall");
    expect(collision.postLinearVelocity.x).toBeGreaterThan(7);
    expect(kart.x).toBeGreaterThan(3);
    expect(kart.z).toBeLessThan(28.5);
  });

  test("turns an off-center impact into a controlled angular response", async ({
    page,
  }) => {
    await page.goto("/?collision-fixtures");
    await page.getByRole("button", { name: "Solo Time Trial" }).click();

    const canvas = page.getByTestId("solo-time-trial-canvas");

    await setSimulationPaused(canvas, true);
    await setKartDebugPose(canvas, {
      linearVelocity: { x: 0, y: 0, z: 14 },
      position: { x: 9.55, y: REFERENCE_KART_UPRIGHT_ROOT_HEIGHT, z: 25.5 },
      rotation: { x: 0, y: 0, z: 0 },
    });
    await stepSimulation(canvas, 36);

    const collision = await getCollisionResponseDebugState(canvas);

    expect(collision.contactedEntityNames).toContain("collision-response-wall");
    expect(collision.maximumAngularSpeedAfterImpact).toBeGreaterThan(0.2);
    expect(collision.maximumAngularSpeedAfterImpact).toBeLessThan(
      MAX_CONTROLLED_COLLISION_ANGULAR_SPEED,
    );
  });

  test("deflects from a convex outside corner without snagging", async ({
    page,
  }) => {
    await page.goto("/?collision-fixtures");
    await page.getByRole("button", { name: "Solo Time Trial" }).click();

    const canvas = page.getByTestId("solo-time-trial-canvas");

    await setSimulationPaused(canvas, true);
    await setKartDebugPose(canvas, {
      linearVelocity: { x: -9, y: 0, z: -4 },
      position: { x: 32, y: scaleReferenceKartLength(0.38), z: 31.58 },
      rotation: { x: 0, y: 65, z: 0 },
    });
    await stepSimulation(
      canvas,
      Math.ceil((22 / 60) / DEFAULT_FIXED_STEP_SECONDS),
    );

    const collision = await getCollisionResponseDebugState(canvas);
    const postSpeed = Math.hypot(
      collision.postLinearVelocity.x,
      collision.postLinearVelocity.z,
    );

    expect(
      collision.contactedEntityNames.some((name) =>
        name.startsWith("collision-corner-"),
      ),
    ).toBe(true);
    expect(postSpeed).toBeGreaterThan(1);
    expect(collision.maximumAngularSpeedAfterImpact).toBeLessThan(
      MAX_CONTROLLED_COLLISION_ANGULAR_SPEED,
    );
  });

  test("backs out of a concave inside corner without remaining trapped", async ({
    page,
  }) => {
    await page.goto("/?collision-fixtures");
    await page.getByRole("button", { name: "Solo Time Trial" }).click();

    const canvas = page.getByTestId("solo-time-trial-canvas");

    await setSimulationPaused(canvas, true);
    await setKartDebugPose(canvas, {
      linearVelocity: { x: 9, y: 0, z: 9 },
      position: { x: 26, y: scaleReferenceKartLength(0.38), z: 27 },
      rotation: { x: 0, y: -135, z: 0 },
    });
    await stepSimulation(canvas, 36);

    const collision = await getCollisionResponseDebugState(canvas);
    const cornerState = await getKartDebugState(canvas);
    const cornerDistance = Math.hypot(cornerState.x - 29, cornerState.z - 30);

    expect(collision.contactedEntityNames).toContain(
      "collision-corner-horizontal-wall",
    );
    expect(collision.contactedEntityNames).toContain(
      "collision-corner-vertical-wall",
    );

    await page.keyboard.down("ArrowDown");

    try {
      await stepSimulation(
        canvas,
        Math.ceil((150 / 60) / DEFAULT_FIXED_STEP_SECONDS),
      );
    } finally {
      await page.keyboard.up("ArrowDown");
    }

    const escapedState = await getKartDebugState(canvas);

    expect(
      Math.hypot(escapedState.x - 29, escapedState.z - 30),
    ).toBeGreaterThan(cornerDistance + 1);
    expect(escapedState.supportCount).toBeGreaterThanOrEqual(2);
  });

  test("records the discrete baseline across the thin barrier", async ({
    page,
  }) => {
    await page.goto("/?collision-fixtures");
    await page.getByRole("button", { name: "Solo Time Trial" }).click();

    const canvas = page.getByTestId("solo-time-trial-canvas");

    await setSimulationPaused(canvas, true);
    await setKartDebugPose(canvas, {
      ccdEnabled: false,
      linearVelocity: { x: -20.4, y: 0, z: 0 },
      position: { x: -29.5, y: REFERENCE_KART_UPRIGHT_ROOT_HEIGHT, z: 24 },
      rotation: { x: 0, y: 90, z: 0 },
    });
    await stepSimulation(canvas, 30);

    const collision = await getCollisionResponseDebugState(canvas);
    const kart = await getKartDebugState(canvas);

    expect(collision.ccdMotionThreshold).toBe(0);
    expect(collision.contactedEntityNames).toContain("collision-ccd-thin-wall");
    expect(kart.x).toBeGreaterThan(-33.5);
  });

  test("keeps CCD active above top speed across a thin barrier", async ({
    page,
  }) => {
    await page.goto("/?collision-fixtures");
    await page.getByRole("button", { name: "Solo Time Trial" }).click();

    const canvas = page.getByTestId("solo-time-trial-canvas");

    await setSimulationPaused(canvas, true);
    await setKartDebugPose(canvas, {
      linearVelocity: { x: -20.4, y: 0, z: 0 },
      position: { x: -29.5, y: REFERENCE_KART_UPRIGHT_ROOT_HEIGHT, z: 24 },
      rotation: { x: 0, y: 90, z: 0 },
    });
    await stepSimulation(canvas, 30);

    const collision = await getCollisionResponseDebugState(canvas);
    const kart = await getKartDebugState(canvas);

    expect(collision.ccdMotionThreshold).toBe(
      scaleReferenceKartLength(0.12),
    );
    expect(collision.ccdSweptSphereRadius).toBe(
      scaleReferenceKartLength(0.16),
    );
    expect(collision.contactedEntityNames).toContain("collision-ccd-thin-wall");
    expect(collision.maximumApproachSpeed).toBeGreaterThan(17);
    expect(kart.x).toBeGreaterThan(-33.5);
  });

  test("avoids premature CCD contact before reaching the thin barrier", async ({
    page,
  }) => {
    await page.goto("/?collision-fixtures");
    await page.getByRole("button", { name: "Solo Time Trial" }).click();

    const canvas = page.getByTestId("solo-time-trial-canvas");

    await setSimulationPaused(canvas, true);
    await setKartDebugPose(canvas, {
      linearVelocity: { x: -12, y: 0, z: 0 },
      position: { x: -29.5, y: REFERENCE_KART_UPRIGHT_ROOT_HEIGHT, z: 24 },
      rotation: { x: 0, y: 90, z: 0 },
    });
    await stepSimulation(
      canvas,
      Math.ceil((6 / 60) / DEFAULT_FIXED_STEP_SECONDS),
    );

    const collision = await getCollisionResponseDebugState(canvas);
    const kart = await getKartDebugState(canvas);

    expect(collision.contactedEntityNames).not.toContain(
      "collision-ccd-thin-wall",
    );
    expect(kart.x).toBeLessThan(-30.2);
    expect(kart.x).toBeGreaterThan(-31.2);
  });

  test("keeps a fast rotational thin-wall contact bounded", async ({
    page,
  }) => {
    await page.goto("/?collision-fixtures");
    await page.getByRole("button", { name: "Solo Time Trial" }).click();

    const canvas = page.getByTestId("solo-time-trial-canvas");

    await setSimulationPaused(canvas, true);
    await setKartDebugPose(canvas, {
      angularVelocity: { x: 0, y: 18, z: 0 },
      position: { x: -32.7, y: REFERENCE_KART_UPRIGHT_ROOT_HEIGHT, z: 24 },
      rotation: { x: 0, y: 0, z: 0 },
    });
    await stepSimulation(canvas, 45);

    const collision = await getCollisionResponseDebugState(canvas);
    const kart = await getKartDebugState(canvas);

    expect(collision.contactedEntityNames).toContain("collision-ccd-thin-wall");
    expect(collision.maximumAngularSpeedAfterImpact).toBeLessThan(
      MAX_FAST_COLLISION_ANGULAR_SPEED,
    );
    expect(kart.x).toBeGreaterThan(-33.5);
  });

  test("uses finite wheel support with visible chassis clearance", async ({
    page,
  }) => {
    await page.goto("/");
    await page.getByRole("button", { name: "Solo Time Trial" }).click();

    const canvas = page.getByTestId("solo-time-trial-canvas");

    await expect
      .poll(async () => getKartDebugState(canvas))
      .toMatchObject({ supportCount: 4 });

    const state = await getKartDebugState(canvas);

    expect(state.chassisClearance).toBeGreaterThan(
      scaleReferenceKartLength(0.06),
    );
    expect(Object.keys(state.wheelHubYs)).toHaveLength(4);
    expect(
      Object.values(state.wheelHubYs).every(
        (y) =>
          y >= scaleReferenceKartLength(-0.36) &&
          y <= scaleReferenceKartLength(0.06),
      ),
    ).toBe(true);
    expect(
      Object.values(state.wheelSweepFractions).every(
        (fraction) => fraction !== null && fraction >= 0 && fraction <= 1,
      ),
    ).toBe(true);
  });

  test("compresses the finite wheel suspension on a ramp landing", async ({
    page,
  }) => {
    await page.goto("/");
    await page.getByRole("button", { name: "Solo Time Trial" }).click();

    const canvas = page.getByTestId("solo-time-trial-canvas");
    const rampSurfaceHeightAtCenter =
      1.76 + 0.225 * Math.cos((28 * Math.PI) / 180);
    const fullSizeUprightRootHeight = 0.43;
    const fullSizeDropHeight =
      4.5 - (rampSurfaceHeightAtCenter + fullSizeUprightRootHeight);

    await setSimulationPaused(canvas, true);
    await setKartDebugPose(canvas, {
      linearVelocity: {
        x: 0,
        y: -3 * REFERENCE_KART_TIME_SCALE,
        z: 0,
      },
      position: {
        x: 0,
        y:
          rampSurfaceHeightAtCenter +
          REFERENCE_KART_UPRIGHT_ROOT_HEIGHT +
          scaleReferenceKartLength(fullSizeDropHeight),
        z: 16,
      },
      rotation: { x: 0, y: -90, z: 0 },
    });
    const samples = await stepSimulationWithKartSamples(canvas, 180);

    const suspension = await getSuspensionDebugState(canvas);
    const maximumObservedLoad = Math.max(
      ...samples.flatMap((state) => Object.values(state.wheelLoads)),
    );
    const evidence = JSON.stringify({ maximumObservedLoad, suspension });

    expect(suspension.minimumSupportedWheels, evidence).toBe(0);
    expect(suspension.maximumSupportedWheels, evidence).toBeGreaterThanOrEqual(
      2,
    );
    expect(suspension.maximumCompression, evidence).toBeGreaterThan(
      scaleReferenceKartLength(0.08),
    );
    expect(suspension.maximumCompression, evidence).toBeLessThanOrEqual(
      Number(KART_SUSPENSION_REST_TRAVEL.toFixed(2)),
    );
    expect(maximumObservedLoad, evidence).toBeGreaterThan(
      2_500 * REFERENCE_KART_MASS_SCALE,
    );
    expect(suspension.minimumChassisClearance, evidence).toBeGreaterThan(
      scaleReferenceKartLength(0.01),
    );
  });

  test("keeps construction-derived pitch bounded after ramp takeoff", async ({
    page,
  }) => {
    test.setTimeout(60_000);
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

    await advanceRaceToRacing(canvas);
    await setKartDebugPose(canvas, {
      linearVelocity: { x: 17, y: 0, z: 0 },
      position: { x: -14, y: scaleReferenceKartLength(0.4), z: 16 },
      rotation: { x: 0, y: -90, z: 0 },
    });
    await canvas.focus();
    await page.keyboard.down("ArrowUp");

    let trajectory: Array<{
      angularVelocity: { x: number; y: number; z: number };
      forward: { x: number; y: number; z: number };
      supportCount: number;
      up: { x: number; y: number; z: number };
      y: number;
    }> = [];

    try {
      trajectory = await canvas.evaluate((element) => {
        const states: Array<{
          angularVelocity: { x: number; y: number; z: number };
          forward: { x: number; y: number; z: number };
          supportCount: number;
          up: { x: number; y: number; z: number };
          y: number;
        }> = [];

        for (let step = 0; step < 210; step += 1) {
          element.dispatchEvent(
            new CustomEvent("stepSimulation", { detail: { steps: 1 } }),
          );
          element.dispatchEvent(
            new CustomEvent("getKartDebugState", {
              detail: {
                respond: (state: KartDebugState) =>
                  states.push({
                    angularVelocity: state.angularVelocity,
                    forward: state.forward,
                    supportCount: state.supportCount,
                    up: state.up,
                    y: state.y,
                  }),
              },
            }),
          );
        }

        return states;
      });
    } finally {
      await page.keyboard.up("ArrowUp");
    }

    const airborne = trajectory.filter(
      (state) => state.supportCount === 0 && state.y > 1,
    );
    const minimumAirborneNoseHeight = Math.min(
      ...airborne.map((state) => state.forward.y),
    );
    const maximumAirbornePitchSpeed = Math.max(
      ...airborne.map((state) => Math.abs(state.angularVelocity.z)),
    );
    const evidence = JSON.stringify(
      airborne.filter((_, index) => index % 12 === 0),
    );

    expect(airborne.length, evidence).toBeGreaterThan(10);
    expect(
      airborne.every(
        (state) =>
          Number.isFinite(state.angularVelocity.x) &&
          Number.isFinite(state.angularVelocity.y) &&
          Number.isFinite(state.angularVelocity.z),
      ),
      evidence,
    ).toBe(true);
    expect(Math.max(...trajectory.map((state) => state.y)), evidence).toBeGreaterThan(
      2,
    );
    expect(maximumAirbornePitchSpeed, evidence).toBeLessThan(1.5);
    expect(minimumAirborneNoseHeight, evidence).toBeGreaterThan(-0.5);
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

    await expect(joystick).toHaveAccessibleDescription(
      /Touch gesture only:.*progressively request rear braking.*Tire grip determines whether the kart slides.*Arrow keys provide the basic joystick directions only\./,
    );

    for (const control of [accelerate, joystick, brake, reset]) {
      await expect(control).toBeVisible();
      const bounds = await control.boundingBox();
      expect(bounds?.width ?? 0).toBeGreaterThanOrEqual(44);
      expect(bounds?.height ?? 0).toBeGreaterThanOrEqual(44);
    }

    const start = await getKartDebugState(canvas);
    const joystickBounds = await joystick.boundingBox();
    expect(joystickBounds).not.toBeNull();
    expect(joystickBounds?.width ?? 0).toBeGreaterThanOrEqual(130);
    const joystickCenterX =
      (joystickBounds?.x ?? 0) + (joystickBounds?.width ?? 0) * 0.5;
    const joystickCenterY =
      (joystickBounds?.y ?? 0) + (joystickBounds?.height ?? 0) * 0.5;
    const joystickTravel = (joystickBounds?.width ?? 0) * 0.3;

    await joystick.dispatchEvent("pointerdown", {
      buttons: 1,
      clientX: joystickCenterX + joystickTravel * 0.54,
      clientY: joystickCenterY - joystickTravel * 0.54,
      pointerId: 11,
      pointerType: "touch",
    });
    await expect(joystick).toHaveAttribute("data-steer", "0.42");
    await expect(joystick).toHaveAttribute("data-throttle", "0.42");
    await expect(joystick).toHaveAttribute("data-active", "true");
    await joystick.focus();
    await accelerate.focus();
    await expect(joystick).toHaveAttribute("data-steer", "0.42");
    await expect(joystick).toHaveAttribute("data-throttle", "0.42");

    await expect
      .poll(async () => (await getKartDebugState(canvas)).speed)
      .toBeGreaterThan(start.speed + 0.5);
    await expect
      .poll(async () => Math.abs((await getKartDebugState(canvas)).steerAngle))
      .toBeGreaterThan(1);

    await joystick.dispatchEvent("pointermove", {
      buttons: 1,
      clientX: joystickCenterX,
      clientY: joystickCenterY - joystickTravel * 1.2,
      pointerId: 11,
      pointerType: "touch",
    });
    await expect(joystick).toHaveAttribute("data-steer", "0");
    await expect(joystick).toHaveAttribute("data-throttle", "1");

    await joystick.dispatchEvent("pointerup", {
      pointerId: 11,
      pointerType: "touch",
    });
    await expect(joystick).toHaveAttribute("data-throttle", "0");
    await expect(joystick).toHaveAttribute("data-active", "false");
    await expect
      .poll(async () => Math.abs((await getKartDebugState(canvas)).steerAngle))
      .toBeLessThan(0.5);

    await joystick.dispatchEvent("pointerdown", {
      buttons: 1,
      clientX: joystickCenterX - joystickTravel * 0.54,
      clientY: joystickCenterY,
      pointerId: 12,
      pointerType: "touch",
    });
    await expect(joystick).toHaveAttribute("data-steer", "-0.3");
    await joystick.dispatchEvent("pointercancel", {
      pointerId: 12,
      pointerType: "touch",
    });
    await expect(joystick).toHaveAttribute("data-steer", "0");

    await joystick.dispatchEvent("pointerdown", {
      buttons: 1,
      clientX: joystickCenterX + joystickTravel * 0.54,
      clientY: joystickCenterY,
      pointerId: 13,
      pointerType: "touch",
    });
    await expect(joystick).toHaveAttribute("data-steer", "0.3");
    await joystick.dispatchEvent("lostpointercapture", {
      pointerId: 13,
      pointerType: "touch",
    });
    await expect(joystick).toHaveAttribute("data-steer", "0");

    await reset.click();
    await expect
      .poll(async () => {
        const state = await getKartDebugState(canvas);
        return Math.hypot(state.x - start.x, state.z - start.z);
      })
      .toBeLessThan(0.1);

    await joystick.dispatchEvent("pointerdown", {
      buttons: 1,
      clientX: joystickCenterX,
      clientY: joystickCenterY + joystickTravel * 1.2,
      pointerId: 14,
      pointerType: "touch",
    });
    await expect(joystick).toHaveAttribute("data-throttle", "-1");
    await expect
      .poll(async () => {
        const state = await getKartDebugState(canvas);
        return (
          state.linearVelocity.x * state.forward.x +
          state.linearVelocity.y * state.forward.y +
          state.linearVelocity.z * state.forward.z
        );
      })
      .toBeLessThan(-0.5);
    await joystick.dispatchEvent("pointercancel", {
      pointerId: 14,
      pointerType: "touch",
    });

    await reset.click();
    await expect
      .poll(async () => {
        const state = await getKartDebugState(canvas);
        return Math.hypot(state.x - start.x, state.z - start.z);
      })
      .toBeLessThan(0.1);

    await joystick.dispatchEvent("pointerdown", {
      buttons: 1,
      clientX: joystickCenterX + joystickTravel * 0.8,
      clientY: joystickCenterY + joystickTravel * 0.6,
      pointerId: 15,
      pointerType: "touch",
    });
    await expect(joystick).toHaveAttribute("data-steer", "0.8");
    await expect(joystick).toHaveAttribute("data-throttle", "-0.6");
    await expect
      .poll(async () => {
        const state = await getKartDebugState(canvas);
        return (
          state.linearVelocity.x * state.forward.x +
          state.linearVelocity.y * state.forward.y +
          state.linearVelocity.z * state.forward.z
        );
      })
      .toBeLessThan(-0.5);
    await joystick.dispatchEvent("pointercancel", {
      pointerId: 15,
      pointerType: "touch",
    });

    await accelerate.focus();
    await page.keyboard.down("Space");
    await expect(accelerate).toHaveAttribute("aria-pressed", "true");
    await expect
      .poll(async () => (await getKartDebugState(canvas)).speed)
      .toBeGreaterThan(0.5);
    await page.keyboard.up("Space");
    await expect(accelerate).toHaveAttribute("aria-pressed", "false");

    await joystick.focus();
    await page.keyboard.down("ArrowLeft");
    await expect(joystick).toHaveAttribute("data-steer", "-1");
    await page.keyboard.up("ArrowLeft");
    await expect(joystick).toHaveAttribute("data-steer", "0");

    await page.keyboard.down("ArrowUp");
    await expect(joystick).toHaveAttribute("data-throttle", "1");
    await page.keyboard.up("ArrowUp");
    await expect(joystick).toHaveAttribute("data-throttle", "0");

    await page.setViewportSize({ height: 450, width: 900 });
    const landscapeJoystickBounds = await joystick.boundingBox();
    const landscapeAccelerateBounds = await accelerate.boundingBox();
    const landscapeBrakeBounds = await brake.boundingBox();
    expect(landscapeJoystickBounds?.width ?? 0).toBeGreaterThanOrEqual(100);
    expect(
      (landscapeJoystickBounds?.y ?? 0) +
        (landscapeJoystickBounds?.height ?? 0),
    ).toBeLessThanOrEqual(450);
    expect(
      (landscapeJoystickBounds?.x ?? 0) +
        (landscapeJoystickBounds?.width ?? 0),
    ).toBeLessThan(
      Math.min(
        landscapeAccelerateBounds?.x ?? 900,
        landscapeBrakeBounds?.x ?? 900,
      ),
    );
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

    await page.evaluate(() => {
      const buttons = Array.from({ length: 17 }, () => ({
        pressed: false,
        touched: false,
        value: 0,
      }));
      buttons[7] = { pressed: true, touched: true, value: 1 };
      const testWindow = window as typeof window & {
        __TR_GAMEPADS__?: Gamepad[];
      };
      testWindow.__TR_GAMEPADS__ = [
        {
          axes: [0.55, 0, 0, 0],
          buttons,
          connected: true,
          id: "Automated standard controller",
          index: 0,
          mapping: "standard",
          timestamp: performance.now(),
        } as unknown as Gamepad,
      ];
    });

    await expect
      .poll(async () => (await getKartDebugState(canvas)).speed)
      .toBeGreaterThan(start.speed + 0.5);
    await expect
      .poll(async () => Math.abs((await getKartDebugState(canvas)).steerAngle))
      .toBeGreaterThan(1);

    await page.evaluate(() => {
      const testWindow = window as typeof window & {
        __TR_GAMEPADS__?: Gamepad[];
      };
      const gamepad = testWindow.__TR_GAMEPADS__?.[0];
      if (!gamepad) return;
      const buttons = [...gamepad.buttons] as Array<{
        pressed: boolean;
        touched: boolean;
        value: number;
      }>;
      buttons[7] = { pressed: false, touched: false, value: 0 };
      buttons[0] = { pressed: true, touched: true, value: 1 };
      testWindow.__TR_GAMEPADS__ = [
        { ...gamepad, axes: [0, 0, 0, 0], buttons } as Gamepad,
      ];
    });

    await expect
      .poll(async () => {
        const state = await getKartDebugState(canvas);
        return Math.hypot(state.x - start.x, state.z - start.z);
      })
      .toBeLessThan(0.1);

    await page.evaluate(() => {
      const testWindow = window as typeof window & {
        __TR_GAMEPADS__?: Gamepad[];
      };
      const gamepad = testWindow.__TR_GAMEPADS__?.[0];
      if (!gamepad) return;
      const buttons = [...gamepad.buttons] as Array<{
        pressed: boolean;
        touched: boolean;
        value: number;
      }>;
      buttons[0] = { pressed: false, touched: false, value: 0 };
      testWindow.__TR_GAMEPADS__ = [{ ...gamepad, buttons } as Gamepad];
    });
    await page.waitForTimeout(100);
    await page.evaluate(() => {
      const testWindow = window as typeof window & {
        __TR_GAMEPADS__?: Gamepad[];
      };
      const gamepad = testWindow.__TR_GAMEPADS__?.[0];
      if (!gamepad) return;
      const buttons = [...gamepad.buttons] as Array<{
        pressed: boolean;
        touched: boolean;
        value: number;
      }>;
      buttons[9] = { pressed: true, touched: true, value: 1 };
      testWindow.__TR_GAMEPADS__ = [{ ...gamepad, buttons } as Gamepad];
    });

    const pauseDialog = page.getByRole("dialog", { name: "Paused" });
    await expect(pauseDialog).toBeVisible();
    await pauseDialog.getByRole("button", { name: "Resume" }).click();
    await expect(pauseDialog).not.toBeVisible();
    await page.waitForTimeout(250);
    await expect(pauseDialog).not.toBeVisible();

    await page.evaluate(() => {
      const testWindow = window as typeof window & {
        __TR_GAMEPADS__?: Gamepad[];
      };
      const gamepad = testWindow.__TR_GAMEPADS__?.[0];
      if (!gamepad) return;
      const buttons = [...gamepad.buttons] as Array<{
        pressed: boolean;
        touched: boolean;
        value: number;
      }>;
      buttons[9] = { pressed: false, touched: false, value: 0 };
      testWindow.__TR_GAMEPADS__ = [{ ...gamepad, buttons } as Gamepad];
    });
    await page.waitForTimeout(100);
    await page.evaluate(() => {
      const testWindow = window as typeof window & {
        __TR_GAMEPADS__?: Gamepad[];
      };
      const gamepad = testWindow.__TR_GAMEPADS__?.[0];
      if (!gamepad) return;
      const buttons = [...gamepad.buttons] as Array<{
        pressed: boolean;
        touched: boolean;
        value: number;
      }>;
      buttons[9] = { pressed: true, touched: true, value: 1 };
      testWindow.__TR_GAMEPADS__ = [{ ...gamepad, buttons } as Gamepad];
    });
    await expect(pauseDialog).toBeVisible();
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

  test("keeps transformed test-obstacle collision synchronized", async ({
    page,
  }) => {
    await page.goto("/");
    await page.getByRole("button", { name: "Solo Time Trial" }).click();

    const canvas = page.getByTestId("solo-time-trial-canvas");
    await setCourseObjectDebugTransform(canvas, "obstacle-barrel-a", {
      position: { x: 15, y: 0.75, z: -3 },
      rotation: { x: 0, y: 15, z: 0 },
    });

    const movedCollisionState = await getCollisionDebugState(canvas);
    expect(movedCollisionState.obstacleAX).toBe(15);
  });
});

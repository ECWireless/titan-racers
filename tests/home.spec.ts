import { expect, type Locator, test } from "@playwright/test";

type TransformAxis = "x" | "y" | "z";
type EditableObjectId =
  | "start-position"
  | "kart"
  | "obstacle-barrel-a"
  | "obstacle-barrel-b";

async function waitForSceneReady(canvas: Locator) {
  await expect(canvas).toHaveAttribute("data-scene-ready", "true");
}

async function openEditor(page: import("@playwright/test").Page) {
  await waitForSceneReady(page.getByTestId("solo-time-trial-canvas"));
  await page.keyboard.press("Escape");
  await expect(page.getByText("Paused", { exact: true })).toBeVisible();
  await page.getByRole("button", { name: "Edit" }).click();
}

async function getTranslateGizmoPoint(
  canvas: Locator,
  axis: TransformAxis,
) {
  await waitForSceneReady(canvas);

  return canvas.evaluate(
    (element, requestedAxis) =>
      new Promise<{ x: number; y: number } | null>((resolve) => {
        element.dispatchEvent(
          new CustomEvent("getTranslateGizmoPoint", {
            detail: {
              axis: requestedAxis,
              respond: resolve,
            },
          }),
        );
      }),
    axis,
  );
}

async function getEditableObjectPoint(
  canvas: Locator,
  objectId: EditableObjectId,
) {
  await waitForSceneReady(canvas);

  return canvas.evaluate(
    (element, requestedObjectId) =>
      new Promise<{ x: number; y: number } | null>((resolve) => {
        element.dispatchEvent(
          new CustomEvent("getEditableObjectPoint", {
            detail: {
              objectId: requestedObjectId,
              respond: resolve,
            },
          }),
        );
      }),
    objectId,
  );
}

async function getCollisionDebugState(canvas: Locator) {
  await waitForSceneReady(canvas);

  return canvas.evaluate(
    (element) =>
      new Promise<{
        obstacleAX: number | null;
        obstacleBlocksKart: boolean;
        obstacleCount: number;
        rampCount: number;
        startClear: boolean;
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
      new Promise<{
        airbornePitchActive: boolean;
        airbornePitchAngle: number;
        airbornePitchRate: number;
        airbornePitchTarget: number;
        airbornePitchTorque: number;
        angularSpeed: number;
        chassisClearance: number;
        forward: { x: number; y: number; z: number };
        isOverGround: boolean;
        maximumLateralSpeed: number;
        maximumTireForceUtilization: number;
        maxForwardSpeed: number;
        rotationX: number;
        rotationY: number;
        rotationZ: number;
        speed: number;
        steerAngle: number;
        supportCount: number;
        supportEntityNames: string[];
        supportedWheelNames: string[];
        saturatedTireCount: number;
        up: { x: number; y: number; z: number };
        verticalVelocity: number;
        wheelHubYs: Record<string, number>;
        wheelLoads: Record<string, number>;
        wheelSweepFractions: Record<string, number | null>;
        x: number;
        y: number;
        z: number;
      }>((resolve) => {
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

  await canvas.evaluate(
    (element, requestedPose) => {
      element.dispatchEvent(
        new CustomEvent("setKartDebugPose", {
          detail: {
            pose: requestedPose,
          },
        }),
      );
    },
    pose,
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

async function stepSimulation(canvas: Locator, steps = 1) {
  await canvas.evaluate((element, requestedSteps) => {
    element.dispatchEvent(
      new CustomEvent("stepSimulation", {
        detail: { steps: requestedSteps },
      }),
    );
  }, steps);
}

test.describe("home screen", () => {
  test.describe.configure({ mode: "serial" });

  test("shows player-first mode selection with coming soon feedback", async ({
    page,
  }) => {
    await page.goto("/");

    await expect(page.getByAltText("Titan Racers")).toBeVisible();
    await expect(page.getByText("Choose game mode")).toBeVisible();

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

  test("shows an accessible error and reloads after kart physics cannot load", async ({
    page,
  }) => {
    await page.route("**/vendor/ammo/**", (route) => route.abort());
    await page.goto("/");
    await page.getByRole("button", { name: "Solo Time Trial" }).click();

    await expect(
      page.getByRole("alert").filter({ hasText: "Unable to start the race" }),
    ).toBeVisible();
    await page.unroute("**/vendor/ammo/**");
    await page.getByRole("button", { name: "Reload" }).click();
    await expect(page.getByText("Choose game mode")).toBeVisible();
    await page.getByRole("button", { name: "Solo Time Trial" }).click();
    await expect(page.getByTestId("solo-time-trial-canvas")).toHaveAttribute(
      "data-scene-ready",
      "true",
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
    await page.route("**/vendor/ammo/**", async (route) => {
      await blockedRequest;
      await route.abort();
    });
    await page.goto("/");
    await page.getByRole("button", { name: "Solo Time Trial" }).click();

    await expect(page.getByRole("status")).toHaveText(
      "Preparing kart physics…",
    );
    await page.getByRole("button", { name: "Exit" }).click();
    await expect(page.getByText("Choose game mode")).toBeVisible();

    releaseRequest();
    await page.unrouteAll({ behavior: "wait" });
    expect(pageErrors).toEqual([]);
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

    const kartPoint = await getEditableObjectPoint(canvas, "kart");

    expect(kartPoint).not.toBeNull();
    expect(
      Math.abs((kartPoint?.x ?? 0) - (box?.width ?? 0) / 2),
    ).toBeLessThan((box?.width ?? 0) * 0.12);
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

    const startState = await getKartDebugState(canvas);

    await expect
      .poll(async () => getKartDebugState(canvas))
      .toMatchObject({ supportCount: 4 });

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
        .toBeGreaterThan(0.75);
    } finally {
      await page.keyboard.up("ArrowUp");
    }

    const movedState = await getKartDebugState(canvas);
    expect(movedState.speed).toBeGreaterThan(startState.speed);
    expect(Math.abs(movedState.y - startState.y)).toBeLessThan(0.08);
    expect(Math.abs(movedState.verticalVelocity)).toBeLessThan(0.5);
    expect(
      Math.hypot(movedState.x - startState.x, movedState.z - startState.z),
    ).toBeGreaterThan(0.75);
  });

  test("settles at rest without chassis drift or rotation", async ({ page }) => {
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
      Math.hypot(
        laterState.x - settledState.x,
        laterState.z - settledState.z,
      ),
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
            (wheelLoads["front-left"] ?? 0) +
            (wheelLoads["front-right"] ?? 0);
          const rearLoad =
            (wheelLoads["rear-left"] ?? 0) +
            (wheelLoads["rear-right"] ?? 0);

          return frontLoad - rearLoad - preBrakingFrontMinusRear;
        })
        .toBeGreaterThan(40);
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
            (wheelLoads["rear-left"] ?? 0) +
            (wheelLoads["rear-right"] ?? 0);
          const frontLoad =
            (wheelLoads["front-left"] ?? 0) +
            (wheelLoads["front-right"] ?? 0);

          return rearLoad - frontLoad;
        })
        .toBeGreaterThan(40);
    } finally {
      await page.keyboard.up("ArrowUp");
    }
  });

  test("approaches the configured forward speed without exceeding it", async ({
    page,
  }) => {
    await page.goto("/");

    await page.getByRole("button", { name: "Solo Time Trial" }).click();

    const canvas = page.getByTestId("solo-time-trial-canvas");
    await setSimulationPaused(canvas, true);
    await setKartDebugPose(canvas, {
      position: { x: 30, y: 0.43, z: -12 },
      rotation: { x: 0, y: 90, z: 0 },
    });
    await stepSimulation(canvas, 5);
    await canvas.click();
    await page.keyboard.down("ArrowUp");

    try {
      await stepSimulation(canvas, 300);
    } finally {
      await page.keyboard.up("ArrowUp");
    }

    const state = await getKartDebugState(canvas);

    expect(state.supportCount).toBe(4);
    expect(state.speed).toBeGreaterThan(state.maxForwardSpeed * 0.9);
    expect(state.speed).toBeLessThanOrEqual(state.maxForwardSpeed + 0.1);
  });

  test("steers while driving in reverse", async ({ page }) => {
    await page.goto("/");

    await page.getByRole("button", { name: "Solo Time Trial" }).click();

    const canvas = page.getByTestId("solo-time-trial-canvas");
    await setSimulationPaused(canvas, true);
    await setKartDebugPose(canvas, {
      position: { x: 0, y: 0.43, z: -12 },
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

  test("saturates and recovers lateral grip with lateral load transfer", async ({
    page,
  }) => {
    await page.goto("/");

    await page.getByRole("button", { name: "Solo Time Trial" }).click();

    const canvas = page.getByTestId("solo-time-trial-canvas");
    await setSimulationPaused(canvas, true);
    await setKartDebugPose(canvas, {
      linearVelocity: { x: 0, y: 0, z: 5 },
      position: { x: 0, y: 0.33, z: -12 },
      rotation: { x: 0, y: 90, z: 0 },
    });
    await stepSimulation(canvas, 4);

    const slidingState = await getKartDebugState(canvas);
    const leftLoad =
      (slidingState.wheelLoads["front-left"] ?? 0) +
      (slidingState.wheelLoads["rear-left"] ?? 0);
    const rightLoad =
      (slidingState.wheelLoads["front-right"] ?? 0) +
      (slidingState.wheelLoads["rear-right"] ?? 0);

    expect(
      slidingState.supportCount,
      `sliding=${JSON.stringify(slidingState)}`,
    ).toBeGreaterThanOrEqual(3);
    expect(slidingState.maximumLateralSpeed).toBeGreaterThan(3);
    expect(slidingState.maximumTireForceUtilization).toBe(1);
    expect(slidingState.saturatedTireCount).toBeGreaterThan(0);
    expect(Math.abs(leftLoad - rightLoad)).toBeGreaterThan(40);

    await stepSimulation(canvas, 120);

    const recoveredState = await getKartDebugState(canvas);

    expect(recoveredState.supportCount).toBe(4);
    expect(recoveredState.maximumLateralSpeed).toBeLessThan(
      slidingState.maximumLateralSpeed * 0.35,
    );
    expect(recoveredState.saturatedTireCount).toBe(0);
  });

  test("edits solo kart movement tuning in the lite editor", async ({
    page,
  }) => {
    await page.goto("/");

    await page.getByRole("button", { name: "Solo Time Trial" }).click();
    await openEditor(page);

    const canvas = page.getByTestId("solo-time-trial-canvas");
    const maxSpeedInput = page.getByTestId("movement-maxForwardSpeed");

    await expect(maxSpeedInput).toHaveValue("17");

    await maxSpeedInput.fill("11");

    await expect(maxSpeedInput).toHaveValue("11");
    await expect
      .poll(async () => (await getKartDebugState(canvas)).maxForwardSpeed)
      .toBe(11);

    await page.getByRole("button", { name: "Defaults" }).click();

    await expect(maxSpeedInput).toHaveValue("17");
    await expect
      .poll(async () => (await getKartDebugState(canvas)).maxForwardSpeed)
      .toBe(17);
  });

  test("resets an upside-down kart with orientation and momentum cleared", async ({
    page,
  }) => {
    await page.goto("/");

    await page.getByRole("button", { name: "Solo Time Trial" }).click();

    const canvas = page.getByTestId("solo-time-trial-canvas");
    await expect(canvas).toBeVisible();
    await setSimulationPaused(canvas, true);
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

    expect({ x: resetState.x, y: resetState.y, z: resetState.z }).toEqual({
      x: 0.2,
      y: 0.38,
      z: 0,
    });
    expect(Math.abs(resetState.rotationX)).toBeLessThan(0.05);
    expect(Math.abs(resetState.rotationY - 90)).toBeLessThan(0.05);
    expect(Math.abs(resetState.rotationZ)).toBeLessThan(0.05);
    expect(Math.abs(resetState.verticalVelocity)).toBeLessThan(0.05);
    expect(resetState.angularSpeed).toBeLessThan(0.05);
  });

  test("tips from partial wheel support at the platform edge", async ({
    page,
  }) => {
    await page.goto("/");

    await page.getByRole("button", { name: "Solo Time Trial" }).click();

    const canvas = page.getByTestId("solo-time-trial-canvas");
    await setSimulationPaused(canvas, true);
    await setKartDebugPose(canvas, {
      position: { x: 43.5, y: 0.33, z: 8 },
      rotation: { x: 0, y: 0, z: 0 },
    });
    await stepSimulation(canvas);

    expect((await getKartDebugState(canvas)).supportedWheelNames).toEqual([
      "front-left",
      "rear-left",
    ]);

    await setKartDebugPose(canvas, {
      position: { x: 43.9, y: 0.33, z: 8 },
      rotation: { x: 0, y: 90, z: 0 },
    });
    await stepSimulation(canvas);

    expect((await getKartDebugState(canvas)).supportedWheelNames).toEqual([
      "front-left",
      "front-right",
    ]);

    await setKartDebugPose(canvas, {
      position: { x: 44.05, y: 0.33, z: 8 },
      rotation: { x: 0, y: 0, z: 0 },
    });

    let edgeState = await getKartDebugState(canvas);

    for (
      let step = 0;
      step < 120 &&
      Math.max(Math.abs(edgeState.rotationX), Math.abs(edgeState.rotationZ)) <= 4;
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
    ).toBeGreaterThan(5);

    let landedState = airborneState;

    for (let batch = 0; batch < 12 && landedState.supportCount === 0; batch += 1) {
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
    await setSimulationPaused(canvas, true);
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

    expect(resetPresentation.visualPosition).toEqual({ x: 0, y: 0.43, z: 0 });
    expect(resetPresentation.physicsPosition).not.toEqual(
      resetPresentation.visualPosition,
    );
    expect(resetPresentation.cameraTrackedPosition).toEqual(
      resetPresentation.visualPosition,
    );
  });

  test("edits the solo start position", async ({ page }) => {
    await page.goto("/");

    await page.getByRole("button", { name: "Solo Time Trial" }).click();
    await openEditor(page);

    const startX = page.getByTestId("start-position-x");
    const startZ = page.getByTestId("start-position-z");

    await expect(startX).toHaveValue("0");
    await expect(startZ).toHaveValue("0");

    await page
      .getByRole("button", { name: "Move start position right" })
      .click();
    await page
      .getByRole("button", { name: "Move start position backward" })
      .click();

    await expect(startX).toHaveValue("0.5");
    await expect(startZ).toHaveValue("0.5");

    await page.getByRole("button", { name: "Reset" }).click();
    await expect(page.getByTestId("solo-time-trial-canvas")).toBeVisible();
  });

  test("selects editable solo objects in editor mode", async ({
    page,
  }, testInfo) => {
    test.skip(
      testInfo.project.name === "mobile",
      "Mobile editor object picking needs a separate ergonomics pass.",
    );

    await page.goto("/");

    await page.getByRole("button", { name: "Solo Time Trial" }).click();
    await openEditor(page);

    await expect(page.getByTestId("selected-editor-object")).toHaveText(
      "Start Position",
    );

    const canvas = page.getByTestId("solo-time-trial-canvas");
    const kartPoint = await getEditableObjectPoint(canvas, "kart");

    expect(kartPoint).not.toBeNull();

    await canvas.click({
      position: {
        x: kartPoint?.x ?? 0,
        y: kartPoint?.y ?? 0,
      },
    });

    await expect(page.getByTestId("selected-editor-object")).toHaveText("Kart");
  });

  test("translates the selected solo editor object", async ({
    page,
  }, testInfo) => {
    test.skip(
      testInfo.project.name === "mobile",
      "Mobile editor object picking needs a separate ergonomics pass.",
    );

    await page.goto("/");

    await page.getByRole("button", { name: "Solo Time Trial" }).click();
    await openEditor(page);

    await page
      .getByRole("button", { name: "Move selected positive X" })
      .click();
    await page
      .getByRole("button", { name: "Move selected positive Y" })
      .click();
    await page
      .getByRole("button", { name: "Move selected negative Z" })
      .click();

    await expect(page.getByTestId("selected-position-x")).toHaveText("X 0.5");
    await expect(page.getByTestId("selected-position-y")).toHaveText("Y 0");
    await expect(page.getByTestId("selected-position-z")).toHaveText("Z -0.5");
    await expect(page.getByTestId("start-position-x")).toHaveValue("0.5");
    await expect(page.getByTestId("start-position-z")).toHaveValue("-0.5");

    const canvas = page.getByTestId("solo-time-trial-canvas");
    const kartPoint = await getEditableObjectPoint(canvas, "kart");

    expect(kartPoint).not.toBeNull();

    await canvas.click({
      position: {
        x: kartPoint?.x ?? 0,
        y: kartPoint?.y ?? 0,
      },
    });

    await expect(page.getByTestId("selected-editor-object")).toHaveText("Kart");
    await expect(page.getByTestId("selected-position-x")).toHaveText("X 0");

    await page
      .getByRole("button", { name: "Move selected positive X" })
      .click();

    await expect(page.getByTestId("selected-position-x")).toHaveText("X 0.5");
  });

  test("translates with the visual editor arrows", async ({
    page,
  }, testInfo) => {
    test.skip(
      testInfo.project.name === "mobile",
      "Mobile gizmo ergonomics need a separate layout pass.",
    );

    await page.goto("/");

    await page.getByRole("button", { name: "Solo Time Trial" }).click();
    await openEditor(page);

    const canvas = page.getByTestId("solo-time-trial-canvas");
    const xArrowPoint = await getTranslateGizmoPoint(canvas, "x");

    expect(xArrowPoint).not.toBeNull();

    await canvas.click({
      position: {
        x: xArrowPoint?.x ?? 0,
        y: xArrowPoint?.y ?? 0,
      },
    });

    await expect(page.getByTestId("selected-position-x")).toHaveText("X 0.5");
    await expect(page.getByTestId("start-position-x")).toHaveValue("0.5");
  });

  test("registers course obstacle collision", async ({ page }) => {
    await page.goto("/");

    await page.getByRole("button", { name: "Solo Time Trial" }).click();

    const canvas = page.getByTestId("solo-time-trial-canvas");
    const collisionState = await getCollisionDebugState(canvas);

    expect(collisionState.obstacleCount).toBe(2);
    expect(collisionState.rampCount).toBe(1);
    expect(collisionState.obstacleBlocksKart).toBe(true);
    expect(collisionState.startClear).toBe(true);
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
      position: { x: 4, y: 0.43, z: 25.5 },
      rotation: { x: 0, y: 0, z: 0 },
    });
    await stepSimulation(canvas, 36);

    const collision = await getCollisionResponseDebugState(canvas);
    const kart = await getKartDebugState(canvas);

    expect(collision.contactedEntityNames).toContain(
      "collision-response-wall",
    );
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
      position: { x: -0.5, y: 0.43, z: 27.65 },
      rotation: { x: 0, y: 90, z: 0 },
    });
    await stepSimulation(canvas, 40);

    const collision = await getCollisionResponseDebugState(canvas);
    const kart = await getKartDebugState(canvas);

    expect(collision.contactedEntityNames).toContain(
      "collision-response-wall",
    );
    expect(collision.postLinearVelocity.x).toBeGreaterThan(7);
    expect(kart.x).toBeGreaterThan(4);
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
      position: { x: 9.55, y: 0.43, z: 25.5 },
      rotation: { x: 0, y: 0, z: 0 },
    });
    await stepSimulation(canvas, 36);

    const collision = await getCollisionResponseDebugState(canvas);

    expect(collision.contactedEntityNames).toContain(
      "collision-response-wall",
    );
    expect(collision.maximumAngularSpeedAfterImpact).toBeGreaterThan(0.2);
    expect(collision.maximumAngularSpeedAfterImpact).toBeLessThan(15);
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
      position: { x: 32, y: 0.38, z: 32 },
      rotation: { x: 0, y: 65, z: 0 },
    });
    await stepSimulation(canvas, 22);

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
    expect(collision.maximumAngularSpeedAfterImpact).toBeLessThan(15);
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
      position: { x: 26, y: 0.38, z: 27 },
      rotation: { x: 0, y: -135, z: 0 },
    });
    await stepSimulation(canvas, 36);

    const collision = await getCollisionResponseDebugState(canvas);
    const cornerState = await getKartDebugState(canvas);
    const cornerDistance = Math.hypot(
      cornerState.x - 29,
      cornerState.z - 30,
    );

    expect(collision.contactedEntityNames).toContain(
      "collision-corner-horizontal-wall",
    );
    expect(collision.contactedEntityNames).toContain(
      "collision-corner-vertical-wall",
    );

    await page.keyboard.down("ArrowDown");

    try {
      await stepSimulation(canvas, 150);
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
      position: { x: -29.5, y: 0.43, z: 24 },
      rotation: { x: 0, y: 90, z: 0 },
    });
    await stepSimulation(canvas, 30);

    const collision = await getCollisionResponseDebugState(canvas);
    const kart = await getKartDebugState(canvas);

    expect(collision.ccdMotionThreshold).toBe(0);
    expect(collision.contactedEntityNames).toContain(
      "collision-ccd-thin-wall",
    );
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
      position: { x: -29.5, y: 0.43, z: 24 },
      rotation: { x: 0, y: 90, z: 0 },
    });
    await stepSimulation(canvas, 30);

    const collision = await getCollisionResponseDebugState(canvas);
    const kart = await getKartDebugState(canvas);

    expect(collision.ccdMotionThreshold).toBe(0.12);
    expect(collision.ccdSweptSphereRadius).toBe(0.16);
    expect(collision.contactedEntityNames).toContain(
      "collision-ccd-thin-wall",
    );
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
      position: { x: -29.5, y: 0.43, z: 24 },
      rotation: { x: 0, y: 90, z: 0 },
    });
    await stepSimulation(canvas, 6);

    const collision = await getCollisionResponseDebugState(canvas);
    const kart = await getKartDebugState(canvas);

    expect(collision.contactedEntityNames).not.toContain(
      "collision-ccd-thin-wall",
    );
    expect(kart.x).toBeLessThan(-30.2);
    expect(kart.x).toBeGreaterThan(-31.2);
  });

  test("keeps a fast rotational thin-wall contact bounded", async ({ page }) => {
    await page.goto("/?collision-fixtures");
    await page.getByRole("button", { name: "Solo Time Trial" }).click();

    const canvas = page.getByTestId("solo-time-trial-canvas");

    await setSimulationPaused(canvas, true);
    await setKartDebugPose(canvas, {
      angularVelocity: { x: 0, y: 18, z: 0 },
      position: { x: -31.8, y: 0.43, z: 24 },
      rotation: { x: 0, y: 0, z: 0 },
    });
    await stepSimulation(canvas, 45);

    const collision = await getCollisionResponseDebugState(canvas);
    const kart = await getKartDebugState(canvas);

    expect(collision.contactedEntityNames).toContain(
      "collision-ccd-thin-wall",
    );
    expect(collision.maximumAngularSpeedAfterImpact).toBeLessThan(25);
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

    expect(state.chassisClearance).toBeGreaterThan(0.06);
    expect(Object.keys(state.wheelHubYs)).toHaveLength(4);
    expect(Object.values(state.wheelHubYs).every((y) => y >= -0.36 && y <= 0.06)).toBe(
      true,
    );
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

    await setSimulationPaused(canvas, true);
    await setKartDebugPose(canvas, {
      linearVelocity: { x: 0, y: -3, z: 0 },
      position: { x: 0, y: 4.5, z: 16 },
      rotation: { x: 0, y: -90, z: 0 },
    });
    await stepSimulation(canvas, 180);

    const suspension = await getSuspensionDebugState(canvas);

    expect(suspension.minimumSupportedWheels).toBe(0);
    expect(suspension.maximumSupportedWheels).toBeGreaterThanOrEqual(2);
    expect(suspension.maximumCompression).toBeGreaterThan(0.08);
  });

  test("keeps a rear-balanced pitch attitude after ramp takeoff", async ({
    page,
  }) => {
    await page.goto("/");
    await page.getByRole("button", { name: "Solo Time Trial" }).click();

    const canvas = page.getByTestId("solo-time-trial-canvas");

    await setSimulationPaused(canvas, true);
    await setKartDebugPose(canvas, {
      linearVelocity: { x: 17, y: 0, z: 0 },
      position: { x: -14, y: 0.4, z: 16 },
      rotation: { x: 0, y: -90, z: 0 },
    });
    await canvas.focus();
    await page.keyboard.down("ArrowUp");

    let trajectory: Array<{
      airbornePitchActive: boolean;
      airbornePitchAngle: number;
      airbornePitchRate: number;
      airbornePitchTarget: number;
      airbornePitchTorque: number;
      forward: { x: number; y: number; z: number };
      supportCount: number;
      up: { x: number; y: number; z: number };
      y: number;
    }> = [];

    try {
      trajectory = await canvas.evaluate((element) => {
        const states: Array<{
          airbornePitchActive: boolean;
          airbornePitchAngle: number;
          airbornePitchRate: number;
          airbornePitchTarget: number;
          airbornePitchTorque: number;
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
                respond: (state: (typeof states)[number]) => states.push(state),
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

    expect(airborne.length).toBeGreaterThan(10);
    expect(airborne.every((state) => state.airbornePitchActive)).toBe(true);
    expect(
      trajectory
        .filter((state) => state.supportCount > 0)
        .every((state) => !state.airbornePitchActive),
    ).toBe(true);
    expect(
      airborne.some((state) => Math.abs(state.airbornePitchTorque) > 1),
    ).toBe(true);
    expect(
      airborne.every(
        (state) =>
          Number.isFinite(state.airbornePitchAngle) &&
          Number.isFinite(state.airbornePitchRate) &&
          state.airbornePitchTarget === 0.1,
      ),
    ).toBe(true);
    expect(Math.max(...trajectory.map((state) => state.y))).toBeGreaterThan(2);
    expect(
      minimumAirborneNoseHeight,
      `airborne=${JSON.stringify(airborne.filter((_, index) => index % 10 === 0))}`,
    ).toBeGreaterThan(-0.1);
  });

  test("keeps the drive cursor hidden and restores it for editing", async ({
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

    await page.mouse.move(520, 320);
    await expect(canvas).toHaveCSS("cursor", "none");
    await openEditor(page);
    await expect(canvas).toHaveCSS("cursor", "default");
    await page.getByRole("button", { name: "Drive" }).click();
    await expect(page.getByText("Paused", { exact: true })).toBeVisible();
    await expect(canvas).toHaveCSS("cursor", "default");
    await page.getByRole("button", { name: "Resume" }).click();
    await expect(page.getByText("Paused", { exact: true })).not.toBeVisible();
    await expect(canvas).toHaveCSS("cursor", "none");
  });

  test("edits selectable course obstacles", async ({ page }, testInfo) => {
    test.skip(
      testInfo.project.name === "mobile",
      "Mobile editor object picking needs a separate ergonomics pass.",
    );

    await page.goto("/");

    await page.getByRole("button", { name: "Solo Time Trial" }).click();
    await openEditor(page);

    const canvas = page.getByTestId("solo-time-trial-canvas");
    const obstaclePoint = await getEditableObjectPoint(
      canvas,
      "obstacle-barrel-a",
    );

    expect(obstaclePoint).not.toBeNull();

    await canvas.evaluate((element, point) => {
      const rect = element.getBoundingClientRect();

      element.dispatchEvent(
        new PointerEvent("pointerdown", {
          bubbles: true,
          clientX: rect.left + point.x,
          clientY: rect.top + point.y,
        }),
      );
    }, obstaclePoint ?? { x: 0, y: 0 });

    await expect(page.getByTestId("selected-editor-object")).toHaveText(
      "Barrel A",
    );
    await expect(page.getByTestId("selected-position-x")).toHaveText("X 14.5");
    await expect(page.getByTestId("selected-rotation-y")).toHaveText("RY 0");

    await page
      .getByRole("button", { name: "Move selected positive X" })
      .click();

    await expect(page.getByTestId("selected-position-x")).toHaveText("X 15");

    const movedCollisionState = await getCollisionDebugState(canvas);
    expect(movedCollisionState.obstacleAX).toBe(15);

    await page
      .getByRole("button", { name: "Rotate selected positive Y" })
      .click();

    await expect(page.getByTestId("selected-rotation-y")).toHaveText("RY 15");
  });

  test("rotates the selected solo editor object", async ({
    page,
  }, testInfo) => {
    test.skip(
      testInfo.project.name === "mobile",
      "Mobile editor object picking needs a separate ergonomics pass.",
    );

    await page.goto("/");

    await page.getByRole("button", { name: "Solo Time Trial" }).click();
    await openEditor(page);

    await expect(page.getByTestId("selected-rotation-y")).toHaveText("RY 90");

    await page
      .getByRole("button", { name: "Rotate selected positive Y" })
      .click();
    await page
      .getByRole("button", { name: "Rotate selected positive Y" })
      .click();
    await page
      .getByRole("button", { name: "Rotate selected positive X" })
      .click();
    await page
      .getByRole("button", { name: "Rotate selected negative Z" })
      .click();

    await expect(page.getByTestId("selected-rotation-x")).toHaveText("RX 15");
    await expect(page.getByTestId("selected-rotation-y")).toHaveText("RY 120");
    await expect(page.getByTestId("selected-rotation-z")).toHaveText("RZ -15");

    const canvas = page.getByTestId("solo-time-trial-canvas");
    const kartPoint = await getEditableObjectPoint(canvas, "kart");

    expect(kartPoint).not.toBeNull();

    await canvas.click({
      position: {
        x: kartPoint?.x ?? 0,
        y: kartPoint?.y ?? 0,
      },
    });

    await expect(page.getByTestId("selected-editor-object")).toHaveText("Kart");
    await expect
      .poll(async () =>
        Number(
          (await page.getByTestId("selected-rotation-y").textContent())?.replace(
            "RY ",
            "",
          ),
        ),
      )
      .toBeCloseTo(90, 1);

    await page
      .getByRole("button", { name: "Rotate selected positive X" })
      .click();

    await expect(page.getByTestId("selected-rotation-x")).toHaveText("RX 15");
    await expect(page.getByTestId("selected-rotation-z")).toHaveText("RZ 0");

    const kartRotation = await getKartDebugState(canvas);

    expect(Math.abs(kartRotation.up.x)).toBeLessThan(0.05);
    expect(Math.abs(kartRotation.up.z)).toBeGreaterThan(0.2);

    await page
      .getByRole("button", { name: "Rotate selected negative Y" })
      .click();
    await page
      .getByRole("button", { name: "Rotate selected negative Y" })
      .click();

    await expect(page.getByTestId("selected-rotation-y")).toHaveText("RY 60");
  });
});

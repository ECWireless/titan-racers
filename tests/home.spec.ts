import { expect, type Locator, test } from "@playwright/test";

type TransformAxis = "x" | "y" | "z";
type EditableObjectId =
  | "start-position"
  | "kart"
  | "obstacle-concrete-block-a"
  | "obstacle-barrel-a"
  | "obstacle-concrete-block-b"
  | "obstacle-barrel-b";

async function waitForSceneReady(canvas: Locator) {
  await expect(canvas).toHaveAttribute("data-scene-ready", "true");
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
        blockAX: number | null;
        obstacleBlocksKart: boolean;
        obstacleCount: number;
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

async function getKartDebugState(canvas: Locator) {
  await waitForSceneReady(canvas);

  return canvas.evaluate(
    (element) =>
      new Promise<{
        angularSpeed: number;
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
        verticalVelocity: number;
        wheelLoads: Record<string, number>;
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

async function setKartDebugPose(
  canvas: Locator,
  pose: {
    angularVelocity?: { x: number; y: number; z: number };
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

          return frontLoad - rearLoad;
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
      position: { x: 30, y: 0.28, z: -12 },
      rotation: { x: 0, y: 90, z: 0 },
    });
    await stepSimulation(canvas, 5);
    await canvas.click();
    await page.keyboard.down("ArrowUp");

    try {
      await stepSimulation(canvas, 420);
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
      position: { x: 0, y: 0.28, z: -12 },
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
      position: { x: 0, y: 0.28, z: -12 },
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

    expect(slidingState.supportCount).toBe(4);
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
    await page.getByRole("button", { name: "Edit" }).click();

    const canvas = page.getByTestId("solo-time-trial-canvas");
    const maxSpeedInput = page.getByTestId("movement-maxForwardSpeed");

    await expect(maxSpeedInput).toHaveValue("8.5");

    await maxSpeedInput.fill("11");

    await expect(maxSpeedInput).toHaveValue("11");
    await expect
      .poll(async () => (await getKartDebugState(canvas)).maxForwardSpeed)
      .toBe(11);

    await page.getByRole("button", { name: "Defaults" }).click();

    await expect(maxSpeedInput).toHaveValue("8.5");
    await expect
      .poll(async () => (await getKartDebugState(canvas)).maxForwardSpeed)
      .toBe(8.5);
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
      x: 0,
      y: 0.28,
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
      position: { x: 35.5, y: 0.28, z: 8 },
      rotation: { x: 0, y: 0, z: 0 },
    });
    await stepSimulation(canvas);

    expect((await getKartDebugState(canvas)).supportedWheelNames).toEqual([
      "front-left",
      "rear-left",
    ]);

    await setKartDebugPose(canvas, {
      position: { x: 35.5, y: 0.28, z: 8 },
      rotation: { x: 0, y: 90, z: 0 },
    });
    await stepSimulation(canvas);

    expect((await getKartDebugState(canvas)).supportedWheelNames).toEqual([
      "front-left",
      "front-right",
    ]);

    await setKartDebugPose(canvas, {
      position: { x: 36.05, y: 0.28, z: 8 },
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

    for (let step = 0; step < 120 && landedState.supportCount === 0; step += 1) {
      await stepSimulation(canvas);
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

    expect(resetPresentation.visualPosition).toEqual(
      resetPresentation.physicsPosition,
    );
    expect(resetPresentation.cameraTrackedPosition).toEqual(
      resetPresentation.visualPosition,
    );
  });

  test("edits the solo start position", async ({ page }) => {
    await page.goto("/");

    await page.getByRole("button", { name: "Solo Time Trial" }).click();
    await page.getByRole("button", { name: "Edit" }).click();

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
    await page.getByRole("button", { name: "Edit" }).click();

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
    await page.getByRole("button", { name: "Edit" }).click();

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
    await page.getByRole("button", { name: "Edit" }).click();

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

    expect(collisionState.obstacleCount).toBe(4);
    expect(collisionState.obstacleBlocksKart).toBe(true);
    expect(collisionState.startClear).toBe(true);
  });

  test("edits selectable course obstacles", async ({ page }, testInfo) => {
    test.skip(
      testInfo.project.name === "mobile",
      "Mobile editor object picking needs a separate ergonomics pass.",
    );

    await page.goto("/");

    await page.getByRole("button", { name: "Solo Time Trial" }).click();
    await page.getByRole("button", { name: "Edit" }).click();

    const canvas = page.getByTestId("solo-time-trial-canvas");
    const blockPoint = await getEditableObjectPoint(
      canvas,
      "obstacle-concrete-block-a",
    );

    expect(blockPoint).not.toBeNull();

    await canvas.click({
      position: {
        x: blockPoint?.x ?? 0,
        y: blockPoint?.y ?? 0,
      },
    });

    await expect(page.getByTestId("selected-editor-object")).toHaveText(
      "Block A",
    );
    await expect(page.getByTestId("selected-position-x")).toHaveText("X 8");
    await expect(page.getByTestId("selected-rotation-y")).toHaveText("RY 18");

    await page
      .getByRole("button", { name: "Move selected positive X" })
      .click();

    await expect(page.getByTestId("selected-position-x")).toHaveText("X 8.5");

    const movedCollisionState = await getCollisionDebugState(canvas);
    expect(movedCollisionState.blockAX).toBe(8.5);

    await page
      .getByRole("button", { name: "Rotate selected positive Y" })
      .click();

    await expect(page.getByTestId("selected-rotation-y")).toHaveText("RY 33");
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
    await page.getByRole("button", { name: "Edit" }).click();

    await expect(page.getByTestId("selected-rotation-y")).toHaveText("RY 90");

    await page
      .getByRole("button", { name: "Rotate selected positive X" })
      .click();
    await page
      .getByRole("button", { name: "Rotate selected positive Y" })
      .click();
    await page
      .getByRole("button", { name: "Rotate selected negative Z" })
      .click();

    await expect(page.getByTestId("selected-rotation-x")).toHaveText("RX 15");
    await expect(page.getByTestId("selected-rotation-y")).toHaveText("RY 105");
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
      .getByRole("button", { name: "Rotate selected negative Y" })
      .click();

    await expect
      .poll(async () =>
        Number(
          (await page.getByTestId("selected-rotation-y").textContent())?.replace(
            "RY ",
            "",
          ),
        ),
      )
      .toBeCloseTo(75, 1);
  });
});

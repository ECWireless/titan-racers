import { expect, type Locator, test } from "@playwright/test";

type TransformAxis = "x" | "y" | "z";
type EditableObjectId =
  | "start-position"
  | "kart"
  | "obstacle-concrete-block-a"
  | "obstacle-barrel-a"
  | "obstacle-concrete-block-b"
  | "obstacle-barrel-b";

async function getTranslateGizmoPoint(
  canvas: Locator,
  axis: TransformAxis,
) {
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
  return canvas.evaluate(
    (element) =>
      new Promise<{
        isOverGround: boolean;
        maxForwardSpeed: number;
        speed: number;
        steerAngle: number;
        verticalVelocity: number;
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

async function setKartDebugPosition(
  canvas: Locator,
  position: { x: number; y: number; z: number },
) {
  await canvas.evaluate(
    (element, requestedPosition) => {
      element.dispatchEvent(
        new CustomEvent("setKartDebugPosition", {
          detail: {
            position: requestedPosition,
          },
        }),
      );
    },
    position,
  );
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

    await canvas.click();
    await page.keyboard.down("ArrowUp");
    await page.waitForTimeout(450);
    await page.keyboard.up("ArrowUp");

    const movedState = await getKartDebugState(canvas);

    expect(movedState.speed).toBeGreaterThan(startState.speed);
    expect(movedState.y).toBe(0);
    expect(movedState.verticalVelocity).toBe(0);
    expect(
      Math.hypot(movedState.x - startState.x, movedState.z - startState.z),
    ).toBeGreaterThan(0.75);
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
    await page.waitForTimeout(450);
    const turnedState = await getKartDebugState(canvas);

    await page.keyboard.up("ArrowLeft");
    await page.keyboard.up("ArrowUp");

    expect(turnedState.steerAngle).toBeGreaterThan(0);
    expect(
      Math.hypot(turnedState.x - startState.x, turnedState.z - startState.z),
    ).toBeGreaterThan(0.5);
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

  test("resets the solo kart after it falls off the grass plane", async ({
    page,
  }) => {
    await page.goto("/");

    await page.getByRole("button", { name: "Solo Time Trial" }).click();

    const canvas = page.getByTestId("solo-time-trial-canvas");
    await expect(canvas).toBeVisible();

    await setKartDebugPosition(canvas, { x: 38, y: 0, z: 8 });

    const fallingState = await getKartDebugState(canvas);

    expect(fallingState.isOverGround).toBe(false);

    await expect
      .poll(async () => {
        const state = await getKartDebugState(canvas);

        return {
          x: state.x,
          y: state.y,
          z: state.z,
        };
      })
      .toEqual({ x: 0, y: 0, z: 0 });
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

  test("selects editable solo objects in editor mode", async ({ page }) => {
    await page.goto("/");

    await page.getByRole("button", { name: "Solo Time Trial" }).click();
    await page.getByRole("button", { name: "Edit" }).click();

    await expect(page.getByTestId("selected-editor-object")).toHaveText(
      "Start Position",
    );

    const canvas = page.getByTestId("solo-time-trial-canvas");
    const box = await canvas.boundingBox();

    expect(box).not.toBeNull();

    await canvas.click({
      position: {
        x: (box?.width ?? 0) / 2,
        y: (box?.height ?? 0) / 2,
      },
    });

    await expect(page.getByTestId("selected-editor-object")).toHaveText("Kart");
  });

  test("translates the selected solo editor object", async ({ page }) => {
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
    await expect(page.getByTestId("selected-position-y")).toHaveText("Y 0.5");
    await expect(page.getByTestId("selected-position-z")).toHaveText("Z -0.5");
    await expect(page.getByTestId("start-position-x")).toHaveValue("0.5");
    await expect(page.getByTestId("start-position-z")).toHaveValue("-0.5");

    const canvas = page.getByTestId("solo-time-trial-canvas");
    const box = await canvas.boundingBox();

    expect(box).not.toBeNull();

    await canvas.click({
      position: {
        x: (box?.width ?? 0) / 2,
        y: (box?.height ?? 0) / 2,
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

  test("rotates the selected solo editor object", async ({ page }) => {
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
    const box = await canvas.boundingBox();

    expect(box).not.toBeNull();

    await canvas.click({
      position: {
        x: (box?.width ?? 0) / 2,
        y: (box?.height ?? 0) / 2,
      },
    });

    await expect(page.getByTestId("selected-editor-object")).toHaveText("Kart");
    await expect(page.getByTestId("selected-rotation-y")).toHaveText("RY 90");

    await page
      .getByRole("button", { name: "Rotate selected negative Y" })
      .click();

    await expect(page.getByTestId("selected-rotation-y")).toHaveText("RY 75");
  });
});

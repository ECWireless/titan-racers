import type { Page } from "@playwright/test";

export async function installStandardGamepadFixture(page: Page) {
  await page.addInitScript(() => {
    const testWindow = window as typeof window & {
      __TR_EDITOR_GAMEPADS__?: Gamepad[];
    };
    testWindow.__TR_EDITOR_GAMEPADS__ = [];
    Object.defineProperty(navigator, "getGamepads", {
      configurable: true,
      value: () => testWindow.__TR_EDITOR_GAMEPADS__ ?? [],
    });
  });
}

export async function setStandardTestGamepad(
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
        __TR_EDITOR_GAMEPADS__?: Gamepad[];
      };
      testWindow.__TR_EDITOR_GAMEPADS__ = [
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

export async function pressStandardGamepadButton(
  page: Page,
  button: number,
) {
  await setStandardTestGamepad(page, { buttons: { [button]: 1 } });
  await page.waitForTimeout(40);
  await setStandardTestGamepad(page);
  await page.waitForTimeout(40);
}

export async function disconnectStandardTestGamepad(page: Page) {
  await page.evaluate(() => {
    const testWindow = window as typeof window & {
      __TR_EDITOR_GAMEPADS__?: Gamepad[];
    };
    testWindow.__TR_EDITOR_GAMEPADS__ = [];
    window.dispatchEvent(new Event("gamepaddisconnected"));
  });
}

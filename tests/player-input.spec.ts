import { expect, test } from "@playwright/test";

import { GamepadInput } from "../src/game/input/gamepad-input";
import { GamepadMenuInput } from "../src/game/input/gamepad-menu-input";
import { KeyboardInput } from "../src/game/input/keyboard-input";
import { PlayerInputManager } from "../src/game/input/player-input-manager";
import {
  applyAxialDeadZone,
  clampInput,
  toDrivingInput,
} from "../src/game/input/player-input";
import {
  normalizeTouchSteering,
  TouchInput,
} from "../src/game/input/touch-input";

class KeyboardTarget {
  private readonly listeners = new Map<string, Set<EventListener>>();

  addEventListener(type: string, listener: EventListener) {
    const listeners = this.listeners.get(type) ?? new Set<EventListener>();
    listeners.add(listener);
    this.listeners.set(type, listeners);
  }

  removeEventListener(type: string, listener: EventListener) {
    this.listeners.get(type)?.delete(listener);
  }

  dispatch(type: string, code: string, repeat = false) {
    const event = {
      code,
      preventDefault: () => undefined,
      repeat,
    } as KeyboardEvent;
    this.listeners.get(type)?.forEach((listener) => listener(event as Event));
  }
}

function gamepadButton(value = 0, pressed = value > 0): GamepadButton {
  return { pressed, touched: pressed, value };
}

function standardGamepad({
  axes = [0, 0, 0, 0],
  buttons = {},
  index = 0,
}: {
  axes?: number[];
  buttons?: Record<number, GamepadButton>;
  index?: number;
} = {}): Gamepad {
  return {
    axes,
    buttons: Array.from({ length: 17 }, (_, buttonIndex) =>
      buttons[buttonIndex] ?? gamepadButton(),
    ),
    connected: true,
    hapticActuators: [],
    id: "Test standard controller",
    index,
    mapping: "standard",
    timestamp: 0,
    vibrationActuator: null,
  } as unknown as Gamepad;
}

test.describe("player input", () => {
  test("clamps invalid values and rescales steering outside the dead zone", () => {
    expect(clampInput(Number.NaN, -1, 1)).toBe(0);
    expect(clampInput(2, -1, 1)).toBe(1);
    expect(applyAxialDeadZone(0.1, 0.15)).toBe(0);
    expect(applyAxialDeadZone(-0.575, 0.15)).toBeCloseTo(-0.5, 6);
    expect(applyAxialDeadZone(1, 0.15)).toBe(1);
    expect(normalizeTouchSteering(0.04)).toBe(0);
    expect(normalizeTouchSteering(0.54)).toBeCloseTo(0.5 ** 1.75, 6);
    expect(normalizeTouchSteering(-0.54)).toBeCloseTo(-(0.5 ** 1.75), 6);
    expect(normalizeTouchSteering(1)).toBe(1);
  });

  test("maps normalized acceleration and brake/reverse to existing kart intent", () => {
    expect(
      toDrivingInput({
        accelerate: 0.75,
        brakeReverse: 0.25,
        handbrake: 0.6,
        pauseRequested: false,
        resetRequested: false,
        steer: -0.5,
      }),
    ).toEqual({
      brake: 0.25,
      handbrake: 0.6,
      reset: false,
      steer: 0.5,
      throttle: 0.5,
    });
  });

  test("keyboard supports both binding families and consumes action edges once", () => {
    const target = new KeyboardTarget();
    let activityCount = 0;
    const keyboard = new KeyboardInput(
      target as unknown as Window,
      () => activityCount += 1,
    );
    keyboard.attach();

    target.dispatch("keydown", "KeyW");
    target.dispatch("keydown", "ArrowLeft");
    target.dispatch("keydown", "ShiftLeft");
    target.dispatch("keydown", "KeyR");
    target.dispatch("keydown", "KeyR", true);
    target.dispatch("keydown", "Escape");

    expect(keyboard.sample()).toEqual({
      accelerate: 1,
      brakeReverse: 0,
      handbrake: 1,
      pauseRequested: true,
      resetRequested: true,
      steer: -1,
    });
    expect(keyboard.sample().resetRequested).toBe(false);
    expect(keyboard.sample().pauseRequested).toBe(false);
    expect(activityCount).toBe(3);

    keyboard.clear();
    expect(keyboard.getContinuousInput()).toEqual({
      accelerate: 0,
      brakeReverse: 0,
      handbrake: 0,
      steer: 0,
    });
    keyboard.detach();
  });

  test("touch retains analog steering and pedal pointers independently", () => {
    let activityCount = 0;
    const touch = new TouchInput(() => activityCount += 1);

    touch.setSteering(1, -0.54);
    touch.pressPedal(2, "accelerate");
    expect(touch.getContinuousInput()).toMatchObject({
      accelerate: 1,
      brakeReverse: 0,
      handbrake: 0,
    });
    expect(touch.getContinuousInput().steer).toBeCloseTo(-(0.5 ** 1.75), 6);

    touch.release(1);
    expect(touch.getContinuousInput()).toEqual({
      accelerate: 1,
      brakeReverse: 0,
      handbrake: 0,
      steer: 0,
    });
    expect(activityCount).toBe(2);

    touch.clear();
    expect(touch.getContinuousInput()).toEqual({
      accelerate: 0,
      brakeReverse: 0,
      handbrake: 0,
      steer: 0,
    });
  });

  test("polls a standard gamepad, ignores drift, and edge-detects actions", () => {
    let current = standardGamepad({ axes: [0.1, 0, 0, 0] });
    let activityCount = 0;
    const input = new GamepadInput(
      () => [current],
      () => activityCount += 1,
    );

    expect(input.sample().steer).toBe(0);
    expect(activityCount).toBe(0);

    current = standardGamepad({
      axes: [0.575, 0, 0, 0],
      buttons: {
        0: gamepadButton(1),
        7: gamepadButton(0.8),
        9: gamepadButton(1),
      },
    });
    const active = input.sample();
    expect(active.steer).toBeCloseTo(0.5, 6);
    expect(active.accelerate).toBe(0.8);
    expect(active.resetRequested).toBe(true);
    expect(active.pauseRequested).toBe(true);
    expect(activityCount).toBe(1);

    const held = input.sample();
    expect(held.resetRequested).toBe(false);
    expect(held.pauseRequested).toBe(false);

    current = { ...current, connected: false } as Gamepad;
    expect(input.sample().accelerate).toBe(0);
  });

  test("maps brake, handbrake, and digital D-pad steering fallback", () => {
    let current = standardGamepad({
      axes: [0.575, 0, 0, 0],
      buttons: {
        6: gamepadButton(0.4),
        2: gamepadButton(0.7),
        14: gamepadButton(1),
      },
    });
    const input = new GamepadInput(() => [current]);

    expect(input.sample()).toMatchObject({
      brakeReverse: 0.4,
      handbrake: 0.7,
      steer: -1,
    });

    current = standardGamepad({
      axes: [-0.575, 0, 0, 0],
      buttons: { 15: gamepadButton(1) },
    });
    expect(input.sample().steer).toBe(1);

    current = standardGamepad({
      buttons: {
        14: gamepadButton(1),
        15: gamepadButton(1),
      },
    });
    expect(input.sample().steer).toBe(0);
  });

  test("arms controller menus neutrally and edge-detects confirm, back, and menu", () => {
    let current = standardGamepad({ buttons: { 9: gamepadButton(1) } });
    const input = new GamepadMenuInput(() => [current]);

    expect(input.sample(0)).toEqual({
      backRequested: false,
      confirmRequested: false,
      menuRequested: false,
      move: 0,
    });
    current = standardGamepad();
    expect(input.sample(16).menuRequested).toBe(false);

    current = standardGamepad({
      buttons: {
        0: gamepadButton(1),
        1: gamepadButton(1),
        9: gamepadButton(1),
      },
    });
    expect(input.sample(32)).toMatchObject({
      backRequested: true,
      confirmRequested: true,
      menuRequested: true,
    });
    expect(input.sample(48)).toMatchObject({
      backRequested: false,
      confirmRequested: false,
      menuRequested: false,
    });
  });

  test("navigates controller menus with stick hysteresis and bounded repeat", () => {
    let current = standardGamepad();
    const input = new GamepadMenuInput(() => [current]);
    input.sample(0);

    current = standardGamepad({ axes: [0, 0.7, 0, 0] });
    expect(input.sample(16).move).toBe(1);
    expect(input.sample(300).move).toBe(0);
    expect(input.sample(366).move).toBe(1);
    expect(input.sample(400).move).toBe(0);

    current = standardGamepad({ axes: [0, 0.4, 0, 0] });
    expect(input.sample(486).move).toBe(1);
    current = standardGamepad({ axes: [0, 0.3, 0, 0] });
    expect(input.sample(500).move).toBe(0);
    current = standardGamepad({ axes: [0, 0.4, 0, 0] });
    expect(input.sample(516).move).toBe(0);

    current = standardGamepad({ buttons: { 12: gamepadButton(1) } });
    expect(input.sample(532).move).toBe(-1);
  });

  test("clears controller menu edges and requires neutral after disconnect", () => {
    let current = standardGamepad();
    const input = new GamepadMenuInput(() => [current]);
    input.sample(0);

    current = standardGamepad({ buttons: { 0: gamepadButton(1) } });
    expect(input.sample(16).confirmRequested).toBe(true);
    current = { ...current, connected: false } as Gamepad;
    expect(input.sample(32)).toEqual({
      backRequested: false,
      confirmRequested: false,
      menuRequested: false,
      move: 0,
    });

    current = standardGamepad({ buttons: { 0: gamepadButton(1) } });
    expect(input.sample(48).confirmRequested).toBe(false);
    current = standardGamepad();
    expect(input.sample(64).confirmRequested).toBe(false);
    current = standardGamepad({ buttons: { 0: gamepadButton(1) } });
    expect(input.sample(80).confirmRequested).toBe(true);
  });

  test("returns neutral input when no standard-mapped controller is available", () => {
    const unsupported = {
      ...standardGamepad(),
      mapping: "",
    } as Gamepad;
    const input = new GamepadInput(() => [unsupported]);

    expect(input.sample()).toEqual({
      accelerate: 0,
      brakeReverse: 0,
      handbrake: 0,
      pauseRequested: false,
      resetRequested: false,
      steer: 0,
    });
  });

  test("does not let an earlier idle controller block an intentional controller", () => {
    const idle = standardGamepad({ index: 0 });
    const active = standardGamepad({
      buttons: { 7: gamepadButton(0.6) },
      index: 1,
    });
    const input = new GamepadInput(() => [idle, active]);

    expect(input.sample()).toMatchObject({ accelerate: 0.6 });
  });

  test("requires neutral release before held gamepad state can re-arm", () => {
    let current = standardGamepad({
      buttons: {
        7: gamepadButton(1),
        9: gamepadButton(1),
      },
    });
    const input = new GamepadInput(() => [current]);
    expect(input.sample()).toMatchObject({
      accelerate: 1,
      pauseRequested: true,
    });

    input.clear();
    expect(input.sample()).toMatchObject({
      accelerate: 0,
      pauseRequested: false,
    });

    current = standardGamepad();
    expect(input.sample()).toMatchObject({ accelerate: 0 });
    current = standardGamepad({ buttons: { 7: gamepadButton(1) } });
    expect(input.sample()).toMatchObject({ accelerate: 1 });
  });

  test("detects gradual analog stick and trigger activation from a stable baseline", () => {
    let current = standardGamepad();
    let activityCount = 0;
    const input = new GamepadInput(
      () => [current],
      () => activityCount += 1,
    );

    for (let axis = 0.16; axis <= 0.3; axis += 0.01) {
      current = standardGamepad({ axes: [axis, 0, 0, 0] });
      input.sample();
    }
    expect(activityCount).toBeGreaterThan(0);

    input.clear();
    current = standardGamepad();
    input.sample();
    activityCount = 0;
    for (let trigger = 0.01; trigger <= 0.2; trigger += 0.01) {
      current = standardGamepad({
        buttons: { 7: gamepadButton(trigger) },
      });
      input.sample();
    }
    expect(activityCount).toBeGreaterThan(0);
  });

  test("clears queued keyboard edges before re-enabling the manager", () => {
    const target = new KeyboardTarget();
    const manager = new PlayerInputManager(
      target as unknown as Window,
      () => [],
    );
    manager.attach();
    manager.setEnabled(false);
    target.dispatch("keydown", "Escape");
    manager.setEnabled(true);

    expect(manager.sample().pauseRequested).toBe(false);
    manager.detach();
  });

  test("changes continuous ownership only after intentional device activity", () => {
    const target = new KeyboardTarget();
    let current = standardGamepad({ axes: [0.1, 0, 0, 0] });
    const manager = new PlayerInputManager(
      target as unknown as Window,
      () => [current],
    );
    manager.attach();

    target.dispatch("keydown", "KeyW");
    expect(manager.sample().accelerate).toBe(1);

    // Dead-zone noise cannot steal continuous control from the keyboard.
    expect(manager.sample().accelerate).toBe(1);

    manager.pressTouchPedal(21, "brakeReverse");
    expect(manager.sample()).toMatchObject({ accelerate: 0, brakeReverse: 1 });

    current = standardGamepad({
      buttons: { 7: gamepadButton(0.75) },
    });
    expect(manager.sample()).toMatchObject({
      accelerate: 0.75,
      brakeReverse: 0,
    });

    current = standardGamepad();
    manager.clear();
    expect(manager.sample()).toMatchObject({
      accelerate: 0,
      brakeReverse: 0,
      steer: 0,
    });
    manager.detach();
  });
});

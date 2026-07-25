import { expect, test } from "@playwright/test";

import {
  resolveEditorTranslationFromScreenProjections,
  type EditorControllerAxisProjections,
} from "../src/game/editor/editor-controller-viewport";
import { GamepadInput } from "../src/game/input/gamepad-input";
import { GamepadMenuInput } from "../src/game/input/gamepad-menu-input";
import {
  applyEditorStickDeadZone,
  EditorGamepadInput,
} from "../src/game/input/editor-gamepad-input";
import {
  findSpatialNavigationCandidate,
  type SpatialCandidate,
} from "../src/game/input/editor-spatial-navigation";
import { KeyboardInput } from "../src/game/input/keyboard-input";
import { PlayerInputManager } from "../src/game/input/player-input-manager";
import {
  applyAxialDeadZone,
  clampInput,
  toDrivingInput,
} from "../src/game/input/player-input";
import {
  getTouchBrakeSteerHandbrake,
  normalizeTouchJoystick,
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

  dispatch(
    type: string,
    code: string,
    repeat = false,
    target?: { isContentEditable?: boolean; tagName?: string },
  ) {
    let prevented = false;
    const event = {
      code,
      preventDefault: () => {
        prevented = true;
      },
      repeat,
      target,
    } as KeyboardEvent;
    this.listeners.get(type)?.forEach((listener) => listener(event as Event));
    return prevented;
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
    buttons: Array.from(
      { length: 17 },
      (_, buttonIndex) => buttons[buttonIndex] ?? gamepadButton(),
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

function projectedEditorAxes(
  yawDegrees: number,
  pitchDegrees: number,
): EditorControllerAxisProjections {
  const yaw = (yawDegrees * Math.PI) / 180;
  const pitch = (pitchDegrees * Math.PI) / 180;
  const right = {
    x: Math.cos(yaw),
    y: 0,
    z: -Math.sin(yaw),
  };
  const up = {
    x: -Math.sin(yaw) * Math.sin(pitch),
    y: Math.cos(pitch),
    z: -Math.cos(yaw) * Math.sin(pitch),
  };
  return {
    x: { x: right.x, y: -up.x },
    y: { x: right.y, y: -up.y },
    z: { x: right.z, y: -up.z },
  };
}

test.describe("player input", () => {
  test("clamps invalid values and rescales steering outside the dead zone", () => {
    expect(clampInput(Number.NaN, -1, 1)).toBe(0);
    expect(clampInput(2, -1, 1)).toBe(1);
    expect(applyAxialDeadZone(0.1, 0.15)).toBe(0);
    expect(applyAxialDeadZone(-0.575, 0.15)).toBeCloseTo(-0.5, 6);
    expect(applyAxialDeadZone(1, 0.15)).toBe(1);
    expect(normalizeTouchJoystick(0.04, 0).x).toBe(0);
    expect(normalizeTouchJoystick(0.54, 0).x).toBeCloseTo(0.5 ** 1.75, 6);
    expect(normalizeTouchJoystick(-0.54, 0).x).toBeCloseTo(-(0.5 ** 1.75), 6);
    expect(normalizeTouchJoystick(1, 0).x).toBe(1);
    expect(normalizeTouchJoystick(0.04, -0.04)).toEqual({ x: 0, y: 0 });
    expect(
      normalizeTouchJoystick(Number.NaN, Number.POSITIVE_INFINITY),
    ).toEqual({ x: 0, y: 0 });
    const diagonal = normalizeTouchJoystick(1, -1);
    expect(Math.hypot(diagonal.x, diagonal.y)).toBeCloseTo(1, 6);
    expect(diagonal.x).toBeCloseTo(Math.SQRT1_2, 6);
    expect(diagonal.y).toBeCloseTo(-Math.SQRT1_2, 6);
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
      () => (activityCount += 1),
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

  test("leaves native editing keys to focused form controls", () => {
    const target = new KeyboardTarget();
    const keyboard = new KeyboardInput(target as unknown as Window);
    keyboard.attach();

    expect(
      target.dispatch("keydown", "ArrowUp", false, { tagName: "INPUT" }),
    ).toBe(false);
    expect(
      target.dispatch("keydown", "Escape", false, { tagName: "INPUT" }),
    ).toBe(false);
    expect(keyboard.sample()).toEqual({
      accelerate: 0,
      brakeReverse: 0,
      handbrake: 0,
      pauseRequested: false,
      resetRequested: false,
      steer: 0,
    });

    keyboard.detach();
  });

  test("touch maps a two-axis joystick continuously and retains pedal pointers independently", () => {
    let activityCount = 0;
    const touch = new TouchInput(() => (activityCount += 1));

    touch.setJoystick(1, -0.54, -0.54);
    const diagonalMagnitude = Math.hypot(0.54, 0.54);
    const shapedMagnitude = ((diagonalMagnitude - 0.08) / (1 - 0.08)) ** 1.75;
    touch.pressPedal(2, "accelerate");
    expect(touch.getContinuousInput()).toMatchObject({
      accelerate: 1,
      brakeReverse: 0,
      handbrake: 0,
    });
    expect(touch.getContinuousInput().steer).toBeCloseTo(
      -(shapedMagnitude * Math.SQRT1_2),
      6,
    );

    touch.release(1);
    expect(touch.getContinuousInput()).toEqual({
      accelerate: 1,
      brakeReverse: 0,
      handbrake: 0,
      steer: 0,
    });
    expect(activityCount).toBe(2);

    touch.release(2);
    touch.setJoystick(3, 0, 0.54);
    expect(touch.getContinuousInput()).toMatchObject({
      accelerate: 0,
      brakeReverse: 0.5 ** 1.75,
      steer: 0,
    });

    touch.clear();
    expect(touch.getContinuousInput()).toEqual({
      accelerate: 0,
      brakeReverse: 0,
      handbrake: 0,
      steer: 0,
    });
  });

  test("touch progressively rear-biases the brake pedal only while accelerating through a strong turn", () => {
    const touch = new TouchInput();

    touch.setJoystick(1, 0, 1);
    expect(touch.getContinuousInput()).toMatchObject({
      brakeReverse: 1,
      handbrake: 0,
      steer: 0,
    });

    touch.setJoystick(1, 1, 0);
    expect(touch.getContinuousInput()).toMatchObject({
      brakeReverse: 0,
      handbrake: 0,
      steer: 1,
    });

    touch.setJoystick(1, 0.8, -0.6);
    expect(touch.getContinuousInput().handbrake).toBe(0);

    touch.pressPedal(2, "brakeReverse");
    expect(touch.getContinuousInput()).toMatchObject({
      accelerate: 0.6,
      handbrake: 1,
      steer: 1,
    });
    expect(touch.getContinuousInput().brakeReverse).toBeCloseTo(0.2, 6);

    touch.setJoystick(1, 0.6, -0.8);
    expect(touch.getContinuousInput()).toMatchObject({
      accelerate: 0.8,
    });
    expect(touch.getContinuousInput().handbrake).toBeCloseTo(0.648, 6);
    expect(touch.getContinuousInput().brakeReverse).toBeCloseTo(0.4816, 6);
    expect(touch.getContinuousInput().steer).toBeCloseTo(0.8592, 6);

    touch.setJoystick(1, -1, 0);
    expect(touch.getContinuousInput()).toMatchObject({
      brakeReverse: 1,
      handbrake: 0,
      steer: -1,
    });

    touch.release(2);
    touch.setJoystick(1, -0.8, 0.6);
    expect(touch.getContinuousInput()).toMatchObject({
      brakeReverse: 0.6,
      handbrake: 0,
      steer: -0.8,
    });

    expect(getTouchBrakeSteerHandbrake(1, true, Number.NaN)).toBe(0);
  });

  test("polls a standard gamepad, ignores drift, and edge-detects actions", () => {
    let current = standardGamepad({ axes: [0.1, 0, 0, 0] });
    let activityCount = 0;
    const input = new GamepadInput(
      () => [current],
      () => (activityCount += 1),
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
      () => (activityCount += 1),
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
    const manager = new PlayerInputManager(target as unknown as Window, () => [
      current,
    ]);
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

test.describe("editor controller input", () => {
  test("resolves every transform direction against representative camera projections", () => {
    const cases = [
      {
        projections: projectedEditorAxes(25, 30),
        expected: {
          down: { axis: "y", sign: -1 },
          left: { axis: "x", sign: -1 },
          right: { axis: "x", sign: 1 },
          up: { axis: "y", sign: 1 },
        },
      },
      {
        projections: projectedEditorAxes(70, 60),
        expected: {
          down: { axis: "y", sign: -1 },
          left: { axis: "z", sign: 1 },
          right: { axis: "z", sign: -1 },
          up: { axis: "y", sign: 1 },
        },
      },
    ] as const;

    for (const { expected, projections } of cases) {
      for (const direction of ["down", "left", "right", "up"] as const) {
        expect(
          resolveEditorTranslationFromScreenProjections(
            projections,
            direction,
          ),
        ).toEqual(expected[direction]);
      }
    }
  });

  test("applies a radial dead zone without distorting stick direction", () => {
    expect(applyEditorStickDeadZone(0.1, 0.1)).toEqual({ x: 0, y: 0 });
    const diagonal = applyEditorStickDeadZone(0.6, -0.6);
    expect(diagonal.x).toBeCloseTo(-diagonal.y, 6);
    expect(Math.hypot(diagonal.x, diagonal.y)).toBeCloseTo(
      (Math.hypot(0.6, 0.6) - 0.2) / 0.8,
      6,
    );
  });

  test("maps UI navigation with delayed repeat and edge-triggered actions", () => {
    let current = standardGamepad();
    const input = new EditorGamepadInput(() => [current]);

    expect(input.sample(0).connected).toBe(true);
    current = standardGamepad({ axes: [0.8, 0, 0, 0] });
    expect(input.sample(10).move).toBe("right");
    expect(input.sample(200).move).toBeNull();
    expect(input.sample(361).move).toBe("right");

    current = standardGamepad();
    input.sample(400);
    current = standardGamepad({
      buttons: {
        0: gamepadButton(1),
        1: gamepadButton(1),
        9: gamepadButton(1),
      },
    });
    expect(input.sample(410)).toMatchObject({
      backRequested: true,
      confirmRequested: true,
      helpRequested: true,
    });
    expect(input.sample(420)).toMatchObject({
      backRequested: false,
      confirmRequested: false,
      helpRequested: false,
    });
  });

  test("maps engaged viewport camera, tools, axes, and transform directions", () => {
    let current = standardGamepad();
    const input = new EditorGamepadInput(() => [current]);
    input.setContext("viewport");
    input.sample(0);

    current = standardGamepad({
      axes: [0.6, -0.6, -0.8, 0.4],
      buttons: {
        0: gamepadButton(1),
        1: gamepadButton(1),
        2: gamepadButton(1),
        3: gamepadButton(1),
        5: gamepadButton(1),
        7: gamepadButton(0.75),
        9: gamepadButton(1),
        12: gamepadButton(1),
      },
    });
    const actions = input.sample(10);
    expect(actions).toMatchObject({
      axisCycle: 1,
      backRequested: true,
      confirmRequested: true,
      frameRequested: true,
      helpRequested: true,
      toolCycle: 1,
      transformDirection: "up",
      zoom: 0.75,
    });
    expect(actions.panX).toBeGreaterThan(0);
    expect(actions.panY).toBeLessThan(0);
    expect(actions.orbitX).toBeLessThan(0);
    expect(actions.orbitY).toBeGreaterThan(0);
  });

  test("cycles tools in both directions and repeats every D-pad direction", () => {
    let current = standardGamepad();
    const input = new EditorGamepadInput(() => [current]);
    input.setContext("viewport");
    input.sample(0);

    current = standardGamepad({ buttons: { 4: gamepadButton(1) } });
    expect(input.sample(10).toolCycle).toBe(-1);
    expect(input.sample(20).toolCycle).toBe(0);
    current = standardGamepad();
    input.sample(30);
    current = standardGamepad({ buttons: { 15: gamepadButton(1) } });
    expect(input.sample(40).transformDirection).toBe("right");
    expect(input.sample(200).transformDirection).toBeNull();
    expect(input.sample(391).transformDirection).toBe("right");
    current = standardGamepad();
    input.sample(400);
    current = standardGamepad({ buttons: { 13: gamepadButton(1) } });
    expect(input.sample(410).transformDirection).toBe("down");
    current = standardGamepad();
    input.sample(420);
    current = standardGamepad({ buttons: { 14: gamepadButton(1) } });
    expect(input.sample(430).transformDirection).toBe("left");
    current = standardGamepad();
    input.sample(440);
    current = standardGamepad({ buttons: { 12: gamepadButton(1) } });
    expect(input.sample(450).transformDirection).toBe("up");
  });

  test("requires neutral input after a context reset and clears disconnects", () => {
    let current: Gamepad | null = standardGamepad();
    const input = new EditorGamepadInput(() => (current ? [current] : []));
    input.sample(0);
    current = standardGamepad({ buttons: { 0: gamepadButton(1) } });
    expect(input.sample(10).confirmRequested).toBe(true);

    input.setContext("viewport");
    expect(input.sample(20).confirmRequested).toBe(false);
    current = standardGamepad();
    expect(input.sample(30).confirmRequested).toBe(false);
    current = standardGamepad({ buttons: { 0: gamepadButton(1) } });
    expect(input.sample(40).confirmRequested).toBe(true);

    current = null;
    expect(input.sample(50)).toMatchObject({
      connected: false,
      confirmRequested: false,
      panX: 0,
    });
  });

  test("retains one active index and neutrally re-arms after its slot disconnects", () => {
    let gamepads: Array<Gamepad | null> = [
      standardGamepad({ index: 0 }),
      standardGamepad({ index: 1 }),
    ];
    const input = new EditorGamepadInput(() => gamepads);
    input.sample(0);

    gamepads = [
      standardGamepad({
        buttons: { 0: gamepadButton(1) },
        index: 0,
      }),
      standardGamepad({ index: 1 }),
    ];
    expect(input.sample(10).confirmRequested).toBe(true);

    gamepads = [
      standardGamepad({ index: 0 }),
      standardGamepad({
        buttons: { 0: gamepadButton(1) },
        index: 1,
      }),
    ];
    expect(input.sample(20).confirmRequested).toBe(false);

    gamepads = [
      null,
      standardGamepad({
        buttons: { 0: gamepadButton(1) },
        index: 1,
      }),
    ];
    expect(input.sample(30).confirmRequested).toBe(false);
    expect(input.sample(40).confirmRequested).toBe(false);

    gamepads = [null, standardGamepad({ index: 1 })];
    expect(input.sample(50).confirmRequested).toBe(false);
    gamepads = [
      null,
      standardGamepad({
        buttons: { 0: gamepadButton(1) },
        index: 1,
      }),
    ];
    expect(input.sample(60).confirmRequested).toBe(true);
  });

  test("prefers directional candidates in the current region without wrapping", () => {
    const candidate = (
      value: string,
      left: number,
      top: number,
      region: string,
      order: number,
    ): SpatialCandidate<string> => ({
      order,
      rect: { bottom: top + 10, left, right: left + 10, top },
      region,
      value,
    });
    const origin = candidate("origin", 0, 0, "toolbar", 0);
    const crossRegion = candidate("viewport", 12, 0, "viewport", 1);
    const local = candidate("tool", 30, 0, "toolbar", 2);

    expect(
      findSpatialNavigationCandidate(
        origin,
        [origin, crossRegion, local],
        "right",
      )?.value,
    ).toBe("tool");
    expect(
      findSpatialNavigationCandidate(
        origin,
        [origin, crossRegion],
        "right",
      )?.value,
    ).toBe("viewport");
    expect(
      findSpatialNavigationCandidate(
        origin,
        [origin, crossRegion, local],
        "left",
      ),
    ).toBeNull();
  });

  test("orders spatial candidates by alignment, distance, eligibility, and stable order", () => {
    const candidate = (
      value: string,
      left: number,
      top: number,
      order: number,
      eligible = true,
    ): SpatialCandidate<string> => ({
      eligible,
      order,
      rect: { bottom: top + 10, left, right: left + 10, top },
      region: "editor",
      value,
    });
    const origin = candidate("origin", 0, 0, 0);
    const aligned = candidate("aligned", 30, 0, 1);
    const diagonal = candidate("diagonal", 12, 20, 2);
    expect(
      findSpatialNavigationCandidate(
        origin,
        [origin, diagonal, aligned],
        "right",
      )?.value,
    ).toBe("aligned");

    const near = candidate("near", 12, 0, 3);
    expect(
      findSpatialNavigationCandidate(
        origin,
        [origin, aligned, near],
        "right",
      )?.value,
    ).toBe("near");

    const hidden = candidate("hidden", 11, 0, 0, false);
    const inert = candidate("inert", 11, 0, 1, false);
    const disabled = candidate("disabled", 11, 0, 2, false);
    const availableLater = candidate("available", 20, 0, 3);
    expect(
      findSpatialNavigationCandidate(
        origin,
        [origin, hidden, inert, disabled, availableLater],
        "right",
      )?.value,
    ).toBe("available");

    const laterOrder = candidate("later", 12, 0, 5);
    const earlierOrder = candidate("earlier", 12, 0, 2);
    expect(
      findSpatialNavigationCandidate(
        origin,
        [origin, laterOrder, earlierOrder],
        "right",
      )?.value,
    ).toBe("earlier");
  });
});

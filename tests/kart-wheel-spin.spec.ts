import { expect, test } from "@playwright/test";

import {
  getWheelShutterSeconds,
  getWheelSpinRate,
  WHEEL_SPIN_COAST_SECONDS,
} from "../src/game/kart/kart-wheel-spin";

const rolling = {
  locked: false,
  longitudinalSpeed: 6,
  radius: 0.05,
  supported: true,
};

test.describe("kart wheel spin", () => {
  test("rolls with the contact patch, forward and in reverse", () => {
    expect(getWheelSpinRate(rolling, 0, 1 / 120)).toBeCloseTo(120);
    expect(
      getWheelSpinRate({ ...rolling, longitudinalSpeed: -1.5 }, 0, 1 / 120),
    ).toBeCloseTo(-30);
  });

  test("stops a wheel braked past its grip", () => {
    expect(getWheelSpinRate({ ...rolling, locked: true }, 120, 1 / 120)).toBe(
      0,
    );
  });

  test("coasts down in the air without speeding up", () => {
    const airborne = { ...rolling, supported: false };
    expect(
      getWheelSpinRate(airborne, 120, WHEEL_SPIN_COAST_SECONDS),
    ).toBeCloseTo(120 / Math.E);
    expect(getWheelSpinRate({ ...airborne, longitudinalSpeed: 30 }, 0, 1)).toBe(
      0,
    );
  });

  test("blurs over at least 1/15 s, longer if a frame shows longer", () => {
    expect(getWheelShutterSeconds(1 / 60)).toBe(1 / 15);
    expect(getWheelShutterSeconds(1 / 10)).toBe(1 / 10);
    expect(getWheelShutterSeconds(0.5)).toBe(1 / 8);
  });
});

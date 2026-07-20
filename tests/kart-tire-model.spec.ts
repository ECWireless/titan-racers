import { expect, test } from "@playwright/test";

import {
  getLoadDerivedCorneringStiffness,
  getRequestedLateralTireForce,
  getTireGripCoefficient,
  getTireSlipAngle,
  LOW_SPEED_LATERAL_SETTLE_SECONDS,
  LOW_SPEED_TIRE_REFERENCE,
  TRAILING_AXLE_GRIP_SAFETY_RATIO,
} from "../src/game/kart/kart-tire-model";

test.describe("kart tire model", () => {
  test("owns one mild trailing-axle stability margin as shared policy", () => {
    expect(TRAILING_AXLE_GRIP_SAFETY_RATIO).toBe(1.15);
  });

  test("derives slip angle from longitudinal and lateral contact velocity", () => {
    expect(getTireSlipAngle(10, 0)).toBe(0);
    expect(getTireSlipAngle(10, 10)).toBeCloseTo(Math.PI / 4, 6);
    expect(getTireSlipAngle(-10, -10)).toBeCloseTo(Math.PI / 4, 6);
    expect(getTireSlipAngle(0, 0.5)).toBeCloseTo(Math.atan2(0.5, 2), 6);
  });

  test("owns the near-zero tire crossover as shared solver policy", () => {
    expect(LOW_SPEED_TIRE_REFERENCE).toBe(2);
    expect(LOW_SPEED_LATERAL_SETTLE_SECONDS).toBe(0.12);
    expect(getTireSlipAngle(0.05, 0.05)).toBeCloseTo(Math.atan2(0.05, 2));
  });

  test("derives cornering stiffness from contact grip, load, and peak slip", () => {
    const earthStaticWheelLoad = (120 * 9.81) / 4;
    const baseline = getLoadDerivedCorneringStiffness(
      1.42,
      earthStaticWheelLoad,
      5,
    );
    const halfLoaded = getLoadDerivedCorneringStiffness(
      1.42,
      earthStaticWheelLoad / 2,
      5,
    );

    expect(baseline).toBeCloseTo(4_788.87, 1);
    expect(halfLoaded).toBeCloseTo(baseline / 2, 6);
    expect(getLoadDerivedCorneringStiffness(1.42, 0, 5)).toBe(0);
  });

  test("derives small-slip force from angle rather than hidden speed", () => {
    const fiveDegrees = 5 * (Math.PI / 180);
    const slowSlipAngle = getTireSlipAngle(5, Math.tan(fiveDegrees) * 5);
    const fastSlipAngle = getTireSlipAngle(10, Math.tan(fiveDegrees) * 10);
    const slowForce = getRequestedLateralTireForce(
      slowSlipAngle,
      5,
      Math.tan(fiveDegrees) * 5,
      8_800,
      30,
    );
    const fastForce = getRequestedLateralTireForce(
      fastSlipAngle,
      10,
      Math.tan(fiveDegrees) * 10,
      8_800,
      30,
    );

    expect(slowSlipAngle).toBeCloseTo(fiveDegrees, 6);
    expect(fastSlipAngle).toBeCloseTo(fiveDegrees, 6);
    expect(Math.abs(slowForce)).toBeCloseTo(767.94, 1);
    expect(fastForce).toBeCloseTo(slowForce, 6);
  });

  test("opposes lateral motion and scales linearly before the grip cap", () => {
    const threeDegrees = 3 * (Math.PI / 180);
    const baselineForce = getRequestedLateralTireForce(
      threeDegrees,
      10,
      1,
      8_800,
      30,
    );

    expect(baselineForce).toBeLessThan(0);
    expect(
      getRequestedLateralTireForce(
        threeDegrees,
        10,
        1,
        17_600,
        30,
      ),
    ).toBeCloseTo(baselineForce * 2);
    expect(
      getRequestedLateralTireForce(
        threeDegrees,
        10,
        -1,
        8_800,
        30,
      ),
    ).toBeCloseTo(-baselineForce);
  });

  test("blends to bounded velocity settling when rolling speed is negligible", () => {
    const slipAngle = getTireSlipAngle(0, 0.3);

    expect(
      getRequestedLateralTireForce(
        slipAngle,
        0,
        0.3,
        8_800,
        30,
      ),
    ).toBeCloseTo(-75);
  });

  test("falls smoothly from peak grip to a sliding plateau", () => {
    const fourDegrees = 4 * (Math.PI / 180);
    const elevenPointFiveDegrees = 11.5 * (Math.PI / 180);
    const twentyDegrees = 20 * (Math.PI / 180);

    expect(getTireGripCoefficient(fourDegrees)).toBeCloseTo(1.42, 6);
    expect(getTireGripCoefficient(elevenPointFiveDegrees)).toBeCloseTo(1.2, 6);
    expect(getTireGripCoefficient(twentyDegrees)).toBeCloseTo(0.98, 6);
  });


});

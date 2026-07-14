import { expect, test } from "@playwright/test";

import {
  getBrakingYawLeverScale,
  getCombinedSlipBrakeForceScale,
  getCombinedSlipGripCoefficient,
  getCombinedSlipLateralStiffnessScale,
  getTireGripCoefficient,
  getTireSlipAngle,
} from "../src/game/kart/kart-tire-model";

test.describe("kart tire model", () => {
  test("derives slip angle from longitudinal and lateral contact velocity", () => {
    expect(getTireSlipAngle(10, 0)).toBe(0);
    expect(getTireSlipAngle(10, 10)).toBeCloseTo(Math.PI / 4, 6);
    expect(getTireSlipAngle(-10, -10)).toBeCloseTo(Math.PI / 4, 6);
    expect(getTireSlipAngle(0, 0.5)).toBeCloseTo(Math.PI / 4, 6);
  });

  test("falls smoothly from peak grip to a sliding plateau", () => {
    const fourDegrees = 4 * (Math.PI / 180);
    const elevenPointFiveDegrees = 11.5 * (Math.PI / 180);
    const twentyDegrees = 20 * (Math.PI / 180);

    expect(getTireGripCoefficient(fourDegrees)).toBeCloseTo(1.42, 6);
    expect(getTireGripCoefficient(elevenPointFiveDegrees)).toBeCloseTo(1.2, 6);
    expect(getTireGripCoefficient(twentyDegrees)).toBeCloseTo(0.98, 6);
  });

  test("reduces the force envelope only for hard braking under combined slip", () => {
    const fourDegrees = 4 * (Math.PI / 180);
    const twelveDegrees = 12 * (Math.PI / 180);
    const eighteenDegrees = 18 * (Math.PI / 180);

    expect(getCombinedSlipGripCoefficient(fourDegrees, 1)).toBeCloseTo(
      getTireGripCoefficient(fourDegrees),
      6,
    );
    expect(getCombinedSlipGripCoefficient(eighteenDegrees, 0.6)).toBeCloseTo(
      getTireGripCoefficient(eighteenDegrees),
      6,
    );
    expect(getCombinedSlipGripCoefficient(twelveDegrees, 1)).toBeLessThan(
      getTireGripCoefficient(twelveDegrees),
    );
    expect(getCombinedSlipGripCoefficient(eighteenDegrees, 1)).toBeCloseTo(
      0.8232,
      4,
    );
    expect(getCombinedSlipGripCoefficient(eighteenDegrees, 0)).toBeCloseTo(
      getTireGripCoefficient(eighteenDegrees),
      6,
    );
  });

  test("reduces braking force only after lateral slip has developed", () => {
    const fourDegrees = 4 * (Math.PI / 180);
    const eighteenDegrees = 18 * (Math.PI / 180);

    expect(getCombinedSlipBrakeForceScale(fourDegrees, 1)).toBe(1);
    expect(getCombinedSlipBrakeForceScale(eighteenDegrees, 0.6)).toBe(1);
    expect(getCombinedSlipBrakeForceScale(eighteenDegrees, 1)).toBeCloseTo(
      0.15,
      6,
    );
  });

  test("shortens the yaw lever continuously only under hard braking", () => {
    expect(getBrakingYawLeverScale(0)).toBe(1);
    expect(getBrakingYawLeverScale(0.6)).toBe(1);
    expect(getBrakingYawLeverScale(1)).toBeCloseTo(0.1, 6);
  });

  test("reduces lateral stiffness continuously only under hard braking", () => {
    expect(getCombinedSlipLateralStiffnessScale(0)).toBe(1);
    expect(getCombinedSlipLateralStiffnessScale(0.6)).toBe(1);
    expect(getCombinedSlipLateralStiffnessScale(1)).toBeCloseTo(0.1, 6);
  });
});

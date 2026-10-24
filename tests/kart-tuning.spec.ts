import { expect, test } from "@playwright/test";

import {
  applyKartDevelopmentOverrides,
  createKartDevelopmentValues,
  DEFAULT_KART_DEVELOPMENT_VALUES,
  KART_DEVELOPMENT_VALUE_BOUNDS,
  KART_DEVELOPMENT_VALUE_METADATA,
  normalizeKartDevelopmentValues,
  resolveKartDevelopmentValues,
} from "../src/game/kart/kart-development-values";
import { DEFAULT_KART_PHYSICAL_PROFILE } from "../src/game/kart/kart-physical-profile";

test.describe("kart development values", () => {
  test("keeps every diagnostic default inside its development bounds", () => {
    expect(DEFAULT_KART_DEVELOPMENT_VALUES.maxForwardSpeed).toBe(17);
    Object.entries(DEFAULT_KART_DEVELOPMENT_VALUES).forEach(([key, value]) => {
      const bounds =
        KART_DEVELOPMENT_VALUE_BOUNDS[
          key as keyof typeof KART_DEVELOPMENT_VALUE_BOUNDS
        ];
      expect(value, key).toBeGreaterThanOrEqual(bounds.minimum);
      expect(value, key).toBeLessThanOrEqual(bounds.maximum);
    });
    expect(
      normalizeKartDevelopmentValues(DEFAULT_KART_DEVELOPMENT_VALUES),
    ).toEqual(
      DEFAULT_KART_DEVELOPMENT_VALUES,
    );
  });

  test("rejects non-finite values and clamps unsafe values", () => {
    const values = normalizeKartDevelopmentValues({
      maxForwardSpeed: 500,
      maximumDriveForce: Number.NaN,
      maximumHandbrakeForce: -1,
    });

    expect(values.maximumDriveForce).toBe(
      DEFAULT_KART_DEVELOPMENT_VALUES.maximumDriveForce,
    );
    expect(values.maxForwardSpeed).toBe(
      KART_DEVELOPMENT_VALUE_BOUNDS.maxForwardSpeed.maximum,
    );
    expect(values.maximumHandbrakeForce).toBe(0);
  });

  test("preserves required ordering between related thresholds", () => {
    const values = normalizeKartDevelopmentValues({
      maximumCenterSteerAngle: 8,
      peakGripCoefficient: 1,
      peakSlipAngleDegrees: 15,
      slidingGripCoefficient: 2,
      slidingSlipAngleDegrees: 10,
    });

    expect(values.slidingGripCoefficient).toBeLessThanOrEqual(
      values.peakGripCoefficient,
    );
    expect(values.slidingSlipAngleDegrees).toBeGreaterThan(
      values.peakSlipAngleDegrees,
    );
  });

  test("maps every flat diagnostic value to an explicit runtime owner", () => {
    expect(Object.keys(KART_DEVELOPMENT_VALUE_METADATA)).toEqual(
      Object.keys(DEFAULT_KART_DEVELOPMENT_VALUES),
    );
    expect(KART_DEVELOPMENT_VALUE_METADATA.gravity).toEqual({
      classification: "environment",
      owner: "world-environment",
    });

    const resolved = resolveKartDevelopmentValues(
      DEFAULT_KART_DEVELOPMENT_VALUES,
    );
    expect(resolved.environment.airDensity).toBe(0.615);
    expect(resolved.environment.gravity).toBe(9.81);
    expect(resolved.kart.drivetrain).toEqual({
      maximumDriveForce: DEFAULT_KART_DEVELOPMENT_VALUES.maximumDriveForce,
      noLoadSpeed: DEFAULT_KART_DEVELOPMENT_VALUES.maxForwardSpeed,
    });
  });

  test("runs a derived profile exactly when it exceeds development bounds", () => {
    const profile = {
      ...DEFAULT_KART_PHYSICAL_PROFILE,
      aerodynamics: {
        dragArea: KART_DEVELOPMENT_VALUE_BOUNDS.aerodynamicDragArea.maximum * 2,
      },
      drivetrain: {
        ...DEFAULT_KART_PHYSICAL_PROFILE.drivetrain,
        maximumDriveForce:
          KART_DEVELOPMENT_VALUE_BOUNDS.maximumDriveForce.maximum + 15,
      },
    };
    const baseline = createKartDevelopmentValues(profile);

    expect(applyKartDevelopmentOverrides(baseline, {})).toEqual(baseline);
    expect(
      resolveKartDevelopmentValues(applyKartDevelopmentOverrides(baseline, {}))
        .kart,
    ).toEqual(profile);
  });

  test("clamps only the development values a session overrides", () => {
    const baseline = createKartDevelopmentValues({
      ...DEFAULT_KART_PHYSICAL_PROFILE,
      aerodynamics: {
        dragArea: KART_DEVELOPMENT_VALUE_BOUNDS.aerodynamicDragArea.maximum * 2,
      },
    });
    const values = applyKartDevelopmentOverrides(baseline, {
      maxForwardSpeed: 500,
      maximumDriveForce: Number.NaN,
    });

    expect(values.maxForwardSpeed).toBe(
      KART_DEVELOPMENT_VALUE_BOUNDS.maxForwardSpeed.maximum,
    );
    expect(values.maximumDriveForce).toBe(baseline.maximumDriveForce);
    expect(values.aerodynamicDragArea).toBe(baseline.aerodynamicDragArea);
  });
});

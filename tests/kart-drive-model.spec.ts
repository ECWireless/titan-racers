import { expect, test } from "@playwright/test";

import {
  allocateDriveForce,
  getRequestedDriveForce,
} from "../src/game/kart/kart-drive-model";
import { DEFAULT_KART_PHYSICAL_PROFILE } from "../src/game/kart/kart-physical-profile";
import { REFERENCE_KART_CONSTRUCTION } from "../src/game/kart/kart-reference-construction";

test.describe("kart drive model", () => {
  test("makes acceleration emerge from fixed motor force and kart mass", () => {
    const driveForce = getRequestedDriveForce(
      1,
      0,
      DEFAULT_KART_PHYSICAL_PROFILE.drivetrain,
    );

    expect(driveForce).toBe(17.8125);
    expect(
      driveForce / REFERENCE_KART_CONSTRUCTION.massProperties.totalMass,
    ).toBe(9.5);
    expect(
      driveForce /
        (REFERENCE_KART_CONSTRUCTION.massProperties.totalMass * 2),
    ).toBe(4.75);
  });

  test("uses the same motor force and no-load speed in both directions", () => {
    expect(
      getRequestedDriveForce(1, 8.5, DEFAULT_KART_PHYSICAL_PROFILE.drivetrain),
    ).toBe(8.90625);
    expect(
      getRequestedDriveForce(1, 17, DEFAULT_KART_PHYSICAL_PROFILE.drivetrain),
    ).toBe(0);
    expect(
      getRequestedDriveForce(-1, 0, DEFAULT_KART_PHYSICAL_PROFILE.drivetrain),
    ).toBe(-17.8125);
    expect(
      getRequestedDriveForce(-1, -17, DEFAULT_KART_PHYSICAL_PROFILE.drivetrain),
    ).toBe(-0);
  });

  test("keeps a fixed driven-wheel split without transferring an unused share", () => {
    expect(allocateDriveForce(800, [500, 0], 2)).toEqual([400, 0]);
    expect(allocateDriveForce(600, [100, 700], 2)).toEqual([100, 300]);
    expect(allocateDriveForce(800, [500, 500], 2)).toEqual([400, 400]);
    expect(allocateDriveForce(-800, [500, 0], 2)).toEqual([-400, 0]);
  });

  test("rejects invalid wheel capacity without manufacturing force", () => {
    expect(allocateDriveForce(800, [Number.NaN, -1, 300], 2)).toEqual([
      0, 0, 300,
    ]);
    expect(allocateDriveForce(Number.NaN, [500, 500], 2)).toEqual([0, 0]);
    expect(allocateDriveForce(800, [500, 500], 0)).toEqual([0, 0]);
  });
});

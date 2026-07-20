import { expect, test } from "@playwright/test";

import {
  allocateServiceBrakeForce,
  getGroundBrakingForce,
  getRequestedBrakingForce,
} from "../src/game/kart/kart-brake-model";
import { DEFAULT_KART_PHYSICAL_PROFILE } from "../src/game/kart/kart-physical-profile";
import { REFERENCE_KART_CONSTRUCTION } from "../src/game/kart/kart-reference-construction";

test.describe("kart brake model", () => {
  test("makes deceleration emerge from fixed brake capability and kart mass", () => {
    const brakingForce = getRequestedBrakingForce(
      1,
      DEFAULT_KART_PHYSICAL_PROFILE.brakes.maximumServiceBrakeForce,
    );

    expect(brakingForce).toBe(26.25);
    expect(
      brakingForce / REFERENCE_KART_CONSTRUCTION.massProperties.totalMass,
    ).toBe(14);
    expect(
      brakingForce /
        (REFERENCE_KART_CONSTRUCTION.massProperties.totalMass * 2),
    ).toBe(7);
  });

  test("scales bounded analog brake demand without manufacturing force", () => {
    expect(getRequestedBrakingForce(0.5, 1_680)).toBe(840);
    expect(getRequestedBrakingForce(2, 1_680)).toBe(1_680);
    expect(getRequestedBrakingForce(-1, 1_680)).toBe(0);
    expect(getRequestedBrakingForce(Number.NaN, 1_680)).toBe(0);
    expect(getRequestedBrakingForce(1, Number.NaN)).toBe(0);
  });

  test("keeps rear handbrake capability independent of service brakes", () => {
    const handbrakeForce = getRequestedBrakingForce(
      1,
      DEFAULT_KART_PHYSICAL_PROFILE.brakes.maximumHandbrakeForce,
    );

    expect(handbrakeForce).toBe(11.8125);
    expect(handbrakeForce / 2).toBe(5.90625);
    expect(getRequestedBrakingForce(0.5, 756)).toBe(378);
  });

  test("proportions four-wheel service braking by current supported load", () => {
    expect(allocateServiceBrakeForce(8, [6, 2, 0])).toEqual([6, 2, 0]);
    expect(allocateServiceBrakeForce(8, [Number.NaN, -1, 0])).toEqual([
      0,
      0,
      0,
    ]);
    expect(allocateServiceBrakeForce(Number.NaN, [6, 2])).toEqual([0, 0]);
  });

  test("derives ground force from brake torque and wheel radius", () => {
    expect(getGroundBrakingForce(300, 0.25)).toBe(1_200);
    expect(getGroundBrakingForce(300, 0.5)).toBe(600);
    expect(getGroundBrakingForce(300, 0)).toBe(0);
  });
});

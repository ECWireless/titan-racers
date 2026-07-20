import { expect, test } from "@playwright/test";

import {
  getRestSettlingLocalTorqueImpulse,
  isRestSettlingEligible,
  KART_REST_SETTLING_POLICY,
} from "../src/game/kart/kart-rest-settling";

test.describe("kart grounded rest settling", () => {
  test("activates only for fully supported, input-free, low-energy motion", () => {
    expect(
      isRestSettlingEligible(
        { x: 0.1, y: 0.1, z: 0.1 },
        { x: 0.2, y: 0.2, z: 0.2 },
        true,
        false,
      ),
    ).toBe(true);
    expect(
      isRestSettlingEligible(
        { x: 0.31, y: 0, z: 0 },
        { x: 0, y: 0, z: 0 },
        true,
        false,
      ),
    ).toBe(false);
    expect(
      isRestSettlingEligible(
        { x: 0, y: 0.21, z: 0 },
        { x: 0, y: 0, z: 0 },
        true,
        false,
      ),
    ).toBe(false);
    expect(
      isRestSettlingEligible(
        { x: 0, y: 0, z: 0 },
        { x: 1.01, y: 0, z: 0 },
        true,
        false,
      ),
    ).toBe(false);
    expect(
      isRestSettlingEligible(
        { x: 0, y: 0, z: 0 },
        { x: 0.1, y: 0, z: 0 },
        false,
        false,
      ),
    ).toBe(false);
    expect(
      isRestSettlingEligible(
        { x: 0, y: 0, z: 0 },
        { x: 0.1, y: 0, z: 0 },
        true,
        true,
      ),
    ).toBe(false);
  });

  test("derives equal angular settling from each kart's local inertia", () => {
    const angularVelocity = { x: 0.6, y: -0.3, z: 0.15 };
    const lightInertia = { x: 20, y: 30, z: 40 };
    const heavyInertia = { x: 40, y: 60, z: 80 };
    const deltaSeconds = 1 / 60;
    const lightImpulse = getRestSettlingLocalTorqueImpulse(
      angularVelocity,
      lightInertia,
      deltaSeconds,
    );
    const heavyImpulse = getRestSettlingLocalTorqueImpulse(
      angularVelocity,
      heavyInertia,
      deltaSeconds,
    );
    const expectedVelocityChangeRatio =
      deltaSeconds / KART_REST_SETTLING_POLICY.angularSettleTimeSeconds;

    expect(heavyImpulse.x).toBeCloseTo(lightImpulse.x * 2);
    expect(heavyImpulse.y).toBeCloseTo(lightImpulse.y * 2);
    expect(heavyImpulse.z).toBeCloseTo(lightImpulse.z * 2);
    expect(lightImpulse.x / lightInertia.x).toBeCloseTo(
      -angularVelocity.x * expectedVelocityChangeRatio,
    );
    expect(heavyImpulse.x / heavyInertia.x).toBeCloseTo(
      -angularVelocity.x * expectedVelocityChangeRatio,
    );
  });
});

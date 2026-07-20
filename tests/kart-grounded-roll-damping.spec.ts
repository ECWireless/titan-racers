import { expect, test } from "@playwright/test";

import {
  getFlatGroundedHeaveDampingImpulse,
  getGroundedRollDampingLocalTorqueImpulse,
  KART_GROUNDED_ROLL_DAMPING_POLICY,
} from "../src/game/kart/kart-grounded-roll-damping";

test.describe("kart grounded turn damping", () => {
  test("damps only local roll and derives the impulse from roll inertia", () => {
    const lightImpulse = getGroundedRollDampingLocalTorqueImpulse(
      { x: 0.5, y: -0.25, z: 0.8 },
      { x: 20, y: 30, z: 40 },
      2,
      1 / 120,
    );
    const heavyImpulse = getGroundedRollDampingLocalTorqueImpulse(
      { x: 0.5, y: -0.25, z: 0.8 },
      { x: 40, y: 60, z: 80 },
      2,
      1 / 120,
    );

    expect(lightImpulse.x).toBe(0);
    expect(lightImpulse.y).toBe(0);
    expect(lightImpulse.z).toBeLessThan(0);
    expect(heavyImpulse.z).toBeCloseTo(lightImpulse.z * 2);
    expect(lightImpulse.z / 40).toBeCloseTo(
      -0.8 *
        ((1 / 120) /
          KART_GROUNDED_ROLL_DAMPING_POLICY.rollSettleTimeSeconds),
    );
  });

  test("does not damp roll with fewer than two supported wheels", () => {
    expect(
      getGroundedRollDampingLocalTorqueImpulse(
        { x: 0, y: 0, z: 1 },
        { x: 20, y: 30, z: 40 },
        1,
        1 / 120,
      ),
    ).toEqual({ x: 0, y: 0, z: 0 });
  });

  test("keeps shared roll damping active during supported transients", () => {
    const impulse = getGroundedRollDampingLocalTorqueImpulse(
      { x: 4, y: 6, z: 12 },
      { x: 20, y: 30, z: 40 },
      2,
      1 / 120,
    );

    expect(impulse.x).toBe(0);
    expect(impulse.y).toBe(0);
    expect(impulse.z).toBeLessThan(0);
  });

  test("opposes flat-ground heave with an impulse derived from mass", () => {
    const lightImpulse = getFlatGroundedHeaveDampingImpulse(
      -0.2,
      2,
      4,
      1,
      1,
      1 / 120,
    );
    const heavyImpulse = getFlatGroundedHeaveDampingImpulse(
      -0.2,
      4,
      4,
      1,
      1,
      1 / 120,
    );

    expect(lightImpulse).toBeGreaterThan(0);
    expect(heavyImpulse).toBeCloseTo(lightImpulse * 2);
  });

  test("does not damp heave on a ramp, while tilted, or with one support", () => {
    const values = [
      getFlatGroundedHeaveDampingImpulse(
        -0.2,
        2,
        4,
        0.9,
        1,
        1 / 120,
      ),
      getFlatGroundedHeaveDampingImpulse(
        -0.2,
        2,
        4,
        1,
        0.9,
        1 / 120,
      ),
      getFlatGroundedHeaveDampingImpulse(
        -0.2,
        2,
        1,
        1,
        1,
        1 / 120,
      ),
    ];

    expect(values).toEqual([0, 0, 0]);
  });

  test("keeps shared heave damping active during flat supported impacts", () => {
    expect(
      getFlatGroundedHeaveDampingImpulse(-3, 2, 2, 1, 1, 1 / 120),
    ).toBeGreaterThan(0);
  });
});

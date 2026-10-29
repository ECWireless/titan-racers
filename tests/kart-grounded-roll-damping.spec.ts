import { expect, test } from "@playwright/test";

import {
  getGroundedHeaveDampingImpulse,
  getGroundedRollDampingLocalTorqueImpulse,
  KART_GROUNDED_ROLL_DAMPING_POLICY,
} from "../src/game/kart/kart-grounded-roll-damping";

function diagonalTensor(x: number, y: number, z: number) {
  return {
    xx: x,
    xy: 0,
    xz: 0,
    yx: 0,
    yy: y,
    yz: 0,
    zx: 0,
    zy: 0,
    zz: z,
  };
}

test.describe("kart grounded turn damping", () => {
  test("damps only local roll and derives the impulse from roll inertia", () => {
    const lightImpulse = getGroundedRollDampingLocalTorqueImpulse(
      { x: 0.5, y: -0.25, z: 0.8 },
      diagonalTensor(20, 30, 40),
      2,
      1 / 120,
    );
    const heavyImpulse = getGroundedRollDampingLocalTorqueImpulse(
      { x: 0.5, y: -0.25, z: 0.8 },
      diagonalTensor(40, 60, 80),
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
        diagonalTensor(20, 30, 40),
        1,
        1 / 120,
      ),
    ).toEqual({ x: 0, y: 0, z: 0 });
  });

  test("keeps shared roll damping active during supported transients", () => {
    const impulse = getGroundedRollDampingLocalTorqueImpulse(
      { x: 4, y: 6, z: 12 },
      diagonalTensor(20, 30, 40),
      2,
      1 / 120,
    );

    expect(impulse.x).toBe(0);
    expect(impulse.y).toBe(0);
    expect(impulse.z).toBeLessThan(0);
  });

  test("uses the full tensor for coupled roll angular momentum", () => {
    const impulse = getGroundedRollDampingLocalTorqueImpulse(
      { x: 0, y: 0, z: 1 },
      {
        xx: 20,
        xy: 0,
        xz: 2,
        yx: 0,
        yy: 30,
        yz: -3,
        zx: 2,
        zy: -3,
        zz: 40,
      },
      2,
      1 / 120,
    );

    expect(impulse.x).toBeLessThan(0);
    expect(impulse.y).toBeGreaterThan(0);
    expect(impulse.z).toBeLessThan(0);
  });

  const slope = (degrees: number) => {
    const radians = (degrees * Math.PI) / 180;
    return { x: 0, y: Math.cos(radians), z: -Math.sin(radians) };
  };
  const along = (degrees: number, speed: number) => {
    const radians = (degrees * Math.PI) / 180;
    return { x: 0, y: -Math.sin(radians) * speed, z: -Math.cos(radians) * speed };
  };
  const four = (normal: { x: number; y: number; z: number }) => [
    normal,
    normal,
    normal,
    normal,
  ];

  test("leaves steady driving down a slope undamped", () => {
    const impulse = getGroundedHeaveDampingImpulse(
      along(7.5, 13),
      four(slope(7.5)),
      slope(7.5),
      2,
      1 / 120,
    );

    expect(Math.hypot(impulse.x, impulse.y, impulse.z)).toBeLessThan(1e-9);
  });

  test("opposes heave off the support along its normal, derived from mass", () => {
    const normal = slope(7.5);
    const hop = { x: normal.x * 0.4, y: normal.y * 0.4, z: normal.z * 0.4 };
    const light = getGroundedHeaveDampingImpulse(hop, four(normal), normal, 2, 1 / 120);
    const heavy = getGroundedHeaveDampingImpulse(hop, four(normal), normal, 4, 1 / 120);

    const lightAlongNormal =
      light.x * normal.x + light.y * normal.y + light.z * normal.z;
    expect(lightAlongNormal).toBeLessThan(0);
    expect(Math.hypot(light.x, light.y, light.z)).toBeCloseTo(
      Math.abs(lightAlongNormal),
    );
    expect(heavy.y).toBeCloseTo(light.y * 2);
  });

  test("damps a faceted curve's gentle joins but not a ramp toe, a tilted body, or one wheel", () => {
    const hop = { x: 0, y: -0.5, z: 0 };
    const damped = (
      normals: Array<{ x: number; y: number; z: number }>,
      bodyUp = slope(0),
    ) => getGroundedHeaveDampingImpulse(hop, normals, bodyUp, 2, 1 / 120).y > 0;

    expect(damped([slope(0), slope(0), slope(2.1), slope(2.1)])).toBe(true);
    expect(damped([slope(0), slope(0), slope(4.3), slope(4.3)])).toBe(false);
    expect(damped(four(slope(0)), slope(15))).toBe(false);
    expect(damped([slope(0)])).toBe(false);
  });
});

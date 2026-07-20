import { expect, test } from "@playwright/test";

import {
  getAerodynamicDragForce,
  getRollingResistanceForce,
} from "../src/game/kart/kart-coasting-model";
import { EARTH_WORLD_ENVIRONMENT } from "../src/game/physics/world-environment";

test.describe("kart coasting model", () => {
  test("makes aerodynamic drag quadratic with speed", () => {
    const slowDrag = getAerodynamicDragForce(
      5,
      0.4,
      EARTH_WORLD_ENVIRONMENT.airDensity,
    );
    const fastDrag = getAerodynamicDragForce(
      10,
      0.4,
      EARTH_WORLD_ENVIRONMENT.airDensity,
    );

    expect(fastDrag).toBeCloseTo(slowDrag * 4);
  });

  test("makes aerodynamic deceleration depend on drag area divided by mass", () => {
    const baselineDrag = getAerodynamicDragForce(
      10,
      0.4,
      EARTH_WORLD_ENVIRONMENT.airDensity,
    );
    const doubleAreaDrag = getAerodynamicDragForce(
      10,
      0.8,
      EARTH_WORLD_ENVIRONMENT.airDensity,
    );

    expect(doubleAreaDrag).toBeCloseTo(baselineDrag * 2);
    expect(doubleAreaDrag / 120).toBeCloseTo(baselineDrag / 60);
    expect(doubleAreaDrag / 240).toBeCloseTo(baselineDrag / 120);
  });

  test("combines kart drag area with environment-owned air density", () => {
    const earthDrag = getAerodynamicDragForce(
      10,
      0.4,
      EARTH_WORLD_ENVIRONMENT.airDensity,
    );

    expect(
      getAerodynamicDragForce(
        10,
        0.4,
        EARTH_WORLD_ENVIRONMENT.airDensity * 2,
      ),
    ).toBeCloseTo(earthDrag * 2);
    expect(getAerodynamicDragForce(10, 0.4, Number.NaN)).toBe(0);
  });

  test("makes rolling force load-proportional and rolling deceleration mass-independent", () => {
    const lightMass = 120;
    const heavyMass = 240;
    const gravity = 18;
    const coefficient = 0.025;
    const lightForce = getRollingResistanceForce(
      10,
      lightMass * gravity,
      coefficient,
    );
    const heavyForce = getRollingResistanceForce(
      10,
      heavyMass * gravity,
      coefficient,
    );

    expect(heavyForce).toBeCloseTo(lightForce * 2);
    expect(Math.abs(heavyForce) / heavyMass).toBeCloseTo(
      Math.abs(lightForce) / lightMass,
    );
  });

  test("opposes travel without invalid or discontinuous low-speed forces", () => {
    expect(getRollingResistanceForce(10, 1_000, 0.025)).toBe(-25);
    expect(getRollingResistanceForce(-10, 1_000, 0.025)).toBe(25);
    expect(getRollingResistanceForce(0.25, 1_000, 0.025)).toBe(-12.5);
    expect(getRollingResistanceForce(Number.NaN, 1_000, 0.025)).toBe(0);
    expect(
      getAerodynamicDragForce(
        10,
        Number.NaN,
        EARTH_WORLD_ENVIRONMENT.airDensity,
      ),
    ).toBe(0);
  });
});

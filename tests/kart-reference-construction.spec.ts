import { expect, test } from "@playwright/test";

import {
  REFERENCE_KART_AREA_SCALE,
  REFERENCE_KART_CONSTRUCTION,
  REFERENCE_KART_INERTIA_SCALE,
  REFERENCE_KART_LINEAR_SCALE,
  REFERENCE_KART_MASS_SCALE,
  REFERENCE_KART_TIME_SCALE,
  scaleReferenceKartLength,
} from "../src/game/kart/kart-reference-construction";

test.describe("kart reference construction", () => {
  test("uses the accepted miniature RC reference scale", () => {
    expect(REFERENCE_KART_LINEAR_SCALE).toBe(0.25);
    expect(REFERENCE_KART_AREA_SCALE).toBe(0.25 ** 2);
    expect(REFERENCE_KART_MASS_SCALE).toBe(0.25 ** 3);
    expect(REFERENCE_KART_INERTIA_SCALE).toBe(0.25 ** 5);
    expect(REFERENCE_KART_TIME_SCALE).toBe(0.5);
    expect(REFERENCE_KART_CONSTRUCTION.chassisDimensions.z).toBeCloseTo(
      0.4625,
    );
    expect(REFERENCE_KART_CONSTRUCTION.massProperties.totalMass).toBeCloseTo(
      1.875,
    );
  });

  test("derives the fixture center of mass from its construction masses", () => {
    const { massProperties, upperHousingPosition } =
      REFERENCE_KART_CONSTRUCTION;
    const expectedY =
      (massProperties.lowerBodyMass * massProperties.lowerBodyMassCenter.y +
        massProperties.upperHousingMass * upperHousingPosition.y) /
      massProperties.totalMass;
    const expectedZ =
      (massProperties.lowerBodyMass * massProperties.lowerBodyMassCenter.z +
        massProperties.upperHousingMass * upperHousingPosition.z) /
      massProperties.totalMass;

    expect(massProperties.centerOfMassOffset.x).toBe(0);
    expect(massProperties.centerOfMassOffset.y).toBeCloseTo(expectedY);
    expect(massProperties.centerOfMassOffset.z).toBeCloseTo(expectedZ);
    expect(
      massProperties.lowerBodyMass + massProperties.upperHousingMass,
    ).toBeCloseTo(massProperties.totalMass);
  });

  test("keeps wheel roles and key geometry internally consistent", () => {
    const { steeringGeometry, wheel, wheelStations } =
      REFERENCE_KART_CONSTRUCTION;
    const front = wheelStations.filter((station) => station.steered);
    const rear = wheelStations.filter((station) => station.driven);

    expect(front).toHaveLength(2);
    expect(rear).toHaveLength(2);
    expect(front.every((station) => !station.driven)).toBe(true);
    expect(rear.every((station) => !station.steered)).toBe(true);
    expect(Math.abs(front[0].x - front[1].x)).toBeCloseTo(
      steeringGeometry.trackWidth,
    );
    expect(Math.abs(front[0].z - rear[0].z)).toBeCloseTo(
      steeringGeometry.wheelbase,
    );
    expect(wheel.radius).toBe(scaleReferenceKartLength(0.29));
    expect(wheel.width).toBe(scaleReferenceKartLength(0.3));
  });
});

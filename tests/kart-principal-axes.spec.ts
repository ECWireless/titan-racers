import { expect, test } from "@playwright/test";

import { createBalancedKartDocument } from "../src/game/kart/balanced-kart-document";
import { deriveKartSnapshot } from "../src/game/kart/kart-derivation";
import {
  deriveKartPrincipalAxes,
  getKartAxisMomentOfInertia,
  multiplyKartInertiaTensor,
  type KartInertiaTensor,
  type KartQuaternion,
} from "../src/game/kart/kart-principal-axes";

type Matrix3 = [
  [number, number, number],
  [number, number, number],
  [number, number, number],
];

function quaternionToMatrix(quaternion: KartQuaternion): Matrix3 {
  const { w, x, y, z } = quaternion;
  return [
    [
      1 - 2 * (y * y + z * z),
      2 * (x * y - z * w),
      2 * (x * z + y * w),
    ],
    [
      2 * (x * y + z * w),
      1 - 2 * (x * x + z * z),
      2 * (y * z - x * w),
    ],
    [
      2 * (x * z - y * w),
      2 * (y * z + x * w),
      1 - 2 * (x * x + y * y),
    ],
  ];
}

function expectPrincipalFrameReconstructs(
  tensor: KartInertiaTensor,
  digits = 10,
) {
  const result = deriveKartPrincipalAxes(tensor);
  const rotation = quaternionToMatrix(
    result.principalToAssemblyRotation,
  );
  const moments = [
    result.principalMoments.x,
    result.principalMoments.y,
    result.principalMoments.z,
  ];
  const fields = [
    ["xx", 0, 0],
    ["xy", 0, 1],
    ["xz", 0, 2],
    ["yx", 1, 0],
    ["yy", 1, 1],
    ["yz", 1, 2],
    ["zx", 2, 0],
    ["zy", 2, 1],
    ["zz", 2, 2],
  ] as const;

  for (const [field, row, column] of fields) {
    const reconstructed = moments.reduce(
      (sum, moment, axis) =>
        sum + rotation[row][axis] * moment * rotation[column][axis],
      0,
    );
    expect(reconstructed).toBeCloseTo(tensor[field], digits);
  }
}

test.describe("kart principal axes", () => {
  test("preserves an already diagonal assembly frame", () => {
    const result = deriveKartPrincipalAxes({
      xx: 2,
      xy: 0,
      xz: 0,
      yx: 0,
      yy: 3,
      yz: 0,
      zx: 0,
      zy: 0,
      zz: 4,
    });

    expect(result).toEqual({
      principalMoments: { x: 2, y: 3, z: 4 },
      principalToAssemblyRotation: { w: 1, x: 0, y: 0, z: 0 },
    });
  });

  test("deterministically diagonalizes a rotated tensor", () => {
    const angle = Math.PI / 6;
    const cosine = Math.cos(angle);
    const sine = Math.sin(angle);
    const tensor = {
      xx: 2 * cosine ** 2 + 5 * sine ** 2,
      xy: (2 - 5) * cosine * sine,
      xz: 0,
      yx: (2 - 5) * cosine * sine,
      yy: 2 * sine ** 2 + 5 * cosine ** 2,
      yz: 0,
      zx: 0,
      zy: 0,
      zz: 7,
    };

    expectPrincipalFrameReconstructs(tensor);
    expect(deriveKartPrincipalAxes(tensor)).toEqual(
      deriveKartPrincipalAxes(structuredClone(tensor)),
    );
  });

  test("reconstructs the tensor derived from an asymmetric kart", () => {
    const document = createBalancedKartDocument();
    const upperHousing = document.primitiveInstances.find(
      ({ id }) => id === "upper-housing",
    );
    const upperHousingMount = document.structuralAttachments.find(
      ({ child }) => child.instanceId === "upper-housing",
    );
    if (!upperHousing || !upperHousingMount) {
      throw new Error("Balanced kart fixture is missing its upper housing.");
    }
    upperHousing.transform.position.x += 0.01;
    upperHousingMount.parent.anchor.x += 0.01;
    const tensor = deriveKartSnapshot(document).massProperties.inertiaTensor;

    expect(tensor.xy).not.toBe(0);
    expectPrincipalFrameReconstructs(tensor, 9);
  });

  test("multiplies tensors and derives moments about arbitrary axes", () => {
    const tensor = {
      xx: 2,
      xy: 0.5,
      xz: -0.25,
      yx: 0.5,
      yy: 3,
      yz: 0.75,
      zx: -0.25,
      zy: 0.75,
      zz: 4,
    };

    expect(multiplyKartInertiaTensor(tensor, { x: 5, y: -2, z: 0.5 })).toEqual(
      { x: 8.875, y: -3.125, z: -0.75 },
    );
    expect(getKartAxisMomentOfInertia(tensor, { x: 1, y: 0, z: 1 })).toBeCloseTo(
      2.75,
    );
  });

  test("rejects non-symmetric and non-positive tensors", () => {
    expect(() =>
      deriveKartPrincipalAxes({
        xx: 2,
        xy: 1,
        xz: 0,
        yx: 0,
        yy: 3,
        yz: 0,
        zx: 0,
        zy: 0,
        zz: 4,
      }),
    ).toThrow("symmetric");
    expect(() =>
      deriveKartPrincipalAxes({
        xx: -1,
        xy: 0,
        xz: 0,
        yx: 0,
        yy: 2,
        yz: 0,
        zx: 0,
        zy: 0,
        zz: 3,
      }),
    ).toThrow("positive definite");
  });
});

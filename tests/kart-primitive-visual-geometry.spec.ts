import { expect, test } from "@playwright/test";

import { createBalancedKartDocument } from "../src/game/kart/balanced-kart-document";
import { createHandlingKartDocument } from "../src/game/kart/handling-kart-document";
import { buildAuthoredPrimitiveVisual } from "../src/game/kart/kart-part-visuals";
import {
  buildPrimitiveVisual,
  type KartPrimitiveVisualSpec,
} from "../src/game/kart/kart-primitive-visual-geometry";
import { createSpeedKartDocument } from "../src/game/kart/speed-kart-document";

const SHAPES: KartPrimitiveVisualSpec["shape"][] = [
  { kind: "box", size: [0.001, 0.001, 0.001] },
  { kind: "box", size: [0.29, 0.07, 0.275] },
  { kind: "box", size: [0.24, 0.006, 0.02] },
  { kind: "box", size: [0.24, 0.0025, 0.3] },
  { kind: "box", size: [0.19, 0.065, 0.003] },
  { kind: "box", size: [1, 1, 1] },
  { kind: "cylinder", radius: 0.0005, height: 0.001 },
  { kind: "cylinder", radius: 0.06, height: 0.22 },
  { kind: "cylinder", radius: 0.004, height: 0.2 },
  { kind: "cylinder", radius: 0.5, height: 1 },
];
const CONSTRUCTIONS: KartPrimitiveVisualSpec["construction"][] = [
  { mode: "solid" },
  { mode: "shell", thickness: 0.0005 },
  { mode: "shell", thickness: 0.05 },
];
const ALLOWED_FINISHES = new Set([
  "authored-anodized",
  "authored-paint",
  "authored-polymer",
  "bare-aluminum",
  "black-oxide-steel",
  "black-polymer",
]);

const specs = SHAPES.flatMap((shape) =>
  (["structure", "bodywork", "guard", "trim"] as const).flatMap((role) =>
    CONSTRUCTIONS.flatMap((construction) =>
      (["machined", "molded"] as const).flatMap((edge) =>
        [false, true].map(
          (massBlock): KartPrimitiveVisualSpec => ({
            construction,
            edge,
            finish: edge === "machined" ? "authored-anodized" : "authored-polymer",
            massBlock,
            role,
            shape,
          }),
        ),
      ),
    ),
  ),
);

// Integer keys at 0.1 µm; `+ 0` folds -0 into 0.
const pointKey = (...point: number[]) =>
  point.map((value) => Math.round(value * 1e7) + 0).join();

const triangleCount = (pieces: { indices: number[] }[]) =>
  pieces.reduce((sum, piece) => sum + piece.indices.length / 3, 0);

test("primitive visuals stay inside their envelope with well-formed meshes", () => {
  const failures = new Set<string>();
  for (const spec of specs) {
    const pieces = buildPrimitiveVisual(spec);
    const fail = (rule: string) => failures.add(`${rule}: ${JSON.stringify(spec)}`);
    if (triangleCount(pieces) > 1_200) fail("triangles");
    for (const { finish, indices, normals, positions } of pieces) {
      if (!ALLOWED_FINISHES.has(finish)) fail(`finish ${finish}`);
      const points = new Set<string>();
      for (let i = 0; i < positions.length; i += 3) {
        const [x, y, z] = positions.slice(i, i + 3);
        const normal = normals.slice(i, i + 3);
        if (![x, y, z, ...normal].every(Number.isFinite)) fail("finite");
        if (Math.abs(Math.hypot(...normal) - 1) > 1e-6) fail("unit normal");
        const outside =
          spec.shape.kind === "box"
            ? [x, y, z].some(
                (value, axis) =>
                  Math.abs(value) - (spec.shape as { size: number[] }).size[axis] / 2 > 1e-6,
              )
            : Math.hypot(x, z) - spec.shape.radius > 1e-6 ||
              Math.abs(y) - spec.shape.height / 2 > 1e-6;
        if (outside) fail("envelope");
        points.add(pointKey(x, y, z));
      }
      // Mirrored instances are drawn by rotation, so geometry must be
      // symmetric about the instance's X = 0, which is a cylinder's Y = 0
      // when it lies along X.
      for (let i = 0; i < positions.length; i += 3) {
        const [x, y, z] = positions.slice(i, i + 3);
        if (!points.has(pointKey(-x, y, z))) fail("mirror");
        if (spec.shape.kind === "cylinder" && !points.has(pointKey(x, -y, z))) {
          fail("cylinder mirror");
        }
      }
      for (let i = 0; i < indices.length; i += 3) {
        const [a, b, c] = indices
          .slice(i, i + 3)
          .map((index) => positions.slice(index * 3, index * 3 + 3));
        const u = b.map((value, axis) => value - a[axis]);
        const v = c.map((value, axis) => value - a[axis]);
        const face = [
          u[1] * v[2] - u[2] * v[1],
          u[2] * v[0] - u[0] * v[2],
          u[0] * v[1] - u[1] * v[0],
        ];
        if (Math.hypot(...face) === 0) fail("zero area");
        // Counter-clockwise seen from the side the normal points to.
        const normal = normals.slice(indices[i] * 3, indices[i] * 3 + 3);
        if (normal.reduce((sum, n, axis) => sum + n * face[axis], 0) <= 0) {
          fail("winding");
        }
      }
    }
  }
  expect([...failures]).toEqual([]);
});

test("official kart primitives stay within the triangle budget", () => {
  for (const document of [
    createBalancedKartDocument(),
    createSpeedKartDocument(),
    createHandlingKartDocument(),
  ]) {
    const total = document.primitiveInstances.reduce(
      (sum, primitive) =>
        sum + triangleCount(buildAuthoredPrimitiveVisual(primitive)),
      0,
    );
    expect(total, document.kartId).toBeLessThanOrEqual(5_000);
  }
});

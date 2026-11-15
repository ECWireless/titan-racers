import { expect, test } from "@playwright/test";

import { createBalancedKartDocument } from "../src/game/kart/balanced-kart-document";
import { createHandlingKartDocument } from "../src/game/kart/handling-kart-document";
import {
  buildCadPieces,
  KART_CAD_MESHES,
} from "../src/game/kart/kart-cad-meshes";
import { getApprovedKartComponent } from "../src/game/kart/kart-component-registry";
import {
  buildCoilSpring,
  buildSuspensionArm,
  type KartPartVisualPiece,
} from "../src/game/kart/kart-part-visual-geometry";
import {
  buildAuthoredPrimitiveVisual,
  getKartPartVisual,
} from "../src/game/kart/kart-part-visuals";
import { createSpeedKartDocument } from "../src/game/kart/speed-kart-document";

const triangles = (pieces: KartPartVisualPiece[]) =>
  pieces.reduce((sum, piece) => sum + piece.indices.length / 3, 0);

// docs/visual-identity.md: each kart within 28k triangles, so four karts in
// a room hold the phone budget; each CAD part within 2,000.
const KART_TRIANGLES = 28_000;
const CAD_PART_TRIANGLES = 2_000;
// The finishes cad/export.py lets a part use.
const CAD_FINISHES = new Set([
  "authored-anodized",
  "authored-paint",
  "authored-polymer",
  "bare-aluminum",
  "bare-steel",
  "black-oxide-steel",
  "black-polymer",
  "copper",
  "rubber",
]);

test("official karts stay within the per-kart triangle budget", () => {
  for (const document of [
    createBalancedKartDocument(),
    createSpeedKartDocument(),
    createHandlingKartDocument(),
  ]) {
    let total = document.primitiveInstances.reduce(
      (sum, primitive) => sum + triangles(buildAuthoredPrimitiveVisual(primitive)),
      0,
    );
    for (const instance of document.componentInstances) {
      const definition = getApprovedKartComponent(instance.definition)!;
      const visual = getKartPartVisual(instance.definition)!;
      if (visual.kind === "pieces") {
        total += triangles(visual.build(definition));
        continue;
      }
      // A coilover rig: body, shaft, spring, and the arm it rides on. Their
      // counts don't depend on the lengths they are posed at.
      const coilover = visual.build(definition);
      total +=
        triangles(coilover.body) +
        triangles(coilover.shaft) +
        triangles([buildCoilSpring(coilover.spring, 0.05)]) +
        triangles(buildSuspensionArm(0.06, 0.025));
    }
    expect(total, document.kartId).toBeLessThanOrEqual(KART_TRIANGLES);
  }
});

test("CAD meshes are well formed and within the part budget", () => {
  for (const mesh of KART_CAD_MESHES) {
    const pieces = buildCadPieces(mesh);
    expect(getKartPartVisual(parseReference(mesh.part)), mesh.part).not.toBeNull();
    expect(triangles(pieces), mesh.part).toBeLessThanOrEqual(CAD_PART_TRIANGLES);
    for (const piece of pieces) {
      const label = `${mesh.part} ${piece.finish}`;
      expect(CAD_FINISHES.has(piece.finish), label).toBe(true);
      const vertices = piece.positions.length / 3;
      expect(piece.normals.length, label).toBe(piece.positions.length);
      expect(piece.indices.length % 3, label).toBe(0);
      expect(Math.max(...piece.indices), label).toBeLessThan(vertices);
      for (let i = 0; i < vertices; i++) {
        const length = Math.hypot(
          ...piece.normals.slice(i * 3, i * 3 + 3),
        );
        expect(Math.abs(length - 1), label).toBeLessThan(1e-3);
      }
      // Counter-clockwise seen from the side the normals point to, and,
      // since CAD solids are closed, enclosing a positive volume.
      let volume = 0;
      for (let t = 0; t < piece.indices.length; t += 3) {
        const [a, b, c] = piece.indices.slice(t, t + 3).map((index) =>
          piece.positions.slice(index * 3, index * 3 + 3),
        );
        const ab = a.map((value, axis) => b[axis] - value);
        const ac = a.map((value, axis) => c[axis] - value);
        const face = [
          ab[1] * ac[2] - ab[2] * ac[1],
          ab[2] * ac[0] - ab[0] * ac[2],
          ab[0] * ac[1] - ab[1] * ac[0],
        ];
        const normal = [0, 1, 2].map((axis) =>
          piece.indices
            .slice(t, t + 3)
            .reduce((sum, index) => sum + piece.normals[index * 3 + axis], 0),
        );
        const facing = face.reduce((sum, value, axis) => sum + value * normal[axis], 0);
        expect(facing, label).toBeGreaterThanOrEqual(0);
        volume += face.reduce((sum, value, axis) => sum + value * a[axis], 0) / 6;
      }
      expect(volume, label).toBeGreaterThan(0);
    }
  }
});

function parseReference(part: string) {
  const [id, version] = part.split("@");
  return { id, version: Number(version) };
}

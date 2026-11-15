import motorBrushlessStandardV1 from "./cad-meshes/motor.brushless-standard@1.json";
import type {
  KartPartFinish,
  KartPartVisualPiece,
} from "./kart-part-visual-geometry";

/**
 * A part mesh written by `cad/export.py` from its build123d model in
 * `cad/parts/`, drawing the approved part `part` (`id@version`): positions
 * in micrometres and normals scaled by 10,000, in the part's own frame. Measured
 * mass is CAD evidence for reports only; derivation never reads it.
 */
export type KartCadMesh = {
  part: string;
  measured: { centerOfMass: number[]; massKg: number } | null;
  pieces: Array<{
    finish: string;
    indices: number[];
    normals: number[];
    positions: number[];
  }>;
};

export const KART_CAD_MESHES: readonly KartCadMesh[] = [
  motorBrushlessStandardV1,
];

/** Fresh part-visual pieces, in metres, from a committed CAD mesh. */
export function buildCadPieces(mesh: KartCadMesh): KartPartVisualPiece[] {
  return mesh.pieces.map((piece) => ({
    finish: piece.finish as KartPartFinish,
    indices: piece.indices.slice(),
    normals: piece.normals.map((value) => value / 10_000),
    positions: piece.positions.map((value) => value / 1_000_000),
  }));
}

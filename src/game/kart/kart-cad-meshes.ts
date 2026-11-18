import motorBrushlessStandardV1 from "./cad-meshes/motor.brushless-standard@1.json";
import motorBrushlessStandardV2 from "./cad-meshes/motor.brushless-standard@2.json";
import steeringServoStandardV1 from "./cad-meshes/steering.servo-standard@1.json";
import steeringServoStandardV2 from "./cad-meshes/steering.servo-standard@2.json";
import transmissionBalanced5to1V1 from "./cad-meshes/transmission.balanced-5to1@1.json";
import transmissionBalanced5to1V2 from "./cad-meshes/transmission.balanced-5to1@2.json";
import transmissionShort8to1V1 from "./cad-meshes/transmission.short-8to1@1.json";
import transmissionShort8to1V2 from "./cad-meshes/transmission.short-8to1@2.json";
import transmissionTall4to1V1 from "./cad-meshes/transmission.tall-4to1@1.json";
import transmissionTall4to1V2 from "./cad-meshes/transmission.tall-4to1@2.json";
import type {
  KartPartFinish,
  KartPartVisualPiece,
  Vec3,
} from "./kart-part-visual-geometry";

type KartCadPiece = {
  finish: string;
  indices: number[];
  normals: number[];
  positions: number[];
};

/**
 * A part mesh written by `cad/export.py` from its build123d model in
 * `cad/parts/`, drawing the approved part `part` (`id@version`): positions
 * in micrometres and normals scaled by 10,000, in the part's own frame. Measured
 * mass is CAD evidence for reports only; derivation never reads it.
 */
export type KartCadMesh = {
  part: string;
  measured: { centerOfMass: number[]; massKg: number } | null;
  /**
   * Named points, in micrometres: where the kart's linkages meet the part,
   * and `mount-<id>` for each of its registry mounting points.
   */
  points: Record<string, number[]>;
  pieces: KartCadPiece[];
  /**
   * Named groups of pieces the kart poses, such as a servo's horn, drawn at
   * rest in the part's frame. Each turns about its `<name>-pivot` point.
   */
  moving: Record<string, KartCadPiece[]>;
};

export const KART_CAD_MESHES: readonly KartCadMesh[] = [
  motorBrushlessStandardV1,
  motorBrushlessStandardV2,
  steeringServoStandardV1,
  steeringServoStandardV2,
  transmissionBalanced5to1V1,
  transmissionBalanced5to1V2,
  transmissionShort8to1V1,
  transmissionShort8to1V2,
  transmissionTall4to1V1,
  transmissionTall4to1V2,
];

export function getKartCadMesh(reference: { id: string; version: number }) {
  const part = `${reference.id}@${reference.version}`;
  return KART_CAD_MESHES.find((mesh) => mesh.part === part) ?? null;
}

/** A named point of a CAD part, in metres in the part's frame. */
export function getCadPoint(mesh: KartCadMesh, name: string): Vec3 | null {
  const point = mesh.points[name];
  return point
    ? [point[0] / 1_000_000, point[1] / 1_000_000, point[2] / 1_000_000]
    : null;
}

/** Fresh part-visual pieces, in metres, from a committed CAD mesh. */
export function buildCadPieces(mesh: KartCadMesh): KartPartVisualPiece[] {
  return toPieces(mesh.pieces, [0, 0, 0]);
}

/**
 * Fresh pieces of one of a CAD mesh's moving groups, in metres about its
 * pivot point, so an entity placed at the pivot turns the group in place.
 */
export function buildCadMovingPieces(
  mesh: KartCadMesh,
  name: string,
): { pieces: KartPartVisualPiece[]; pivot: Vec3 } {
  const pivot = getCadPoint(mesh, `${name}-pivot`) ?? [0, 0, 0];
  return { pieces: toPieces(mesh.moving[name] ?? [], pivot), pivot };
}

function toPieces(pieces: KartCadPiece[], origin: Vec3): KartPartVisualPiece[] {
  return pieces.map((piece) => ({
    finish: piece.finish as KartPartFinish,
    indices: piece.indices.slice(),
    normals: piece.normals.map((value) => value / 10_000),
    positions: piece.positions.map(
      (value, index) => value / 1_000_000 - origin[index % 3],
    ),
  }));
}

import { CYLINDER_SIDES } from "./course-bevel";
import { rotateCourseDirection } from "./course-document";

type Vec3 = { x: number; y: number; z: number };
type Transform = { position: Vec3; rotation: Vec3 };

const AXES = ["x", "y", "z"] as const;
const UNROTATED = { x: 0, y: 0, z: 0 };

/**
 * A unit box or cylinder for a timber object of this size and place, with its
 * streams matching the engine's primitives (positions, normals, two UV sets)
 * so it batches with them. Its UVs are metres with u along the grain, which
 * runs the length of the piece: up a post, along a brace's slope, along a
 * board, and along a round's axis. They are anchored to the world along each
 * face's grain and across it, so pieces lying in one plane with their grain
 * one way show the same wood, and where they overlap neither shows through.
 */
export function createCourseTimberGeometry(
  shape: "box" | "cylinder",
  scale: Vec3,
  transform: Transform,
) {
  const sizes = AXES.map((axis) => scale[axis]);
  // A local axis's world direction, turned to point the same way whichever
  // way round the piece lies, and where the piece's origin falls along it.
  const anchors = AXES.map((axis) => {
    const local = { ...UNROTATED, [axis]: 1 };
    const world = rotateCourseDirection(local, UNROTATED, transform.rotation);
    const components = AXES.map((component) => world[component]);
    const largest = components.reduce(
      (best, value, index) =>
        Math.abs(value) > Math.abs(components[best]!) ? index : best,
      0,
    );
    const sign = Math.sign(components[largest]!) || 1;
    const offset =
      sign *
      AXES.reduce(
        (sum, component) => sum + transform.position[component] * world[component],
        0,
      );
    return { offset, sign };
  });
  // Metres along a local axis from the world's origin, for a unit position.
  const anchored = (axis: number, unit: number) =>
    anchors[axis]!.sign * unit * sizes[axis]! + anchors[axis]!.offset;

  const positions: number[] = [];
  const normals: number[] = [];
  const uvs: number[] = [];
  const indices: number[] = [];
  const corner = (position: number[], normal: number[], u: number, v: number) => {
    positions.push(...position);
    normals.push(...normal);
    uvs.push(u, v);
    return positions.length / 3 - 1;
  };

  if (shape === "cylinder") {
    // Round timber's grain runs along its axis, local Y; around it, the
    // wood keeps its size in metres at the round's mean radius.
    const radius = (scale.x + scale.z) / 4;
    for (let side = 0; side <= CYLINDER_SIDES; side++) {
      const angle = (side / CYLINDER_SIDES) * Math.PI * 2;
      const [x, z] = [Math.cos(angle), Math.sin(angle)];
      for (const y of [-0.5, 0.5]) {
        corner([x / 2, y, z / 2], [x, 0, z], anchored(1, y), angle * radius);
      }
    }
    for (let side = 0; side < CYLINDER_SIDES; side++) {
      const bottom = side * 2;
      indices.push(bottom, bottom + 1, bottom + 2, bottom + 1, bottom + 3, bottom + 2);
    }
    // Its ends take the wood laid flat across them.
    for (const y of [-0.5, 0.5]) {
      const centre = corner([0, y, 0], [0, y * 2, 0], anchored(0, 0), anchored(2, 0));
      for (let side = 0; side < CYLINDER_SIDES; side++) {
        const ring = [side, side + 1].map((step) => {
          const angle = (step / CYLINDER_SIDES) * Math.PI * 2;
          const [x, z] = [Math.cos(angle) / 2, Math.sin(angle) / 2];
          return corner([x, y, z], [0, y * 2, 0], anchored(0, x), anchored(2, z));
        }) as [number, number];
        indices.push(centre, ...(y > 0 ? [ring[1], ring[0]] : ring));
      }
    }
    return { indices, normals, positions, uvs };
  }

  const length = sizes.indexOf(Math.max(...sizes));
  for (let normal = 0; normal < 3; normal++) {
    const [a, b] = [0, 1, 2].filter((axis) => axis !== normal) as [number, number];
    // Faces along the piece take its grain; its ends, their longer side.
    const along = length !== normal ? length : sizes[a]! >= sizes[b]! ? a : b;
    const across = along === a ? b : a;
    for (const side of [-0.5, 0.5]) {
      const first = positions.length / 3;
      for (const [s, t] of [
        [-0.5, -0.5],
        [0.5, -0.5],
        [0.5, 0.5],
        [-0.5, 0.5],
      ] as const) {
        const position = [0, 0, 0];
        position[normal] = side;
        position[a] = s;
        position[b] = t;
        corner(
          position,
          position.map((_, axis) => (axis === normal ? side * 2 : 0)),
          anchored(along, position[along]!),
          anchored(across, position[across]!),
        );
      }
      // Wound counter-clockwise seen from outside. The corners turn from a
      // toward b, about a × b: +x for (y, z), −y for (x, z), +z for (x, y).
      const turn = normal === 1 ? -side : side;
      indices.push(
        ...(turn > 0
          ? [first, first + 1, first + 2, first, first + 2, first + 3]
          : [first, first + 2, first + 1, first, first + 3, first + 2]),
      );
    }
  }
  return { indices, normals, positions, uvs };
}

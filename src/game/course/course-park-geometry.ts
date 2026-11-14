// Park furniture and planting, in metres, Y up, each centred over its
// footprint and inside its box (COURSE_PARK_SIZES). A bench's front is +Z.
// Trees and shrubs carry boughs: 2 m cards from leaf-boughs-colour.jpg, each
// a branch of the nursery trees' leaf sprays, drawn smaller for smaller
// leaves. Everything here is plain geometry; course-park.ts draws and
// collides it.
import {
  createCourseBevelGeometry,
  createCourseMeshBuilder,
} from "./course-bevel";
import { COURSE_PARK_SIZES } from "./course-document";
import {
  add,
  addLeafCard,
  cross,
  normalize as unit,
  scale as mul,
  type TreeMeshData,
} from "./course-tree-geometry";

type V = [number, number, number];
type ParkCollider = { center: V; halfExtents: V };
/**
 * A piece's geometry by finish: sawn timber (UVs in metres along the
 * grain), coated solids coloured per vertex, bark, boughs and leaf sprays
 * (cards, tinted per vertex), and the course's kerb concrete and mulch.
 */
export const PARK_FINISHES = [
  "timber",
  "solid",
  "bark",
  "boughs",
  "leaves",
  "kerb",
  "mulch",
] as const;
export type ParkGeometry = {
  meshes: Record<(typeof PARK_FINISHES)[number], TreeMeshData>;
  colliders: ParkCollider[];
};

const emptyMesh = (): TreeMeshData => ({
  positions: [],
  normals: [],
  indices: [],
  uvs: [],
  colors: [],
});
export function createEmptyParkMeshes() {
  return Object.fromEntries(
    PARK_FINISHES.map((finish) => [finish, emptyMesh()]),
  ) as ParkGeometry["meshes"];
}
const piece = (): ParkGeometry => ({
  meshes: createEmptyParkMeshes(),
  colliders: [],
});

const ONE = { x: 1, y: 1, z: 1 };
const sub = (a: V, b: V): V => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
const dot = (a: V, b: V) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const smooth = (from: number, to: number, value: number) => {
  const t = Math.min(1, Math.max(0, (value - from) / (to - from)));
  return t * t * (3 - 2 * t);
};
function random(seed: number) {
  // Scrambled, so neighbouring seeds grow nothing alike.
  let state = Math.imul(seed ^ 0x9e3779b9, 2654435761) >>> 0 || 1;
  return () =>
    (state = (Math.imul(state, 1664525) + 1013904223) >>> 0) / 4294967296;
}

// Linear albedo of the coated solids.
const STEEL: V = [0.055, 0.065, 0.07];
const WHITE: V = [1, 1, 1];

function append(target: TreeMeshData, source: TreeMeshData, color = WHITE) {
  const first = target.positions.length / 3;
  for (const value of source.positions) target.positions.push(value);
  for (const value of source.normals) target.normals.push(value);
  for (const index of source.indices) target.indices.push(index + first);
  for (let i = 0; i < source.positions.length / 3; i++) {
    target.uvs!.push(source.uvs?.[i * 2] ?? 0, source.uvs?.[i * 2 + 1] ?? 0);
    target.colors!.push(...color, 1);
  }
}

// Six plain faces, fitted to a unit box as the bevelled one is.
function createPlainBox(size: V) {
  const builder = createCourseMeshBuilder({ x: size[0], y: size[1], z: size[2] });
  for (let axis = 0; axis < 3; axis++) {
    const a = (axis + 1) % 3;
    const b = (axis + 2) % 3;
    for (const sign of [-1, 1]) {
      const normal: V = [0, 0, 0];
      normal[axis] = sign;
      const corners = [
        [-1, -1],
        [1, -1],
        [1, 1],
        [-1, 1],
      ].map(([s, t]) => {
        const corner: V = [0, 0, 0];
        corner[axis] = (sign * size[axis]!) / 2;
        corner[a] = (s! * size[a]!) / 2;
        corner[b] = (t! * size[b]!) / 2;
        return corner;
      });
      builder.polygon(corners, normal);
    }
  }
  return builder.geometry;
}

// A board, casting, or steel section: a box, chamfered where it is cut or
// cast so, leaning back by `tilt`. Its UVs are metres, u along its length.
function box(
  mesh: TreeMeshData,
  center: V,
  size: V,
  color = WHITE,
  bevel = 0,
  tilt = 0,
) {
  const scale = { x: size[0], y: size[1], z: size[2] };
  const data = bevel
    ? createCourseBevelGeometry("box", scale, bevel)
    : createPlainBox(size);
  const turn = ([x, y, z]: V): V => [
    x,
    y * Math.cos(tilt) - z * Math.sin(tilt),
    y * Math.sin(tilt) + z * Math.cos(tilt),
  ];
  const longest = [0, 1, 2].sort((a, b) => size[b]! - size[a]!);
  for (let i = 0; i < data.positions.length; i += 3) {
    const local = data.positions.slice(i, i + 3).map((v, k) => v * size[k]!);
    const normal = unit(
      data.normals.slice(i, i + 3).map((v, k) => v / size[k]!) as V,
    );
    data.positions.splice(i, 3, ...add(center, turn(local as V)));
    data.normals.splice(i, 3, ...turn(normal));
    // Grain follows the board's length, or its end's longer side.
    const face = normal.map(Math.abs).indexOf(Math.max(...normal.map(Math.abs)));
    const along = longest.find((axis) => axis !== face)!;
    const across = 3 - face - along;
    data.uvs[(i / 3) * 2] = local[along]! + center[along]!;
    data.uvs[(i / 3) * 2 + 1] = local[across]! + center[across]!;
  }
  append(mesh, data, color);
}

function collider(result: ParkGeometry, center: V, size: V) {
  result.colliders.push({ center, halfExtents: mul(size, 0.5) });
}

// Round wood through `path`, `radius(ring, angle)` metres thick, smooth
// around and closed at its far end; its near end stands in the ground or
// inside the wood it grows from.
function tube(
  mesh: TreeMeshData,
  path: V[],
  radius: (ring: number, angle: number) => number,
  sides: number,
  color = WHITE,
) {
  const builder = createCourseMeshBuilder(ONE);
  let u: V | undefined;
  const rings = path.map((point, index) => {
    const tangent = unit(
      sub(
        path[Math.min(index + 1, path.length - 1)]!,
        path[Math.max(index - 1, 0)]!,
      ),
    );
    // Each ring's frame follows from the last, so the wood never twists.
    u = unit(
      u
        ? sub(u, mul(tangent, dot(u, tangent)))
        : cross(tangent, Math.abs(tangent[1]) > 0.9 ? [1, 0, 0] : [0, 1, 0]),
    );
    const v = cross(tangent, u);
    return Array.from({ length: sides }, (_, side) => {
      const angle = (side / sides) * Math.PI * 2;
      const out = add(mul(u!, Math.cos(angle)), mul(v, Math.sin(angle)));
      return { at: add(point, mul(out, radius(index, angle))), out };
    });
  });
  for (let ring = 0; ring + 1 < rings.length; ring++) {
    for (let side = 0; side < sides; side++) {
      const corners = [
        rings[ring]![side]!,
        rings[ring]![(side + 1) % sides]!,
        rings[ring + 1]![(side + 1) % sides]!,
        rings[ring + 1]![side]!,
      ];
      builder.polygon(
        corners.map((corner) => corner.at),
        corners.map((corner) => corner.out),
      );
    }
  }
  const last = path.length - 1;
  builder.polygon(
    rings[last]!.map((corner) => corner.at),
    unit(sub(path[last]!, path[last - 1]!)),
  );
  append(mesh, builder.geometry, color);
}

/**
 * A 1.8 m park bench: five hardwood seat slats and three raked back boards
 * on welded steel end frames with arm rails, standing on anchor shoes. A
 * kart fits under its seat, between its legs.
 */
export function buildParkBench(): ParkGeometry {
  const p = piece();
  const { timber, solid } = p.meshes;
  for (let i = 0; i < 5; i++) {
    box(timber, [0, 0.434, -0.14 + i * 0.096], [1.8, 0.032, 0.085], WHITE, 0.004);
  }
  for (let i = 0; i < 3; i++) {
    const at: V = [0, 0.565 + i * 0.12, -0.245 - i * 0.025];
    box(timber, at, [1.8, 0.105, 0.032], WHITE, 0.004, -0.205);
  }
  for (const x of [-0.65, 0.65]) {
    for (const z of [-0.23, 0.23]) {
      box(solid, [x, 0.012, z], [0.16, 0.024, 0.12], STEEL);
      box(solid, [x, 0.222, z], [0.055, 0.42, 0.045], STEEL);
      // A leg collides as wide as its anchor shoe.
      collider(p, [x, 0.214, z], [0.16, 0.428, 0.12]);
    }
    box(solid, [x, 0.397, 0.015], [0.055, 0.038, 0.55], STEEL);
    // The back's upright rises from the rail; the arm runs back to it.
    box(solid, [x, 0.63, -0.261], [0.045, 0.44, 0.032], STEEL, 0, -0.205);
    box(solid, [x, 0.55, 0.17], [0.035, 0.24, 0.035], STEEL);
    box(solid, [x, 0.67, -0.035], [0.06, 0.035, 0.46], STEEL, 0.006);
    collider(p, [x, 0.55, -0.035], [0.1, 0.275, 0.46]);
  }
  collider(p, [0, 0.435, 0.01], [1.8, 0.1, 0.56]);
  // The back's boards, from the seat up.
  collider(p, [0, 0.67, -0.27], [1.8, 0.38, 0.11]);
  return p;
}

/**
 * A square 120 litre litter bin: vertical hardwood slats around a steel
 * liner under a folded steel rim, on a concrete plinth.
 */
export function buildParkBin(): ParkGeometry {
  const p = piece();
  const { timber, solid, kerb } = p.meshes;
  box(kerb, [0, 0.04, 0], [0.56, 0.08, 0.56], WHITE, 0.01);
  for (const sign of [-1, 1]) {
    box(solid, [sign * 0.221, 0.46, 0], [0.008, 0.76, 0.45], STEEL);
    box(solid, [0, 0.46, sign * 0.221], [0.434, 0.76, 0.008], STEEL);
    for (let i = 0; i < 5; i++) {
      const a = (i - 2) * 0.098;
      box(timber, [a, 0.46, sign * 0.249], [0.084, 0.72, 0.025]);
      box(timber, [sign * 0.249, 0.46, a], [0.025, 0.72, 0.084]);
    }
    box(solid, [0, 0.875, sign * 0.225], [0.54, 0.09, 0.09], STEEL, 0.005);
    box(solid, [sign * 0.225, 0.875, 0], [0.09, 0.09, 0.36], STEEL, 0.005);
  }
  collider(p, [0, 0.46, 0], [0.56, 0.92, 0.56]);
  return p;
}

type Crown = {
  centre: V;
  radii: V;
  /** The crown's envelope: how far from its axis, and how low and high. */
  reach: number;
  low: number;
  high: number;
  /** Leaf colour, multiplying the scanned leaves'. */
  tint: V;
};

// A lobe of foliage: the boughs a branch end carries, `count` of them
// around `centre`. Some lie over the lobe like shingles and some reach out
// of it, breaking its outline; those deep in the crown are shaded by the rest.
function addLobe(
  mesh: TreeMeshData,
  crown: Crown,
  centre: V,
  radius: number,
  count: number,
  size: number,
  rng: () => number,
) {
  for (let index = 0; index < count; index++) {
    const y = rng() * 2 - 1;
    const azimuth = rng() * Math.PI * 2;
    const flat = Math.sqrt(1 - y * y);
    const out: V = [Math.cos(azimuth) * flat, y, Math.sin(azimuth) * flat];
    const at = add(centre, mul(out, radius * (0.4 + 0.6 * Math.cbrt(rng()))));
    let card = size * (0.85 + 0.3 * rng());
    const turn = rng() * Math.PI * 2;
    const spin = unit(
      cross(out, [Math.cos(turn), 0.3 * Math.sin(turn * 3), Math.sin(turn)]),
    );
    let up: V;
    let across: V;
    let foot: V;
    if (rng() < 0.45) {
      // Reaching out of the lobe, its end weighed down a little.
      up = unit(add(out, [0, -0.2, 0]));
      across = unit(cross(up, spin));
      foot = sub(at, mul(up, card * 0.6));
    } else {
      // Lying over the lobe, a little inside its surface.
      up = unit(add(cross(spin, out), mul(out, 0.3)));
      across = unit(cross(up, out));
      foot = sub(sub(at, mul(sub(at, centre), 0.2)), mul(up, card * 0.5));
    }
    // Keep the whole card inside the piece's envelope: move it by its
    // corner furthest out, and make it smaller if it still does not fit.
    for (let attempt = 0; attempt < 24; attempt++) {
      let worst = 1e-4;
      let shift: V | undefined;
      for (const end of [0, 1]) {
        for (const side of [-1, 1]) {
          const corner = add(
            add(foot, mul(up, card * end)),
            mul(across, (side * card) / 2),
          );
          const from = Math.hypot(corner[0], corner[2]);
          const over = from - crown.reach;
          if (over > worst) {
            worst = over;
            shift = [(-corner[0] * over) / from, 0, (-corner[2] * over) / from];
          }
          for (const beyond of [crown.low - corner[1], corner[1] - crown.high]) {
            if (beyond <= worst) continue;
            worst = beyond;
            shift = [0, corner[1] > crown.high ? -beyond : beyond, 0];
          }
        }
      }
      if (!shift) break;
      foot = add(foot, shift);
      if (attempt % 6 === 5) card *= 0.85;
    }
    const vary = 0.88 + 0.24 * rng();
    const hue: V = [0.94 + 0.12 * rng(), 1, 0.9 + 0.2 * rng()];
    addLeafCard(mesh, foot, up, across, card, Math.floor(rng() * 4), (corner) => {
      const inCrown = sub(corner, crown.centre).map(
        (value, axis) => value / crown.radii[axis]!,
      ) as V;
      const normal = unit(
        add(
          add(mul(unit(inCrown), 0.55), mul(unit(sub(corner, centre)), 0.45)),
          [0, 0.15, 0],
        ),
      );
      // Light reaches the outside of the crown, and its top most.
      const shade =
        (0.34 + 0.66 * smooth(0.35, 1, Math.hypot(...inCrown))) *
        (0.82 + 0.18 * smooth(-1, 0.6, inCrown[1])) *
        (0.78 + 0.22 * smooth(0.3, 1, Math.hypot(...sub(corner, centre)) / radius)) *
        vary;
      return {
        normal,
        occlusion: crown.tint.map(
          (value, axis) => value * hue[axis]! * shade,
        ) as V,
      };
    });
  }
}

/**
 * A European beech (Fagus sylvatica) grown in the open, 10.5 m high: a
 * short, smooth grey trunk on spreading root buttresses, forking at about
 * 3 m into rising limbs that carry a broad dome down to 3 m above the lawn.
 */
export function buildParkShadeTree(seed: number): ParkGeometry {
  const p = piece();
  const rng = random(seed);
  const { bark, boughs } = p.meshes;
  const crown: Crown = {
    centre: [0, 6.75, 0],
    radii: [3.75, 3.6, 3.75],
    reach: 3.86,
    low: 2.9,
    high: 10.46,
    tint: [0.78, 0.9, 0.7],
  };
  const girth = 0.22 + 0.04 * rng();
  const lean: V = [(rng() - 0.5) * 0.5, 0, (rng() - 0.5) * 0.5];
  // The trunk stands straight out of the lawn, then leans as it rises.
  const leader = (height: number): V => [
    lean[0] * (Math.max(0, height - 0.3) / 8) ** 2,
    height,
    lean[2] * (Math.max(0, height - 0.3) / 8) ** 2,
  ];
  const heights = [0, 0.3, 1.5, 3, 5.2, 7.6];
  const radii = [1.35, 1.05, 0.95, 0.85, 0.5, 0.15];
  const flare = [0.22, 0.08];
  tube(
    bark,
    heights.map(leader),
    (ring, angle) =>
      girth *
      radii[ring]! *
      // Five buttresses stand out at the lawn and die away up the trunk.
      (1 + (flare[ring] ?? 0) * Math.cos(angle * 5)),
    10,
  );

  // Where a branch can grow from, and each lobe of foliage it ends in.
  const nodes: V[] = [leader(3), leader(5.2), leader(7.6)];
  const lobes: Array<{ centre: V; radius: number }> = [];
  // A beech's dome is broadest below its middle and narrows to its top.
  const place = (azimuth: number, height: number, spread: number): V => {
    const flat =
      Math.sqrt(Math.max(0, 1 - ((height + 0.35) / 1.35) ** 2)) * spread;
    return [
      Math.cos(azimuth) * flat * crown.radii[0] * 0.72,
      crown.centre[1] + height * crown.radii[1] * 0.72,
      Math.sin(azimuth) * flat * crown.radii[2] * 0.72,
    ];
  };
  const twist = rng() * Math.PI * 2;
  const limbs = 6;
  for (let limb = 0; limb < limbs; limb++) {
    const azimuth = twist + limb * 2.39996 + (rng() - 0.5) * 0.4;
    const start = leader(2.75 + limb * 0.36);
    const end = place(azimuth, -0.4 + 0.18 * (limb % 3), 0.9 + 0.1 * rng());
    const elbow = add(add(start, mul(sub(end, start), 0.45)), [0, 0.45, 0]);
    tube(
      bark,
      [start, elbow, end],
      (ring) => [girth * 0.42, girth * 0.27, 0.035][ring]!,
      6,
    );
    nodes.push(elbow, end);
    lobes.push({ centre: end, radius: 1.05 + 0.2 * rng() });
  }
  const rest: Array<[number, number, number, number]> = [];
  // The skirt hanging below the limbs, the shoulders above them, the top,
  // and the shaded middle.
  for (let i = 0; i < 6; i++) rest.push([i * 1.0472 + 0.5, -0.86, 0.97, 1]);
  for (let i = 0; i < 6; i++) rest.push([i * 1.0472 + 0.1, 0.3, 0.95, 1.05]);
  for (let i = 0; i < 3; i++) rest.push([i * 2.0944 + 1.1, 0.68, 0.9, 0.95]);
  rest.push([0, 0.97, 0, 0.9], [0.7, -0.2, 0.25, 1.1], [3.8, 0.15, 0.3, 1.1]);
  for (const [azimuth, level, spread, size] of rest) {
    const centre = place(
      twist + azimuth + (rng() - 0.5) * 0.6,
      level + (rng() - 0.5) * 0.14,
      spread * (0.88 + 0.2 * rng()),
    );
    const radius = size * (0.9 + 0.25 * rng());
    // Each grows from the nearest wood that is not above it.
    const from = nodes
      .filter((node) => node[1] < centre[1] + 0.6)
      .reduce((best, node) =>
        Math.hypot(...sub(node, centre)) < Math.hypot(...sub(best, centre))
          ? node
          : best,
      );
    const length = Math.hypot(...sub(centre, from));
    tube(bark, [from, centre], (ring) => (ring ? 0.02 : 0.03 + 0.022 * length), 4);
    lobes.push({ centre, radius });
  }
  const wood = Object.values(p.meshes).reduce(
    (sum, mesh) => sum + mesh.indices.length / 3,
    0,
  );
  const each = Math.floor((1500 - wood) / 2 / lobes.length);
  for (const lobe of lobes) {
    addLobe(boughs, crown, lobe.centre, lobe.radius, each, 1.5, rng);
  }
  // Wide enough to take in most of the root flare at a kart's height.
  collider(p, [0, 1.5, 0], [girth * 3, 3, girth * 3]);
  return p;
}

/**
 * A snowy mespilus (Amelanchier lamarckii), 4.8 m high: three or four
 * slender grey stems leaning apart from one root into a light, upright
 * crown of small, fresh green leaves.
 */
export function buildParkOrnamentalTree(seed: number): ParkGeometry {
  const p = piece();
  const rng = random(seed);
  const { bark, boughs } = p.meshes;
  const crown: Crown = {
    centre: [0, 3.15, 0],
    radii: [1.75, 1.6, 1.75],
    reach: 1.86,
    low: 1.15,
    high: 4.76,
    tint: [1, 1, 0.66],
  };
  const stems = 3 + Math.floor(rng() * 2);
  const twist = rng() * Math.PI * 2;
  for (let stem = 0; stem < stems; stem++) {
    const azimuth = twist + (stem / stems) * Math.PI * 2 + (rng() - 0.5) * 0.5;
    const away: V = [Math.cos(azimuth), 0, Math.sin(azimuth)];
    const girth = 0.03 + 0.012 * rng();
    // A stem leans out of the clump, then rises.
    const out = 0.55 + 0.15 * rng();
    const top = 2.1 + 0.3 * rng();
    const stemPath = [
      [0.06, 0],
      [0.06, 0.02],
      [0.55, 0.3],
      [0.88, 0.65],
      [1, 1],
    ].map(([along, up]): V => add(mul(away, out * along!), [0, top * up!, 0]));
    const fork = stemPath[4]!;
    tube(bark, stemPath, (ring) => girth * [1.4, 1.3, 1, 0.8, 0.6][ring]!, 5);
    // Each stem forks into the lobes above and beside it.
    for (let branch = 0; branch < 3; branch++) {
      const turn = azimuth + (branch - 1) * 0.9 + (rng() - 0.5) * 0.3;
      const reach = branch === 1 ? 0.55 : 1.05;
      const centre: V = [
        Math.cos(turn) * reach,
        branch === 1 ? 3.75 + 0.2 * rng() : 2.55 + 0.5 * rng(),
        Math.sin(turn) * reach,
      ];
      tube(bark, [fork, centre], (ring) => (ring ? 0.01 : girth * 0.5), 4);
      addLobe(boughs, crown, centre, 0.62, 13, 0.95, rng);
    }
  }
  // The stems stand within a quarter of a metre of each other at the lawn.
  collider(p, [0, 0.6, 0], [0.5, 1.2, 0.5]);
  return p;
}

/**
 * A red-barked dogwood (Cornus alba), 1.5 m across and 1.15 m high: a
 * dense mound of upright red stems, in leaf to the ground.
 */
export function buildParkShrub(seed: number): ParkGeometry {
  const p = piece();
  const rng = random(seed);
  const crown: Crown = {
    centre: [0, 0.4, 0],
    radii: [0.75, 0.75, 0.75],
    reach: 0.74,
    low: 0.01,
    high: 1.14,
    tint: [0.86, 0.95, 0.62],
  };
  for (let stem = 0; stem < 6; stem++) {
    const azimuth = stem * 2.39996 + rng();
    const lean = 0.15 + 0.2 * rng();
    tube(
      p.meshes.solid,
      [
        [Math.cos(azimuth) * 0.05, 0, Math.sin(azimuth) * 0.05],
        [Math.cos(azimuth) * 0.05, 0.02, Math.sin(azimuth) * 0.05],
        [Math.cos(azimuth) * lean, 0.55 + 0.2 * rng(), Math.sin(azimuth) * lean],
      ],
      (ring) => (ring === 2 ? 0.005 : 0.011),
      4,
      [0.3, 0.035, 0.03],
    );
  }
  // Its leaves are 4–6 cm: the same boughs at about half their size.
  addLobe(p.meshes.boughs, crown, [0, 0.5, 0], 0.42, 72, 0.95, rng);
  collider(p, [0, 0.45, 0], [1.1, 0.9, 1.1]);
  return p;
}

const DAISY_LEAF: V = [0.42, 0.55, 0.34];
const DAISY_STEM: V = [0.07, 0.13, 0.035];
const DAISY_RAY: V = [0.82, 0.8, 0.72];
const DAISY_DISC: V = [0.62, 0.36, 0.03];
/** Precast kerb units are 915 mm long; a bed's are cut evenly to fit it. */
const KERB_UNIT = 0.915;

/**
 * A raised bed, 2.4 m by 1.1 m and 0.26 m high: 120 mm precast concrete
 * kerbs with chamfered edges around mulched soil, planted with a drift of
 * dwarf Shasta daisies (Leucanthemum × superbum), 25–45 cm high with 7 cm
 * heads.
 */
export function buildParkFlowerBed(seed: number): ParkGeometry {
  const p = piece();
  const rng = random(seed);
  const { kerb, mulch, solid, leaves } = p.meshes;
  const { x, z } = COURSE_PARK_SIZES["flower-bed"];
  for (const sign of [-1, 1]) {
    const long = Math.ceil(x / KERB_UNIT);
    for (let i = 0; i < long; i++) {
      const at: V = [-x / 2 + ((i + 0.5) * x) / long, 0.13, sign * (z / 2 - 0.06)];
      box(kerb, at, [x / long - 0.004, 0.26, 0.12], WHITE, 0.008);
    }
    const inner = z - 0.24;
    const short = Math.ceil(inner / KERB_UNIT);
    for (let i = 0; i < short; i++) {
      const at: V = [
        sign * (x / 2 - 0.06),
        0.13,
        -inner / 2 + ((i + 0.5) * inner) / short,
      ];
      box(kerb, at, [0.12, 0.26, inner / short - 0.004], WHITE, 0.008);
    }
  }
  const soil = 0.21;
  box(mulch, [0, soil / 2, 0], [x - 0.24, soil, z - 0.24]);

  // The daisies stand a hand apart, each in its own patch of the bed.
  const bedX = x - 0.54;
  const bedZ = z - 0.54;
  const plants = Math.round(bedX * bedZ * 30);
  const columns = Math.round(Math.sqrt((plants * bedX) / bedZ));
  const rows = Math.ceil(plants / columns);
  for (let plant = 0; plant < columns * rows; plant++) {
    const px = (((plant % columns) + 0.15 + 0.7 * rng()) / columns - 0.5) * bedX;
    const pz = ((Math.floor(plant / columns) + 0.15 + 0.7 * rng()) / rows - 0.5) * bedZ;
    const top: V = [
      px + (rng() - 0.5) * 0.06,
      soil + 0.25 + 0.2 * rng(),
      pz + (rng() - 0.5) * 0.06,
    ];
    const turn = rng() * Math.PI * 2;
    const tilt = 0.2 + 0.6 * rng();
    // The head faces up and a little aside; u and v span it.
    const u: V = [
      Math.cos(turn) * Math.cos(tilt),
      -Math.sin(tilt),
      Math.sin(turn) * Math.cos(tilt),
    ];
    const v: V = [Math.sin(turn), 0, -Math.cos(turn)];
    const facing = unit(cross(u, v));
    const ray = (angle: number, reach: number, lift = 0): V =>
      add(
        add(top, mul(facing, lift)),
        add(mul(u, Math.cos(angle) * reach), mul(v, Math.sin(angle) * reach)),
      );
    const head = createCourseMeshBuilder(ONE);
    for (let k = 0; k < 9; k++) {
      const angle = (k / 9) * Math.PI * 2;
      head.polygon(
        [ray(angle, 0.006), ray(angle - 0.24, 0.035), ray(angle + 0.24, 0.035)],
        facing,
      );
    }
    append(solid, head.geometry, DAISY_RAY);
    const disc = createCourseMeshBuilder(ONE);
    disc.polygon(
      Array.from({ length: 6 }, (_, k) => ray((k / 6) * Math.PI * 2, 0.011, 0.003)),
      facing,
    );
    append(solid, disc.geometry, DAISY_DISC);
    // Its stalk, a ribbon as wide as a real one, seen from either side.
    const stalk = createCourseMeshBuilder(ONE);
    const wide = mul(v, 0.003);
    stalk.polygon(
      [
        [px - wide[0], soil, pz - wide[2]],
        [px + wide[0], soil, pz + wide[2]],
        add(top, wide),
        sub(top, wide),
      ],
      [-v[2], 0, v[0]],
    );
    append(solid, stalk.geometry, DAISY_STEM);
    // Its leaves: a nursery spray at 0.6 of its size, so 5–8 cm, rising
    // from the soil and leaning out of the clump.
    const lean = rng() * Math.PI * 2;
    const up = unit([Math.cos(lean) * 0.35, 1, Math.sin(lean) * 0.35]);
    const across = unit(cross(up, [Math.sin(lean), 0, -Math.cos(lean)]));
    const shade = 0.75 + 0.25 * rng();
    addLeafCard(
      leaves,
      [px, soil - 0.01, pz],
      up,
      across,
      0.3,
      Math.floor(rng() * 4),
      () => ({
        normal: unit(add(up, [0, 0.6, 0])),
        occlusion: mul(DAISY_LEAF, shade),
      }),
    );
  }
  collider(p, [0, 0.13, 0], [x, 0.26, z]);
  return p;
}

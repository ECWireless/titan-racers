// Young nursery trees and clipped hedges, built at real size in metres.
// Trees are feathered standards about three years old: a staked stem clear
// to 1.8 m, a few scaffold branches, and a crown of leaf sprays (cards from
// leaf-sprays-colour.jpg, 0.5 m square, each a twig carrying scanned leaves).
// Everything here is plain geometry; course-trees.ts draws and collides it.
import {
  type CourseDocument,
  type CourseObject,
  type CoursePrimitiveObject,
  getCourseHedgeSprayCounts,
  getCoursePlantingGrid,
  rotateCourseDirection,
} from "./course-document";

export type TreeMeshData = {
  colors?: number[];
  indices: number[];
  normals: number[];
  positions: number[];
  uvs?: number[];
};

type Vec3 = [number, number, number];

/** The tree's real dimensions, in metres. */
export const NURSERY_TREE = {
  /** Clear stem below the crown. */
  clearStem: 1.8,
  /** Top of the leader, before each tree's own scale. */
  height: 3.2,
  stake: { height: 1.2, offset: 0.06, radius: 0.02 },
  trunk: { baseRadius: 0.019, topRadius: 0.006 },
} as const;
/** Each tree collides as one box taking in its stem and its stake. */
export const NURSERY_TREE_COLLIDER = { height: 2 } as const;
export const NURSERY_TREE_VARIANTS = 3;
const LEAF_CARD = 0.5;

function createRandom(seed: number) {
  let state = seed >>> 0 || 1;
  return () => {
    state = (Math.imul(state, 1664525) + 1013904223) >>> 0;
    return state / 4294967296;
  };
}

function hashString(value: string) {
  let hash = 2166136261;
  for (let i = 0; i < value.length; i++) {
    hash = Math.imul(hash ^ value.charCodeAt(i), 16777619);
  }
  return hash >>> 0;
}

const add = (a: Vec3, b: Vec3): Vec3 => [a[0] + b[0], a[1] + b[1], a[2] + b[2]];
const scale = (a: Vec3, s: number): Vec3 => [a[0] * s, a[1] * s, a[2] * s];
const cross = (a: Vec3, b: Vec3): Vec3 => [
  a[1] * b[2] - a[2] * b[1],
  a[2] * b[0] - a[0] * b[2],
  a[0] * b[1] - a[1] * b[0],
];
const normalize = (a: Vec3): Vec3 => scale(a, 1 / Math.hypot(...a));

// A tapered tube through points, each ring perpendicular to the path.
function addTube(
  mesh: TreeMeshData,
  path: Vec3[],
  radii: number[],
  sides: number,
) {
  const first = mesh.positions.length / 3;
  path.forEach((point, ring) => {
    const next = path[Math.min(ring + 1, path.length - 1)]!;
    const previous = path[Math.max(ring - 1, 0)]!;
    const axis = normalize([
      next[0] - previous[0],
      next[1] - previous[1],
      next[2] - previous[2],
    ]);
    const reference: Vec3 = Math.abs(axis[1]) > 0.9 ? [1, 0, 0] : [0, 1, 0];
    const u = normalize(cross(axis, reference));
    const v = cross(axis, u);
    for (let side = 0; side < sides; side++) {
      const angle = (side / sides) * Math.PI * 2;
      const normal = add(scale(u, Math.cos(angle)), scale(v, Math.sin(angle)));
      mesh.positions.push(...add(point, scale(normal, radii[ring]!)));
      mesh.normals.push(...normal);
    }
  });
  for (let ring = 0; ring < path.length - 1; ring++) {
    for (let side = 0; side < sides; side++) {
      const a = first + ring * sides + side;
      const b = first + ring * sides + ((side + 1) % sides);
      const c = a + sides;
      const d = b + sides;
      mesh.indices.push(a, b, c, b, d, c);
    }
  }
}

// A leaf spray: a card whose foot sits on the twig's attachment, reaching
// along `up`. Its normal is bent toward the outside of the crown, so the
// crown shades as one rounded mass, the same from either face.
function addLeafCard(
  mesh: TreeMeshData,
  foot: Vec3,
  up: Vec3,
  across: Vec3,
  size: number,
  cell: number,
  shading: (corner: Vec3) => { normal: Vec3; occlusion: number },
) {
  const first = mesh.positions.length / 3;
  const half = scale(across, size / 2);
  const corners: Vec3[] = [
    add(foot, scale(half, -1)),
    add(foot, half),
    add(add(foot, half), scale(up, size)),
    add(add(foot, scale(half, -1)), scale(up, size)),
  ];
  // Cells fill the 2 × 2 atlas, each spray's foot at its cell's lower edge.
  const u0 = (cell % 2) * 0.5;
  const v0 = Math.floor(cell / 2) * 0.5;
  const uvs = [
    [u0, v0 + 0.5],
    [u0 + 0.5, v0 + 0.5],
    [u0 + 0.5, v0],
    [u0, v0],
  ];
  corners.forEach((corner, index) => {
    const { normal, occlusion } = shading(corner);
    mesh.positions.push(...corner);
    mesh.normals.push(...normal);
    mesh.uvs!.push(...uvs[index]!);
    mesh.colors!.push(occlusion, occlusion, occlusion, 1);
  });
  mesh.indices.push(first, first + 1, first + 2, first, first + 2, first + 3);
}

/**
 * One young tree, standing at the origin with its leader up +Y: its stem
 * and branches (bark) and its leaf sprays.
 */
export function createNurseryTreeGeometry(variant: number) {
  const random = createRandom(0x7ee + variant * 7919);
  const bark: TreeMeshData = { indices: [], normals: [], positions: [] };
  const leaves: TreeMeshData = {
    colors: [],
    indices: [],
    normals: [],
    positions: [],
    uvs: [],
  };
  const { clearStem, height, trunk } = NURSERY_TREE;
  const wobble = () => (random() - 0.5) * 0.03;
  // The stem rises nearly straight, carrying on as the crown's leader.
  const stemHeights = [0, 0.9, clearStem, 2.5, height];
  const stem: Vec3[] = stemHeights.map((y, index) =>
    index === 0 ? [0, 0, 0] : [wobble(), y, wobble()],
  );
  addTube(
    bark,
    stem,
    stemHeights.map(
      (y) =>
        trunk.baseRadius + (trunk.topRadius - trunk.baseRadius) * (y / height),
    ),
    8,
  );

  const crownCentre: Vec3 = [0, (clearStem + height) / 2 + 0.1, 0];
  const crownRadius = 0.75;
  const shading = (corner: Vec3) => {
    const outward = normalize([
      corner[0] - crownCentre[0],
      (corner[1] - crownCentre[1]) * 1.3,
      corner[2] - crownCentre[2],
    ]);
    const reach = Math.min(
      1,
      Math.hypot(
        corner[0] - crownCentre[0],
        corner[1] - crownCentre[1],
        corner[2] - crownCentre[2],
      ) / crownRadius,
    );
    // Sprays deep in the crown and low under it are shaded by the rest.
    const lift = (corner[1] - clearStem) / (height - clearStem);
    return {
      normal: outward,
      occlusion: Math.min(1, 0.6 + 0.3 * reach + 0.2 * lift),
    };
  };
  const spray = (foot: Vec3, direction: Vec3, size: number) => {
    const roll = random() * Math.PI * 2;
    const reference: Vec3 =
      Math.abs(direction[1]) > 0.95 ? [1, 0, 0] : [0, 1, 0];
    const u = normalize(cross(direction, reference));
    const v = cross(direction, u);
    const across = add(scale(u, Math.cos(roll)), scale(v, Math.sin(roll)));
    addLeafCard(
      leaves,
      foot,
      direction,
      across,
      size,
      Math.floor(random() * 4),
      shading,
    );
  };

  // Scaffold branches spiral up the crown by the golden angle, flatter and
  // longer low down.
  const branches = 6;
  const start = random() * Math.PI * 2;
  for (let index = 0; index < branches; index++) {
    const along = index / (branches - 1);
    const y = clearStem + 0.05 + along * 0.85;
    const heading = start + index * 2.39996;
    const pitch = ((55 - 20 * along + (random() - 0.5) * 10) * Math.PI) / 180;
    const length = 0.65 - 0.2 * along + (random() - 0.5) * 0.1;
    const out: Vec3 = [
      Math.cos(heading) * Math.sin(pitch),
      Math.cos(pitch),
      Math.sin(heading) * Math.sin(pitch),
    ];
    const base: Vec3 = [stem[2]![0], y, stem[2]![2]];
    // Each branch bends upward toward its tip.
    const middle = add(add(base, scale(out, length * 0.5)), [0, 0.04, 0]);
    const tip = add(add(base, scale(out, length)), [0, 0.12, 0]);
    addTube(bark, [base, middle, tip], [0.008, 0.005, 0.0025], 5);
    [
      [base, middle, 0.5],
      [middle, tip, 0.5],
      [middle, tip, 1],
    ].forEach(([from, to, t]) => {
      const foot = add(
        scale(from as Vec3, 1 - (t as number)),
        scale(to as Vec3, t as number),
      );
      const direction = normalize(
        add(out, [
          (random() - 0.5) * 0.8,
          0.5 + random() * 0.5,
          (random() - 0.5) * 0.8,
        ]),
      );
      spray(foot, direction, LEAF_CARD * (0.9 + random() * 0.2));
    });
  }
  // Short shoots along the leader fill the crown, ending in a spray up.
  const top = stem[stem.length - 1]!;
  spray(add(top, [0, -0.25, 0]), normalize([wobble(), 1, wobble()]), LEAF_CARD);
  const shoots = 9;
  for (let index = 0; index < shoots; index++) {
    const heading = start + 1.2 + index * 2.39996;
    const y =
      clearStem + 0.25 + (index / (shoots - 1)) * (height - clearStem - 0.55);
    spray(
      [top[0] * (y / height), y, top[2] * (y / height)],
      normalize([Math.cos(heading), 0.9 + random() * 0.6, Math.sin(heading)]),
      LEAF_CARD * (0.85 + random() * 0.2),
    );
  }
  return { bark, leaves };
}

/** A round timber stake, standing at the origin. */
export function createNurseryStakeGeometry(): TreeMeshData {
  const stake: TreeMeshData = { indices: [], normals: [], positions: [] };
  const { height, radius } = NURSERY_TREE.stake;
  addTube(
    stake,
    [
      [0, 0, 0],
      [0, height, 0],
    ],
    [radius, radius],
    8,
  );
  return stake;
}

type CourseTreeInstance = {
  /** World position of the stem's foot, on its bed's top. */
  position: Vec3;
  scale: number;
  /** World position of the stake's foot: toward its bed's local +X, so a row's stakes line up. */
  stake: Vec3;
  variant: number;
  yaw: number;
};

/**
 * Every tree on the course's planted beds, in rows along each bed's local
 * X, with its stake toward the bed's local +X. Placement repeats exactly for
 * the same document.
 */
export function getCourseTreeInstances(document: CourseDocument) {
  const instances: CourseTreeInstance[] = [];
  document.objects.forEach((object) => {
    if (!object.planting || object.visual.shape !== "box") return;
    const grid = getCoursePlantingGrid(object);
    const { position, rotation } = object.transform;
    const { scale: size } = object.visual;
    const random = createRandom(hashString(object.id));
    const toWorld = (local: { x: number; y: number; z: number }): Vec3 => {
      const offset = rotateCourseDirection(
        local,
        { x: 0, y: 0, z: 0 },
        rotation,
      );
      return [
        position.x + offset.x,
        position.y + offset.y,
        position.z + offset.z,
      ];
    };
    for (let row = 0; row < grid.across; row++) {
      for (let column = 0; column < grid.along; column++) {
        const x = (column - (grid.along - 1) / 2) * object.planting.along;
        const z = (row - (grid.across - 1) / 2) * object.planting.across;
        instances.push({
          position: toWorld({ x, y: size.y / 2, z }),
          scale: 0.93 + random() * 0.15,
          stake: toWorld({
            x: x + NURSERY_TREE.stake.offset,
            y: size.y / 2,
            z,
          }),
          variant: Math.floor(random() * NURSERY_TREE_VARIANTS),
          yaw: random() * 360,
        });
      }
    }
  });
  return instances;
}

function isCourseHedge(object: CourseObject): object is CoursePrimitiveObject {
  return object.visual.material === "hedge" && object.visual.shape === "box";
}

/**
 * Leaf sprays over each hedge's sides and top, in world space: lying close
 * along its faces, the outermost lighter, so the box reads as clipped
 * foliage.
 */
export function createCourseHedgeGeometry(document: CourseDocument) {
  const leaves: TreeMeshData = {
    colors: [],
    indices: [],
    normals: [],
    positions: [],
    uvs: [],
  };
  document.objects.filter(isCourseHedge).forEach((object) => {
    const random = createRandom(hashString(object.id));
    const { position, rotation } = object.transform;
    const size = object.visual.scale;
    const direction = (local: Vec3): Vec3 => {
      const world = rotateCourseDirection(
        { x: local[0], y: local[1], z: local[2] },
        { x: 0, y: 0, z: 0 },
        rotation,
      );
      return [world.x, world.y, world.z];
    };
    const toWorld = (local: Vec3) =>
      add([position.x, position.y, position.z], direction(local));
    const half: Vec3 = [size.x / 2, size.y / 2, size.z / 2];
    // Each face's outward normal and the two axes spanning it, in the order
    // getCourseHedgeSprayCounts counts them.
    const faces: Array<[Vec3, Vec3, Vec3]> = [
      [
        [1, 0, 0],
        [0, 0, 1],
        [0, 1, 0],
      ],
      [
        [-1, 0, 0],
        [0, 0, 1],
        [0, 1, 0],
      ],
      [
        [0, 0, 1],
        [1, 0, 0],
        [0, 1, 0],
      ],
      [
        [0, 0, -1],
        [1, 0, 0],
        [0, 1, 0],
      ],
      [
        [0, 1, 0],
        [1, 0, 0],
        [0, 0, 1],
      ],
    ];
    const extent = (axis: Vec3) =>
      2 * Math.abs(axis[0] * half[0] + axis[1] * half[1] + axis[2] * half[2]);
    const counts = getCourseHedgeSprayCounts(size);
    faces.forEach(([normal, u, v], face) => {
      const outward = normalize(direction(normal));
      for (let index = 0; index < counts[face]!; index++) {
        const cardSize = LEAF_CARD * (0.8 + random() * 0.3);
        // Sprays lie mostly along the face, rolled any way, tilted out a little.
        const roll = random() * Math.PI * 2;
        // Each stays within the face, so none hang past its edges.
        const reach =
          ((Math.abs(Math.cos(roll)) + Math.abs(Math.sin(roll))) * cardSize) /
          2;
        const spread = (axis: Vec3) =>
          (random() - 0.5) * Math.max(0, extent(axis) - 2 * reach);
        const depth = random();
        const local = add(
          add(
            [normal[0] * half[0], normal[1] * half[1], normal[2] * half[2]],
            add(scale(u, spread(u)), scale(v, spread(v))),
          ),
          scale(normal, -0.06 + depth * 0.1),
        );
        const along = normalize(
          add(
            add(
              scale(direction(u), Math.cos(roll)),
              scale(direction(v), Math.sin(roll)),
            ),
            scale(outward, 0.05 + random() * 0.2),
          ),
        );
        const across = normalize(cross(outward, along));
        const foot = add(toWorld(local), scale(along, -cardSize / 2));
        addLeafCard(
          leaves,
          foot,
          along,
          across,
          cardSize,
          Math.floor(random() * 4),
          () => ({ normal: outward, occlusion: 0.7 + 0.3 * depth }),
        );
      }
    });
  });
  return leaves;
}

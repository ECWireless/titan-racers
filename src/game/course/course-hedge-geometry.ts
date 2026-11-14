// Clipped hedges, built at real size in metres. A hedge is a row of privet
// (Ligustrum ovalifolium, 3–6 cm leaves) cut by hand: its faces lean in
// toward a narrower top, its shoulders are round, and its faces and top
// wander a few centimetres along its length. Its leaves are boughs
// (leaf-boughs-colour.jpg) set through the outer 20 cm, over a dark core
// that stands for the shaded twigs inside, and they stop a ragged few
// centimetres above the ground. Everything here is plain geometry;
// course-trees.ts draws the boughs and the course draws the core.
import { type CourseMeshGeometry, createCourseMeshBuilder } from "./course-bevel";
import {
  type CourseDocument,
  type CourseObject,
  type CoursePrimitiveObject,
  getCourseHedgeSprayCounts,
  rotateCourseDirection,
} from "./course-document";
import {
  add,
  addLeafCard,
  cross,
  hashString,
  normalize,
  scale,
  type TreeMeshData,
} from "./course-tree-geometry";

type Vec3 = [number, number, number];
type Size = { x: number; y: number; z: number };

/** A bough carries the leaves of this many of the hedge's counted sprays. */
export const HEDGE_SPRAYS_PER_BOUGH = 2;
// Privet's dark, slightly glossy green, multiplying the scanned leaves'.
const HEDGE_TINT: Vec3 = [0.72, 0.9, 0.52];
/** How far a bough's corner may stand out of the clipped face, in metres. */
const HEDGE_SHOOT = 0.06;

/** Boughs set between one look at the clock and the next. */
const HEDGE_BOUGHS_PER_STEP = 64;

let courseHedges:
  | {
      /** The rest of the build, or null once every bough is set. */
      build: Generator<void, void> | null;
      key: string;
      leaves: TreeMeshData;
    }
  | undefined;

export function isCourseHedge(
  object: CourseObject,
): object is CoursePrimitiveObject {
  return object.visual.material === "hedge" && object.visual.shape === "box";
}

/**
 * A hedge's form inside its box: how far each face leans in by the top,
 * the radius of its shoulders and ends, how far its faces wander, how far
 * back its core sits, and how large its boughs are beside a full-size
 * hedge's. A hedge too low or thin for the full form gets a smaller one.
 */
function getHedgeForm(size: Size) {
  const thin = Math.min(size.x, size.z);
  const small = Math.min(thin, size.y);
  const core = Math.min(0.2, thin / 6);
  return {
    boughs: Math.min(1, thin / 0.8, size.y / 1),
    core: { side: core, shoulder: core * 1.3, top: Math.min(0.26, size.y * 0.2) },
    lean: Math.min(0.15, thin * 0.125),
    relief: Math.min(1, small / 1.2),
    round: Math.min(0.3, small * 0.25),
  };
}

// Smooth noise over a plane, 0 to 1, the same for a seed every time.
function createNoise(seed: number) {
  const corner = (x: number, y: number) => {
    let hash = Math.imul(x, 374761393) ^ Math.imul(y, 668265263) ^ seed;
    hash = Math.imul(hash ^ (hash >>> 13), 1274126177);
    return ((hash ^ (hash >>> 16)) >>> 0) / 4294967296;
  };
  return (x: number, y: number) => {
    const x0 = Math.floor(x);
    const y0 = Math.floor(y);
    const fx = x - x0;
    const fy = y - y0;
    const sx = fx * fx * (3 - 2 * fx);
    const sy = fy * fy * (3 - 2 * fy);
    const a = corner(x0, y0);
    const b = corner(x0 + 1, y0);
    const c = corner(x0, y0 + 1);
    const d = corner(x0 + 1, y0 + 1);
    return a + (b - a) * sx + (c - a) * sy + (a - b - c + d) * sx * sy;
  };
}

function createRandom(seed: number) {
  let state = seed >>> 0 || 1;
  return () => {
    state = (Math.imul(state, 1664525) + 1013904223) >>> 0;
    return state / 4294967296;
  };
}

const smooth = (from: number, to: number, value: number) => {
  const t = Math.min(1, Math.max(0, (value - from) / (to - from)));
  return t * t * (3 - 2 * t);
};

/**
 * The clipped surface of a hedge about its box's centre: how far a point
 * is outside it (negative inside), and which way is out from there.
 */
function createHedgeSurface(size: Size, seed: number) {
  const half: Vec3 = [size.x / 2, size.y / 2, size.z / 2];
  const { lean, relief, round } = getHedgeForm(size);
  const noise = createNoise(seed);
  const long = size.x >= size.z ? 0 : 2;
  const across = 2 - long;
  /** Lighter and darker stretches, a few metres long. */
  const patch = (point: Vec3) =>
    noise(point[long] * 0.27 + 91.7, point[1] * 0.45 + (point[across] < 0 ? 7.3 : 0));
  /**
   * How far the face and the top sit back from the box about a point, and
   * how far above the ground the leaves stop there.
   */
  const reliefAt = (point: Vec3) => {
    const along = point[long];
    const side = point[across] < 0 ? 17.3 : 0;
    return {
      // The face wanders, and swells a little at each plant, 0.8 m apart.
      face:
        relief *
        (0.01 +
          0.06 * noise(along * 0.45 + side, point[1] * 0.8) +
          0.012 * (1 - Math.cos(along * 7.854 + side))),
      skirt: relief * (0.02 + 0.1 * noise(along * 1.3 + side, 77.7)),
      top: relief * (0.01 + 0.06 * noise(along * 0.33, 41.5)),
    };
  };
  // Written by each measure, and read before the next.
  const normal: Vec3 = [0, 1, 0];
  /** The distance, with `normal` left pointing out from the point. */
  const measure = (point: Vec3, { face, top }: { face: number; top: number }) => {
    const height = Math.min(1, Math.max(0, (point[1] + half[1]) / size.y));
    const back = lean * height + face + round;
    const qx = Math.abs(point[0]) - (half[0] - back);
    const qy = point[1] - (half[1] - top - round);
    const qz = Math.abs(point[2]) - (half[2] - back);
    const ox = Math.max(qx, 0);
    const oy = Math.max(qy, 0);
    const oz = Math.max(qz, 0);
    const length = Math.sqrt(ox * ox + oy * oy + oz * oz);
    const deepest = Math.max(qx, qy, qz);
    const sx = point[0] < 0 ? -1 : 1;
    const sz = point[2] < 0 ? -1 : 1;
    if (length > 1e-6) {
      normal[0] = (sx * ox) / length;
      normal[1] = oy / length;
      normal[2] = (sz * oz) / length;
    } else {
      normal[0] = qx === deepest && qy !== deepest ? sx : 0;
      normal[1] = qy === deepest ? 1 : 0;
      normal[2] = qz === deepest && qy !== deepest && qx !== deepest ? sz : 0;
    }
    return length + Math.min(deepest, 0) - round;
  };
  return { half, measure, normal, patch, reliefAt };
}

/**
 * A hedge's dark core, for the unit box its entity scales by `size`: its
 * four leaning sides, its top, and its foot, set back behind the boughs.
 * It casts the hedge's shadow.
 */
export function createCourseHedgeCoreGeometry(size: Size): CourseMeshGeometry {
  const { core, lean } = getHedgeForm(size);
  const { geometry, polygon } = createCourseMeshBuilder(size);
  const low = -size.y / 2;
  const high = size.y / 2 - core.top;
  const foot: [number, number] = [size.x / 2 - core.side, size.z / 2 - core.side];
  const head: [number, number] = [
    size.x / 2 - lean - core.shoulder,
    size.z / 2 - lean - core.shoulder,
  ];
  const corner = (x: number, z: number, top: boolean): Vec3 =>
    top ? [x * head[0], high, z * head[1]] : [x * foot[0], low, z * foot[1]];
  const rise = high - low;
  for (const sign of [-1, 1]) {
    polygon(
      [corner(sign, -1, false), corner(sign, 1, false), corner(sign, 1, true), corner(sign, -1, true)],
      normalize([sign * rise, foot[0] - head[0], 0]),
    );
    polygon(
      [corner(-1, sign, false), corner(1, sign, false), corner(1, sign, true), corner(-1, sign, true)],
      normalize([0, foot[1] - head[1], sign * rise]),
    );
  }
  polygon(
    [corner(-1, -1, true), corner(1, -1, true), corner(1, 1, true), corner(-1, 1, true)],
    [0, 1, 0],
  );
  // Its foot shows when a hedge is tilted or stands over an edge.
  polygon(
    [corner(-1, -1, false), corner(1, -1, false), corner(1, 1, false), corner(-1, 1, false)],
    [0, -1, 0],
  );
  return geometry;
}

/**
 * Every hedge's boughs, in world space: most lying over its clipped faces
 * and top like shingles, at every depth of the outer 20 cm, and some
 * reaching out of them as the shoots grown since its last cut. Built once
 * per page for the last hedges asked for, at once if they are not yet
 * whole; callers read it and never change it.
 */
export function createCourseHedgeGeometry(document: CourseDocument) {
  return growCourseHedgeGeometry(document, Infinity)!;
}

/**
 * Builds more of a course's hedge boughs, for up to `budgetMs`, and
 * returns them once every bough is set: null until then. A race grows
 * them this way behind its loading screen, and home's warm-up before it.
 * Only the last hedges asked for keep their progress.
 */
export function growCourseHedgeGeometry(
  document: CourseDocument,
  budgetMs: number,
) {
  const hedges = document.objects.filter(isCourseHedge);
  const key = JSON.stringify(hedges);
  if (courseHedges?.key !== key) {
    const leaves: TreeMeshData = {
      colors: [],
      indices: [],
      normals: [],
      positions: [],
      uvs: [],
    };
    courseHedges = { build: buildCourseHedgeGeometry(hedges, leaves), key, leaves };
  }
  const { build } = courseHedges;
  if (build) {
    const until = performance.now() + budgetMs;
    while (!build.next().done) {
      if (performance.now() >= until) return null;
    }
    courseHedges.build = null;
  }
  return courseHedges.leaves;
}

// Pauses every few boughs; `leaves` is whole only once it returns.
function* buildCourseHedgeGeometry(
  hedges: CoursePrimitiveObject[],
  leaves: TreeMeshData,
) {
  let set = 0;
  for (const object of hedges) {
    const seed = hashString(object.id);
    const random = createRandom(seed);
    const size = object.visual.scale;
    const { half, measure, normal, patch, reliefAt } = createHedgeSurface(size, seed);
    const { boughs: fit } = getHedgeForm(size);
    const shootReach = HEDGE_SHOOT * fit;
    // Each face's outward normal and the two axes spanning it, in the order
    // getCourseHedgeSprayCounts counts them.
    const faces: Array<[Vec3, Vec3, Vec3]> = [
      [[1, 0, 0], [0, 0, 1], [0, 1, 0]],
      [[-1, 0, 0], [0, 0, 1], [0, 1, 0]],
      [[0, 0, 1], [1, 0, 0], [0, 1, 0]],
      [[0, 0, -1], [1, 0, 0], [0, 1, 0]],
      [[0, 1, 0], [1, 0, 0], [0, 0, 1]],
    ];
    const first = leaves.positions.length;
    const counts = getCourseHedgeSprayCounts(size);
    for (const [face, [facing, u, v]] of faces.entries()) {
      const extent = (axis: Vec3) =>
        2 * (axis[0] * half[0] + axis[1] * half[1] + axis[2] * half[2]);
      const boughs = Math.round(counts[face]! / HEDGE_SPRAYS_PER_BOUGH);
      for (let index = 0; index < boughs; index++) {
        // A place on the box's face, brought in to the clipped surface.
        let at = add(
          [facing[0] * half[0], facing[1] * half[1], facing[2] * half[2]],
          add(
            scale(u, (random() - 0.5) * extent(u)),
            scale(v, (random() - 0.5) * extent(v)),
          ),
        );
        // The face wanders slowly, so one reading serves the whole bough.
        const relief = reliefAt(at);
        const floor = -half[1] + relief.skirt;
        for (let step = 0; step < 3; step++) {
          at = add(at, scale(normal, -measure(at, relief)));
        }
        measure(at, relief);
        const out: Vec3 = [normal[0], normal[1], normal[2]];
        // A direction along the surface: any way on top, mostly upward on
        // a side, as privet grows.
        const turn = random() * Math.PI * 2;
        const reference: Vec3 = Math.abs(out[1]) > 0.9 ? [1, 0, 0] : [0, 1, 0];
        const right = normalize(cross(reference, out));
        const rise = cross(out, right);
        const along = normalize(
          add(
            add(scale(right, Math.cos(turn)), scale(rise, Math.sin(turn))),
            scale(rise, Math.abs(out[1]) > 0.9 ? 0 : 0.7),
          ),
        );
        const shoot = random() < 0.3;
        let card = fit * (shoot ? 0.3 + 0.2 * random() : 0.5 + 0.3 * random());
        let up: Vec3;
        let foot: Vec3;
        if (shoot) {
          // A shoot, standing out of the face with its tip just past it.
          up = normalize(
            add(add(out, scale(along, 0.3 + 0.5 * random())), [0, 0.35, 0]),
          );
          foot = add(
            add(at, scale(out, shootReach * random())),
            scale(up, -card),
          );
        } else {
          // A shingle, tipped out of the face a little, at any depth.
          up = normalize(add(along, scale(out, 0.1 + 0.3 * random())));
          const depth = fit * (0.02 + 0.16 * random() * random());
          foot = add(add(at, scale(out, -depth)), scale(up, -card / 2));
        }
        const spin = random() * Math.PI * 2;
        const wide = normalize(
          cross(up, add(out, [Math.cos(spin) * 0.4, 0, Math.sin(spin) * 0.4])),
        );
        // Keep the whole card within the clipped face and above its skirt:
        // move it by its corner furthest out, and make it smaller if it
        // still does not fit.
        for (let attempt = 0; attempt < 24; attempt++) {
          let worst = 1e-4;
          let shift: Vec3 | undefined;
          for (let corner = 0; corner < 4; corner++) {
            const end = card * (corner >> 1);
            const side = (corner % 2 ? card : -card) / 2;
            const point: Vec3 = [
              foot[0] + up[0] * end + wide[0] * side,
              foot[1] + up[1] * end + wide[1] * side,
              foot[2] + up[2] * end + wide[2] * side,
            ];
            const over = measure(point, relief) - shootReach;
            if (over > worst) {
              worst = over;
              shift = scale(normal, -worst);
            }
            if (floor - point[1] > worst) {
              worst = floor - point[1];
              shift = [0, worst, 0];
            }
          }
          if (!shift) break;
          foot = add(foot, shift);
          if (attempt % 3 === 2) card *= 0.8;
        }
        const flat = normalize(cross(wide, up));
        const front = scale(
          flat,
          flat[0] * out[0] + flat[1] * out[1] + flat[2] * out[2] < 0 ? -1 : 1,
        );
        const vary = 0.9 + 0.2 * random();
        const hue: Vec3 = [0.94 + 0.12 * random(), 1, 0.9 + 0.2 * random()];
        addLeafCard(
          leaves,
          foot,
          up,
          wide,
          card,
          Math.floor(random() * 4),
          (point) => {
            const distance = measure(point, relief);
            // Light reaches the face, less so its foot, and little inside.
            const shade =
              (0.36 + 0.64 * smooth(-0.2 * fit, 0.02, distance)) *
              (0.78 + 0.22 * smooth(0, 1.6, point[1] + half[1])) *
              (0.86 + 0.24 * patch(point)) *
              vary;
            return {
              normal: normalize(
                add(add(scale(normal, 0.65), scale(front, 0.35)), [0, 0.15, 0]),
              ),
              occlusion: HEDGE_TINT.map(
                (value, axis) => value * hue[axis]! * shade,
              ) as Vec3,
            };
          },
        );
        if (++set % HEDGE_BOUGHS_PER_STEP === 0) yield;
      }
    }
    // From the hedge's own frame, about its box's centre, to the world.
    const { position, rotation } = object.transform;
    const turned = (local: Vec3): Vec3 => {
      const world = rotateCourseDirection(
        { x: local[0], y: local[1], z: local[2] },
        { x: 0, y: 0, z: 0 },
        rotation,
      );
      return [world.x, world.y, world.z];
    };
    // The box's axes in the world: a point or normal is a sum of them.
    const axes = [turned([1, 0, 0]), turned([0, 1, 0]), turned([0, 0, 1])];
    const origin = [position.x, position.y, position.z];
    for (const [values, offset] of [
      [leaves.positions, origin],
      [leaves.normals, [0, 0, 0]],
    ] as const) {
      for (let index = first; index < values.length; index += 3) {
        const x = values[index]!;
        const y = values[index + 1]!;
        const z = values[index + 2]!;
        for (let axis = 0; axis < 3; axis++) {
          values[index + axis] =
            x * axes[0]![axis]! + y * axes[1]![axis]! + z * axes[2]![axis]! + offset[axis]!;
        }
      }
    }
  }
}

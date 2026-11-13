import { expect, test } from "@playwright/test";

import { createCourseArcGeometry } from "../src/game/course/course-arc";
import {
  COURSE_PARK_SIZES,
  FALLS_VIEW_PARK_DOCUMENT,
  rotateByEulerAngles,
  type CourseObject,
} from "../src/game/course/course-document";
import { getCourseParkGeometry } from "../src/game/course/course-park";
import {
  buildParkBench,
  buildParkBin,
  buildParkFlowerBed,
  buildParkOrnamentalTree,
  buildParkShadeTree,
  buildParkShrub,
  PARK_FINISHES,
  type ParkGeometry,
} from "../src/game/course/course-park-geometry";

const BED = { x: 2.4, y: 0.7, z: 1.1 };
const SEEDS = Array.from({ length: 24 }, (_, index) => index + 1);
const builders = {
  bench: () => buildParkBench(),
  bin: () => buildParkBin(),
  "shade-tree": buildParkShadeTree,
  "ornamental-tree": buildParkOrnamentalTree,
  shrub: buildParkShrub,
  "flower-bed": (seed: number) => buildParkFlowerBed(BED, seed),
};
// The kit's budget: see PR 6.11 in the implementation plan.
const PIECE_TRIANGLES = 1500;
const PARK_TRIANGLES = 60_000;
const PARK_DRAWS = 8;
const PARK_BODIES = 150;

const triangles = (piece: Pick<ParkGeometry, "meshes">) =>
  Object.values(piece.meshes).reduce(
    (sum, mesh) => sum + mesh.indices.length / 3,
    0,
  );

test("each park piece is built at its real size, inside its box, and the same every time", () => {
  const cases = Object.entries(builders).flatMap(([kind, build]) =>
    SEEDS.map((seed) => ({ build, kind, seed })),
  );
  for (const { build, kind, seed } of cases) {
    const piece = build(seed);
    expect(build(seed), kind).toEqual(piece);
    expect(triangles(piece), kind).toBeLessThanOrEqual(PIECE_TRIANGLES);
    const size =
      kind === "flower-bed"
        ? BED
        : COURSE_PARK_SIZES[kind as keyof typeof COURSE_PARK_SIZES];
    for (const [finish, mesh] of Object.entries(piece.meshes)) {
      const corners = mesh.positions.length / 3;
      expect(mesh.normals.length / 3, kind).toBe(corners);
      expect(mesh.colors!.length / 4, kind).toBe(corners);
      expect(mesh.uvs!.length / 2, kind).toBe(corners);
      expect(
        [...mesh.positions, ...mesh.normals, ...mesh.colors!].every(Number.isFinite),
        `${kind} ${finish}`,
      ).toBe(true);
      const reach = [0, 0, 0];
      let lowest = 0;
      for (let i = 0; i < mesh.positions.length; i++) {
        reach[i % 3] = Math.max(reach[i % 3]!, Math.abs(mesh.positions[i]!));
        if (i % 3 === 1) lowest = Math.min(lowest, mesh.positions[i]!);
      }
      expect(reach[0], kind).toBeLessThanOrEqual(size.x / 2 + 1e-3);
      expect(reach[1], kind).toBeLessThanOrEqual(size.y + 1e-3);
      expect(reach[2], kind).toBeLessThanOrEqual(size.z / 2 + 1e-3);
      expect(lowest, kind).toBeGreaterThanOrEqual(-1e-3);
      // Boughs and sprays are sheets shaded by their crown; every other
      // triangle faces the way its normals say.
      if (finish === "boughs" || finish === "leaves") continue;
      let leastFacing = Infinity;
      for (let i = 0; i < mesh.indices.length; i += 3) {
        const [a, b, c] = mesh.indices
          .slice(i, i + 3)
          .map((index) => mesh.positions.slice(index * 3, index * 3 + 3));
        const ab = b!.map((value, axis) => value - a![axis]!);
        const ac = c!.map((value, axis) => value - a![axis]!);
        const facing = [
          ab[1]! * ac[2]! - ab[2]! * ac[1]!,
          ab[2]! * ac[0]! - ab[0]! * ac[2]!,
          ab[0]! * ac[1]! - ab[1]! * ac[0]!,
        ];
        const normal = mesh.normals.slice(
          mesh.indices[i]! * 3,
          mesh.indices[i]! * 3 + 3,
        );
        leastFacing = Math.min(
          leastFacing,
          facing.reduce((sum, value, axis) => sum + value * normal[axis]!, 0),
        );
      }
      expect(leastFacing, `${kind} ${finish}`).toBeGreaterThan(0);
    }
    expect(piece.colliders.length, kind).toBeGreaterThan(0);
    for (const box of piece.colliders) {
      expect(box.center[1] - box.halfExtents[1], kind).toBeGreaterThanOrEqual(-1e-9);
      expect(box.center[1] + box.halfExtents[1], kind).toBeLessThanOrEqual(size.y + 1e-9);
      expect(Math.abs(box.center[0]) + box.halfExtents[0], kind).toBeLessThanOrEqual(size.x / 2 + 1e-9);
      expect(Math.abs(box.center[2]) + box.halfExtents[2], kind).toBeLessThanOrEqual(size.z / 2 + 1e-9);
    }
  }
});

test("a kart meets everything it can reach of the furniture, and fits under the bench", () => {
  for (const piece of [buildParkBench(), buildParkBin()]) {
    for (const mesh of Object.values(piece.meshes)) {
      for (let i = 0; i < mesh.positions.length; i += 3) {
        const point = mesh.positions.slice(i, i + 3);
        // Kart bodywork stands under 0.35 m.
        if (point[1]! > 0.35) continue;
        expect(
          piece.colliders.some((box) =>
            point.every(
              (value, axis) =>
                Math.abs(value - box.center[axis]!) <= box.halfExtents[axis]! + 1e-9,
            ),
          ),
        ).toBe(true);
      }
    }
  }
  // The widest kart, 0.42 m, passes between the legs from front to back.
  const lane = { center: [0, 0.175, 0], halfExtents: [0.25, 0.175, 1] };
  for (const box of buildParkBench().colliders) {
    expect(
      [0, 1, 2].every(
        (axis) =>
          Math.abs(box.center[axis]! - lane.center[axis]!) <
          box.halfExtents[axis]! + lane.halfExtents[axis]!,
      ),
    ).toBe(false);
  }
});

test("trees, shrubs, and beds each grow their own way within the triangle cap", () => {
  for (const build of [buildParkShadeTree, buildParkOrnamentalTree, buildParkShrub]) {
    expect(build(1)).not.toEqual(build(2));
  }
  // A crown is boughs and wood alone, with nothing solid inside it.
  for (const build of [buildParkShadeTree, buildParkOrnamentalTree]) {
    const { meshes } = build(3);
    expect(meshes.boughs.indices.length).toBeGreaterThan(meshes.bark.indices.length);
    expect(triangles({ meshes })).toBe(
      (meshes.boughs.indices.length + meshes.bark.indices.length) / 3,
    );
  }
  expect(buildParkFlowerBed(BED, 1)).not.toEqual(buildParkFlowerBed(BED, 2));
  // Every size a bed may be, in 5 cm steps.
  let most = 0;
  for (let x = 1.2; x < 3.001; x += 0.05) {
    for (let z = 0.8; z < 1.501; z += 0.05) {
      most = Math.max(most, triangles(buildParkFlowerBed({ x, z }, 1)));
    }
  }
  expect(most).toBeLessThanOrEqual(PIECE_TRIANGLES);
});

test("Falls View Park's kit stays inside its budget, and only a tree's trunk collides", () => {
  const geometry = getCourseParkGeometry(FALLS_VIEW_PARK_DOCUMENT);
  expect(getCourseParkGeometry(FALLS_VIEW_PARK_DOCUMENT)).toBe(geometry);
  // One draw per finish.
  expect(PARK_FINISHES.length).toBeLessThanOrEqual(PARK_DRAWS);
  expect(triangles(geometry)).toBeLessThanOrEqual(PARK_TRIANGLES);
  expect(geometry.colliders.length).toBeLessThanOrEqual(PARK_BODIES);
  for (const object of FALLS_VIEW_PARK_DOCUMENT.objects) {
    if (!object.park) continue;
    const boxes = geometry.colliders.filter((box) => box.id === object.id);
    expect(boxes.length, object.id).toBeGreaterThan(0);
    const tree = object.park.endsWith("tree");
    expect(boxes.every((box) => box.tree === tree), object.id).toBe(true);
    if (tree) {
      expect(boxes, object.id).toHaveLength(1);
      expect(boxes[0]!.halfExtents[0], object.id).toBeLessThan(0.5);
    }
  }
  // A piece kept for collision tests is neither drawn nor solid in a race.
  const fixture = structuredClone(
    FALLS_VIEW_PARK_DOCUMENT.objects.find((object) => object.park === "bench")!,
  );
  fixture.availability = "collision-test";
  const hidden = getCourseParkGeometry({
    ...FALLS_VIEW_PARK_DOCUMENT,
    objects: [fixture],
  });
  expect(hidden.colliders).toHaveLength(0);
  expect(triangles(hidden)).toBe(0);
});

// An object's outline on the ground, and the gap between two outlines.
type Point = [number, number];
function hull(points: Point[]) {
  points.sort((a, b) => a[0] - b[0] || a[1] - b[1]);
  const turn = (a: Point, b: Point, c: Point) =>
    (b[0] - a[0]) * (c[1] - a[1]) - (b[1] - a[1]) * (c[0] - a[0]);
  const half = (list: Point[]) => {
    const out: Point[] = [];
    for (const point of list) {
      while (out.length > 1 && turn(out.at(-2)!, out.at(-1)!, point) <= 0) {
        out.pop();
      }
      out.push(point);
    }
    out.pop();
    return out;
  };
  return [...half(points), ...half(points.toReversed())];
}
function footprint(object: CourseObject): Point[] {
  const { visual, transform } = object;
  const locals: number[][] = [];
  if (visual.shape === "arc") {
    const mesh = createCourseArcGeometry(visual.arc);
    for (let i = 0; i < mesh.positions.length; i += 3) {
      locals.push(mesh.positions.slice(i, i + 3));
    }
  } else {
    for (const x of [-0.5, 0.5]) {
      for (const y of [-0.5, 0.5]) {
        for (const z of [-0.5, 0.5]) {
          locals.push([x * visual.scale.x, y * visual.scale.y, z * visual.scale.z]);
        }
      }
    }
  }
  return hull(
    locals.map(([x, y, z]) => {
      const point = rotateByEulerAngles(transform.rotation, { x: x!, y: y!, z: z! });
      return [point.x + transform.position.x, point.z + transform.position.z];
    }),
  );
}
function gap(a: Point[], b: Point[]) {
  const edges = (polygon: Point[]) =>
    polygon.map((point, index) => [point, polygon[(index + 1) % polygon.length]!] as const);
  const apart = [...edges(a), ...edges(b)].some(([from, to]) => {
    const across: Point = [to[1] - from[1], from[0] - to[0]];
    const along = (polygon: Point[]) =>
      polygon.map((point) => point[0] * across[0] + point[1] * across[1]);
    return (
      Math.max(...along(a)) < Math.min(...along(b)) ||
      Math.max(...along(b)) < Math.min(...along(a))
    );
  });
  if (!apart) return 0;
  const toEdge = (point: Point, [from, to]: readonly [Point, Point]) => {
    const dx = to[0] - from[0];
    const dz = to[1] - from[1];
    const t = Math.max(
      0,
      Math.min(
        1,
        ((point[0] - from[0]) * dx + (point[1] - from[1]) * dz) / (dx * dx + dz * dz),
      ),
    );
    return Math.hypot(point[0] - from[0] - t * dx, point[1] - from[1] - t * dz);
  };
  return Math.min(
    ...a.flatMap((point) => edges(b).map((edge) => toEdge(point, edge))),
    ...b.flatMap((point) => edges(a).map((edge) => toEdge(point, edge))),
  );
}

test("the park's pieces stand on its lawns, 1.5 m clear of the road, the jump, barriers, and lamps", () => {
  const objects = FALLS_VIEW_PARK_DOCUMENT.objects;
  const keepClear = objects
    .filter(
      (object) =>
        !object.park &&
        (object.visual.material === "asphalt" ||
          object.visual.material === "kerb" ||
          object.lamp === "floodlight" ||
          object.lamp === "street" ||
          object.kit === "crowd-barrier" ||
          /^downhill-(kicker|landing)/.test(object.id)),
    )
    .map((object) => ({
      id: object.id,
      // A crowd barrier's feet reach 0.6 m across its panel.
      outline: footprint(
        object.kit === "crowd-barrier" && object.visual.shape === "box"
          ? {
              ...object,
              visual: {
                ...object.visual,
                scale: { x: object.visual.scale.x + 0.038, y: 1.1, z: 0.6 },
              },
            }
          : object,
      ),
    }));
  // The return lane's two lawns, the infield, the lawn beyond the levee,
  // and the bank outside the downhill: [x0, x1, z0, z1].
  const lawns = [
    [-45, 8, -60, -50],
    [-40, 8, -42, -30],
    [-45, 45, -30, 17],
    [-70, 85, 38, 70],
    [-73, -63, -35, 15],
  ];
  const park = objects.filter((object) => object.park);
  expect(park.length).toBeGreaterThan(0);
  const tooClose: string[] = [];
  for (const object of park) {
    const { x, z } = object.transform.position;
    expect(
      lawns.some(([x0, x1, z0, z1]) => x >= x0! && x <= x1! && z >= z0! && z <= z1!),
      object.id,
    ).toBe(true);
    // A tree's box is its crown, so its boughs keep the same distance.
    const outline = footprint(object);
    for (const other of keepClear) {
      const distance = gap(outline, other.outline);
      if (distance < 1.5 - 1e-6) {
        tooClose.push(`${object.id} / ${other.id}: ${distance.toFixed(3)}`);
      }
    }
  }
  expect(tooClose).toEqual([]);
});

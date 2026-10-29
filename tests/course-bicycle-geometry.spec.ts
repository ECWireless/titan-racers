import { expect, test } from "@playwright/test";

import {
  createBicycleGeometry,
  getBicycleRest,
} from "../src/game/course/course-bicycle-geometry";
import {
  COURSE_BICYCLES,
  type CourseBicycle,
  FALLS_VIEW_PARK_DOCUMENT,
} from "../src/game/course/course-document";
import type { TreeMeshData } from "../src/game/course/course-tree-geometry";
import {
  createCourseBicycleGeometry,
  getCourseBicycleColliders,
} from "../src/game/course/course-trees";

const variants = COURSE_BICYCLES;
const meshes = (variant: CourseBicycle) => {
  const { dielectric, metal } = createBicycleGeometry(variant);
  return [dielectric, metal];
};
const heights = (mesh: TreeMeshData) =>
  mesh.positions.filter((_, index) => index % 3 === 1);
const extent = (variant: CourseBicycle, axis: number) => {
  const values = meshes(variant).flatMap((mesh) =>
    mesh.positions.filter((_, index) => index % 3 === axis),
  );
  return Math.max(...values) - Math.min(...values);
};

test("builds each bicycle within its budget", () => {
  for (const variant of variants) {
    // Two draws a bike, at most 6,000 triangles between them.
    const [dielectric, metal] = meshes(variant);
    expect(dielectric!.indices.length).toBeGreaterThan(0);
    expect(metal!.indices.length).toBeGreaterThan(0);
    expect(
      (dielectric!.indices.length + metal!.indices.length) / 3,
    ).toBeLessThanOrEqual(6000);
  }
});

test("gives every triangle valid corners, unit normals, and outward winding", () => {
  for (const variant of variants) {
    for (const mesh of meshes(variant)) {
      const count = mesh.positions.length / 3;
      expect(mesh.normals).toHaveLength(mesh.positions.length);
      expect(mesh.colors).toHaveLength(count * 4);
      // Colours stay within real reflectance.
      expect(mesh.colors!.every((value) => value >= 0 && value <= 1)).toBe(
        true,
      );
      const vertex = (index: number, data: number[]) =>
        data.slice(index * 3, index * 3 + 3);
      const lengths = Array.from({ length: count }, (_, index) =>
        Math.hypot(...vertex(index, mesh.normals)),
      );
      expect(lengths.every((length) => Math.abs(length - 1) < 1e-6)).toBe(true);
      expect(
        mesh.indices.every(
          (corner) => Number.isInteger(corner) && corner >= 0 && corner < count,
        ),
      ).toBe(true);
      // Each triangle winds the way its normals point, and none is empty.
      const cosines: number[] = [];
      let smallest = Infinity;
      for (let index = 0; index < mesh.indices.length; index += 3) {
        const corners = [0, 1, 2].map((k) => mesh.indices[index + k]!);
        const [a, b, c] = corners.map((k) => vertex(k, mesh.positions));
        const normal = corners
          .map((k) => vertex(k, mesh.normals))
          .reduce((sum, n) => sum.map((value, axis) => value + n[axis]!));
        const ab = b!.map((value, axis) => value - a![axis]!);
        const ac = c!.map((value, axis) => value - a![axis]!);
        const face = [
          ab[1]! * ac[2]! - ab[2]! * ac[1]!,
          ab[2]! * ac[0]! - ab[0]! * ac[2]!,
          ab[0]! * ac[1]! - ab[1]! * ac[0]!,
        ];
        smallest = Math.min(smallest, Math.hypot(...face));
        cosines.push(
          face.reduce((sum, value, axis) => sum + value * normal[axis]!, 0) /
            (Math.hypot(...face) * Math.hypot(...normal)),
        );
      }
      expect(smallest).toBeGreaterThan(1e-10);
      expect(Math.min(...cosines)).toBeGreaterThan(0.5);
    }
  }
});

test("stands each bicycle on both tyres, leaning left onto its prop", () => {
  for (const variant of variants) {
    const positions = meshes(variant).flatMap((mesh) => mesh.positions);
    const lowest = Math.min(...meshes(variant).flatMap(heights));
    expect(Math.abs(lowest)).toBeLessThan(0.002);
    const { centreOfMass, supports } = getBicycleRest(variant);
    expect(supports.map(({ name }) => name)).toEqual([
      "rear tyre",
      "front tyre",
    ]);
    // Both tyres touch, at real vertices of the bike.
    for (const { point } of supports) {
      expect(point[1]).toBeLessThan(0.002);
      const found = positions.some(
        (_, index) =>
          index % 3 === 0 &&
          Math.hypot(
            positions[index]! - point[0],
            positions[index + 1]! - point[1],
            positions[index + 2]! - point[2],
          ) < 1e-9,
      );
      expect(found).toBe(true);
    }
    // Nothing but the tyres reaches the ground.
    const [rear, front] = supports.map(({ point }) => point);
    for (let index = 0; index < positions.length; index += 3) {
      if (positions[index + 1]! >= 0.01) continue;
      const near = [rear!, front!].some(
        (point) =>
          Math.hypot(
            positions[index]! - point[0],
            positions[index + 2]! - point[2],
          ) < 0.06,
      );
      expect(near, `${variant} vertex ${index / 3}`).toBe(true);
    }
    // Its centre of mass lies left of its tyres' line, so it leans on what
    // the course stands it against: the hardtail 10 cm, the BMX 21 cm.
    const [dx, dz] = [front![0] - rear![0], front![2] - rear![2]];
    const left =
      (dz * (centreOfMass[0] - rear![0]) - dx * (centreOfMass[2] - rear![2])) /
      Math.hypot(dx, dz);
    expect(left).toBeGreaterThan(variant === "hardtail" ? 0.08 : 0.18);
  }
});

test("builds both bicycles at real size", () => {
  // The hardtail: 27.5" wheels on a 1.06 m wheelbase, its bars and saddle
  // near a metre up, the bars 720 mm wide.
  expect(extent("hardtail", 0)).toBeGreaterThan(1.6);
  expect(extent("hardtail", 0)).toBeLessThan(1.85);
  expect(extent("hardtail", 1)).toBeGreaterThan(0.95);
  expect(extent("hardtail", 1)).toBeLessThan(1.15);
  expect(extent("hardtail", 2)).toBeGreaterThan(0.6);
  expect(extent("hardtail", 2)).toBeLessThan(0.8);
  // The BMX: 20" wheels on a 0.86 m wheelbase, laid over, so its bars,
  // turned into the lean, reach 0.9 m across and its right grip about a
  // metre up.
  expect(extent("bmx", 0)).toBeGreaterThan(1.2);
  expect(extent("bmx", 0)).toBeLessThan(1.45);
  expect(extent("bmx", 1)).toBeGreaterThan(0.9);
  expect(extent("bmx", 1)).toBeLessThan(1.1);
  expect(extent("bmx", 2)).toBeGreaterThan(0.8);
  expect(extent("bmx", 2)).toBeLessThan(1);
  // Tyre contacts a wheelbase apart, give or take the turned front wheel.
  for (const [variant, wheelbase] of [
    ["hardtail", 1.06],
    ["bmx", 0.86],
  ] as const) {
    const [rear, front] = getBicycleRest(variant).supports.map(
      ({ point }) => point,
    );
    expect(
      Math.abs(
        Math.hypot(front![0] - rear![0], front![2] - rear![2]) - wheelbase,
      ),
    ).toBeLessThan(0.1);
  }
});

test("draws each parked bicycle centred in its box, on its floor", () => {
  const parked = FALLS_VIEW_PARK_DOCUMENT.objects.filter(
    ({ bicycle }) => bicycle,
  );
  expect(parked).toHaveLength(2);
  // And one turned partway, so the direction of its turn counts.
  const turned = structuredClone(parked[0]!);
  turned.transform.rotation.y = 37;
  for (const object of [...parked, turned]) {
    if (object.visual.shape !== "box") throw new Error("A bicycle is a box");
    const { coat, metal } = createCourseBicycleGeometry({
      ...FALLS_VIEW_PARK_DOCUMENT,
      objects: [object],
    });
    // Into the box's frame: undo its position and its turn about +Y.
    const { position, rotation } = object.transform;
    const yaw = (rotation.y * Math.PI) / 180;
    const local = [coat, metal].flatMap(({ positions }) =>
      Array.from({ length: positions.length / 3 }, (_, index) => {
        const x = positions[index * 3]! - position.x;
        const z = positions[index * 3 + 2]! - position.z;
        return [
          x * Math.cos(yaw) - z * Math.sin(yaw),
          positions[index * 3 + 1]! - position.y,
          x * Math.sin(yaw) + z * Math.cos(yaw),
        ];
      }),
    );
    const { scale } = object.visual;
    for (const [axis, size] of [scale.x, scale.y, scale.z].entries()) {
      const values = local.map((point) => point[axis]!);
      const [low, high] = [Math.min(...values), Math.max(...values)];
      // Within 5 mm of filling the box, and centred in it across the
      // ground; standing on its floor.
      expect(high - low, `${object.id} axis ${axis}`).toBeGreaterThan(
        size - 0.01,
      );
      expect(high - low, `${object.id} axis ${axis}`).toBeLessThanOrEqual(size);
      if (axis === 1) expect(low).toBeCloseTo(-size / 2, 4);
      else expect(Math.abs(low + high)).toBeLessThan(1e-6);
    }
  }
});

test("collides with every part of a bicycle a kart can reach", () => {
  for (const object of FALLS_VIEW_PARK_DOCUMENT.objects.filter(
    ({ bicycle }) => bicycle,
  )) {
    const document = { ...FALLS_VIEW_PARK_DOCUMENT, objects: [object] };
    const colliders = getCourseBicycleColliders(document);
    // A box for each occupied cell of a 3 x 3 grid over its footprint.
    expect(colliders.length).toBeGreaterThan(3);
    expect(colliders.length).toBeLessThanOrEqual(9);
    const { coat, metal } = createCourseBicycleGeometry(document);
    const floor =
      object.transform.position.y -
      (object.visual.shape === "box" ? object.visual.scale.y / 2 : 0);
    for (const { positions } of [coat, metal]) {
      for (let index = 0; index < positions.length; index += 3) {
        const [x, y, z] = positions.slice(index, index + 3) as [
          number,
          number,
          number,
        ];
        if (y - floor >= 0.35) continue;
        // Inside at least one collider, in its own turned frame.
        const inside = colliders.some(({ halfExtents, position, yaw }) => {
          const turn = (yaw * Math.PI) / 180;
          const [dx, dy, dz] = [
            x - position[0],
            y - position[1],
            z - position[2],
          ];
          const local = [
            dx * Math.cos(turn) - dz * Math.sin(turn),
            dy,
            dx * Math.sin(turn) + dz * Math.cos(turn),
          ];
          return local.every(
            (value, axis) => Math.abs(value) <= halfExtents[axis]! + 0.001,
          );
        });
        expect(inside, `${object.id} vertex ${index / 3}`).toBe(true);
      }
    }
  }
});

test("leans the hardtail on the crest's handrail and the BMX on its wall", () => {
  const objects = FALLS_VIEW_PARK_DOCUMENT.objects;
  const byId = (id: string) => objects.find((object) => object.id === id)!;
  const deckTop = (() => {
    const { transform, visual } = byId("levee-crest-5");
    return (
      transform.position.y + (visual.shape === "box" ? visual.scale.y / 2 : 0)
    );
  })();
  // What the crest builds beside its lane, each a signed distance from a
  // point: the kerb and wall are level boxes, the rails run along X, the
  // posts stand up Y.
  type Point = [number, number, number];
  const props = objects
    .filter(({ id }) => /^levee-crest-(kerb-north|wall-l|rail-|post-)/.test(id))
    .map(({ id, transform: { position: c }, visual }) => {
      if (visual.shape === "box") {
        const half = [
          visual.scale.x / 2,
          visual.scale.y / 2,
          visual.scale.z / 2,
        ];
        return {
          distance: ([x, y, z]: Point) => {
            const q = [x - c.x, y - c.y, z - c.z].map(
              (value, axis) => Math.abs(value) - half[axis]!,
            );
            const outside = Math.hypot(...q.map((value) => Math.max(value, 0)));
            return outside + Math.min(Math.max(...q), 0);
          },
          id,
        };
      }
      if (visual.shape === "arc") throw new Error("The crest has no arcs");
      const radius = visual.scale.x / 2;
      const along = id.includes("rail") ? 0 : 1;
      const length = visual.scale.y / 2;
      return {
        distance: ([x, y, z]: Point) => {
          const offset = [x - c.x, y - c.y, z - c.z];
          if (Math.abs(offset[along]!) > length) return Infinity;
          offset[along] = 0;
          return Math.hypot(...offset) - radius;
        },
        id,
      };
    });
  for (const [bicycle, touches] of [
    ["hardtail", [/rail-mid/, /post-/]],
    ["bmx", [/wall-l/]],
  ] as const) {
    const object = objects.find((candidate) => candidate.bicycle === bicycle)!;
    const { coat, metal } = createCourseBicycleGeometry({
      ...FALLS_VIEW_PARK_DOCUMENT,
      objects: [object],
    });
    // Points every 5 mm along each triangle's edges, so a thin rail cannot
    // pass between a long tube's corners.
    const points: Point[] = [];
    for (const { indices, positions } of [coat, metal]) {
      const corner = (k: number): Point => [
        positions[k * 3]!,
        positions[k * 3 + 1]!,
        positions[k * 3 + 2]!,
      ];
      for (let index = 0; index < indices.length; index += 3) {
        for (let edge = 0; edge < 3; edge++) {
          const a = corner(indices[index + edge]!);
          const b = corner(indices[index + ((edge + 1) % 3)]!);
          const steps = Math.ceil(
            Math.hypot(...a.map((v, k) => b[k]! - v)) / 0.005,
          );
          for (let step = 0; step < steps; step++) {
            points.push(
              a.map((v, k) => v + ((b[k]! - v) * step) / steps) as Point,
            );
          }
        }
      }
    }
    const { x, y, z } = object.transform.position;
    const nearby = props.filter(({ distance }) => distance([x, y, z]) < 2);
    const closest = new Map<string, number>();
    let lowest = Infinity;
    for (const point of points) {
      lowest = Math.min(lowest, point[1]);
      for (const { distance, id } of nearby) {
        const gap = distance(point);
        if (gap < (closest.get(id) ?? Infinity)) closest.set(id, gap);
      }
    }
    // It stands on the deck and passes through nothing.
    expect(lowest, bicycle).toBeGreaterThan(deckTop - 0.002);
    for (const [id, gap] of closest) {
      expect(gap, `${bicycle} in ${id}`).toBeGreaterThan(-0.002);
    }
    // And it touches, within 2 mm, each thing it leans on.
    for (const pattern of touches) {
      const gap = Math.min(
        ...[...closest]
          .filter(([id]) => pattern.test(id))
          .map(([, gap]) => gap),
      );
      expect(gap, `${bicycle} on ${pattern}`).toBeLessThan(0.002);
    }
  }
});

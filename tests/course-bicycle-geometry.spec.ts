import { expect, test } from "@playwright/test";

import {
  BICYCLE_VARIANTS,
  createBicycleGeometry,
  getBicycleRest,
} from "../src/game/course/course-bicycle-geometry";
import { FALLS_VIEW_PARK_DOCUMENT } from "../src/game/course/course-document";
import type { TreeMeshData } from "../src/game/course/course-tree-geometry";
import {
  createCourseBicycleGeometry,
  getCourseBicycleColliders,
} from "../src/game/course/course-trees";

const variants = Array.from({ length: BICYCLE_VARIANTS }, (_, i) => i);
const meshes = (variant: number) => {
  const { dielectric, metal } = createBicycleGeometry(variant);
  return [dielectric, metal];
};
const heights = (mesh: TreeMeshData) =>
  mesh.positions.filter((_, index) => index % 3 === 1);
const extent = (variant: number, axis: number) => {
  const values = meshes(variant).flatMap((mesh) =>
    mesh.positions.filter((_, index) => index % 3 === axis),
  );
  return Math.max(...values) - Math.min(...values);
};

test("builds each bicycle the same way every time, within its budget", () => {
  for (const variant of variants) {
    expect(createBicycleGeometry(variant)).toEqual(
      createBicycleGeometry(variant),
    );
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

test("rests each bicycle on the ground, its supports touching and stable", () => {
  for (const variant of variants) {
    const lowest = Math.min(...meshes(variant).flatMap(heights));
    expect(Math.abs(lowest)).toBeLessThan(0.002);
    const { centreOfMass, supports } = getBicycleRest(variant);
    const touching = supports.filter(({ point }) => point[1] < 0.002);
    // Every support is a real vertex of the bike.
    const positions = meshes(variant).flatMap((mesh) => mesh.positions);
    for (const { point } of supports) {
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
    // The hardtail stands on both tyres and its kickstand; the BMX lies on
    // both tyres and its left bar end.
    expect(touching.map(({ name }) => name)).toEqual([
      "rear tyre",
      "front tyre",
      variant === 0 ? "kickstand" : "left bar end",
    ]);
    // Its centre of mass lies over the polygon its touching supports span,
    // at least 2 cm inside it, more than the weight estimate's error.
    const points = touching.map(({ point }) => [point[0], point[2]]);
    const middle = [0, 1].map(
      (k) => points.reduce((sum, p) => sum + p[k]!, 0) / points.length,
    );
    points.sort(
      (a, b) =>
        Math.atan2(a[1]! - middle[1]!, a[0]! - middle[0]!) -
        Math.atan2(b[1]! - middle[1]!, b[0]! - middle[0]!),
    );
    points.forEach((a, index) => {
      const b = points[(index + 1) % points.length]!;
      const inside =
        (b[0]! - a[0]!) * (centreOfMass[2] - a[1]!) -
        (b[1]! - a[1]!) * (centreOfMass[0] - a[0]!);
      expect(inside / Math.hypot(b[0]! - a[0]!, b[1]! - a[1]!)).toBeGreaterThan(
        0.02,
      );
    });
  }
});

test("builds both bicycles at real size", () => {
  // The hardtail: 27.5" wheels on a 1.06 m wheelbase, its bars and saddle
  // near a metre up, the bars 720 mm wide.
  expect(extent(0, 0)).toBeGreaterThan(1.6);
  expect(extent(0, 0)).toBeLessThan(1.85);
  expect(extent(0, 1)).toBeGreaterThan(0.95);
  expect(extent(0, 1)).toBeLessThan(1.15);
  expect(extent(0, 2)).toBeGreaterThan(0.6);
  expect(extent(0, 2)).toBeLessThan(0.8);
  // The BMX: 20" wheels on a 0.86 m wheelbase, lying on its side, so its
  // bars and seat, a metre up when it stands, reach out across the ground
  // and its right side stands about 0.7 m up.
  expect(extent(1, 0)).toBeGreaterThan(1.2);
  expect(extent(1, 0)).toBeLessThan(1.45);
  expect(extent(1, 1)).toBeGreaterThan(0.6);
  expect(extent(1, 1)).toBeLessThan(0.8);
  expect(extent(1, 2)).toBeGreaterThan(0.95);
  expect(extent(1, 2)).toBeLessThan(1.15);
  // Tyre contacts a wheelbase apart, give or take the turned front wheel.
  for (const [variant, wheelbase] of [
    [0, 1.06],
    [1, 0.86],
  ]) {
    const [rear, front] = getBicycleRest(variant!).supports.map(
      ({ point }) => point,
    );
    expect(
      Math.abs(
        Math.hypot(front![0] - rear![0], front![2] - rear![2]) - wheelbase!,
      ),
    ).toBeLessThan(0.08);
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

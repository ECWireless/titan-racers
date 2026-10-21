import { expect, test } from "@playwright/test";
const UP = { x: 0, y: 1, z: 0 };

import {
  ROUGH_COURSE_DOCUMENT,
  type CourseObject,
} from "../src/game/course/course-document";
import { CourseSurfaceResolver } from "../src/game/course/course-surface-resolver";
import { getRollingResistanceForce } from "../src/game/kart/kart-coasting-model";
import {
  getLoadDerivedCorneringStiffness,
  getTireGripCoefficient,
} from "../src/game/kart/kart-tire-model";
import { resolveTireSurfaceInteraction } from "../src/game/kart/tire-surface-interaction";

const objects = ROUGH_COURSE_DOCUMENT.objects.filter(
  (object) => object.availability === "standard",
);
const resolver = new CourseSurfaceResolver(objects);

test("resolves staggered turf, lawn, and asphalt independently of the reported body", () => {
  for (const hit of [
    "ground",
    "course-north-verge",
    "course-outer-straight",
    "course-inner-straight",
    "course-inner-lawn",
  ]) {
    for (const [x, z, material] of [
      [0, 3.9, "surface.standard-course"],
      [0, 4.1, "surface.short-grass"],
      [0, 8, "surface.lawn-grass"],
      [0, 11, "surface.short-grass"],
      [-26, 8, "surface.standard-course"],
      [-23.5, 8, "surface.short-grass"],
      [-21, 8, "surface.lawn-grass"],
      [26, 8, "surface.standard-course"],
      [23.5, 8, "surface.short-grass"],
      [21, 8, "surface.lawn-grass"],
      [0, 21, "surface.short-grass"],
      [0, 23, "surface.lawn-grass"],
      [0, -5, "surface.short-grass"],
      [0, -7, "surface.lawn-grass"],
      [-33, 8, "surface.short-grass"],
      [-35, 8, "surface.lawn-grass"],
    ] as const) {
      expect(
        resolver.resolve(hit, { x, y: 0, z }, UP)?.collision.surfaceMaterial.id,
      ).toBe(material);
    }
  }
});

test("uses collision bounds and offsets on rotated elevated surfaces", async () => {
  const platform = structuredClone(
    objects.find((object) => object.id === "course-outer-straight")!,
  );
  platform.id = "elevated-test";
  platform.transform = {
    position: { x: 0, y: 2, z: 8 },
    rotation: { x: 10, y: 25, z: 0 },
  };
  if (platform.collision?.shape !== "box") throw new Error("Expected box");
  platform.collision.offset.position = { x: 0.5, y: 0, z: 0 };
  platform.collision.halfExtents = { x: 1, y: 0.1, z: 1 };
  platform.visual.scale = { x: 100, y: 100, z: 100 };
  platform.visual.material = "ground";
  const localResolver = new CourseSurfaceResolver([...objects, platform]);
  const { Quat, Vec3 } =
    await import("playcanvas/build/playcanvas/src/index.js");
  const rotation = new Quat().setFromEulerAngles(10, 25, 0);
  const point = rotation
    .transformVector(new Vec3(0.5, 0.1, 0))
    .add(new Vec3(0, 2, 8));
  const normal = rotation.transformVector(Vec3.UP);
  expect(localResolver.resolve(platform.id, point, normal)?.name).toBe(
    platform.id,
  );
  expect(localResolver.resolve("ground", { x: 0, y: 0, z: 8 }, UP)?.name).toBe(
    "course-inner-lawn",
  );
  // A different support plane and the platform's giant visual cannot cover the road.
  expect(
    localResolver.resolve("ground", { x: 0, y: 0, z: 0 }, UP)?.collision
      .surfaceMaterial.id,
  ).toBe("surface.standard-course");
});

test("preserves document order at coplanar ties without using visual materials", () => {
  const grass = objects.find(
    (object) => object.id === "course-inner-straight",
  )!;
  const road: CourseObject = { ...structuredClone(grass), id: "road-overlay" };
  road.collision!.surfaceMaterial = {
    id: "surface.standard-course",
    version: 1,
  };
  expect(
    new CourseSurfaceResolver([grass, road]).resolve(
      grass.id,
      { x: 0, y: 0, z: 8 },
      UP,
    )?.name,
  ).toBe(road.id);
  expect(
    new CourseSurfaceResolver([road, grass]).resolve(
      road.id,
      { x: 0, y: 0, z: 8 },
      UP,
    )?.name,
  ).toBe(grass.id);
});

test("resolves coplanar collider angular offsets independently of the reported body", async () => {
  const road = structuredClone(
    objects.find((object) => object.id === "course-outer-straight")!,
  );
  road.id = "tilted-road";
  road.transform = {
    position: { x: 0, y: 0, z: 0 },
    rotation: { x: 0, y: 0, z: 0 },
  };
  if (road.collision?.shape !== "box") throw new Error("Expected box");
  road.collision.offset = {
    position: { x: 0, y: 0, z: 0 },
    rotation: { x: 0, y: 0, z: 10 },
  };
  const grass = structuredClone(road);
  grass.id = "tilted-grass";
  grass.collision!.surfaceMaterial = { id: "surface.short-grass", version: 1 };
  const localResolver = new CourseSurfaceResolver([road, grass]);
  const { Quat, Vec3 } =
    await import("playcanvas/build/playcanvas/src/index.js");
  const point = new Quat()
    .setFromEulerAngles(0, 0, 10)
    .transformVector(new Vec3(0, road.collision.halfExtents.y, 0));
  // The force solver uses entity up; layer selection must use collider up.
  for (const hit of [road.id, grass.id]) {
    expect(localResolver.resolve(hit, point, UP)?.name).toBe(grass.id);
  }
});

test("grass changes the tire curve and rolling force without changing standard values", () => {
  const grass = resolveTireSurfaceInteraction({
    id: "surface.short-grass",
    version: 1,
  });
  const road = resolveTireSurfaceInteraction({
    id: "surface.standard-course",
    version: 1,
  });
  expect(road).toMatchObject({
    peakGripCoefficient: 1.42,
    peakSlipAngleDegrees: 5,
    rollingResistanceCoefficient: 0.025,
  });
  expect(
    getLoadDerivedCorneringStiffness(
      grass.peakGripCoefficient,
      5,
      grass.peakSlipAngleDegrees,
    ),
  ).toBeLessThan(
    getLoadDerivedCorneringStiffness(
      road.peakGripCoefficient,
      5,
      road.peakSlipAngleDegrees,
    ),
  );
  expect(getTireGripCoefficient((8 * Math.PI) / 180, grass)).toBe(0.85);
  expect(getTireGripCoefficient((24 * Math.PI) / 180, grass)).toBe(0.65);
  for (const speed of [-5, 5]) {
    const force = getRollingResistanceForce(
      speed,
      5,
      grass.rollingResistanceCoefficient,
    );
    expect(force * speed).toBeLessThan(0);
    expect(Math.abs(force)).toBeGreaterThan(
      Math.abs(
        getRollingResistanceForce(speed, 5, road.rollingResistanceCoefficient),
      ),
    );
  }
  // Lawn shares turf's grip curve and only resists rolling more.
  const lawn = resolveTireSurfaceInteraction({
    id: "surface.lawn-grass",
    version: 1,
  });
  expect({ ...lawn, rollingResistanceCoefficient: 0, surfaceMaterial: null }).toEqual(
    { ...grass, rollingResistanceCoefficient: 0, surfaceMaterial: null },
  );
  expect(lawn.rollingResistanceCoefficient).toBeGreaterThan(
    grass.rollingResistanceCoefficient,
  );
});

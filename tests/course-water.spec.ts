import { expect, test } from "@playwright/test";

import {
  type CourseDocument,
  FALLS_VIEW_PARK_DOCUMENT,
} from "../src/game/course/course-document";
import {
  createCourseWaterSurfaceGeometry,
  getCourseWaterDistance,
  getCourseWaterVolumes,
  isUnderCourseWater,
} from "../src/game/course/course-water";

// A 0.3 m deep stream 10 m long, turned 90° so it flows toward -Z.
function withStream() {
  const document = structuredClone(FALLS_VIEW_PARK_DOCUMENT);
  document.objects = document.objects.filter(({ visual }) => visual.material !== "water");
  document.objects.push({
    availability: "standard",
    category: "feature",
    collision: null,
    editable: true,
    id: "stream",
    transform: { position: { x: 5, y: 1.55, z: 2 }, rotation: { x: 0, y: 90, z: 0 } },
    visual: { material: "water", scale: { x: 10, y: 0.3, z: 4 }, shape: "box" },
  } as CourseDocument["objects"][number]);
  return document;
}

test("finds a kart under water by its centre of mass, in the water's own frame", () => {
  const volumes = getCourseWaterVolumes(withStream());
  expect(volumes).toHaveLength(1);
  const at = (x: number, y: number, z: number) => isUnderCourseWater(volumes, { x, y, z });

  // Turned 90°, the stream's 10 m runs along Z and its 4 m across X.
  expect(at(5, 1.5, 2 - 4.9)).toBe(true);
  expect(at(5 + 1.9, 1.5, 2)).toBe(true);
  expect(at(5 + 2.1, 1.5, 2)).toBe(false);
  expect(at(5, 1.5, 2 - 5.1)).toBe(false);
  // Above the surface, or on the bed beneath, a kart is not drowned.
  expect(at(5, 1.71, 2)).toBe(false);
  expect(at(5, 1.39, 2)).toBe(false);
});

test("measures the distance to the nearest water in the water's own frame", () => {
  const volumes = getCourseWaterVolumes(withStream());
  const from = (x: number, y: number, z: number) =>
    getCourseWaterDistance(volumes, { x, y, z });

  // Inside, at the surface's height, then 3 m off the bank across the flow
  // (half-width 2 m), and 4 m past the end along it (half-length 5 m).
  expect(from(5, 1.55, 2)).toBe(0);
  expect(from(5 + 2 + 3, 1.55, 2)).toBeCloseTo(3, 6);
  expect(from(5, 1.55, 2 + 5 + 4)).toBeCloseTo(4, 6);
  expect(getCourseWaterDistance([], { x: 0, y: 0, z: 0 })).toBe(
    Number.POSITIVE_INFINITY,
  );
  // 2 m above the surface, as from a bridge (half-height 0.15 m).
  expect(from(5, 1.55 + 0.15 + 2, 2)).toBeCloseTo(2, 6);

  // Turned 30°, a point 4 m out along the stream's own length (its local
  // +X) is 4 m past its end only if the rotation runs the right way.
  const turned = getCourseWaterVolumes(withStream());
  turned[0]!.rotation = { x: 0, y: 30, z: 0 };
  const yaw = (30 * Math.PI) / 180;
  const along = { x: Math.cos(yaw), z: -Math.sin(yaw) };
  const out = 5 + 4;
  expect(
    getCourseWaterDistance(turned, {
      x: 5 + along.x * out,
      y: 1.55,
      z: 2 + along.z * out,
    }),
  ).toBeCloseTo(4, 6);
});

test("lays the water's surface UVs out in metres along its flow", () => {
  const { indices, normals, positions, uvs } = createCourseWaterSurfaceGeometry({
    x: 10,
    y: 0.3,
    z: 4,
  });
  expect(indices).toHaveLength(6);
  for (let index = 0; index < positions.length / 3; index += 1) {
    // The unit box's top face, facing up, with u along local X in metres.
    expect(positions[index * 3 + 1]).toBe(0.5);
    expect(normals.slice(index * 3, index * 3 + 3)).toEqual([0, 1, 0]);
    expect(uvs[index * 2]).toBe(positions[index * 3]! * 10);
    expect(uvs[index * 2 + 1]).toBe(positions[index * 3 + 2]! * 4);
  }
  // Wound as the shared top-face mesh is, so the face points up.
  const [a, b, c] = indices.map((index) => [positions[index * 3]!, positions[index * 3 + 2]!]);
  const cross = (b![0]! - a![0]!) * (c![1]! - a![1]!) - (b![1]! - a![1]!) * (c![0]! - a![0]!);
  expect(cross).toBeLessThan(0);
});

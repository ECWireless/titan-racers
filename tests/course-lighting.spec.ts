import { expect, test } from "@playwright/test";
import type { Application, Entity } from "playcanvas";

import {
  buildCourseLighting,
  projectCourseLighting,
} from "../src/game/course/build-course-lighting";
import { ROUGH_COURSE_DOCUMENT } from "../src/game/course/course-document";

test("projects the enclosure sun from the course's mirror angle", () => {
  const [sun] = projectCourseLighting(ROUGH_COURSE_DOCUMENT).directionalLights;

  // The rough course's placement keeps its accepted key-light direction.
  expect(sun).toMatchObject({
    color: { b: 0.78, g: 0.91, r: 1 },
    id: "enclosure-sun",
    intensity: 0.78,
    shadows: {
      bias: 0.005,
      cascadeBlend: 0.2,
      cascades: 2,
      distance: 60,
      resolution: 2048,
    },
  });
  expect(sun.rotation.x).toBeCloseTo(52, 6);
  expect(sun.rotation.y).toBeCloseTo(38, 6);

  const noon = structuredClone(ROUGH_COURSE_DOCUMENT);
  noon.enclosure.mirrorAngle = 45;
  const [noonSun] = projectCourseLighting(noon).directionalLights;
  expect(noonSun.rotation.x).toBeCloseTo(0, 6);
});

test("turns a directional light's rays away from the sun's image", () => {
  const document = structuredClone(ROUGH_COURSE_DOCUMENT);
  document.enclosure.mirrorAngle = 80;
  document.enclosure.placement.axial = 8_000;
  document.enclosure.placement.azimuth = 10;
  const [sun] = projectCourseLighting(document).directionalLights;
  // PlayCanvas applies X then Y, turning -Y onto this ray.
  const [x, y] = [sun.rotation.x, sun.rotation.y].map(
    (degrees) => (degrees * Math.PI) / 180,
  );
  const ray = {
    x: -Math.sin(x) * Math.sin(y),
    y: -Math.cos(x),
    z: -Math.sin(x) * Math.cos(y),
  };
  // Evening: the sun's image sits low toward the anti-sun cap, so its rays
  // run down and toward the sunward cap.
  const heading = (document.enclosure.placement.heading * Math.PI) / 180;
  const sunward = { x: -Math.sin(heading), z: -Math.cos(heading) };
  expect(ray.x * sunward.x + ray.z * sunward.z).toBeGreaterThan(0.9);
  expect(ray.y).toBeLessThan(0);
});

test("leaves a course unlit where its mirror's light does not reach", () => {
  const document = structuredClone(ROUGH_COURSE_DOCUMENT);
  // An 80° mirror lights only the valley's sunward end.
  document.enclosure.mirrorAngle = 80;
  expect(projectCourseLighting(document).directionalLights).toEqual([]);
});

test("attaches nothing when the sun cannot be created", () => {
  const attached: string[] = [];
  const app = {
    root: { addChild: (entity: Entity) => attached.push(entity.name) },
  } as unknown as Application;

  expect(() =>
    buildCourseLighting(app, {
      createEntity() {
        throw new Error("forced light failure");
      },
      document: ROUGH_COURSE_DOCUMENT,
    }),
  ).toThrow("forced light failure");
  expect(attached).toEqual([]);

  const entities = buildCourseLighting(app, {
    createEntity: (projection) =>
      ({ name: projection.id }) as unknown as Entity,
    document: ROUGH_COURSE_DOCUMENT,
  });
  expect([...entities.keys()]).toEqual(["enclosure-sun"]);
  expect(attached).toEqual(["enclosure-sun"]);
});

import { expect, test } from "@playwright/test";
import type { Application, Color, Entity } from "playcanvas";

import {
  buildCourseLighting,
  projectCourseLighting,
} from "../src/game/course/build-course-lighting";
import { ROUGH_COURSE_DOCUMENT } from "../src/game/course/course-document";

function createTestColor(r: number, g: number, b: number): Color {
  return {
    b,
    clone() {
      return createTestColor(r, g, b);
    },
    g,
    r,
  } as Color;
}

test("projects ambient intensity and bounded directional shadow presets", () => {
  const projection = projectCourseLighting(ROUGH_COURSE_DOCUMENT);

  expect(projection).toEqual({
    ambient: { b: 0.46, g: 0.39, r: 0.34 },
    directionalLights: [
      {
        color: { b: 0.78, g: 0.91, r: 1 },
        id: "warm-key-light",
        intensity: 0.78,
        rotation: { x: 52, y: 38, z: 0 },
        shadows: { bias: 0.2, distance: 45, resolution: 1024 },
      },
      {
        color: { b: 0.9, g: 0.68, r: 0.55 },
        id: "cool-fill-light",
        intensity: 0.32,
        rotation: { x: 28, y: -132, z: 0 },
        shadows: null,
      },
    ],
  });
});

test("maps low and high shadow quality without exposing renderer tuning", () => {
  const document = structuredClone(ROUGH_COURSE_DOCUMENT);
  document.lighting.ambient.intensity = 0.5;
  document.lighting.directionalLights[0].shadowQuality = "low";
  document.lighting.directionalLights[1].shadowQuality = "high";

  const projection = projectCourseLighting(document);

  expect(projection.ambient).toEqual({ b: 0.23, g: 0.195, r: 0.17 });
  expect(projection.directionalLights[0].shadows?.resolution).toBe(512);
  expect(projection.directionalLights[1].shadows?.resolution).toBe(2048);
});

test("rolls back staged lights and ambient when a later light fails", () => {
  const events: string[] = [];
  const originalAmbient = createTestColor(0.1, 0.2, 0.3);
  const app = {
    root: {
      addChild(entity: Entity) {
        events.push(`attach:${entity.name}`);
      },
    },
    scene: { ambientLight: originalAmbient },
  } as unknown as Application;
  let createdCount = 0;

  expect(() =>
    buildCourseLighting(app, {
      createColor: createTestColor,
      createEntity(projection) {
        createdCount += 1;

        if (createdCount === 2) {
          throw new Error("forced light failure");
        }

        events.push(`create:${projection.id}`);
        return {
          destroy() {
            events.push(`destroy:${projection.id}`);
          },
          name: projection.id,
        } as unknown as Entity;
      },
      document: ROUGH_COURSE_DOCUMENT,
    }),
  ).toThrow("forced light failure");

  expect(events).toEqual([
    "create:warm-key-light",
    "destroy:warm-key-light",
  ]);
  expect(app.scene.ambientLight).toMatchObject({ r: 0.1, g: 0.2, b: 0.3 });
});

test("attaches lights only after the complete lighting batch succeeds", () => {
  const events: string[] = [];
  const app = {
    root: {
      addChild(entity: Entity) {
        events.push(`attach:${entity.name}`);
      },
    },
    scene: { ambientLight: createTestColor(0.1, 0.2, 0.3) },
  } as unknown as Application;

  const entities = buildCourseLighting(app, {
    createColor: createTestColor,
    createEntity(projection) {
      events.push(`create:${projection.id}`);
      return {
        destroy() {
          events.push(`destroy:${projection.id}`);
        },
        name: projection.id,
      } as unknown as Entity;
    },
    document: ROUGH_COURSE_DOCUMENT,
  });

  expect(events).toEqual([
    "create:warm-key-light",
    "create:cool-fill-light",
    "attach:warm-key-light",
    "attach:cool-fill-light",
  ]);
  expect(entities.size).toBe(2);
  expect(app.scene.ambientLight.r).toBeCloseTo(0.34);
  expect(app.scene.ambientLight.g).toBeCloseTo(0.39);
  expect(app.scene.ambientLight.b).toBeCloseTo(0.46);
});

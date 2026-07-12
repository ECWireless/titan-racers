import * as pc from "playcanvas";

import type { CourseDocument } from "./course-document";
import { ROUGH_COURSE_DOCUMENT } from "./course-document";

const SHADOW_RESOLUTION = {
  high: 2048,
  low: 512,
  medium: 1024,
} as const;

export type CourseLightingProjection = ReturnType<
  typeof projectCourseLighting
>["directionalLights"][number];

// Custom factories must return an unattached entity. The builder owns scene
// attachment so the complete lighting batch can be committed atomically.
type CourseLightingEntityFactory = (
  projection: CourseLightingProjection,
) => pc.Entity;

type CourseLightingColorFactory = (
  r: number,
  g: number,
  b: number,
) => pc.Color;

type BuildCourseLightingOptions = {
  createColor?: CourseLightingColorFactory;
  createEntity?: CourseLightingEntityFactory;
  document?: CourseDocument;
};

export function projectCourseLighting(document: CourseDocument) {
  const { ambient, directionalLights } = document.lighting;

  return {
    ambient: {
      b: ambient.color.b * ambient.intensity,
      g: ambient.color.g * ambient.intensity,
      r: ambient.color.r * ambient.intensity,
    },
    directionalLights: directionalLights.map((light) => ({
      color: light.color,
      id: light.id,
      intensity: light.intensity,
      rotation: light.rotation,
      shadows:
        light.shadowQuality === "off"
          ? null
          : {
              bias: 0.2,
              distance: 45,
              resolution: SHADOW_RESOLUTION[light.shadowQuality],
            },
    })),
  };
}

export function buildCourseLighting(
  app: pc.Application,
  {
    createColor = (r, g, b) => new pc.Color(r, g, b),
    createEntity = createDirectionalLightEntity,
    document = ROUGH_COURSE_DOCUMENT,
  }: BuildCourseLightingOptions = {},
) {
  const projection = projectCourseLighting(document);
  const entities = new Map<string, pc.Entity>();
  const stagedEntities: pc.Entity[] = [];
  const previousAmbientLight = app.scene.ambientLight.clone();

  try {
    projection.directionalLights.forEach((light) => {
      const entity = createEntity(light);

      stagedEntities.push(entity);
      entities.set(light.id, entity);
    });

    stagedEntities.forEach((entity) => app.root.addChild(entity));
    app.scene.ambientLight = createColor(
      projection.ambient.r,
      projection.ambient.g,
      projection.ambient.b,
    );
  } catch (error) {
    stagedEntities.forEach((entity) => entity.destroy());
    app.scene.ambientLight = previousAmbientLight;
    throw error;
  }

  return entities;
}

function createDirectionalLightEntity(light: CourseLightingProjection) {
  const entity = new pc.Entity(light.id);

  try {
    entity.addComponent("light", {
      castShadows: light.shadows !== null,
      color: new pc.Color(light.color.r, light.color.g, light.color.b),
      intensity: light.intensity,
      ...(light.shadows
        ? {
            shadowBias: light.shadows.bias,
            shadowDistance: light.shadows.distance,
            shadowResolution: light.shadows.resolution,
          }
        : {}),
      type: "directional",
    });
    entity.setEulerAngles(
      light.rotation.x,
      light.rotation.y,
      light.rotation.z,
    );

    return entity;
  } catch (error) {
    entity.destroy();
    throw error;
  }
}

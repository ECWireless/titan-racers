import * as pc from "playcanvas";

import { getEnclosureFrame } from "../enclosure/island-three";
import type { CourseDocument } from "./course-document";
import { ROUGH_COURSE_DOCUMENT } from "./course-document";

export const ENCLOSURE_SUN_ID = "enclosure-sun";

export type CourseLightingProjection = ReturnType<
  typeof projectCourseLighting
>["directionalLights"][number];

// Custom factories must return an unattached entity. The builder owns scene
// attachment so the complete lighting batch can be committed atomically.
type CourseLightingEntityFactory = (
  projection: CourseLightingProjection,
) => pc.Entity;

type BuildCourseLightingOptions = {
  createEntity?: CourseLightingEntityFactory;
  document?: CourseDocument;
};

/**
 * The course's light: the enclosure's sunlight, shining from the sun's image
 * in the window opposite the course, when the mirror's light reaches the
 * course at all. Its Euler angles turn a directional light's -Y onto the
 * sun's rays.
 */
export function projectCourseLighting(document: CourseDocument) {
  const frame = getEnclosureFrame(document.enclosure);
  if (!frame.sunReaches()) return { directionalLights: [] };
  const toSun = frame.sunDirection();
  const toDegrees = (radians: number) => (radians * 180) / Math.PI || 0;

  return {
    directionalLights: [
      {
        color: { ...frame.definition.sunlight.color },
        id: ENCLOSURE_SUN_ID,
        intensity: frame.definition.sunlight.intensity,
        rotation: {
          x: toDegrees(Math.acos(Math.max(-1, Math.min(1, toSun.y)))),
          y: toDegrees(Math.atan2(toSun.x, toSun.z)),
          z: 0,
        },
        shadows: { bias: 0.005, distance: 20, resolution: 1024 },
      },
    ],
  };
}

export function buildCourseLighting(
  app: pc.Application,
  {
    createEntity = createDirectionalLightEntity,
    document = ROUGH_COURSE_DOCUMENT,
  }: BuildCourseLightingOptions = {},
) {
  const projection = projectCourseLighting(document);
  const entities = new Map<string, pc.Entity>();
  const stagedEntities: pc.Entity[] = [];

  try {
    projection.directionalLights.forEach((light) => {
      const entity = createEntity(light);

      stagedEntities.push(entity);
      entities.set(light.id, entity);
    });

    stagedEntities.forEach((entity) => app.root.addChild(entity));
  } catch (error) {
    stagedEntities.forEach((entity) => entity.destroy());
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
            // A 1:10 kart spans only a few shadow texels, so a 3×3 filter
            // lets its moving shadow visibly step between them. 5×5 hides it.
            shadowType: pc.SHADOW_PCF5_32F,
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

import * as pc from "playcanvas";

import { NEUTRAL_WHITE } from "../enclosure/island-three";
import {
  createEnvironmentAtlasPixels,
  ENVIRONMENT_ATLAS_SIZE,
} from "../render/habitat-environment-atlas";
import { applyAdaptedEnvironmentAtlas } from "../render/scene-look";
import {
  type CourseDocument,
  isCoursePrimitiveObject,
  rotateCourseDirection,
} from "./course-document";

/**
 * Light a lamp-lit service tunnel's surfaces give back, as luminous exitance
 * (lm/m², reflectance × illuminance): asphalt under about 420 lux, concrete
 * walls under about 300, and a ceiling lit by their bounce. It lights the
 * inside indirectly; the tunnel's lamps light it directly.
 */
export const COURSE_INTERIOR_EXITANCE = {
  ceiling: 45,
  floor: 70,
  walls: 137,
} as const;

// Seen from the kart, the floor fills the view below the horizon and the
// ceiling above about 57°, a 4.5 m road under a 3.6 m roof.
const FLOOR_SINE = Math.sin((-2.5 * Math.PI) / 180);
const CEILING_SINE = Math.sin((57 * Math.PI) / 180);

/**
 * The interior's environment as a lit tunnel would surround a kart: floor,
 * walls, and ceiling by elevation, in scene units and brightened by the
 * race's adaptation, as the habitat's atlas is stored. Materials that use
 * it scale it back with `applyAdaptedEnvironmentAtlas` (scene-look.ts).
 */
export function createCourseInteriorAtlas(
  device: pc.GraphicsDevice,
  sceneUnitsPerLux: number,
  adaptation: number,
) {
  const radiance = (exitance: number) =>
    (exitance / Math.PI) * sceneUnitsPerLux * adaptation;
  const [r, g, b] = NEUTRAL_WHITE;
  const pixels = createEnvironmentAtlasPixels((sine) => {
    const value = radiance(
      sine < FLOOR_SINE
        ? COURSE_INTERIOR_EXITANCE.floor
        : sine < CEILING_SINE
          ? COURSE_INTERIOR_EXITANCE.walls
          : COURSE_INTERIOR_EXITANCE.ceiling,
    );
    return { b: b * value, g: g * value, r: r * value };
  });
  return new pc.Texture(device, {
    addressU: pc.ADDRESS_CLAMP_TO_EDGE,
    addressV: pc.ADDRESS_CLAMP_TO_EDGE,
    format: pc.PIXELFORMAT_RGBA8,
    height: ENVIRONMENT_ATLAS_SIZE,
    levels: [pixels],
    mipmaps: false,
    name: "course-interior-atlas",
    projection: pc.TEXTUREPROJECTION_EQUIRECT,
    type: pc.TEXTURETYPE_RGBP,
    width: ENVIRONMENT_ATLAS_SIZE,
  });
}

/**
 * Whether a point is indoors: beneath one of the course's overhead indoor
 * objects (a tunnel's roof, always a box). Null when the course has none.
 */
export function createCourseInteriorTest(document: CourseDocument) {
  // Each roof's local axes in the world, found once: a point's local
  // coordinates are its offset's projections onto them.
  const level = { x: 0, y: 0, z: 0 };
  const roofs = document.objects
    .filter(isCoursePrimitiveObject)
    .filter((object) => object.overhead && object.indoors)
    .map(({ transform: { position, rotation }, visual: { scale } }) => {
      const axis = (x: number, y: number, z: number) =>
        rotateCourseDirection({ x, y, z }, level, rotation);
      return {
        position,
        scale,
        x: axis(1, 0, 0),
        y: axis(0, 1, 0),
        z: axis(0, 0, 1),
      };
    });
  if (roofs.length === 0) return null;
  return (point: { x: number; y: number; z: number }) =>
    roofs.some(({ position, scale, x, y, z }) => {
      const dx = point.x - position.x;
      const dy = point.y - position.y;
      const dz = point.z - position.z;
      const along = (axis: typeof x) => dx * axis.x + dy * axis.y + dz * axis.z;
      return (
        Math.abs(along(x)) <= scale.x / 2 &&
        Math.abs(along(z)) <= scale.z / 2 &&
        along(y) < -scale.y / 2
      );
    });
}

/**
 * Moves a race kart between outdoor and indoor light. Its finishes hold
 * the habitat's atlas themselves, as a material atlas scaled back by the
 * adaptation, so crossing a portal only swaps a texture, and its mesh instances take light from outdoor or indoor lights
 * by mask. Dynamic batches clone their materials and copy masks when built,
 * so both the originals and any current batches change.
 */
export function createKartInteriorLighting(
  app: pc.AppBase,
  {
    adaptation,
    batchGroupId,
    habitatAtlas,
    interiorAtlas,
    materials,
    root,
  }: {
    adaptation: number;
    batchGroupId: number;
    habitatAtlas: pc.Texture;
    interiorAtlas: pc.Texture;
    materials: readonly pc.StandardMaterial[];
    root: pc.Entity;
  },
) {
  materials.forEach((material) =>
    applyAdaptedEnvironmentAtlas(material, habitatAtlas, adaptation),
  );
  let current: boolean | null = null;
  return (indoors: boolean) => {
    if (indoors === current) return;
    current = indoors;
    const atlas = indoors ? interiorAtlas : habitatAtlas;
    const mask = indoors ? pc.MASK_AFFECT_LIGHTMAPPED : pc.MASK_AFFECT_DYNAMIC;
    const swap = (material: pc.Material | null) => {
      if (!(material instanceof pc.StandardMaterial)) return;
      material.envAtlas = atlas;
      material.update();
    };
    materials.forEach(swap);
    root.forEach((node) =>
      (node as pc.Entity).render?.meshInstances.forEach((meshInstance) => {
        meshInstance.mask = mask;
      }),
    );
    // PlayCanvas 2.20.6 types `getBatches` as private; re-verify it on an
    // engine upgrade. Rebuilding the batch instead would hitch each portal.
    const batcher = app.batcher as unknown as {
      getBatches(id: number): readonly pc.Batch[];
    };
    batcher.getBatches(batchGroupId).forEach(({ meshInstance }) => {
      meshInstance.mask = mask;
      swap(meshInstance.material);
    });
  };
}

import * as pc from "playcanvas";

import type { HabitatLight } from "../enclosure/habitat-light";
import {
  createEnvironmentAtlasPixels,
  ENVIRONMENT_ATLAS_SIZE,
  type LinearColor,
} from "./habitat-environment-atlas";

/**
 * Neutral, slightly warm habitat light in linear values for editors and
 * thumbnails: a bright diffuse horizon, a soft overhead, and a dark floor
 * bounce. Races are lit by their Island Three enclosure instead.
 */
const HABITAT_ENVIRONMENT = {
  ground: { b: 0.09, g: 0.1, r: 0.11 },
  horizon: { b: 0.46, g: 0.48, r: 0.5 },
  zenith: { b: 0.42, g: 0.41, r: 0.4 },
} satisfies Record<string, LinearColor>;

const ENVIRONMENT_GAIN = 1.2;
const EXPOSURE = 1.6;
const SHADOW_NORMAL_OFFSET_BIAS = 0.05;

let habitatAtlasPixels: Uint8Array | null = null;

/**
 * Applies the shared Titan Racers look to one PlayCanvas application and
 * camera: Neutral tone mapping, exposure, and environment lighting, which
 * replaces the flat scene ambient. The environment is an enclosure's habitat
 * light when given, else the neutral habitat light. Returns a cleanup that
 * releases the environment texture.
 */
export function applySceneLook(
  app: pc.Application,
  camera: pc.CameraComponent,
  habitat?: HabitatLight,
) {
  // The environment only lights the scene and never renders as a skybox.
  camera.layers = camera.layers.filter((id) => id !== pc.LAYERID_SKYBOX);
  camera.gammaCorrection = pc.GAMMA_SRGB;
  camera.toneMapping = pc.TONEMAP_NEUTRAL;
  app.scene.exposure = EXPOSURE;
  // An enclosure's light is already in scene units.
  app.scene.skyboxIntensity = habitat ? 1 : ENVIRONMENT_GAIN;

  const pixels = habitat
    ? habitat.atlasPixels()
    : (habitatAtlasPixels ??= createEnvironmentAtlasPixels(
        habitatColorAtElevation,
      ));
  const atlas = new pc.Texture(app.graphicsDevice, {
    addressU: pc.ADDRESS_CLAMP_TO_EDGE,
    addressV: pc.ADDRESS_CLAMP_TO_EDGE,
    format: pc.PIXELFORMAT_RGBA8,
    height: ENVIRONMENT_ATLAS_SIZE,
    levels: [pixels],
    mipmaps: false,
    name: "habitat-environment-atlas",
    projection: pc.TEXTUREPROJECTION_EQUIRECT,
    type: pc.TEXTURETYPE_RGBP,
    width: ENVIRONMENT_ATLAS_SIZE,
  });
  app.scene.envAtlas = atlas;

  return () => {
    if (app.scene?.envAtlas === atlas) app.scene.envAtlas = null;
    atlas.destroy();
  };
}

/** One shadow policy for every shadow-casting light. */
export function applyShadowPolicy(light: pc.LightComponent) {
  light.normalOffsetBias = SHADOW_NORMAL_OFFSET_BIAS;
}

/** Bright diffuse horizon, soft overhead, and a quick fade to floor bounce. */
function habitatColorAtElevation(sine: number) {
  const { ground, horizon, zenith } = HABITAT_ENVIRONMENT;
  return sine >= 0
    ? mix(horizon, zenith, Math.sqrt(sine))
    : mix(horizon, ground, Math.min(1, -sine * 4));
}

function mix(from: LinearColor, to: LinearColor, amount: number) {
  return {
    b: from.b + (to.b - from.b) * amount,
    g: from.g + (to.g - from.g) * amount,
    r: from.r + (to.r - from.r) * amount,
  };
}

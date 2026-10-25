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
export const EXPOSURE = 1.6;
const SHADOW_NORMAL_OFFSET_BIAS = 0.05;
// Cascaded shadows fade out over the last fifth of their reach.
const SHADOW_FADE_START = 0.8;

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
  // A dim habitat is exposed brighter, as eyes adjust. Its atlas is stored
  // already brightened, and its light is otherwise in scene units.
  const adaptation = habitat?.adaptation ?? 1;
  app.scene.exposure = EXPOSURE * adaptation;
  app.scene.skyboxIntensity = habitat ? 1 / adaptation : ENVIRONMENT_GAIN;

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
  fadeCascadedShadowEdge(app.graphicsDevice);

  return () => {
    if (app.scene?.envAtlas === atlas) app.scene.envAtlas = null;
    atlas.destroy();
  };
}

/**
 * Fades cascaded directional shadows out toward their distance, where the
 * engine otherwise cuts them off and they pop in as the camera nears. Only
 * lights with cascades (the course sun) change. Patches the PlayCanvas 2.20
 * `shadowCascadesPS` and `lightFunctionLightPS` chunks for the device.
 */
function fadeCascadedShadowEdge(device: pc.GraphicsDevice) {
  const chunks = pc.ShaderChunks.get(device, pc.SHADERLANGUAGE_GLSL);
  const cascades = chunks.get("shadowCascadesPS")!;
  if (cascades.includes("dShadowFade")) return;
  chunks.set(
    "shadowCascadesPS",
    `${replaceChunkText(cascades, "vec3 fadeShadow(", "vec3 cutShadow(")}
float dShadowFade = 1.0;
vec3 fadeShadow(vec3 shadowCoord, vec4 shadowCascadeDistances) {
  float far = shadowCascadeDistances.w;
  dShadowFade = 1.0 - smoothstep(far * ${SHADOW_FADE_START.toFixed(2)}, far, 1.0 / gl_FragCoord.w);
  return cutShadow(shadowCoord, shadowCascadeDistances);
}
`,
  );
  chunks.set(
    "lightFunctionLightPS",
    replaceChunkText(
      chunks.get("lightFunctionLightPS")!,
      "shadow = mix(1.0, shadow, light{i}_shadowIntensity);",
      `#ifdef LIGHT{i}_SHADOW_CASCADES
			shadow = mix(1.0, shadow, light{i}_shadowIntensity * dShadowFade);
		#else
			shadow = mix(1.0, shadow, light{i}_shadowIntensity);
		#endif`,
    ),
  );
}

function replaceChunkText(chunk: string, find: string, replacement: string) {
  if (!chunk.includes(find)) {
    throw new Error(`Shader chunk no longer contains ${find}`);
  }
  return chunk.replace(find, replacement);
}

/** One shadow policy for every shadow-casting light. */
export function applyShadowPolicy(light: pc.LightComponent) {
  light.normalOffsetBias = SHADOW_NORMAL_OFFSET_BIAS;
}

/**
 * Holds a camera's directional shadows at one size while its field of view
 * changes. PlayCanvas fits each shadow cascade to a sphere around the view
 * and snaps it to shadow texels, which holds still only while the sphere
 * keeps its size; a view widening with speed rescales the map every frame,
 * so static shadow edges shimmer. The engine reads frustum corners only for
 * that fit, so this camera reports them at its widest view.
 */
export function steadyShadowFit(
  camera: pc.CameraComponent,
  widestFov: () => number,
) {
  const lens = camera.camera;
  const corners = lens.getFrustumCorners.bind(lens);
  lens.getFrustumCorners = (near, far) => {
    const points = corners(near, far);
    const halfAngle = (degrees: number) => (degrees * Math.PI) / 360;
    const scale =
      Math.tan(halfAngle(Math.max(widestFov(), lens.fov))) /
      Math.tan(halfAngle(lens.fov));
    points.forEach((point) => {
      point.x *= scale;
      point.y *= scale;
    });
    return points;
  };
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

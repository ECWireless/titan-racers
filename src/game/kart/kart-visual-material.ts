import * as pc from "playcanvas";

import type { KartPartFinish } from "./kart-part-visual-geometry";

type FinishSpec = {
  /** Fixed sRGB color; null takes the part's authored color. */
  color: string | null;
  gloss: number;
  metal: boolean;
};

/**
 * The industrial finish set: matte powder coat, bead-blasted and anodized
 * metal, and matte rubber, each a physically based material.
 */
const KART_FINISHES = {
  "authored-anodized": { color: null, gloss: 0.5, metal: true },
  "authored-paint": { color: null, gloss: 0.38, metal: false },
  "authored-polymer": { color: null, gloss: 0.32, metal: false },
  "bare-aluminum": { color: "#c9ccce", gloss: 0.5, metal: true },
  "bare-steel": { color: "#aeb1b4", gloss: 0.6, metal: true },
  "black-oxide-steel": { color: "#45474a", gloss: 0.5, metal: true },
  "black-polymer": { color: "#2e2e30", gloss: 0.32, metal: false },
  "authored-wheel-anodized": { color: null, gloss: 0.5, metal: true },
  copper: { color: "#c98a5e", gloss: 0.55, metal: true },
  rubber: { color: "#2b2b2c", gloss: 0.18, metal: false },
  "tire-rubber": { color: "#2b2b2c", gloss: 0.18, metal: false },
} as const satisfies Record<KartPartFinish, FinishSpec>;

/** Each wheel's blur, see `setKartWheelSweeps`. */
const WHEEL_SWEEP_UNIFORM = "kartWheelSweep[0]";
// Assembly validation requires exactly four wheel-tire instances.
const WHEEL_COUNT = 4;

// Shared by both wheel finishes. A wheel's detail is drawn at its canonical
// lathe size (vUv1: axial, radius; see buildWheelTire) around its local +X
// axle, and averaged over the angle the wheel turned during the frame, as a
// camera shutter open for the whole frame would see it: still detail is
// sharp, and as the wheel spins up each feature smears into an arc and then
// an even disc. The pixel's own angular footprint is averaged too, which
// antialiases the detail when it is small on screen.
const WHEEL_DECLARATIONS = `
varying vec3 vWheelLocal;
// Signed angle, in radians about the wheel's +X, each wheel turns per frame.
uniform float kartWheelSweep[${WHEEL_COUNT}];
float wheelAngle;
float wheelFootprint;
float wheelSweep;

void prepareWheel() {
    vec2 around = vWheelLocal.yz;
    float radius = max(length(around), 1e-5);
    wheelAngle = atan(around.y, around.x);
    wheelFootprint = length(fwidth(around)) / radius;
    wheelSweep = 0.0;
    #ifdef STD_DIFFUSE_VERTEX
    // The pieces' vertex alpha carries the wheel's index; 255 is no wheel.
    int index = int(vVertexColor.a * 255.0 + 0.5);
    if (index < ${WHEEL_COUNT}) wheelSweep = kartWheelSweep[index];
    #endif
}

// Shadow passes compile these chunks without vertex colors.
vec3 wheelVertexColor() {
    #ifdef STD_DIFFUSE_VERTEX
    return clamp(vVertexColor.rgb, 0.0, 1.0);
    #else
    return vec3(1.0);
    #endif
}

float pulseIntegral(float x, float duty) {
    return floor(x) * duty + min(fract(x), duty);
}

// Mean cover of \`count\` evenly spaced features, each \`duty\` of its period
// wide and starting at \`phase\` periods, over the angles the pixel saw.
float wheelPulse(float count, float duty, float phase) {
    float start = wheelAngle + min(wheelSweep, 0.0) - 0.5 * wheelFootprint;
    float width = max(abs(wheelSweep) + wheelFootprint, 1e-4);
    float a = start * count / 6.2831853 - phase;
    float w = width * count / 6.2831853;
    float cover = (pulseIntegral(a + w, duty) - pulseIntegral(a, duty)) / w;
    // Past a few periods the leftover of a partial one is a faint ripple
    // that jumps each frame; settle on the even mean instead.
    return mix(cover, duty, smoothstep(1.0, 2.0, w));
}

// 1 inside [low, high] on a lathe coordinate, with edges a pixel soft.
float wheelBand(float value, float low, float high) {
    float soft = max(fwidth(value), 1e-6);
    return smoothstep(low - soft, low + soft, value)
        * (1.0 - smoothstep(high - soft, high + soft, value));
}
`;

const WHEEL_VERTEX = {
  litUserDeclarationVS: "varying vec3 vWheelLocal;",
  litUserMainEndVS: "vWheelLocal = vertex_position.xyz;",
};

// The tread top carries 24 staggered transverse blocks, their tops scrubbed
// lighter and smoother than the shadowed grooves between them; the outboard
// sidewall one block of grey printed lettering, which smears into a streak
// and then a ring.
const TIRE_ALBEDO = `
uniform vec3 material_diffuse;
float tireTread;
float tireGroove;
void getAlbedo() {
    prepareWheel();
    float axial = vUv1.x;
    float radius = vUv1.y;
    tireTread = wheelBand(radius, 0.0575, 0.06) * wheelBand(abs(axial), 0.0005, 0.0095);
    tireGroove = tireTread * wheelPulse(24.0, 0.3, axial > 0.0 ? 0.5 : 0.0);
    // One block of lettering, its characters fine strokes.
    float lettering = wheelBand(axial, 0.0155, 0.03) * wheelBand(radius, 0.041, 0.049)
        * wheelPulse(1.0, 0.3, 0.0) * wheelPulse(90.0, 0.55, 0.0);
    vec3 rubber = material_diffuse * wheelVertexColor()
        * (1.0 + 0.35 * tireTread - 1.05 * tireGroove);
    dAlbedo = mix(rubber, vec3(0.3), lettering);
}
`;

const TIRE_GLOSS = `
uniform float material_gloss;
void getGlossiness() {
    dGlossiness = mix(material_gloss + 0.1 * tireTread, 0.08, tireGroove) + 0.0000001;
}
`;

// Six windows through the dish floor show the dark wheel interior, between
// spokes whose faces are machined back to bare aluminium after anodizing.
// The windows take no metal sheen, so a blurred disc keeps a share of each.
const RIM_ALBEDO = `
uniform vec3 material_diffuse;
float wheelWindow;
float wheelMachined;
void getAlbedo() {
    prepareWheel();
    float spokes = wheelBand(vUv1.x, 0.0075, 0.0085) * wheelBand(vUv1.y, 0.0125, 0.0215);
    wheelWindow = spokes * wheelPulse(6.0, 0.62, 0.0);
    wheelMachined = spokes - wheelWindow;
    dAlbedo = material_diffuse * wheelVertexColor() * (1.0 - spokes)
        + vec3(0.58, 0.6, 0.61) * wheelMachined + vec3(0.02) * wheelWindow;
}
`;

const RIM_METALNESS = `
uniform float material_metalness;
void getMetalness() {
    dMetalness = material_metalness * (1.0 - wheelWindow);
}
`;

const RIM_GLOSS = `
uniform float material_gloss;
void getGlossiness() {
    dGlossiness = material_gloss * (1.0 - wheelWindow) + 0.2 * wheelWindow
        + 0.15 * wheelMachined + 0.0000001;
}
`;

const WHEEL_FRAGMENT: Partial<Record<KartPartFinish, Record<string, string>>> = {
  "authored-wheel-anodized": {
    diffusePS: RIM_ALBEDO,
    glossPS: RIM_GLOSS,
    metalnessPS: RIM_METALNESS,
  },
  "tire-rubber": { diffusePS: TIRE_ALBEDO, glossPS: TIRE_GLOSS },
};

/**
 * One kart material per finish. Colors come from vertex colors, so a kart
 * draws once per finish however many colors it uses, and every finish shares
 * one shader program, apart from the two wheel finishes, which draw their
 * own detail. Callers own and destroy it.
 */
export function createKartVisualMaterial(finish: KartPartFinish) {
  const spec: FinishSpec = KART_FINISHES[finish];
  const material = new pc.StandardMaterial();
  material.diffuseVertexColor = true;
  // Documented StandardMaterial option missing from the 2.20 typings: vertex
  // colors are sRGB, which keeps dark colors precise in 8 bits.
  (material as pc.StandardMaterial & { vertexColorGamma: boolean })
    .vertexColorGamma = true;
  material.useMetalness = true;
  material.metalness = spec.metal ? 1 : 0;
  material.gloss = spec.gloss;
  const wheelChunks = WHEEL_FRAGMENT[finish];
  if (wheelChunks) {
    // Also missing from the 2.20 typings: emit UV1 (the lathe stations)
    // without a texture that reads it.
    (material as pc.StandardMaterial & { forceUv1: boolean }).forceUv1 = true;
    material.shaderChunks.version = "2.20";
    const chunks = material.shaderChunks.glsl;
    chunks.set("litUserDeclarationVS", WHEEL_VERTEX.litUserDeclarationVS);
    chunks.set("litUserMainEndVS", WHEEL_VERTEX.litUserMainEndVS);
    chunks.set("litUserDeclarationPS", WHEEL_DECLARATIONS);
    for (const [name, code] of Object.entries(wheelChunks)) {
      chunks.set(name, code);
    }
    // Still until the race sets them. A dynamic batch's copy of the material
    // shares this array, so the race writes into it in place.
    material.setParameter(WHEEL_SWEEP_UNIFORM, new Float32Array(WHEEL_COUNT));
  }
  material.update();
  return material;
}

/**
 * Sets each wheel's blur on a wheel finish's material for the frame: the
 * signed angle, in radians about the wheel's own +X, it turns while the frame
 * shows, by wheel index. Other finishes ignore it; unset, wheels draw still,
 * as the editors and thumbnails show them.
 */
export function setKartWheelSweeps(
  material: pc.StandardMaterial,
  sweeps: readonly number[],
) {
  const sweep = (
    material.getParameter(WHEEL_SWEEP_UNIFORM) as { data?: unknown } | undefined
  )?.data;
  if (!(sweep instanceof Float32Array)) return;
  for (let index = 0; index < WHEEL_COUNT; index++) {
    sweep[index] = sweeps[index] ?? 0;
  }
}

/** The rendered sRGB color of a finish, given the part's authored color. */
export function getKartFinishColor(
  finish: KartPartFinish,
  visualColor: string,
) {
  const spec: FinishSpec = KART_FINISHES[finish];
  return spec.color ?? toPlausibleSurfaceColor(visualColor);
}

// Real surfaces reflect roughly 4% (black paint) to 85% (white paint) of
// light. In OKLab lightness, which tracks perceived brightness, that is the
// cube root of those reflectances.
const MINIMUM_LIGHTNESS = Math.cbrt(0.04);
const MAXIMUM_LIGHTNESS = Math.cbrt(0.85);

/**
 * Keeps an authored sRGB color's hue and chroma but clamps its lightness to
 * what a real painted, dyed, or anodized surface can reflect. Documents keep
 * the authored color; only rendering uses the mapped one.
 */
function toPlausibleSurfaceColor(hex: string) {
  const linear = [1, 3, 5].map((offset) =>
    toLinear(Number.parseInt(hex.slice(offset, offset + 2), 16) / 255),
  ) as [number, number, number];
  const [lightness, a, b] = linearToOklab(linear);
  const clamped = Math.min(
    Math.max(lightness, MINIMUM_LIGHTNESS),
    MAXIMUM_LIGHTNESS,
  );
  if (clamped === lightness) return hex;
  return `#${oklabToLinear([clamped, a, b])
    .map((channel) =>
      Math.round(toSrgb(Math.min(Math.max(channel, 0), 1)) * 255)
        .toString(16)
        .padStart(2, "0"),
    )
    .join("")}`;
}

function toLinear(channel: number) {
  return channel <= 0.04045
    ? channel / 12.92
    : ((channel + 0.055) / 1.055) ** 2.4;
}

function toSrgb(channel: number) {
  return channel <= 0.0031308
    ? channel * 12.92
    : 1.055 * channel ** (1 / 2.4) - 0.055;
}

function linearToOklab([r, g, b]: [number, number, number]) {
  const l = Math.cbrt(0.4122214708 * r + 0.5363325363 * g + 0.0514459929 * b);
  const m = Math.cbrt(0.2119034982 * r + 0.6806995451 * g + 0.1073969566 * b);
  const s = Math.cbrt(0.0883024619 * r + 0.2817188376 * g + 0.6299787005 * b);
  return [
    0.2104542553 * l + 0.793617785 * m - 0.0040720468 * s,
    1.9779984951 * l - 2.428592205 * m + 0.4505937099 * s,
    0.0259040371 * l + 0.7827717662 * m - 0.808675766 * s,
  ];
}

function oklabToLinear([lightness, a, b]: number[]) {
  const l = (lightness + 0.3963377774 * a + 0.2158037573 * b) ** 3;
  const m = (lightness - 0.1055613458 * a - 0.0638541728 * b) ** 3;
  const s = (lightness - 0.0894841775 * a - 1.291485548 * b) ** 3;
  return [
    4.0767416621 * l - 3.3077115913 * m + 0.2309699292 * s,
    -1.2684380046 * l + 2.6097574011 * m - 0.3413193965 * s,
    -0.0041960863 * l - 0.7034186147 * m + 1.707614701 * s,
  ];
}

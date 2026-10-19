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
  copper: { color: "#c98a5e", gloss: 0.55, metal: true },
  rubber: { color: "#2b2b2c", gloss: 0.18, metal: false },
} as const satisfies Record<KartPartFinish, FinishSpec>;

/**
 * One kart material per finish. Colors come from vertex colors, so a kart
 * draws once per finish however many colors it uses, and every finish shares
 * one shader program. Callers own and destroy it.
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
  material.update();
  return material;
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

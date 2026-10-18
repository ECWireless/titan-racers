/**
 * Builds the PlayCanvas 2.20 environment-atlas pixels for the habitat light on
 * the CPU. The light depends only on elevation, so each atlas row has one
 * value; computing rows directly avoids the engine's GPU prefilter shaders,
 * whose compile and render cost lands on every new application (each kart
 * thumbnail is one), and the pixels re-upload by themselves after a lost
 * WebGL context.
 *
 * Layout follows `EnvLighting.generateAtlas` at its fixed 512 size: sharp
 * levels down the top-left diagonal, rougher reflection levels stacked
 * below them, and the diffuse ambient block. Texels are RGBP-encoded.
 */

export type LinearColor = { b: number; g: number; r: number };
type Rect = { height: number; width: number; x: number; y: number };
type Lobe =
  | { kind: "ambient" }
  | { kind: "sharp" }
  | { kind: "specular"; power: number };

export const ENVIRONMENT_ATLAS_SIZE = 512;

const ELEVATION_STEPS = 96;
const AZIMUTH_STEPS = 48;
const SHARP_POWER = 128;

export function createEnvironmentAtlasPixels(
  colorAtElevation: (sine: number) => LinearColor,
) {
  const size = ENVIRONMENT_ATLAS_SIZE;
  const pixels = new Uint8Array(size * size * 4);
  // One packed RGBA texel per 32-bit word (every target is little-endian).
  const words = new Uint32Array(pixels.buffer);
  const integrate = createIntegrator(colorAtElevation);
  const fill = (rect: Rect, lobe: Lobe) => {
    for (let row = rect.y; row < rect.y + rect.height; row += 1) {
      // Rows map to elevation exactly as the shader's mapUv/toSphericalUv
      // read them, including the one-texel seam at each rect edge.
      const v = Math.min(
        1,
        Math.max(0, (row + 0.5 - rect.y - 1) / (rect.height - 2)),
      );
      // Lobes this tight are sharper than the gradient changes.
      const color =
        lobe.kind === "sharp" ||
        (lobe.kind === "specular" && lobe.power >= SHARP_POWER)
          ? colorAtElevation(Math.sin((0.5 - v) * Math.PI))
          : integrate((0.5 - v) * Math.PI, lobe);
      const [r, g, b, a] = encodeRgbp(color);
      const start = row * size + rect.x;
      words.fill(
        (r | (g << 8) | (b << 16) | (a << 24)) >>> 0,
        start,
        start + rect.width,
      );
    }
  };

  // Sharp levels: 512×256, 256×128, … along the diagonal.
  for (let level = 0, t = 1; level < 6; level += 1, t /= 2) {
    const offset = size - size * t;
    fill({ height: (size * t) / 2, width: size * t, x: offset, y: offset }, {
      kind: "sharp",
    });
  }
  // Rough levels 1–6 stacked from (0, 256), matching specularPower 2048 >> 2i.
  for (let level = 1, y = size / 2, width = size / 2; level < 7; level += 1) {
    fill({ height: width / 2, width, x: 0, y }, {
      kind: "specular",
      power: Math.max(1, 2048 >> (level * 2)),
    });
    y += width / 2;
    width /= 2;
  }
  fill({ height: 32, width: 64, x: 128, y: 384 }, { kind: "ambient" });
  return pixels;
}

/** Integrates the elevation-only light against a lobe around one direction. */
function createIntegrator(colorAtElevation: (sine: number) => LinearColor) {
  // Each elevation band's solid angle per azimuth step scales with cosine.
  const samples: Array<{ color: LinearColor; cosine: number; sine: number }> =
    [];
  for (let i = 0; i < ELEVATION_STEPS; i += 1) {
    const elevation = ((i + 0.5) / ELEVATION_STEPS - 0.5) * Math.PI;
    samples.push({
      color: colorAtElevation(Math.sin(elevation)),
      cosine: Math.cos(elevation),
      sine: Math.sin(elevation),
    });
  }
  const azimuthCosines = Array.from({ length: AZIMUTH_STEPS }, (_, j) =>
    Math.cos(((j + 0.5) / AZIMUTH_STEPS) * Math.PI * 2),
  );
  return (elevation: number, lobe: Exclude<Lobe, { kind: "sharp" }>) => {
    const ny = Math.sin(elevation);
    const nh = Math.cos(elevation);
    const sum = { b: 0, g: 0, r: 0 };
    let total = 0;
    for (const sample of samples) {
      for (const azimuthCosine of azimuthCosines) {
        const cosine = Math.max(
          0,
          sample.sine * ny + sample.cosine * nh * azimuthCosine,
        );
        if (cosine === 0) continue;
        const weight =
          sample.cosine *
          (lobe.kind === "ambient" ? cosine : cosine ** lobe.power);
        sum.r += sample.color.r * weight;
        sum.g += sample.color.g * weight;
        sum.b += sample.color.b * weight;
        total += weight;
      }
    }
    return total > 0
      ? { b: sum.b / total, g: sum.g / total, r: sum.r / total }
      : colorAtElevation(ny);
  };
}

/** Mirrors the engine's encodeRGBP shader chunk. */
function encodeRgbp({ b, g, r }: LinearColor) {
  const gamma = [Math.sqrt(r), Math.sqrt(g), Math.sqrt(b)];
  const maxValue = Math.min(8, Math.max(1, ...gamma));
  const alpha = Math.ceil((1 - (maxValue - 1) / 7) * 255) / 255;
  const scale = -alpha * 7 + 8;
  return [
    Math.round((gamma[0] / scale) * 255),
    Math.round((gamma[1] / scale) * 255),
    Math.round((gamma[2] / scale) * 255),
    Math.round(alpha * 255),
  ];
}

/**
 * Builds the PlayCanvas 2.20 environment-atlas pixels for the habitat light on
 * the CPU. Computing them directly avoids the engine's GPU prefilter shaders,
 * whose compile and render cost lands on every new application (each kart
 * thumbnail is one), and the pixels re-upload by themselves after a lost
 * WebGL context. Editors and thumbnails use light that depends only on
 * elevation, so each atlas row has one value; the race's light varies with
 * direction too.
 *
 * Layout follows `EnvLighting.generateAtlas` at its fixed 512 size: sharp
 * levels down the top-left diagonal, rougher reflection levels stacked
 * below them, and the diffuse ambient block. Texels are RGBP-encoded.
 */

export type LinearColor = { b: number; g: number; r: number };
type Rect = { height: number; width: number; x: number; y: number };
type Vector3 = { x: number; y: number; z: number };
type Lobe =
  { kind: "ambient" } | { kind: "sharp" } | { kind: "specular"; power: number };

export const ENVIRONMENT_ATLAS_SIZE = 512;

const ELEVATION_STEPS = 96;
const AZIMUTH_STEPS = 48;
const SHARP_POWER = 128;

// Radiance is sampled on equirectangular grids this size: sharp for glossy
// reflections, then halved twice for broader lobes.
const SHARP_MAP_WIDTH = 128;

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
      const start = row * size + rect.x;
      words.fill(packRgbp(color), start, start + rect.width);
    }
  };

  forEachAtlasRect(fill);
  return pixels;
}

/**
 * Atlas pixels for light that varies with direction, given the radiance
 * arriving from each world direction.
 */
export function createDirectionalEnvironmentAtlasPixels(
  radiance: (direction: Vector3) => LinearColor,
) {
  const size = ENVIRONMENT_ATLAS_SIZE;
  const pixels = new Uint8Array(size * size * 4);
  const words = new Uint32Array(pixels.buffer);
  const sharp = sampleRadianceMap(radiance, SHARP_MAP_WIDTH);
  const medium = halveMap(sharp);
  const broad = halveMap(medium);
  const convolved = new Map<number, RadianceMap>();
  const lobeMap = (lobe: Lobe) => {
    if (
      lobe.kind === "sharp" ||
      (lobe.kind === "specular" && lobe.power >= SHARP_POWER)
    ) {
      return sharp;
    }
    // The diffuse ambient is the same cosine lobe as the roughest level.
    const power = lobe.kind === "ambient" ? 1 : lobe.power;
    // Broad lobes integrate a coarser map; a 32-power lobe needs the finer.
    let map = convolved.get(power);
    if (!map) {
      map = convolveMap(power > 8 ? medium : broad, power);
      convolved.set(power, map);
    }
    return map;
  };
  forEachAtlasRect((rect, lobe) => {
    const map = lobeMap(lobe);
    for (let row = rect.y; row < rect.y + rect.height; row += 1) {
      const v = Math.min(
        1,
        Math.max(0, (row + 0.5 - rect.y - 1) / (rect.height - 2)),
      );
      for (let column = rect.x; column < rect.x + rect.width; column += 1) {
        const u = (column + 0.5 - rect.x - 1) / (rect.width - 2);
        words[row * size + column] = packRgbp(sampleMap(map, u, v));
      }
    }
  });
  return pixels;
}

/** Visits every atlas rect with the lobe its texels hold. */
function forEachAtlasRect(fill: (rect: Rect, lobe: Lobe) => void) {
  const size = ENVIRONMENT_ATLAS_SIZE;
  // Sharp levels: 512×256, 256×128, … along the diagonal.
  for (let level = 0, t = 1; level < 6; level += 1, t /= 2) {
    const offset = size - size * t;
    fill(
      { height: (size * t) / 2, width: size * t, x: offset, y: offset },
      {
        kind: "sharp",
      },
    );
  }
  // Rough levels 1–6 stacked from (0, 256), matching specularPower 2048 >> 2i.
  for (let level = 1, y = size / 2, width = size / 2; level < 7; level += 1) {
    fill(
      { height: width / 2, width, x: 0, y },
      {
        kind: "specular",
        power: Math.max(1, 2048 >> (level * 2)),
      },
    );
    y += width / 2;
    width /= 2;
  }
  fill({ height: 32, width: 64, x: 128, y: 384 }, { kind: "ambient" });
}

type RadianceMap = {
  colors: Float32Array;
  directions: Float32Array;
  height: number;
  /** Solid angle of each texel. */
  weights: Float32Array;
  width: number;
};

/**
 * Atlas lookup direction at equirectangular coordinates, as the shader's
 * toSphericalUv reads them. Lookups mirror world X.
 */
function atlasDirection(u: number, v: number): Vector3 {
  const azimuth = (u - 0.5) * Math.PI * 2;
  const elevation = (0.5 - v) * Math.PI;
  const cosine = Math.cos(elevation);
  return {
    x: cosine * Math.sin(azimuth),
    y: Math.sin(elevation),
    z: cosine * Math.cos(azimuth),
  };
}

function sampleRadianceMap(
  radiance: (direction: Vector3) => LinearColor,
  width: number,
): RadianceMap {
  const height = width / 2;
  const map = createMap(width, height);
  for (let j = 0; j < height; j += 1) {
    for (let i = 0; i < width; i += 1) {
      const index = j * width + i;
      const { x, y, z } = map.direction(index);
      const { b, g, r } = radiance({ x: -x, y, z });
      map.colors.set([r, g, b], index * 3);
    }
  }
  return map;
}

function createMap(width: number, height: number) {
  const colors = new Float32Array(width * height * 3);
  const directions = new Float32Array(width * height * 3);
  const weights = new Float32Array(width * height);
  const band = (Math.PI / height) * ((Math.PI * 2) / width);
  for (let j = 0; j < height; j += 1) {
    for (let i = 0; i < width; i += 1) {
      const index = j * width + i;
      const direction = atlasDirection((i + 0.5) / width, (j + 0.5) / height);
      directions.set([direction.x, direction.y, direction.z], index * 3);
      weights[index] = band * Math.sqrt(1 - direction.y * direction.y);
    }
  }
  return {
    colors,
    direction: (index: number) => ({
      x: directions[index * 3]!,
      y: directions[index * 3 + 1]!,
      z: directions[index * 3 + 2]!,
    }),
    directions,
    height,
    weights,
    width,
  };
}

/** The map at half resolution, each texel the solid-angle mean of four. */
function halveMap(map: RadianceMap): RadianceMap {
  const half = createMap(map.width / 2, map.height / 2);
  for (let j = 0; j < half.height; j += 1) {
    for (let i = 0; i < half.width; i += 1) {
      const sum = [0, 0, 0];
      let total = 0;
      for (const [dj, di] of [
        [0, 0],
        [0, 1],
        [1, 0],
        [1, 1],
      ] as const) {
        const index = (j * 2 + dj) * map.width + i * 2 + di;
        const weight = map.weights[index]!;
        for (let c = 0; c < 3; c += 1) {
          sum[c]! += map.colors[index * 3 + c]! * weight;
        }
        total += weight;
      }
      half.colors.set(
        sum.map((value) => value / total),
        (j * half.width + i) * 3,
      );
    }
  }
  return half;
}

/** Bilinear lookup, wrapping around and clamped at the poles. */
function sampleMap(map: RadianceMap, u: number, v: number): LinearColor {
  const { colors, height, width } = map;
  const x = u * width - 0.5;
  const y = Math.min(height - 1, Math.max(0, v * height - 0.5));
  const x0 = Math.floor(x);
  const y0 = Math.floor(y);
  const fx = x - x0;
  const fy = y - y0;
  const left = (((x0 % width) + width) % width) * 3;
  const right = ((((x0 + 1) % width) + width) % width) * 3;
  const top = y0 * width * 3;
  const bottom = Math.min(height - 1, y0 + 1) * width * 3;
  const a = top + left;
  const b = top + right;
  const c = bottom + left;
  const d = bottom + right;
  const wa = (1 - fx) * (1 - fy);
  const wb = fx * (1 - fy);
  const wc = (1 - fx) * fy;
  const wd = fx * fy;
  return {
    b:
      colors[a + 2]! * wa +
      colors[b + 2]! * wb +
      colors[c + 2]! * wc +
      colors[d + 2]! * wd,
    g:
      colors[a + 1]! * wa +
      colors[b + 1]! * wb +
      colors[c + 1]! * wc +
      colors[d + 1]! * wd,
    r: colors[a]! * wa + colors[b]! * wb + colors[c]! * wc + colors[d]! * wd,
  };
}

// Lobe weights below this fraction of their peak are skipped.
const LOBE_CUTOFF = 1e-4;

/**
 * Integrates a map against a lobe around each of its own texel directions.
 * Between two rows the lobe weight depends only on the azimuth difference,
 * so each row pair computes it once and convolves around the row.
 */
function convolveMap(map: RadianceMap, power: number): RadianceMap {
  const { colors, height, weights, width } = map;
  const out = createMap(width, height);
  const azimuthCosines = Float64Array.from({ length: width }, (_, d) =>
    Math.cos((d / width) * Math.PI * 2),
  );
  const rowSines = Float64Array.from({ length: height }, (_, j) =>
    Math.sin((0.5 - (j + 0.5) / height) * Math.PI),
  );
  const offsets: number[] = [];
  const kernel: number[] = [];
  const sums = new Float64Array(width * 3);
  const totals = new Float64Array(width);
  for (let outRow = 0; outRow < height; outRow += 1) {
    const outSine = rowSines[outRow]!;
    const outCosine = Math.sqrt(1 - outSine * outSine);
    sums.fill(0);
    totals.fill(0);
    for (let row = 0; row < height; row += 1) {
      const sine = rowSines[row]!;
      const cosine = Math.sqrt(1 - sine * sine);
      offsets.length = 0;
      kernel.length = 0;
      for (let d = 0; d < width; d += 1) {
        const lobeCosine =
          outSine * sine + outCosine * cosine * azimuthCosines[d]!;
        if (lobeCosine <= 0) continue;
        const lobeValue = lobeCosine ** power;
        if (lobeValue < LOBE_CUTOFF) continue;
        offsets.push(d);
        kernel.push(weights[row * width]! * lobeValue);
      }
      const base = row * width;
      for (let k = 0; k < offsets.length; k += 1) {
        const d = offsets[k]!;
        const weight = kernel[k]!;
        for (let i = 0; i < width; i += 1) {
          const wrapped = i + d < width ? i + d : i + d - width;
          const source = (base + wrapped) * 3;
          sums[i * 3] += colors[source]! * weight;
          sums[i * 3 + 1] += colors[source + 1]! * weight;
          sums[i * 3 + 2] += colors[source + 2]! * weight;
          totals[i] += weight;
        }
      }
    }
    for (let i = 0; i < width; i += 1) {
      const index = (outRow * width + i) * 3;
      for (let c = 0; c < 3; c += 1) {
        out.colors[index + c] = sums[i * 3 + c]! / totals[i]!;
      }
    }
  }
  return out;
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

/**
 * Mirrors the engine's encodeRGBP shader chunk, packed as one RGBA texel
 * word (every target is little-endian).
 */
function packRgbp({ b, g, r }: LinearColor) {
  const red = Math.sqrt(r);
  const green = Math.sqrt(g);
  const blue = Math.sqrt(b);
  const maxValue = Math.min(8, Math.max(1, red, green, blue));
  const alpha = Math.ceil((1 - (maxValue - 1) / 7) * 255) / 255;
  const scale = 255 / (-alpha * 7 + 8);
  // RGBP holds up to 64; brighter light saturates.
  const byte = (value: number) => Math.min(255, Math.round(value * scale));
  return (
    (byte(red) |
      (byte(green) << 8) |
      (byte(blue) << 16) |
      (Math.round(alpha * 255) << 24)) >>>
    0
  );
}

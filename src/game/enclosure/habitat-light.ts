import {
  createDirectionalEnvironmentAtlasPixels,
  type LinearColor,
} from "../render/habitat-environment-atlas";
import { BELT, CLEARING_RADIUS, HUB_RADIUS } from "./habitat-land";
import {
  add,
  type CourseEnclosure,
  dot,
  getEnclosureFrame,
  scaled,
  sceneLux,
  type Vector3,
} from "./island-three";
import { TREE_CROWN_SHADE, TREE_MEAN_ALBEDO } from "./tree-billboards";

/**
 * The light Island Three sheds on a course, computed on the CPU from the same
 * model the enclosure view draws: sunlit and shaded floors, end caps, windows
 * showing the mirrors and space, all seen through the habitat air. The race
 * lights its course with it, so a kart is brighter on the side facing the
 * sunlit floor. Surfaces use the view's mean colours rather than its detail.
 */


// Meteorological visibility of the habitat air: the distance at which a dark
// object's contrast falls to 2% (extinction 3.912 / visibility). Clear days
// on Earth see 20–50 km; at 55 km the end caps, 8–24 km away, stay visible
// but faint. Air scatters some of that itself (Rayleigh); moisture and dust
// make up the rest.
const VISIBILITY = 55_000;
// Rayleigh extinction of air at half sea-level pressure, per metre, for red,
// green, and blue.
export const RAYLEIGH_EXTINCTION = [2.9e-6, 6.75e-6, 16.55e-6] as const;
export const AEROSOL_EXTINCTION = 3.912 / VISIBILITY - RAYLEIGH_EXTINCTION[1];
// Moisture and dust scatter nearly evenly across colours.
const AEROSOL_TINT = [0.95, 1, 1.05] as const;
// Sunlit air glows with the daylight the mirrors let in, so distance fades
// toward a pale haze rather than toward white, dimming toward dusk and dark
// at night. With a noon's daylight it glows at 46% of the sunlight's
// brightness, which keeps the Starter Course's afternoon at its accepted 40%.
const AIR_GLOW_PER_DAYLIGHT = 0.46;
// Air in the mirror's beam glows brighter toward the sun's image.
const SUN_GLOW = 1.2;
const SUN_GLOW_POWER = 32;
// Island Three's lamps follow the mirrors' schedule: they come on at dusk, as
// the mirrors let in less than about a twentieth of a noon's daylight, well
// before a light sensor would, and are off by day.
const LAMPS_OFF_DAYLIGHT = 0.06;
const LAMPS_ON_DAYLIGHT = 0.03;

// Eyes adjust to a dim course, as they do fully at these light levels: below
// the key light of a low sun, the race brightens by how much dimmer the
// course's key light is, up to a limit. Dusk still reads from the dark haze,
// the missing sun shadows, and the lit course against its dimmer valley.
const ADAPTED_KEY = 0.25;
const MAXIMUM_ADAPTATION = 64;
// The lit course fills about half the view, so eyes adjust to half its
// lamps' light, and the lit track reads brighter than the dusk around it.
const COURSE_LAMP_VIEW_SHARE = 0.5;

// The belt of trees around the clearing fills the horizon to about this
// height, at its middle depth, with gaps between clumps and toward the
// sunward cap.
const BELT_HEIGHT = 16;
const BELT_DISTANCE = CLEARING_RADIUS + BELT.inset + BELT.depth / 2;
const BELT_COVER = 0.45;

// Mean albedos of the enclosure view's surfaces.
const LAND = { b: 0.042, g: 0.093, r: 0.076 };
const LAWN = { b: 0.071, g: 0.127, r: 0.093 };
const PLATING = { b: 0.105, g: 0.11, r: 0.11 };
const TERRACES = { b: 0.031, g: 0.069, r: 0.05 };
const STEEL = { b: 0.068, g: 0.05, r: 0.034 };
const [LEAF_R, LEAF_G, LEAF_B] = TREE_MEAN_ALBEDO.map((value) => value * TREE_CROWN_SHADE) as [
  number,
  number,
  number,
];
const LEAVES = { b: LEAF_B, g: LEAF_G, r: LEAF_R };
// Dusty mirror film scatters this much of the sunlight; the glass passes 90%.
const MIRROR_SCATTER = 0.18;
const MIRROR_BACK = 0.01;
const GLASS_TRANSMITTANCE = 0.9;

// The eye height the light is computed for, and the coarse hemisphere the
// enclosure's own fill light is averaged over.
const EYE_HEIGHT = 1;
const FILL_ELEVATION_STEPS = 16;
const FILL_AZIMUTH_STEPS = 32;
const FILL_ITERATIONS = 2;

export type HabitatLight = {
  /**
   * How far the race brightens for a dim course, as eyes adjust: 1 while
   * the course's key light is a low sun's or brighter.
   */
  adaptation: number;
  /** Glow of the habitat's air relative to the sunlight. */
  airGlow: number;
  /** How far the habitat's lamps are on, from 0 by day to 1 from dusk. */
  lampsOn: number;
  /**
   * The course's key light relative to a low sun's, at most 1. Unlit race
   * effects scale their colour by it so they dim with the lit ground.
   */
  lightLevel: number;
  /**
   * Diffuse light reaching an upward surface, as a cosine-weighted mean
   * radiance: the enclosure's fill light on its own floors.
   */
  fill: LinearColor;
  /** Glow toward the sun's image; zero when the sun misses the course. */
  sunGlow: number;
  /** Light arriving at the course from a world direction (unit vector). */
  radiance(direction: Vector3): LinearColor;
  /**
   * Environment-atlas pixels of this light, built on first use and stored
   * brightened by the adaptation, so a dim habitat keeps its precision.
   */
  atlasPixels(): Uint8Array;
};

type EnclosureLight = Omit<
  HabitatLight,
  "adaptation" | "atlasPixels" | "lightLevel"
> & { key: number };

let cachedEnclosure: { key: string; light: EnclosureLight } | null = null;
let cached: { key: string; light: HabitatLight } | null = null;

/**
 * The light an enclosure sheds on its course, reused while races stay on the
 * same placement. A course's own lamps, given as the illuminance they put on
 * its track while on, count toward how far eyes adjust.
 */
export function getHabitatLight(
  enclosure: CourseEnclosure,
  courseLampLux = 0,
): HabitatLight {
  const enclosureKey = JSON.stringify(enclosure);
  if (cachedEnclosure?.key !== enclosureKey) {
    cachedEnclosure = {
      key: enclosureKey,
      light: createEnclosureLight(enclosure),
    };
  }
  const key = `${enclosureKey}:${courseLampLux}`;
  if (cached?.key !== key) {
    cached = {
      key,
      light: adaptToCourse(
        cachedEnclosure.light,
        courseLampLux * sceneLux(getEnclosureFrame(enclosure).definition),
      ),
    };
  }
  return cached.light;
}

/**
 * Eyes adjust to the course's key light: the habitat's fill, any sun, and
 * the course's own lamps.
 */
function adaptToCourse(
  { key, ...light }: EnclosureLight,
  courseLamps: number,
): HabitatLight {
  const lightLevel = Math.min(
    1,
    (key + COURSE_LAMP_VIEW_SHARE * courseLamps * light.lampsOn) /
      ADAPTED_KEY,
  );
  const adaptation = Math.min(MAXIMUM_ADAPTATION, 1 / lightLevel);
  let pixels: Uint8Array | null = null;
  return {
    ...light,
    adaptation,
    atlasPixels: () =>
      (pixels ??= createDirectionalEnvironmentAtlasPixels((direction) =>
        scale(light.radiance(direction), adaptation),
      )),
    lightLevel,
  };
}

function createEnclosureLight(enclosure: CourseEnclosure): EnclosureLight {
  const frame = getEnclosureFrame(enclosure);
  const { length, radius, sunlight, valleyCount } = frame.definition;
  const halfLength = length / 2;
  const spacing = 360 / valleyCount;
  const sun = frame.sunDirection();
  const sunColor = scale(sunlight.color, sunlight.intensity);
  const sunGlow = frame.sunReaches() ? SUN_GLOW : 0;
  const daylight = frame.daylight();
  const airGlow = AIR_GLOW_PER_DAYLIGHT * daylight;
  const lampsOn = Math.min(
    1,
    Math.max(
      0,
      (LAMPS_OFF_DAYLIGHT - daylight) / (LAMPS_OFF_DAYLIGHT - LAMPS_ON_DAYLIGHT),
    ),
  );
  const axisMid = frame.point(0, 0, 0);
  const outward0 = frame.outward(0);
  const outward90 = frame.outward(90);
  const origin = { x: 0, y: EYE_HEIGHT, z: 0 };
  const placement = enclosure.placement;

  const fromOrigin = add(origin, axisMid, -1);
  const originAxial = dot(fromOrigin, frame.sunward);
  const originRadial = add(fromOrigin, frame.sunward, -originAxial);
  const extinction = [0, 1, 2].map(
    (c) => RAYLEIGH_EXTINCTION[c]! + AEROSOL_TINT[c]! * AEROSOL_EXTINCTION,
  );

  /** What lies beyond a window along a ray: a mirror, or space. */
  const beyond = (at: Vector3, direction: Vector3) => {
    let nearest = Infinity;
    let light = 0;
    for (const mirror of frame.mirrors) {
      const facing = dot(direction, mirror.normal);
      const distance = dot(add(mirror.hinge, at, -1), mirror.normal) / facing;
      if (!(distance > 0) || distance >= nearest) continue;
      const hit = add(add(at, direction, distance), mirror.hinge, -1);
      const along = dot(hit, mirror.along);
      if (along < 0 || along > mirror.length) continue;
      if (Math.abs(dot(hit, mirror.across)) > mirror.halfWidth) continue;
      nearest = distance;
      light = facing > 0 ? MIRROR_BACK : MIRROR_SCATTER;
    }
    return scale(sunColor, light * GLASS_TRANSMITTANCE);
  };

  const surfaceLight = (
    albedo: LinearColor,
    at: Vector3,
    normal: Vector3,
    fill: LinearColor,
  ) => {
    const sunlit = frame.sunlightOn(at, normal);
    return {
      b: albedo.b * (sunColor.b * sunlit + fill.b),
      g: albedo.g * (sunColor.g * sunlit + fill.g),
      r: albedo.r * (sunColor.r * sunlit + fill.r),
    };
  };

  const trace = (direction: Vector3, fill: LinearColor): LinearColor => {
    const axialStep = dot(direction, frame.sunward);
    const radialStep = add(direction, frame.sunward, -axialStep);
    // Inside the cylinder: |radial + t·radialStep| = radius has one root ahead.
    const a = dot(radialStep, radialStep);
    const b = dot(originRadial, radialStep);
    const c = dot(originRadial, originRadial) - radius * radius;
    const toWall = a > 1e-12 ? (-b + Math.sqrt(b * b - a * c)) / a : Infinity;
    const toCap =
      axialStep === 0
        ? Infinity
        : (Math.sign(axialStep) * halfLength - originAxial) / axialStep;
    const distance = Math.min(toWall, toCap);
    const hit = add(origin, direction, distance);
    const fromAxis = add(hit, axisMid, -1);
    const axial = dot(fromAxis, frame.sunward);
    const radial = add(fromAxis, frame.sunward, -axial);
    const azimuth =
      (Math.atan2(dot(radial, outward90), dot(radial, outward0)) * 180) /
      Math.PI;
    const offset = azimuth - spacing * Math.round(azimuth / spacing);

    let color: LinearColor;
    if (toCap < toWall) {
      const capRadius = length3(radial);
      const albedo =
        capRadius < HUB_RADIUS
          ? STEEL
          : Math.abs(offset) < spacing / 4 && capRadius > 0.7 * radius
            ? TERRACES
            : PLATING;
      const normal = scaled(frame.sunward, -Math.sign(axial));
      color = surfaceLight(albedo, hit, normal, fill);
    } else if (Math.abs(offset) <= spacing / 4) {
      const clearingTurn =
        ((((azimuth - placement.azimuth + 180) % 360) + 360) % 360) - 180;
      const inClearing =
        Math.hypot(
          axial - placement.axial,
          (clearingTurn * Math.PI * radius) / 180,
        ) < CLEARING_RADIUS;
      const normal = scaled(radial, -1 / length3(radial));
      color = surfaceLight(inClearing ? LAWN : LAND, hit, normal, fill);
    } else {
      color = beyond(hit, direction);
    }

    const toSun = Math.max(dot(direction, sun), 0);
    const glow = airGlow + sunGlow * toSun ** SUN_GLOW_POWER;
    const channel = (value: number, air: number, c: number) => {
      const transmit = Math.exp(-extinction[c]! * distance);
      return value * transmit + air * glow * (1 - transmit);
    };
    const seen = {
      b: channel(color.b, sunColor.b, 2),
      g: channel(color.g, sunColor.g, 1),
      r: channel(color.r, sunColor.r, 0),
    };
    // Low on the horizon, the belt of trees around the clearing stands in
    // front of the rest, close enough to be clear of haze.
    const level = Math.hypot(direction.x, direction.z);
    if (direction.y < 0 || direction.y * BELT_DISTANCE > BELT_HEIGHT * level) {
      return seen;
    }
    const facing = { x: -direction.x / level, y: 0, z: -direction.z / level };
    const trees = surfaceLight(LEAVES, scaled(facing, -BELT_DISTANCE), facing, fill);
    const mix = (a: number, b: number) => a + (b - a) * BELT_COVER;
    return { b: mix(seen.b, trees.b), g: mix(seen.g, trees.g), r: mix(seen.r, trees.r) };
  };

  // The fill on the enclosure's floors is its own light, so it converges in
  // a couple of passes; floors reflect only about a tenth of it.
  let fill: LinearColor = { b: 0, g: 0, r: 0 };
  for (let pass = 0; pass < FILL_ITERATIONS; pass += 1) {
    fill = upwardMean((direction) => trace(direction, fill));
  }
  const finalFill = fill;
  const luminance = ({ b, g, r }: LinearColor) =>
    0.2126 * r + 0.7152 * g + 0.0722 * b;
  return {
    airGlow,
    fill: finalFill,
    key:
      luminance(finalFill) +
      (frame.sunReaches() ? luminance(sunColor) * Math.max(sun.y, 0) : 0),
    lampsOn,
    radiance: (direction: Vector3) => trace(direction, finalFill),
    sunGlow,
  };
}

/** Cosine-weighted mean radiance over the upper hemisphere. */
function upwardMean(radiance: (direction: Vector3) => LinearColor) {
  const sum = { b: 0, g: 0, r: 0 };
  let total = 0;
  for (let i = 0; i < FILL_ELEVATION_STEPS; i += 1) {
    const elevation = ((i + 0.5) / FILL_ELEVATION_STEPS) * (Math.PI / 2);
    const sine = Math.sin(elevation);
    const cosine = Math.cos(elevation);
    // Solid angle scales with cosine; the surface weights by sine.
    const weight = sine * cosine;
    for (let j = 0; j < FILL_AZIMUTH_STEPS; j += 1) {
      const azimuth = ((j + 0.5) / FILL_AZIMUTH_STEPS) * Math.PI * 2;
      const color = radiance({
        x: cosine * Math.sin(azimuth),
        y: sine,
        z: cosine * Math.cos(azimuth),
      });
      sum.b += color.b * weight;
      sum.g += color.g * weight;
      sum.r += color.r * weight;
      total += weight;
    }
  }
  return scale(sum, 1 / total);
}

function length3(a: Vector3) {
  return Math.sqrt(dot(a, a));
}

function scale(color: LinearColor, factor: number): LinearColor {
  return { b: color.b * factor, g: color.g * factor, r: color.r * factor };
}

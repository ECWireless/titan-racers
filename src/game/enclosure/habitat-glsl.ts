import { SUN_ANGULAR_RADIUS } from "./island-three";

// GLSL shared by the enclosure view from inside and the exterior view on the
// loading screen, so both draw the same habitat. Lengths are metres.

/** Anti-aliased edges, lines, and noise. */
export const HABITAT_PATTERN_GLSL = /* glsl */ `
// Coverage of the inside (d < 0) of an edge, for a pixel footprint f.
float inside(float d, float f) {
  return clamp(0.5 - d / max(f, 1e-3), 0.0, 1.0);
}

float hash(vec2 cell) {
  vec3 p = fract(vec3(cell.xyx) * 0.1031);
  p += dot(p, p.yzx + 33.33);
  return fract((p.x + p.y) * p.z);
}

float valueNoise(vec2 p) {
  vec2 cell = floor(p);
  vec2 f = fract(p);
  f = f * f * (3.0 - 2.0 * f);
  return mix(
    mix(hash(cell), hash(cell + vec2(1.0, 0.0)), f.x),
    mix(hash(cell + vec2(0.0, 1.0)), hash(cell + vec2(1.0)), f.x),
    f.y
  );
}

// Box-filtered coverage of a band of half-width w around d = 0, for a pixel
// footprint f, so thin lines fade to their average instead of shimmering.
float band(float d, float w, float f) {
  f = max(f, 1e-3);
  return clamp((min(d + 0.5 * f, w) - max(d - 0.5 * f, -w)) / f, 0.0, 1.0);
}

// Repeating lines every spacing s, faded to their mean once sub-pixel.
float lattice(float x, float w, float s, float f) {
  float d = (fract(x / s + 0.5) - 0.5) * s;
  return mix(band(d, w, f), 2.0 * w / s, smoothstep(0.3 * s, s, f));
}
`;

/**
 * Valley farmland and end caps. Needs the pattern chunk and the RADIUS and
 * VALLEY_SPACING defines.
 */
export const HABITAT_LAND_GLSL = /* glsl */ `
const vec3 FOREST = vec3(0.028, 0.042, 0.02);
const vec3 PASTURE = vec3(0.07, 0.1, 0.04);
const vec3 CROP = vec3(0.095, 0.11, 0.035);
const vec3 GRAIN = vec3(0.19, 0.16, 0.08);
const vec3 TILLED = vec3(0.09, 0.075, 0.045);
const vec3 FALLOW = vec3(0.12, 0.115, 0.075);
const vec3 FIELD_MEAN = vec3(0.095, 0.1, 0.045);
const vec3 HEDGE = vec3(0.03, 0.045, 0.02);
const vec3 ROAD = vec3(0.17, 0.17, 0.16);
const vec3 PAVING = vec3(0.2, 0.19, 0.17);
const vec3 WATER = vec3(0.02, 0.04, 0.055);
const vec3 SAND = vec3(0.3, 0.26, 0.18);
const vec3 LAWN = vec3(0.093, 0.127, 0.071);
const vec3 PLATING = vec3(0.1, 0.1, 0.095);
const vec3 STEEL = vec3(0.034, 0.05, 0.068);

vec3 fieldColor(float kind) {
  if (kind < 0.36) return PASTURE;
  if (kind < 0.66) return CROP;
  if (kind < 0.8) return GRAIN;
  if (kind < 0.9) return TILLED;
  return FALLOW;
}

// Farmland across a valley: q is (axial, across) in metres, f its footprint.
vec3 land(vec2 q, vec2 f, float seed) {
  float pixel = max(f.x, f.y);

  // Farms in staggered, gently curving rows, each divided into its own
  // fields, some sown in strips, all bounded by hedgerows.
  vec2 farmSize = vec2(900.0, 600.0);
  q.y += 70.0 * sin(q.x / 1700.0 + seed) + 30.0 * sin(q.x / 530.0);
  float row = floor(q.y / farmSize.y);
  vec2 farmQ = vec2(q.x + hash(vec2(row, seed)) * farmSize.x, q.y);
  vec2 farm = floor(farmQ / farmSize);
  vec2 local = farmQ - farm * farmSize;
  vec2 size = mix(vec2(120.0, 80.0), vec2(320.0, 220.0), vec2(hash(farm + 1.0), hash(farm + 2.0)));
  if (hash(farm + seed) > 0.5) size = size.yx;
  vec2 cell = floor(local / size);
  float kind = hash(cell + farm * 13.0 + seed);
  vec3 color = fieldColor(kind);
  float strips = 0.1 * step(0.34, kind) * (size.x > size.y
    ? lattice(local.y, 5.0, 22.0, f.y) : lattice(local.x, 5.0, 22.0, f.x));
  color *= 0.85 + 0.3 * hash(cell + farm + 3.1) - strips;
  color = mix(color, FIELD_MEAN, smoothstep(0.3, 1.0, max(f.x / size.x, f.y / size.y)));
  float hedge = max(
    max(lattice(local.x, 2.5, size.x, f.x), lattice(local.y, 2.5, size.y, f.y)),
    max(band(local.x, 5.0, f.x), band(local.y, 5.0, f.y))
  );
  color = mix(color, HEDGE, hedge);

  // Woods in irregular patches.
  float wood = valueNoise(q / 420.0 + seed * 9.0) + 0.4 * valueNoise(q / 130.0);
  color = mix(color, FOREST * (0.8 + 0.4 * valueNoise(q / 40.0)), smoothstep(1.0, 1.06, wood));
  color *= 0.85 + 0.3 * valueNoise(q / 900.0 + seed);

  // A pond in some kilometre-scale cells.
  vec2 pondCell = floor(q / vec2(1700.0, 1400.0));
  float pondChance = hash(pondCell + seed * 3.0);
  vec2 pondRadius = vec2(320.0, 170.0) * (0.4 + 0.6 * hash(pondCell + 9.0));
  vec2 pondCentre = (pondCell + 0.5) * vec2(1700.0, 1400.0)
    + (vec2(hash(pondCell + 5.0), hash(pondCell + 6.0)) - 0.5) * vec2(900.0, 600.0);
  float pond = (length((q - pondCentre) / pondRadius) - 1.0) * pondRadius.y;
  color = mix(color, WATER, step(pondChance, 0.25) * inside(pond, pixel));

  // A river meanders the valley's length.
  float riverX = 600.0 * sin(q.x / 2900.0 + seed) + 260.0 * sin(q.x / 1100.0 + 2.0 * seed);
  float riverHalfWidth = 26.0 + 10.0 * sin(q.x / 1700.0 + seed);
  color = mix(color, SAND, band(q.y - riverX, riverHalfWidth + 7.0, f.y));
  color = mix(color, WATER, band(q.y - riverX, riverHalfWidth, f.y));

  // Villages: houses in gardens along lanes, with ragged edges.
  vec2 villageCell = floor(q / vec2(2400.0, 1400.0));
  vec2 villageCentre = (villageCell + 0.5) * vec2(2400.0, 1400.0)
    + (vec2(hash(villageCell + seed), hash(villageCell + 2.0)) - 0.5) * vec2(1000.0, 500.0);
  float villageRadius = (140.0 + 160.0 * hash(villageCell + 4.0))
    * step(0.35, hash(villageCell + seed * 5.0))
    * (0.6 + 0.6 * valueNoise(q / 90.0));
  float village = inside(length(q - villageCentre) - villageRadius, pixel);
  if (village > 0.0) {
    vec2 lot = floor(q / 22.0);
    vec2 inLot = q - (lot + 0.5) * 22.0;
    float roofKind = hash(lot + seed);
    vec3 roof = roofKind < 0.45 ? vec3(0.4, 0.07, 0.03)
      : roofKind < 0.8 ? vec3(0.4, 0.37, 0.32) : vec3(0.06, 0.07, 0.08);
    float building = step(0.2, hash(lot + 11.0))
      * band(inLot.x, 7.0, f.x) * band(inLot.y, 6.0, f.y);
    vec3 houses = mix(PASTURE * 1.2, roof, building);
    houses = mix(houses, PAVING, max(lattice(q.x, 3.0, 110.0, f.x), lattice(q.y, 3.0, 88.0, f.y)));
    houses = mix(houses, vec3(0.2, 0.13, 0.08), smoothstep(6.0, 22.0, pixel));
    color = mix(color, houses, village);
  }

  // Service roads along the valley and across it at intervals.
  float road = max(
    band(abs(q.y) - 1350.0, 6.0, f.y),
    lattice(q.x + 300.0 * seed, 4.0, 2200.0, f.x)
  );
  color = mix(color, ROAD, road);
  return color;
}

// Flat cap coordinates, continuous where the azimuth wraps.
vec2 capPlate(float radius, float azimuth) {
  return radius * vec2(cos(radians(azimuth)), sin(radians(azimuth)));
}

// End-cap plating with radial ribs and rings, inside and out.
vec3 capPlating(float radius, float azimuth, float f) {
  float arc = radians(azimuth) * radius;
  float ribs = max(
    lattice(radius, 15.0, 500.0, f),
    lattice(arc, 12.0, radius * radians(10.0), f)
  );
  return PLATING * (1.0 + 0.8 * ribs)
    * (0.9 + 0.2 * valueNoise(capPlate(radius, azimuth) / 300.0));
}

// The steel hub at the axis.
vec3 capHub(vec3 color, float radius, float f) {
  return mix(color, STEEL, inside(radius - 260.0, f));
}

// End caps from inside: plating with valley land climbing it in terraces.
vec3 endCap(float radius, float azimuth, float f) {
  float offset = azimuth - VALLEY_SPACING * floor(azimuth / VALLEY_SPACING + 0.5);
  vec2 plate = capPlate(radius, azimuth);
  vec3 color = capPlating(radius, azimuth, f);
  float valley = radians(abs(offset) - 0.25 * VALLEY_SPACING) * radius;
  vec3 terraces = mix(PASTURE, FOREST, valueNoise(plate / 200.0))
    * (1.0 - 0.3 * lattice(radius, 6.0, 150.0, f));
  color = mix(color, terraces, inside(valley, f) * inside(0.7 * RADIUS - radius, f));
  return capHub(color, radius, f);
}
`;

/** The three mirrors, and the sunlight they reflect onto a surface. */
export const HABITAT_MIRROR_GLSL = /* glsl */ `
const float SUN_ANGULAR_RADIUS = ${SUN_ANGULAR_RADIUS};
// The mirror lighting each valley, and the sun's direction seen through it.
uniform vec3 uMirrorHinge[3];
uniform vec3 uMirrorNormal[3];
uniform vec3 uMirrorAlong[3];
uniform vec3 uMirrorAcross[3];
uniform vec3 uMirrorToSun[3];
uniform vec2 uMirrorSize;

// Sunlight on a shell point facing along normal: each mirror's rays reach
// it only if, looking toward that mirror's sun, it sees the mirror. A 32 km
// mirror so lights a band of its valley. The band's edge softens by the sun
// disc's width over the distance from the mirror.
float sunlit(vec3 position, vec3 normal, float pixel) {
  float light = 0.0;
  for (int i = 0; i < 3; i++) {
    float facing = dot(uMirrorToSun[i], uMirrorNormal[i]);
    float hitDistance = dot(uMirrorHinge[i] - position, uMirrorNormal[i]) / facing;
    if (facing >= 0.0 || hitDistance <= 0.0) continue;
    vec3 hit = position + uMirrorToSun[i] * hitDistance - uMirrorHinge[i];
    float along = dot(hit, uMirrorAlong[i]);
    float edge = min(
      min(along, uMirrorSize.x - along),
      uMirrorSize.y - abs(dot(hit, uMirrorAcross[i]))
    );
    // Both measured on the mirror: the sun's blur stretches by the mirror's
    // tilt (1 / sin α), and a floor pixel maps onto 2 cos α of mirror.
    float softness = max(
      pixel * 2.0 * sqrt(1.0 - facing * facing),
      2.0 * SUN_ANGULAR_RADIUS * hitDistance / -facing
    );
    light += max(dot(normal, uMirrorToSun[i]), 0.0)
      * clamp(edge / softness + 0.5, 0.0, 1.0);
  }
  return light;
}
`;

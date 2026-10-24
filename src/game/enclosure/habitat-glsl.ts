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
 * Valley land and end caps: parkland, woods, water, villages, and towns, as
 * the habitat-land-use research note describes. Needs the pattern chunk and
 * the RADIUS and VALLEY_SPACING defines.
 */
export const HABITAT_LAND_GLSL = /* glsl */ `
const vec3 FOREST = vec3(0.028, 0.042, 0.02);
const vec3 GRASS = vec3(0.07, 0.1, 0.04);
const vec3 MEADOW = vec3(0.11, 0.115, 0.05);
const vec3 LAWN = vec3(0.093, 0.127, 0.071);
const vec3 GARDEN = vec3(0.075, 0.105, 0.05);
const vec3 PATH = vec3(0.2, 0.18, 0.14);
const vec3 ROAD = vec3(0.17, 0.17, 0.16);
const vec3 PAVING = vec3(0.2, 0.19, 0.17);
const vec3 WATER = vec3(0.02, 0.04, 0.055);
const vec3 SHORE = vec3(0.16, 0.15, 0.09);
const vec3 TILE = vec3(0.3, 0.1, 0.05);
const vec3 PALE = vec3(0.3, 0.29, 0.26);
const vec3 SLATE = vec3(0.07, 0.075, 0.085);
const vec3 ROOF_MEAN = vec3(0.24, 0.16, 0.13);
const vec3 PLATING = vec3(0.1, 0.1, 0.095);
const vec3 STEEL = vec3(0.034, 0.05, 0.068);

// Falls View Park, the sunward end of valley 1 (azimuth 120°), stays rural:
// no settlement reaches beyond this axial distance from the midpoint.
const float PARK_SEED = 2.0;
const float PARK_FROM = 10000.0;

// Distance across the valley of its river and of its road.
float riverAcross(float axial, float seed) {
  return 600.0 * sin(axial / 2900.0 + seed) + 260.0 * sin(axial / 1100.0 + 2.0 * seed);
}
float roadAcross(float axial, float seed) {
  return 500.0 * sin(axial / 4100.0 + 2.0 * seed) + 180.0 * sin(axial / 1300.0 + seed);
}

// The settlement, if any, in q's cell of a row along the valley, as
// (distance from its edge, density at q): towns, villages, or hamlets. None
// reach into Falls View Park. Ragged, from 0 to 1, roughens the edge.
vec2 settlementIn(vec2 q, float spacing, float across, float jitter,
    vec2 radii, float chance, float ragged, float valley, float seed) {
  float cell = floor(q.x / spacing);
  vec2 centre = vec2(
    (cell + 0.5 + 0.25 * (hash(vec2(cell, seed)) - 0.5)) * spacing,
    across + (hash(vec2(seed, cell)) - 0.5) * jitter
  );
  if (abs(valley - PARK_SEED) < 0.5 && centre.x + 1.25 * radii.y > PARK_FROM) chance = 0.0;
  float radius = mix(radii.x, radii.y, hash(vec2(cell, seed + 4.0)))
    * step(hash(vec2(cell + 9.0, seed)), chance);
  float r = length(q - centre);
  return vec2(r - radius * (0.75 + 0.5 * ragged), 1.0 - r / max(radius, 1.0));
}

// Houses on lots along lanes, crowding into a town centre as density rises.
vec3 settlement(vec2 q, vec2 f, float density, float seed) {
  float pixel = max(f.x, f.y);
  float coreShare = smoothstep(0.5, 0.7, density);
  float core = step(0.6, density + 0.2 * (valueNoise(q / 50.0) - 0.5));
  // Village lanes wander; town streets run straight.
  vec2 w = q + (1.0 - core) * 10.0 * vec2(sin(q.y / 60.0), sin(q.x / 75.0));
  float lotSize = mix(22.0, 30.0, core);
  vec2 lot = floor(w / lotSize);
  vec2 inLot = w - (lot + 0.5) * lotSize;
  float kind = hash(lot + seed);
  vec3 roof = kind < mix(0.45, 0.2, core) ? TILE : kind < 0.75 ? PALE : SLATE;
  vec2 halfSize = lotSize * mix(vec2(0.2, 0.17), vec2(0.4, 0.36), density)
    * (0.8 + 0.3 * hash(lot + 5.0));
  vec2 offset = (vec2(hash(lot + 7.0), hash(lot + 8.0)) - 0.5)
    * max(lotSize - 2.0 * halfSize - 4.0, 0.0);
  float occupied = mix(0.4, 0.95, density);
  float built = step(hash(lot + 11.0), occupied)
    * band(inLot.x - offset.x, halfSize.x, f.x) * band(inLot.y - offset.y, halfSize.y, f.y);
  vec3 ground = mix(GARDEN * (0.8 + 0.4 * hash(lot + 3.0)), PAVING, 0.6 * core);
  vec3 color = mix(ground, roof, built);
  float streets = max(
    lattice(w.x, 2.5, 4.0 * lotSize, f.x),
    lattice(w.y, 2.5, 3.0 * lotSize, f.y)
  );
  color = mix(color, ROAD * 0.8, streets);
  // Far away, lots blend to their mean: roofs over gardens or paving, and
  // streets, which cover about 2.9 m per metre of lot.
  float meanLot = mix(22.0, 30.0, coreShare);
  vec2 meanHalf = meanLot * 0.95 * mix(vec2(0.2, 0.17), vec2(0.4, 0.36), density);
  float roofShare = occupied * 4.0 * meanHalf.x * meanHalf.y / (meanLot * meanLot);
  vec3 meanGround = mix(GARDEN, PAVING, 0.6 * coreShare);
  vec3 mean = mix(mix(meanGround, ROOF_MEAN, roofShare), ROAD * 0.8, 2.9 / meanLot);
  return mix(color, mean, smoothstep(0.3 * lotSize, lotSize, pixel));
}

// Valley land: q is (axial, across) in metres, f its footprint.
vec3 land(vec2 q, vec2 f, float seed) {
  float pixel = max(f.x, f.y);

  // Grass and meadow in broad, soft patches.
  float broad = valueNoise(q / 700.0 + seed * 7.0);
  float fine = valueNoise(q / 160.0 + seed);
  vec3 color = mix(GRASS, MEADOW, smoothstep(0.35, 0.75, broad)) * (0.85 + 0.3 * fine);

  // Woods in large, ragged stands, their crowns mottled up close.
  float wood = valueNoise(q / 520.0 + seed * 9.0) + 0.45 * valueNoise(q / 150.0 + seed);
  float crowns = pixel < 10.0
    ? mix(valueNoise(q / 7.0), 0.5, smoothstep(3.0, 10.0, pixel)) : 0.5;
  color = mix(color, FOREST * (0.7 + 0.6 * crowns), smoothstep(0.9, 0.95, wood));

  // Single trees across the parkland, thickening toward the woods.
  vec2 treeCell = floor(q / 30.0);
  vec2 treeAt = (treeCell + 0.25 + 0.5 * vec2(hash(treeCell + seed), hash(treeCell + 7.0))) * 30.0;
  float treeChance = 0.08 + 0.5 * smoothstep(0.7, 0.9, wood);
  float tree = step(hash(treeCell + 3.0), treeChance)
    * inside(length(q - treeAt) - 5.0, pixel);
  // Once the cells are sub-pixel, the trees blend to their mean cover.
  color = mix(color, FOREST, mix(tree, treeChance * 0.087, smoothstep(9.0, 30.0, pixel)));

  // Footpaths wind along the land's contours.
  float contour = (valueNoise(q / 650.0 + seed * 3.0) - 0.5) * 650.0;
  color = mix(color, PATH, band(contour, 1.5, pixel));

  // Towns on the valley road, villages on the river, and hamlets anywhere,
  // but none in Falls View Park.
  float road = roadAcross(q.x, seed);
  vec2 town = settlementIn(q, 2600.0, road, 300.0, vec2(300.0, 600.0), 0.8, fine, seed, seed);
  float villageAxial = (floor((q.x + 1300.0) / 2600.0) + 0.5) * 2600.0 - 1300.0;
  vec2 village = settlementIn(q + vec2(1300.0, 0.0), 2600.0, riverAcross(villageAxial, seed), 300.0,
    vec2(150.0, 320.0), 0.75, fine, seed, seed + 20.0);
  vec2 hamlet = settlementIn(q, 400.0, floor(q.y / 400.0) * 400.0 + 200.0, 200.0,
    vec2(30.0, 70.0), 0.12, fine, seed, seed + floor(q.y / 400.0) * 3.0);
  vec2 place = town.x < village.x ? town : village;
  place = hamlet.x < place.x ? vec2(hamlet.x, 0.0) : place;
  float built = inside(place.x, pixel);
  if (built > 0.0) {
    color = mix(color, settlement(q, f, clamp(place.y, 0.0, 1.0), seed), built);
  }

  // Lakes along the river, which meanders the valley's length.
  float river = riverAcross(q.x, seed);
  float lakeCell = floor(q.x / 3000.0);
  float lakeAxial = (lakeCell + 0.3 + 0.4 * hash(vec2(lakeCell, seed + 2.0))) * 3000.0;
  vec2 lakeCentre = vec2(lakeAxial, riverAcross(lakeAxial, seed));
  // Kept within the cell, as the centre stays 900 m from its ends.
  vec2 lakeRadius = mix(vec2(350.0, 150.0), vec2(750.0, 400.0), hash(vec2(seed, lakeCell + 3.0)));
  float lake = hash(vec2(lakeCell, seed + 6.0)) < 0.5
    ? (length((q - lakeCentre) / lakeRadius) - 1.0 + 0.3 * (valueNoise(q / 140.0) - 0.5)) * lakeRadius.y
    : 1e4;
  float riverHalfWidth = 26.0 + 10.0 * sin(q.x / 1700.0 + seed);
  float water = max(inside(lake, pixel), band(q.y - river, riverHalfWidth, f.y));
  float shore = max(inside(lake - 10.0, pixel), band(q.y - river, riverHalfWidth + 8.0, f.y));
  color = mix(color, SHORE, shore);
  color = mix(color, WATER, water);

  // The valley road, crossing the river on bridges.
  return mix(color, ROAD, band(q.y - road, 5.0, f.y));
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

// End caps from inside: plating with valley land climbing it in terraces,
// some lined with terraced housing.
vec3 endCap(float radius, float azimuth, float f) {
  float offset = azimuth - VALLEY_SPACING * floor(azimuth / VALLEY_SPACING + 0.5);
  vec2 plate = capPlate(radius, azimuth);
  vec3 color = capPlating(radius, azimuth, f);
  float valley = radians(abs(offset) - 0.25 * VALLEY_SPACING) * radius;
  vec3 terraces = mix(GRASS, FOREST, valueNoise(plate / 200.0));
  float ring = floor(radius / 150.0);
  float arc = radians(azimuth) * radius;
  float housing = step(hash(vec2(ring, floor(arc / 400.0))), 0.3)
    * lattice(radius - 105.0, 7.5, 150.0, f)
    * (1.0 - lattice(arc, 3.0, 14.0, f));
  float house = hash(vec2(ring, floor(arc / 14.0)));
  vec3 roof = mix(ROOF_MEAN, house < 0.4 ? TILE : house < 0.75 ? PALE : SLATE, 0.4);
  terraces = mix(terraces, roof, 0.8 * housing);
  terraces *= 1.0 - 0.3 * lattice(radius, 6.0, 150.0, f);
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

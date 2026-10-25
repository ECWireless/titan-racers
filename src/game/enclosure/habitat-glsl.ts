import {
  CANOPY_HEIGHT,
  FALLS_LAKE,
  HILL_HEIGHT,
  HUB_RADIUS,
  PARK,
  ROOF_ALBEDOS,
  TERRACE_REACH,
} from "./habitat-land";
import { SUN_ANGULAR_RADIUS } from "./island-three";

/** A number as a GLSL float literal. */
export const glslFloat = (value: number) =>
  Number.isInteger(value) ? value.toFixed(1) : `${value}`;

export const glslVec3 = (value: readonly number[]) =>
  `vec3(${value.map(glslFloat).join(", ")})`;

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

// Value noise and its gradient per unit of p.
vec3 valueNoiseGradient(vec2 p) {
  vec2 cell = floor(p);
  vec2 f = fract(p);
  vec2 u = f * f * (3.0 - 2.0 * f);
  vec2 du = 6.0 * f * (1.0 - f);
  float a = hash(cell);
  float b = hash(cell + vec2(1.0, 0.0));
  float c = hash(cell + vec2(0.0, 1.0));
  float d = hash(cell + vec2(1.0));
  float k = a - b - c + d;
  return vec3(
    a + (b - a) * u.x + (c - a) * u.y + k * u.x * u.y,
    du * vec2(b - a + k * u.y, c - a + k * u.x)
  );
}

// smoothstep(edge0, edge1, x), and its derivative along x.
vec2 ramp(float edge0, float edge1, float x) {
  float t = clamp((x - edge0) / (edge1 - edge0), 0.0, 1.0);
  return vec2(t * t * (3.0 - 2.0 * t), 6.0 * t * (1.0 - t) / (edge1 - edge0));
}

// The product of two (value, gradient) fields.
vec3 times(vec3 a, vec3 b) {
  return vec3(a.x * b.x, a.yz * b.x + a.x * b.yz);
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
 * the habitat-land-use research note describes, and the land's relief.
 * Needs the pattern chunk and the RADIUS, HALF_LENGTH, and VALLEY_SPACING
 * defines. habitat-land.ts mirrors the layout on the CPU.
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
const vec3 TILE = ${glslVec3(ROOF_ALBEDOS[0])};
const vec3 PALE = ${glslVec3(ROOF_ALBEDOS[1])};
const vec3 SLATE = ${glslVec3(ROOF_ALBEDOS[2])};
const vec3 ROOF_MEAN = vec3(0.24, 0.16, 0.13);
const vec3 PLATING = vec3(0.1, 0.1, 0.095);
const vec3 STEEL = vec3(0.034, 0.05, 0.068);

// Falls View Park, the sunward end of valley 1 (azimuth 120°), stays rural:
// no settlement reaches beyond this axial distance from the midpoint. Its
// lake lies below the sunward terraces.
const float PARK_SEED = ${glslFloat(PARK.seed)};
const float PARK_FROM = ${glslFloat(PARK.from)};
const vec2 FALLS_LAKE_CENTRE = vec2(${glslFloat(FALLS_LAKE.axial)}, ${glslFloat(FALLS_LAKE.across)});
const vec2 FALLS_LAKE_RADII = vec2(${glslFloat(FALLS_LAKE.radii[0])}, ${glslFloat(FALLS_LAKE.radii[1])});
const float FALLS_FLAT_BEYOND = ${glslFloat(FALLS_LAKE.flatBeyond)};

// Rolling hills, as the habitat-land-use note sets out. Woods' canopy rises
// as relief where no real trees stand. The end caps' terraces reach this far
// into each valley.
const float HILL_HEIGHT = ${glslFloat(HILL_HEIGHT)};
const float CANOPY_HEIGHT = ${glslFloat(CANOPY_HEIGHT)};
const float TERRACE_REACH = ${glslFloat(TERRACE_REACH)};
const float HUB_RADIUS = ${glslFloat(HUB_RADIUS)};
const float VALLEY_HALF_WIDTH = 0.25 * VALLEY_SPACING * 0.017453293 * RADIUS;

// Distance across the valley of its river and of its road.
float riverAcross(float axial, float seed) {
  return 600.0 * sin(axial / 2900.0 + seed) + 260.0 * sin(axial / 1100.0 + 2.0 * seed);
}
float riverSlope(float axial, float seed) {
  return 600.0 / 2900.0 * cos(axial / 2900.0 + seed)
    + 260.0 / 1100.0 * cos(axial / 1100.0 + 2.0 * seed);
}
float roadAcross(float axial, float seed) {
  return 500.0 * sin(axial / 4100.0 + 2.0 * seed) + 180.0 * sin(axial / 1300.0 + seed);
}

// The settlement, if any, in q's cell of a row along the valley, as
// (distance from its edge, density at q, and the distance's gradient
// ignoring the edge's roughness): towns, villages, or hamlets. None reach
// into Falls View Park. Ragged, from 0 to 1, roughens the edge.
vec4 settlementIn(vec2 q, float spacing, float across, float jitter,
    vec2 radii, float chance, float ragged, float valley, float seed) {
  float cell = floor(q.x / spacing);
  vec2 centre = vec2(
    (cell + 0.5 + 0.25 * (hash(vec2(cell, seed)) - 0.5)) * spacing,
    across + (hash(vec2(seed, cell)) - 0.5) * jitter
  );
  if (abs(valley - PARK_SEED) < 0.5 && centre.x + 1.25 * radii.y > PARK_FROM) chance = 0.0;
  if (hash(vec2(cell + 9.0, seed)) > chance) return vec4(1e4, 0.0, 0.0, 0.0);
  float radius = mix(radii.x, radii.y, hash(vec2(cell, seed + 4.0)));
  float r = length(q - centre);
  return vec4(r - radius * (0.75 + 0.5 * ragged), 1.0 - r / max(radius, 1.0),
    (q - centre) / max(r, 1e-3));
}

// The nearer town or village: towns on the valley road and villages on the
// river, but none in Falls View Park. As settlementIn.
vec4 townAt(vec2 q, float seed, float ragged) {
  vec4 town = settlementIn(q, 2600.0, roadAcross(q.x, seed), 300.0, vec2(300.0, 600.0), 0.8,
    ragged, seed, seed);
  float villageAxial = (floor((q.x + 1300.0) / 2600.0) + 0.5) * 2600.0 - 1300.0;
  vec4 village = settlementIn(q + vec2(1300.0, 0.0), 2600.0, riverAcross(villageAxial, seed), 300.0,
    vec2(150.0, 320.0), 0.75, ragged, seed, seed + 20.0);
  return town.x < village.x ? town : village;
}

// The nearest settlement, counting hamlets anywhere, which have no density.
vec4 placeAt(vec4 town, vec2 q, float seed, float ragged) {
  vec4 hamlet = settlementIn(q, 400.0, floor(q.y / 400.0) * 400.0 + 200.0, 200.0,
    vec2(30.0, 70.0), 0.12, ragged, seed, seed + floor(q.y / 400.0) * 3.0);
  return hamlet.x < town.x ? vec4(hamlet.x, 0.0, hamlet.zw) : town;
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

// Distance outside an elliptical lake's shore (negative inside), and its
// gradient ignoring the shore's wobble.
vec3 lakeShore(vec2 q, vec2 centre, vec2 radii, float wobble) {
  vec2 v = (q - centre) / radii;
  float r = max(length(v), 1e-3);
  return vec3((r - 1.0 + wobble) * radii.y, v / (r * radii) * radii.y);
}

// Lakes along the river, which meanders the valley's length, and the falls
// lake in Falls View Park.
vec3 lakeEdge(vec2 q, float seed) {
  float lakeCell = floor(q.x / 3000.0);
  float lakeAxial = (lakeCell + 0.3 + 0.4 * hash(vec2(lakeCell, seed + 2.0))) * 3000.0;
  // Kept within the cell, as the centre stays 900 m from its ends.
  vec2 lakeRadius = mix(vec2(350.0, 150.0), vec2(750.0, 400.0), hash(vec2(seed, lakeCell + 3.0)));
  float wobble = 0.3 * (valueNoise(q / 140.0) - 0.5);
  vec3 lake = hash(vec2(lakeCell, seed + 6.0)) < 0.5
    ? lakeShore(q, vec2(lakeAxial, riverAcross(lakeAxial, seed)), lakeRadius, wobble)
    : vec3(1e4, 0.0, 0.0);
  if (abs(seed - PARK_SEED) < 0.5) {
    // A smooth shore, so the lake surely meets the falls' plunge pool.
    vec3 falls = lakeShore(q, FALLS_LAKE_CENTRE, FALLS_LAKE_RADII, 0.0);
    if (falls.x < lake.x) lake = falls;
  }
  return lake;
}

// Distance from open water, and its gradient: the river or a lake.
vec3 nearerWater(vec2 q, float seed, float river, float riverHalfWidth, vec3 lake) {
  vec3 bank = vec3(abs(river) - riverHalfWidth, sign(river) * vec2(-riverSlope(q.x, seed), 1.0));
  return lake.x < bank.x ? lake : bank;
}

// What the land's colour and relief share at q.
struct Land {
  vec3 wood;  // woodland index, painted as woods from 0.9, and its gradient
  float fine;  // fine variation
  float road;  // offset across from the valley road
  float river;  // offset across from the river's centre line
  float riverHalfWidth;
  vec3 lake;  // distance outside the nearest lake, and its gradient
  vec4 town;  // nearer town or village, as townAt gives it
  vec4 place;  // nearest settlement, as placeAt gives it
};

Land landAt(vec2 q, float seed) {
  Land l;
  vec3 broadWood = valueNoiseGradient(q / 520.0 + seed * 9.0);
  vec3 fineWood = valueNoiseGradient(q / 150.0 + seed);
  l.wood = vec3(broadWood.x, broadWood.yz / 520.0)
    + 0.45 * vec3(fineWood.x, fineWood.yz / 150.0);
  l.fine = valueNoise(q / 160.0 + seed);
  l.road = q.y - roadAcross(q.x, seed);
  l.river = q.y - riverAcross(q.x, seed);
  l.riverHalfWidth = 26.0 + 10.0 * sin(q.x / 1700.0 + seed);
  l.lake = lakeEdge(q, seed);
  l.town = townAt(q, seed, l.fine);
  l.place = placeAt(l.town, q, seed, l.fine);
  return l;
}

// Valley land's albedo: q is (axial, across) in metres, f its footprint.
vec3 landColor(Land l, vec2 q, vec2 f, float seed) {
  float pixel = max(f.x, f.y);

  // Grass and meadow in broad, soft patches.
  float broad = valueNoise(q / 700.0 + seed * 7.0);
  vec3 color = mix(GRASS, MEADOW, smoothstep(0.35, 0.75, broad)) * (0.85 + 0.3 * l.fine);

  // Woods in large, ragged stands, their crowns mottled up close.
  float wood = l.wood.x;
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

  float built = inside(l.place.x, pixel);
  if (built > 0.0) {
    color = mix(color, settlement(q, f, clamp(l.place.y, 0.0, 1.0), seed), built);
  }

  float water = max(inside(l.lake.x, pixel), band(l.river, l.riverHalfWidth, f.y));
  float shore = max(inside(l.lake.x - 10.0, pixel), band(l.river, l.riverHalfWidth + 8.0, f.y));
  color = mix(color, SHORE, shore);
  color = mix(color, WATER, water);

  // The valley road, crossing the river on bridges.
  return mix(color, ROAD, band(l.road, 5.0, f.y));
}

// Street lamps along the valley road and through settlements, as luminance
// in cd/m² seen from afar. Each lamp is a point of LAMP_CANDELA drawn as a
// dot at least a pixel wide that spreads its light, so a distant lamp keeps
// its total light; once lamps are a few pixels apart they blend to their
// mean. None stand on water.
const float LAMP_CANDELA = 1000.0;
// Warm white, about 3000 K, at unit luminance.
const vec3 LAMP_TINT = vec3(1.82, 0.83, 0.27);
const float ROAD_LAMP_SPACING = 40.0;
const float ROAD_LAMP_SETBACK = 6.0;
const float VILLAGE_LAMP_SPACING = 30.0;

// The antialiased dot covers π(r² + pixel²/12) on average.
float lampDot(vec2 offset, float pixel) {
  float r = max(0.25, 0.5 * pixel);
  return LAMP_CANDELA / (3.14159 * (r * r + pixel * pixel / 12.0))
    * inside(length(offset) - r, pixel);
}

float lampLight(Land l, vec2 q, float pixel, float seed) {
  float along = mod(q.x, ROAD_LAMP_SPACING) - 0.5 * ROAD_LAMP_SPACING;
  float road = mix(
    lampDot(vec2(along, abs(l.road) - ROAD_LAMP_SETBACK), pixel),
    band(l.road, ROAD_LAMP_SETBACK, pixel) * LAMP_CANDELA
      / (ROAD_LAMP_SPACING * ROAD_LAMP_SETBACK),
    smoothstep(0.1, 0.4, pixel / ROAD_LAMP_SPACING)
  );
  float built = inside(l.place.x, pixel)
    * (1.0 - max(inside(l.lake.x, pixel), band(l.river, l.riverHalfWidth, pixel)));
  if (built <= 0.0) return road;
  vec2 cell = floor(q / VILLAGE_LAMP_SPACING);
  vec2 at = (cell + 0.2 + 0.6 * vec2(hash(cell + seed * 5.0), hash(cell + 11.0)))
    * VILLAGE_LAMP_SPACING;
  float chance = 0.35 + 0.65 * clamp(l.place.y, 0.0, 1.0);
  float lit = step(hash(cell + 17.0 + seed), chance);
  float village = mix(
    lit * lampDot(q - at, pixel),
    chance * LAMP_CANDELA / (VILLAGE_LAMP_SPACING * VILLAGE_LAMP_SPACING),
    smoothstep(0.1, 0.4, pixel / VILLAGE_LAMP_SPACING)
  );
  return road + built * village;
}

// Height of the land above the floor in metres, with its gradient along
// (axial, across). Hills settle flat toward water, the windows, and the
// end-cap terraces, under settlements, and around the falls lake's bridge;
// keep, a (value, gradient) field, flattens them further, as around a
// course. Canopy, from 0 to 1, raises the woods' canopy.
vec3 landRelief(Land l, vec2 q, float seed, vec3 keep, float canopy) {
  vec3 a = valueNoiseGradient(q / 1400.0 + seed * 5.0);
  vec3 b = valueNoiseGradient(q / 600.0 + seed * 11.0);
  vec3 c = valueNoiseGradient(q / 260.0 + seed * 13.0);
  vec3 n = vec3(
    0.6 * a.x + 0.3 * b.x + 0.1 * c.x,
    0.6 * a.yz / 1400.0 + 0.3 * b.yz / 600.0 + 0.1 * c.yz / 260.0
  );
  vec2 rise = ramp(0.25, 0.95, n.x);
  vec3 water = nearerWater(q, seed, l.river, l.riverHalfWidth, l.lake);
  vec2 shore = ramp(30.0, 300.0, water.x);
  vec2 edge = ramp(100.0, 500.0, VALLEY_HALF_WIDTH - abs(q.y));
  vec2 cap = ramp(150.0, 700.0, HALF_LENGTH - TERRACE_REACH - abs(q.x));
  // Hills settle flat under towns and villages, where buildings stand.
  vec2 built = ramp(0.0, 150.0, l.town.x);
  vec3 bridge = vec3(1.0, 0.0, 0.0);
  if (abs(seed - PARK_SEED) < 0.5) {
    vec3 falls = lakeShore(q, FALLS_LAKE_CENTRE, FALLS_LAKE_RADII, 0.0);
    vec2 clear = ramp(FALLS_FLAT_BEYOND, FALLS_FLAT_BEYOND + 300.0, falls.x);
    bridge = vec3(clear.x, clear.y * falls.yz);
  }
  vec3 settle = times(
    times(vec3(shore.x, shore.y * water.yz), vec3(edge.x, 0.0, -sign(q.y) * edge.y)),
    times(vec3(cap.x, -sign(q.x) * cap.y, 0.0), vec3(built.x, built.y * l.town.zw))
  );
  settle = times(settle, bridge);
  vec3 relief = times(times(HILL_HEIGHT * vec3(rise.x, rise.y * n.yz), settle), keep);
  // The canopy stands clear of water, the road, settlements, and the bridge.
  vec2 cover = ramp(0.88, 0.97, l.wood.x);
  float open = canopy * edge.x * cap.x * bridge.x * smoothstep(10.0, 40.0, water.x)
    * smoothstep(8.0, 20.0, abs(l.road)) * smoothstep(0.0, 30.0, l.place.x);
  return relief + CANOPY_HEIGHT * open * vec3(cover.x, cover.y * l.wood.yz);
}

// The floor's hills alone, where no colour is needed.
float hillHeight(vec2 q, float seed, vec3 keep) {
  Land l;
  l.wood = vec3(0.0);
  l.fine = valueNoise(q / 160.0 + seed);
  l.river = q.y - riverAcross(q.x, seed);
  l.riverHalfWidth = 26.0 + 10.0 * sin(q.x / 1700.0 + seed);
  l.lake = lakeEdge(q, seed);
  l.road = 1e4;
  l.town = townAt(q, seed, l.fine);
  l.place = l.town;
  return landRelief(l, q, seed, keep, 0.0).x;
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
  return mix(color, STEEL, inside(radius - HUB_RADIUS, f));
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

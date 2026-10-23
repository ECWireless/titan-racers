import * as pc from "playcanvas";

import {
  AEROSOL_EXTINCTION,
  AIR_GLOW,
  CLEARING_RADIUS,
  type HabitatLight,
  RAYLEIGH_EXTINCTION,
} from "./habitat-light";
import { type CourseEnclosure, getEnclosureFrame } from "./island-three";

// Island Three draws in its own pass, before the course, so the course keeps
// its own depth range and draws on top. The shell (floors, caps, and window
// glass) is convex around the camera, so it needs no depth at all: every
// pixel sees exactly one shell surface. Only the window frames test depth.
const NEAR_CLIP = 1;
const FAR_CLIP = 80_000;
const AXIAL_SEGMENTS = 4;
const FLOOR_SEGMENT_DEGREES = 0.5;
const WINDOW_SEGMENT_DEGREES = 2;
const CAP_RING_COUNT = 6;
const RING_FRAME_SPACING = 1_000;
const RING_SEGMENT_DEGREES = 5;
const LONGERON_SPACING_DEGREES = 10;
// Frames are sized to read from kilometres away, not to the sources' panes.
const FRAME = { depth: 40, width: 30 };
const SILL = { depth: 60, width: 60 };

type Vector3 = { x: number; y: number; z: number };

const COMMON_VS = /* glsl */ `
attribute vec3 vertex_position;
uniform mat4 matrix_model;
uniform mat4 matrix_viewProjection;
varying vec3 vWorld;
#ifdef FRAME_COLOR
attribute vec4 vertex_color;
varying vec3 vColor;
#endif
void main(void) {
  vec4 world = matrix_model * vec4(vertex_position, 1.0);
  vWorld = world.xyz;
#ifdef FRAME_COLOR
  vColor = vertex_color.rgb;
#endif
  gl_Position = matrix_viewProjection * world;
}
`;

// Cylinder coordinates, sunlight, and half-pressure air shared by every
// enclosure surface. Lengths are metres; azimuth is degrees, spinward.
const COMMON_PS = /* glsl */ `
#include "gammaPS"
#include "tonemappingPS"
uniform vec3 view_position;
uniform vec3 uAxisMid;
uniform vec3 uSunward;
uniform vec3 uOutward0;
uniform vec3 uOutward90;
uniform vec3 uSunDirection;
uniform vec3 uSunColor;
// The mirror lighting each valley, and the sun's direction seen through it.
uniform vec3 uMirrorHinge[3];
uniform vec3 uMirrorNormal[3];
uniform vec3 uMirrorAlong[3];
uniform vec3 uMirrorAcross[3];
uniform vec3 uMirrorToSun[3];
uniform vec2 uMirrorSize;
uniform vec3 uRayleighExtinction;
uniform float uAerosolExtinction;
varying vec3 vWorld;

// Moisture and dust scatter nearly evenly across colours.
const vec3 AEROSOL_TINT = vec3(0.95, 1.0, 1.05);
// Brightness of sunlit air relative to the sunlight itself, and its glow
// toward the sun's image.
uniform float uAirGlow;
uniform float uSunGlow;
// The habitat's own diffuse light on its surfaces.
uniform vec3 uFill;

vec3 cylinderCoordinates(vec3 position) {
  vec3 fromAxis = position - uAxisMid;
  float axial = dot(fromAxis, uSunward);
  vec3 radial = fromAxis - axial * uSunward;
  float azimuth = degrees(atan(dot(radial, uOutward90), dot(radial, uOutward0)));
  return vec3(axial, azimuth, length(radial));
}

// Pixel footprint in metres, along the axis and around it.
vec2 footprint(vec3 position) {
  vec3 fromAxis = position - uAxisMid;
  float axial = dot(fromAxis, uSunward);
  return vec2(fwidth(axial), length(fwidth(fromAxis - axial * uSunward)));
}

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

// Air glows with scattered sunlight, brightest toward the sun's image while
// the course stands in the mirror's beam.
vec3 throughAir(vec3 color, vec3 toSurface) {
  float distance = length(toSurface);
  vec3 transmit = exp(
    -(uRayleighExtinction + AEROSOL_TINT * uAerosolExtinction) * distance
  );
  float toSun = max(dot(toSurface / distance, uSunDirection), 0.0);
  vec3 airLight = uSunColor * (uAirGlow + uSunGlow * pow(toSun, 32.0));
  return color * transmit + airLight * (1.0 - transmit);
}

vec4 finish(vec3 color) {
  return vec4(gammaCorrectOutput(toneMap(color)), 1.0);
}
`;

const SHELL_PS = /* glsl */ `
uniform vec3 uClearing;

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

// End caps: plated structure with radial ribs and rings, valley land
// climbing them in terraces, and a hub at the axis.
vec3 endCap(float radius, float azimuth, float f) {
  float offset = azimuth - VALLEY_SPACING * floor(azimuth / VALLEY_SPACING + 0.5);
  float arc = radians(azimuth) * radius;
  // Flat cap coordinates, continuous where the azimuth wraps.
  vec2 plate = radius * vec2(cos(radians(azimuth)), sin(radians(azimuth)));
  float ribs = max(
    lattice(radius, 15.0, 500.0, f),
    lattice(arc, 12.0, radius * radians(10.0), f)
  );
  vec3 color = PLATING * (1.0 + 0.8 * ribs) * (0.9 + 0.2 * valueNoise(plate / 300.0));
  float valley = radians(abs(offset) - 0.25 * VALLEY_SPACING) * radius;
  vec3 terraces = mix(PASTURE, FOREST, valueNoise(plate / 200.0))
    * (1.0 - 0.3 * lattice(radius, 6.0, 150.0, f));
  color = mix(color, terraces, inside(valley, f) * inside(0.7 * RADIUS - radius, f));
  return mix(color, STEEL, inside(radius - 260.0, f));
}

// Sunlight on a shell point facing along normal: each mirror's rays reach
// it only if, looking toward that mirror's sun, it sees the mirror. A 32 km
// mirror so lights a band of its valley. The band's edge softens by the sun
// disc's half-degree width over the distance from the mirror.
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
      0.0093 * hitDistance / -facing
    );
    light += max(dot(normal, uMirrorToSun[i]), 0.0)
      * clamp(edge / softness + 0.5, 0.0, 1.0);
  }
  return light;
}

void main(void) {
  vec3 c = cylinderCoordinates(vWorld);
  vec2 f = footprint(vWorld);
  vec3 albedo;
  vec3 normal;
  if (abs(c.x) > HALF_LENGTH - 1.0) {
    albedo = endCap(c.z, c.y, f.y);
    normal = -sign(c.x) * uSunward;
  } else {
    float valley = floor(c.y / VALLEY_SPACING + 0.5);
    float offset = c.y - valley * VALLEY_SPACING;
    albedo = land(vec2(c.x, radians(offset) * RADIUS), f, mod(valley, 3.0) + 1.0);
    // The course sits in a mown clearing.
    float clearingTurn = mod(c.y - uClearing.y + 180.0, 360.0) - 180.0;
    vec2 toClearing = vec2(c.x - uClearing.x, radians(clearingTurn) * RADIUS);
    albedo = mix(albedo, LAWN, inside(length(toClearing) - uClearing.z, max(f.x, f.y) + 40.0));
    vec3 fromAxis = vWorld - uAxisMid;
    normal = -normalize(fromAxis - dot(fromAxis, uSunward) * uSunward);
  }
  float sunLight = sunlit(vWorld, normal, max(f.x, f.y));
  vec3 color = albedo * (uSunColor * sunLight + uFill);
  gl_FragColor = finish(throughAir(color, vWorld - view_position));
}
`;

const WINDOW_PS = /* glsl */ `

// The sun's angular radius, and its brightness relative to its light.
const float SUN_COS = 0.99998911;
const float SUN_RADIANCE = 60.0;

// What a view ray sees beyond the glass: a mirror, the sun in it, or space.
vec3 beyond(vec3 origin, vec3 direction, float pixelAngle) {
  float nearest = 1e9;
  vec3 color = vec3(0.0);
  for (int i = 0; i < 3; i++) {
    vec3 normal = uMirrorNormal[i];
    float facing = dot(direction, normal);
    float hitDistance = dot(uMirrorHinge[i] - origin, normal) / facing;
    if (hitDistance <= 0.0 || hitDistance >= nearest) continue;
    vec3 hit = origin + direction * hitDistance - uMirrorHinge[i];
    float along = dot(hit, uMirrorAlong[i]);
    float across = abs(dot(hit, uMirrorAcross[i]));
    if (along < 0.0 || along > uMirrorSize.x || across > uMirrorSize.y) continue;
    nearest = hitDistance;
    if (facing > 0.0) {
      color = vec3(0.01);
      continue;
    }
    // Dusty mirror film scatters some sunlight; panel seams and an edge
    // frame give it structure.
    vec3 reflected = reflect(direction, normal);
    float toSun = dot(reflected, uSunward);
    float sunDisc = smoothstep(SUN_COS - 4e-6, SUN_COS + 2e-6, toSun);
    float pixel = (length(origin - view_position) + hitDistance) * pixelAngle / -facing;
    float seams = max(
      lattice(along, 6.0, 1000.0, pixel),
      lattice(across, 6.0, 500.0, pixel)
    );
    float edge = min(uMirrorSize.y - across, min(along, uMirrorSize.x - along));
    color = uSunColor * (0.18 * (1.0 - 0.7 * seams) + SUN_RADIANCE * sunDisc
      + 0.8 * pow(max(toSun, 0.0), 3000.0));
    color = mix(color, uSunColor * 0.6, inside(edge - 80.0, pixel));
  }
  return color;
}

void main(void) {
  vec3 c = cylinderCoordinates(vWorld);
  float arc = radians(c.y) * RADIUS;
  vec2 f = footprint(vWorld);
  vec3 toGlass = vWorld - view_position;
  vec3 direction = normalize(toGlass);
  vec3 color = beyond(vWorld, direction, length(fwidth(direction))) * 0.9;
  // Panes between the frames, in thin mullions that fade once sub-pixel.
  float mullions = max(
    lattice(c.x, 4.0, 250.0, f.x),
    lattice(arc, 4.0, RADIUS * radians(2.5), f.y)
  );
  color = mix(color, vec3(0.06, 0.07, 0.08), mullions);
  gl_FragColor = finish(throughAir(color, toGlass));
}
`;

const FRAME_PS = /* glsl */ `
varying vec3 vColor;

void main(void) {
  // Sunlight reaches the frames' outer faces; these inner faces see the sky.
  vec3 color = vColor * uFill;
  gl_FragColor = finish(throughAir(color, vWorld - view_position));
}
`;

function createMaterial(
  name: string,
  fragment: string,
  constants: Record<string, number>,
  options: { frameColor?: boolean } = {},
) {
  const constantDefines = Object.entries(constants)
    .map(
      ([key, value]) =>
        `#define ${key} ${Number.isInteger(value) ? value.toFixed(1) : value}\n`,
    )
    .join("");
  const defines = options.frameColor ? "#define FRAME_COLOR\n" : "";
  const material = new pc.ShaderMaterial({
    attributes: {
      vertex_position: pc.SEMANTIC_POSITION,
      ...(options.frameColor ? { vertex_color: pc.SEMANTIC_COLOR } : {}),
    },
    fragmentGLSL: constantDefines + COMMON_PS + fragment,
    uniqueName: `enclosure-${name}`,
    vertexGLSL: defines + COMMON_VS,
  });
  material.cull = pc.CULLFACE_NONE;
  return material;
}

class MeshBuilder {
  readonly positions: number[] = [];
  readonly colors: number[] = [];
  readonly indices: number[] = [];

  /** A grid of quads over (rows + 1) × (columns + 1) points. */
  grid(
    rows: number,
    columns: number,
    point: (row: number, column: number) => Vector3,
  ) {
    const start = this.positions.length / 3;
    for (let row = 0; row <= rows; row++) {
      for (let column = 0; column <= columns; column++) {
        const { x, y, z } = point(row, column);
        this.positions.push(x, y, z);
      }
    }
    for (let row = 0; row < rows; row++) {
      for (let column = 0; column < columns; column++) {
        const a = start + row * (columns + 1) + column;
        const b = a + columns + 1;
        this.indices.push(a, b, a + 1, a + 1, b, b + 1);
      }
    }
  }

  /** One flat-colored face strip through pairs of points. */
  strip(points: [Vector3, Vector3][], shade: number) {
    const start = this.positions.length / 3;
    points.forEach((pair) =>
      pair.forEach(({ x, y, z }) => {
        this.positions.push(x, y, z);
        this.colors.push(shade, shade, shade, 255);
      }),
    );
    for (let i = 0; i < points.length - 1; i++) {
      const a = start + i * 2;
      this.indices.push(a, a + 1, a + 2, a + 2, a + 1, a + 3);
    }
  }

  build(device: pc.GraphicsDevice) {
    const mesh = new pc.Mesh(device);
    mesh.setPositions(this.positions);
    if (this.colors.length > 0) mesh.setColors32(this.colors);
    mesh.setIndices(this.indices);
    mesh.update(pc.PRIMITIVE_TRIANGLES, false);
    return mesh;
  }
}

/** Evenly spaced values from start to end, about `step` apart. */
function steps(start: number, end: number, step: number) {
  const count = Math.max(1, Math.round(Math.abs(end - start) / step));
  return Array.from({ length: count + 1 }, (_, i) => start + ((end - start) * i) / count);
}

/**
 * Draws the course's Island Three enclosure behind everything else, from a
 * camera that follows the race camera with its own clip range. Returns a
 * cleanup that releases every resource it created.
 */
export function createEnclosureView(
  app: pc.AppBase,
  raceCamera: pc.Entity,
  enclosure: CourseEnclosure,
  habitat: HabitatLight,
) {
  const frame = getEnclosureFrame(enclosure);
  const { length, radius, valleyCount } = frame.definition;
  const halfLength = length / 2;
  const spacing = 360 / valleyCount;
  const stripWidth = spacing / 2;
  const valleyCentres = Array.from({ length: valleyCount }, (_, k) => k * spacing);
  const device = app.graphicsDevice;
  const { axial, azimuth } = enclosure.placement;

  const shell = new MeshBuilder();
  const glass = new MeshBuilder();
  const frames = new MeshBuilder();
  const axials = steps(-halfLength, halfLength, length / AXIAL_SEGMENTS);
  const capRadii = steps(0, radius, radius / CAP_RING_COUNT);
  // Each strip and the cap sectors at its ends share their rim points
  // exactly, so no hairline cracks open where the caps meet the wall.
  const surface = (
    builder: MeshBuilder,
    from: number,
    segmentDegrees: number,
  ) => {
    const azimuths = steps(from, from + stripWidth, segmentDegrees);
    builder.grid(axials.length - 1, azimuths.length - 1, (row, column) =>
      frame.point(axials[row], azimuths[column], radius),
    );
    [-halfLength, halfLength].forEach((capAxial) =>
      shell.grid(capRadii.length - 1, azimuths.length - 1, (row, column) =>
        frame.point(capAxial, azimuths[column], capRadii[row]),
      ),
    );
  };
  valleyCentres.forEach((centre) => {
    surface(shell, centre - stripWidth / 2, FLOOR_SEGMENT_DEGREES);
    surface(glass, centre + stripWidth / 2, WINDOW_SEGMENT_DEGREES);
  });

  // Frames carry the windows' pressure load: heavy sills along each window
  // edge, lighter longerons along its length, and ring frames across it.
  const beam = (
    path: { axial: number; azimuth: number }[],
    side: (at: { axial: number; azimuth: number }) => Vector3,
    { depth, width }: { depth: number; width: number },
  ) => {
    const corners = path.map((at) => {
      const outer = frame.point(at.axial, at.azimuth, radius);
      const inner = frame.point(at.axial, at.azimuth, radius - depth);
      const offset = side(at);
      const shift = (point: Vector3, scale: number) => ({
        x: point.x + offset.x * scale,
        y: point.y + offset.y * scale,
        z: point.z + offset.z * scale,
      });
      return [
        shift(outer, -width / 2),
        shift(inner, -width / 2),
        shift(inner, width / 2),
        shift(outer, width / 2),
      ];
    });
    frames.strip(corners.map((c) => [c[0], c[1]]), 65);
    frames.strip(corners.map((c) => [c[1], c[2]]), 90);
    frames.strip(corners.map((c) => [c[2], c[3]]), 65);
  };
  const across = (at: { azimuth: number }) => frame.outward(at.azimuth + 90);
  const along = () => frame.sunward;
  valleyCentres.forEach((centre) => {
    const start = centre + stripWidth / 2;
    const longeron = (at: number, size: typeof FRAME) =>
      beam(
        [
          { axial: -halfLength, azimuth: at },
          { axial: halfLength, azimuth: at },
        ],
        across,
        size,
      );
    longeron(start, SILL);
    longeron(start + stripWidth, SILL);
    steps(start, start + stripWidth, LONGERON_SPACING_DEGREES)
      .slice(1, -1)
      .forEach((at) => longeron(at, FRAME));
    const ringEnd = halfLength - FRAME.width / 2;
    steps(-ringEnd, ringEnd, RING_FRAME_SPACING).forEach((ringAxial) =>
      beam(
        steps(start, start + stripWidth, RING_SEGMENT_DEGREES).map((at) => ({
          axial: ringAxial,
          azimuth: at,
        })),
        along,
        FRAME,
      ),
    );
  });

  const constants = {
    HALF_LENGTH: halfLength,
    RADIUS: radius,
    VALLEY_SPACING: spacing,
  };
  const shellMaterial = createMaterial("shell", SHELL_PS, constants);
  const glassMaterial = createMaterial("glass", WINDOW_PS, constants);
  const frameMaterial = createMaterial("frame", FRAME_PS, constants, {
    frameColor: true,
  });
  [shellMaterial, glassMaterial].forEach((material) => {
    material.depthTest = false;
    material.depthWrite = false;
  });

  const sun = frame.sunDirection();
  const { color, intensity } = frame.definition.sunlight;
  const axisMid = frame.point(0, 0, 0);
  const vec = ({ x, y, z }: Vector3) => [x, y, z];
  const shared: Record<string, number[]> = {
    uAxisMid: vec(axisMid),
    uOutward0: vec(frame.outward(0)),
    uOutward90: vec(frame.outward(90)),
    uSunColor: [color.r * intensity, color.g * intensity, color.b * intensity],
    uSunDirection: vec(sun),
    uSunward: vec(frame.sunward),
  };
  [shellMaterial, glassMaterial, frameMaterial].forEach((material) => {
    Object.entries(shared).forEach(([name, value]) =>
      material.setParameter(name, value),
    );
    material.setParameter("uRayleighExtinction", [...RAYLEIGH_EXTINCTION]);
    material.setParameter("uAerosolExtinction", AEROSOL_EXTINCTION);
    material.setParameter("uAirGlow", AIR_GLOW);
    material.setParameter("uSunGlow", habitat.sunGlow);
    const { b, g, r } = habitat.fill;
    material.setParameter("uFill", [r, g, b]);
  });
  shellMaterial.setParameter("uClearing", [axial, azimuth, CLEARING_RADIUS]);

  const mirrorArray = (key: "across" | "along" | "hinge" | "normal" | "toSun") =>
    new Float32Array(frame.mirrors.flatMap((mirror) => vec(mirror[key])));
  const [{ halfWidth, length: mirrorLength }] = frame.mirrors;
  [shellMaterial, glassMaterial].forEach((material) => {
    material.setParameter("uMirrorHinge[0]", mirrorArray("hinge"));
    material.setParameter("uMirrorNormal[0]", mirrorArray("normal"));
    material.setParameter("uMirrorAlong[0]", mirrorArray("along"));
    material.setParameter("uMirrorAcross[0]", mirrorArray("across"));
    material.setParameter("uMirrorToSun[0]", mirrorArray("toSun"));
    material.setParameter("uMirrorSize", [mirrorLength, halfWidth]);
  });

  const layer = new pc.Layer({
    name: "Island Three",
    opaqueSortMode: pc.SORTMODE_MANUAL,
  });
  app.scene.layers.insert(layer, 0);
  const meshes = [shell, glass, frames].map((builder) => builder.build(device));
  const materials = [shellMaterial, glassMaterial, frameMaterial];
  const entity = new pc.Entity("island-three");
  entity.addComponent("render", {
    castShadows: false,
    layers: [layer.id],
    meshInstances: meshes.map((mesh, index) => {
      const instance = new pc.MeshInstance(mesh, materials[index]);
      // The convex shell first; frames over it, testing only each other.
      instance.drawOrder = index;
      instance.cull = false;
      return instance;
    }),
    receiveShadows: false,
  });
  app.root.addChild(entity);

  const raceView = raceCamera.camera!;
  const view = new pc.Entity("island-three-camera");
  view.addComponent("camera", {
    clearColor: new pc.Color(0, 0, 0),
    farClip: FAR_CLIP,
    fov: raceView.fov,
    layers: [layer.id],
    nearClip: NEAR_CLIP,
    priority: raceView.priority - 1,
  });
  view.camera!.gammaCorrection = raceView.gammaCorrection;
  view.camera!.toneMapping = raceView.toneMapping;
  raceCamera.addChild(view);
  raceView.clearColorBuffer = false;
  const followFov = () => {
    view.camera!.fov = raceView.fov;
  };
  app.on("prerender", followFov);

  return () => {
    app.off("prerender", followFov);
    raceView.clearColorBuffer = true;
    view.destroy();
    entity.destroy();
    app.scene?.layers.remove(layer);
    meshes.forEach((mesh) => mesh.destroy());
    materials.forEach((material) => material.destroy());
  };
}

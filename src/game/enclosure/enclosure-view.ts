import * as pc from "playcanvas";

import {
  addStructures,
  createBoxMesh,
  createBuildingInstances,
  createInstanceBuffer,
  createTreeInstances,
  createTreeMesh,
  frameShade,
  MeshBuilder,
  steps,
} from "./enclosure-structures";
import {
  glslFloat,
  glslVec3,
  HABITAT_LAND_GLSL,
  HABITAT_MIRROR_GLSL,
  HABITAT_PATTERN_GLSL,
} from "./habitat-glsl";
import {
  BELT,
  CLEARING_RADIUS,
  FLAT_AROUND_COURSE,
  RENDER_ALBEDO,
  TREES,
} from "./habitat-land";
import {
  AEROSOL_EXTINCTION,
  AIR_GLOW,
  type HabitatLight,
  RAYLEIGH_EXTINCTION,
} from "./habitat-light";
import { type CourseEnclosure, getEnclosureFrame } from "./island-three";

// Island Three draws in its own pass, before the course, so the course keeps
// its own depth range and draws on top. Within the pass, everything inside
// the shell tests depth: the course valley's relief, the frames and
// structures, and the trees and buildings. The rest of the shell (the other
// floors, caps, and window glass) is convex around the camera, so every pixel
// sees exactly one shell surface; it draws last with its depth pinned to the
// far plane, behind everything inside it.
const NEAR_CLIP = 1;
const FAR_CLIP = 80_000;
// Clip-space depth of the far-pinned shell: behind anything inside it, all
// within about 33 km (0.99996 at most), yet far enough from 1 that GPUs'
// rounding and 24-bit depth buffers never clip it or flicker.
const SHELL_DEPTH = 0.99999;
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
// The course valley's relief mesh: rows close together near the course,
// spreading with distance, and columns as wide as the shell's.
const RELIEF_ROW = { flat: 100, nearest: 25, spread: 0.035 };
const RELIEF_SEGMENT_DEGREES = 0.75;
// Detailed trees near the course; simpler crowns further out.
const NEAR_TREE = { rings: [0.05, 0.2, 0.42, 0.65, 0.86], sides: 6, trunkSides: 4 };
const FAR_TREE = { rings: [0.1, 0.5], sides: 5 };

type Vector3 = { x: number; y: number; z: number };

// Cylinder coordinates, shared by vertex and fragment shaders. Lengths are
// metres; azimuth is degrees, spinward.
const CYLINDER_GLSL = /* glsl */ `
uniform vec3 uAxisMid;
uniform vec3 uSunward;
uniform vec3 uOutward0;
uniform vec3 uOutward90;

vec3 cylinderCoordinates(vec3 position) {
  vec3 fromAxis = position - uAxisMid;
  float axial = dot(fromAxis, uSunward);
  vec3 radial = fromAxis - axial * uSunward;
  float azimuth = degrees(atan(dot(radial, uOutward90), dot(radial, uOutward0)));
  return vec3(axial, azimuth, length(radial));
}

vec3 outwardAt(float azimuth) {
  return cos(radians(azimuth)) * uOutward0 + sin(radians(azimuth)) * uOutward90;
}
`;

// The course's surroundings: its mown clearing, the belt of trees around
// it, flat land beyond, and real trees in place of the woods' canopy relief.
// habitat-land.ts mirrors the belt for placing its trees.
const COURSE_GLSL = /* glsl */ `
uniform vec2 uClearing;
const float CLEARING_RADIUS = ${glslFloat(CLEARING_RADIUS)};
const float BELT_INSET = ${glslFloat(BELT.inset)};
const float BELT_DEPTH = ${glslFloat(BELT.depth)};
const float VISTA_OUTER = ${Math.cos(((BELT.vistaDegrees + 4) * Math.PI) / 180)};
const float VISTA_INNER = ${Math.cos(((BELT.vistaDegrees - 4) * Math.PI) / 180)};

// Offset of a valley point from the clearing's centre: (axial, across).
vec2 fromClearing(float axial, float azimuth) {
  float turn = mod(azimuth - uClearing.y + 180.0, 360.0) - 180.0;
  return vec2(axial - uClearing.x, radians(turn) * RADIUS);
}

// How much the hills keep of their height around the course, with its
// gradient: flat through the clearing and its belt.
vec3 hillKeep(vec2 offset) {
  float r = max(length(offset), 1.0);
  vec2 keep = ramp(${glslFloat(FLAT_AROUND_COURSE.from)}, ${glslFloat(FLAT_AROUND_COURSE.to)}, r);
  return vec3(keep.x, keep.y * offset / r);
}

// The woods' canopy rises as relief only beyond the real trees.
float canopyKeep(vec2 offset) {
  return smoothstep(${glslFloat(TREES.canopyFrom)}, ${glslFloat(TREES.radius)}, length(offset));
}

// Coverage of the belt of trees ringing the clearing, in clumps, open
// toward the sunward cap, for a pixel footprint.
float beltCover(vec2 offset, float pixel) {
  float r = length(offset);
  float outer = CLEARING_RADIUS + BELT_INSET
    + BELT_DEPTH * (0.3 + 0.7 * valueNoise(offset / 45.0 + 17.0));
  float clump = smoothstep(0.3, 0.4, valueNoise(offset / 80.0 + 31.0));
  float vista = 1.0 - smoothstep(VISTA_OUTER, VISTA_INNER, offset.x / max(r, 1.0));
  return inside(CLEARING_RADIUS + BELT_INSET - r, pixel) * inside(r - outer, pixel)
    * clump * vista;
}
`;

// The shell, glass, and frames. The course valley's relief vertices rise by
// the land's height; the convex rest of the shell, and the glass, pin to the
// far plane.
const SHELL_VS = /* glsl */ `
attribute vec3 vertex_position;
uniform mat4 matrix_model;
uniform mat4 matrix_viewProjection;
varying vec3 vWorld;
#ifdef STRUCTURE
attribute vec4 vertex_color;
attribute vec3 vertex_normal;
varying vec3 vColor;
varying float vKind;
varying vec3 vNormal;
#endif
#ifdef RELIEF
attribute float vertex_relief;
${CYLINDER_GLSL}
${HABITAT_PATTERN_GLSL}
${HABITAT_LAND_GLSL}
${COURSE_GLSL}
#endif
void main(void) {
  vec4 world = matrix_model * vec4(vertex_position, 1.0);
#ifdef RELIEF
  if (vertex_relief > 0.5) {
    vec3 c = cylinderCoordinates(world.xyz);
    float valley = floor(c.y / VALLEY_SPACING + 0.5);
    float seed = mod(valley, 3.0) + 1.0;
    vec2 q = vec2(c.x, radians(c.y - valley * VALLEY_SPACING) * RADIUS);
    vec2 offset = fromClearing(c.x, c.y);
    float height = landRelief(landAt(q, seed), q, seed, hillKeep(offset), canopyKeep(offset)).x;
    world.xyz -= outwardAt(c.y) * height;
  }
#endif
  vWorld = world.xyz;
#ifdef STRUCTURE
  vColor = vertex_color.rgb;
  vKind = vertex_color.a;
  vNormal = vertex_normal;
#endif
  gl_Position = matrix_viewProjection * world;
#ifdef RELIEF
  if (vertex_relief < 0.5) gl_Position.z = gl_Position.w * SHELL_DEPTH;
#endif
#ifdef FAR
  gl_Position.z = gl_Position.w * SHELL_DEPTH;
#endif
}
`;

// Trees and buildings, instanced in the course valley and standing on its
// hills: per instance, (axial, across, height, seed) and a shape.
const INSTANCED_VS = /* glsl */ `
attribute vec4 vertex_position;
attribute vec3 vertex_normal;
attribute vec4 aPlace;
attribute vec4 aShape;
uniform mat4 matrix_viewProjection;
// The valley's centre azimuth and land seed.
uniform vec2 uValley;
varying vec3 vWorld;
varying vec3 vNormal;
varying vec3 vAlbedo;
varying float vShade;
varying vec4 vLeaf;
varying vec3 vUp;
${CYLINDER_GLSL}
${HABITAT_PATTERN_GLSL}
${HABITAT_LAND_GLSL}
${COURSE_GLSL}
const vec3 LEAF = vec3(0.04, 0.066, 0.026);
const vec3 NEEDLE = vec3(0.024, 0.042, 0.027);
const vec3 BARK = vec3(0.06, 0.05, 0.04);
const vec3 RENDER = ${glslVec3(RENDER_ALBEDO)};

void main(void) {
  vec2 q = aPlace.xy;
  float azimuth = uValley.x + degrees(q.y / RADIUS);
  vec3 outward = outwardAt(azimuth);
  vec3 up = -outward;
  vec3 across = cross(up, uSunward);
  float ground = hillHeight(q, uValley.y, hillKeep(fromClearing(q.x, azimuth)));
  vec3 base = uAxisMid + uSunward * q.x + outward * (RADIUS - ground);
  float part = vertex_position.w;
  float height = aPlace.z;
  vec3 local;
  vec3 normal;
  vLeaf = vec4(0.0);
  vShade = 1.0;
  if (part < 0.5) {
    // The trunk, from below ground up into the crown.
    float crownBase = aShape.y * height;
    float radius = max(0.02 * height, 0.2);
    local = vec3(vertex_position.x * radius, mix(-1.5, crownBase + 0.2 * (height - crownBase),
      vertex_position.z), vertex_position.y * radius);
    normal = vec3(vertex_position.x, 0.0, vertex_position.y);
    vAlbedo = BARK;
    vShade = 0.6;
  } else if (part < 1.5) {
    // A broadleaf or conifer crown, lumpy by its seed.
    float width = aShape.x;
    float crownBase = aShape.y * height - 1.0;
    float conifer = aShape.z;
    vec2 ring = vertex_position.xy;
    float t = vertex_position.z;
    float s = pow(max(t, 1e-4), 0.8);
    float broad = sqrt(max(1.0 - (2.0 * s - 1.0) * (2.0 * s - 1.0), 0.0));
    float cone = min(1.0, 1.3 * (1.0 - t)) * (0.55 + 0.45 * smoothstep(0.0, 0.15, t));
    float profile = mix(broad, cone, conifer);
    // Each ring vertex moves out and up by its own seed; the apex and
    // underside, on the axis, stay put.
    bool onRing = dot(ring, ring) > 0.5;
    vec2 corner = onRing
      ? vec2(floor(atan(ring.y, ring.x) * 2.0 + 0.5), floor(t * 20.0 + 0.5)) : vec2(0.0);
    float lump = onRing ? 1.0 + mix(0.5, 0.2, conifer) * (hash(corner + aPlace.w * 97.0) - 0.5) : 1.0;
    float crownHeight = height - 1.0 - crownBase;
    float rise = t + (onRing && t > 0.05 && t < 0.95 ? 0.12 * (hash(corner + aPlace.w * 61.0) - 0.5) : 0.0);
    local = vec3(ring.x, 0.0, ring.y) * width * profile * lump
      + vec3(0.0, crownBase + rise * crownHeight, 0.0);
    vec3 rounded = vec3(ring.x * broad / width, (2.0 * s - 1.0) / (0.5 * crownHeight), ring.y * broad / width);
    vec3 pointed = vec3(ring.x, width / crownHeight, ring.y);
    normal = normalize(normalize(mix(rounded, pointed, conifer)) + vec3(0.0, 0.3, 0.0));
    vAlbedo = mix(LEAF, NEEDLE, conifer) * aShape.w;
    // Leaves deep in the crown see less of the sky.
    vShade = 0.45 + 0.55 * t;
    vLeaf = vec4(local + aPlace.w * 50.0, 1.0);
  } else {
    // A building on its lot: walls and a flat roof.
    local = vec3(vertex_position.x * aShape.x, mix(-3.0, height, vertex_position.y),
      vertex_position.z * aShape.y);
    normal = vertex_normal;
    float roof = aShape.z;
    vAlbedo = part > 2.5 ? (roof < 0.5 ? TILE : roof < 1.5 ? PALE : SLATE) : RENDER * aShape.w;
  }
  vec3 world = base + uSunward * local.x + up * local.y + across * local.z;
  vWorld = world;
  vNormal = uSunward * normal.x + up * normal.y + across * normal.z;
  vUp = up;
  gl_Position = matrix_viewProjection * vec4(world, 1.0);
}
`;

// Sunlight and half-pressure air shared by every enclosure surface.
const COMMON_PS = /* glsl */ `
#include "gammaPS"
#include "tonemappingPS"
uniform vec3 view_position;
uniform vec3 uSunDirection;
uniform vec3 uSunColor;
uniform vec3 uRayleighExtinction;
uniform float uAerosolExtinction;
varying vec3 vWorld;
${CYLINDER_GLSL}

// Moisture and dust scatter nearly evenly across colours.
const vec3 AEROSOL_TINT = vec3(0.95, 1.0, 1.05);
// Brightness of sunlit air relative to the sunlight itself, and its glow
// toward the sun's image.
uniform float uAirGlow;
uniform float uSunGlow;
// The habitat's own diffuse light on its surfaces.
uniform vec3 uFill;
${HABITAT_MIRROR_GLSL}

// Pixel footprint in metres, along the axis and around it.
vec2 footprint(vec3 position) {
  vec3 fromAxis = position - uAxisMid;
  float axial = dot(fromAxis, uSunward);
  return vec2(fwidth(axial), length(fwidth(fromAxis - axial * uSunward)));
}

${HABITAT_PATTERN_GLSL}
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
${HABITAT_LAND_GLSL}
${COURSE_GLSL}

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
    float seed = mod(valley, 3.0) + 1.0;
    vec2 q = vec2(c.x, radians(c.y - valley * VALLEY_SPACING) * RADIUS);
    Land l = landAt(q, seed);
    albedo = landColor(l, q, f, seed);
    // The course sits in a mown clearing, ringed by a belt of trees except
    // where water or the road crosses it.
    vec2 offset = fromClearing(c.x, c.y);
    float pixel = max(f.x, f.y);
    float fromCentre = length(offset);
    albedo = mix(albedo, LAWN, inside(fromCentre - CLEARING_RADIUS, pixel + 40.0));
    if (fromCentre < CLEARING_RADIUS + BELT_INSET + BELT_DEPTH + pixel) {
      float open = smoothstep(12.0, 25.0, nearerWater(q, seed, l.river, l.riverHalfWidth, l.lake).x)
        * smoothstep(8.0, 14.0, abs(l.road));
      albedo = mix(albedo, FOREST, beltCover(offset, pixel) * open);
    }
    // Relief shades every valley; the course valley's also rises.
    // The canopy's edges shade it only while wider than a few pixels.
    float canopy = canopyKeep(offset) * (1.0 - smoothstep(4.0, 12.0, pixel));
    vec3 relief = landRelief(l, q, seed, hillKeep(offset), canopy);
    vec3 up = -outwardAt(c.y);
    normal = normalize(up - relief.y * uSunward - relief.z * cross(up, uSunward));
  }
  float sunLight = sunlit(vWorld, normal, max(f.x, f.y));
  vec3 color = albedo * (uSunColor * sunLight + uFill);
  gl_FragColor = finish(throughAir(color, vWorld - view_position));
}
`;

const WINDOW_PS = /* glsl */ `

// The sun's brightness relative to its light.
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
    // From Saturn the sun is narrower than a pixel, so it shows as an
    // overexposed point at least a pixel wide.
    float sunAngle = toSun > 0.0 ? length(cross(reflected, uSunward)) : 1.0;
    float sunDisc = inside(
      sunAngle - max(SUN_ANGULAR_RADIUS, pixelAngle),
      pixelAngle
    );
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

// Frames and structures. Frames' inner faces see only the habitat's light;
// the outer faces take the sunlight. Structures take both, and planted
// ground varies in patches.
const FRAME_PS = /* glsl */ `
varying vec3 vColor;
varying float vKind;
varying vec3 vNormal;

void main(void) {
  vec3 albedo = vColor;
  float pixel = max(length(fwidth(vWorld)), 1.0);
  if (vKind > 0.75) {
    vec3 c = cylinderCoordinates(vWorld);
    albedo *= 0.7 + 0.6 * valueNoise(vec2(radians(c.y) * c.z, c.x + c.z) / 60.0);
  }
  float sun = vKind > 0.25 ? sunlit(vWorld, normalize(vNormal), pixel) : 0.0;
  vec3 color = albedo * (uSunColor * sun + uFill);
  gl_FragColor = finish(throughAir(color, vWorld - view_position));
}
`;

const INSTANCED_PS = /* glsl */ `
varying vec3 vNormal;
varying vec3 vAlbedo;
varying float vShade;
varying vec4 vLeaf;
varying vec3 vUp;
// Leaves pass on some of the sunlight on the far side of a crown.
const float LEAF_TRANSMISSION = 0.2;

void main(void) {
  vec3 normal = normalize(vNormal);
  vec3 albedo = vAlbedo;
  float pixel = max(length(fwidth(vWorld)), 0.25);
  float leaves = 0.0;
  if (vLeaf.w > 0.5) {
    // Clumps of leaves, bumping the crown's surface; both fade to their mean
    // once smaller than a pixel.
    float detail = 1.0 - smoothstep(0.4, 1.5, pixel);
    vec3 a = valueNoiseGradient(vLeaf.xy / 2.2);
    vec3 b = valueNoiseGradient(vLeaf.zy / 2.2 + 7.0);
    float clumps = 0.5 * (a.x + b.x);
    vec3 across = cross(vUp, uSunward);
    vec3 bump = uSunward * a.y + vUp * (a.z + b.z) + across * b.y;
    normal = normalize(normal - 0.7 * detail * (bump - dot(bump, normal) * normal));
    albedo *= mix(1.0, 0.5 + clumps, detail);
    leaves = 1.0;
  }
  float sun = sunlit(vWorld, normal, pixel);
  sun += leaves * LEAF_TRANSMISSION * sunlit(vWorld, -normal, pixel);
  vec3 color = albedo * (uSunColor * sun + uFill * vShade);
  gl_FragColor = finish(throughAir(color, vWorld - view_position));
}
`;

function createMaterial(
  name: string,
  vertex: string,
  fragment: string,
  constants: Record<string, number>,
  options: {
    attributes?: Record<string, string>;
    defines?: string[];
  } = {},
) {
  const constantDefines = Object.entries(constants)
    .map(([key, value]) => `#define ${key} ${glslFloat(value)}\n`)
    .join("");
  const defines = (options.defines ?? [])
    .map((define) => `#define ${define}\n`)
    .join("");
  const material = new pc.ShaderMaterial({
    attributes: {
      vertex_position: pc.SEMANTIC_POSITION,
      ...options.attributes,
    },
    fragmentGLSL: constantDefines + COMMON_PS + fragment,
    uniqueName: `enclosure-${name}`,
    vertexGLSL: constantDefines + defines + vertex,
  });
  material.cull = pc.CULLFACE_NONE;
  return material;
}

/**
 * Whether to draw Island Three, inside the race or outside on the loading
 * screen. Playwright renders WebGL on the CPU, where its per-pixel shading
 * costs hundreds of milliseconds a frame, so its server leaves the enclosure
 * out unless a test asks for it with `?enclosure`.
 */
export function drawsEnclosure() {
  return (
    process.env.NODE_ENV === "production" ||
    process.env.NEXT_PUBLIC_TEST_WITHOUT_ENCLOSURE !== "1" ||
    new URLSearchParams(window.location.search).has("enclosure")
  );
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
  const courseValley = Math.round(azimuth / spacing);
  const courseValleyCentre = courseValley * spacing;
  const courseSeed = (((courseValley % valleyCount) + valleyCount) % valleyCount) + 1;
  const toRadians = Math.PI / 180;
  const clearing = {
    across: (azimuth - courseValleyCentre) * toRadians * radius,
    axial,
  };

  const shell = new MeshBuilder();
  const glass = new MeshBuilder();
  const frames = new MeshBuilder();
  const axials = steps(-halfLength, halfLength, length / AXIAL_SEGMENTS);
  const capRadii = steps(0, radius, radius / CAP_RING_COUNT);
  const capSectors = (azimuths: number[]) =>
    [-halfLength, halfLength].forEach((capAxial) =>
      shell.grid(capRadii.length - 1, azimuths.length - 1, (row, column) =>
        frame.point(capAxial, azimuths[column]!, capRadii[row]!),
      ),
    );

  // The course valley's floor rises with its relief. Its rows crowd near
  // the course, and its rims meet the caps' sectors point for point, so no
  // cracks open between them.
  const reliefAzimuths = steps(
    courseValleyCentre - stripWidth / 2,
    courseValleyCentre + stripWidth / 2,
    RELIEF_SEGMENT_DEGREES,
  );
  const reliefRows = (direction: number) => {
    const rows: number[] = [];
    const end = direction > 0 ? halfLength - axial : halfLength + axial;
    let distance = 0;
    while (distance < end) {
      rows.push(axial + direction * distance);
      distance +=
        distance < FLAT_AROUND_COURSE.from - RELIEF_ROW.flat
          ? RELIEF_ROW.flat
          : Math.max(RELIEF_ROW.nearest, RELIEF_ROW.spread * distance);
    }
    rows.push(direction * halfLength);
    return rows;
  };
  const reliefAxials = [...reliefRows(-1).reverse(), ...reliefRows(1).slice(1)];
  shell.grid(
    reliefAxials.length - 1,
    reliefAzimuths.length - 1,
    (row, column) => frame.point(reliefAxials[row]!, reliefAzimuths[column]!, radius),
    1,
    (row, column) =>
      Math.hypot(
        reliefAxials[row]! - axial,
        (reliefAzimuths[column]! - azimuth) * toRadians * radius,
      ),
  );
  capSectors(reliefAzimuths);

  valleyCentres.forEach((centre) => {
    const floor = steps(centre - stripWidth / 2, centre + stripWidth / 2, FLOOR_SEGMENT_DEGREES);
    if (centre !== (((courseValleyCentre % 360) + 360) % 360)) {
      shell.grid(axials.length - 1, floor.length - 1, (row, column) =>
        frame.point(axials[row]!, floor[column]!, radius),
      );
      capSectors(floor);
    }
    const window = steps(centre + stripWidth / 2, centre + 1.5 * stripWidth, WINDOW_SEGMENT_DEGREES);
    glass.grid(axials.length - 1, window.length - 1, (row, column) =>
      frame.point(axials[row]!, window[column]!, radius),
    );
    capSectors(window);
  });

  // Frames carry the windows' pressure load: heavy sills along each window
  // edge, lighter longerons along its length, and ring frames across it.
  // Each is an open channel of three faces, its outer side on the glass.
  const frameBeam = (
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
    frames.strip(corners.map((c) => [c[0]!, c[1]!]), frameShade(65));
    frames.strip(corners.map((c) => [c[1]!, c[2]!]), frameShade(90));
    frames.strip(corners.map((c) => [c[2]!, c[3]!]), frameShade(65));
  };
  const across = (at: { azimuth: number }) => frame.outward(at.azimuth + 90);
  const along = () => frame.sunward;
  valleyCentres.forEach((centre) => {
    const start = centre + stripWidth / 2;
    const longeron = (at: number, size: typeof FRAME) =>
      frameBeam(
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
      frameBeam(
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
    SHELL_DEPTH,
    VALLEY_SPACING: spacing,
  };
  const shellMaterial = createMaterial("shell", SHELL_VS, SHELL_PS, constants, {
    attributes: { vertex_relief: pc.SEMANTIC_ATTR8 },
    defines: ["RELIEF"],
  });
  const glassMaterial = createMaterial("glass", SHELL_VS, WINDOW_PS, constants, {
    defines: ["FAR"],
  });
  const frameMaterial = createMaterial("frame", SHELL_VS, FRAME_PS, constants, {
    attributes: {
      vertex_color: pc.SEMANTIC_COLOR,
      vertex_normal: pc.SEMANTIC_NORMAL,
    },
    defines: ["STRUCTURE"],
  });
  const instancedMaterial = createMaterial(
    "instanced",
    INSTANCED_VS,
    INSTANCED_PS,
    constants,
    {
      attributes: {
        aPlace: pc.SEMANTIC_ATTR12,
        aShape: pc.SEMANTIC_ATTR13,
        vertex_normal: pc.SEMANTIC_NORMAL,
      },
    },
  );
  glassMaterial.depthWrite = false;
  const materials = [shellMaterial, glassMaterial, frameMaterial, instancedMaterial];

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
  const mirrorArray = (key: "across" | "along" | "hinge" | "normal" | "toSun") =>
    new Float32Array(frame.mirrors.flatMap((mirror) => vec(mirror[key])));
  const [{ halfWidth, length: mirrorLength }] = frame.mirrors;
  materials.forEach((material) => {
    Object.entries(shared).forEach(([name, value]) =>
      material.setParameter(name, value),
    );
    material.setParameter("uRayleighExtinction", [...RAYLEIGH_EXTINCTION]);
    material.setParameter("uAerosolExtinction", AEROSOL_EXTINCTION);
    material.setParameter("uAirGlow", AIR_GLOW);
    material.setParameter("uSunGlow", habitat.sunGlow);
    const { b, g, r } = habitat.fill;
    material.setParameter("uFill", [r, g, b]);
    material.setParameter("uMirrorHinge[0]", mirrorArray("hinge"));
    material.setParameter("uMirrorNormal[0]", mirrorArray("normal"));
    material.setParameter("uMirrorAlong[0]", mirrorArray("along"));
    material.setParameter("uMirrorAcross[0]", mirrorArray("across"));
    material.setParameter("uMirrorToSun[0]", mirrorArray("toSun"));
    material.setParameter("uMirrorSize", [mirrorLength, halfWidth]);
    material.setParameter("uClearing", [axial, azimuth]);
  });
  instancedMaterial.setParameter("uValley", [courseValleyCentre, courseSeed]);

  const layer = new pc.Layer({
    name: "Island Three",
    opaqueSortMode: pc.SORTMODE_MANUAL,
  });
  app.scene.layers.insert(layer, 0);
  // Nearer things draw first, so the depth test spares the land shader the
  // pixels they hide: frames and structures, trees, and buildings, then the
  // relief and far-pinned shell, then the glass.
  const meshes: pc.Mesh[] = [];
  const instanceOf = (mesh: pc.Mesh, material: pc.Material, drawOrder: number) => {
    meshes.push(mesh);
    const instance = new pc.MeshInstance(mesh, material);
    instance.drawOrder = drawOrder;
    instance.cull = false;
    return instance;
  };
  // The frames' builder keeps its geometry for the structures to join.
  const frameInstance = instanceOf(frames.build(device, true), frameMaterial, 0);
  const entity = new pc.Entity("island-three");
  entity.addComponent("render", {
    castShadows: false,
    layers: [layer.id],
    meshInstances: [
      frameInstance,
      instanceOf(shell.build(device), shellMaterial, 4),
      instanceOf(glass.build(device), glassMaterial, 5),
    ],
    receiveShadows: false,
  });
  app.root.addChild(entity);

  // The structures, trees, and buildings take tens of milliseconds to lay
  // out, so they join after the first frame, usually behind the loading
  // screen.
  const valleyHalfWidth = (stripWidth / 2) * toRadians * radius;
  const instanceBuffers: pc.VertexBuffer[] = [];
  const detail = new pc.Entity("island-three-detail");
  const addDetail = () => {
    addStructures(frames, frame);
    const framesOnly = frameInstance.mesh;
    frameInstance.mesh = frames.build(device);
    meshes.splice(meshes.indexOf(framesOnly), 1, frameInstance.mesh);
    framesOnly.destroy();
    const trees = createTreeInstances(clearing, courseSeed, valleyHalfWidth);
    const instanced = [
      {
        data: trees.near,
        mesh: () => createTreeMesh(device, NEAR_TREE.sides, NEAR_TREE.rings, NEAR_TREE.trunkSides),
      },
      { data: trees.far, mesh: () => createTreeMesh(device, FAR_TREE.sides, FAR_TREE.rings) },
      { data: createBuildingInstances(clearing, courseSeed, halfLength), mesh: () => createBoxMesh(device) },
    ];
    detail.addComponent("render", {
      castShadows: false,
      layers: [layer.id],
      meshInstances: instanced
        .filter(({ data }) => data.length > 0)
        .map(({ data, mesh }, index) => {
          const instance = instanceOf(mesh(), instancedMaterial, 1 + index);
          const buffer = createInstanceBuffer(device, data);
          instanceBuffers.push(buffer);
          instance.setInstancing(buffer);
          return instance;
        }),
      receiveShadows: false,
    });
    app.root.addChild(detail);
  };
  app.once("postrender", addDetail);

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
    app.off("postrender", addDetail);
    raceView.clearColorBuffer = true;
    view.destroy();
    detail.destroy();
    entity.destroy();
    app.scene?.layers.remove(layer);
    meshes.forEach((mesh) => mesh.destroy());
    instanceBuffers.forEach((buffer) => buffer.destroy());
    materials.forEach((material) => material.destroy());
  };
}

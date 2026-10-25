import * as pc from "playcanvas";

import {
  addStructures,
  createBoxMesh,
  createBuildingInstances,
  createInstanceBuffer,
  createBillboardMesh,
  createTreeInstances,
  createWaterfallMesh,
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
  PARK,
  RENDER_ALBEDO,
  TREES,
} from "./habitat-land";
import {
  AEROSOL_EXTINCTION,
  type HabitatLight,
  RAYLEIGH_EXTINCTION,
} from "./habitat-light";
import {
  type CourseEnclosure,
  getEnclosureFrame,
  sceneLux,
} from "./island-three";
import {
  CONIFER_SPECIES,
  TREE_CROWN_SHADE,
  TREE_FOOT,
  TREE_SPECIES,
  TREE_VIEWS,
} from "./tree-billboards";
import { loadTreeImages, type TreeImages } from "./tree-images";

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

// Buildings, instanced in the course valley and standing on its hills: per
// instance, (axial, across, height, seed) and a shape.
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
${CYLINDER_GLSL}
${HABITAT_PATTERN_GLSL}
${HABITAT_LAND_GLSL}
${COURSE_GLSL}
const vec3 RENDER = ${glslVec3(RENDER_ALBEDO)};

void main(void) {
  vec2 q = aPlace.xy;
  float azimuth = uValley.x + degrees(q.y / RADIUS);
  vec3 outward = outwardAt(azimuth);
  vec3 up = -outward;
  vec3 across = cross(up, uSunward);
  float ground = hillHeight(q, uValley.y, hillKeep(fromClearing(q.x, azimuth)));
  vec3 base = uAxisMid + uSunward * q.x + outward * (RADIUS - ground);
  float height = aPlace.z;
  // Walls and a flat roof on the building's lot.
  vec3 local = vec3(vertex_position.x * aShape.x, mix(-3.0, height, vertex_position.y),
    vertex_position.z * aShape.y);
  float roof = aShape.z;
  vAlbedo = vertex_position.w > 2.5 ? (roof < 0.5 ? TILE : roof < 1.5 ? PALE : SLATE)
    : RENDER * aShape.w;
  vec3 world = base + uSunward * local.x + up * local.y + across * local.z;
  vWorld = world;
  vNormal = uSunward * vertex_normal.x + up * vertex_normal.y + across * vertex_normal.z;
  gl_Position = matrix_viewProjection * vec4(world, 1.0);
}
`;

// Trees, instanced in the course valley as billboards of baked species
// that turn about their own up to face the camera: per instance, (axial,
// across, height, seed) and (billboard side, species, unused, shade).
const TREE_VS = /* glsl */ `
attribute vec4 vertex_position;
attribute vec4 aPlace;
attribute vec4 aShape;
uniform mat4 matrix_viewProjection;
uniform vec3 view_position;
// The valley's centre azimuth and land seed.
uniform vec2 uValley;
varying vec3 vWorld;
varying vec4 vUv;
varying float vBlend;
varying vec3 vRight;
varying vec3 vUp;
varying vec3 vFacing;
varying vec2 vTree;
${CYLINDER_GLSL}
${HABITAT_PATTERN_GLSL}
${HABITAT_LAND_GLSL}
${COURSE_GLSL}
const float VIEWS = ${glslFloat(TREE_VIEWS)};
const float SPECIES = ${glslFloat(TREE_SPECIES.length)};
const float CONIFER = ${glslFloat(CONIFER_SPECIES)};
const float FOOT = ${glslFloat(TREE_FOOT)};

void main(void) {
  vec2 q = aPlace.xy;
  float azimuth = uValley.x + degrees(q.y / RADIUS);
  vec3 outward = outwardAt(azimuth);
  vec3 up = -outward;
  vec3 across = cross(up, uSunward);
  float ground = hillHeight(q, uValley.y, hillKeep(fromClearing(q.x, azimuth)));
  vec3 base = uAxisMid + uSunward * q.x + outward * (RADIUS - ground);
  vec3 toEye = view_position - base;
  vec3 level = toEye - up * dot(toEye, up);
  vec3 facing = dot(level, level) > 1e-6 ? normalize(level) : across;
  vec3 right = cross(up, facing);
  // The baked view is a square a little wider than the tree's span; the
  // billboard keeps only the tree's height of it, sunk half a metre so the
  // trunk meets sloping ground.
  float height = aPlace.z;
  float side = aShape.x;
  float tall = min(side, 1.04 * height);
  vec3 world = base + right * (vertex_position.x * 0.5 * side)
    + up * (vertex_position.y * tall - 0.5);
  // The direction to the camera in the tree's own frame, turned by its
  // seed, picks the two nearest of its baked views.
  float yaw = aPlace.w * 6.2831853;
  vec3 front = cos(yaw) * uSunward + sin(yaw) * across;
  float view = mod(atan(dot(facing, cross(up, front)), dot(facing, front)) / 6.2831853 * VIEWS, VIEWS);
  float first = floor(view);
  vBlend = view - first;
  // Atlas rows run down the image, species by species, each tree's foot
  // raised above the bottom of its cell.
  vec2 inCell = vec2(0.5 + 0.5 * vertex_position.x,
    1.0 - FOOT - vertex_position.y * tall / side);
  float row = aShape.y;
  vUv = vec4(
    (vec2(first, row) + inCell) / vec2(VIEWS, SPECIES),
    (vec2(mod(first + 1.0, VIEWS), row) + inCell) / vec2(VIEWS, SPECIES)
  );
  vRight = right;
  vUp = up;
  vFacing = facing;
  // x: the crown's shade on its leaves, with firs, which bake pale,
  // darkened toward the woods' needles. y: how high up the tree, for the
  // light deep in a crown.
  vTree = vec2(${glslFloat(TREE_CROWN_SHADE)} * aShape.w * (abs(row - CONIFER) < 0.5 ? 0.7 : 1.0),
    min(vertex_position.y * tall / height, 1.0));
  vWorld = world;
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
// Scene radiance of one cd/m² of lamplight while the lamps are on.
uniform float uCandela;
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
  float lamps = 0.0;
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
    // Lamps near the course are its own, on full-size masts.
    lamps = lampLight(l, q, pixel, seed)
      * smoothstep(0.0, 100.0, fromCentre - CLEARING_RADIUS - BELT_INSET - BELT_DEPTH);
  }
  float sunLight = sunlit(vWorld, normal, max(f.x, f.y));
  vec3 color = albedo * (uSunColor * sunLight + uFill) + LAMP_TINT * uCandela * lamps;
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
  } else if (vKind > 0.6) {
    // Granite like Yosemite's: faint strata, long dark streaks where water
    // has run down it, and moss in patches. Arc is measured at the floor's
    // radius, so the streaks run straight up the cap toward the axis; adding
    // the axial distance textures the gorge's sides, where arc is constant.
    vec3 c = cylinderCoordinates(vWorld);
    float arc = radians(c.y) * RADIUS + c.x;
    float strata = valueNoise(vec2(arc / 120.0, c.z / 30.0));
    float streaks = smoothstep(0.45, 0.85, valueNoise(vec2(arc / 14.0, c.z / 350.0)))
      * smoothstep(0.3, 0.6, valueNoise(vec2(arc / 60.0, c.z / 120.0)));
    albedo *= (0.75 + 0.5 * strata) * (1.0 - 0.6 * streaks);
    // Moss holds to ledges, in bands across the face.
    float moss = smoothstep(0.66, 0.82, valueNoise(vec2(arc / 110.0, c.z / 18.0) + 9.0));
    albedo = mix(albedo, vec3(0.035, 0.05, 0.025), 0.7 * moss);
  }
  float sun = vKind > 0.25 ? sunlit(vWorld, normalize(vNormal), pixel) : 0.0;
  vec3 color = albedo * (uSunColor * sun + uFill);
  gl_FragColor = finish(throughAir(color, vWorld - view_position));
}
`;

// The falls: world positions, with flow (see createWaterfallMesh); spray
// puffs turn about the falls' up to face the camera.
const FALLS_VS = /* glsl */ `
attribute vec3 vertex_position;
attribute vec4 aFlow;
uniform mat4 matrix_viewProjection;
uniform vec3 view_position;
uniform vec3 uFallsUp;
varying vec3 vWorld;
varying vec4 vFlow;

void main(void) {
  vec3 world = vertex_position;
  if (aFlow.z > 1.5) {
    vec3 right = normalize(cross(uFallsUp, view_position - world));
    world += (right * aFlow.x + uFallsUp * 0.7 * aFlow.y) * 0.5 * aFlow.w;
  }
  vWorld = world;
  vFlow = aFlow;
  gl_Position = matrix_viewProjection * vec4(world, 1.0);
}
`;

const FALLS_PS = /* glsl */ `
uniform float uTime;
uniform float uFallTime;
uniform vec3 uFallsUp;
varying vec4 vFlow;
// White water and spray, and the clear water at the lip.
const vec3 FOAM = vec3(0.66, 0.69, 0.71);
const vec3 CLEAR = vec3(0.3, 0.38, 0.4);

void main(void) {
  float pixel = max(length(fwidth(vWorld)), 0.25);
  float alpha;
  vec3 albedo = FOAM;
  if (vFlow.z < 1.5) {
    // Sheets and veils: patterns fixed in fall time move at the water's own
    // speed. A clear, smooth sheet at the lip breaks into strands, then
    // froth; fine strands fade to their mean once narrower than a pixel.
    float fall = vFlow.y / uFallTime;
    float age = vFlow.y - uTime;
    float seed = vFlow.w * 13.7;
    float fine = 1.0 - smoothstep(0.3, 0.8, fwidth(vFlow.x * 16.0));
    float strands = 0.6 * valueNoise(vec2(vFlow.x * 6.0 + seed, age * 0.9))
      + 0.4 * mix(0.5, valueNoise(vec2(vFlow.x * 16.0 + seed, age * 2.2)), fine);
    float edge = 1.0 - smoothstep(0.6, 1.0, abs(vFlow.x));
    if (vFlow.z < 0.5) {
      float broken = smoothstep(0.04, 0.25, fall);
      float threshold = mix(0.0, 0.5, broken) - 0.15 * fall;
      alpha = edge * smoothstep(threshold, threshold + 0.25, strands)
        * mix(0.95, 0.75, fall) * (1.0 - 0.25 * vFlow.w);
      albedo = mix(CLEAR, FOAM, broken) * (0.8 + 0.4 * strands);
    } else {
      alpha = 0.4 * edge * smoothstep(0.05, 0.3, fall) * smoothstep(0.35, 0.8, strands);
    }
  } else {
    // Spray puffs, billowing up, densest at their hearts.
    float billow = 0.6 * valueNoise(vFlow.xy * 1.6 + vec2(vFlow.w, -uTime * 0.07))
      + 0.4 * valueNoise(vFlow.xy * 3.7 + vec2(-vFlow.w, -uTime * 0.13));
    alpha = 0.5 * (1.0 - smoothstep(0.2, 1.0, length(vFlow.xy))) * (0.3 + 1.0 * billow);
  }
  // Lit from the valley side, as the cliff face is.
  vec3 facing = normalize(uFallsUp - uSunward);
  vec3 color = albedo * (uSunColor * sunlit(vWorld, facing, pixel) + uFill);
  gl_FragColor = vec4(finish(throughAir(color, vWorld - view_position)).rgb, clamp(alpha, 0.0, 1.0));
}
`;

const INSTANCED_PS = /* glsl */ `
varying vec3 vNormal;
varying vec3 vAlbedo;

void main(void) {
  vec3 normal = normalize(vNormal);
  float pixel = max(length(fwidth(vWorld)), 0.25);
  vec3 color = vAlbedo * (uSunColor * sunlit(vWorld, normal, pixel) + uFill);
  gl_FragColor = finish(throughAir(color, vWorld - view_position));
}
`;

const TREE_PS = /* glsl */ `
// Colour, and the shape: view-space normal x and y, and leaf coverage.
uniform sampler2D uTreeColour;
uniform sampler2D uTreeShape;
varying vec4 vUv;
varying float vBlend;
varying vec3 vRight;
varying vec3 vUp;
varying vec3 vFacing;
varying vec2 vTree;
// Leaves pass on some of the sunlight on the far side of a crown.
const float LEAF_TRANSMISSION = 0.2;

void main(void) {
  float pixel = max(length(fwidth(vWorld)), 0.25);
  vec3 shape = mix(texture2D(uTreeShape, vUv.xy).rgb, texture2D(uTreeShape, vUv.zw).rgb, vBlend);
  if (shape.b < 0.35) discard;
  // The baked normals all face the camera.
  vec2 n = shape.rg * 2.0 - 1.0;
  vec3 normal = normalize(vRight * n.x + vUp * n.y
    + vFacing * sqrt(max(1.0 - dot(n, n), 0.0)));
  vec3 albedo = mix(texture2D(uTreeColour, vUv.xy).rgb, texture2D(uTreeColour, vUv.zw).rgb, vBlend);
  float sun = sunlit(vWorld, normal, pixel)
    + LEAF_TRANSMISSION * sunlit(vWorld, -normal, pixel);
  // The habitat's fill reaches less of a crown's lower, inner leaves.
  vec3 color = albedo * vTree.x * (uSunColor * sun + uFill * (0.5 + 0.5 * vTree.y));
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
  const treeMaterial = createMaterial("tree", TREE_VS, TREE_PS, constants, {
    attributes: { aPlace: pc.SEMANTIC_ATTR12, aShape: pc.SEMANTIC_ATTR13 },
  });
  const fallsMaterial = createMaterial("falls", FALLS_VS, FALLS_PS, constants, {
    attributes: { aFlow: pc.SEMANTIC_ATTR9 },
  });
  fallsMaterial.blendType = pc.BLEND_NORMAL;
  fallsMaterial.depthWrite = false;
  glassMaterial.depthWrite = false;
  const materials = [
    shellMaterial,
    glassMaterial,
    frameMaterial,
    instancedMaterial,
    treeMaterial,
    fallsMaterial,
  ];

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
    material.setParameter("uAirGlow", habitat.airGlow);
    material.setParameter(
      "uCandela",
      habitat.lampsOn * Math.PI * sceneLux(frame.definition),
    );
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
  treeMaterial.setParameter("uValley", [courseValleyCentre, courseSeed]);

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
  // screen. Trees wait for their atlases too.
  const valleyHalfWidth = (stripWidth / 2) * toRadians * radius;
  const instanceBuffers: pc.VertexBuffer[] = [];
  const textures: pc.Texture[] = [];
  const detail = new pc.Entity("island-three-detail");
  const forest = new pc.Entity("island-three-trees");
  const waterfall = new pc.Entity("island-three-falls");
  let disposed = false;
  const instancedOf = (data: Float32Array, mesh: pc.Mesh, material: pc.Material, drawOrder: number) => {
    const instance = instanceOf(mesh, material, drawOrder);
    const buffer = createInstanceBuffer(device, data);
    instanceBuffers.push(buffer);
    instance.setInstancing(buffer);
    return instance;
  };
  const addTrees = (trees: Float32Array, images: TreeImages) => {
    const [colour, shape] = (["colour", "shape"] as const).map((name) => {
      const texture = new pc.Texture(device, {
        addressU: pc.ADDRESS_CLAMP_TO_EDGE,
        addressV: pc.ADDRESS_CLAMP_TO_EDGE,
        anisotropy: 1,
        format: name === "colour" ? pc.PIXELFORMAT_SRGBA8 : pc.PIXELFORMAT_RGBA8,
        magFilter: pc.FILTER_LINEAR,
        minFilter: pc.FILTER_LINEAR_MIPMAP_LINEAR,
        mipmaps: true,
        name: `island-three-tree-${name}`,
      });
      texture.setSource(images[name]);
      textures.push(texture);
      return texture;
    });
    treeMaterial.setParameter("uTreeColour", colour!);
    treeMaterial.setParameter("uTreeShape", shape!);
    forest.addComponent("render", {
      castShadows: false,
      layers: [layer.id],
      meshInstances: [instancedOf(trees, createBillboardMesh(device), treeMaterial, 1)],
      receiveShadows: false,
    });
    app.root.addChild(forest);
  };
  const addDetail = () => {
    addStructures(frames, frame);
    const framesOnly = frameInstance.mesh;
    frameInstance.mesh = frames.build(device);
    meshes.splice(meshes.indexOf(framesOnly), 1, frameInstance.mesh);
    framesOnly.destroy();
    const buildings = createBuildingInstances(clearing, courseSeed, halfLength);
    detail.addComponent("render", {
      castShadows: false,
      layers: [layer.id],
      meshInstances:
        buildings.length > 0
          ? [instancedOf(buildings, createBoxMesh(device), instancedMaterial, 2)]
          : [],
      receiveShadows: false,
    });
    app.root.addChild(detail);
    const falls = createWaterfallMesh(device, frame, spacing * (PARK.seed - 1));
    fallsMaterial.setParameter("uFallTime", falls.fallTime);
    fallsMaterial.setParameter("uFallsUp", [falls.up.x, falls.up.y, falls.up.z]);
    waterfall.addComponent("render", {
      castShadows: false,
      layers: [layer.id],
      meshInstances: [instanceOf(falls.mesh, fallsMaterial, 6)],
      receiveShadows: false,
    });
    app.root.addChild(waterfall);
    // Lay the trees out now, so their atlases arriving costs only an upload.
    const trees = createTreeInstances(clearing, courseSeed, valleyHalfWidth);
    if (trees.length === 0) return;
    void loadTreeImages().then((images) => {
      if (images && !disposed) addTrees(trees, images);
    });
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
  // The falls' water and mist flow on the app's clock, paused or not; the
  // clock wraps hourly, when their pattern jumps once.
  let fallsTime = 0;
  const flowFalls = (dt: number) => {
    fallsTime = (fallsTime + dt) % 3600;
    fallsMaterial.setParameter("uTime", fallsTime);
  };
  app.on("update", flowFalls);

  return () => {
    app.off("prerender", followFov);
    app.off("update", flowFalls);
    disposed = true;
    app.off("postrender", addDetail);
    raceView.clearColorBuffer = true;
    view.destroy();
    detail.destroy();
    forest.destroy();
    waterfall.destroy();
    entity.destroy();
    app.scene?.layers.remove(layer);
    meshes.forEach((mesh) => mesh.destroy());
    instanceBuffers.forEach((buffer) => buffer.destroy());
    textures.forEach((texture) => texture.destroy());
    materials.forEach((material) => material.destroy());
  };
}

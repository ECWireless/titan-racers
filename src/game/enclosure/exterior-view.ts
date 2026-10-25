import { createHabitatField } from "../physics/rotating-habitat";
import { HABITAT_WORLD_ENVIRONMENT } from "../physics/world-environment";
import { EXPOSURE } from "../render/scene-look";
import {
  HABITAT_LAND_GLSL,
  HABITAT_MIRROR_GLSL,
  HABITAT_PATTERN_GLSL,
} from "./habitat-glsl";
import {
  AEROSOL_EXTINCTION,
  getEnclosureLight,
  RAYLEIGH_EXTINCTION,
} from "./habitat-light";
import {
  add,
  type CourseEnclosure,
  cross,
  dot,
  getEnclosureFrame,
  normalize,
  scaled,
  type Vector3,
} from "./island-three";

// Island Three from outside, for the loading screen: one full-screen shader
// that traces the habitat, its mirrors, and Saturn analytically. Coordinates
// are the habitat's own (metres): +Z toward the Sun along the axis, +X
// outward at azimuth 0°, +Y at 90°. The habitat turns about +Z at its true
// spin; the camera, the Sun, and Saturn stay still.

// Saturn from near Titan's orbit. Titan orbits within 0.35° of Saturn's ring
// plane; the habitat's own orbit tilts 2°, so it sees the rings nearly
// edge-on but open enough to read. The Sun stands 20° above them (Saturn's
// seasons reach 26.7°).
const SATURN = {
  distance: 1_221_870e3,
  equatorialRadius: 60_268e3,
  polarRadius: 54_364e3,
  ringElevationDegrees: 2,
  sunElevationDegrees: 20,
};

// The camera looks back at the habitat from its sunlit side, so the sunward
// end cap and the mirrors' faces catch the Sun. Saturn hangs behind it.
const VIEW = {
  fromAxisDegrees: 72,
  aroundAxisDegrees: 35,
  rollDegrees: 50,
  minFieldOfViewDegrees: 28,
  // Camera distance, in units of the distance at which the habitat's bounding
  // sphere just fills the narrower field of view; above 1 leaves a margin.
  framing: 1.05,
  saturnOffsetDegrees: 10,
  saturnBearingDegrees: 72,
  // Lifts the view above the loading screen's labels, as a fraction of the
  // screen's half height.
  lensShift: 0.2,
};

const toRadians = (degrees: number) => (degrees * Math.PI) / 180;

const VERTEX_SHADER = /* glsl */ `#version 300 es
void main(void) {
  vec2 corner = vec2(float((gl_VertexID << 1) & 2), float(gl_VertexID & 2));
  gl_Position = vec4(corner * 2.0 - 1.0, 0.0, 1.0);
}
`;

const FRAGMENT_SHADER = (
  constants: Record<string, number>,
) => /* glsl */ `#version 300 es
precision highp float;
${Object.entries(constants)
  .map(([key, value]) => `#define ${key} ${value.toPrecision(8)}\n`)
  .join("")}
uniform vec2 uResolution;
uniform vec3 uEye;
uniform vec3 uRight;
uniform vec3 uUp;
uniform vec3 uForward;
uniform float uTanHalfFov;
uniform float uSpin;
uniform vec3 uSunColor;
uniform vec3 uFill;
uniform vec3 uSaturn;
uniform mat3 uToSaturn;
uniform vec3 uRayleighExtinction;
out vec4 fragColor;

${HABITAT_PATTERN_GLSL}
${HABITAT_LAND_GLSL}
${HABITAT_MIRROR_GLSL}

const vec3 AEROSOL_TINT = vec3(0.95, 1.0, 1.05);
const vec3 SUN = vec3(0.0, 0.0, 1.0);
// Saturnshine: the only light on surfaces the Sun misses.
const float SATURNSHINE = 0.003;
const float GLASS = 0.9;
const float MIRROR_REFLECTANCE = 0.85;
const float MIRROR_SCATTER = 0.18;
const vec3 FRAME_STEEL = vec3(0.05, 0.055, 0.06);
const vec3 SATURN_BELTS = vec3(0.62, 0.52, 0.36);
const vec3 SATURN_ZONES = vec3(0.72, 0.65, 0.5);
const vec3 RING_ICE = vec3(1.0, 0.92, 0.8);

vec3 toHabitat(vec3 v) {
  float c = cos(uSpin);
  float s = sin(uSpin);
  return vec3(c * v.x + s * v.y, -s * v.x + c * v.y, v.z);
}

vec3 toSpace(vec3 v) {
  float c = cos(uSpin);
  float s = sin(uSpin);
  return vec3(c * v.x - s * v.y, s * v.x + c * v.y, v.z);
}

float azimuthOf(vec3 p) {
  return degrees(atan(p.y, p.x));
}

// Degrees from the nearest valley centre; windows lie beyond a quarter
// spacing.
float valleyOffset(float azimuth) {
  return azimuth - VALLEY_SPACING * floor(azimuth / VALLEY_SPACING + 0.5);
}

bool isWindow(float azimuth) {
  return abs(valleyOffset(azimuth)) > 0.25 * VALLEY_SPACING;
}

// Nearest hit on the hull from outside: the cylinder wall or an end cap.
float hitHull(vec3 origin, vec3 direction, out bool cap) {
  cap = false;
  float best = -1.0;
  float a = dot(direction.xy, direction.xy);
  float b = dot(origin.xy, direction.xy);
  float c = dot(origin.xy, origin.xy) - RADIUS * RADIUS;
  float disc = b * b - a * c;
  if (a > 0.0 && disc > 0.0) {
    float t = (-b - sqrt(disc)) / a;
    if (t > 0.0 && abs(origin.z + direction.z * t) <= HALF_LENGTH) best = t;
  }
  if (direction.z != 0.0) {
    float t = (sign(origin.z) * HALF_LENGTH - origin.z) / direction.z;
    vec3 p = origin + direction * t;
    if (t > 0.0 && (best < 0.0 || t < best) && dot(p.xy, p.xy) <= RADIUS * RADIUS) {
      best = t;
      cap = true;
    }
  }
  return best;
}

// Nearest mirror hit: distance, and its index, or -1.
float hitMirror(vec3 origin, vec3 direction, out int index) {
  index = -1;
  float best = 1e20;
  for (int i = 0; i < 3; i++) {
    float facing = dot(direction, uMirrorNormal[i]);
    if (abs(facing) < 1e-6) continue;
    float t = dot(uMirrorHinge[i] - origin, uMirrorNormal[i]) / facing;
    if (t <= 0.0 || t >= best) continue;
    vec3 hit = origin + direction * t - uMirrorHinge[i];
    float along = dot(hit, uMirrorAlong[i]);
    if (along < 0.0 || along > uMirrorSize.x) continue;
    if (abs(dot(hit, uMirrorAcross[i])) > uMirrorSize.y) continue;
    best = t;
    index = i;
  }
  return index < 0 ? -1.0 : best;
}

// The habitat air between two points inside: half-pressure air glowing with
// the sunlight it scatters, as the enclosure view draws it from inside.
vec3 throughAir(vec3 color, float distance) {
  vec3 transmit = exp(
    -(uRayleighExtinction + AEROSOL_TINT * AEROSOL_EXTINCTION) * distance
  );
  return color * transmit + uSunColor * AIR_GLOW * (1.0 - transmit);
}

// What a ray entering a window at entry sees inside: the far valley or end
// cap, sunlit through its own window, through the habitat's air.
vec3 interior(vec3 entry, vec3 direction, float travelled, float pixelAngle) {
  float a = dot(direction.xy, direction.xy);
  float t = a > 0.0 ? -2.0 * dot(entry.xy, direction.xy) / a : 1e20;
  vec3 far = entry + direction * t;
  vec3 color;
  if (abs(far.z) > HALF_LENGTH) {
    t = (sign(direction.z) * HALF_LENGTH - entry.z) / direction.z;
    far = entry + direction * t;
    vec3 normal = vec3(0.0, 0.0, -sign(direction.z));
    float pixel = (travelled + t) * pixelAngle / max(abs(direction.z), 0.1);
    vec3 albedo = endCap(length(far.xy), azimuthOf(far), pixel);
    color = albedo * (uSunColor * sunlit(far, normal, pixel) + uFill);
  } else {
    float azimuth = azimuthOf(far);
    if (isWindow(azimuth)) return throughAir(vec3(0.0), t);
    vec3 normal = -vec3(far.xy / RADIUS, 0.0);
    float pixel = (travelled + t) * pixelAngle
      / max(abs(dot(direction, normal)), 0.1);
    float valley = floor(azimuth / VALLEY_SPACING + 0.5);
    float seed = mod(valley, 3.0) + 1.0;
    vec2 q = vec2(far.z, radians(valleyOffset(azimuth)) * RADIUS);
    Land l = landAt(q, seed);
    vec3 albedo = landColor(l, q, vec2(pixel), seed);
    // The land's hills and woods shade it.
    vec3 relief = landRelief(l, q, seed, vec3(1.0, 0.0, 0.0), 1.0);
    normal = normalize(normal - relief.y * SUN - relief.z * cross(normal, SUN));
    color = albedo * (uSunColor * sunlit(far, normal, pixel) + uFill);
  }
  return throughAir(color, t);
}

// The hull seen from outside at distance t along a ray: plated land strips,
// framed windows onto the interior, and the end caps.
vec3 hull(vec3 origin, vec3 direction, float t, bool cap, float travelled, float pixelAngle) {
  vec3 p = origin + direction * t;
  float azimuth = azimuthOf(p);
  float distance = travelled + t;
  if (cap) {
    float pixel = distance * pixelAngle / max(abs(direction.z), 0.1);
    float light = p.z > 0.0 ? 1.0 : 0.0;
    return capHub(capPlating(length(p.xy), azimuth, pixel), length(p.xy), pixel)
      * uSunColor * (light + SATURNSHINE);
  }
  vec3 normal = vec3(p.xy / RADIUS, 0.0);
  float pixel = distance * pixelAngle / max(abs(dot(direction, normal)), 0.1);
  float arc = radians(azimuth) * RADIUS;
  float rings = lattice(p.z, 15.0, 1000.0, pixel);
  // Outward faces catch the mirrors' sunlight where they see a mirror's
  // sun image.
  vec3 light = uSunColor * (sunlit(p, normal, pixel) + SATURNSHINE);
  if (!isWindow(azimuth)) return PLATING * (1.0 + 0.6 * rings) * light;
  // Heavy sills on the window edges, longerons every 10°, ring frames every
  // kilometre, and mullions between them, as the enclosure view builds them.
  float edge = (0.125 * VALLEY_SPACING
    - abs(abs(valleyOffset(azimuth)) - 0.375 * VALLEY_SPACING))
    * radians(1.0) * RADIUS;
  float frames = max(
    max(band(edge, 30.0, pixel), lattice(arc, 15.0, RADIUS * radians(10.0), pixel)),
    max(rings, max(
      lattice(p.z, 4.0, 250.0, pixel),
      lattice(arc, 4.0, RADIUS * radians(2.5), pixel)
    ))
  );
  vec3 seen = GLASS * interior(p, direction, distance, pixelAngle);
  return mix(seen, FRAME_STEEL * light, frames);
}

// Normal optical depth of Saturn's main rings at a radius in Saturn radii.
float ringDepth(float radius) {
  if (radius < 1.239 || radius > 2.269) return 0.0;
  if (radius < 1.527) return 0.1;
  if (radius < 1.951) return mix(1.0, 2.5, smoothstep(1.53, 1.7, radius));
  if (radius < 2.027) return 0.1;
  return 0.5;
}

// Saturn along a direction from the habitat: colour and coverage. In
// Saturn's frame (pole +Z, distance 1), its globe is an oblate spheroid.
vec4 saturn(vec3 direction) {
  vec3 view = uToSaturn * direction;
  vec3 centre = uToSaturn * uSaturn;
  vec3 sun = uToSaturn * SUN;
  vec3 squash = vec3(1.0, 1.0, SATURN_OBLATENESS);
  vec3 a = view * squash;
  vec3 c = centre * squash;
  float aa = dot(a, a);
  float ac = dot(a, c);
  float disc = ac * ac - aa * (dot(c, c) - SATURN_RADIUS * SATURN_RADIUS);
  float globeT = disc > 0.0 ? (ac - sqrt(disc)) / aa : 1e20;

  vec4 result = vec4(0.0);
  if (disc > 0.0) {
    vec3 surface = view * globeT - centre;
    vec3 normal = normalize(surface * squash * squash);
    float latitude = asin(clamp(normal.z, -1.0, 1.0));
    vec3 albedo = mix(SATURN_BELTS, SATURN_ZONES,
      0.5 + 0.5 * sin(latitude * 17.0 + 0.6 * sin(latitude * 5.0)));
    albedo *= 0.92 + 0.08 * sin(latitude * 43.0);
    float light = max(dot(normal, sun), 0.0);
    // The rings' shadow on the globe.
    float toPlane = -surface.z / sun.z;
    if (toPlane > 0.0) {
      float shade = ringDepth(length((surface + sun * toPlane).xy) / SATURN_RADIUS);
      light *= exp(-shade / abs(sun.z));
    }
    result = vec4(albedo * light * uSunColor, 1.0);
  }

  // The rings, in front of the globe or beside it.
  float ringT = view.z != 0.0 ? centre.z / view.z : -1.0;
  if (ringT > 0.0 && ringT < globeT) {
    vec3 point = view * ringT - centre;
    float depth = ringDepth(length(point.xy) / SATURN_RADIUS);
    if (depth > 0.0) {
      float mu = abs(view.z);
      float mu0 = abs(sun.z);
      float alpha = 1.0 - exp(-depth / mu);
      // Lit face: single scattering off the ring particles.
      float iOverF = 0.3 * mu0 / (mu + mu0)
        * (1.0 - exp(-depth * (1.0 / mu + 1.0 / mu0)));
      // The globe's shadow on the rings.
      vec3 p = point * squash;
      vec3 s = sun * squash;
      float pb = dot(p, s);
      float shadowDisc = pb * pb - dot(s, s) * (dot(p, p) - SATURN_RADIUS * SATURN_RADIUS);
      if (shadowDisc > 0.0 && pb < 0.0) iOverF = 0.0;
      vec3 ring = RING_ICE * iOverF / max(alpha, 1e-3) * uSunColor;
      result = vec4(mix(result.rgb, ring, alpha), max(result.a, alpha));
    }
  }
  return result;
}

// Space along a direction: Saturn, antialiased over four samples when near,
// and the Sun as an overexposed point.
vec3 space(vec3 direction, vec3 du, vec3 dv, float pixelAngle) {
  vec3 color = vec3(0.0);
  if (dot(direction, uSaturn) > cos(2.4 * SATURN_RADIUS)) {
    vec4 sum = vec4(0.0);
    for (int i = 0; i < 4; i++) {
      vec2 o = vec2(float(i & 1), float(i >> 1)) - 0.5;
      sum += saturn(normalize(direction + 0.5 * (o.x * du + o.y * dv)));
    }
    color = sum.rgb / 4.0;
  }
  if (direction.z > 0.0) {
    float angle = length(cross(direction, SUN));
    color += uSunColor * 60.0
      * inside(angle - max(SUN_ANGULAR_RADIUS, pixelAngle), pixelAngle);
  }
  return color;
}

// Khronos PBR Neutral with the race's exposure, then sRGB gamma, as the
// race's own shaders finish.
vec3 finish(vec3 color) {
  color *= EXPOSURE;
  float startCompression = 0.8 - 0.04;
  float desaturation = 0.15;
  float x = min(color.r, min(color.g, color.b));
  float offset = x < 0.08 ? x - 6.25 * x * x : 0.04;
  color -= offset;
  float peak = max(color.r, max(color.g, color.b));
  if (peak >= startCompression) {
    float d = 1.0 - startCompression;
    float newPeak = 1.0 - d * d / (peak + d - startCompression);
    color *= newPeak / peak;
    float g = 1.0 - 1.0 / (desaturation * (peak - newPeak) + 1.0);
    color = mix(color, newPeak * vec3(1.0), g);
  }
  return pow(color + 0.0000001, vec3(1.0 / 2.2));
}

void main(void) {
  vec2 uv = (2.0 * gl_FragCoord.xy - uResolution) / uResolution.y
    - vec2(0.0, LENS_SHIFT);
  float pixelAngle = 2.0 * uTanHalfFov / uResolution.y;
  vec3 direction = normalize(uForward + (uv.x * uRight + uv.y * uUp) * uTanHalfFov);
  vec3 du = uRight * pixelAngle;
  vec3 dv = uUp * pixelAngle;

  vec3 origin = toHabitat(uEye);
  vec3 ray = toHabitat(direction);
  bool cap;
  float hullT = hitHull(origin, ray, cap);
  int mirror;
  float mirrorT = hitMirror(origin, ray, mirror);

  vec3 color;
  if (mirrorT > 0.0 && (hullT < 0.0 || mirrorT < hullT)) {
    vec3 normal = uMirrorNormal[mirror];
    vec3 hit = origin + ray * mirrorT;
    float facing = dot(ray, normal);
    if (facing > 0.0) {
      // The back of a mirror, away from the Sun.
      color = FRAME_STEEL * uSunColor * SATURNSHINE;
    } else {
      // Dusty film scatters some sunlight and reflects the rest of the view.
      vec3 local = hit - uMirrorHinge[mirror];
      float pixel = mirrorT * pixelAngle / -facing;
      float along = dot(local, uMirrorAlong[mirror]);
      float across = abs(dot(local, uMirrorAcross[mirror]));
      float seams = max(
        lattice(along, 6.0, 1000.0, pixel),
        lattice(across, 6.0, 500.0, pixel)
      );
      float edge = min(uMirrorSize.y - across, min(along, uMirrorSize.x - along));
      vec3 reflected = reflect(ray, normal);
      bool reflectedCap;
      float reflectedT = hitHull(hit, reflected, reflectedCap);
      vec3 seen = reflectedT > 0.0
        ? hull(hit, reflected, reflectedT, reflectedCap, mirrorT, pixelAngle)
        : space(toSpace(reflected), vec3(0.0), vec3(0.0), pixelAngle);
      color = uSunColor * MIRROR_SCATTER * dot(normal, SUN) * (1.0 - 0.7 * seams)
        + MIRROR_REFLECTANCE * seen;
      color = mix(color, FRAME_STEEL * uSunColor, inside(edge - 80.0, pixel));
    }
  } else if (hullT > 0.0) {
    color = hull(origin, ray, hullT, cap, 0.0, pixelAngle);
  } else {
    color = space(direction, du, dv, pixelAngle);
  }
  fragColor = vec4(finish(color), 1.0);
}
`;

function compile(gl: WebGL2RenderingContext, type: number, source: string) {
  const shader = gl.createShader(type)!;
  gl.shaderSource(shader, source);
  gl.compileShader(shader);
  return shader;
}

/**
 * Habitat-frame geometry for an enclosure: mirror uniforms, the camera, and
 * Saturn. The habitat frame is the enclosure frame seen from its axis
 * midpoint.
 */
function exteriorScene(enclosure: CourseEnclosure) {
  const frame = getEnclosureFrame(enclosure);
  const { length, radius } = frame.definition;
  const origin = frame.point(0, 0, 0);
  const axes = [frame.outward(0), frame.outward(90), frame.sunward];
  const direction = (v: Vector3) => ({
    x: dot(v, axes[0]!),
    y: dot(v, axes[1]!),
    z: dot(v, axes[2]!),
  });
  const point = (v: Vector3) => direction(add(v, origin, -1));
  const mirrors = frame.mirrors.map((mirror) => ({
    across: direction(mirror.across),
    along: direction(mirror.along),
    hinge: point(mirror.hinge),
    normal: direction(mirror.normal),
    toSun: direction(mirror.toSun),
  }));
  const [{ halfWidth, length: mirrorLength }] = frame.mirrors;

  // Frame the habitat by a sphere around everything the spin sweeps: the
  // hull and the mirrors' far corners.
  const tips = mirrors.flatMap(({ across, along, hinge }) =>
    [-1, 1].map((side) =>
      add(add(hinge, along, mirrorLength), across, side * halfWidth),
    ),
  );
  const reach = Math.max(radius, ...tips.map((p) => Math.hypot(p.x, p.y)));
  const zs = [-length / 2, length / 2, ...tips.map((p) => p.z)];
  const zMin = Math.min(...zs);
  const zMax = Math.max(...zs);
  const target = { x: 0, y: 0, z: (zMin + zMax) / 2 };
  const bound = Math.hypot(reach, (zMax - zMin) / 2);

  const fromAxis = toRadians(VIEW.fromAxisDegrees);
  const around = toRadians(VIEW.aroundAxisDegrees);
  const back = {
    x: Math.sin(fromAxis) * Math.cos(around),
    y: Math.sin(fromAxis) * Math.sin(around),
    z: Math.cos(fromAxis),
  };
  const forward = scaled(back, -1);
  const level = normalize(cross(forward, { x: 0, y: 0, z: 1 }));
  const levelUp = cross(level, forward);
  const roll = toRadians(VIEW.rollDegrees);
  const right = add(scaled(level, Math.cos(roll)), levelUp, Math.sin(roll));
  const up = cross(right, forward);

  const offset = toRadians(VIEW.saturnOffsetDegrees);
  const bearing = toRadians(VIEW.saturnBearingDegrees);
  const saturn = normalize(
    add(
      scaled(forward, Math.cos(offset)),
      add(scaled(up, Math.cos(bearing)), right, Math.sin(bearing)),
      Math.sin(offset),
    ),
  );
  // Saturn's pole: the habitat sits just off the ring plane and the Sun
  // further above it, on the same side, so the lit faces show.
  const toHabitat = scaled(saturn, -1);
  const sun = { x: 0, y: 0, z: 1 };
  const ringSine = Math.sin(toRadians(SATURN.ringElevationDegrees));
  const sunSine = Math.sin(toRadians(SATURN.sunElevationDegrees));
  const cosine = dot(toHabitat, sun);
  const determinant = 1 - cosine * cosine;
  const a = (ringSine - sunSine * cosine) / determinant;
  const b = (sunSine - ringSine * cosine) / determinant;
  const inPlane = add(scaled(toHabitat, a), sun, b);
  const pole = add(
    inPlane,
    normalize(cross(toHabitat, sun)),
    Math.sqrt(Math.max(0, 1 - dot(inPlane, inPlane))),
  );
  const equator = normalize(cross(pole, sun));
  const equator90 = cross(pole, equator);

  return {
    bound,
    forward,
    halfLength: length / 2,
    mirrorSize: [mirrorLength, halfWidth],
    mirrors,
    radius,
    right,
    saturn,
    // Rows of the habitat-to-Saturn rotation, as GLSL's column-major mat3.
    toSaturn: [
      equator.x,
      equator90.x,
      pole.x,
      equator.y,
      equator90.y,
      pole.y,
      equator.z,
      equator90.z,
      pole.z,
    ],
    target,
    up,
    valleySpacing: 360 / frame.definition.valleyCount,
  };
}

export type ExteriorView = {
  /** Resolves once the first frame is on screen. */
  firstFrame: Promise<void>;
  dispose(): void;
};

// Past this angle the mirrors turn edge-on to the Sun, so from outside the
// habitat goes dark. The loading screen shows Island Three by day; the race
// keeps its course's own time.
const EXTERIOR_MIRROR_ANGLE_MAX = 80;

/**
 * Draws Island Three from outside on a canvas filling a container, at one
 * pixel per CSS pixel, turning at the habitat's true spin. Each view owns
 * its canvas, so its context can be released at once on disposal. Returns
 * null without a usable WebGL 2 context or if its shader fails.
 */
export function createExteriorView(
  container: HTMLElement,
  courseEnclosure: CourseEnclosure,
): ExteriorView | null {
  const enclosure = {
    ...courseEnclosure,
    mirrorAngle: Math.min(
      courseEnclosure.mirrorAngle,
      EXTERIOR_MIRROR_ANGLE_MAX,
    ),
  };
  const canvas = document.createElement("canvas");
  canvas.setAttribute("aria-hidden", "true");
  canvas.style.cssText = "position:absolute;inset:0;width:100%;height:100%";
  container.append(canvas);
  const gl = canvas.getContext("webgl2", {
    alpha: false,
    antialias: false,
    depth: false,
    stencil: false,
  });
  // A page over its context budget can be handed an already-lost context.
  if (!gl || gl.isContextLost()) {
    canvas.remove();
    return null;
  }

  const scene = exteriorScene(enclosure);
  const definition = getEnclosureFrame(enclosure).definition;
  const { color, intensity } = definition.sunlight;
  const { airGlow, fill } = getEnclosureLight(enclosure);
  const spinRate = createHabitatField(
    enclosure,
    HABITAT_WORLD_ENVIRONMENT.gravity,
  ).spinRate;

  const program = gl.createProgram()!;
  const vertex = compile(gl, gl.VERTEX_SHADER, VERTEX_SHADER);
  const fragment = compile(
    gl,
    gl.FRAGMENT_SHADER,
    FRAGMENT_SHADER({
      AEROSOL_EXTINCTION,
      AIR_GLOW: airGlow,
      EXPOSURE,
      HALF_LENGTH: scene.halfLength,
      LENS_SHIFT: VIEW.lensShift,
      RADIUS: scene.radius,
      SATURN_OBLATENESS: SATURN.equatorialRadius / SATURN.polarRadius,
      SATURN_RADIUS: SATURN.equatorialRadius / SATURN.distance,
      VALLEY_SPACING: scene.valleySpacing,
    }),
  );
  gl.attachShader(program, vertex);
  gl.attachShader(program, fragment);
  gl.linkProgram(program);
  if (!gl.getProgramParameter(program, gl.LINK_STATUS)) {
    console.error(gl.getShaderInfoLog(fragment));
    gl.getExtension("WEBGL_lose_context")?.loseContext();
    canvas.remove();
    return null;
  }
  gl.useProgram(program);

  const location = (name: string) => gl.getUniformLocation(program, name);
  const vec = ({ x, y, z }: Vector3) => [x, y, z];
  const mirrorArray = (key: keyof (typeof scene.mirrors)[number]) =>
    new Float32Array(scene.mirrors.flatMap((mirror) => vec(mirror[key])));
  gl.uniform3fv(location("uMirrorHinge"), mirrorArray("hinge"));
  gl.uniform3fv(location("uMirrorNormal"), mirrorArray("normal"));
  gl.uniform3fv(location("uMirrorAlong"), mirrorArray("along"));
  gl.uniform3fv(location("uMirrorAcross"), mirrorArray("across"));
  gl.uniform3fv(location("uMirrorToSun"), mirrorArray("toSun"));
  gl.uniform2fv(location("uMirrorSize"), scene.mirrorSize);
  gl.uniform3fv(location("uSunColor"), [
    color.r * intensity,
    color.g * intensity,
    color.b * intensity,
  ]);
  gl.uniform3fv(location("uFill"), [fill.r, fill.g, fill.b]);
  gl.uniform3fv(location("uSaturn"), vec(scene.saturn));
  gl.uniformMatrix3fv(location("uToSaturn"), false, scene.toSaturn);
  gl.uniform3fv(location("uRayleighExtinction"), [...RAYLEIGH_EXTINCTION]);
  gl.uniform3fv(location("uRight"), vec(scene.right));
  gl.uniform3fv(location("uUp"), vec(scene.up));
  gl.uniform3fv(location("uForward"), vec(scene.forward));
  const resolution = location("uResolution");
  const eye = location("uEye");
  const tanHalfFov = location("uTanHalfFov");
  const spin = location("uSpin");

  let width = 0;
  let height = 0;
  const resize = () => {
    const nextWidth = Math.max(1, Math.round(canvas.clientWidth));
    const nextHeight = Math.max(1, Math.round(canvas.clientHeight));
    if (nextWidth === width && nextHeight === height) return;
    width = canvas.width = nextWidth;
    height = canvas.height = nextHeight;
    gl.viewport(0, 0, width, height);
    gl.uniform2f(resolution, width, height);
    // The habitat's bounding sphere fits the narrower field of view.
    const tanMin = Math.tan(toRadians(VIEW.minFieldOfViewDegrees) / 2);
    const tanVertical = width >= height ? tanMin : (tanMin * height) / width;
    gl.uniform1f(tanHalfFov, tanVertical);
    const distance = (VIEW.framing * scene.bound) / Math.sin(Math.atan(tanMin));
    gl.uniform3fv(eye, vec(add(scene.target, scene.forward, -distance)));
  };

  let frameId = 0;
  let resolveFirstFrame: () => void = () => undefined;
  const firstFrame = new Promise<void>((resolve) => {
    resolveFirstFrame = resolve;
  });
  // The spin starts with a window facing the camera.
  let startTime: number | null = null;
  const draw = (time: number) => {
    resize();
    startTime ??= time;
    gl.uniform1f(
      spin,
      ((spinRate * (time - startTime)) / 1000) % (2 * Math.PI),
    );
    gl.drawArrays(gl.TRIANGLES, 0, 3);
    resolveFirstFrame();
    frameId = requestAnimationFrame(draw);
  };
  // A lost context ends the view; the loading screen carries on without it.
  const stop = () => {
    cancelAnimationFrame(frameId);
    resolveFirstFrame();
  };
  canvas.addEventListener("webglcontextlost", stop);
  frameId = requestAnimationFrame(draw);

  return {
    firstFrame,
    dispose() {
      stop();
      canvas.removeEventListener("webglcontextlost", stop);
      gl.deleteProgram(program);
      gl.deleteShader(vertex);
      gl.deleteShader(fragment);
      gl.getExtension("WEBGL_lose_context")?.loseContext();
      canvas.remove();
    },
  };
}

import * as pc from "playcanvas";

import {
  AEROSOL_EXTINCTION,
  AIR_GLOW,
  CLEARING_RADIUS,
  type HabitatLight,
  RAYLEIGH_EXTINCTION,
} from "./habitat-light";
import {
  HABITAT_LAND_GLSL,
  HABITAT_MIRROR_GLSL,
  HABITAT_PATTERN_GLSL,
} from "./habitat-glsl";
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
${HABITAT_MIRROR_GLSL}

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
uniform vec3 uClearing;
${HABITAT_LAND_GLSL}

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

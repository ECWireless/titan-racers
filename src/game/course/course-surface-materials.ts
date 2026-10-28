import * as pc from "playcanvas";

import type {
  CourseTopFaceMeshes,
  RoughCourseMaterials,
} from "./build-rough-course";
import {
  COURSE_ASPHALT_COLOR,
  COURSE_LAWN_COLOR,
  COURSE_TURF_COLOR,
  getCourseSurfaceLayerDepthBias,
  type CourseSurfaceLayer,
} from "./course-visual-policy";
import type {
  CourseScannedSurface,
  CourseSurfaceImages,
} from "./course-surface-textures";
import { COURSE_WATER_FLOW_SPEED } from "./course-water";
import { applyAdaptedEnvironmentAtlas } from "../render/scene-look";

// Retained CPU pixels are shared by page mounts and re-upload after context
// restoration. GPU textures belong to one scene and are released with it.
let grainPixels: Uint8Array | undefined;
const GRAIN_SIZE = 512;

function getGrainPixels() {
  if (grainPixels) return grainPixels;
  const pixels = new Uint8Array(GRAIN_SIZE * GRAIN_SIZE * 4);
  let seed = 72491;
  for (let y = 0; y < GRAIN_SIZE; y++) {
    for (let x = 0; x < GRAIN_SIZE; x++) {
      seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0;
      const offset = (y * GRAIN_SIZE + x) * 4;
      // Fine aggregate and a seamless, broad variation occupy separate channels.
      pixels[offset] = 145 + (seed >>> 25) * 0.8;
      pixels[offset + 1] = 186 + 18 * Math.sin(x * Math.PI * 2 / GRAIN_SIZE)
        * Math.cos(y * Math.PI * 4 / GRAIN_SIZE)
        + 12 * Math.sin((x + y) * Math.PI * 6 / GRAIN_SIZE);
      pixels[offset + 2] = 186;
      pixels[offset + 3] = 255;
    }
  }
  grainPixels = pixels;
  return pixels;
}

// All finishes use the same program. Coordinates depend only on world position,
// so overlapped caps/straights and editor transforms never reveal UV seams.
const SURFACE_ALBEDO = `
uniform vec3 material_diffuse;
uniform sampler2D courseGrain;
uniform vec3 courseFinish;
void getAlbedo() {
    vec2 world = vPositionW.xz;
    float grain = texture2D(courseGrain, world / 1.8).r;
    float broad = texture2D(courseGrain, mat2(0.8, -0.6, 0.6, 0.8) * world / 48.0).g;
    float variation = (grain - 0.25) * courseFinish.x + (broad - 0.5) * courseFinish.y;
    float mowing = sin(world.y * 1.5707963) * courseFinish.z;
    dAlbedo = material_diffuse * (1.0 + variation + mowing);
}
`;

// Water ripples at real size: a seamless 1 m tile of capillary and small
// gravity ripples, 5–12 cm long with the same steepness, stored as normals.
// Integer wave counts per tile keep it seamless; mipmaps average it out at a
// distance.
let ripplePixels: Uint8Array | undefined;
const RIPPLE_SIZE = 128;
const RIPPLE_WAVES = 24;
const RIPPLE_SLOPE = 0.035;

function getRipplePixels() {
  if (ripplePixels) return ripplePixels;
  let seed = 90127;
  const random = () => {
    seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0;
    return seed / 2 ** 32;
  };
  const waves = Array.from({ length: RIPPLE_WAVES }, () => {
    const cycles = 8 + random() * 12;
    const angle = random() * Math.PI * 2;
    const kx = Math.round(cycles * Math.cos(angle));
    const ky = Math.round(cycles * Math.sin(angle));
    const k = Math.hypot(kx, ky);
    const phase = random() * Math.PI * 2;
    // cos(a + b) from per-row and per-column tables, rather than a cosine
    // per texel.
    const table = (cycles: number, offset: number) => {
      const angles = Array.from(
        { length: RIPPLE_SIZE },
        (_, index) => (2 * Math.PI * cycles * index) / RIPPLE_SIZE + offset,
      );
      return { cos: angles.map(Math.cos), sin: angles.map(Math.sin) };
    };
    // Every wave is equally steep, whatever its length.
    return { dx: kx / k, dy: ky / k, x: table(kx, phase), y: table(ky, 0) };
  });
  const pixels = new Uint8Array(RIPPLE_SIZE * RIPPLE_SIZE * 4);
  for (let y = 0; y < RIPPLE_SIZE; y++) {
    for (let x = 0; x < RIPPLE_SIZE; x++) {
      let dx = 0;
      let dy = 0;
      for (const wave of waves) {
        const slope =
          RIPPLE_SLOPE *
          (wave.x.cos[x]! * wave.y.cos[y]! - wave.x.sin[x]! * wave.y.sin[y]!);
        dx += slope * wave.dx;
        dy += slope * wave.dy;
      }
      const length = Math.hypot(dx, dy, 1);
      const offset = (y * RIPPLE_SIZE + x) * 4;
      pixels[offset] = Math.round((0.5 - dx / length / 2) * 255);
      pixels[offset + 1] = Math.round((0.5 - dy / length / 2) * 255);
      pixels[offset + 2] = Math.round((0.5 + 0.5 / length) * 255);
      pixels[offset + 3] = 255;
    }
  }
  ripplePixels = pixels;
  return pixels;
}

// The ripple tile drifts downstream (u) with the surface, once at its own
// 1 m size and once four times larger, turned by a 3-4-5 angle, and half as
// steep, for longer swells, so the two never line up into a visible repeat.
// Each layer's drift is in metres; the turned layer repeats every 20 m.
const WATER_RIPPLE_LAYERS = { broad: 4, broadRepeat: 20, fine: 1 };
const WATER_NORMAL = `
uniform vec2 courseWaterFlow;
void getNormal() {
    vec2 uv = {STD_NORMAL_TEXTURE_UV};
    vec3 fine = texture2D({STD_NORMAL_TEXTURE_NAME},
        (uv - vec2(courseWaterFlow.x, 0.0)) / ${WATER_RIPPLE_LAYERS.fine.toFixed(1)}).xyz * 2.0 - 1.0;
    mat2 turn = mat2(0.8, 0.6, -0.6, 0.8);
    vec3 broad = texture2D({STD_NORMAL_TEXTURE_NAME},
        turn * (uv - vec2(courseWaterFlow.y, 0.0)) / ${WATER_RIPPLE_LAYERS.broad.toFixed(1)}).xyz * 2.0 - 1.0;
    // Slopes add; the turned layer's turn back into the surface's frame.
    vec2 slope = fine.xy / max(fine.z, 0.2)
        + 0.5 * (transpose(turn) * broad.xy) / max(broad.z, 0.2);
    dNormalW = normalize(dTBN * vec3(slope, 1.0));
}
`;

// Scanned finishes (CC0 ambientCG scans, see docs/visual-identity.md). The
// albedo image stores each texel's colour as a quarter of its ratio to the
// scan's mean, so the finish keeps the palette's average colour while the scan
// supplies variation. The surface image packs the OpenGL normal's x and y
// with roughness.
const SCANNED_SURFACE_ALBEDO = `
uniform vec3 material_diffuse;
uniform sampler2D courseGrain;
uniform vec3 courseFinish;
uniform sampler2D courseScanAlbedo;
uniform sampler2D courseScanSurface;
// x: texture repeats per metre, y: normal strength, z: share of the scan's
// own hue kept, w: the scan's mean roughness.
uniform vec4 courseScan;
vec4 courseScanSample;
// Mowing stripes: alternate 2 m bands lean +x and -x. A band looks lighter
// when its blades lean away from the viewer and darker when they lean toward.
float getMowingStripe(vec2 world) {
    float horizontal = length(dViewDirW.xz);
    if (courseFinish.z == 0.0 || horizontal < 0.001) return 0.0;
    float lean = clamp(sin(world.y * 1.5707963) * 6.0, -1.0, 1.0);
    return -lean * dViewDirW.x / horizontal * courseFinish.z;
}
void getAlbedo() {
    vec2 world = vPositionW.xz;
    vec2 uv = world * courseScan.x;
    vec3 ratio = texture2D(courseScanAlbedo, uv).rgb * 4.0;
    courseScanSample = texture2D(courseScanSurface, uv);
    float broad = texture2D(courseGrain, mat2(0.8, -0.6, 0.6, 0.8) * world / 48.0).g;
    // Brightness follows the scan; hue keeps only a share of its variation so
    // dim channels are not amplified into speckle.
    float brightness = dot(ratio, vec3(0.2126, 0.7152, 0.0722));
    vec3 tint = mix(vec3(1.0), ratio / max(brightness, 0.002), courseScan.z);
    dAlbedo = material_diffuse * brightness * tint
        * (1.0 + (broad - 0.5) * courseFinish.y + getMowingStripe(world));
}
`;

const SCANNED_SURFACE_NORMAL = `
void getNormal() {
    vec2 slope = (courseScanSample.rg * 2.0 - 1.0) * courseScan.y;
    float up = sqrt(max(0.0, 1.0 - dot(slope, slope)));
    // Texture u follows world +x and the image's up (OpenGL green) world -z.
    // Only upward faces carry the scan's relief.
    dNormalW = dVertexNormalW.y > 0.99
        ? normalize(vec3(slope.x, up, -slope.y))
        : dVertexNormalW;
}
`;

// Each finish keeps its tuned gloss on average; the scan's roughness only
// varies it, because scanned roughness levels differ between sources.
const SCANNED_SURFACE_GLOSS = `
uniform float material_gloss;
void getGlossiness() {
    float relative = (1.0 - courseScanSample.b) / max(1.0 - courseScan.w, 0.05);
    dGlossiness = clamp(material_gloss * relative, 0.0, 1.0) + 0.0000001;
}
`;

const SCANNED_SURFACES: Record<
  CourseScannedSurface,
  // roughness: mean of the packed surface image's blue channel.
  { metres: number; normal: number; tint: number; roughness: number }
> = {
  asphalt: { metres: 2.2, normal: 1, tint: 0.12, roughness: 0.612 },
  lawn: { metres: 1.4, normal: 1, tint: 0.35, roughness: 0.544 },
  // A 1.4 m scan drawn smaller, so its blades read as clipped.
  turf: { metres: 0.8, normal: 0.8, tint: 0.35, roughness: 0.263 },
};

/**
 * Shared race/editor finishes. Given an interior's light, a second set of the
 * same finishes for indoor objects takes its environment instead of the
 * habitat's. The caller must destroy the returned bundle.
 */
export function createCourseSurfaceMaterials(
  device: pc.GraphicsDevice,
  interior?: { adaptation: number; atlas: pc.Texture },
) {
  const grain = new pc.Texture(device, {
    name: "course-world-grain",
    width: GRAIN_SIZE,
    height: GRAIN_SIZE,
    format: pc.PIXELFORMAT_SRGBA8,
    levels: [getGrainPixels()],
    mipmaps: true,
    minFilter: pc.FILTER_LINEAR_MIPMAP_LINEAR,
    magFilter: pc.FILTER_LINEAR,
    // The grain is fine noise, so anisotropic filtering adds little detail at
    // grazing angles for its texture bandwidth.
    anisotropy: 1,
    addressU: pc.ADDRESS_REPEAT,
    addressV: pc.ADDRESS_REPEAT,
  });
  const ripples = new pc.Texture(device, {
    name: "course-water-ripples",
    width: RIPPLE_SIZE,
    height: RIPPLE_SIZE,
    format: pc.PIXELFORMAT_RGBA8,
    levels: [getRipplePixels()],
    mipmaps: true,
    minFilter: pc.FILTER_LINEAR_MIPMAP_LINEAR,
    magFilter: pc.FILTER_LINEAR,
    // The chase camera sees water at grazing angles, where ripples stretch.
    anisotropy: 4,
    addressU: pc.ADDRESS_REPEAT,
    addressV: pc.ADDRESS_REPEAT,
  });
  // Murky stream water: the light it scatters back from below is a few
  // percent, and its surface reflects as water does (index 1.333, so 2%
  // straight down, rising toward grazing views). It shows no bed.
  const water = () => {
    const material = new pc.StandardMaterial();
    material.diffuse = new pc.Color(0.028, 0.032, 0.022).gamma();
    material.useMetalness = true;
    material.metalness = 0;
    material.refractionIndex = 1 / 1.333;
    material.gloss = 0.94;
    // The ripple chunk replaces the normal map's sampling; setting the map
    // gives the shader its UVs and a tangent frame from them.
    material.normalMap = ripples;
    material.shaderChunks.version = "2.20";
    material.shaderChunks.glsl.set("normalMapPS", WATER_NORMAL);
    material.setParameter("courseWaterFlow", [0, 0]);
    material.update();
    return material;
  };
  const finish = (
    color: pc.Color,
    gloss: number,
    variation: [number, number, number],
    layer?: CourseSurfaceLayer,
    scanned?: CourseScannedSurface,
  ) => {
    const material = new pc.StandardMaterial();
    material.diffuse = color;
    material.useMetalness = true;
    material.metalness = 0;
    material.gloss = gloss;
    material.depthBias = layer ? getCourseSurfaceLayerDepthBias(layer) : 0;
    material.slopeDepthBias = material.depthBias;
    material.shaderChunks.version = "2.20";
    material.shaderChunks.glsl.set("diffusePS", SURFACE_ALBEDO);
    material.setParameter("courseGrain", grain);
    material.setParameter("courseFinish", variation);
    material.update();
    if (scanned) scannedMaterials.push([material, scanned]);
    return material;
  };
  const scannedMaterials: Array<[pc.StandardMaterial, CourseScannedSurface]> = [];
  const scanTextures: pc.Texture[] = [];
  const hex = (color: string) => new pc.Color().fromString(color);
  const turf = () => hex(COURSE_TURF_COLOR);
  // Uncut lawn has stronger broad patches and no stripes.
  const lawn = () => hex(COURSE_LAWN_COLOR);
  const createFinishes = (): RoughCourseMaterials => ({
    asphalt: finish(new pc.Color(...COURSE_ASPHALT_COLOR), 0.18, [0.65, 0.28, 0], "asphalt", "asphalt"),
    baseGround: finish(turf(), 0.08, [0.45, 0.3, 0.035], undefined, "turf"),
    baseLawn: finish(lawn(), 0.05, [0.55, 0.42, 0], undefined, "lawn"),
    ground: finish(turf(), 0.08, [0.45, 0.3, 0.035], "ground", "turf"),
    lawn: finish(lawn(), 0.05, [0.55, 0.42, 0], "lawn", "lawn"),
    verge: finish(turf(), 0.08, [0.45, 0.3, 0.035], "verge", "turf"),
    line: finish(hex("#e8e3d7"), 0.27, [0.12, 0.04, 0], "line"),
    hazard: finish(hex("#ffbd59"), 0.27, [0.12, 0.04, 0], "line"),
    steel: finish(hex("#34404a"), 0.32, [0.08, 0.04, 0]),
    obstacleBarrel: finish(hex("#bd482d"), 0.3, [0.12, 0.08, 0]),
    obstacleBlock: finish(hex("#a9a393"), 0.16, [0.3, 0.16, 0]),
    ramp: finish(hex("#54646b"), 0.26, [0.25, 0.12, 0]),
    // The nursery: weathered treated softwood, dark bark mulch, and the
    // shaded inside of a clipped hedge, behind its leaves.
    timber: finish(hex("#857661"), 0.14, [0.3, 0.18, 0]),
    mulch: finish(hex("#3e3025"), 0.06, [0.7, 0.35, 0]),
    hedge: finish(hex("#46522f"), 0.08, [0.35, 0.25, 0]),
    water: water(),
  });
  const materials = createFinishes();
  const indoorMaterials = interior ? createFinishes() : null;
  if (indoorMaterials && interior) {
    Object.values(indoorMaterials).forEach((material) =>
      applyAdaptedEnvironmentAtlas(
        material,
        interior.atlas,
        interior.adaptation,
      ),
    );
  }
  const topFaces = {
    box: createTopFaceMesh(device, "box"),
    cylinder: createTopFaceMesh(device, "cylinder"),
  } satisfies CourseTopFaceMeshes;
  let waterSeconds = 0;
  return {
    /** Moves the water's ripples downstream by a frame's time. */
    advanceWater(seconds: number) {
      waterSeconds += seconds;
      const drift = waterSeconds * COURSE_WATER_FLOW_SPEED;
      // Wrapped where each layer repeats, so the drift keeps its precision.
      const flow = [
        drift % WATER_RIPPLE_LAYERS.fine,
        // Longer swells ride a little slower than the surface.
        (drift * 0.8) % WATER_RIPPLE_LAYERS.broadRepeat,
      ];
      [materials, indoorMaterials].forEach((finishes) =>
        finishes?.water.setParameter("courseWaterFlow", flow),
      );
    },
    indoorMaterials,
    materials,
    topFaces,
    /**
     * Switches asphalt, turf, and lawn to their scanned finishes. Until then
     * (or if the scans never load) they keep the code-built grain.
     */
    useScans(images: CourseSurfaceImages) {
      if (scanTextures.length > 0) return;
      const texture = (
        name: string,
        source: HTMLImageElement,
        format: number,
      ) => {
        const result = new pc.Texture(device, {
          name,
          format,
          mipmaps: true,
          minFilter: pc.FILTER_LINEAR_MIPMAP_LINEAR,
          magFilter: pc.FILTER_LINEAR,
          // Anisotropic filtering added little at the chase camera's angle.
          anisotropy: 1,
          addressU: pc.ADDRESS_REPEAT,
          addressV: pc.ADDRESS_REPEAT,
        });
        result.setSource(source);
        scanTextures.push(result);
        return result;
      };
      const scans = (["asphalt", "lawn", "turf"] as const).map(
        (surface) => [surface, images[surface]] as const,
      );
      const textures = Object.fromEntries(
        scans.map(([surface, image]) => [
          surface,
          {
            albedo: texture(`course-${surface}-albedo`, image.albedo, pc.PIXELFORMAT_SRGBA8),
            surface: texture(`course-${surface}-surface`, image.surface, pc.PIXELFORMAT_RGBA8),
          },
        ]),
      ) as Record<CourseScannedSurface, { albedo: pc.Texture; surface: pc.Texture }>;
      for (const [material, surface] of scannedMaterials) {
        const scan = SCANNED_SURFACES[surface];
        material.shaderChunks.glsl.set("diffusePS", SCANNED_SURFACE_ALBEDO);
        material.shaderChunks.glsl.set("normalMapPS", SCANNED_SURFACE_NORMAL);
        material.shaderChunks.glsl.set("glossPS", SCANNED_SURFACE_GLOSS);
        material.setParameter("courseScanAlbedo", textures[surface].albedo);
        material.setParameter("courseScanSurface", textures[surface].surface);
        material.setParameter("courseScan", [
          1 / scan.metres,
          scan.normal,
          scan.tint,
          scan.roughness,
        ]);
        material.update();
      }
    },
    destroy() {
      [materials, indoorMaterials].forEach((finishes) =>
        Object.values(finishes ?? {}).forEach((material) => material.destroy()),
      );
      Object.values(topFaces).forEach(releaseTopFaceMesh);
      grain.destroy();
      ripples.destroy();
      scanTextures.forEach((texture) => texture.destroy());
    },
  };
}

const TOP_FACE_DISC_SEGMENTS = 48;

// The upward face of a unit box or cylinder, scaled by the object's visual.
function createTopFaceMesh(
  device: pc.GraphicsDevice,
  shape: keyof CourseTopFaceMeshes,
) {
  const positions: number[] = [];
  const indices: number[] = [];
  if (shape === "box") {
    positions.push(-0.5, 0.5, -0.5, 0.5, 0.5, -0.5, 0.5, 0.5, 0.5, -0.5, 0.5, 0.5);
    indices.push(0, 2, 1, 0, 3, 2);
  } else {
    positions.push(0, 0.5, 0);
    for (let segment = 0; segment < TOP_FACE_DISC_SEGMENTS; segment++) {
      const angle = (segment / TOP_FACE_DISC_SEGMENTS) * Math.PI * 2;
      positions.push(Math.cos(angle) * 0.5, 0.5, Math.sin(angle) * 0.5);
      indices.push(0, ((segment + 1) % TOP_FACE_DISC_SEGMENTS) + 1, segment + 1);
    }
  }
  const mesh = new pc.Mesh(device);
  mesh.setPositions(positions);
  mesh.setNormals(positions.map((_, index) => (index % 3 === 1 ? 1 : 0)));
  mesh.setIndices(indices);
  mesh.update();
  // Mesh instances free a mesh when its count reaches zero. The bundle holds
  // one reference so editor rebuilds can reuse the shared mesh.
  mesh.incRefCount();
  return mesh;
}

// Instances still in the scene release the mesh when they are destroyed.
function releaseTopFaceMesh(mesh: pc.Mesh) {
  mesh.decRefCount();
  if (mesh.refCount < 1) mesh.destroy();
}

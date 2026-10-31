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
  getCourseSurfaceLayerSlopeDepthBias,
  type CourseSurfaceLayer,
} from "./course-visual-policy";
import {
  COURSE_SCANNED_SURFACES,
  type CourseScannedSurface,
  type CourseSurfaceImages,
} from "./course-surface-textures";
import { COURSE_WATER_FLOW_SPEED } from "./course-water";
import { applyAdaptedEnvironmentAtlas } from "../render/scene-look";

// Retained CPU pixels are shared by page mounts and re-upload after context
// restoration. GPU textures belong to one scene and are released with it.
let grainPixels: Uint8Array | undefined;
const GRAIN_SIZE = 512;

/** The finishes' CPU-side pixels, built ahead of a race once per page. */
export const prewarmCourseSurfacePixels = [getGrainPixels, getRipplePixels];

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

// Clear water seen from above: the bed shows through the light the surface
// does not reflect, less what the water absorbs and what the bed loses to
// being wet, and the surface adds its reflection (Fresnel-weighted already)
// and the faint blue-green the water scatters back in place of what it
// absorbed. The bed's share follows the stream's level surface, not each
// ripple: the ripples show in the reflection itself, and at grazing views
// their Fresnel term would otherwise speckle the bed.
const WATER_COMBINE = `
// x: the water's own transmission, y: the wet bed's darkening.
uniform vec2 courseWaterTransmission;
// The stream bed's colour, linear.
uniform vec3 courseWaterBedAlbedo;
float courseWaterBed;
vec3 combineColor(vec3 albedo, vec3 sheenSpecularity, float clearcoatSpecularity) {
    float facing = clamp(dot(dVertexNormalW, dViewDirW), 0.0, 1.0);
    float fresnel = 0.02 + 0.98 * pow(1.0 - facing, 5.0);
    courseWaterBed = (1.0 - fresnel)
        * courseWaterTransmission.x * courseWaterTransmission.y;
    vec3 surface = (1.0 - fresnel) * (1.0 - courseWaterTransmission.x)
        * albedo * dDiffuseLight;
#ifdef LIT_SPECULAR
    surface += dSpecularLight;
#endif
#ifdef LIT_REFLECTIONS
    surface += dReflection.rgb * dReflection.a;
#endif
    return surface;
}
`;
// Blending mixes the water's colour over the bed by its alpha, on the
// gamma-encoded screen. The alpha passes the bed's share; the colour is what
// makes the mix come out as the surface's light added to the bed's share,
// for a bed of the stream bed's colour in the light that reaches the water.
// Where even a full colour cannot reach that, as at a bright glint, the alpha
// rises and the glint covers the bed, as it does on real water.
const WATER_END = `
    vec3 waterSurface = combineColor(litArgs_albedo, litArgs_sheen_specularity, litArgs_clearcoat_specularity)
        + litArgs_emission;
    vec3 waterBedLight = courseWaterBedAlbedo * dDiffuseLight;
    vec3 waterSeen = gammaCorrectOutput(toneMap(addFog(
        waterSurface + courseWaterBed * waterBedLight)));
    vec3 waterBed = gammaCorrectOutput(toneMap(addFog(waterBedLight)));
    // The most the colour can add, and, in dim light, where the tone curve's
    // toe dims the bed's share below its encoded share, the least.
    vec3 waterNeed = (waterSeen - waterBed) / max(1.0 - waterBed, 0.001);
    vec3 waterShare = waterSeen / max(waterBed, 0.001);
    float courseWaterAlpha = clamp(max(max(
        1.0 - pow(courseWaterBed, 1.0 / 2.2),
        max(waterNeed.r, max(waterNeed.g, waterNeed.b))),
        1.0 - min(waterShare.r, min(waterShare.g, waterShare.b))), 0.001, 1.0);
    gl_FragColor.rgb = clamp(
        (waterSeen - (1.0 - courseWaterAlpha) * waterBed) / courseWaterAlpha,
        0.0, 1.0);
`;
// Reads the alpha the water's end chunk sets just before it in main.
const WATER_OUTPUT_ALPHA = `
gl_FragColor.a = courseWaterAlpha;
`;
// The share of the bed's light clear water passes down through a 0.3 m
// stream and back up: it takes about a quarter of the red and almost none of
// the green and blue, applied here as one share weighted by brightness, with
// the scattered blue-green giving the tint. Water filling a wet surface's
// pores lets less of its light back out, so a submerged bed shows about 70%
// as bright as it is dry.
const WATER_TRANSMISSION = [0.93, 0.7];
// Clean river gravel of pale granite and limestone, a light, cool grey.
const GRAVEL_COLOR = "#a4a7a7";

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
    // Texture u follows world +x and the image's up (OpenGL green) world -z,
    // laid onto the face: a ramp's relief tilts with it. Only faces turned
    // up, at most about 25 degrees from level, carry the scan's relief.
    vec3 n = dVertexNormalW;
    vec3 across = normalize(vec3(1.0, 0.0, 0.0) - n * n.x);
    vec3 along = normalize(vec3(0.0, 0.0, 1.0) - n * n.z);
    dNormalW = n.y > 0.9
        ? normalize(across * slope.x + n * up - along * slope.y)
        : n;
}
`;

// Walls, posts, and frames stand any way up, so a triplanar finish takes the
// scan along each axis a face turns toward, blended where it turns between
// them; on walls the image's up is world up. Formwork and coating marks show
// on a cast or sprayed side; a top is trowelled or settles smooth, so faces
// turned up or down keep only part of the scan's variation and relief.
const TRIPLANAR_SURFACE_ALBEDO = `
uniform vec3 material_diffuse;
uniform sampler2D courseGrain;
uniform vec3 courseFinish;
uniform sampler2D courseScanAlbedo;
uniform sampler2D courseScanSurface;
uniform vec4 courseScan;
// Faces turned up or down: their own scan (or the sides'), x: repeats per
// metre, y: normal strength, z: share of its variation kept, w: its mean
// roughness. courseGrime darkens walls with grime at ground level.
uniform sampler2D courseScanTopAlbedo;
uniform sampler2D courseScanTopSurface;
uniform vec4 courseScanTop;
uniform float courseGrime;
vec3 courseScanWeights;
vec4 courseScanX;
vec4 courseScanY;
vec4 courseScanZ;
vec4 courseScanSample;
void getAlbedo() {
    vec3 facing = pow(abs(dVertexNormalW), vec3(4.0));
    courseScanWeights = facing / (facing.x + facing.y + facing.z);
    vec3 at = vPositionW * courseScan.x;
    // Image rows run down from its top, so world up is -v on the sides.
    vec2 side = vec2(at.z, -at.y);
    vec2 front = vec2(at.x, -at.y);
    vec2 above = vPositionW.xz * courseScanTop.x;
    vec3 top = mix(vec3(1.0), texture2D(courseScanTopAlbedo, above).rgb * 4.0, courseScanTop.z);
    vec3 ratio = texture2D(courseScanAlbedo, side).rgb * 4.0 * courseScanWeights.x
        + top * courseScanWeights.y
        + texture2D(courseScanAlbedo, front).rgb * 4.0 * courseScanWeights.z;
    courseScanX = texture2D(courseScanSurface, side);
    courseScanY = texture2D(courseScanTopSurface, above);
    // The top's roughness, rescaled to the sides' mean so one gloss serves both.
    courseScanY.b = 1.0 - (1.0 - courseScanY.b) * (1.0 - courseScan.w) / max(1.0 - courseScanTop.w, 0.05);
    courseScanZ = texture2D(courseScanSurface, front);
    courseScanSample = courseScanX * courseScanWeights.x
        + courseScanY * courseScanWeights.y + courseScanZ * courseScanWeights.z;
    float broad = texture2D(courseGrain, mat2(0.8, -0.6, 0.6, 0.8) * vPositionW.xz / 48.0).g;
    float brightness = dot(ratio, vec3(0.2126, 0.7152, 0.0722));
    vec3 tint = mix(vec3(1.0), ratio / max(brightness, 0.002), courseScan.z);
    float grime = 1.0 - courseGrime * (1.0 - smoothstep(0.0, 0.6, vPositionW.y));
    dAlbedo = material_diffuse * brightness * tint * grime * (1.0 + (broad - 0.5) * courseFinish.y);
}
`;

// Each plane's relief tilts the face along that plane's image axes.
const TRIPLANAR_SURFACE_NORMAL = `
void getNormal() {
    vec2 x = (courseScanX.rg * 2.0 - 1.0) * courseScan.y;
    vec2 y = (courseScanY.rg * 2.0 - 1.0) * courseScanTop.y;
    vec2 z = (courseScanZ.rg * 2.0 - 1.0) * courseScan.y;
    dNormalW = normalize(dVertexNormalW
        + courseScanWeights.x * vec3(0.0, x.y, x.x)
        + courseScanWeights.y * vec3(y.x, 0.0, -y.y)
        + courseScanWeights.z * vec3(z.x, z.y, 0.0));
}
`;

// Road paint: the asphalt's grain shows through it, darker in its pits, on
// faces turned up only; painted boards and kerb sides stay plain.
const PAINT_SURFACE_ALBEDO = `
uniform vec3 material_diffuse;
uniform sampler2D courseScanAlbedo;
uniform sampler2D courseScanSurface;
uniform vec4 courseScan;
vec4 courseScanSample;
void getAlbedo() {
    vec2 uv = vPositionW.xz * courseScan.x;
    float road = smoothstep(0.8, 0.95, dVertexNormalW.y);
    float brightness = dot(texture2D(courseScanAlbedo, uv).rgb * 4.0, vec3(0.2126, 0.7152, 0.0722));
    courseScanSample = mix(vec4(0.5, 0.5, courseScan.w, 1.0), texture2D(courseScanSurface, uv), road);
    // Paint fills the pores between the stones only partly: they show dark.
    float pits = 0.7 * (1.0 - smoothstep(0.35, 0.8, brightness));
    dAlbedo = material_diffuse * mix(1.0, mix(1.0, brightness, 0.5) * (1.0 - pits), road);
}
`;

// Sawn timber: its mesh's UVs are metres with u along each piece's grain,
// where the wood scan's grain runs. The normal map's UVs give the shader
// those UVs and a tangent frame from them; the map itself is never sampled.
const GRAIN_SURFACE_ALBEDO = `
uniform vec3 material_diffuse;
uniform sampler2D courseGrain;
uniform vec3 courseFinish;
uniform sampler2D courseScanAlbedo;
uniform sampler2D courseScanSurface;
uniform vec4 courseScan;
vec4 courseScanSample;
void getAlbedo() {
    vec2 uv = {STD_NORMAL_TEXTURE_UV} * courseScan.x;
    vec3 ratio = texture2D(courseScanAlbedo, uv).rgb * 4.0;
    courseScanSample = texture2D(courseScanSurface, uv);
    float broad = texture2D(courseGrain, mat2(0.8, -0.6, 0.6, 0.8) * vPositionW.xz / 48.0).g;
    float brightness = dot(ratio, vec3(0.2126, 0.7152, 0.0722));
    vec3 tint = mix(vec3(1.0), ratio / max(brightness, 0.002), courseScan.z);
    dAlbedo = material_diffuse * brightness * tint * (1.0 + (broad - 0.5) * courseFinish.y);
}
`;

// The scan's relief, in the frame of the UVs: x along the grain, and the
// image's up (OpenGL green) toward falling v.
const GRAIN_SURFACE_NORMAL = `
void getNormal() {
    vec2 slope = (courseScanSample.rg * 2.0 - 1.0) * courseScan.y;
    dNormalW = normalize(dTBN * vec3(slope, sqrt(max(0.0, 1.0 - dot(slope, slope)))));
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

type ScannedFinish =
  | "asphalt"
  | "castConcrete"
  | "concrete"
  | "gravel"
  | "kerb"
  | "lawn"
  | "mulch"
  | "paint"
  | "steel"
  | "timber"
  | "turf";

type ScanLayer = {
  image: CourseScannedSurface;
  metres: number;
  normal: number;
  // Mean of the packed surface image's blue channel.
  roughness: number;
};

const SCANNED_SURFACES: Record<
  ScannedFinish,
  ScanLayer & {
    // How the scan is laid: from above, along each axis, along a timber
    // piece's grain, or as road paint.
    projection: "grain" | "paint" | "top" | "triplanar";
    tint: number;
    // A triplanar finish's faces turned up or down: their own scan, keeping
    // its whole variation; without one, a softened share of the sides'.
    top?: ScanLayer;
    // How much darker a triplanar finish is at ground level, from grime.
    grime?: number;
  }
> = {
  asphalt: { image: "asphalt", projection: "top", metres: 2.2, normal: 1, tint: 0.12, roughness: 0.612 },
  // Cast-in-place concrete poured against 1.2 m formwork panels: tunnels,
  // retaining walls, and fill.
  castConcrete: { image: "castConcrete", projection: "triplanar", metres: 4.8, normal: 0.6, tint: 0.12, roughness: 0.692, grime: 0.12 },
  // A coarse broom finish, its ridges about 2 cm apart, brushed across the
  // nursery's lanes.
  concrete: { image: "concrete", projection: "top", metres: 2, normal: 0.6, tint: 0.12, roughness: 0.608 },
  // Rounded river pebbles a few centimetres across, on a 0.5 m scan; their
  // mixed greys keep more of the scan's hue.
  gravel: { image: "gravel", projection: "top", metres: 0.5, normal: 1, tint: 0.35, roughness: 0.56 },
  // Sidewalk-grade kerbs: smooth formed faces under a broom-finished top.
  kerb: {
    image: "smoothConcrete",
    projection: "triplanar",
    metres: 1,
    normal: 0.5,
    tint: 0.12,
    roughness: 0.627,
    top: { image: "concrete", metres: 2, normal: 0.6, roughness: 0.608 },
  },
  lawn: { image: "lawn", projection: "top", metres: 1.4, normal: 1, tint: 0.35, roughness: 0.544 },
  // The nursery beds' composted soil, with bark and twigs a few centimetres
  // long through it, on a 1 m scan, the same on a bed's top and on its sides
  // where no edging covers them.
  mulch: {
    image: "soil",
    projection: "triplanar",
    metres: 1,
    normal: 1,
    tint: 0.35,
    roughness: 0.669,
    top: { image: "soil", metres: 1, normal: 1, roughness: 0.669 },
  },
  // Road paint over the asphalt's scan.
  paint: { image: "asphalt", projection: "paint", metres: 2.2, normal: 0.9, tint: 0, roughness: 0.612 },
  // Powder-coated or painted steel's fine orange peel, on a 512² scan
  // (about 1 mm a texel).
  steel: { image: "steel", projection: "triplanar", metres: 0.6, normal: 0.5, tint: 0, roughness: 0.298 },
  // Rough-sawn softwood's open grain, on a 512² scan (about 1 mm a texel),
  // weathered: the finish keeps little of the fresh wood's warm hue.
  timber: { image: "wood", projection: "grain", metres: 0.6, normal: 0.6, tint: 0.15, roughness: 0.405 },
  // A 1.4 m scan drawn smaller, so its blades read as clipped.
  turf: { image: "turf", projection: "top", metres: 0.8, normal: 0.8, tint: 0.35, roughness: 0.263 },
};

const SCANNED_CHUNKS = {
  grain: { diffusePS: GRAIN_SURFACE_ALBEDO, normalMapPS: GRAIN_SURFACE_NORMAL },
  paint: { diffusePS: PAINT_SURFACE_ALBEDO, normalMapPS: SCANNED_SURFACE_NORMAL },
  top: { diffusePS: SCANNED_SURFACE_ALBEDO, normalMapPS: SCANNED_SURFACE_NORMAL },
  triplanar: { diffusePS: TRIPLANAR_SURFACE_ALBEDO, normalMapPS: TRIPLANAR_SURFACE_NORMAL },
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
  // Clear stream water: its surface reflects as water does (index 1.333, so
  // 2% straight down, rising toward grazing views), and where it does not,
  // the bed shows through. Its diffuse colour is the blue-green it scatters
  // back.
  const water = () => {
    const material = new pc.StandardMaterial();
    material.diffuse = new pc.Color(0.02, 0.18, 0.2).gamma();
    material.blendType = pc.BLEND_NORMAL;
    material.depthWrite = false;
    material.useMetalness = true;
    material.metalness = 0;
    material.refractionIndex = 1 / 1.333;
    material.gloss = 0.94;
    // The ripple chunk replaces the normal map's sampling; setting the map
    // gives the shader its UVs and a tangent frame from them.
    material.normalMap = ripples;
    material.shaderChunks.version = "2.20";
    material.shaderChunks.glsl.set("normalMapPS", WATER_NORMAL);
    material.shaderChunks.glsl.set("combinePS", WATER_COMBINE);
    material.shaderChunks.glsl.set("endPS", WATER_END);
    material.shaderChunks.glsl.set("outputAlphaPS", WATER_OUTPUT_ALPHA);
    material.setParameter("courseWaterFlow", [0, 0]);
    material.setParameter("courseWaterTransmission", WATER_TRANSMISSION);
    const bed = new pc.Color().fromString(GRAVEL_COLOR).linear();
    material.setParameter("courseWaterBedAlbedo", [bed.r, bed.g, bed.b]);
    material.update();
    return material;
  };
  const finish = (
    color: pc.Color,
    gloss: number,
    variation: [number, number, number],
    layer?: CourseSurfaceLayer,
    scanned?: ScannedFinish,
  ) => {
    const material = new pc.StandardMaterial();
    material.diffuse = color;
    material.useMetalness = true;
    material.metalness = 0;
    material.gloss = gloss;
    material.depthBias = layer ? getCourseSurfaceLayerDepthBias(layer) : 0;
    material.slopeDepthBias = layer
      ? getCourseSurfaceLayerSlopeDepthBias(layer)
      : 0;
    material.shaderChunks.version = "2.20";
    material.shaderChunks.glsl.set("diffusePS", SURFACE_ALBEDO);
    material.setParameter("courseGrain", grain);
    material.setParameter("courseFinish", variation);
    material.update();
    if (scanned) scannedMaterials.push([material, scanned]);
    return material;
  };
  const scannedMaterials: Array<[pc.StandardMaterial, ScannedFinish]> = [];
  const scanTextures: pc.Texture[] = [];
  const hex = (color: string) => new pc.Color().fromString(color);
  const turf = () => hex(COURSE_TURF_COLOR);
  // Uncut lawn has stronger broad patches and no stripes.
  const lawn = () => hex(COURSE_LAWN_COLOR);
  const createFinishes = (): RoughCourseMaterials => ({
    asphalt: finish(new pc.Color(...COURSE_ASPHALT_COLOR), 0.18, [0.65, 0.28, 0], "asphalt", "asphalt"),
    baseAsphalt: finish(new pc.Color(...COURSE_ASPHALT_COLOR), 0.18, [0.65, 0.28, 0], undefined, "asphalt"),
    baseGround: finish(turf(), 0.08, [0.45, 0.3, 0.035], undefined, "turf"),
    baseLawn: finish(lawn(), 0.05, [0.55, 0.42, 0], undefined, "lawn"),
    ground: finish(turf(), 0.08, [0.45, 0.3, 0.035], "ground", "turf"),
    lawn: finish(lawn(), 0.05, [0.55, 0.42, 0], "lawn", "lawn"),
    verge: finish(turf(), 0.08, [0.45, 0.3, 0.035], "verge", "turf"),
    line: finish(hex("#e8e3d7"), 0.27, [0.12, 0.04, 0], "line", "paint"),
    hazard: finish(hex("#ffbd59"), 0.27, [0.12, 0.04, 0], "line", "paint"),
    steel: finish(hex("#34404a"), 0.32, [0.08, 0.04, 0], undefined, "steel"),
    // Painted steel: pipes, cabinets, and valves.
    obstacleBarrel: finish(hex("#bd482d"), 0.3, [0.12, 0.08, 0], undefined, "steel"),
    // Cast concrete, a neutral mid grey (about 25% reflectance), grimier at
    // ground level.
    obstacleBlock: finish(hex("#8a8a87"), 0.16, [0.3, 0.16, 0], undefined, "castConcrete"),
    // Sidewalk concrete, weathered to a light buff grey (about 35%).
    kerb: finish(hex("#a9a395"), 0.16, [0.3, 0.16, 0], undefined, "kerb"),
    ramp: finish(hex("#54646b"), 0.26, [0.25, 0.12, 0], undefined, "steel"),
    // The nursery: weathered treated softwood, its beds' moist, dark brown
    // soil (about 5%), and the shaded inside of a clipped hedge, behind its
    // leaves.
    timber: finish(hex("#857661"), 0.14, [0.3, 0.18, 0], undefined, "timber"),
    mulch: finish(hex("#4d4136"), 0.06, [0.7, 0.35, 0], undefined, "mulch"),
    hedge: finish(hex("#46522f"), 0.08, [0.35, 0.25, 0]),
    // A working nursery's brushed-concrete trolley lanes, weathered to about
    // 30% reflectance.
    concrete: finish(hex("#8e8d88"), 0.16, [0.3, 0.2, 0], "verge", "concrete"),
    // The stream's bed of clean river gravel, under the water.
    gravel: finish(hex(GRAVEL_COLOR), 0.2, [0.2, 0.1, 0], undefined, "gravel"),
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
     * Switches the scanned finishes (asphalt, cast and brushed concrete,
     * kerbs, gravel, turf, lawn, soil, steel, timber, and road paint) to
     * their scans. Until then (or if the scans never load) they keep the
     * code-built grain.
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
      const scans = COURSE_SCANNED_SURFACES.map(
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
      for (const [material, finish] of scannedMaterials) {
        const scan = SCANNED_SURFACES[finish];
        const chunks = SCANNED_CHUNKS[scan.projection];
        material.shaderChunks.glsl.set("diffusePS", chunks.diffusePS);
        material.shaderChunks.glsl.set("normalMapPS", chunks.normalMapPS);
        material.shaderChunks.glsl.set("glossPS", SCANNED_SURFACE_GLOSS);
        material.setParameter("courseScanAlbedo", textures[scan.image].albedo);
        material.setParameter("courseScanSurface", textures[scan.image].surface);
        if (scan.projection === "grain") {
          material.normalMap = textures[scan.image].surface;
        }
        if (scan.projection === "triplanar") {
          const top = scan.top ?? { ...scan, normal: scan.normal * 0.4 };
          material.setParameter("courseScanTopAlbedo", textures[top.image].albedo);
          material.setParameter("courseScanTopSurface", textures[top.image].surface);
          material.setParameter("courseScanTop", [
            1 / top.metres,
            top.normal,
            scan.top ? 1 : 0.35,
            top.roughness,
          ]);
          material.setParameter("courseGrime", scan.grime ?? 0);
        }
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

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

/** Shared race/editor finishes. The caller must destroy the returned bundle. */
export function createCourseSurfaceMaterials(device: pc.GraphicsDevice) {
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
  const finish = (
    color: pc.Color,
    gloss: number,
    variation: [number, number, number],
    layer?: CourseSurfaceLayer,
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
    return material;
  };
  const hex = (color: string) => new pc.Color().fromString(color);
  const turf = () => hex(COURSE_TURF_COLOR);
  // Uncut lawn has stronger broad patches and no stripes.
  const lawn = () => hex(COURSE_LAWN_COLOR);
  const materials = {
    asphalt: finish(new pc.Color(...COURSE_ASPHALT_COLOR), 0.18, [0.65, 0.28, 0], "asphalt"),
    baseGround: finish(turf(), 0.08, [0.45, 0.3, 0.035]),
    baseLawn: finish(lawn(), 0.05, [0.55, 0.42, 0]),
    ground: finish(turf(), 0.08, [0.45, 0.3, 0.035], "ground"),
    lawn: finish(lawn(), 0.05, [0.55, 0.42, 0], "lawn"),
    verge: finish(turf(), 0.08, [0.45, 0.3, 0.035], "verge"),
    line: finish(hex("#e8e3d7"), 0.27, [0.12, 0.04, 0], "line"),
    hazard: finish(hex("#ffbd59"), 0.27, [0.12, 0.04, 0], "line"),
    steel: finish(hex("#34404a"), 0.32, [0.08, 0.04, 0]),
    obstacleBarrel: finish(hex("#bd482d"), 0.3, [0.12, 0.08, 0]),
    obstacleBlock: finish(hex("#a9a393"), 0.16, [0.3, 0.16, 0]),
    ramp: finish(hex("#54646b"), 0.26, [0.25, 0.12, 0]),
  } satisfies RoughCourseMaterials;
  const topFaces = {
    box: createTopFaceMesh(device, "box"),
    cylinder: createTopFaceMesh(device, "cylinder"),
  } satisfies CourseTopFaceMeshes;
  return {
    materials,
    topFaces,
    destroy() {
      Object.values(materials).forEach((material) => material.destroy());
      Object.values(topFaces).forEach(releaseTopFaceMesh);
      grain.destroy();
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

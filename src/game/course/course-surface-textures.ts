import { decodeImage } from "../render/decode-image";
import asphaltAlbedo from "./surface-textures/asphalt-albedo.jpg";
import asphaltSurface from "./surface-textures/asphalt-surface.jpg";
import castConcreteAlbedo from "./surface-textures/cast-concrete-albedo.jpg";
import castConcreteSurface from "./surface-textures/cast-concrete-surface.jpg";
import concreteAlbedo from "./surface-textures/concrete-albedo.jpg";
import concreteSurface from "./surface-textures/concrete-surface.jpg";
import gravelAlbedo from "./surface-textures/gravel-albedo.jpg";
import gravelSurface from "./surface-textures/gravel-surface.jpg";
import lawnAlbedo from "./surface-textures/lawn-albedo.jpg";
import lawnSurface from "./surface-textures/lawn-surface.jpg";
import smoothConcreteAlbedo from "./surface-textures/smooth-concrete-albedo.jpg";
import smoothConcreteSurface from "./surface-textures/smooth-concrete-surface.jpg";
import soilAlbedo from "./surface-textures/soil-albedo.jpg";
import soilSurface from "./surface-textures/soil-surface.jpg";
import steelAlbedo from "./surface-textures/steel-albedo.jpg";
import steelSurface from "./surface-textures/steel-surface.jpg";
import turfAlbedo from "./surface-textures/turf-albedo.jpg";
import turfSurface from "./surface-textures/turf-surface.jpg";
import woodAlbedo from "./surface-textures/wood-albedo.jpg";
import woodSurface from "./surface-textures/wood-surface.jpg";
import leafColour from "./tree-textures/leaf-sprays-colour.jpg";
import leafCoverage from "./tree-textures/leaf-sprays-coverage.png";
import type { CourseLeafImages } from "./course-trees";

export const COURSE_SCANNED_SURFACES = [
  "asphalt",
  "castConcrete",
  "concrete",
  "gravel",
  "lawn",
  "smoothConcrete",
  "soil",
  "steel",
  "turf",
  "wood",
] as const;
export type CourseScannedSurface = (typeof COURSE_SCANNED_SURFACES)[number];

export type CourseSurfaceImages = Record<
  CourseScannedSurface,
  { albedo: HTMLImageElement; surface: HTMLImageElement }
> & { leaves: CourseLeafImages };

const SOURCES = {
  asphalt: { albedo: asphaltAlbedo, surface: asphaltSurface },
  castConcrete: { albedo: castConcreteAlbedo, surface: castConcreteSurface },
  concrete: { albedo: concreteAlbedo, surface: concreteSurface },
  gravel: { albedo: gravelAlbedo, surface: gravelSurface },
  lawn: { albedo: lawnAlbedo, surface: lawnSurface },
  smoothConcrete: { albedo: smoothConcreteAlbedo, surface: smoothConcreteSurface },
  soil: { albedo: soilAlbedo, surface: soilSurface },
  steel: { albedo: steelAlbedo, surface: steelSurface },
  turf: { albedo: turfAlbedo, surface: turfSurface },
  wood: { albedo: woodAlbedo, surface: woodSurface },
} satisfies Record<CourseScannedSurface, Record<"albedo" | "surface", { src: string }>>;

let loading: Promise<CourseSurfaceImages | null> | undefined;

/**
 * Decodes the scanned course finishes and leaf sprays once per page. The
 * images carry no colour profile, so the packed normals and roughness upload
 * unchanged.
 * Images are kept so textures re-upload after a lost WebGL context. Resolves
 * null when any image fails, and the course keeps its code-built finishes;
 * the next call retries.
 */
export function loadCourseSurfaceImages() {
  loading ??= Promise.all([
    ...Object.entries(SOURCES).map(async ([surface, { albedo, surface: packed }]) => {
      const [albedoImage, packedImage] = await Promise.all([
        decodeImage(albedo.src),
        decodeImage(packed.src),
      ]);
      return [surface, { albedo: albedoImage, surface: packedImage }] as const;
    }),
    // The nursery's leaf sprays, which hedges and young trees share.
    Promise.all([decodeImage(leafColour.src), decodeImage(leafCoverage.src)]).then(
      ([colour, coverage]) => ["leaves", { colour, coverage }] as const,
    ),
  ]).then(
    (entries) => Object.fromEntries(entries) as CourseSurfaceImages,
    (error: unknown) => {
      console.error("Unable to load course surface textures", error);
      loading = undefined;
      return null;
    },
  );
  return loading;
}

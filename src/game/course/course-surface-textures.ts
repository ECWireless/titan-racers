import { decodeImage } from "../render/decode-image";
import asphaltAlbedo from "./surface-textures/asphalt-albedo.jpg";
import asphaltSurface from "./surface-textures/asphalt-surface.jpg";
import lawnAlbedo from "./surface-textures/lawn-albedo.jpg";
import lawnSurface from "./surface-textures/lawn-surface.jpg";
import turfAlbedo from "./surface-textures/turf-albedo.jpg";
import turfSurface from "./surface-textures/turf-surface.jpg";

export type CourseScannedSurface = "asphalt" | "lawn" | "turf";

export type CourseSurfaceImages = Record<
  CourseScannedSurface,
  { albedo: HTMLImageElement; surface: HTMLImageElement }
>;

const SOURCES = {
  asphalt: { albedo: asphaltAlbedo, surface: asphaltSurface },
  lawn: { albedo: lawnAlbedo, surface: lawnSurface },
  turf: { albedo: turfAlbedo, surface: turfSurface },
} satisfies Record<CourseScannedSurface, Record<"albedo" | "surface", { src: string }>>;

let loading: Promise<CourseSurfaceImages | null> | undefined;

/**
 * Decodes the scanned course finishes once per page. The images carry no
 * colour profile, so the packed normals and roughness upload unchanged.
 * Images are kept so textures re-upload after a lost WebGL context. Resolves
 * null when any image fails, and the course keeps its code-built finishes;
 * the next call retries.
 */
export function loadCourseSurfaceImages() {
  loading ??= Promise.all(
    Object.entries(SOURCES).map(async ([surface, { albedo, surface: packed }]) => {
      const [albedoImage, packedImage] = await Promise.all([
        decodeImage(albedo.src),
        decodeImage(packed.src),
      ]);
      return [surface, { albedo: albedoImage, surface: packedImage }] as const;
    }),
  ).then(
    (entries) => Object.fromEntries(entries) as CourseSurfaceImages,
    (error: unknown) => {
      console.error("Unable to load course surface textures", error);
      loading = undefined;
      return null;
    },
  );
  return loading;
}

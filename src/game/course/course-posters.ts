import type { CourseMeshGeometry } from "./course-bevel";
import { drawLuckyLadyPoster } from "./posters/lucky-lady";

/** A poster's print: drawn once per page into a canvas of its size. */
type CoursePoster = {
  /** Draws the print, filling the canvas, top left at the origin. */
  draw(context: CanvasRenderingContext2D, width: number, height: number): void;
  /** The print's size in texels; its board keeps this shape. */
  height: number;
  width: number;
};

export type CoursePosterReference = { id: string; version: number };

// A published poster version never changes; new art is a new version. Prints
// are at most 512 × 768 texels, one texture each on a phone.
const COURSE_POSTERS: Readonly<
  Record<string, Readonly<Record<number, CoursePoster>>>
> = {
  // The Lucky Lady, an A1 (594 × 841 mm) print in the tunnel's store room:
  // the homebuilt homestead ship of G. K. O'Neill's The High Frontier.
  "poster.lucky-lady": {
    1: { draw: drawLuckyLadyPoster, height: 724, width: 512 },
  },
};

export function getCoursePoster({
  id,
  version,
}: CoursePosterReference): CoursePoster | null {
  const versions = Object.hasOwn(COURSE_POSTERS, id) ? COURSE_POSTERS[id] : undefined;
  return versions && Object.hasOwn(versions, version) ? versions[version] : null;
}

/**
 * A poster's print as one quad over its box's local +Z face, its top at the
 * box's top. UVs (both sets) run down from the print's top left, as the
 * canvas is uploaded.
 */
export function createCoursePosterGeometry(): CourseMeshGeometry {
  return {
    indices: [0, 1, 2, 0, 2, 3],
    normals: [0, 0, 1, 0, 0, 1, 0, 0, 1, 0, 0, 1],
    positions: [-0.5, -0.5, 0.5, 0.5, -0.5, 0.5, 0.5, 0.5, 0.5, -0.5, 0.5, 0.5],
    uvs: [0, 1, 1, 1, 1, 0, 0, 0],
  };
}

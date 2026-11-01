import type { CourseMeshGeometry } from "./course-bevel";

type Vec3 = { x: number; y: number; z: number };

/** One letter's cell in the atlas; lengths are in ems of its font. */
export type CourseSignGlyph = {
  /** Pen travel past the letter. */
  advance: number;
  /** The cell's width, padding included. */
  width: number;
  /** Atlas UVs of the cell's top left and bottom right; v runs down. */
  uv: [number, number, number, number];
};

/** The letters' atlas; lengths are in ems of its font. */
export type CourseSignGlyphs = {
  /** Height of a capital letter. */
  capHeight: number;
  /**
   * Every cell's height, and the pen's position and baseline within it,
   * from its top left.
   */
  cell: { height: number; left: number; top: number };
  glyphs: ReadonlyMap<string, CourseSignGlyph>;
  height: number;
  /** Coverage, one byte a texel, rows from the top. */
  pixels: Uint8Array;
  /** Pen travel for a space. */
  space: number;
  width: number;
};

const CHARACTERS =
  "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789.-";
// Bold DIN, the lettering of road and plant signs, where the system has it
// (iOS and macOS); otherwise Arial Narrow, or the system's sans.
const FONT = '"DIN Alternate", "DIN Condensed", "Arial Narrow", "Helvetica Neue", Arial, sans-serif';
const FONT_PIXELS = 64;
// Room around each letter so mipmaps do not bleed neighbours into it.
const PADDING = 6;
const ATLAS_WIDTH = 1024;
// A sign's capitals fill this much of its height, and its line this much of
// its width at most.
const CAP_SHARE = 0.62;
const WIDTH_SHARE = 0.9;

let glyphs: CourseSignGlyphs | undefined;

/**
 * Draws the signs' letters once per page into a coverage atlas, white on
 * clear, with each letter's metrics. Signs cut their letters out of it.
 */
export function getCourseSignGlyphs(): CourseSignGlyphs {
  if (glyphs) return glyphs;
  const canvas = document.createElement("canvas");
  const context = canvas.getContext("2d", { willReadFrequently: true })!;
  const font = `bold ${FONT_PIXELS}px ${FONT}`;
  context.font = font;
  const ascent = Math.ceil(FONT_PIXELS * 0.95);
  const cellHeight = Math.ceil(FONT_PIXELS * 1.25) + PADDING * 2;
  const cells = [...CHARACTERS].map((character) => ({
    character,
    width: Math.ceil(context.measureText(character).width) + PADDING * 2,
  }));
  let x = 0;
  let y = 0;
  const placed = cells.map((cell) => {
    if (x + cell.width > ATLAS_WIDTH) {
      x = 0;
      y += cellHeight;
    }
    const at = { ...cell, x, y };
    x += cell.width;
    return at;
  });
  const height = y + cellHeight;
  canvas.width = ATLAS_WIDTH;
  canvas.height = height;
  context.font = font;
  context.fillStyle = "#fff";
  context.textBaseline = "alphabetic";
  placed.forEach(({ character, x, y }) =>
    context.fillText(character, x + PADDING, y + PADDING + ascent),
  );
  const image = context.getImageData(0, 0, ATLAS_WIDTH, height).data;
  const pixels = new Uint8Array(ATLAS_WIDTH * height);
  for (let index = 0; index < pixels.length; index++) {
    pixels[index] = image[index * 4 + 3]!;
  }
  glyphs = {
    capHeight: context.measureText("H").actualBoundingBoxAscent / FONT_PIXELS,
    cell: {
      height: cellHeight / FONT_PIXELS,
      left: PADDING / FONT_PIXELS,
      top: (PADDING + ascent) / FONT_PIXELS,
    },
    glyphs: new Map(
      placed.map(({ character, width, x, y }) => [
        character,
        {
          advance: context.measureText(character).width / FONT_PIXELS,
          uv: [
            x / ATLAS_WIDTH,
            y / height,
            (x + width) / ATLAS_WIDTH,
            (y + cellHeight) / height,
          ],
          width: width / FONT_PIXELS,
        },
      ]),
    ),
    height,
    pixels,
    space: context.measureText(" ").width / FONT_PIXELS,
    width: ATLAS_WIDTH,
  };
  return glyphs;
}

/**
 * A sign's letters as one quad each on its box's local +Z face, sized to the
 * box: capitals centred on its height, the line centred across its width,
 * as large as both allow. UVs (both sets) point into the glyph atlas.
 */
export function createCourseSignGeometry(
  text: string,
  scale: Vec3,
  {
    capHeight,
    cell: box,
    glyphs: cells,
    space,
  }: Pick<CourseSignGlyphs, "capHeight" | "cell" | "glyphs" | "space">,
): CourseMeshGeometry {
  const characters = [...text];
  const advance = characters.reduce(
    (sum, character) => sum + (cells.get(character)?.advance ?? space),
    0,
  );
  const em = Math.min(
    (CAP_SHARE * scale.y) / capHeight,
    (WIDTH_SHARE * scale.x) / Math.max(advance, 1e-6),
  );
  const geometry: CourseMeshGeometry = {
    indices: [],
    normals: [],
    positions: [],
    uvs: [],
  };
  const baseline = (-capHeight * em) / 2;
  let pen = (-advance * em) / 2;
  for (const character of characters) {
    const cell = cells.get(character);
    if (!cell) {
      pen += space * em;
      continue;
    }
    const left = pen - box.left * em;
    const top = baseline + box.top * em;
    const [u0, v0, u1, v1] = cell.uv;
    const first = geometry.positions.length / 3;
    for (const [x, y, u, v] of [
      [left, top - box.height * em, u0, v1],
      [left + cell.width * em, top - box.height * em, u1, v1],
      [left + cell.width * em, top, u1, v0],
      [left, top, u0, v0],
    ] as const) {
      geometry.positions.push(x / scale.x, y / scale.y, 0.5);
      geometry.normals.push(0, 0, 1);
      geometry.uvs.push(u, v);
    }
    geometry.indices.push(first, first + 1, first + 2, first, first + 2, first + 3);
    pen += cell.advance * em;
  }
  return geometry;
}

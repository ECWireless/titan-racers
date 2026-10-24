import { decodeImage } from "../render/decode-image";
import colourAtlas from "./tree-textures/tree-colour.jpg";
import shapeAtlas from "./tree-textures/tree-shape.png";

export type TreeImages = { colour: HTMLImageElement; shape: HTMLImageElement };

let loading: Promise<TreeImages | null> | undefined;

/**
 * Decodes the tree billboard atlases once per page. Resolves null when
 * either image fails, and the race draws no trees; the next call retries.
 */
export function loadTreeImages() {
  loading ??= Promise.all([decodeImage(colourAtlas.src), decodeImage(shapeAtlas.src)]).then(
    ([colour, shape]) => ({ colour, shape }),
    (error: unknown) => {
      console.error("Unable to load tree textures", error);
      loading = undefined;
      return null;
    },
  );
  return loading;
}

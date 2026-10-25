/**
 * Decodes an image element. Image elements, not ImageBitmaps: PlayCanvas
 * avoids ImageBitmap uploads on Safari.
 */
export async function decodeImage(url: string) {
  const image = new Image();
  image.src = url;
  await image.decode();
  return image;
}

import { z } from "zod";

export const KART_THUMBNAIL_CONTENT_TYPE = "image/png";
export const KART_THUMBNAIL_HEIGHT = 360;
export const KART_THUMBNAIL_MAX_BYTES = 512 * 1024;
export const KART_THUMBNAIL_RENDER_VERSION = 1;
export const KART_THUMBNAIL_WIDTH = 640;

const MAXIMUM_BASE64_LENGTH = Math.ceil(KART_THUMBNAIL_MAX_BYTES / 3) * 4;

export const kartThumbnailUploadSchema = z.strictObject({
  contentType: z.literal(KART_THUMBNAIL_CONTENT_TYPE),
  data: z
    .string()
    .min(1)
    .max(MAXIMUM_BASE64_LENGTH)
    .regex(/^[A-Za-z0-9+/]+={0,2}$/),
  renderVersion: z.literal(KART_THUMBNAIL_RENDER_VERSION),
});

export type KartThumbnailUpload = z.infer<typeof kartThumbnailUploadSchema>;

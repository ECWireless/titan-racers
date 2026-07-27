import { inflateSync } from "node:zlib";

import {
  KART_THUMBNAIL_HEIGHT,
  KART_THUMBNAIL_MAX_BYTES,
  KART_THUMBNAIL_WIDTH,
  kartThumbnailUploadSchema,
} from "@/game/kart/kart-thumbnail-contract";
import type { PersistedKartRevisionThumbnail } from "@/server/kart-repository";

const PNG_SIGNATURE = Buffer.from([
  0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a,
]);
const PNG_CRC_TABLE = createPngCrcTable();

export class KartThumbnailValidationError extends Error {
  constructor() {
    super("The kart thumbnail payload is invalid.");
    this.name = "KartThumbnailValidationError";
  }
}

export function parseKartThumbnailUpload(payload: unknown) {
  const parsed = kartThumbnailUploadSchema.safeParse(payload);
  if (!parsed.success) throw new KartThumbnailValidationError();
  const imageData = Buffer.from(parsed.data.data, "base64");
  if (
    imageData.length === 0 ||
    imageData.length > KART_THUMBNAIL_MAX_BYTES ||
    imageData.toString("base64") !== parsed.data.data
  ) {
    throw new KartThumbnailValidationError();
  }
  validateKartThumbnailImageData(imageData);
  return {
    contentType: parsed.data.contentType,
    imageData,
    renderVersion: parsed.data.renderVersion,
  };
}

export function kartThumbnailResponse(
  thumbnail: PersistedKartRevisionThumbnail,
) {
  return new Response(new Uint8Array(thumbnail.imageData), {
    headers: {
      "cache-control": "no-store",
      "content-length": String(thumbnail.imageData.length),
      "content-type": thumbnail.contentType,
      etag: `"${thumbnail.imageSha256}"`,
      "x-content-type-options": "nosniff",
    },
  });
}

export function validateKartThumbnailImageData(imageData: Buffer) {
  try {
    if (
      imageData.length < PNG_SIGNATURE.length + 12 ||
      !imageData.subarray(0, PNG_SIGNATURE.length).equals(PNG_SIGNATURE)
    ) {
      throw new Error("Invalid PNG signature.");
    }

    let bitsPerPixel = 0;
    let idatClosed = false;
    const idatChunks: Buffer[] = [];
    let offset = PNG_SIGNATURE.length;
    let sawHeader = false;
    let sawImageData = false;
    let sawEnd = false;

    while (offset < imageData.length) {
      if (imageData.length - offset < 12) {
        throw new Error("Truncated PNG chunk.");
      }
      const length = imageData.readUInt32BE(offset);
      const typeStart = offset + 4;
      const dataStart = offset + 8;
      if (length > imageData.length - dataStart - 4) {
        throw new Error("Invalid PNG chunk length.");
      }
      const dataEnd = dataStart + length;
      const chunkEnd = dataEnd + 4;
      const type = imageData.toString("ascii", typeStart, dataStart);
      if (
        !/^[A-Za-z]{4}$/.test(type) ||
        type.charCodeAt(2) < 65 ||
        type.charCodeAt(2) > 90
      ) {
        throw new Error("Invalid PNG chunk type.");
      }
      if (
        imageData.readUInt32BE(dataEnd) !==
        pngCrc32(imageData.subarray(typeStart, dataEnd))
      ) {
        throw new Error("Invalid PNG chunk checksum.");
      }

      if (!sawHeader) {
        if (type !== "IHDR" || length !== 13) {
          throw new Error("PNG header must be first.");
        }
        const width = imageData.readUInt32BE(dataStart);
        const height = imageData.readUInt32BE(dataStart + 4);
        const bitDepth = imageData[dataStart + 8];
        const colorType = imageData[dataStart + 9];
        if (
          width !== KART_THUMBNAIL_WIDTH ||
          height !== KART_THUMBNAIL_HEIGHT ||
          bitDepth !== 8 ||
          (colorType !== 2 && colorType !== 6) ||
          imageData[dataStart + 10] !== 0 ||
          imageData[dataStart + 11] !== 0 ||
          imageData[dataStart + 12] !== 0
        ) {
          throw new Error("Unsupported PNG header.");
        }
        bitsPerPixel = colorType === 6 ? 32 : 24;
        sawHeader = true;
      } else if (type === "IHDR") {
        throw new Error("Duplicate PNG header.");
      } else if (type === "IDAT") {
        if (idatClosed || length === 0) {
          throw new Error("Invalid PNG image-data sequence.");
        }
        sawImageData = true;
        idatChunks.push(imageData.subarray(dataStart, dataEnd));
      } else {
        if (sawImageData) idatClosed = true;
        if (type === "IEND") {
          if (length !== 0 || sawEnd || chunkEnd !== imageData.length) {
            throw new Error("Invalid PNG end chunk.");
          }
          sawEnd = true;
        } else if (type.charCodeAt(0) >= 65 && type.charCodeAt(0) <= 90) {
          throw new Error("Unsupported critical PNG chunk.");
        }
      }

      offset = chunkEnd;
    }

    if (!sawHeader || !sawImageData || !sawEnd || bitsPerPixel === 0) {
      throw new Error("Incomplete PNG.");
    }
    const bytesPerRow = (KART_THUMBNAIL_WIDTH * bitsPerPixel) / 8;
    const expectedLength = (bytesPerRow + 1) * KART_THUMBNAIL_HEIGHT;
    const compressed = Buffer.concat(idatChunks);
    const inflated = inflateSync(compressed, {
      info: true,
      maxOutputLength: expectedLength,
    }) as unknown as {
      buffer: Buffer;
      engine: { bytesWritten: number };
    };
    const decoded = inflated.buffer;
    if (
      decoded.length !== expectedLength ||
      inflated.engine.bytesWritten !== compressed.length
    ) {
      throw new Error("Invalid PNG decoded length.");
    }
    for (
      let rowOffset = 0;
      rowOffset < decoded.length;
      rowOffset += bytesPerRow + 1
    ) {
      if (decoded[rowOffset] > 4) {
        throw new Error("Invalid PNG scanline filter.");
      }
    }
  } catch {
    throw new KartThumbnailValidationError();
  }
}

function createPngCrcTable() {
  return Array.from({ length: 256 }, (_, index) => {
    let value = index;
    for (let bit = 0; bit < 8; bit += 1) {
      value = (value & 1) !== 0 ? 0xedb88320 ^ (value >>> 1) : value >>> 1;
    }
    return value >>> 0;
  });
}

function pngCrc32(data: Buffer) {
  let crc = 0xffffffff;
  for (const byte of data) {
    crc = PNG_CRC_TABLE[(crc ^ byte) & 0xff] ^ (crc >>> 8);
  }
  return (crc ^ 0xffffffff) >>> 0;
}

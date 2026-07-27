import { deflateSync } from "node:zlib";

const PNG_SIGNATURE = Buffer.from([
  0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a,
]);
const PNG_CRC_TABLE = createPngCrcTable();

export function createTestPng({
  extraChunk,
  height = 360,
  idatSuffix = Buffer.alloc(0),
  marker = 0,
  width = 640,
}: {
  extraChunk?: { data: Buffer; type: string };
  height?: number;
  idatSuffix?: Buffer;
  marker?: number;
  width?: number;
} = {}) {
  const header = Buffer.alloc(13);
  header.writeUInt32BE(width, 0);
  header.writeUInt32BE(height, 4);
  header[8] = 8;
  header[9] = 6;

  const bytesPerRow = width * 4;
  const pixels = Buffer.alloc((bytesPerRow + 1) * height);
  for (let row = 0; row < height; row += 1) {
    const pixelOffset = row * (bytesPerRow + 1) + 1;
    pixels[pixelOffset] = marker & 0xff;
    pixels[pixelOffset + 3] = 0xff;
  }

  const chunks = [
    PNG_SIGNATURE,
    createPngChunk("IHDR", header),
  ];
  if (extraChunk) {
    chunks.push(createPngChunk(extraChunk.type, extraChunk.data));
  }
  chunks.push(
    createPngChunk(
      "IDAT",
      Buffer.concat([deflateSync(pixels), idatSuffix]),
    ),
    createPngChunk("IEND", Buffer.alloc(0)),
  );
  return Buffer.concat(chunks);
}

function createPngChunk(type: string, data: Buffer) {
  const typeBytes = Buffer.from(type, "ascii");
  const chunk = Buffer.alloc(data.length + 12);
  chunk.writeUInt32BE(data.length, 0);
  typeBytes.copy(chunk, 4);
  data.copy(chunk, 8);
  chunk.writeUInt32BE(pngCrc32(Buffer.concat([typeBytes, data])), data.length + 8);
  return chunk;
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

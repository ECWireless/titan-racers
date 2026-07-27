import { expect, test } from "@playwright/test";

import {
  KART_THUMBNAIL_CONTENT_TYPE,
  KART_THUMBNAIL_MAX_BYTES,
  KART_THUMBNAIL_RENDER_VERSION,
} from "../src/game/kart/kart-thumbnail-contract";
import {
  KartThumbnailValidationError,
  kartThumbnailResponse,
  parseKartThumbnailUpload,
} from "../src/server/kart-thumbnail";
import { createTestPng } from "./support/png";

test("accepts only the canonical bounded PNG thumbnail contract", () => {
  const imageData = createTestPng();
  expect(
    parseKartThumbnailUpload({
      contentType: KART_THUMBNAIL_CONTENT_TYPE,
      data: imageData.toString("base64"),
      renderVersion: KART_THUMBNAIL_RENDER_VERSION,
    }),
  ).toEqual({
    contentType: KART_THUMBNAIL_CONTENT_TYPE,
    imageData,
    renderVersion: KART_THUMBNAIL_RENDER_VERSION,
  });

  for (const payload of [
    {
      contentType: KART_THUMBNAIL_CONTENT_TYPE,
      data: createTestPng({ height: 180, width: 320 }).toString("base64"),
      renderVersion: KART_THUMBNAIL_RENDER_VERSION,
    },
    {
      contentType: "image/svg+xml",
      data: imageData.toString("base64"),
      renderVersion: KART_THUMBNAIL_RENDER_VERSION,
    },
    {
      contentType: KART_THUMBNAIL_CONTENT_TYPE,
      data: Buffer.alloc(KART_THUMBNAIL_MAX_BYTES + 1).toString("base64"),
      renderVersion: KART_THUMBNAIL_RENDER_VERSION,
    },
    {
      contentType: KART_THUMBNAIL_CONTENT_TYPE,
      data: imageData.subarray(0, imageData.length - 1).toString("base64"),
      renderVersion: KART_THUMBNAIL_RENDER_VERSION,
    },
    {
      contentType: KART_THUMBNAIL_CONTENT_TYPE,
      data: Buffer.concat([imageData, Buffer.from([0])]).toString("base64"),
      renderVersion: KART_THUMBNAIL_RENDER_VERSION,
    },
    {
      contentType: KART_THUMBNAIL_CONTENT_TYPE,
      data: (() => {
        const corrupted = Buffer.from(imageData);
        corrupted[corrupted.length - 5] ^= 0xff;
        return corrupted.toString("base64");
      })(),
      renderVersion: KART_THUMBNAIL_RENDER_VERSION,
    },
    {
      contentType: KART_THUMBNAIL_CONTENT_TYPE,
      data: createTestPng({
        extraChunk: { data: Buffer.from([0]), type: "PLTE" },
      }).toString("base64"),
      renderVersion: KART_THUMBNAIL_RENDER_VERSION,
    },
    {
      contentType: KART_THUMBNAIL_CONTENT_TYPE,
      data: createTestPng({
        extraChunk: { data: Buffer.alloc(0), type: "tesT" },
      }).toString("base64"),
      renderVersion: KART_THUMBNAIL_RENDER_VERSION,
    },
    {
      contentType: KART_THUMBNAIL_CONTENT_TYPE,
      data: createTestPng({
        idatSuffix: Buffer.from("hidden trailing payload"),
      }).toString("base64"),
      renderVersion: KART_THUMBNAIL_RENDER_VERSION,
    },
  ]) {
    expect(() => parseKartThumbnailUpload(payload)).toThrow(
      KartThumbnailValidationError,
    );
  }
});

test("serves immutable thumbnail bytes with defensive image headers", async () => {
  const imageData = createTestPng();
  const response = kartThumbnailResponse({
    contentType: KART_THUMBNAIL_CONTENT_TYPE,
    createdAt: new Date("2026-07-26T12:00:00.000Z"),
    generatedByUserId: "admin-user",
    imageData,
    imageSha256: "a".repeat(64),
    kartId: "balanced-kart",
    renderVersion: KART_THUMBNAIL_RENDER_VERSION,
    revision: 3,
  });

  expect(response.headers.get("cache-control")).toBe("no-store");
  expect(response.headers.get("content-type")).toBe("image/png");
  expect(response.headers.get("content-length")).toBe(String(imageData.length));
  expect(response.headers.get("etag")).toBe(`"${"a".repeat(64)}"`);
  expect(response.headers.get("x-content-type-options")).toBe("nosniff");
  expect(Buffer.from(await response.arrayBuffer())).toEqual(imageData);
});

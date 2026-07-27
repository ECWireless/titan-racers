"use client";

import * as pc from "playcanvas";

import type { KartAssemblyDocument } from "./kart-assembly-document";
import {
  createKartAssemblyVisual,
  getRenderedKartBounds,
} from "./kart-assembly-visual";
import {
  KART_THUMBNAIL_CONTENT_TYPE,
  KART_THUMBNAIL_HEIGHT,
  KART_THUMBNAIL_RENDER_VERSION,
  KART_THUMBNAIL_WIDTH,
  type KartThumbnailUpload,
} from "./kart-thumbnail-contract";

let thumbnailRenderQueue: Promise<unknown> = Promise.resolve();
let thumbnailRenderingPauseDepth = 0;

export class KartThumbnailRenderingPausedError extends Error {
  constructor() {
    super("Kart thumbnail rendering is paused.");
    this.name = "KartThumbnailRenderingPausedError";
  }
}

export function renderKartThumbnail(document: KartAssemblyDocument) {
  if (thumbnailRenderingPauseDepth > 0) {
    return Promise.reject(new KartThumbnailRenderingPausedError());
  }
  const render = thumbnailRenderQueue.then(() =>
    renderKartThumbnailImmediately(document),
  );
  thumbnailRenderQueue = render.catch(() => undefined);
  return render;
}

export async function waitForKartThumbnailRendering() {
  let observedQueue: Promise<unknown>;
  do {
    observedQueue = thumbnailRenderQueue;
    await observedQueue;
  } while (observedQueue !== thumbnailRenderQueue);
}

export function pauseKartThumbnailRendering() {
  thumbnailRenderingPauseDepth += 1;
  let released = false;
  const release = () => {
    if (released) return;
    released = true;
    thumbnailRenderingPauseDepth = Math.max(
      0,
      thumbnailRenderingPauseDepth - 1,
    );
  };
  return {
    ready: waitForKartThumbnailRendering(),
    release,
  };
}

export async function createKartThumbnailUpload(
  document: KartAssemblyDocument,
): Promise<KartThumbnailUpload> {
  const blob = await renderKartThumbnail(document);
  return {
    contentType: KART_THUMBNAIL_CONTENT_TYPE,
    data: await blobToBase64(blob),
    renderVersion: KART_THUMBNAIL_RENDER_VERSION,
  };
}

async function renderKartThumbnailImmediately(document: KartAssemblyDocument) {
  const canvas = window.document.createElement("canvas");
  canvas.height = KART_THUMBNAIL_HEIGHT;
  canvas.width = KART_THUMBNAIL_WIDTH;
  const app = new pc.Application(canvas, {
    graphicsDeviceOptions: {
      alpha: false,
      antialias: true,
      preserveDrawingBuffer: true,
    },
  });
  const { materials, root } = createKartAssemblyVisual(
    document,
    createThumbnailMaterial,
  );
  try {
    materials.forEach((material) => {
      material.metalness = 0.08;
      material.gloss = 0.42;
      material.update();
    });
    app.setCanvasFillMode(pc.FILLMODE_NONE);
    app.setCanvasResolution(
      pc.RESOLUTION_FIXED,
      KART_THUMBNAIL_WIDTH,
      KART_THUMBNAIL_HEIGHT,
    );
    app.scene.ambientLight = new pc.Color(0.34, 0.38, 0.43);
    app.root.addChild(root);
    app.root.syncHierarchy();

    const bounds = getRenderedKartBounds(root);
    if (!bounds) throw new Error("The kart thumbnail has no rendered geometry.");

    const width = bounds.maximum.x - bounds.minimum.x;
    const height = bounds.maximum.y - bounds.minimum.y;
    const depth = bounds.maximum.z - bounds.minimum.z;
    const span = Math.max(width, height * 1.65, depth, 0.25);
    const target = bounds.center.clone();
    target.y += height * 0.06;

    const floor = new pc.Entity("kart-thumbnail-floor");
    floor.addComponent("model", { type: "plane" });
    floor.setPosition(
      bounds.center.x,
      bounds.minimum.y - Math.max(0.008, height * 0.035),
      bounds.center.z,
    );
    floor.setLocalScale(span * 5.2, 1, span * 5.2);
    const floorMaterial = new pc.StandardMaterial();
    floorMaterial.diffuse = new pc.Color(0.055, 0.065, 0.072);
    floorMaterial.gloss = 0.16;
    floorMaterial.update();
    floor.model?.meshInstances?.forEach((mesh) => {
      mesh.material = floorMaterial;
      mesh.castShadow = false;
      mesh.receiveShadow = true;
    });
    app.root.addChild(floor);

    const camera = new pc.Entity("kart-thumbnail-camera");
    camera.addComponent("camera", {
      clearColor: new pc.Color(0.018, 0.022, 0.026),
      farClip: 20,
      fov: 34,
      nearClip: 0.01,
    });
    if (!camera.camera) {
      throw new Error("The kart thumbnail camera is unavailable.");
    }
    camera.camera.gammaCorrection = pc.GAMMA_SRGB;
    camera.camera.toneMapping = pc.TONEMAP_ACES;
    const distance = Math.max(0.58, span * 2);
    camera.setPosition(
      target.x + distance * 0.68,
      target.y + distance * 0.43,
      target.z + distance * 0.72,
    );
    camera.lookAt(target);
    app.root.addChild(camera);

    const keyLight = new pc.Entity("kart-thumbnail-key-light");
    keyLight.addComponent("light", {
      castShadows: true,
      color: new pc.Color(1, 0.9, 0.76),
      intensity: 1.65,
      shadowResolution: 1024,
      type: "directional",
    });
    keyLight.setEulerAngles(48, -32, 0);
    app.root.addChild(keyLight);

    const fillLight = new pc.Entity("kart-thumbnail-fill-light");
    fillLight.addComponent("light", {
      castShadows: false,
      color: new pc.Color(0.42, 0.68, 1),
      intensity: 0.72,
      type: "directional",
    });
    fillLight.setEulerAngles(22, 142, 0);
    app.root.addChild(fillLight);

    app.start();
    await nextFrame();
    await nextFrame();
    app.render();
    return await canvasToBlob(canvas);
  } finally {
    app.destroy();
  }
}

function canvasToBlob(canvas: HTMLCanvasElement) {
  return new Promise<Blob>((resolve, reject) => {
    let settled = false;
    const timeout = window.setTimeout(() => {
      if (settled) return;
      settled = true;
      reject(new Error("The browser timed out encoding the kart thumbnail."));
    }, 3_000);
    canvas.toBlob((blob) => {
      if (settled) return;
      settled = true;
      window.clearTimeout(timeout);
      if (!blob || blob.type !== KART_THUMBNAIL_CONTENT_TYPE) {
        reject(new Error("The browser could not encode the kart thumbnail."));
        return;
      }
      resolve(blob);
    }, KART_THUMBNAIL_CONTENT_TYPE);
  });
}

function blobToBase64(blob: Blob) {
  return new Promise<string>((resolve, reject) => {
    const reader = new FileReader();
    reader.addEventListener("error", () => {
      reject(new Error("The kart thumbnail could not be encoded."));
    });
    reader.addEventListener("load", () => {
      if (typeof reader.result !== "string") {
        reject(new Error("The kart thumbnail encoding is unavailable."));
        return;
      }
      resolve(reader.result.slice(reader.result.indexOf(",") + 1));
    });
    reader.readAsDataURL(blob);
  });
}

function nextFrame() {
  return new Promise<void>((resolve) => {
    let settled = false;
    const finish = () => {
      if (settled) return;
      settled = true;
      window.clearTimeout(timeout);
      cancelAnimationFrame(frame);
      resolve();
    };
    const frame = requestAnimationFrame(finish);
    const timeout = window.setTimeout(finish, 250);
  });
}

function createThumbnailMaterial(color: string) {
  const number = Number.parseInt(color.slice(1), 16);
  const material = new pc.StandardMaterial();
  material.diffuse = new pc.Color(
    ((number >> 16) & 255) / 255,
    ((number >> 8) & 255) / 255,
    (number & 255) / 255,
  );
  material.update();
  return material;
}

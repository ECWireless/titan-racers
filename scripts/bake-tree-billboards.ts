// Bakes the enclosure's tree billboards from Poly Haven tree scans (CC0):
// each species seen from eight directions around it, into a colour atlas
// and a shape atlas (view-space normal x and y, and leaf coverage) the race
// draws its trees from.
//
//   pnpm exec tsx scripts/bake-tree-billboards.ts <downloads> <output>
//
// <downloads> holds each scan's 1K glTF as Poly Haven ships it, in
// <id>/<id>_1k.gltf with its .bin and textures; <output> receives
// tree-colour.jpg, tree-shape.png, and tree-billboards.json.
import { createReadStream } from "node:fs";
import { writeFile } from "node:fs/promises";
import { createServer } from "node:http";
import type { AddressInfo } from "node:net";
import { createRequire } from "node:module";
import path from "node:path";

import { chromium } from "@playwright/test";

const SPECIES = [
  { id: "island_tree_02", node: "island_tree_02_LOD0" },
  { id: "island_tree_01", node: "island_tree_01_LOD0" },
  { id: "jacaranda_tree", node: "jacaranda_tree_LOD0" },
  { id: "fir_tree_01", node: "fir_tree_01_a_LOD0" },
];
const VIEWS = 8;
const CELL = 256;
// Empty margin below each tree's foot, and at least as much above its top,
// as a share of its cell, so filtering never reaches the next row.
const FOOT = 0.04;
// Rendered larger, then scaled down, so leaves blend into soft coverage.
const RENDER = 768;

const PAGE = /* html */ `<!doctype html><html><body><script type="module">
import * as pc from "/pc/playcanvas.mjs";

const VS = \`
attribute vec3 aPosition;
attribute vec3 aNormal;
attribute vec2 aUv;
uniform mat4 matrix_model;
uniform mat4 matrix_viewProjection;
uniform mat3 matrix_normal;
varying vec3 vNormal;
varying vec2 vUv;
void main(void) {
  vNormal = matrix_normal * aNormal;
  vUv = aUv;
  gl_Position = matrix_viewProjection * matrix_model * vec4(aPosition, 1.0);
}\`;
// Colour in sRGB, or the view-space normal facing the camera, both opaque.
const FS = \`
uniform sampler2D uDiffuse;
uniform vec3 uFactor;
uniform float uNormals;
varying vec3 vNormal;
varying vec2 vUv;
void main(void) {
  vec3 normal = normalize(vNormal) * (gl_FrontFacing ? 1.0 : -1.0);
  vec3 albedo = texture2D(uDiffuse, vUv).rgb * uFactor;
  gl_FragColor = uNormals > 0.5
    ? vec4(normal * 0.5 + 0.5, 1.0)
    : vec4(pow(albedo, vec3(1.0 / 2.2)), 1.0);
}\`;

const canvas = document.createElement("canvas");
canvas.width = canvas.height = ${RENDER};
document.body.appendChild(canvas);
const app = new pc.Application(canvas, {
  graphicsDeviceOptions: { alpha: true, antialias: true, preserveDrawingBuffer: true },
});
app.setCanvasResolution(pc.RESOLUTION_FIXED, ${RENDER}, ${RENDER});
app.start();
const material = new pc.ShaderMaterial({
  attributes: { aNormal: pc.SEMANTIC_NORMAL, aPosition: pc.SEMANTIC_POSITION, aUv: pc.SEMANTIC_TEXCOORD0 },
  fragmentGLSL: FS,
  uniqueName: "bake",
  vertexGLSL: VS,
});
material.cull = pc.CULLFACE_NONE;
const camera = new pc.Entity();
camera.addComponent("camera", {
  clearColor: new pc.Color(0, 0, 0, 0),
  farClip: 1000,
  nearClip: 0.1,
  projection: pc.PROJECTION_ORTHOGRAPHIC,
});
app.root.addChild(camera);

const load = (url) => new Promise((resolve, reject) =>
  app.assets.loadFromUrl(url, "container", (error, asset) => error ? reject(error) : resolve(asset)));

// Fills each uncovered texel's colour from its covered neighbours, a few
// texels out, so filtering past the leaves' edges never pulls in black.
function dilate(pixels, covered, size, rest) {
  let filled = covered.slice();
  for (let pass = 0; pass < 8; pass++) {
    const next = filled.slice();
    for (let y = 0; y < size.y; y++) for (let x = 0; x < size.x; x++) {
      const t = y * size.x + x;
      if (filled[t]) continue;
      let r = 0, g = 0, b = 0, n = 0;
      for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
        const nx = x + dx, ny = y + dy;
        if (nx < 0 || ny < 0 || nx >= size.x || ny >= size.y || !filled[ny * size.x + nx]) continue;
        const j = (ny * size.x + nx) * 4;
        r += pixels[j]; g += pixels[j + 1]; b += pixels[j + 2]; n++;
      }
      if (!n) continue;
      pixels[t * 4] = r / n; pixels[t * 4 + 1] = g / n; pixels[t * 4 + 2] = b / n;
      next[t] = 1;
    }
    filled = next;
  }
  // Beyond the ring, a flat colour or normal.
  for (let t = 0; t < filled.length; t++) {
    if (filled[t]) continue;
    for (let k = 0; k < 3; k++) pixels[t * 4 + k] = rest[k];
  }
}

// One species seen from each direction: a row of colour and of normals.
window.bake = async ({ id, node }, views, cell) => {
  const rows = [0, 1].map(() => {
    const row = document.createElement("canvas");
    row.width = views * cell;
    row.height = cell;
    return row;
  });
  const asset = await load("/scan/" + id + "/" + id + "_1k.gltf");
  const root = asset.resource.instantiateRenderEntity();
  const tree = root.findByName(node);
  root.children.slice().forEach((child) => child !== tree && child.destroy());
  tree.setLocalPosition(0, 0, 0);
  const pivot = new pc.Entity();
  pivot.addChild(root);
  app.root.addChild(pivot);
  const instances = tree.findComponents("render").flatMap((render) => render.meshInstances);
  const box = new pc.BoundingBox();
  instances.forEach((instance, i) => (i ? box.add(instance.aabb) : box.copy(instance.aabb)));
  // Stand the box's bottom centre, about the trunk's foot, on the origin.
  const centre = box.center;
  root.setLocalPosition(-centre.x, -box.getMin().y, -centre.z);
  const height = box.halfExtents.y * 2;
  const reach = Math.hypot(box.halfExtents.x, box.halfExtents.z);
  const span = Math.max(height, 2 * reach) * 1.1;
  instances.forEach((instance) => {
    const source = instance.material;
    instance.material = material;
    instance.setParameter("uDiffuse", source.diffuseMap ?? app.graphicsDevice.whiteTexture);
    instance.setParameter("uFactor", [source.diffuse.r, source.diffuse.g, source.diffuse.b]);
  });
  camera.camera.orthoHeight = span / 2;
  camera.setLocalPosition(0, span / 2 - ${FOOT} * span, 500);
  for (let view = 0; view < views; view++) {
    pivot.setLocalEulerAngles(0, (-360 * view) / views, 0);
    for (const [pass, row] of rows.entries()) {
      instances.forEach((instance) => instance.setParameter("uNormals", pass));
      app.render();
      const context = row.getContext("2d");
      context.imageSmoothingQuality = "high";
      context.drawImage(canvas, view * cell, 0, cell, cell);
    }
  }
  return { height, rows: rows.map((row) => row.toDataURL("image/png")), span };
};

// The species' rows stacked into two opaque atlases: colour, and the
// normal's x and y with the leaves' coverage. Canvases store colour
// premultiplied, so coverage kept in alpha would black out the dilation.
window.compose = async (rows, views, cell) => {
  const size = { x: views * cell, y: rows.length * cell };
  const canvases = [0, 1].map(() => {
    const atlas = document.createElement("canvas");
    atlas.width = size.x;
    atlas.height = size.y;
    return atlas;
  });
  for (const [index, pair] of rows.entries()) {
    for (const [pass, url] of pair.entries()) {
      const image = new Image();
      image.src = url;
      await image.decode();
      canvases[pass].getContext("2d").drawImage(image, 0, index * cell);
    }
  }
  const [colour, shape] = canvases.map((atlas) =>
    atlas.getContext("2d", { willReadFrequently: true }).getImageData(0, 0, size.x, size.y));
  const c = colour.data, s = shape.data;
  const covered = new Uint8Array(size.x * size.y);
  // Mean colour of the covered texels, for the habitat light.
  let sum = [0, 0, 0], weight = 0;
  for (let t = 0; t < covered.length; t++) {
    const a = c[t * 4 + 3] / 255;
    covered[t] = a > 0 ? 1 : 0;
    for (let k = 0; k < 3; k++) sum[k] += a * Math.pow(c[t * 4 + k] / 255, 2.2);
    weight += a;
  }
  const mean = sum.map((value) => 255 * Math.pow(value / weight, 1 / 2.2));
  dilate(c, covered, size, mean);
  dilate(s, covered, size, [128, 128, 255]);
  for (let t = 0; t < covered.length; t++) {
    s[t * 4 + 2] = c[t * 4 + 3];
    c[t * 4 + 3] = s[t * 4 + 3] = 255;
  }
  canvases.forEach((atlas, pass) => atlas.getContext("2d").putImageData([colour, shape][pass], 0, 0));
  return {
    colour: canvases[0].toDataURL("image/jpeg", 0.92),
    meanAlbedo: sum.map((value) => value / weight),
    shape: canvases[1].toDataURL("image/png"),
  };
};
window.ready = true;
</script></body></html>`;

async function main() {
  const [downloads, output] = process.argv.slice(2);
  if (!downloads || !output) {
    throw new Error("Usage: bake-tree-billboards.ts <downloads> <output>");
  }
  const root = path.resolve(downloads);
  const engine = path.join(
    path.dirname(createRequire(__filename).resolve("playcanvas")),
    "playcanvas.mjs",
  );
  // Serves the bake page, the engine, and the scans, streaming the scans'
  // large buffers from disk.
  const server = createServer((request, response) => {
    const url = new URL(request.url ?? "/", "http://localhost");
    if (url.pathname === "/") {
      response.setHeader("content-type", "text/html");
      return response.end(PAGE);
    }
    const file =
      url.pathname === "/pc/playcanvas.mjs"
        ? engine
        : path.resolve(root, decodeURIComponent(url.pathname.replace(/^\/scan\//, "")));
    if (file !== engine && !file.startsWith(root + path.sep)) {
      response.statusCode = 404;
      return response.end();
    }
    if (file.endsWith(".mjs")) response.setHeader("content-type", "text/javascript");
    createReadStream(file)
      .on("error", () => {
        response.statusCode = 404;
        response.end();
      })
      .pipe(response);
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const { port } = server.address() as AddressInfo;
  const browser = await chromium.launch({
    args: ["--use-angle=swiftshader", "--enable-unsafe-swiftshader"],
  });
  // Each species in a fresh page, so one scan's memory is freed before the
  // next loads.
  const open = async () => {
    const page = await browser.newPage();
    page.on("console", (message) => console.error(message.text()));
    await page.goto(`http://127.0.0.1:${port}/`);
    await page.waitForFunction("window.ready === true");
    return page;
  };
  try {
    const baked: { height: number; rows: string[]; span: number }[] = [];
    for (const species of SPECIES) {
      console.error(`baking ${species.id}`);
      const page = await open();
      baked.push(
        (await page.evaluate(
          `window.bake(${JSON.stringify(species)}, ${VIEWS}, ${CELL})`,
        )) as { height: number; rows: string[]; span: number },
      );
      await page.close();
    }
    const page = await open();
    const result = (await page.evaluate(
      `window.compose(${JSON.stringify(baked.map(({ rows }) => rows))}, ${VIEWS}, ${CELL})`,
    )) as { colour: string; meanAlbedo: number[]; shape: string };
    const write = (name: string, dataUrl: string) =>
      writeFile(path.join(output, name), Buffer.from(dataUrl.split(",")[1]!, "base64"));
    await write("tree-colour.jpg", result.colour);
    await write("tree-shape.png", result.shape);
    await writeFile(
      path.join(output, "tree-billboards.json"),
      `${JSON.stringify(
        {
          cell: CELL,
          // The foot's height in its cell, as a share of the cell.
          foot: FOOT,
          meanAlbedo: result.meanAlbedo.map((value) => Number(value.toFixed(4))),
          species: SPECIES.map(({ id }, index) => ({
            id,
            // The billboard's side, as a share of the tree's height.
            span: Number((baked[index]!.span / baked[index]!.height).toFixed(4)),
          })),
          views: VIEWS,
        },
        null,
        2,
      )}\n`,
    );
  } finally {
    await browser.close();
    server.close();
  }
}

main().catch((error: unknown) => {
  console.error(error);
  process.exit(1);
});

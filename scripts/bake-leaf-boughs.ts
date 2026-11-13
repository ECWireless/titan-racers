// Bakes the park trees' boughs from the nursery trees' leaf sprays
// (leaf-sprays-*.{jpg,png}, CC0, see bake-leaf-sprays.ts): each card is a
// 2 m bough whose side twigs carry those sprays at their real size, four
// cards in a 2 × 2 atlas of colour and coverage, about 8 mm a pixel.
//
//   pnpm exec tsx scripts/bake-leaf-boughs.ts src/game/course/tree-textures
//
// The directory holds the sprays and receives leaf-boughs-colour.jpg and
// leaf-boughs-coverage.png.
import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";

import { chromium } from "@playwright/test";

// Each bough spans 2 m, so a 0.5 m spray is a quarter of a cell.
const CELL = 256;

const PAGE = /* html */ `<!doctype html><html><body><script>
const load = (src) => new Promise((resolve, reject) => {
  const image = new Image();
  image.onload = () => resolve(image);
  image.onerror = reject;
  image.src = src;
});

window.bake = async (colourUrl, coverageUrl, cell) => {
  const [colourImage, coverageImage] = await Promise.all([load(colourUrl), load(coverageUrl)]);
  const size = colourImage.width / 2;
  const read = (image) => {
    const canvas = document.createElement("canvas");
    canvas.width = canvas.height = image.width;
    const context = canvas.getContext("2d");
    context.drawImage(image, 0, 0);
    return context.getImageData(0, 0, image.width, image.height);
  };
  const colour = read(colourImage), coverage = read(coverageImage);

  // Each spray as a colour sprite and a white mask, halved until it is at
  // the bough's scale, so thin leaves keep their share of each pixel.
  const spray = cell / 4;
  const sprites = [0, 1, 2, 3].map((index) => {
    const ox = (index % 2) * size, oy = Math.floor(index / 2) * size;
    const make = (white) => {
      let canvas = document.createElement("canvas");
      canvas.width = canvas.height = size;
      const image = new ImageData(size, size);
      for (let y = 0; y < size; y++) {
        for (let x = 0; x < size; x++) {
          const from = ((oy + y) * colour.width + ox + x) * 4, to = (y * size + x) * 4;
          for (let c = 0; c < 3; c++) image.data[to + c] = white ? 255 : colour.data[from + c];
          image.data[to + 3] = coverage.data[from];
        }
      }
      canvas.getContext("2d").putImageData(image, 0, 0);
      while (canvas.width > spray) {
        const half = document.createElement("canvas");
        half.width = half.height = canvas.width / 2;
        half.getContext("2d").drawImage(canvas, 0, 0, half.width, half.height);
        canvas = half;
      }
      return canvas;
    };
    return { colour: make(false), mask: make(true) };
  });

  // Mean leaf colour fills the atlas behind the leaves, so filtering never
  // darkens their edges.
  const mean = [0, 0, 0];
  let count = 0;
  for (let i = 0; i < coverage.data.length; i += 4) {
    if (coverage.data[i] <= 127) continue;
    for (let c = 0; c < 3; c++) mean[c] += colour.data[i + c];
    count++;
  }
  const fill = "rgb(" + mean.map((value) => Math.round(value / count)).join(",") + ")";

  let seed = 20261113;
  const random = () => (seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0) / 4294967296;
  const atlas = (background) => {
    const canvas = document.createElement("canvas");
    canvas.width = canvas.height = cell * 2;
    const context = canvas.getContext("2d");
    context.fillStyle = background;
    context.fillRect(0, 0, cell * 2, cell * 2);
    return { canvas, context };
  };
  const colourAtlas = atlas(fill), coverageAtlas = atlas("black");
  const passes = [[colourAtlas.context, true], [coverageAtlas.context, false]];

  for (let card = 0; card < 4; card++) {
    const ox = (card % 2) * cell, oy = Math.floor(card / 2) * cell;
    for (const [context] of passes) {
      context.save();
      context.beginPath();
      // A margin keeps one bough's leaves out of its neighbour's card.
      context.rect(ox + 2, oy + 2, cell - 4, cell - 4);
      context.clip();
    }
    const twig = (from, to, width) => {
      for (const [context, isColour] of passes) {
        context.strokeStyle = isColour ? "#4f4234" : "white";
        context.lineCap = "round";
        context.lineWidth = width;
        context.beginPath();
        context.moveTo(ox + from[0], oy + from[1]);
        context.lineTo(ox + to[0], oy + to[1]);
        context.stroke();
      }
    };
    const sprays = [];
    const leaf = (at, angle, depth) => sprays.push({
      angle, at, depth,
      length: 0.85 + 0.3 * random(),
      sprite: sprites[Math.floor(random() * 4)],
      squash: 0.7 + 0.3 * random(),
    });
    // The bough's own wood, from the card's foot, leaning as it rises.
    const base = [cell / 2, cell - 3];
    const bend = [cell / 2 + (random() - 0.5) * cell * 0.25, cell * 0.55];
    const tip = [cell / 2 + (random() - 0.5) * cell * 0.3, cell * 0.34];
    const along = (t) => [0, 1].map((k) =>
      (1 - t) * (1 - t) * base[k] + 2 * (1 - t) * t * bend[k] + t * t * tip[k]);
    const heading = (t) => Math.atan2(
      (1 - t) * (bend[1] - base[1]) + t * (tip[1] - bend[1]),
      (1 - t) * (bend[0] - base[0]) + t * (tip[0] - bend[0]));
    for (let s = 0; s < 16; s++) twig(along(s / 16), along((s + 1) / 16), 4 - (2.5 * s) / 16);
    // Side twigs leave it alternately, longest a third of the way up, each
    // carrying sprays along its length and one at its end.
    const twigs = 11 + Math.floor(random() * 3);
    for (let k = 0; k < twigs; k++) {
      const t = 0.1 + (0.85 * k) / (twigs - 1);
      const side = k % 2 ? 1 : -1;
      const angle = heading(t) + side * (0.7 + 0.45 * random());
      const length = cell * (0.44 - 0.3 * Math.abs(t - 0.3)) * (0.8 + 0.3 * random());
      const from = along(t);
      const to = [from[0] + Math.cos(angle) * length, from[1] + Math.sin(angle) * length];
      // A twig stops short of the card's edge, so its sprays are not cut by it.
      const inset = spray * 0.9;
      const fit = Math.min(1, ...[0, 1].map((k) => to[k] === from[k] ? 1
        : ((to[k] > from[k] ? cell - inset : inset) - from[k]) / (to[k] - from[k])));
      for (const k of [0, 1]) to[k] = from[k] + (to[k] - from[k]) * Math.max(0.3, fit);
      twig(from, to, 1.5);
      const steps = Math.max(2, Math.round(length / (spray * 0.3)));
      for (let s = 1; s <= steps; s++) {
        const at = [0, 1].map((i) => from[i] + ((to[i] - from[i]) * s) / steps);
        const turn = s === steps ? 0 : (s % 2 ? 1 : -1) * (0.5 + 0.5 * random());
        leaf(at, angle + turn, random());
      }
    }
    for (let s = 0; s < 7; s++) {
      const t = 0.3 + (0.7 * s) / 6;
      leaf(along(t), heading(t) + (s === 6 ? 0 : (s % 2 ? 1 : -1) * 0.6), random());
    }
    // Sprays behind are drawn first, and darker, as their neighbours shade them.
    sprays.sort((a, b) => a.depth - b.depth);
    for (const item of sprays) {
      for (const [context, isColour] of passes) {
        context.save();
        context.translate(ox + item.at[0], oy + item.at[1]);
        context.rotate(item.angle + Math.PI / 2);
        context.scale(item.squash * item.length, item.length);
        context.filter = isColour ? "brightness(" + (0.6 + 0.4 * item.depth) + ")" : "none";
        context.drawImage(isColour ? item.sprite.colour : item.sprite.mask, -spray / 2, -spray);
        context.restore();
      }
    }
    for (const [context] of passes) context.restore();
  }
  return {
    colour: colourAtlas.canvas.toDataURL("image/jpeg", 0.92),
    coverage: coverageAtlas.canvas.toDataURL("image/png"),
  };
};
</script></body></html>`;

async function main() {
  const [directory] = process.argv.slice(2);
  if (!directory) throw new Error("Usage: bake-leaf-boughs.ts <tree-textures>");
  const dataUrl = async (name: string, type: string) =>
    `data:${type};base64,${(await readFile(path.join(directory, name))).toString("base64")}`;
  const browser = await chromium.launch();
  try {
    const page = await browser.newPage();
    page.on("console", (message) => console.error(message.text()));
    await page.setContent(PAGE);
    const result = (await page.evaluate(
      `window.bake(${JSON.stringify(await dataUrl("leaf-sprays-colour.jpg", "image/jpeg"))}, ${JSON.stringify(
        await dataUrl("leaf-sprays-coverage.png", "image/png"),
      )}, ${CELL})`,
    )) as { colour: string; coverage: string };
    const write = (name: string, url: string) =>
      writeFile(path.join(directory, name), Buffer.from(url.split(",")[1]!, "base64"));
    await write("leaf-boughs-colour.jpg", result.colour);
    await write("leaf-boughs-coverage.png", result.coverage);
  } finally {
    await browser.close();
  }
}

main().catch((error: unknown) => {
  console.error(error);
  process.exit(1);
});

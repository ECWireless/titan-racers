// Bakes the nursery trees' leaf sprays from a Poly Haven tree scan's leaves
// (CC0): each card is a twig carrying scanned leaves at their real size,
// about 1 mm a pixel, four cards in a 2 × 2 atlas. It writes the leaves'
// colour (with the gaps filled by their mean colour, so filtering never
// darkens their edges) and their coverage.
//
//   pnpm exec tsx scripts/bake-leaf-sprays.ts <leaves-diff.jpg> <leaves-alpha.png> <output>
//
// The inputs are the scan's 1K leaf colour and alpha maps, as Poly Haven
// ships them for island_tree_01; <output> receives leaf-sprays-colour.jpg
// and leaf-sprays-coverage.png.
import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";

import { chromium } from "@playwright/test";

// Each card spans 0.5 m.
const CELL = 512;

const PAGE = /* html */ `<!doctype html><html><body><script>
// Each scanned leaf's rectangle in the 1K maps, tip up and stalk down.
const LEAVES = [
  [15, 15, 155, 525], [165, 15, 350, 405], [365, 25, 500, 375],
  [525, 45, 670, 375], [705, 15, 840, 425], [10, 640, 190, 1024],
  [215, 585, 365, 1024], [425, 610, 580, 1024],
];

const load = (src) => new Promise((resolve, reject) => {
  const image = new Image();
  image.onload = () => resolve(image);
  image.onerror = reject;
  image.src = src;
});
const pixels = (image) => {
  const canvas = document.createElement("canvas");
  canvas.width = image.width;
  canvas.height = image.height;
  const context = canvas.getContext("2d");
  context.drawImage(image, 0, 0);
  return context.getImageData(0, 0, image.width, image.height);
};

window.bake = async (colourUrl, alphaUrl, cell) => {
  const [colourImage, alphaImage] = await Promise.all([load(colourUrl), load(alphaUrl)]);
  const colour = pixels(colourImage);
  const alpha = pixels(alphaImage);
  const width = colour.width;
  const covered = (x, y) => alpha.data[(y * width + x) * 4] > 127;

  // Mean leaf colour, which fills the atlas behind the leaves.
  const mean = [0, 0, 0];
  let count = 0;
  for (let i = 0; i < width * width; i++) {
    if (alpha.data[i * 4] <= 127) continue;
    for (let c = 0; c < 3; c++) mean[c] += colour.data[i * 4 + c];
    count++;
  }
  const fill = "rgb(" + mean.map((value) => Math.round(value / count)).join(",") + ")";

  // Each leaf trimmed to its coverage, as a colour sprite and a white mask.
  const sprites = LEAVES.map(([x0, y0, x1, y1]) => {
    let left = x1, right = x0, top = y1, bottom = y0;
    for (let y = y0; y < y1; y++) {
      for (let x = x0; x < x1; x++) {
        if (!covered(x, y)) continue;
        left = Math.min(left, x); right = Math.max(right, x);
        top = Math.min(top, y); bottom = Math.max(bottom, y);
      }
    }
    const w = right - left + 1, h = bottom - top + 1;
    const make = (white) => {
      const canvas = document.createElement("canvas");
      canvas.width = w;
      canvas.height = h;
      const context = canvas.getContext("2d");
      const image = context.createImageData(w, h);
      for (let y = 0; y < h; y++) {
        for (let x = 0; x < w; x++) {
          const from = ((top + y) * width + left + x) * 4;
          const to = (y * w + x) * 4;
          for (let c = 0; c < 3; c++) image.data[to + c] = white ? 255 : colour.data[from + c];
          image.data[to + 3] = alpha.data[from];
        }
      }
      context.putImageData(image, 0, 0);
      return canvas;
    };
    return { colour: make(false), mask: make(true), w, h };
  });

  let seed = 20261027;
  const random = () => (seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0) / 4294967296;

  const atlas = (background) => {
    const canvas = document.createElement("canvas");
    canvas.width = canvas.height = cell * 2;
    const context = canvas.getContext("2d");
    context.fillStyle = background;
    context.fillRect(0, 0, cell * 2, cell * 2);
    return { canvas, context };
  };
  const colourAtlas = atlas(fill);
  const coverageAtlas = atlas("black");

  for (let card = 0; card < 4; card++) {
    const ox = (card % 2) * cell, oy = Math.floor(card / 2) * cell;
    // A twig from the card's foot, bending on its way to the top.
    const base = [cell / 2, cell];
    const bend = [cell / 2 + (random() - 0.5) * cell * 0.3, cell * 0.6];
    const tip = [cell / 2 + (random() - 0.5) * cell * 0.2, cell * 0.3];
    const at = (t) => [0, 1].map((k) =>
      (1 - t) * (1 - t) * base[k] + 2 * (1 - t) * t * bend[k] + t * t * tip[k]);
    const heading = (t) => {
      const d = [0, 1].map((k) =>
        2 * (1 - t) * (bend[k] - base[k]) + 2 * t * (tip[k] - bend[k]));
      return Math.atan2(d[1], d[0]);
    };
    const leaves = [];
    const count = 16 + Math.floor(random() * 7);
    for (let k = 0; k < count; k++) {
      const t = 0.12 + (0.83 * k) / (count - 1);
      const side = k % 2 ? 1 : -1;
      leaves.push({
        angle: heading(t) + side * (0.75 + 0.5 * random()),
        at: at(t),
        depth: random(),
        // 9-13.5 cm leaves, a little smaller toward the twig's foot.
        length: (90 + 45 * random()) * (0.8 + 0.2 * t),
        // A leaf turned from the card shows narrower.
        squash: 0.55 + 0.45 * random(),
        sprite: sprites[Math.floor(random() * sprites.length)],
      });
    }
    leaves.push({
      angle: heading(1), at: tip, depth: 1, length: 110, squash: 1,
      sprite: sprites[1],
    });

    const passes = [[colourAtlas.context, true], [coverageAtlas.context, false]];
    for (const [context, isColour] of passes) {
      context.strokeStyle = isColour ? "#5a4936" : "white";
      context.lineCap = "round";
      for (let s = 0; s < 24; s++) {
        const [a, b] = [at(s / 24), at((s + 1) / 24)];
        context.lineWidth = 5 - (3 * s) / 24;
        context.beginPath();
        context.moveTo(ox + a[0], oy + a[1]);
        context.lineTo(ox + b[0], oy + b[1]);
        context.stroke();
      }
    }
    // Leaves behind are drawn first, and darker, as their neighbours shade them.
    leaves.sort((a, b) => a.depth - b.depth);
    for (const leaf of leaves) {
      const scale = leaf.length / leaf.sprite.h;
      for (const [context, isColour] of passes) {
        context.save();
        context.beginPath();
        context.rect(ox, oy, cell, cell);
        context.clip();
        context.translate(ox + leaf.at[0], oy + leaf.at[1]);
        context.rotate(leaf.angle + Math.PI / 2);
        context.scale(scale * leaf.squash, scale);
        context.filter = isColour ? "brightness(" + (0.72 + 0.28 * leaf.depth) + ")" : "none";
        context.drawImage(
          isColour ? leaf.sprite.colour : leaf.sprite.mask,
          -leaf.sprite.w / 2,
          -leaf.sprite.h,
        );
        context.restore();
      }
    }
  }
  return {
    colour: colourAtlas.canvas.toDataURL("image/jpeg", 0.9),
    coverage: coverageAtlas.canvas.toDataURL("image/png"),
  };
};
</script></body></html>`;

async function main() {
  const [colourPath, alphaPath, output] = process.argv.slice(2);
  if (!colourPath || !alphaPath || !output) {
    throw new Error(
      "Usage: bake-leaf-sprays.ts <leaves-diff.jpg> <leaves-alpha.png> <output>",
    );
  }
  const dataUrl = async (file: string, type: string) =>
    `data:${type};base64,${(await readFile(file)).toString("base64")}`;
  const browser = await chromium.launch();
  try {
    const page = await browser.newPage();
    page.on("console", (message) => console.error(message.text()));
    await page.setContent(PAGE);
    const result = (await page.evaluate(
      `window.bake(${JSON.stringify(await dataUrl(colourPath, "image/jpeg"))}, ${JSON.stringify(
        await dataUrl(alphaPath, "image/png"),
      )}, ${CELL})`,
    )) as { colour: string; coverage: string };
    const write = (name: string, url: string) =>
      writeFile(
        path.join(output, name),
        Buffer.from(url.split(",")[1]!, "base64"),
      );
    await write("leaf-sprays-colour.jpg", result.colour);
    await write("leaf-sprays-coverage.png", result.coverage);
  } finally {
    await browser.close();
  }
}

main().catch((error: unknown) => {
  console.error(error);
  process.exit(1);
});

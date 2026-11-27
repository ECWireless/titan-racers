import { createRequire } from "node:module";
import path from "node:path";

import type * as Pc from "playcanvas";

/**
 * PlayCanvas's CommonJS build exports nothing in Node, so a game module's
 * `import * as pc from "playcanvas"` gets nothing. Load the ES module in its
 * place, and drop game modules a spec run earlier in this worker loaded
 * against the empty build, before importing game code that uses PlayCanvas.
 */
export async function loadPlayCanvasForNode() {
  const pc = (await import(
    "playcanvas/build/playcanvas/src/index.js"
  )) as unknown as typeof Pc;
  const require = createRequire(__filename);
  const id = require.resolve("playcanvas");
  require.cache[id] = { exports: pc, filename: id, id, loaded: true } as NodeJS.Module;
  const game = path.resolve(__dirname, "../../src/game");
  for (const key of Object.keys(require.cache)) {
    if (key.startsWith(game)) delete require.cache[key];
  }
  return pc;
}

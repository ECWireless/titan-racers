import { expect, test } from "@playwright/test";

import {
  glslFloat,
  HABITAT_LAND_GLSL,
  HABITAT_PATTERN_GLSL,
} from "../src/game/enclosure/habitat-glsl";
import {
  lakeEdge,
  placeAt,
  PARK,
  woodIndex,
  fineVariation,
} from "../src/game/enclosure/habitat-land";
import {
  getApprovedEnclosure,
  ISLAND_THREE_ENCLOSURE,
} from "../src/game/enclosure/island-three";

// A 64 × 16 grid over the course's valley from the nearest town to the
// falls lake, where the race stands trees and buildings.
const COLUMNS = 64;
const ROWS = 16;
const FROM = [7_000, -2_000] as const;
const STEP = [135, 250] as const;
const ENCLOSURE = getApprovedEnclosure(ISLAND_THREE_ENCLOSURE)!;

const FRAGMENT = /* glsl */ `
precision highp float;
#define RADIUS ${glslFloat(ENCLOSURE.radius)}
#define HALF_LENGTH ${glslFloat(ENCLOSURE.length / 2)}
#define VALLEY_SPACING ${glslFloat(360 / ENCLOSURE.valleyCount)}
${HABITAT_PATTERN_GLSL}
${HABITAT_LAND_GLSL}
void main(void) {
  vec2 cell = floor(gl_FragCoord.xy);
  vec2 q = vec2(${glslFloat(FROM[0])}, ${glslFloat(FROM[1])})
    + cell * vec2(${glslFloat(STEP[0])}, ${glslFloat(STEP[1])});
  Land l = landAt(q, ${glslFloat(PARK.seed)});
  gl_FragColor = vec4(l.wood.x / 1.5, step(0.0, l.place.x), step(0.0, l.lake.x), 1.0);
}`;

test("lays out trees and buildings where the land shader paints them", async ({
  page,
}) => {
  const pixels = await page.evaluate(
    ({ columns, fragment, rows }) => {
      const canvas = document.createElement("canvas");
      canvas.width = columns;
      canvas.height = rows;
      const gl = canvas.getContext("webgl")!;
      const shader = (type: number, source: string) => {
        const compiled = gl.createShader(type)!;
        gl.shaderSource(compiled, source);
        gl.compileShader(compiled);
        if (!gl.getShaderParameter(compiled, gl.COMPILE_STATUS)) {
          throw new Error(gl.getShaderInfoLog(compiled) ?? "compile failed");
        }
        return compiled;
      };
      const program = gl.createProgram()!;
      gl.attachShader(
        program,
        shader(
          gl.VERTEX_SHADER,
          "attribute vec2 p; void main() { gl_Position = vec4(p, 0.0, 1.0); }",
        ),
      );
      gl.attachShader(program, shader(gl.FRAGMENT_SHADER, fragment));
      gl.linkProgram(program);
      gl.useProgram(program);
      gl.bindBuffer(gl.ARRAY_BUFFER, gl.createBuffer());
      gl.bufferData(
        gl.ARRAY_BUFFER,
        new Float32Array([-1, -1, 3, -1, -1, 3]),
        gl.STATIC_DRAW,
      );
      gl.enableVertexAttribArray(0);
      gl.vertexAttribPointer(0, 2, gl.FLOAT, false, 0, 0);
      gl.drawArrays(gl.TRIANGLES, 0, 3);
      const read = new Uint8Array(columns * rows * 4);
      gl.readPixels(0, 0, columns, rows, gl.RGBA, gl.UNSIGNED_BYTE, read);
      return Array.from(read);
    },
    { columns: COLUMNS, fragment: FRAGMENT, rows: ROWS },
  );

  // The land's hashes wrap at whole numbers, where GPUs round differently,
  // so a few noise cells differ between them; the rest must agree.
  let woodAgreed = 0;
  let compared = 0;
  let agreed = 0;
  const inside = { lake: 0, place: 0 };
  for (let row = 0; row < ROWS; row++) {
    for (let column = 0; column < COLUMNS; column++) {
      const qx = FROM[0] + column * STEP[0];
      const qy = FROM[1] + row * STEP[1];
      const index = (row * COLUMNS + column) * 4;
      const seed = PARK.seed;
      if (
        Math.abs(pixels[index]! / 255 - woodIndex(qx, qy, seed) / 1.5) < 0.01
      ) {
        woodAgreed++;
      }
      // Edges within a few metres may round either way.
      const place = placeAt(qx, qy, seed, fineVariation(qx, qy, seed))[0];
      const lake = lakeEdge(qx, qy, seed);
      if (place < 0) inside.place++;
      if (lake < 0) inside.lake++;
      for (const [cpu, gpu] of [
        [place, pixels[index + 1]!],
        [lake, pixels[index + 2]!],
      ] as const) {
        if (Math.abs(cpu) < 5) continue;
        compared++;
        if (cpu > 0 === gpu > 127) agreed++;
      }
    }
  }
  expect(inside.place).toBeGreaterThan(0);
  expect(inside.lake).toBeGreaterThan(0);
  expect(woodAgreed / (COLUMNS * ROWS)).toBeGreaterThan(0.95);
  expect(agreed / compared).toBeGreaterThan(0.97);
});

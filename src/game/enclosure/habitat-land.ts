// The valley land's layout on the CPU, mirroring the land GLSL in
// habitat-glsl.ts, so the 3D trees, buildings, and landmarks stand where the
// shader paints woods, settlements, and water. Keep each function in step
// with its GLSL namesake. Lengths are metres; q is (axial, across).

/** The mown clearing around the course. */
export const CLEARING_RADIUS = 220;
/**
 * The belt of trees ringing the clearing: up to this deep, in clumps, and
 * open for this many degrees either side of the sunward axis, the view
 * toward the falls.
 */
export const BELT = { depth: 55, inset: 4, vistaDegrees: 16 };
/** Hills settle flat around a course, rising fully beyond this range. */
export const FLAT_AROUND_COURSE = { from: CLEARING_RADIUS + 150, to: CLEARING_RADIUS + 450 };
/**
 * Real trees stand within this distance of the course; beyond it the woods'
 * canopy rises as relief instead, fading in over the outer band.
 */
export const TREES = { canopyFrom: 450, radius: 750 };
export const HILL_HEIGHT = 65;
export const CANOPY_HEIGHT = 12;
/**
 * End-cap terraces in each valley's sector: steps from the floor up to 0.7 R,
 * each a retaining wall, a steep planted slope, and a level shelf.
 */
export const TERRACES = { count: 8, depth: 100, rise: 150, run: 40, wall: 35 };
export const TERRACE_REACH = TERRACES.count * TERRACES.depth;
/** Falls View Park, the sunward end of valley 1, which no settlement reaches. */
export const PARK = { from: 10_000, seed: 2 };
/**
 * The lake below the sunward terraces of Falls View Park, with a smooth
 * shore that runs under their foot, so it meets the falls' plunge pool
 * where the water lands. Hills stay flat within `flatBeyond` of its
 * shore, under the falls bridge.
 */
export const FALLS_LAKE = { across: 450, axial: 14_825, flatBeyond: 700, radii: [420, 450] as const };
/** The steel hub at the axis of each end cap, out to this radius. */
export const HUB_RADIUS = 260;
/**
 * Linear albedos the land shader paints and the 3D buildings share: tiled,
 * pale, and slate roofs, and rendered walls.
 */
export const ROOF_ALBEDOS = [
  [0.3, 0.1, 0.05],
  [0.3, 0.29, 0.26],
  [0.07, 0.075, 0.085],
] as const;
export const RENDER_ALBEDO = [0.32, 0.29, 0.25] as const;

const fract = (x: number) => x - Math.floor(x);
const clamp01 = (x: number) => Math.min(Math.max(x, 0), 1);
const mix = (a: number, b: number, t: number) => a + (b - a) * t;

export function smoothstep(edge0: number, edge1: number, x: number) {
  const t = clamp01((x - edge0) / (edge1 - edge0));
  return t * t * (3 - 2 * t);
}

export function hash(x: number, y: number) {
  const px = fract(x * 0.1031);
  const py = fract(y * 0.1031);
  const d = px * (py + 33.33) + py * (px + 33.33) + px * (px + 33.33);
  return fract((px + d + py + d) * (px + d));
}

export function valueNoise(x: number, y: number) {
  const cx = Math.floor(x);
  const cy = Math.floor(y);
  let fx = x - cx;
  let fy = y - cy;
  fx = fx * fx * (3 - 2 * fx);
  fy = fy * fy * (3 - 2 * fy);
  return mix(
    mix(hash(cx, cy), hash(cx + 1, cy), fx),
    mix(hash(cx, cy + 1), hash(cx + 1, cy + 1), fx),
    fy,
  );
}

function riverAcross(axial: number, seed: number) {
  return 600 * Math.sin(axial / 2900 + seed) + 260 * Math.sin(axial / 1100 + 2 * seed);
}

export function roadAcross(axial: number, seed: number) {
  return 500 * Math.sin(axial / 4100 + 2 * seed) + 180 * Math.sin(axial / 1300 + seed);
}

function riverHalfWidth(axial: number, seed: number) {
  return 26 + 10 * Math.sin(axial / 1700 + seed);
}

type Settlement = { centre: [number, number]; radius: number };

/** The settlement, if any, in q's cell of a row along the valley. */
function settlementCell(
  qx: number,
  spacing: number,
  across: number,
  jitter: number,
  radii: readonly [number, number],
  chance: number,
  valley: number,
  seed: number,
): Settlement {
  const cell = Math.floor(qx / spacing);
  const centre: [number, number] = [
    (cell + 0.5 + 0.25 * (hash(cell, seed) - 0.5)) * spacing,
    across + (hash(seed, cell) - 0.5) * jitter,
  ];
  if (Math.abs(valley - PARK.seed) < 0.5 && centre[0] + 1.25 * radii[1] > PARK.from) {
    chance = 0;
  }
  const radius =
    mix(radii[0], radii[1], hash(cell, seed + 4)) *
    (hash(cell + 9, seed) <= chance ? 1 : 0);
  return { centre, radius };
}

function settlementAt(
  qx: number,
  qy: number,
  settlement: Settlement,
  ragged: number,
): [number, number] {
  if (settlement.radius === 0) return [1e4, 0];
  const dx = qx - settlement.centre[0];
  const dy = qy - settlement.centre[1];
  const r = Math.sqrt(dx * dx + dy * dy);
  return [
    r - settlement.radius * (0.75 + 0.5 * ragged),
    1 - r / Math.max(settlement.radius, 1),
  ];
}

const TOWN = { chance: 0.8, jitter: 300, radii: [300, 600], spacing: 2600 } as const;
const VILLAGE = { chance: 0.75, jitter: 300, radii: [150, 320], spacing: 2600 } as const;

export function townCell(qx: number, seed: number) {
  return settlementCell(qx, TOWN.spacing, roadAcross(qx, seed), TOWN.jitter, TOWN.radii, TOWN.chance, seed, seed);
}

export function villageCell(qx: number, seed: number) {
  const shifted = qx + VILLAGE.spacing / 2;
  const villageAxial =
    (Math.floor(shifted / VILLAGE.spacing) + 0.5) * VILLAGE.spacing - VILLAGE.spacing / 2;
  const cell = settlementCell(
    shifted,
    VILLAGE.spacing,
    riverAcross(villageAxial, seed),
    VILLAGE.jitter,
    VILLAGE.radii,
    VILLAGE.chance,
    seed,
    seed + 20,
  );
  cell.centre[0] -= VILLAGE.spacing / 2;
  return cell;
}

/** The nearest settlement's (distance outside its edge, density at q). */
export function placeAt(qx: number, qy: number, seed: number, fine: number) {
  const town = settlementAt(qx, qy, townCell(qx, seed), fine);
  const village = settlementAt(qx, qy, villageCell(qx, seed), fine);
  const row = Math.floor(qy / 400);
  const hamlet = settlementAt(
    qx,
    qy,
    settlementCell(qx, 400, row * 400 + 200, 200, [30, 70], 0.12, seed, seed + row * 3),
    fine,
  );
  let place = town[0] < village[0] ? town : village;
  if (hamlet[0] < place[0]) place = [hamlet[0], 0];
  return place;
}

/** Distance outside the nearest lake's shore; negative inside. */
export function lakeEdge(qx: number, qy: number, seed: number) {
  const lakeCell = Math.floor(qx / 3000);
  const lakeAxial = (lakeCell + 0.3 + 0.4 * hash(lakeCell, seed + 2)) * 3000;
  const t = hash(seed, lakeCell + 3);
  const shore = 0.3 * (valueNoise(qx / 140, qy / 140) - 0.5);
  const ellipse = (cx: number, cy: number, rx: number, ry: number, wobble = shore) => {
    const u = (qx - cx) / rx;
    const v = (qy - cy) / ry;
    return (Math.sqrt(u * u + v * v) - 1 + wobble) * ry;
  };
  let edge =
    hash(lakeCell, seed + 6) < 0.5
      ? ellipse(lakeAxial, riverAcross(lakeAxial, seed), mix(350, 750, t), mix(150, 400, t))
      : 1e4;
  if (Math.abs(seed - PARK.seed) < 0.5) {
    edge = Math.min(
      edge,
      ellipse(FALLS_LAKE.axial, FALLS_LAKE.across, FALLS_LAKE.radii[0], FALLS_LAKE.radii[1], 0),
    );
  }
  return edge;
}

/** Woodland index; the shader paints woods from 0.9 to 0.95. */
export function woodIndex(qx: number, qy: number, seed: number) {
  return (
    valueNoise(qx / 520 + seed * 9, qy / 520 + seed * 9) +
    0.45 * valueNoise(qx / 150 + seed, qy / 150 + seed)
  );
}

export function fineVariation(qx: number, qy: number, seed: number) {
  return valueNoise(qx / 160 + seed, qy / 160 + seed);
}

/** Offset from the nearest footpath, which winds along the land's contours. */
export function pathOffset(qx: number, qy: number, seed: number) {
  return (valueNoise(qx / 650 + seed * 3, qy / 650 + seed * 3) - 0.5) * 650;
}

/** Distance from open water: the river or a lake. */
export function waterEdge(qx: number, qy: number, seed: number) {
  return Math.min(
    Math.abs(qy - riverAcross(qx, seed)) - riverHalfWidth(qx, seed),
    lakeEdge(qx, qy, seed),
  );
}

/** The single park tree the shader paints in a 30 m cell, if any. */
export function parkTree(cellX: number, cellY: number, seed: number) {
  const at: [number, number] = [
    (cellX + 0.25 + 0.5 * hash(cellX + seed, cellY + seed)) * 30,
    (cellY + 0.25 + 0.5 * hash(cellX + 7, cellY + 7)) * 30,
  ];
  const wood = woodIndex(at[0], at[1], seed);
  const chance = 0.08 + 0.5 * smoothstep(0.7, 0.9, wood);
  return hash(cellX + 3, cellY + 3) <= chance ? { at, wood } : null;
}

/**
 * How much of the belt around the clearing covers a point, given its offset
 * from the clearing's centre (axial, across): clumps of trees, open toward
 * the sunward cap.
 */
export function beltCover(dx: number, dy: number) {
  const r = Math.sqrt(dx * dx + dy * dy);
  const outer =
    CLEARING_RADIUS + BELT.inset + BELT.depth * (0.3 + 0.7 * valueNoise(dx / 45 + 17, dy / 45 + 17));
  const clump = smoothstep(0.3, 0.4, valueNoise(dx / 80 + 31, dy / 80 + 31));
  const vista =
    1 -
    smoothstep(
      Math.cos(((BELT.vistaDegrees + 4) * Math.PI) / 180),
      Math.cos(((BELT.vistaDegrees - 4) * Math.PI) / 180),
      dx / Math.max(r, 1),
    );
  const inBelt = r > CLEARING_RADIUS + BELT.inset && r < outer ? 1 : 0;
  return inBelt * clump * vista;
}

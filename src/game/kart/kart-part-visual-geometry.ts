/** Surface finishes; the engine maps each to one shared PBR material. */
export type KartPartFinish =
  | "authored-paint" // builder-chosen color, painted/powder-coated (non-metal)
  | "authored-anodized" // builder-chosen color, anodized aluminum (metal)
  | "authored-polymer" // builder-chosen color, dyed molded plastic (non-metal)
  | "bare-aluminum" // bead-blasted / machined aluminum
  | "bare-steel" // machined steel (shafts, bearings)
  | "black-oxide-steel" // dark fasteners, cap screws, set screws
  | "black-polymer" // fixed dark molded plastic, wire insulation
  | "copper" // exposed windings
  | "rubber"; // tire compound

/** One mesh in the part's local frame, in meters. */
export type KartPartVisualPiece = {
  finish: KartPartFinish;
  /** xyz triples. */
  positions: number[];
  /** Unit xyz triples, one per vertex, pointing out of the surface. */
  normals: number[];
  /** Triangles, counter-clockwise when seen from the side the normal points to. */
  indices: number[];
};

type Vec3 = [number, number, number];
// Clockwise cross-section in (axial distance, radius). Smooth only the
// explicitly marked profile joins; every other join has split normals.
type Station = [axial: number, radius: number, smooth?: boolean];

function piece(finish: KartPartFinish): KartPartVisualPiece {
  return { finish, positions: [], normals: [], indices: [] };
}

function vertex(mesh: KartPartVisualPiece, p: Vec3, n: Vec3): number {
  const index = mesh.positions.length / 3;
  mesh.positions.push(...p);
  mesh.normals.push(...n);
  return index;
}

/** Revolve a closed section; cyclic XYZ permutation preserves handedness. */
function lathe(
  mesh: KartPartVisualPiece,
  axis: "x" | "y" | "z",
  profile: Station[],
  segments: number,
  center: Vec3 = [0, 0, 0],
): void {
  const count = profile.length;
  const edgeNormals = profile.map((a, i) => {
    const b = profile[(i + 1) % count];
    const da = b[0] - a[0];
    const dr = b[1] - a[1];
    const length = Math.hypot(da, dr);
    return [-dr / length, da / length];
  });
  const map = (a: number, u: number, v: number): Vec3 =>
    axis === "x" ? [a, u, v] : axis === "y" ? [v, a, u] : [u, v, a];
  const add = (p: Vec3, n: Vec3) =>
    vertex(mesh, [p[0] + center[0], p[1] + center[1], p[2] + center[2]], n);

  for (let edge = 0; edge < count; edge++) {
    const next = (edge + 1) % count;
    if (profile[edge][1] === 0 && profile[next][1] === 0) continue;
    const rings = [edge, next].map((station) => {
      const [a, r, smooth] = profile[station];
      let [na, nr] = edgeNormals[edge];
      if (smooth) {
        const before = edgeNormals[(station + count - 1) % count];
        const after = edgeNormals[station];
        na = before[0] + after[0];
        nr = before[1] + after[1];
        const length = Math.hypot(na, nr);
        na /= length;
        nr /= length;
      }
      if (r === 0) return [add(map(a, 0, 0), map(na, 0, 0))];
      return Array.from({ length: segments }, (_, i) => {
        const angle = (i * Math.PI * 2) / segments;
        const c = Math.cos(angle);
        const s = Math.sin(angle);
        return add(map(a, r * c, r * s), map(na, nr * c, nr * s));
      });
    });
    const [a, b] = rings;
    for (let i = 0; i < segments; i++) {
      const j = (i + 1) % segments;
      if (a.length === 1) mesh.indices.push(a[0], b[j], b[i]);
      else if (b.length === 1) mesh.indices.push(a[i], a[j], b[0]);
      else mesh.indices.push(a[i], a[j], b[i], b[i], a[j], b[j]);
    }
  }
}

/** An axis-aligned box with flat faces. */
function box(mesh: KartPartVisualPiece, center: Vec3, size: Vec3): void {
  for (let axis = 0; axis < 3; axis++) {
    const u = (axis + 1) % 3;
    const v = (axis + 2) % 3;
    for (const sign of [-1, 1]) {
      const normal: Vec3 = [0, 0, 0];
      normal[axis] = sign;
      const start = mesh.positions.length / 3;
      for (const [su, sv] of [[-1, -1], [1, -1], [1, 1], [-1, 1]]) {
        const p: Vec3 = [...center];
        p[axis] += (sign * size[axis]) / 2;
        p[u] += (su * size[u]) / 2;
        p[v] += (sv * sign * size[v]) / 2;
        vertex(mesh, p, normal);
      }
      mesh.indices.push(start, start + 1, start + 2, start, start + 2, start + 3);
    }
  }
}

/**
 * Ribbed RC tire on a deep-dish, anodized industrial wheel.
 * All features are surfaces of revolution: no frozen spokes or hex flats.
 * 1,584 triangles, three finishes; +X is the exposed outboard face.
 */
export function buildWheelTire(
  radius: number,
  width: number,
): KartPartVisualPiece[] {
  const tire = piece("rubber");
  lathe(tire, "x", [
    [-0.016, 0.034],
    [-0.020, 0.044, true],
    [-0.016, 0.054, true],
    [-0.009, 0.058, true],
    [-0.006, 0.058],
    [-0.0045, 0.0555],
    [-0.003, 0.058],
    [0.003, 0.058],
    [0.0045, 0.0555],
    [0.006, 0.058],
    [0.009, 0.058, true],
    [0.016, 0.054, true],
    [0.020, 0.044, true],
    [0.016, 0.034],
  ], 32);

  const rim = piece("authored-anodized");
  lathe(rim, "x", [
    [-0.016, 0.034],
    [0.016, 0.034],
    [0.018, 0.032], // Rounded-over bead lip, with a crisp inner reveal.
    [0.017, 0.029],
    [0.008, 0.023, true], // Deep recessed dish gives a broad readable shadow.
    [0.008, 0.011],
    [0.019, 0.007], // Raised center boss.
    [0.019, 0.0025],
    [-0.013, 0.0025], // Actual axle bore, visible from either side.
    [-0.013, 0.030], // Recessed inboard web.
    [-0.016, 0.031],
  ], 24);

  const collar = piece("bare-steel");
  lathe(collar, "x", [
    [0.019, 0.0065],
    [0.0225, 0.0065],
    [0.024, 0.005], // Machined circular retaining collar, not a hex nut.
    [0.024, 0.0025],
    [0.019, 0.0025],
  ], 16);
  const scale: Vec3 = [width / 0.040, radius / 0.058, radius / 0.058];
  for (const mesh of [tire, rim, collar]) {
    for (let i = 0; i < mesh.positions.length; i += 3) {
      const normal = mesh.normals.slice(i, i + 3).map((n, axis) => n / scale[axis]);
      const length = Math.hypot(...normal);
      for (let axis = 0; axis < 3; axis++) {
        mesh.positions[i + axis] *= scale[axis];
        mesh.normals[i + axis] = normal[axis] / length;
      }
    }
  }
  return [tire, rim, collar];
}

/**
 * Sealed 540-style steel can: rolled shoulders, machined drive end,
 * molded rear insulator and three exposed phase-terminal blades.
 * 888 triangles, four finishes. The 3.2 mm shaft exits toward -Z.
 */
export function buildMotorBrushlessStandardV1(): KartPartVisualPiece[] {
  const can = piece("black-oxide-steel");
  lathe(can, "z", [
    [-0.019, 0.0165],
    [-0.018, 0.018],
    [-0.012, 0.018],
    [-0.011, 0.017],
    [0.011, 0.017], // Recessed main barrel between substantial end collars.
    [0.012, 0.018],
    [0.018, 0.018],
    [0.019, 0.0165],
    [0.019, 0],
    [-0.019, 0],
  ], 24);

  const steel = piece("bare-steel");
  lathe(steel, "z", [
    [-0.019, 0.0016],
    [-0.0225, 0.0016],
    [-0.0225, 0.005], // Raised bearing seat within the construction cylinder.
    [-0.0215, 0.006],
    [-0.0215, 0.0155],
    [-0.019, 0.0165],
  ], 20);
  lathe(steel, "z", [
    [-0.030, 0],
    [-0.030, 0.0011],
    [-0.0295, 0.0016], // Half-millimeter lead-in on the shaft end.
    [-0.0215, 0.0016],
    [-0.0215, 0],
  ], 12);

  const insulator = piece("black-polymer");
  lathe(insulator, "z", [
    [0.019, 0],
    [0.019, 0.0165],
    [0.021, 0.0165],
    [0.0225, 0.0145],
    [0.0225, 0],
  ], 20);
  const terminals = piece("copper");
  for (const x of [-0.007, 0, 0.007]) {
    box(insulator, [x, 0.006, 0.0225], [0.005, 0.0035, 0.001]);
    box(terminals, [x, 0.006, 0.025], [0.004, 0.0015, 0.004]);
  }
  return [can, steel, insulator, terminals];
}

/** Extrude a convex, counter-clockwise XZ footprint, splitting every edge. */
function prism(
  mesh: KartPartVisualPiece,
  outline: [number, number][],
  bottom: number,
  top: number,
): void {
  const count = outline.length;
  const cx = outline.reduce((sum, p) => sum + p[0], 0) / count;
  const cz = outline.reduce((sum, p) => sum + p[1], 0) / count;
  for (const [y, sign] of [[bottom, -1], [top, 1]]) {
    const n: Vec3 = [0, sign, 0];
    const center = vertex(mesh, [cx, y, cz], n);
    const ring = outline.map(([x, z]) => vertex(mesh, [x, y, z], n));
    for (let i = 0; i < count; i++) {
      const j = (i + 1) % count;
      mesh.indices.push(center, ring[sign === 1 ? j : i], ring[sign === 1 ? i : j]);
    }
  }
  for (let i = 0; i < count; i++) {
    const [ax, az] = outline[i];
    const [bx, bz] = outline[(i + 1) % count];
    const length = Math.hypot(bx - ax, bz - az);
    const n: Vec3 = [(bz - az) / length, 0, (ax - bx) / length];
    const a = vertex(mesh, [ax, bottom, az], n);
    const b = vertex(mesh, [ax, top, az], n);
    const c = vertex(mesh, [bx, top, bz], n);
    const d = vertex(mesh, [bx, bottom, bz], n);
    mesh.indices.push(a, b, c, a, c, d);
  }
}

function caseBox(
  mesh: KartPartVisualPiece,
  center: Vec3,
  size: Vec3,
  bevel = 0.002,
): void {
  const [x, y, z] = center;
  const hx = size[0] / 2;
  const hz = size[2] / 2;
  prism(mesh, [
    [x - hx + bevel, z - hz], [x + hx - bevel, z - hz],
    [x + hx, z - hz + bevel], [x + hx, z + hz - bevel],
    [x + hx - bevel, z + hz], [x - hx + bevel, z + hz],
    [x - hx, z + hz - bevel], [x - hx, z - hz + bevel],
  ], y - size[1] / 2, y + size[1] / 2);
}

function cylinder(
  mesh: KartPartVisualPiece,
  axis: "x" | "y" | "z",
  center: Vec3,
  radius: number,
  length: number,
  segments = 8,
  bore = 0,
): void {
  lathe(mesh, axis, [
    [-length / 2, bore], [-length / 2, radius],
    [length / 2, radius], [length / 2, bore],
  ], segments, center);
}

function lidScrews(mesh: KartPartVisualPiece, x: number, z: number, y: number): void {
  for (const sx of [-1, 1]) {
    for (const sz of [-1, 1]) {
      cylinder(mesh, "y", [sx * x, y, sz * z], 0.0015, 0.001, 6);
    }
  }
}

/** Hard-case pack with a sealed lid, molded ribs and recessed connector seats. */
export function buildBatteryLipoStandardV1(): KartPartVisualPiece[] {
  const housing = piece("authored-polymer");
  const black = piece("black-polymer");
  const contacts = piece("bare-steel");
  caseBox(housing, [0, -0.002, 0], [0.095, 0.022, 0.048], 0.003);
  caseBox(black, [0, 0.0095, 0], [0.094, 0.001, 0.047], 0.003);
  caseBox(housing, [0, 0.01075, 0], [0.093, 0.0015, 0.046], 0.003);
  for (const x of [-0.031, 0.031]) {
    box(housing, [x, 0.012, 0], [0.004, 0.001, 0.040]);
  }
  box(black, [-0.006, 0.012, 0], [0.030, 0.001, 0.023]);
  for (const z of [-0.009, 0.009]) {
    cylinder(black, "y", [0.040, 0.012, z], 0.0035, 0.002, 10, 0.002);
    cylinder(contacts, "y", [0.040, 0.0115, z], 0.002, 0.001, 10, 0.001);
  }
  return [housing, black, contacts];
}

/** Low receiver/ESC tray with an extruded heatsink and protected plugs. */
export function buildReceiverEscStandardV1(): KartPartVisualPiece[] {
  const housing = piece("authored-polymer");
  const sink = piece("bare-aluminum");
  const plugs = piece("black-polymer");
  caseBox(housing, [0, -0.009, 0], [0.052, 0.006, 0.038]);
  caseBox(housing, [0, -0.002, 0], [0.048, 0.008, 0.034]);
  box(sink, [0, 0.003, -0.002], [0.042, 0.002, 0.027]);
  for (let i = -3; i <= 3; i++) {
    box(sink, [i * 0.006, 0.0075, -0.002], [0.002, 0.007, 0.027]);
  }
  for (const x of [-0.015, -0.005, 0.005, 0.015]) {
    box(plugs, [x, 0.005, 0.0145], [0.007, 0.006, 0.007]);
    box(housing, [x, 0.0085, 0.017], [0.004, 0.001, 0.003]);
  }
  return [housing, sink, plugs];
}

/** Molded servo, integral mounting ears and a short single-sided output horn. */
export function buildSteeringServoStandardV1(): KartPartVisualPiece[] {
  const housing = piece("authored-polymer");
  const black = piece("black-polymer");
  const steel = piece("bare-steel");
  caseBox(housing, [0, -0.003, 0], [0.029, 0.024, 0.038]);
  caseBox(black, [0, 0.0095, 0], [0.029, 0.001, 0.038]);
  caseBox(housing, [0, 0.011, 0], [0.029, 0.002, 0.038]);
  for (const x of [-0.017, 0.017]) {
    box(housing, [x, 0.004, 0], [0.007, 0.003, 0.024]);
    for (const z of [-0.008, 0.008]) {
      cylinder(steel, "y", [x, 0.006, z], 0.002, 0.001, 8, 0.001);
    }
  }
  cylinder(steel, "y", [0, 0.0125, -0.009], 0.004, 0.001, 12);
  caseBox(black, [0, 0.01375, 0], [0.008, 0.0015, 0.026], 0.002);
  cylinder(steel, "y", [0, 0.0145, -0.009], 0.002, 0.001, 8);
  box(black, [0, -0.009, 0.0195], [0.008, 0.004, 0.003]);
  return [housing, black, steel];
}

/** Sealed actuator block; four service outlets and one rear handbrake outlet. */
export function buildBrakesCombinedStandardV1(): KartPartVisualPiece[] {
  const housing = piece("authored-anodized");
  const steel = piece("bare-steel");
  const black = piece("black-oxide-steel");
  caseBox(housing, [0, -0.0015, 0], [0.052, 0.015, 0.034]);
  caseBox(black, [0, 0.0065, 0], [0.050, 0.001, 0.033]);
  caseBox(housing, [0, 0.0075, 0], [0.050, 0.001, 0.033]);
  lidScrews(black, 0.021, 0.012, 0.0085);
  for (const x of [-0.016, 0.016]) {
    for (const z of [-0.018, 0.018]) {
      cylinder(steel, "z", [x, -0.001, z], 0.0025, 0.004, 8, 0.001);
    }
  }
  cylinder(steel, "z", [0, -0.001, 0.018], 0.003, 0.004, 6, 0.0015);
  return [housing, steel, black];
}

function gearbox(gearRadius: number, heavy: boolean): KartPartVisualPiece[] {
  const housing = piece(heavy ? "authored-paint" : "authored-anodized");
  const metal = piece(heavy ? "bare-steel" : "bare-aluminum");
  const black = piece("black-oxide-steel");
  const cover = heavy ? 0.027 : 0.025;
  const end = heavy ? 0.032 : 0.030;
  caseBox(housing, [0, 0, -0.002], [cover * 2 - 0.004, 0.016, 0.047]);
  lathe(housing, "x", [
    [-cover, 0], [-cover, gearRadius - 0.0015],
    [-cover + 0.002, gearRadius], [cover - 0.002, gearRadius],
    [cover, gearRadius - 0.0015], [cover, 0],
  ], 16, [0, 0, 0.009]);
  lathe(housing, "x", [
    [-cover, 0], [-cover, 0.007], [-cover + 0.002, 0.0085],
    [cover - 0.002, 0.0085], [cover, 0.007], [cover, 0],
  ], 12, [0, 0, -0.016]);
  for (const sign of [-1, 1]) {
    cylinder(metal, "x", [sign * (cover + 0.0005), 0, 0.009],
      gearRadius - 0.003, 0.001, 8, 0.005);
    cylinder(black, "x", [sign * (cover + end) / 2, 0, 0.009],
      0.0055, end - cover, 8, 0.003);
    for (const z of [-0.018, 0.015]) {
      cylinder(black, "x", [sign * cover, 0.0045, z], 0.0018, 0.001, 6);
    }
  }
  if (heavy) {
    for (const z of [-0.023, -0.012, 0.022]) {
      box(housing, [0, 0, z], [0.050, 0.022, 0.003]);
    }
    box(metal, [0, -0.0155, 0], [0.044, 0.003, 0.048]);
  }
  return [housing, metal, black];
}

export function buildTransmissionTall4to1V1(): KartPartVisualPiece[] {
  return gearbox(0.0105, false);
}

export function buildTransmissionBalanced5to1V1(): KartPartVisualPiece[] {
  return gearbox(0.0145, false);
}

export function buildTransmissionShort8to1V1(): KartPartVisualPiece[] {
  return gearbox(0.0165, true);
}

export type KartCoiloverVisual = {
  /**
   * Rigid with the chassis eye. Frame: origin at the chassis eye center, +Y
   * points along the shock toward the lower eye.
   */
  body: KartPartVisualPiece[];
  /**
   * Rigid with the lower eye. Frame: origin at the lower eye center, +Y
   * points along the shock toward the chassis eye.
   */
  shaft: KartPartVisualPiece[];
  /** Distance from the chassis eye along body +Y where the spring's top seats. */
  topPerch: number;
  /** Distance from the lower eye along shaft +Y where the spring seats. */
  bottomPerch: number;
  /** The helix drawn between the perches. */
  spring: { meanRadius: number; wireRadius: number; turns: number };
};

export type KartCoiloverSpec = {
  /** Anodized aluminum body; otherwise powder-coated steel. */
  anodized: boolean;
  bumpStart: number;
  constructionRadius: number;
  extendedLength: number;
  maximumStroke: number;
  springRate: number;
};

const SPRING_STEEL_SHEAR_MODULUS = 79e9;

/**
 * A coilover sized from its suspension definition. The bump-stop ring meets
 * the body at `bumpStart` compression, and the spring wire follows the coil
 * spring rate k = G·d⁴ / (8·n·D³).
 */
export function buildCoilover(spec: KartCoiloverSpec): KartCoiloverVisual {
  const finish = spec.anodized ? "authored-anodized" : "authored-paint";
  const body = piece(finish);
  const bodyEye = piece("bare-steel");
  const lower = piece(finish);
  const shaft = piece("bare-steel");
  const bump = piece("rubber");
  const radius = spec.constructionRadius - 0.0005;
  // Sized for today's specs: the long coilover keeps only ~2 mm between the
  // shaft tip and gland, and between bump ring and perch, at full stroke.
  const end = Math.round(spec.extendedLength * 0.53 * 1000) / 1000;
  const reach = end;
  const bumpTip = spec.extendedLength - spec.bumpStart - end;
  const bumpHeight = spec.maximumStroke - spec.bumpStart;
  const meanRadius = radius + 0.0015;
  const turns = Math.round(spec.extendedLength / 0.0135);
  const wireDiameter =
    ((8 * spec.springRate * turns * (2 * meanRadius) ** 3) /
      SPRING_STEEL_SHEAR_MODULUS) **
    0.25;

  // A closed top and a shaft-sized gland; the shaft tip stays inside the bore.
  lathe(body, "y", [
    [0.010, 0], [0.010, radius - 0.001], [0.012, radius],
    [end - 0.004, radius], [end, radius - 0.001],
    [end, 0.002], [0.012, 0.002], [0.012, 0],
  ], 12);
  box(body, [0, 0.007, 0], [0.006, 0.008, 0.006]);
  cylinder(bodyEye, "z", [0, 0, 0], 0.005, 0.006, 8, 0.0025);
  cylinder(body, "y", [0, 0.017, 0], radius + 0.0025, 0.002, 8, radius);

  box(lower, [0, 0.007, 0], [0.006, 0.008, 0.006]);
  cylinder(shaft, "z", [0, 0, 0], 0.005, 0.006, 8, 0.0025);
  cylinder(lower, "y", [0, 0.011, 0], radius + 0.0025, 0.002, 8, 0.002);
  cylinder(shaft, "y", [0, (reach + 0.008) / 2, 0], 0.002, reach - 0.008, 8);
  cylinder(bump, "y", [0, bumpTip - bumpHeight / 2, 0],
    0.004, bumpHeight, 8, 0.002);

  return {
    body: [body, bodyEye],
    shaft: [lower, shaft, bump],
    topPerch: 0.018,
    bottomPerch: 0.012,
    spring: { meanRadius, turns, wireRadius: wireDiameter / 2 },
  };
}

/**
 * A lower suspension A-arm. Frame: origin at the midpoint between the two
 * chassis pivots, +X points to the hub at (length, 0, 0); the chassis pivots
 * are at (0, 0, ±halfSpread).
 */
export function buildSuspensionArm(
  length: number,
  halfSpread: number,
): KartPartVisualPiece[] {
  const composite = piece("authored-polymer");
  const bushings = piece("bare-steel");
  const knuckle = piece("black-polymer");
  for (const sign of [-1, 1]) {
    const z = sign * halfSpread;
    const beamLength = Math.hypot(length, z);
    const nx = z / beamLength * 0.0035;
    const nz = length / beamLength * 0.0035;
    prism(composite, [
      [-nx, z - nz], [length - nx, -nz],
      [length + nx, nz], [nx, z + nz],
    ], -0.0035, 0.0035);
    cylinder(bushings, "z", [0, 0, z], 0.0045, 0.010, 8, 0.0015);
  }
  box(composite, [length * 0.32, 0, 0],
    [0.006, 0.005, halfSpread * 1.36]);
  cylinder(knuckle, "y", [length, 0, 0], 0.006, 0.008, 8, 0.003);
  cylinder(bushings, "y", [length, 0, 0], 0.003, 0.012, 8, 0.0015);
  return [composite, bushings, knuckle];
}

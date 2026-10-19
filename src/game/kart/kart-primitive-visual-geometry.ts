import {
  box,
  lathe,
  piece,
  vertex,
  type KartPartVisualPiece,
  type Station,
  type Vec3,
} from "./kart-part-visual-geometry";

// All detail dimensions and pitches are meters, independent of the envelope.
const CHAMFER = 0.0008;
const MOLD_RADIUS = 0.001;
const BODY_TOP_RADIUS = 0.006;
const BODY_ROUND_SEGMENTS = 4;
const CAP_RADIUS = 0.003;
const MIN_EDGE_SIZE = 0.004;
const EDGE_FRACTION = 0.15;
const SCREW_RADIUS = 0.00225;
const SCREW_HEIGHT = 0.0024;
// Plates thinner than this carry low button heads instead of cap screws.
const BUTTON_HEAD_PLATE = 0.01;
const BUTTON_HEAD_HEIGHT = 0.0006;
const SOCKET_RADIUS = 0.001;
const SOCKET_DEPTH = 0.0008;
const SCREW_INSET = 0.006;
const SCREW_PITCH = 0.03;
const SEAM_WIDTH = 0.0006;
const SEAM_DEPTH = 0.0003;
const LID_DEPTH = 0.004;
const PLATE_PITCH = 0.006;
const RIB_PITCH = 0.01;
const RIB_WIDTH = 0.004;
const RIB_HEIGHT = 0.001;
const END_CAP_LENGTH = 0.004;
const VENT_PITCH = 0.01;
const VENT_LENGTH = 0.028;
const VENT_WIDTH = 0.005;
const VENT_DEPTH = 0.0015;
const VENT_LIP_WIDTH = 0.0006;
const PANEL_MARGIN = 0.004;
const ROUND_SEGMENTS = 2;
const RADIAL_CHORD = 0.015;
const MIN_RADIAL_SEGMENTS = 8;
const MAX_RADIAL_SEGMENTS = 24;
const MAX_PLATE_SEAMS = 4;
const MAX_BOX_RIBS = 6;
const MAX_TUBE_RIBS = 3;
const MAX_VENTS = 8;

export type KartPrimitiveVisualSpec = {
  /** Box: full size along local X, Y, Z. Cylinder: along local +Y. */
  shape:
    | { kind: "box"; size: [x: number, y: number, z: number] }
    | { kind: "cylinder"; radius: number; height: number };
  role: "structure" | "bodywork" | "guard" | "trim";
  construction: { mode: "solid" } | { mode: "shell"; thickness: number };
  /** Machined (aluminum, steel) gets chamfers; molded (polymers) radii. */
  edge: "machined" | "molded";
  /** The finish that carries the builder's color. */
  finish: "authored-paint" | "authored-anodized" | "authored-polymer";
  /** Structure + solid + steel: draw as ballast instead of a plate/bar. */
  massBlock: boolean;
};

function smallestDimension(shape: KartPrimitiveVisualSpec["shape"]): number {
  return shape.kind === "box"
    ? Math.min(...shape.size)
    : Math.min(2 * shape.radius, shape.height);
}

function edgeSize(size: number, spec: KartPrimitiveVisualSpec): number {
  const primitiveSize = smallestDimension(spec.shape);
  // Small *primitives* shed edge detail. Thin lids/ribs on a larger primitive
  // retain it, limited to 15% of that section so opposing edges cannot meet.
  return primitiveSize < MIN_EDGE_SIZE ? 0 : Math.min(
    spec.edge === "machined" ? CHAMFER : MOLD_RADIUS,
    size * EDGE_FRACTION,
  );
}

/** Fixed pitch, centered about zero; the budget removes features, not space. */
function repeats(span: number, pitch: number, limit: number): number[] {
  const count = Math.min(limit, Math.max(0, Math.floor(span / pitch)));
  return Array.from({ length: count }, (_, i) => (i - (count - 1) / 2) * pitch);
}

/** A capped rib bank spans the usable length instead of bunching at its center. */
function ribs(span: number, limit: number): number[] {
  const count = Math.min(limit, Math.max(0, Math.floor(span / RIB_PITCH)));
  const pitch = count > 1 ? span / (count - 1) : 0;
  return Array.from({ length: count }, (_, i) => (i - (count - 1) / 2) * pitch);
}

/** Ballast plate seams split the body into equal plates. */
function plateSeams(bottom: number, top: number): number[] {
  const plates = Math.min(
    MAX_PLATE_SEAMS + 1,
    Math.floor((top - bottom) / PLATE_PITCH),
  );
  return Array.from(
    { length: Math.max(0, plates - 1) },
    (_, i) => bottom + ((i + 1) * (top - bottom)) / plates,
  );
}

function radialSegments(radius: number): number {
  // Even counts preserve the X mirror and put samples on both sides of Y.
  const angle = 2 * Math.asin(Math.min(1, RADIAL_CHORD / (2 * radius)));
  return Math.min(MAX_RADIAL_SEGMENTS, Math.max(MIN_RADIAL_SEGMENTS,
    2 * Math.ceil(Math.PI / angle)));
}

function triangle(
  mesh: KartPartVisualPiece,
  points: Vec3[],
  outward: Vec3,
  normals?: Vec3[],
): void {
  const [a, b, c] = points;
  const u = b.map((v, i) => v - a[i]);
  const v = c.map((v, i) => v - a[i]);
  const cross: Vec3 = [u[1] * v[2] - u[2] * v[1],
    u[2] * v[0] - u[0] * v[2], u[0] * v[1] - u[1] * v[0]];
  const sign = cross.reduce((sum, n, i) => sum + n * outward[i], 0) < 0 ? -1 : 1;
  const length = Math.hypot(...cross);
  const normal = cross.map((n) => n * sign / length) as Vec3;
  const indices = points.map((p, i) => vertex(mesh, p, normals?.[i] ?? normal));
  mesh.indices.push(indices[0], indices[sign === 1 ? 1 : 2], indices[sign === 1 ? 2 : 1]);
}

function quad(mesh: KartPartVisualPiece, p: Vec3[], n: Vec3, normals?: Vec3[]): void {
  triangle(mesh, [p[0], p[1], p[2]], n, normals && [normals[0], normals[1], normals[2]]);
  triangle(mesh, [p[0], p[2], p[3]], n, normals && [normals[0], normals[2], normals[3]]);
}

/**
 * Six flat faces, twelve edge strips, eight corners. Radius patches have
 * analytic normals; chamfers have separate flat normals. No stretched detail.
 */
function edgedBox(
  mesh: KartPartVisualPiece,
  center: Vec3,
  size: Vec3,
  spec: KartPrimitiveVisualSpec,
  vents = false,
  capRadius?: number,
): void {
  const lowerRadius = capRadius ?? edgeSize(Math.min(...size), spec);
  const r = vents && spec.edge === "molded" && lowerRadius
    ? Math.min(BODY_TOP_RADIUS, Math.min(...size) * EDGE_FRACTION) : lowerRadius;
  if (!r) {
    box(mesh, center, size);
    return;
  }
  const half = size.map((v) => v / 2);
  const core = half.map((v) => v - r);
  // The lower fillet stays shallow so the shell seats on its flat base.
  const bottomY = -half[1] + lowerRadius;
  const topY = half[1] - r;
  const point = (p: Vec3): Vec3 => p.map((v, i) => v + center[i]) as Vec3;
  const normalAt = (n: Vec3): Vec3 => {
    const scaled: Vec3 = [n[0], n[1] < 0 ? n[1] * r / lowerRadius : n[1], n[2]];
    const length = Math.hypot(...scaled);
    return scaled.map((v) => v / length) as Vec3;
  };
  const molded = spec.edge === "molded";
  const steps = molded ? (vents ? BODY_ROUND_SEGMENTS : ROUND_SEGMENTS) : 1;

  for (let axis = 0; axis < 3; axis++) {
    const u = (axis + 1) % 3;
    const v = (axis + 2) % 3;
    for (const sign of [-1, 1]) {
      const n: Vec3 = [0, 0, 0];
      n[axis] = sign;
      if (vents && axis === 1 && sign === 1) {
        ventPanel(mesh, center, core[0], core[2], half[1]);
      } else {
        const corners = [[-1, -1], [1, -1], [1, 1], [-1, 1]].map(([su, sv]) => {
          const p: Vec3 = [0, 0, 0];
          p[axis] = sign * half[axis];
          p[u] = su * core[u];
          p[v] = sv * core[v];
          if (u === 1) p[u] = su < 0 ? bottomY : topY;
          if (v === 1) p[v] = sv < 0 ? bottomY : topY;
          return point(p);
        });
        quad(mesh, corners, n);
      }
    }

    // Edge strips parallel to this axis, rounded in the other two axes.
    for (const su of [-1, 1]) for (const sv of [-1, 1]) {
      for (let i = 0; i < steps; i++) {
        const normals: Vec3[] = [];
        const points = [[i, -1], [i, 1], [i + 1, 1], [i + 1, -1]].map(([j, s]) => {
          const angle = j / steps * Math.PI / 2;
          const n: Vec3 = [0, 0, 0];
          n[u] = su * Math.cos(angle);
          n[v] = sv * Math.sin(angle);
          normals.push(normalAt(n));
          const p: Vec3 = [0, 0, 0];
          p[axis] = s * core[axis];
          p[u] = su * core[u] + r * n[u];
          p[v] = sv * core[v] + r * n[v];
          if (axis === 1) p[1] = s < 0 ? bottomY : topY;
          else p[1] = (u === 1 ? su : sv) < 0
            ? bottomY + lowerRadius * n[1] : topY + r * n[1];
          return point(p);
        });
        quad(mesh, points, normals[0], molded ? normals : undefined);
      }
    }
  }

  for (const sx of [-1, 1]) for (const sy of [-1, 1]) for (const sz of [-1, 1]) {
    const sign: Vec3 = [sx, sy, sz];
    const corner = (n: Vec3) => point([
      sx * (core[0] + r * n[0]),
      sy < 0 ? bottomY - lowerRadius * n[1] : topY + r * n[1],
      sz * (core[2] + r * n[2]),
    ]);
    if (!molded) {
      triangle(mesh, [[1, 0, 0], [0, 1, 0], [0, 0, 1]].map((n) => corner(n as Vec3)), sign);
      continue;
    }
    const normal = (row: number, col: number): Vec3 => {
      const a = row / steps * Math.PI / 2;
      const b = col / steps * Math.PI / 2;
      return [Math.sin(a) * Math.cos(b), Math.cos(a), Math.sin(a) * Math.sin(b)];
    };
    for (let row = 0; row < steps; row++) for (let col = 0; col < steps; col++) {
      const ns = [normal(row, col), normal(row + 1, col),
        normal(row + 1, col + 1), normal(row, col + 1)];
      const ps = ns.map(corner);
      const signed = ns.map((n) => normalAt(n.map((v, i) => v * sign[i]) as Vec3));
      // The pole is one triangle, not a collapsed quad.
      triangle(mesh, ps.slice(0, 3), sign, signed.slice(0, 3));
      if (row > 0) triangle(mesh, [ps[0], ps[2], ps[3]], sign, [signed[0], signed[2], signed[3]]);
    }
  }
}

/** A continuous top skin with closed, shallow louver recesses and panel lines. */
function ventPanel(
  mesh: KartPartVisualPiece,
  center: Vec3,
  hx: number,
  hz: number,
  y: number,
): void {
  const rows = repeats(2 * (hz - PANEL_MARGIN), VENT_PITCH, MAX_VENTS);
  if (hx < VENT_LENGTH / 2 + PANEL_MARGIN || !rows.length) {
    quad(mesh, [[-hx, y, -hz], [hx, y, -hz], [hx, y, hz], [-hx, y, hz]]
      .map((p) => p.map((v, i) => v + center[i]) as Vec3), [0, 1, 0]);
    return;
  }
  const xs = [-hx, -VENT_LENGTH / 2, -VENT_LENGTH / 2 + VENT_DEPTH,
    VENT_LENGTH / 2 - VENT_DEPTH, VENT_LENGTH / 2, hx];
  const profile: [number, number][] = [[-hz, 0]];
  // The two short panel lines frame the vent bank, also with a closed floor.
  for (const z of [-hz + PANEL_MARGIN / 2, ...rows, hz - PANEL_MARGIN / 2]) {
    const panel = Math.abs(z) > Math.abs(rows[0]) + VENT_PITCH / 2;
    const width = panel ? SEAM_WIDTH : VENT_WIDTH;
    const depth = panel ? SEAM_DEPTH : VENT_DEPTH;
    profile.push(
      [z - width / 2, 0],
      [panel ? z : z - width / 2 + VENT_LIP_WIDTH, -depth],
      [z + width / 2, 0],
    );
  }
  profile.push([hz, 0]);
  for (let row = 0; row < profile.length - 1; row++) for (let col = 0; col < xs.length - 1; col++) {
    const corners = [[row, col], [row, col + 1], [row + 1, col + 1], [row + 1, col]];
    const points = corners.map(([j, i]) => {
      const [z, depth] = profile[j];
      const recess = i === 2 || i === 3 ? depth : 0;
      return [xs[i] + center[0], y + center[1] + recess, z + center[2]] as Vec3;
    });
    // Mirror the diagonals too: the ramp corners are nonplanar quads.
    quad(mesh, col > 2 ? [points[1], points[0], points[3], points[2]] : points, [0, 1, 0]);
  }
}

/** A cap screw seated at `face`, facing +Y, or -Y when `face` is negative. */
function screw(
  mesh: KartPartVisualPiece, x: number, face: number, z: number,
  height = SCREW_HEIGHT,
): void {
  const top = Math.abs(face);
  const socket = Math.min(SOCKET_DEPTH, height * 0.75);
  // Closed socket floor. The dark socket is a recess, never a through-hole.
  const profile: Station[] = [
    [top - height, 0],
    [top - height, SCREW_RADIUS],
    [top, SCREW_RADIUS],
    [top, SOCKET_RADIUS],
    [top - socket, SOCKET_RADIUS],
    [top - socket, 0],
  ];
  // Reflecting the axis reverses the section, so reverse it back.
  lathe(
    mesh,
    "y",
    face < 0 ? profile.map(([y, r]): Station => [-y, r]).reverse() : profile,
    6,
    [x, 0, z],
  );
}

/** Corner screws, plus edge midpoints on edges long enough for the pitch. */
function lidScrews(size: Vec3, mass: boolean, head: number): [number, number][] {
  if (
    Math.min(size[0], size[2]) < SCREW_INSET * 2 + SCREW_RADIUS * 2 ||
    size[1] < head * 3
  ) return [];
  const x = size[0] / 2 - SCREW_INSET;
  const z = size[2] / 2 - SCREW_INSET;
  const points: [number, number][] = [[-x, -z], [x, -z], [x, z], [-x, z]];
  if (mass) return points;
  if (x >= SCREW_PITCH) points.push([0, -z], [0, z]);
  if (z >= SCREW_PITCH) points.push([-x, 0], [x, 0]);
  return points;
}

/** Each seam has a closed inset bridge between two closed sections. */
function seamedBox(
  mesh: KartPartVisualPiece, size: Vec3, bottom: number, top: number,
  seams: number[], depth: number, spec: KartPrimitiveVisualSpec, vents = false,
): void {
  let start = bottom;
  for (const end of [...seams.map((y) => y - SEAM_WIDTH / 2), top]) {
    const section: Vec3 = [size[0], end - start, size[2]];
    edgedBox(mesh, [0, (start + end) / 2, 0], section, spec, vents && end === top);
    if (end !== top) {
      const bridge: Vec3 = [size[0] - 2 * depth, SEAM_WIDTH, size[2] - 2 * depth];
      box(mesh, [0, end + SEAM_WIDTH / 2, 0], bridge);
    }
    start = end + SEAM_WIDTH;
  }
}

function boxVisual(
  spec: KartPrimitiveVisualSpec,
  size: Vec3,
  minimum: number,
  shell: boolean,
  depth: number,
): KartPartVisualPiece[] {
  const main = piece(spec.finish);
  const hardware = piece("black-oxide-steel");
  const [sx, sy, sz] = size;
  const mass = spec.massBlock && !shell;
  const head = sy < BUTTON_HEAD_PLATE ? BUTTON_HEAD_HEIGHT : SCREW_HEIGHT;
  const screws = spec.role === "structure" ? lidScrews(size, mass, head) : [];
  const bottom = -sy / 2;
  const top = sy / 2 - (screws.length ? head : 0);

  if (spec.role === "guard" && minimum >= END_CAP_LENGTH * 4) {
    const axis = sx >= sz ? 0 : 2;
    const cross = axis === 0 ? 2 : 0;
    const core: Vec3 = [...size];
    core[axis] -= (END_CAP_LENGTH + SEAM_WIDTH) * 2;
    core[1] -= RIB_HEIGHT * 2;
    core[cross] -= RIB_HEIGHT * 2;
    edgedBox(main, [0, 0, 0], core, spec);
    for (const sign of [-1, 1]) {
      const cap: Vec3 = [...size];
      cap[axis] = END_CAP_LENGTH;
      const center: Vec3 = [0, 0, 0];
      center[axis] = sign * (size[axis] - END_CAP_LENGTH) / 2;
      edgedBox(main, center, cap, spec, false, spec.edge === "molded"
        ? Math.min(CAP_RADIUS, END_CAP_LENGTH * 0.45, minimum * EDGE_FRACTION)
        : undefined);
      const bridge: Vec3 = [...core];
      bridge[axis] = SEAM_WIDTH;
      bridge[1] -= 2 * depth;
      bridge[cross] -= 2 * depth;
      center[axis] = sign * (core[axis] + SEAM_WIDTH) / 2;
      box(main, center, bridge);
    }
    for (const pos of ribs(core[axis] - RIB_WIDTH - 2 * RIB_PITCH, MAX_BOX_RIBS)) {
      const rib: Vec3 = [...size];
      rib[axis] = RIB_WIDTH;
      const center: Vec3 = [0, 0, 0];
      center[axis] = pos;
      edgedBox(main, center, rib, spec);
    }
  } else {
    let seams: number[] = [];
    if (minimum >= MIN_EDGE_SIZE * 2) {
      if (mass) seams = plateSeams(bottom, top);
      else if (spec.role === "structure" && shell) seams = [top - LID_DEPTH];
      else if (spec.role === "bodywork") seams = [bottom + LID_DEPTH];
    }
    const vents = spec.role === "bodywork" && minimum >= MIN_EDGE_SIZE * 2;
    seamedBox(main, size, bottom, top, seams, depth, spec, vents);
    for (const [x, z] of screws) screw(hardware, x, sy / 2, z, head);
  }
  return [main, hardware];
}

/**
 * Upright structure plates (thinnest along Z, such as shock towers) carry
 * their detail on the large face: build them lying flat, then stand them up.
 */
function uprightPlateVisual(
  spec: KartPrimitiveVisualSpec,
  [sx, sy, sz]: Vec3,
  minimum: number,
  shell: boolean,
  depth: number,
): KartPartVisualPiece[] {
  const pieces = boxVisual(spec, [sx, sz, sy], minimum, shell, depth);
  // Rotate +Y onto +Z about X: (x, y, z) -> (x, -z, y).
  for (const { normals, positions } of pieces) {
    for (const values of [normals, positions]) {
      for (let i = 0; i < values.length; i += 3) {
        const [y, z] = [values[i + 1], values[i + 2]];
        values[i + 1] = -z + 0;
        values[i + 2] = y;
      }
    }
  }
  return pieces;
}

function cylinderProfile(
  mesh: KartPartVisualPiece, bottom: number, top: number, radius: number,
  spec: KartPrimitiveVisualSpec, detail: Station[] = [],
): void {
  const r = edgeSize(Math.min(radius * 2, top - bottom), spec);
  const profile: Station[] = [[bottom, 0], [bottom, radius - r]];
  const steps = spec.edge === "molded" ? ROUND_SEGMENTS : 1;
  if (r) for (let i = 1; i <= steps; i++) {
    const a = i / steps * Math.PI / 2;
    profile.push([bottom + r * (1 - Math.cos(a)), radius - r + r * Math.sin(a), i < steps]);
  }
  profile.push(...detail);
  if (r) for (let i = 0; i < steps; i++) {
    const a = i / steps * Math.PI / 2;
    profile.push([top - r + r * Math.sin(a), radius - r + r * Math.cos(a), i > 0]);
  }
  profile.push([top, radius - r], [top, 0]);
  lathe(mesh, "y", profile, radialSegments(radius));
}

function cylinderVisual(
  spec: KartPrimitiveVisualSpec,
  radius: number,
  height: number,
  minimum: number,
  shell: boolean,
  depth: number,
): KartPartVisualPiece[] {
  const main = piece(spec.finish);
  const hardware = piece("black-oxide-steel");
  const mass = spec.massBlock && !shell;
  // A through-bolt with a head at each end keeps the stack symmetric, so a
  // mirrored X-axis cylinder still looks mirrored.
  const hasScrew = mass && minimum >= SCREW_INSET * 2 + SCREW_RADIUS * 2;
  const bottom = -height / 2 + (hasScrew ? SCREW_HEIGHT : 0);
  const top = height / 2 - (hasScrew ? SCREW_HEIGHT : 0);

  if (spec.role === "guard" && minimum >= END_CAP_LENGTH * 4) {
    const lo = bottom + END_CAP_LENGTH;
    const hi = top - END_CAP_LENGTH;
    const coreRadius = radius - RIB_HEIGHT;
    const capRadius = spec.edge === "molded"
      ? Math.min(CAP_RADIUS, minimum * EDGE_FRACTION)
      : CHAMFER;
    const capSteps = spec.edge === "molded" ? ROUND_SEGMENTS : 1;
    // One closed skin: the cap, seam and ribs share rings, without hidden discs.
    const capOuterRadius = coreRadius + depth;
    const lower: Station[] = [[bottom, 0], [bottom, capOuterRadius - capRadius]];
    for (let i = 1; i <= capSteps; i++) {
      const a = i / capSteps * Math.PI / 2;
      lower.push([bottom + capRadius * (1 - Math.cos(a)),
        capOuterRadius - capRadius + capRadius * Math.sin(a), i < capSteps]);
    }
    lower.push([lo, coreRadius]);
    const profile: Station[] = [...lower];
    const positions = ribs(hi - lo - RIB_WIDTH, MAX_TUBE_RIBS);
    for (const [i, y] of positions.entries()) {
      // End ribs start at the cap seam; shared rings save two hidden strips.
      if (positions.length < 2 || i > 0) profile.push([y - RIB_WIDTH / 2, coreRadius]);
      profile.push([y, radius, spec.edge === "molded"], [y + RIB_WIDTH / 2, coreRadius]);
    }
    const upper = positions.length >= 2 ? lower.slice(0, -1) : lower;
    profile.push(...upper.slice().reverse().map(([y, r, smooth]): Station => [-y, r, smooth]));
    lathe(main, "y", profile, radialSegments(radius));
  } else {
    let seams: number[] = [];
    if (minimum >= MIN_EDGE_SIZE * 2) {
      if (mass) seams = plateSeams(bottom, top);
      else if (spec.role === "structure" && shell && height > 2 * LID_DEPTH + SEAM_WIDTH) {
        seams = [bottom + LID_DEPTH, top - LID_DEPTH];
      }
      else if (spec.role === "bodywork") seams = [0];
    }
    const detail: Station[] = [];
    for (const y of seams) detail.push([y - SEAM_WIDTH / 2, radius],
      [y - SEAM_WIDTH / 4, radius - depth], [y + SEAM_WIDTH / 4, radius - depth],
      [y + SEAM_WIDTH / 2, radius]);
    cylinderProfile(main, bottom, top, radius, spec, detail);
    if (hasScrew) {
      screw(hardware, 0, height / 2, 0);
      screw(hardware, 0, -height / 2, 0);
    }
  }
  return [main, hardware];
}

/** Closed presentation surfaces; construction/physics remain owned by derivation. */
export function buildPrimitiveVisual(
  spec: KartPrimitiveVisualSpec,
): KartPartVisualPiece[] {
  const minimum = smallestDimension(spec.shape);
  const thickness =
    spec.construction.mode === "shell" ? spec.construction.thickness : null;
  const shell = thickness !== null && thickness < minimum / 2;
  const depth = shell ? Math.min(SEAM_DEPTH, thickness / 2) : SEAM_DEPTH;
  const upright =
    spec.shape.kind === "box" &&
    spec.role === "structure" &&
    !spec.massBlock &&
    spec.shape.size[2] < Math.min(spec.shape.size[0], spec.shape.size[1]);
  const meshes =
    spec.shape.kind === "box"
      ? (upright ? uprightPlateVisual : boxVisual)(
          spec,
          spec.shape.size,
          minimum,
          shell,
          depth,
        )
      : cylinderVisual(
          spec,
          spec.shape.radius,
          spec.shape.height,
          minimum,
          shell,
          depth,
        );
  return meshes.filter((mesh) => mesh.indices.length);
}

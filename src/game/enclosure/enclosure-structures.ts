import * as pc from "playcanvas";

import {
  BELT,
  beltCover,
  CLEARING_RADIUS,
  FALLS_LAKE,
  fineVariation,
  hash,
  HUB_RADIUS,
  PARK,
  parkTree,
  pathOffset,
  placeAt,
  RENDER_ALBEDO,
  roadAcross,
  ROOF_ALBEDOS,
  smoothstep,
  TERRACE_REACH,
  TERRACES,
  townCell,
  TREES,
  valueNoise,
  villageCell,
  waterEdge,
  woodIndex,
} from "./habitat-land";
import {
  add,
  cross,
  dot,
  type getEnclosureFrame,
  normalize,
  scaled,
  type Vector3,
} from "./island-three";
import { CONIFER_SPECIES, TREE_SPECIES } from "./tree-billboards";
import { FALLS, fallPath, sheetHalfWidth, spillHalfDegrees, veilShape } from "./waterfall";

// Code-built structures that give Island Three height: the end caps'
// terraces, elevator lines, and docks, and the falls bridge; and the
// instanced tree billboards and town buildings, placed where the land shader
// paints them.

type EnclosureFrame = ReturnType<typeof getEnclosureFrame>;
/** Linear albedo, 0–255, and how the frame shader lights it (alpha). */
type Finish = readonly [number, number, number, number];

// Alpha: frames see only the habitat's fill; structures also take sunlight;
// rock also takes granite's streaks and moss; planted ground also varies in
// patches.
const LIT = 128;
const PLANTED = 255;

const albedo = (r: number, g: number, b: number, kind = LIT): Finish => [
  Math.round(r * 255),
  Math.round(g * 255),
  Math.round(b * 255),
  kind,
];
/** A window frame's grey, which sees only the habitat's fill light. */
export const frameShade = (value: number): Finish => [value, value, value, 0];
const SHELF = albedo(0.075, 0.1, 0.042, PLANTED);
const RISER = albedo(0.042, 0.058, 0.03, PLANTED);
const BULKHEAD = albedo(0.1, 0.1, 0.095);
const RENDER = albedo(...RENDER_ALBEDO);
const ROOFS = ROOF_ALBEDOS.map(([r, g, b]) => albedo(r, g, b));
const LIFT_STEEL = albedo(0.2, 0.21, 0.22);
const LIFT_CAR = albedo(0.55, 0.52, 0.47);
const HUB_STEEL = albedo(0.08, 0.09, 0.1);
// The site palette's rust, weathered.
const BRIDGE_RUST = albedo(0.16, 0.048, 0.032);
const CONCRETE = albedo(0.14, 0.135, 0.13);
// Rock in strata, darker where the falls wet it.
const ROCKY = 176;
const ROCK = albedo(0.1, 0.092, 0.08, ROCKY);
const WET_ROCK = albedo(0.045, 0.045, 0.042, ROCKY);
const POOL = albedo(0.02, 0.04, 0.055);
const RETAINING = albedo(0.075, 0.074, 0.066, PLANTED);

const ELEVATOR_OFFSET_DEGREES = -12;
/** Valley 1, whose sunward end is Falls View Park. */
const PARK_VALLEY = PARK.seed - 1;
/**
 * The falls bridge across its lake (metres across the valley and above the
 * floor): towers standing just inside its shores, anchorages beyond, and
 * approaches down to the ground.
 */
export const BRIDGE = {
  anchor: [600, 660],
  deck: 25,
  end: 900,
  halfWidth: 12,
  tower: 400,
  towerTop: 120,
};

/** A main cable's height above the floor, metres across from the lake's centre. */
export function bridgeCableHeight(across: number) {
  const { anchor, deck, tower, towerTop } = BRIDGE;
  const t = Math.abs(across);
  if (t <= tower) return deck + 6 + (towerTop - deck - 6) * (t / tower) ** 2;
  const s = (t - tower) / (anchor[0] - tower);
  return towerTop + (deck + 4 - towerTop) * s - 10 * Math.sin(Math.PI * s);
}
/** How far the course's clearing and its belt of trees reach. */
const BELT_REACH = CLEARING_RADIUS + BELT.inset + BELT.depth;

const sub = (a: Vector3, b: Vector3) => add(a, b, -1);

/** Evenly spaced values from start to end, about `step` apart. */
export function steps(start: number, end: number, step: number) {
  const count = Math.max(1, Math.round(Math.abs(end - start) / step));
  return Array.from({ length: count + 1 }, (_, i) => start + ((end - start) * i) / count);
}

export class MeshBuilder {
  readonly positions: number[] = [];
  readonly normals: number[] = [];
  readonly colors: number[] = [];
  readonly reliefs: number[] = [];
  readonly indices: number[] = [];

  /**
   * A grid of quads over (rows + 1) × (columns + 1) points, marked for
   * relief when the land is displaced. Quads draw in order of `key`, when
   * given, so nearer land can hide what lies behind it.
   */
  grid(
    rows: number,
    columns: number,
    point: (row: number, column: number) => Vector3,
    relief = 0,
    key?: (row: number, column: number) => number,
  ) {
    const start = this.positions.length / 3;
    for (let row = 0; row <= rows; row++) {
      for (let column = 0; column <= columns; column++) {
        const { x, y, z } = point(row, column);
        this.positions.push(x, y, z);
        this.reliefs.push(relief);
      }
    }
    const quads: { a: number; key: number }[] = [];
    for (let row = 0; row < rows; row++) {
      for (let column = 0; column < columns; column++) {
        quads.push({
          a: start + row * (columns + 1) + column,
          key: key ? key(row, column) : 0,
        });
      }
    }
    if (key) quads.sort((p, q) => p.key - q.key);
    quads.forEach(({ a }) => {
      const b = a + columns + 1;
      this.indices.push(a, b, a + 1, a + 1, b, b + 1);
    });
  }

  /** One flat face strip through pairs of points. */
  strip(points: [Vector3, Vector3][], finish: Finish) {
    const start = this.positions.length / 3;
    const normal = normalize(
      cross(sub(points[1]![0], points[0]![0]), sub(points[0]![1], points[0]![0])),
    );
    points.forEach((pair) =>
      pair.forEach(({ x, y, z }) => {
        this.positions.push(x, y, z);
        this.normals.push(normal.x, normal.y, normal.z);
        this.colors.push(...finish);
      }),
    );
    for (let i = 0; i < points.length - 1; i++) {
      const a = start + i * 2;
      this.indices.push(a, a + 1, a + 2, a + 2, a + 1, a + 3);
    }
  }

  /** A flat quad whose normal points to the `facing` side. */
  quad(corners: readonly Vector3[], finish: Finish, facing: Vector3) {
    const [a, b, c, d] = corners as [Vector3, Vector3, Vector3, Vector3];
    const normal = normalize(cross(sub(b, a), sub(d, a)));
    const { x: nx, y: ny, z: nz } = dot(normal, facing) < 0 ? scaled(normal, -1) : normal;
    const start = this.positions.length / 3;
    const [red, green, blue, kind] = finish;
    this.positions.push(a.x, a.y, a.z, b.x, b.y, b.z, c.x, c.y, c.z, d.x, d.y, d.z);
    this.normals.push(nx, ny, nz, nx, ny, nz, nx, ny, nz, nx, ny, nz);
    this.colors.push(red, green, blue, kind, red, green, blue, kind, red, green, blue, kind, red, green, blue, kind);
    this.indices.push(start, start + 1, start + 2, start, start + 2, start + 3);
  }

  /**
   * A box on the segment from `from` to `to`, `width` across and `height`
   * along `up` (made square to the segment).
   */
  beam(from: Vector3, to: Vector3, up: Vector3, width: number, height: number, finish: Finish) {
    const along = normalize(sub(to, from));
    const side = normalize(cross(along, up));
    const lift = cross(side, along);
    const corner = (end: Vector3, s: number, h: number) =>
      add(add(end, side, (s * width) / 2), lift, (h * height) / 2);
    const centre = scaled(add(from, to), 0.5);
    // Four sides along the segment, then the two ends.
    const ring: [number, number][] = [[-1, -1], [1, -1], [1, 1], [-1, 1]];
    for (let i = 0; i < 4; i++) {
      const [s0, h0] = ring[i]!;
      const [s1, h1] = ring[(i + 1) % 4]!;
      const quad = [corner(from, s0, h0), corner(from, s1, h1), corner(to, s1, h1), corner(to, s0, h0)];
      this.quad(quad, finish, sub(scaled(add(quad[0]!, quad[2]!), 0.5), centre));
    }
    [from, to].forEach((end, index) =>
      this.quad(
        ring.map(([s, h]) => corner(end, s, h)),
        finish,
        scaled(along, index === 0 ? -1 : 1),
      ),
    );
  }

  /**
   * The mesh so far. The builder then empties, unless `keep` holds its
   * geometry for more to join.
   */
  build(device: pc.GraphicsDevice, keep = false) {
    // A builder holds grids, with relief, or faces, with normals and
    // colours, not both, so every stream it fills has one entry per vertex.
    const count = this.positions.length / 3;
    if (
      [this.normals.length / 3, this.colors.length / 4, this.reliefs.length].some(
        (length) => length !== 0 && length !== count,
      )
    ) {
      throw new Error("MeshBuilder mixes grids with faces");
    }
    const mesh = new pc.Mesh(device);
    mesh.setPositions(this.positions);
    if (this.normals.length > 0) mesh.setNormals(this.normals);
    if (this.colors.length > 0) mesh.setColors32(this.colors);
    if (this.reliefs.some((relief) => relief > 0)) {
      mesh.setVertexStream(pc.SEMANTIC_ATTR8, this.reliefs, 1);
    }
    mesh.setIndices(this.indices);
    mesh.update(pc.PRIMITIVE_TRIANGLES, false);
    if (!keep) {
      [this.positions, this.normals, this.colors, this.reliefs, this.indices].forEach(
        (stream) => (stream.length = 0),
      );
    }
    return mesh;
  }
}

/** Positions on a cap side: distance in from the cap, radius, and azimuth. */
function capPoints(frame: EnclosureFrame, side: number) {
  const halfLength = frame.definition.length / 2;
  // Tangent is metres spinward.
  const point = (inward: number, radius: number, azimuth: number, tangent = 0) => {
    const at = frame.point(side * (halfLength - inward), azimuth, radius);
    return tangent === 0 ? at : add(at, frame.outward(azimuth + 90), tangent);
  };
  return { inward: scaled(frame.sunward, -side), point };
}

/**
 * The stepped profile of a cap's terraces from the floor to 0.7 R, as
 * (distance in from the cap, radius) points, each with the finish of the
 * segment it ends: per step a retaining wall, a planted slope, and a shelf.
 */
function terraceProfile(radius: number) {
  const { count, depth, rise, run, wall } = TERRACES;
  const profile: { at: [number, number]; finish: Finish }[] = [
    { at: [count * depth, radius], finish: SHELF },
  ];
  for (let k = 0; k < count; k++) {
    const foot = (count - k) * depth;
    const top = radius - (k + 1) * rise;
    profile.push({ at: [foot, radius - k * rise - wall], finish: RETAINING });
    profile.push({ at: [foot - run, top], finish: RISER });
    profile.push({ at: [foot - depth, top], finish: SHELF });
  }
  return profile;
}

/**
 * Terraces climbing each valley's sector of both end caps, with rows of
 * terraced housing on some shelves: soil held up by the cap, whose local
 * "up" points along it toward the axis.
 */
function addTerraces(builder: MeshBuilder, frame: EnclosureFrame) {
  const { radius, valleyCount } = frame.definition;
  const spacing = 360 / valleyCount;
  const profile = terraceProfile(radius);
  // The falls' gorge: a plunge pool a metre above the floor, the cliff, and
  // the terraces above it.
  const cliffTop = profile.findIndex(
    ({ at: [inward, r] }) => inward === FALLS.cliff.in && r === radius - FALLS.cliff.height,
  );
  if (cliffTop < 0) throw new Error("The falls' cliff must meet a terrace's top");
  const gorge = [
    { at: [profile[0]!.at[0], radius - 1] as const, finish: POOL },
    { at: [FALLS.cliff.in, radius - 1] as const, finish: POOL },
    { at: [FALLS.cliff.in, radius - FALLS.cliff.height] as const, finish: ROCK },
    ...profile.slice(cliffTop + 1),
  ];
  [-1, 1].forEach((side) => {
    const { inward, point } = capPoints(frame, side);
    for (let valley = 0; valley < valleyCount; valley++) {
      const centre = valley * spacing;
      const edges = [centre - spacing / 4, centre + spacing / 4];
      const azimuths = steps(edges[0]!, edges[1]!, 2.5);
      const falls = side === 1 && valley === PARK_VALLEY;
      const [gorgeFrom, gorgeTo] = FALLS.gorge.map((offset) => centre + offset) as [number, number];
      const inGorge = (a0: number, a1: number) =>
        falls && (a0 + a1) / 2 > gorgeFrom && (a0 + a1) / 2 < gorgeTo;
      // The cliff is wet behind the falls' upper sheet.
      const spillHalf = spillHalfDegrees(radius);
      const wet = (a0: number, a1: number) =>
        a1 > centre + FALLS.azimuth - spillHalf && a0 < centre + FALLS.azimuth + spillHalf;
      for (let j = 0; j < azimuths.length - 1; j++) {
        const a0 = azimuths[j]!;
        const a1 = azimuths[j + 1]!;
        const up = scaled(frame.outward((a0 + a1) / 2), -1);
        const faces = inGorge(a0, a1) ? gorge : profile;
        for (let i = 0; i < faces.length - 1; i++) {
          const [inA, radiusA] = faces[i]!.at;
          const [inB, radiusB] = faces[i + 1]!.at;
          const finish =
            faces[i + 1]!.finish === ROCK && inGorge(a0, a1) && wet(a0, a1) ? WET_ROCK : faces[i + 1]!.finish;
          builder.quad(
            [point(inA, radiusA, a0), point(inA, radiusA, a1), point(inB, radiusB, a1), point(inB, radiusB, a0)],
            finish,
            finish === SHELF || finish === POOL ? up : add(inward, up),
          );
        }
      }
      if (falls) addGorgeSides(builder, frame, point, profile.slice(0, cliffTop + 1), [gorgeFrom, gorgeTo], centre);
      for (let i = 0; i < profile.length - 1; i++) {
        const [inA, radiusA] = profile[i]!.at;
        const [inB, radiusB] = profile[i + 1]!.at;
        // Bulkheads close the terraces' sides at the windows.
        edges.forEach((edge, e) =>
          builder.quad(
            [point(inA, radiusA, edge), point(inB, radiusB, edge), point(inB, radius, edge), point(inA, radius, edge)],
            BULKHEAD,
            frame.outward(edge + (e === 0 ? -90 : 90)),
          ),
        );
      }
      // Terraced housing along the back of some shelves, clear of the gorge.
      for (let k = 1; k <= TERRACES.count; k++) {
        const shelfRadius = radius - k * TERRACES.rise;
        const back = (TERRACES.count - k) * TERRACES.depth;
        const segment = (400 / shelfRadius) * (180 / Math.PI);
        const segments = Math.floor((spacing / 2) / segment);
        for (let s = 0; s < segments; s++) {
          if (hash(k + side * 17 + valley * 5, s) > 0.3) continue;
          const from = edges[0]! + s * segment + segment * 0.08;
          const to = from + segment * 0.84;
          const cut = k * TERRACES.rise < FALLS.cliff.height;
          if (falls && cut && from < gorgeTo && to > gorgeFrom) {
            continue;
          }
          const roof = ROOFS[Math.floor(hash(s + 3, k + valley) * 3)]!;
          addRow(builder, point, inward, back, shelfRadius, from, to, roof);
        }
      }
    }
  });
}

/**
 * The gorge's rock sides, where it cuts the terraces below its cliff (the
 * profile up to the cliff's top), and the spillway the falls leave, high
 * on the cliff.
 */
function addGorgeSides(
  builder: MeshBuilder,
  frame: EnclosureFrame,
  point: ReturnType<typeof capPoints>["point"],
  cut: ReturnType<typeof terraceProfile>,
  sides: readonly [number, number],
  centre: number,
) {
  const { radius } = frame.definition;
  // The cut terraces are a staircase over the gorge's floor, so a fan from
  // the cliff's foot covers each side.
  sides.forEach((edge, e) => {
    const sign = e === 0 ? -1 : 1;
    const foot = point(FALLS.cliff.in, radius - 1, edge);
    for (let i = 0; i < cut.length - 1; i++) {
      const [inA, radiusA] = cut[i]!.at;
      const [inB, radiusB] = cut[i + 1]!.at;
      const b = point(inB, radiusB, edge);
      builder.quad([foot, point(inA, radiusA, edge), b, b], ROCK, frame.outward(edge - sign * 90));
    }
  });
  const spill = centre + FALLS.azimuth;
  const half = spillHalfDegrees(radius);
  // The spillway: a lip on the cliff, its top where the water leaves.
  const lipIn = FALLS.cliff.in + FALLS.lip / 2;
  builder.beam(
    point(lipIn, radius - FALLS.drop + 3, spill - half - 0.1),
    point(lipIn, radius - FALLS.drop + 3, spill + half + 0.1),
    scaled(frame.outward(spill), -1),
    FALLS.lip,
    6,
    CONCRETE,
  );
}

/** A curved row of terraced houses on a shelf, its back to the next riser. */
function addRow(
  builder: MeshBuilder,
  point: ReturnType<typeof capPoints>["point"],
  inward: Vector3,
  back: number,
  shelfRadius: number,
  from: number,
  to: number,
  roof: Finish,
) {
  const depth = 12;
  const top = shelfRadius - 9;
  const azimuths = steps(from, to, 2.5);
  for (let j = 0; j < azimuths.length - 1; j++) {
    const a0 = azimuths[j]!;
    const a1 = azimuths[j + 1]!;
    builder.quad(
      [point(back, top, a0), point(back, top, a1), point(back + depth, top, a1), point(back + depth, top, a0)],
      roof,
      sub(point(back, top - 1, a0), point(back, top, a0)),
    );
    builder.quad(
      [point(back + depth, top, a0), point(back + depth, top, a1), point(back + depth, shelfRadius, a1), point(back + depth, shelfRadius, a0)],
      RENDER,
      inward,
    );
  }
  [from, to].forEach((end, e) =>
    builder.quad(
      [point(back, top, end), point(back + depth, top, end), point(back + depth, shelfRadius, end), point(back, shelfRadius, end)],
      RENDER,
      sub(point(back, top, end, e === 0 ? -1 : 1), point(back, top, end)),
    ),
  );
}

/**
 * An elevator line up each valley's sector of both caps: an inclined track
 * up the terraces' faces from a station on the floor, then a vertical track
 * up the cap to the axis hub and its docks, each with a few cars.
 */
function addElevators(builder: MeshBuilder, frame: EnclosureFrame) {
  const { radius, valleyCount } = frame.definition;
  const spacing = 360 / valleyCount;
  const { count, depth, rise, run } = TERRACES;
  const top = radius - count * rise;
  // The line runs up the terraces' noses, the tops of their risers.
  const noseIn = (k: number) => (count - k) * depth - run;
  const noseRadius = (k: number) => radius - (k + 1) * rise;
  const slope = (noseRadius(0) - noseRadius(count - 1)) / (noseIn(0) - noseIn(count - 1));
  const footIn = noseIn(0) + (radius - noseRadius(0)) / slope;
  // Unit normal of the incline in (in, radius), away from the terraces.
  const length = Math.hypot(1, slope);
  const normalIn = slope / length;
  const normalRadius = -1 / length;
  const lift = 14;
  [-1, 1].forEach((side) => {
    const { inward, point } = capPoints(frame, side);
    for (let valley = 0; valley < valleyCount; valley++) {
      const azimuth = valley * spacing + ELEVATOR_OFFSET_DEGREES;
      const up = scaled(frame.outward(azimuth), -1);
      const at = (inwardBy: number, r: number) => point(inwardBy, r, azimuth);
      const onIncline = (inwardBy: number, r: number, offset: number) =>
        at(inwardBy + normalIn * offset, r + normalRadius * offset);
      const inclineUp = add(scaled(inward, normalIn), up, -normalRadius);
      builder.beam(
        onIncline(footIn, radius, lift),
        onIncline(noseIn(count - 1), top, lift),
        inclineUp,
        18,
        8,
        LIFT_STEEL,
      );
      for (let k = 0; k < count; k++) {
        builder.beam(
          onIncline(noseIn(k), noseRadius(k), -4),
          onIncline(noseIn(k), noseRadius(k), lift - 4),
          up,
          6,
          6,
          LIFT_STEEL,
        );
      }
      // Stations at the foot and on the top shelf.
      builder.beam(at(footIn + 70, radius - 8), at(footIn - 10, radius - 8), up, 60, 16, CONCRETE);
      builder.beam(at(55, top - 15), at(0, top - 15), up, 70, 30, CONCRETE);
      // The vertical track to the hub, and cars on both tracks.
      builder.beam(at(18, top), at(18, HUB_RADIUS + 20), inward, 18, 10, LIFT_STEEL);
      [0.25, 0.6, 0.85].forEach((t) => {
        const r = top + (HUB_RADIUS + 60 - top) * t;
        builder.beam(at(27, r + 7), at(27, r - 7), inward, 9, 8, LIFT_CAR);
      });
      const carIn = footIn + (noseIn(count - 1) - footIn) * 0.45;
      const carRadius = radius + (top - radius) * 0.45;
      builder.beam(
        onIncline(carIn, carRadius, lift + 8),
        onIncline(carIn, carRadius, lift + 16),
        add(scaled(inward, normalRadius), up, normalIn),
        9,
        14,
        LIFT_CAR,
      );
    }
    addHub(builder, point, inward);
  });
}

/** The hub at the axis, where the elevators meet the docks. */
function addHub(
  builder: MeshBuilder,
  point: ReturnType<typeof capPoints>["point"],
  inward: Vector3,
) {
  const reach = 300;
  const radius = 220;
  const azimuths = steps(0, 360, 20);
  for (let j = 0; j < azimuths.length - 1; j++) {
    const a0 = azimuths[j]!;
    const a1 = azimuths[j + 1]!;
    const mid = (a0 + a1) / 2;
    const outward = sub(point(0, 1, mid), point(0, 0, mid));
    builder.quad(
      [point(0, radius, a0), point(0, radius, a1), point(reach, radius, a1), point(reach, radius, a0)],
      HUB_STEEL,
      outward,
    );
    builder.quad(
      [point(reach, radius, a0), point(reach, radius, a1), point(reach, 0, a1), point(reach, 0, a0)],
      HUB_STEEL,
      inward,
    );
    // A collar where the elevator tracks arrive.
    builder.quad(
      [point(40, HUB_RADIUS + 40, a0), point(40, HUB_RADIUS + 40, a1), point(40, radius, a1), point(40, radius, a0)],
      LIFT_STEEL,
      inward,
    );
    builder.quad(
      [point(0, HUB_RADIUS + 40, a0), point(0, HUB_RADIUS + 40, a1), point(40, HUB_RADIUS + 40, a1), point(40, HUB_RADIUS + 40, a0)],
      LIFT_STEEL,
      outward,
    );
  }
}

/**
 * The falls bridge: a suspension bridge across the lake below the sunward
 * terraces, after Don Davis's 1975 painting of an Island Three end cap. Its
 * deck follows the floor's curve, so it stays level, and its towers point
 * at the axis.
 */
function addBridge(builder: MeshBuilder, frame: EnclosureFrame) {
  const { radius } = frame.definition;
  const valleyCentre = (360 / frame.definition.valleyCount) * PARK_VALLEY;
  const toDegrees = 180 / Math.PI;
  // Across the lake from its centre.
  const azimuthAt = (across: number) => valleyCentre + ((FALLS_LAKE.across + across) / radius) * toDegrees;
  const at = (across: number, height: number, axialOffset = 0) =>
    frame.point(FALLS_LAKE.axial + axialOffset, azimuthAt(across), radius - height);
  const upAt = (across: number) => scaled(frame.outward(azimuthAt(across)), -1);
  const { anchor, deck, end, tower, towerTop, halfWidth } = BRIDGE;
  const deckHeight = (across: number) =>
    Math.abs(across) <= anchor[1]
      ? deck
      : deck - (deck + 2) * ((Math.abs(across) - anchor[1]) / (end - anchor[1]));
  // Deck and approaches, in short straight spans.
  const deckStations = steps(-end, end, 40);
  for (let i = 0; i < deckStations.length - 1; i++) {
    const a = deckStations[i]!;
    const b = deckStations[i + 1]!;
    builder.beam(
      at(a, deckHeight(a) - 2.5),
      at(b, deckHeight(b) - 2.5),
      upAt((a + b) / 2),
      2 * halfWidth,
      5,
      BRIDGE_RUST,
    );
  }
  [-1, 1].forEach((sign) => {
    const towerAcross = sign * tower;
    const up = upAt(towerAcross);
    [-1, 1].forEach((leg) =>
      builder.beam(
        at(towerAcross, -6, leg * (halfWidth + 3)),
        at(towerAcross, towerTop + 4, leg * (halfWidth + 3)),
        frame.sunward,
        7,
        8,
        BRIDGE_RUST,
      ),
    );
    [deck - 6, deck + 60, towerTop - 2].forEach((height) =>
      builder.beam(
        at(towerAcross, height, -halfWidth - 6),
        at(towerAcross, height, halfWidth + 6),
        up,
        6,
        height > deck ? 8 : 6,
        BRIDGE_RUST,
      ),
    );
    builder.beam(
      at(sign * anchor[0], 20, 0),
      at(sign * anchor[1], 20, 0),
      upAt(sign * anchor[0]),
      2 * halfWidth + 16,
      deck + 25,
      CONCRETE,
    );
  });
  // Main cables, and hangers down to the deck.
  const cableStations = [
    ...steps(-anchor[0], -tower, 30),
    ...steps(-tower, tower, 40).slice(1, -1),
    ...steps(tower, anchor[0], 30),
  ];
  [-1, 1].forEach((leg) => {
    const offset = leg * (halfWidth + 1);
    for (let i = 0; i < cableStations.length - 1; i++) {
      const a = cableStations[i]!;
      const b = cableStations[i + 1]!;
      builder.beam(
        at(a, bridgeCableHeight(a), offset),
        at(b, bridgeCableHeight(b), offset),
        upAt((a + b) / 2),
        2.5,
        2.5,
        BRIDGE_RUST,
      );
    }
    steps(-tower, tower, 40)
      .slice(1, -1)
      .forEach((across) =>
        builder.beam(
          at(across, deck, offset),
          at(across, bridgeCableHeight(across), offset),
          frame.sunward,
          1,
          1,
          BRIDGE_RUST,
        ),
      );
  });
}

/** Terraces, elevators and docks, and the falls bridge. */
export function addStructures(builder: MeshBuilder, frame: EnclosureFrame) {
  addTerraces(builder, frame);
  addElevators(builder, frame);
  addBridge(builder, frame);
}

// Instanced trees and buildings: per instance, (axial, across, height,
// seed) and a shape (trees: billboard side, species, unused, shade;
// buildings: half length along the axis, half width across, roof, shade).
const INSTANCE_STRIDE = 8;

/**
 * Real trees within reach of the course, where the land shader paints them:
 * the belt around its clearing, the woods, and single park trees, each a
 * baked species billboard.
 */
export function createTreeInstances(clearing: { axial: number; across: number }, seed: number, valleyHalfWidth: number) {
  const trees: number[] = [];
  const broadleaves = TREE_SPECIES.map((_, index) => index).filter(
    (index) => index !== CONIFER_SPECIES,
  );
  const plant = (
    qx: number,
    qy: number,
    kind: "belt" | "park" | "wood",
  ) => {
    const r = (n: number) => hash(qx * 0.37 + n * 17.1, qy * 0.53 - n * 9.3);
    const conifer = r(1) < (kind === "wood" ? 0.3 : kind === "belt" ? 0.2 : 0.08);
    const species = conifer
      ? CONIFER_SPECIES
      : broadleaves[Math.min(Math.floor(r(3) * broadleaves.length), broadleaves.length - 1)]!;
    const height =
      kind === "belt" ? 12 + 12 * r(2) : kind === "wood" ? 11 + 11 * r(2) : 10 + 8 * r(2);
    const side = height * TREE_SPECIES[species]!.span;
    trees.push(qx, qy, height, r(5), side, species, 0, 0.8 + 0.4 * r(6));
  };
  const clear = (qx: number, qy: number, margin: number) =>
    waterEdge(qx, qy, seed) > 12 + margin &&
    Math.abs(qy - roadAcross(qx, seed)) > 8 + margin &&
    Math.abs(qy) < valleyHalfWidth - 40;

  // The belt, in a jittered 9 m grid.
  const beltCell = 9;
  for (let cx = -BELT_REACH; cx < BELT_REACH; cx += beltCell) {
    for (let cy = -BELT_REACH; cy < BELT_REACH; cy += beltCell) {
      const dx = cx + beltCell * (0.15 + 0.7 * hash(cx + 41, cy));
      const dy = cy + beltCell * (0.15 + 0.7 * hash(cx, cy + 41));
      if (beltCover(dx, dy) < 0.5) continue;
      const qx = clearing.axial + dx;
      const qy = clearing.across + dy;
      if (clear(qx, qy, 6)) plant(qx, qy, "belt");
    }
  }

  const inReach = (qx: number, qy: number) => {
    const dx = qx - clearing.axial;
    const dy = qy - clearing.across;
    const distance = Math.sqrt(dx * dx + dy * dy);
    return (
      distance > CLEARING_RADIUS + 20 &&
      distance < TREES.radius &&
      beltCover(dx, dy) < 0.5 &&
      // Thinning toward the edge of reach, where the canopy rises instead.
      hash(qx * 0.11, qy * 0.13) <
        1 - 0.6 * smoothstep(TREES.canopyFrom, TREES.radius, distance)
    );
  };
  const unbuilt = (qx: number, qy: number) =>
    placeAt(qx, qy, seed, fineVariation(qx, qy, seed))[0] > 0 &&
    Math.abs(pathOffset(qx, qy, seed)) > 3;

  // Woods, in a jittered 12 m grid, where the shader paints them.
  const woodCell = 12;
  const from = (value: number, cell: number) => Math.floor((value - TREES.radius) / cell) * cell;
  for (let cx = from(clearing.axial, woodCell); cx < clearing.axial + TREES.radius; cx += woodCell) {
    for (let cy = from(clearing.across, woodCell); cy < clearing.across + TREES.radius; cy += woodCell) {
      const qx = cx + woodCell * (0.15 + 0.7 * hash(cx + 7, cy + 3));
      const qy = cy + woodCell * (0.15 + 0.7 * hash(cx + 3, cy + 7));
      if (woodIndex(qx, qy, seed) < 0.925 || !inReach(qx, qy)) continue;
      if (clear(qx, qy, 0) && unbuilt(qx, qy)) plant(qx, qy, "wood");
    }
  }

  // Single trees across the parkland, on the shader's 30 m cells.
  for (let cx = Math.floor((clearing.axial - TREES.radius) / 30); cx * 30 < clearing.axial + TREES.radius; cx++) {
    for (let cy = Math.floor((clearing.across - TREES.radius) / 30); cy * 30 < clearing.across + TREES.radius; cy++) {
      const tree = parkTree(cx, cy, seed);
      if (!tree || tree.wood > 0.9) continue;
      const [qx, qy] = tree.at;
      if (inReach(qx, qy) && clear(qx, qy, 0) && unbuilt(qx, qy)) plant(qx, qy, "park");
    }
  }
  return new Float32Array(trees);
}

/**
 * Buildings of three to five storeys on the lots of the denser town and
 * village centres in a valley, where the land shader paints their roofs,
 * clear of the course's clearing and its belt of trees.
 */
export function createBuildingInstances(
  clearing: { axial: number; across: number },
  seed: number,
  halfLength: number,
) {
  const buildings: number[] = [];
  const lot = 30;
  const cells = Array.from(
    { length: Math.floor(halfLength / 2600) * 2 + 2 },
    (_, i) => i + Math.floor(-halfLength / 2600),
  );
  const centres = [
    ...cells.map((k) => ({ ...townCell((k + 0.5) * 2600, seed), road: true })),
    ...cells.map((k) => ({ ...villageCell(k * 2600, seed), road: false })),
  ].filter((settlement) => settlement.radius > 0);
  centres.forEach(({ centre, radius, road }) => {
    // Cores lie within about 0.4 of a settlement's radius; a town's centre
    // follows its road.
    const reach = radius * 0.5;
    const offset = road ? centre[1] - roadAcross(centre[0], seed) : 0;
    for (let lx = Math.floor((centre[0] - reach) / lot); lx * lot < centre[0] + reach; lx++) {
      const across = road ? roadAcross((lx + 0.5) * lot, seed) + offset : centre[1];
      for (let ly = Math.floor((across - reach) / lot); ly * lot < across + reach; ly++) {
        const cx = (lx + 0.5) * lot;
        const cy = (ly + 0.5) * lot;
        const place = placeAt(cx, cy, seed, fineVariation(cx, cy, seed));
        const density = Math.min(Math.max(place[1], 0), 1);
        if (place[0] > -10 || density < 0.62) continue;
        // Town centres: the shader's straight-street core at every corner.
        const core = (x: number, y: number) =>
          Math.min(Math.max(placeAt(x, y, seed, fineVariation(x, y, seed))[1], 0), 1) +
            0.2 * (valueNoise(x / 50, y / 50) - 0.5) >=
          0.6;
        if (![[0, 0], [-1, -1], [1, -1], [1, 1], [-1, 1]].every(([sx, sy]) => core(cx + sx! * 14, cy + sy! * 14))) continue;
        if (hash(lx + 11, ly + 11) > 0.4 + 0.55 * density) continue;
        const sizeScale = 0.8 + 0.3 * hash(lx + 5, ly + 5);
        const half = [lot * (0.2 + 0.2 * density) * sizeScale, lot * (0.17 + 0.19 * density) * sizeScale];
        const offset = [
          (hash(lx + 7, ly + 7) - 0.5) * Math.max(lot - 2 * half[0]! - 4, 0),
          (hash(lx + 8, ly + 8) - 0.5) * Math.max(lot - 2 * half[1]! - 4, 0),
        ];
        const qx = cx + offset[0]!;
        const qy = cy + offset[1]!;
        // None under the end caps' terraces.
        if (Math.abs(qx) > halfLength - TERRACE_REACH - 50) continue;
        const extent = Math.max(half[0]!, half[1]!);
        if (Math.hypot(qx - clearing.axial, qy - clearing.across) < BELT_REACH + extent) continue;
        if (waterEdge(qx, qy, seed) < extent + 10) continue;
        if (Math.abs(qy - roadAcross(qx, seed)) < extent + 8) continue;
        const kind = hash(lx + seed, ly + seed);
        const roof = kind < 0.2 ? 0 : kind < 0.75 ? 1 : 2;
        const storeys = 3 + Math.floor(2 * hash(lx + 13, ly + 13)) + (density > 0.8 ? 1 : 0);
        buildings.push(qx, qy, storeys * 3.3 + 1.2, hash(lx + 17, ly + 17), half[0]!, half[1]!, roof, 0.85 + 0.3 * hash(lx + 19, ly + 19));
      }
    }
  });
  return new Float32Array(buildings);
}

/** A billboard for instancing: x from −1 to 1 across, y from 0 to 1 up. */
export function createBillboardMesh(device: pc.GraphicsDevice) {
  const positions = [-1, 0, 0, 0, 1, 0, 0, 0, 1, 1, 0, 0, -1, 1, 0, 0];
  return instancedMesh(device, positions, new Array(12).fill(0), [0, 1, 2, 0, 2, 3]);
}

/** A unit box for instancing: x and z from −1 to 1, y from 0 to 1, no floor. */
export function createBoxMesh(device: pc.GraphicsDevice) {
  const positions: number[] = [];
  const normals: number[] = [];
  const indices: number[] = [];
  const face = (corners: number[][], normal: number[], part: number) => {
    const start = positions.length / 4;
    corners.forEach((corner) => {
      positions.push(corner[0]!, corner[1]!, corner[2]!, part);
      normals.push(...normal);
    });
    indices.push(start, start + 1, start + 2, start, start + 2, start + 3);
  };
  const walls = 2;
  const roof = 3;
  face([[-1, 1, -1], [1, 1, -1], [1, 1, 1], [-1, 1, 1]], [0, 1, 0], roof);
  face([[-1, 0, -1], [1, 0, -1], [1, 1, -1], [-1, 1, -1]], [0, 0, -1], walls);
  face([[-1, 0, 1], [1, 0, 1], [1, 1, 1], [-1, 1, 1]], [0, 0, 1], walls);
  face([[-1, 0, -1], [-1, 0, 1], [-1, 1, 1], [-1, 1, -1]], [-1, 0, 0], walls);
  face([[1, 0, -1], [1, 0, 1], [1, 1, 1], [1, 1, -1]], [1, 0, 0], walls);
  return instancedMesh(device, positions, normals, indices);
}

function instancedMesh(device: pc.GraphicsDevice, positions: number[], normals: number[], indices: number[]) {
  const mesh = new pc.Mesh(device);
  mesh.setVertexStream(pc.SEMANTIC_POSITION, positions, 4);
  mesh.setNormals(normals);
  mesh.setIndices(indices);
  mesh.update(pc.PRIMITIVE_TRIANGLES, false);
  return mesh;
}

/** Per-instance data for a mesh instance drawn with hardware instancing. */
export function createInstanceBuffer(device: pc.GraphicsDevice, data: Float32Array) {
  const format = new pc.VertexFormat(device, [
    { components: 4, semantic: pc.SEMANTIC_ATTR12, type: pc.TYPE_FLOAT32 },
    { components: 4, semantic: pc.SEMANTIC_ATTR13, type: pc.TYPE_FLOAT32 },
  ]);
  return new pc.VertexBuffer(device, format, data.length / INSTANCE_STRIDE, {
    data: data.buffer as ArrayBuffer,
  });
}

/**
 * The falls: three layered sheets along the fall path, spray veils off
 * their edges, and spray puffs that billow where they land. Per vertex,
 * flow is (x across from −1 to 1, y seconds of fall, kind, seed) for sheets
 * (kind 0) and veils (1); a puff's vertices sit at its centre with (corner
 * x and y, 2, size), and turn to face the camera.
 */
export function createWaterfallMesh(device: pc.GraphicsDevice, frame: EnclosureFrame, valleyCentre: number) {
  const { length, radius } = frame.definition;
  const at = (inward: number, azimuth: number, height: number) =>
    frame.point(length / 2 - inward, valleyCentre + azimuth, radius - height);
  const path = fallPath(radius, FALLS.drop, FALLS.outflow, 48);
  const landing = path[path.length - 1]!;
  const positions: number[] = [];
  const flow: number[] = [];
  const indices: number[] = [];
  const vertex = (point: Vector3, x: number, y: number, kind: number, w: number) => {
    positions.push(point.x, point.y, point.z);
    flow.push(x, y, kind, w);
    return positions.length / 3 - 1;
  };
  const ribbon = (
    kind: number,
    seed: number,
    shape: (time: number) => { half: number; offset: number; out: number },
  ) => {
    const start = positions.length / 3;
    path.forEach(({ out, radius: r, time, turn }, i) => {
      const { half, offset, out: extra } = shape(time);
      const centre = FALLS.azimuth + turn * (180 / Math.PI) + (offset / r) * (180 / Math.PI);
      [-1, 1].forEach((side) =>
        vertex(
          at(FALLS.cliff.in + FALLS.lip + out + extra, centre + ((side * half) / r) * (180 / Math.PI), radius - r),
          side,
          time,
          kind,
          seed,
        ),
      );
      if (i > 0) {
        const a = start + (i - 1) * 2;
        indices.push(a, a + 1, a + 2, a + 1, a + 3, a + 2);
      }
    });
  };
  // Sheets, the nearest narrowest, a few metres apart.
  [0, 1, 2].forEach((layer) =>
    ribbon(0, layer, (time) => ({
      half: sheetHalfWidth(time, landing.time) * (1 - 0.15 * layer),
      offset: 0,
      out: 5 * layer,
    })),
  );
  // Veils trail off each edge, spreading out and away as they fall.
  ([-1, 1] as const).forEach((side) => ribbon(1, side + 3, (time) => veilShape(side, time, landing.time)));
  // Spray billowing up from the plunge pool, above the trees and walls.
  const foot = {
    azimuth: FALLS.azimuth + landing.turn * (180 / Math.PI),
    in: FALLS.cliff.in + FALLS.lip + landing.out,
  };
  const puffs: [number, number, number, number][] = [
    // across, out, height, size (metres)
    [0, 10, 70, 110],
    [-90, 30, 60, 90],
    [95, 25, 65, 95],
    [-30, 60, 140, 170],
    [40, 45, 170, 200],
    [0, 90, 260, 240],
  ];
  puffs.forEach(([across, out, height, size]) => {
    const centre = at(foot.in + out, foot.azimuth + (across / radius) * (180 / Math.PI), height);
    const start = positions.length / 3;
    [-1, 1].forEach((y) => [-1, 1].forEach((x) => vertex(centre, x, y, 2, size)));
    indices.push(start, start + 1, start + 3, start, start + 3, start + 2);
  });
  const mesh = new pc.Mesh(device);
  mesh.setPositions(positions);
  mesh.setVertexStream(pc.SEMANTIC_ATTR9, flow, 4);
  mesh.setIndices(indices);
  mesh.update(pc.PRIMITIVE_TRIANGLES, false);
  return {
    fallTime: landing.time,
    mesh,
    up: scaled(frame.outward(valleyCentre + foot.azimuth), -1),
  };
}

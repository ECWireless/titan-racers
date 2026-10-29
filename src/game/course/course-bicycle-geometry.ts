// Two bicycles left on the levee, built at real size in metres: the bikes
// the park's youth rode there before racing their RC karts. Variant 0 is a
// teenager's 27.5" hardtail leaning nearly upright on the crest's handrail;
// variant 1 is a 20" BMX laid over against the crest wall, its grip on the
// wall's top. Each rests in a precomputed pose (REST), both tyres on the
// ground, leaning left onto what the course stands it against.
//
// Local frame: Y up, ground at y = 0, the bike's length along +X (front wheel
// toward +X), its right (drive) side toward +Z, and the origin on the ground
// between its tyre contacts.
//
// Two finish groups, so a bike draws in two calls:
// - dielectric: paint, powder coat, anodizing, rubber, plastic, saddle and
//   grips. Assumes metalness 0, roughness about 0.6 (matte coat and rubber).
//   Anodized colour lives in the dyed oxide, which scatters like a coat, so
//   black and orange anodized alloy draw here.
// - metal: bare steel and alloy (chain, cassette, spokes, rotors,
//   stanchions, bright rims and bars). Assumes metalness 1, roughness about
//   0.35 (bead-blasted alloy and brushed steel); its colour is the metal's
//   reflectance.
// Colours are linear albedo within real reflectance (4% to 85%).
//
// Thin parts and distance: spokes are flat-shaded 3-sided prisms about
// 2.2 mm across (real 2.0 mm), the chain a flat-shaded box section and the
// housing a 4-sided band, both at real size. Flat faces keep each stroke one
// shade along its length, so under MSAA a thin part fades to a faint even
// line with distance instead of breaking into dashed highlights.
// Everything here is plain geometry; the course draws it.
import type { TreeMeshData } from "./course-tree-geometry";

type Vec3 = [number, number, number];
type Colour = [number, number, number];
type Radius = number | [number, number];

const DEG = Math.PI / 180;

export const BICYCLE_VARIANTS = 2;

/** Each variant's real dimensions, in metres and degrees. */
export const BICYCLE = [
  {
    name: "hardtail",
    wheel: {
      // 27.5 x 2.25" tyre on a 584 mm bead seat (ISO 5775 / ETRTO 57-584).
      bsd: 0.584,
      tyreWidth: 0.057,
      tyreHeight: 0.052,
      // 25 mm outer-width double-wall rim, 32 spokes laced three-cross.
      rimWidth: 0.025,
      spokes: 32,
    },
    // Teen size S hardtail (Trek Marlin and Specialized Rockhopper S class):
    // 430 mm chainstays, 60 mm BB drop, 69° head, 73° seat, 570 mm top tube,
    // which put the wheelbase at about 1.06 m and reach at about 0.39 m.
    chainstay: 0.43,
    bbDrop: 0.06,
    headAngle: 69,
    seatAngle: 73,
    topTube: 0.57,
    headTube: 0.1,
    seatTube: 0.38,
    // 100 mm travel 27.5" fork: 480 mm axle-to-crown, 42 mm offset.
    fork: { axleToCrown: 0.48, offset: 0.042, stack: 0.015 },
    // 135 mm QR rear and 100 mm front hub spacing.
    hubs: { front: 0.1, rear: 0.135 },
    // 170 mm cranks, 32T ring, chain on the 21T of an 11-34 eight-speed.
    crank: 0.17,
    chainring: 32,
    cog: 21,
    // BB to saddle top: 0.885 x a 0.75 m inseam (a 160 cm teen).
    saddleHeight: 0.66,
    // 720 mm riser bar, 20 mm rise, on a 60 mm +6° stem: grips about 0.96 m up.
    bar: { rise: 0.02, stem: 0.06, stemAngle: 6, width: 0.72 },
    // Leaning 12.5° onto a handrail post with its saddle, the brake housing
    // on its left fork leg against the rail below, so the bars stay
    // straight; the centre-mount kickstand folded up.
  },
  {
    name: "bmx",
    wheel: {
      // 20 x 2.3" tyre on a 406 mm bead seat (ISO 5775 / ETRTO 58-406).
      bsd: 0.406,
      tyreWidth: 0.058,
      tyreHeight: 0.053,
      // 30 mm double-wall rim, 36 spokes laced three-cross (BMX standard).
      rimWidth: 0.03,
      spokes: 36,
    },
    // 20.5" (521 mm) top tube freestyle frame: 13" (330 mm) chainstays,
    // 11.6" (295 mm) BB height, 75° head, 71° seat, 120 mm head tube; the
    // wheelbase comes out at about 0.86 m.
    chainstay: 0.33,
    bbDrop: -0.039,
    headAngle: 75,
    seatAngle: 71,
    topTube: 0.521,
    headTube: 0.12,
    seatTube: 0.229,
    // Rigid fork: 320 mm axle-to-crown, 28 mm offset, integrated headset.
    fork: { axleToCrown: 0.32, offset: 0.028, stack: 0.005 },
    // 110 mm rear and 100 mm front hubs on 14 mm and 3/8" axles.
    hubs: { front: 0.1, rear: 0.11 },
    // 175 mm three-piece cranks, 25T sprocket on a 9T driver.
    crank: 0.175,
    chainring: 25,
    cog: 9,
    // A low, nose-up seat on a short pivotal post.
    saddleHeight: 0.4,
    // 29" (737 mm) wide, 8.75" (222 mm) rise two-piece bars on a top-load stem.
    bar: { rise: 0.222, stem: 0.045, stemAngle: 0, width: 0.737 },
    // Laid over 39.3° to its left against a 0.5 m wall, tyres 0.62 m out,
    // the bars flopped 35° into the lean until the left grip rests on the
    // wall's top, cranks upright.
  },
] as const;

type BicycleSpec = (typeof BICYCLE)[number];

// Colours: site palette hex in linear light, lightness held to 4–85%.
function paint(hex: string): Colour {
  const value = parseInt(hex.slice(1), 16);
  const linear = [16, 8, 0].map((shift) => {
    const c = ((value >> shift) & 255) / 255;
    return c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
  }) as Colour;
  const lightness =
    0.2126 * linear[0] + 0.7152 * linear[1] + 0.0722 * linear[2];
  const k = Math.min(1, Math.max(0.04, Math.min(0.85, lightness)) / lightness);
  return linear.map((c) => Math.min(1, c * k)) as Colour;
}
const grey = (value: number): Colour => [value, value, value];

const COLOUR = {
  // Matte powder coats from the palette: Rust for the hardtail, Muted for
  // the BMX, with an Ice down-tube logo band and an Orange anodized sprocket.
  rust: paint("#bd482d"),
  muted: paint("#b8afa1"),
  ice: paint("#f7f2e8"),
  orange: paint("#ff7a18"),
  // Coated hardware and rubber.
  black: grey(0.04),
  rubber: grey(0.035),
  plastic: grey(0.05),
  tread: grey(0.045),
  gumwall: paint("#9a6a40"),
  // Metal reflectance: alloy, stainless, chrome, and oily chain steel.
  alloy: [0.8, 0.8, 0.81] as Colour,
  stainless: [0.56, 0.56, 0.57] as Colour,
  chrome: [0.62, 0.63, 0.64] as Colour,
  chain: grey(0.36),
};

const add = (a: Vec3, b: Vec3): Vec3 => [a[0] + b[0], a[1] + b[1], a[2] + b[2]];
const sub = (a: Vec3, b: Vec3): Vec3 => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
const scale = (a: Vec3, s: number): Vec3 => [a[0] * s, a[1] * s, a[2] * s];
const dot = (a: Vec3, b: Vec3) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const cross = (a: Vec3, b: Vec3): Vec3 => [
  a[1] * b[2] - a[2] * b[1],
  a[2] * b[0] - a[0] * b[2],
  a[0] * b[1] - a[1] * b[0],
];
const normalize = (a: Vec3): Vec3 => scale(a, 1 / Math.hypot(...a));
const lerp = (a: Vec3, b: Vec3, t: number) => add(a, scale(sub(b, a), t));
const along = (point: Vec3, direction: Vec3, distance: number) =>
  add(point, scale(direction, distance));

// Rotates v about a unit axis through the origin (Rodrigues).
function rotate(v: Vec3, axis: Vec3, angle: number): Vec3 {
  const c = Math.cos(angle);
  const s = Math.sin(angle);
  return add(
    add(scale(v, c), scale(cross(axis, v), s)),
    scale(axis, dot(axis, v) * (1 - c)),
  );
}

const AXES: [Vec3, Vec3, Vec3] = [
  [1, 0, 0],
  [0, 1, 0],
  [0, 0, 1],
];

// A right-handed basis whose first axis is x, second near yHint.
function basis(x: Vec3, yHint: Vec3): [Vec3, Vec3, Vec3] {
  const z = normalize(cross(x, yHint));
  return [x, cross(z, x), z];
}

// --- The draft: one vertex list, each vertex tagged with its finish and
// whether it turns with the handlebars.

type Style = {
  colour: Colour;
  metal: boolean;
  steered: boolean;
  tag: string;
};

type Draft = {
  indices: number[];
  normals: Vec3[];
  positions: Vec3[];
  style: Style;
  styles: Style[];
};

function setStyle(draft: Draft, patch: Partial<Style>) {
  draft.style = { ...draft.style, ...patch };
}

function vertex(draft: Draft, position: Vec3, normal: Vec3, colour?: Colour) {
  draft.positions.push(position);
  draft.normals.push(normalize(normal));
  draft.styles.push(colour ? { ...draft.style, colour } : draft.style);
  return draft.positions.length - 1;
}

// --- Primitives.

// A tube through points, each ring perpendicular to the path and carried
// along it without twisting. Radii may be [across u, across v] ellipses;
// `u` aims the first ring's u axis. A flat tube has one normal per face, its
// faces square to u and v, so a thin one shades evenly along its length
// rather than as a sub-pixel highlight that breaks into dashes.
function tube(
  draft: Draft,
  path: Vec3[],
  radius: Radius | Radius[],
  sides: number,
  options: {
    caps?: boolean;
    closed?: boolean;
    colours?: Colour[];
    flat?: boolean;
    u?: Vec3;
  } = {},
) {
  const { caps = false, closed = false, flat = false } = options;
  const count = path.length;
  const first = draft.positions.length;
  const axes = path.map((_, ring) => {
    const next = closed
      ? path[(ring + 1) % count]!
      : path[Math.min(ring + 1, count - 1)]!;
    const previous = closed
      ? path[(ring - 1 + count) % count]!
      : path[Math.max(ring - 1, 0)]!;
    return normalize(sub(next, previous));
  });
  const reject = (v: Vec3, axis: Vec3) => sub(v, scale(axis, dot(v, axis)));
  const hint =
    options.u ?? (Math.abs(axes[0]![1]) > 0.9 ? [0, 0, 1] : [0, 1, 0]);
  let u = normalize(
    options.u ? reject(hint, axes[0]!) : cross(axes[0]!, hint as Vec3),
  );
  const frames: Array<[Vec3, Vec3]> = [];
  axes.forEach((axis) => {
    u = normalize(reject(u, axis));
    frames.push([u, cross(axis, u)]);
  });
  const rings = closed ? count : count - 1;
  if (flat) {
    const corners = path.map((point, ring) => {
      const [ru, rv] = toPair(pick(radius, ring, count));
      const [fu, fv] = frames[ring]!;
      return Array.from({ length: sides }, (_, side) => {
        const angle = ((side + 0.5) / sides) * Math.PI * 2;
        return add(
          point,
          add(scale(fu, ru * Math.cos(angle)), scale(fv, rv * Math.sin(angle))),
        );
      });
    });
    for (let ring = 0; ring < rings; ring++) {
      const [a, b] = [corners[ring]!, corners[(ring + 1) % count]!];
      for (let side = 0; side < sides; side++) {
        const next = (side + 1) % sides;
        quad(draft, [a[side]!, a[next]!, b[next]!, b[side]!]);
      }
    }
    return;
  }
  path.forEach((point, ring) => {
    const [ru, rv] = toPair(pick(radius, ring, count));
    const [fu, fv] = frames[ring]!;
    for (let side = 0; side < sides; side++) {
      const angle = (side / sides) * Math.PI * 2;
      const c = Math.cos(angle);
      const s = Math.sin(angle);
      vertex(
        draft,
        add(point, add(scale(fu, ru * c), scale(fv, rv * s))),
        add(scale(fu, rv * c), scale(fv, ru * s)),
        options.colours?.[ring],
      );
    }
  });
  for (let ring = 0; ring < rings; ring++) {
    const next = (ring + 1) % count;
    for (let side = 0; side < sides; side++) {
      const a = first + ring * sides + side;
      const b = first + ring * sides + ((side + 1) % sides);
      const c = first + next * sides + side;
      const d = first + next * sides + ((side + 1) % sides);
      draft.indices.push(a, b, c, b, d, c);
    }
  }
  if (!caps || closed) return;
  [0, count - 1].forEach((ring) => {
    const normal = scale(axes[ring]!, ring === 0 ? -1 : 1);
    const colour = options.colours?.[ring];
    const centre = vertex(draft, path[ring]!, normal, colour);
    const start = draft.positions.length;
    for (let side = 0; side < sides; side++) {
      vertex(
        draft,
        draft.positions[first + ring * sides + side]!,
        normal,
        colour,
      );
    }
    for (let side = 0; side < sides; side++) {
      const a = start + side;
      const b = start + ((side + 1) % sides);
      if (ring === 0) draft.indices.push(centre, b, a);
      else draft.indices.push(centre, a, b);
    }
  });
}

// A tube's radius at a ring: one radius for all, or one per ring.
function pick(radius: Radius | Radius[], ring: number, count: number): Radius {
  if (typeof radius === "number") return radius;
  if (Array.isArray(radius[0])) return (radius as Radius[])[ring]!;
  // A plain number pair is an ellipse unless it lists one radius per ring.
  return radius.length === count && count !== 2
    ? (radius as number[])[ring]!
    : (radius as [number, number]);
}
const toPair = (r: Radius): [number, number] =>
  typeof r === "number" ? [r, r] : r;

// A solid of revolution about an axis through centre. Each polyline is a
// smooth run of [radius, height along the axis] points; its outside lies to
// the right of its direction in the (radius, height) plane. Points may
// carry their own colour.
function revolve(
  draft: Draft,
  centre: Vec3,
  axis: Vec3,
  polylines: Array<Array<[number, number] | [number, number, Colour]>>,
  segments: number,
  phase = 0,
) {
  const u = normalize(
    cross(axis, Math.abs(axis[1]) > 0.9 ? [1, 0, 0] : [0, 1, 0]),
  );
  const v = cross(axis, u);
  polylines.forEach((points) => {
    const n = points.length;
    const loop =
      Math.hypot(
        points[0]![0] - points[n - 1]![0],
        points[0]![1] - points[n - 1]![1],
      ) < 1e-9;
    const first = draft.positions.length;
    points.forEach((point, index) => {
      const next =
        points[loop && index === n - 1 ? 1 : Math.min(index + 1, n - 1)]!;
      const previous =
        points[loop && index === 0 ? n - 2 : Math.max(index - 1, 0)]!;
      const dr = next[0] - previous[0];
      const dh = next[1] - previous[1];
      const length = Math.hypot(dr, dh);
      const [nr, nh] = [dh / length, -dr / length];
      for (let segment = 0; segment < segments; segment++) {
        const angle = phase + (segment / segments) * Math.PI * 2;
        const radial = add(
          scale(u, Math.cos(angle)),
          scale(v, Math.sin(angle)),
        );
        vertex(
          draft,
          add(centre, add(scale(radial, point[0]), scale(axis, point[1]))),
          add(scale(radial, nr), scale(axis, nh)),
          point[2],
        );
      }
    });
    for (let index = 0; index < n - 1; index++) {
      for (let segment = 0; segment < segments; segment++) {
        const a = first + index * segments + segment;
        const b = first + index * segments + ((segment + 1) % segments);
        const c = a + segments;
        const d = b + segments;
        draft.indices.push(a, b, c, b, d, c);
      }
    }
  });
}

// A closed cylinder (or disc) about an axis, flat-shaded at its rims.
function cylinder(
  draft: Draft,
  centre: Vec3,
  axis: Vec3,
  radius: number,
  from: number,
  to: number,
  segments: number,
  inner = radius * 0.3,
) {
  revolve(
    draft,
    centre,
    axis,
    [
      [
        [inner, from],
        [radius, from],
      ],
      [
        [radius, from],
        [radius, to],
      ],
      [
        [radius, to],
        [inner, to],
      ],
    ],
    segments,
  );
}

// A flat-shaded quad, corners in order around its face.
function quad(draft: Draft, corners: [Vec3, Vec3, Vec3, Vec3]) {
  const normal = cross(
    sub(corners[1], corners[0]),
    sub(corners[3], corners[0]),
  );
  const [a, b, c, d] = corners.map((corner) => vertex(draft, corner, normal));
  draft.indices.push(a!, b!, c!, a!, c!, d!);
}

// A box on a right-handed set of unit axes.
function box(draft: Draft, centre: Vec3, axes: [Vec3, Vec3, Vec3], half: Vec3) {
  for (let k = 0; k < 3; k++) {
    for (const sign of [1, -1]) {
      const n = scale(axes[k]!, sign * half[k]!);
      let s = scale(axes[(k + 1) % 3]!, half[(k + 1) % 3]!);
      let t = scale(axes[(k + 2) % 3]!, half[(k + 2) % 3]!);
      if (sign < 0) [s, t] = [t, s];
      const face = add(centre, n);
      quad(draft, [
        sub(sub(face, s), t),
        sub(add(face, s), t),
        add(add(face, s), t),
        add(sub(face, s), t),
      ]);
    }
  }
}

// A box spanning two points, `width` across in the direction of `side`.
function bar(
  draft: Draft,
  from: Vec3,
  to: Vec3,
  side: Vec3,
  width: number,
  thickness: number,
) {
  const x = normalize(sub(to, from));
  const axes = basis(x, side);
  box(
    draft,
    lerp(from, to, 0.5),
    [axes[0], axes[1], axes[2]],
    [Math.hypot(...sub(to, from)) / 2, width / 2, thickness / 2],
  );
}

// A flat toothed ring about the bike's lateral axis: sprocket or chainring.
function sprocket(
  draft: Draft,
  centre: Vec3,
  teeth: number,
  pitchRadius: number,
  innerRadius: number,
  thickness: number,
) {
  const axis: Vec3 = [0, 0, 1];
  const count = teeth * 2;
  const point = (index: number, radius: number, h: number): Vec3 => {
    const angle = (index / count) * Math.PI * 2;
    return add(centre, [radius * Math.cos(angle), radius * Math.sin(angle), h]);
  };
  const outer = (index: number) =>
    index % 2 === 0 ? pitchRadius + 0.0035 : pitchRadius - 0.004;
  [1, -1].forEach((sign) => {
    const h = (sign * thickness) / 2;
    const first = draft.positions.length;
    for (let index = 0; index < count; index++) {
      vertex(draft, point(index, outer(index), h), scale(axis, sign));
      vertex(draft, point(index, innerRadius, h), scale(axis, sign));
    }
    for (let index = 0; index < count; index++) {
      const a = first + index * 2;
      const b = first + ((index + 1) % count) * 2;
      // Outer to inner faces +axis; the back face winds the other way.
      if (sign > 0) draft.indices.push(a, b, a + 1, b, b + 1, a + 1);
      else draft.indices.push(a, a + 1, b, b, a + 1, b + 1);
    }
  });
  for (let index = 0; index < count; index++) {
    const next = (index + 1) % count;
    quad(draft, [
      point(index, outer(index), -thickness / 2),
      point(next, outer(next), -thickness / 2),
      point(next, outer(next), thickness / 2),
      point(index, outer(index), thickness / 2),
    ]);
  }
}

// Points along a Catmull-Rom curve through the given points.
function spline(points: Vec3[], perSegment: number) {
  const result: Vec3[] = [];
  for (let i = 0; i < points.length - 1; i++) {
    const p0 = points[Math.max(i - 1, 0)]!;
    const p1 = points[i]!;
    const p2 = points[i + 1]!;
    const p3 = points[Math.min(i + 2, points.length - 1)]!;
    for (let step = 0; step < perSegment; step++) {
      const t = step / perSegment;
      const t2 = t * t;
      const t3 = t2 * t;
      result.push(
        [0, 1, 2].map(
          (k) =>
            0.5 *
            (2 * p1[k]! +
              (-p0[k]! + p2[k]!) * t +
              (2 * p0[k]! - 5 * p1[k]! + 4 * p2[k]! - p3[k]!) * t2 +
              (-p0[k]! + 3 * p1[k]! - 3 * p2[k]! + p3[k]!) * t3),
        ) as Vec3,
      );
    }
  }
  result.push(points[points.length - 1]!);
  return result;
}

// A 1/2" pitch chain's plates, 7.3 mm wide and 7.5 mm tall: the corners of
// its flat box section.
const CHAIN_SECTION: [number, number] = [
  0.00365 * Math.SQRT2,
  0.00375 * Math.SQRT2,
];

// --- The chain: a closed loop round pulleys in the bike's plane, each
// wrapped counter-clockwise (seen from the drive side) or clockwise.
type Pulley = { centre: Vec3; ccw: boolean; radius: number };

function chainPath(pulleys: Pulley[]) {
  const count = pulleys.length;
  const exits: Vec3[] = [];
  const entries: Vec3[] = [];
  pulleys.forEach((a, index) => {
    const b = pulleys[(index + 1) % count]!;
    // The tangent leaving a and reaching b: each centre lies to the left of
    // the chain's travel when wrapped counter-clockwise, to the right if not.
    const r1 = a.ccw ? a.radius : -a.radius;
    const r2 = b.ccw ? b.radius : -b.radius;
    const dx = b.centre[0] - a.centre[0];
    const dy = b.centre[1] - a.centre[1];
    const k = r2 - r1;
    const m = Math.sqrt(dx * dx + dy * dy - k * k);
    const angle = Math.atan2(dy, dx) - Math.atan2(k, m);
    const left: Vec3 = [-Math.sin(angle), Math.cos(angle), 0];
    exits[index] = sub(a.centre, scale(left, r1));
    entries[(index + 1) % count] = sub(b.centre, scale(left, r2));
  });
  const path: Vec3[] = [];
  pulleys.forEach((pulley, index) => {
    const angleOf = (p: Vec3) =>
      Math.atan2(p[1] - pulley.centre[1], p[0] - pulley.centre[0]);
    const start = angleOf(entries[index]!);
    let sweep = angleOf(exits[index]!) - start;
    const turn = Math.PI * 2;
    sweep = pulley.ccw
      ? ((sweep % turn) + turn) % turn
      : -(((-sweep % turn) + turn) % turn);
    const steps = Math.max(1, Math.ceil(Math.abs(sweep) / 0.3));
    for (let step = 0; step <= steps; step++) {
      const angle = start + (sweep * step) / steps;
      path.push([
        pulley.centre[0] + pulley.radius * Math.cos(angle),
        pulley.centre[1] + pulley.radius * Math.sin(angle),
        pulley.centre[2],
      ]);
    }
  });
  return path;
}

// --- A bike's frame geometry, from the spec, with the rear axle at x = 0.
function frameGeometry(spec: BicycleSpec) {
  const radius = spec.wheel.bsd / 2 + spec.wheel.tyreHeight;
  const rearAxle: Vec3 = [0, radius, 0];
  const bb: Vec3 = [
    Math.sqrt(spec.chainstay ** 2 - spec.bbDrop ** 2),
    radius - spec.bbDrop,
    0,
  ];
  const head = spec.headAngle * DEG;
  const seat = spec.seatAngle * DEG;
  // The steering axis, upward, and the fork offset's direction.
  const up: Vec3 = [-Math.cos(head), Math.sin(head), 0];
  const forward: Vec3 = [Math.sin(head), Math.cos(head), 0];
  const seatDirection: Vec3 = [-Math.cos(seat), Math.sin(seat), 0];
  const { axleToCrown, offset, stack } = spec.fork;
  const drop = spec.headTube + stack + axleToCrown;
  const headTopY = radius + drop * Math.sin(head) - offset * Math.cos(head);
  // The effective top tube runs level from the head tube to the seat axis.
  const seatX = bb[0] - (headTopY - bb[1]) / Math.tan(seat);
  const headTop: Vec3 = [seatX + spec.topTube, headTopY, 0];
  const headBottom = along(headTop, up, -spec.headTube);
  const frontAxle = add(along(headTop, up, -drop), scale(forward, offset));
  return {
    bb,
    forward,
    frontAxle,
    headBottom,
    headTop,
    radius,
    rearAxle,
    seatDirection,
    up,
  };
}
type FrameGeometry = ReturnType<typeof frameGeometry>;

// --- Wheels.

function wheel(
  draft: Draft,
  spec: BicycleSpec,
  centre: Vec3,
  hub: { flanges: [number, number]; flangeRadius: number; width: number },
  finish: {
    hub: Colour;
    hubMetal: boolean;
    rim: Colour;
    rimMetal: boolean;
    sidewall: Colour;
    spoke: Colour;
  },
  tyreTag: string,
) {
  const { bsd, rimWidth, spokes, tyreHeight, tyreWidth } = spec.wheel;
  const axis: Vec3 = [0, 0, 1];
  const outer = bsd / 2 + tyreHeight;
  // The tyre's section: an ellipse whose beads tuck inside the rim hooks.
  const a = tyreWidth / 2;
  const b = tyreHeight / 2 + 0.003;
  const centreRadius = outer - b;
  const bead = Math.PI - Math.asin((rimWidth / 2 - 0.0015) / a);
  const beadRadius = centreRadius + b * Math.cos(bead);
  const profile: Array<[number, number, Colour]> = [];
  const steps = 6;
  for (let step = 0; step <= steps; step++) {
    const t = -bead + (2 * bead * step) / steps;
    const h = a * Math.sin(t);
    profile.push([
      centreRadius + b * Math.cos(t),
      h,
      Math.abs(Math.cos(t)) > 0.55 && Math.cos(t) > 0
        ? COLOUR.tread
        : finish.sidewall,
    ]);
  }
  setStyle(draft, { colour: COLOUR.rubber, metal: false, tag: tyreTag });
  revolve(draft, centre, axis, [profile], 36);

  // The rim's visible walls and spoke bed, below the tyre's beads.
  const hook = beadRadius + 0.0025;
  const bed = bsd / 2 - 0.018;
  const w = rimWidth / 2;
  setStyle(draft, { colour: finish.rim, metal: finish.rimMetal, tag: "rim" });
  revolve(
    draft,
    centre,
    axis,
    [
      [
        [bed, -w + 0.002],
        [hook, -w],
      ],
      [
        [bed, w - 0.002],
        [bed, -w + 0.002],
      ],
      [
        [hook, w],
        [bed, w - 0.002],
      ],
    ],
    36,
  );

  // Hub shell, flanges, and axle ends.
  setStyle(draft, { colour: finish.hub, metal: finish.hubMetal, tag: "hub" });
  const [left, right] = hub.flanges;
  revolve(
    draft,
    centre,
    axis,
    [
      [
        [0.016, left],
        [0.014, (left + right) / 2],
        [0.016, right],
      ],
    ],
    10,
  );
  [left, right].forEach((z) =>
    cylinder(
      draft,
      centre,
      axis,
      hub.flangeRadius,
      z - 0.0018,
      z + 0.0018,
      8,
      0.015,
    ),
  );
  setStyle(draft, { colour: COLOUR.alloy, metal: true });
  cylinder(
    draft,
    centre,
    axis,
    0.0085,
    -hub.width / 2 - 0.008,
    -0.03,
    6,
    0.003,
  );
  cylinder(draft, centre, axis, 0.0085, 0.03, hub.width / 2 + 0.008, 6, 0.003);

  // Spokes, three-cross: rim holes alternate flanges, and each flange's
  // spokes alternate leading and trailing, crossing three others.
  setStyle(draft, { colour: finish.spoke, metal: true, tag: "spoke" });
  const step = (Math.PI * 2) / spokes;
  for (let index = 0; index < spokes; index++) {
    const side = index % 2;
    const lead = Math.floor(index / 2) % 2 === 0 ? 1 : -1;
    const rimAngle = index * step;
    const hubAngle = rimAngle + lead * 6 * step;
    const flangeZ = side === 0 ? left : right;
    const rimPoint = add(centre, [
      (bed + 0.001) * Math.cos(rimAngle),
      (bed + 0.001) * Math.sin(rimAngle),
      side === 0 ? -0.002 : 0.002,
    ]);
    const hubPoint = add(centre, [
      (hub.flangeRadius - 0.003) * Math.cos(hubAngle),
      (hub.flangeRadius - 0.003) * Math.sin(hubAngle),
      flangeZ,
    ]);
    tube(draft, [hubPoint, rimPoint], 0.0013, 3, { flat: true });
  }
}

// A disc brake rotor on the hub's left: braking ring and spider arms.
function rotor(draft: Draft, centre: Vec3, z: number) {
  setStyle(draft, { colour: COLOUR.stainless, metal: true, tag: "rotor" });
  const t = 0.0009;
  revolve(
    draft,
    centre,
    [0, 0, 1],
    [
      [
        [0.062, z - t],
        [0.08, z - t],
      ],
      [
        [0.08, z - t],
        [0.08, z + t],
      ],
      [
        [0.08, z + t],
        [0.062, z + t],
      ],
    ],
    20,
  );
  for (let arm = 0; arm < 5; arm++) {
    const angle = (arm / 5) * Math.PI * 2 + 0.3;
    const direction: Vec3 = [Math.cos(angle), Math.sin(angle), 0];
    bar(
      draft,
      add(centre, add(scale(direction, 0.02), [0, 0, z])),
      add(centre, add(scale(direction, 0.066), [0, 0, z])),
      [0, 0, 1],
      0.0018,
      0.008,
    );
  }
}

// --- Cranks and platform pedals, each tagged by side.
function cranks(
  draft: Draft,
  bb: Vec3,
  length: number,
  angle: number,
  armZ: [number, number],
  pedalColour: Colour,
  colour: Colour,
  leftPedalTurn = 0,
) {
  [1, -1].forEach((side) => {
    const a = angle + (side > 0 ? 0 : Math.PI);
    const direction: Vec3 = [Math.cos(a), Math.sin(a), 0];
    const root: Vec3 = add(bb, [0, 0, side * armZ[0]]);
    const end: Vec3 = add(along(bb, direction, length), [0, 0, side * armZ[1]]);
    setStyle(draft, { colour, metal: false, tag: "crank" });
    tube(
      draft,
      [along(root, direction, -0.018), end],
      [
        [0.0075, 0.016],
        [0.0075, 0.0105],
      ],
      8,
      { caps: true, u: [0, 0, 1] },
    );
    const tag = side < 0 ? "pedalL" : "pedalR";
    setStyle(draft, { colour: COLOUR.stainless, metal: true, tag });
    tube(draft, [end, add(end, [0, 0, side * 0.014])], 0.0055, 6);
    pedal(
      draft,
      add(end, [0, 0, side * (0.012 + PEDAL.width / 2)]),
      pedalColour,
      side < 0 ? leftPedalTurn : 0,
    );
  });
}

/** A flat pedal's real size: 100 x 100 mm, 17 mm thick at its cage. */
const PEDAL = { length: 0.1, thickness: 0.017, width: 0.1 };

// A platform pedal, hanging level on its spindle: a thin open cage of
// leading and trailing edges and two end plates round the spindle housing,
// with steel pins standing 3 mm proud of the cage's top and bottom.
function pedal(draft: Draft, centre: Vec3, colour: Colour, turn: number) {
  const { length, thickness, width } = PEDAL;
  // The pedal's own axes, turned about its spindle (+Z).
  const axes: [Vec3, Vec3, Vec3] = [
    [Math.cos(turn), Math.sin(turn), 0],
    [-Math.sin(turn), Math.cos(turn), 0],
    [0, 0, 1],
  ];
  const at = (x: number, y: number, z: number) =>
    add(centre, add(add(scale(axes[0], x), scale(axes[1], y)), [0, 0, z]));
  setStyle(draft, { colour, metal: false });
  tube(draft, [at(0, 0, -width / 2), at(0, 0, width / 2)], 0.0105, 8, {
    caps: true,
  });
  [1, -1].forEach((sign) => {
    box(draft, at(sign * (length / 2 - 0.005), 0, 0), axes, [
      0.005,
      thickness / 2,
      width / 2,
    ]);
    box(draft, at(0, 0, sign * (width / 2 - 0.004)), axes, [
      length / 2 - 0.01,
      thickness * 0.4,
      0.004,
    ]);
  });
  setStyle(draft, { colour: COLOUR.stainless, metal: true });
  for (const x of [1, -1]) {
    for (const y of [1, -1]) {
      for (const z of [0.3, -0.3]) {
        box(
          draft,
          at(x * (length / 2 - 0.005), y * (thickness / 2 + 0.0015), z * width),
          axes,
          [0.0015, 0.0015, 0.0015],
        );
      }
    }
  }
}

// --- Saddle: elliptical sections from tail to nose, closed at both ends.
function saddle(
  draft: Draft,
  tail: Vec3,
  forward: Vec3,
  length: number,
  width: number,
  noseWidth: number,
  thickness: number,
) {
  const sections = 7;
  const path: Vec3[] = [];
  const radii: Array<[number, number]> = [];
  const up = normalize(cross([0, 0, 1], forward));
  for (let index = 0; index < sections; index++) {
    const t = index / (sections - 1);
    // Wide and round at the tail, narrowing to the nose, the top dipped.
    const halfWidth =
      (noseWidth + (width - noseWidth) * Math.cos((t * Math.PI) / 2) ** 1.6) /
      2;
    const halfHeight = thickness * (0.5 - 0.15 * t) * (index === 0 ? 0.8 : 1);
    path.push(
      add(
        along(tail, forward, t * length),
        scale(up, -0.006 * Math.sin(t * Math.PI)),
      ),
    );
    radii.push([halfWidth, halfHeight]);
  }
  tube(draft, path, radii, 10, { caps: true, u: [0, 0, 1] });
}

// --- Cables and housing: a smooth 4-sided band.
function cable(draft: Draft, points: Vec3[]) {
  setStyle(draft, {
    colour: COLOUR.black,
    metal: false,
    steered: false,
    tag: "cable",
  });
  tube(draft, spline(points, 2), 0.0025, 4);
}

type Pose = {
  /** The drive-side crank's angle from forward, up positive. */
  crank: number;
  /** The left pedal's turn on its spindle. */
  pedal: number;
  /** Lift and shift after turning, setting the tyres on y = 0. */
  offset: Vec3;
  pitch: number;
  roll: number;
  steer: number;
};

// Each variant's resting pose, in radians and metres, so nothing is solved
// at load. Found once, offline, in a throwaway harness that stood each bike
// beside the crest's rail or wall, levelled both tyres by pitch, and rolled
// it over until it touched: the hardtail until its saddle met a post just
// as its fork's brake housing met the mid rail, the BMX until its grip met
// the wall's top. Each offset then lifts the tyres to y = 0 and centres the
// bike between their contacts. So each pose stands only where the seed
// places it; the spec confirms, there, that each bike touches what it leans
// on, within 2 mm, and passes through nothing.
const REST: Pose[] = [
  {
    crank: 0,
    offset: [-0.532332, 0, 0],
    pedal: 0,
    pitch: 0,
    roll: -0.2181662,
    steer: 0,
  },
  {
    crank: 4.712389,
    offset: [-0.476596, 0.005835, 0.050959],
    pedal: 0,
    pitch: 0.0116677,
    roll: -0.6857799,
    steer: 0.6108652,
  },
];

type Support = { name: string; test: (index: number) => boolean };

type BuiltBicycle = {
  draft: Draft;
  geometry: FrameGeometry;
  masses: Array<{ kg: number; point: Vec3; steered: boolean }>;
  supports: Support[];
};

// Moves a point on the front end to where the bars turn it.
function steerer(geometry: FrameGeometry, steer: number) {
  return (p: Vec3) =>
    add(geometry.headTop, rotate(sub(p, geometry.headTop), geometry.up, steer));
}

// --- Variant 0: the hardtail.
function buildHardtail(draft: Draft, pose: Pose): BuiltBicycle {
  const spec = BICYCLE[0];
  const g = frameGeometry(spec);
  const {
    bb,
    forward,
    frontAxle,
    headBottom,
    headTop,
    rearAxle,
    seatDirection,
    up,
  } = g;
  const masses: BuiltBicycle["masses"] = [];
  const mass = (kg: number, point: Vec3, steered = false) =>
    masses.push({ kg, point, steered });
  const rearHalf = spec.hubs.rear / 2;

  // Frame: hydroformed alloy, Rust powder coat.
  setStyle(draft, {
    colour: COLOUR.rust,
    metal: false,
    steered: false,
    tag: "frame",
  });
  tube(draft, [headBottom, headTop], 0.0235, 10);
  const seatTop = along(bb, seatDirection, spec.seatTube);
  const topTubeRear = along(bb, seatDirection, spec.seatTube - 0.045);
  tube(draft, [along(headTop, up, -0.028), topTubeRear], [0.022, 0.019], 10, {
    u: [0, 0, 1],
  });
  // The down tube carries an Ice logo band.
  const downTop = along(headBottom, up, 0.035);
  const downAt = (t: number) => lerp(downTop, bb, t);
  tube(
    draft,
    [downTop, downAt(0.22), downAt(0.221), downAt(0.58), downAt(0.581), bb],
    0.025,
    10,
    {
      colours: [
        COLOUR.rust,
        COLOUR.rust,
        COLOUR.ice,
        COLOUR.ice,
        COLOUR.rust,
        COLOUR.rust,
      ],
    },
  );
  tube(draft, [bb, seatTop], 0.0175, 10);
  cylinder(draft, bb, [0, 0, 1], 0.021, -0.0365, 0.0365, 10, 0.012);
  [1, -1].forEach((side) => {
    const dropout = add(rearAxle, [0.004, 0.002, side * (rearHalf - 0.004)]);
    tube(
      draft,
      [
        dropout,
        [0.24, rearAxle[1] - 0.034, side * 0.05],
        add(bb, [-0.03, 0.002, side * 0.03]),
      ],
      [0.0085, 0.011, 0.0125],
      8,
    );
    const cluster = add(along(bb, seatDirection, spec.seatTube - 0.05), [
      -0.016,
      0,
      side * 0.017,
    ]);
    const stayTop = add(rearAxle, [0.012, 0.012, side * (rearHalf - 0.006)]);
    const stayLength = Math.hypot(...sub(cluster, stayTop));
    // The stays stay wide until they clear the 0.344 m tyre, then close in.
    const bridge = lerp(stayTop, cluster, 0.35 / stayLength);
    bridge[2] = side * 0.045;
    tube(draft, [stayTop, bridge, cluster], [0.0075, 0.0085, 0.009], 8);
    box(
      draft,
      add(rearAxle, [0.008, 0.006, side * (rearHalf - 0.004)]),
      AXES,
      [0.024, 0.02, 0.003],
    );
  });
  mass(2, lerp(lerp(bb, headTop, 0.5), seatTop, 0.3));

  // Headset cups, seatpost, collar, and saddle.
  setStyle(draft, { colour: COLOUR.black, tag: "frame" });
  tube(draft, [headTop, along(headTop, up, 0.01)], 0.025, 10, { caps: true });
  tube(draft, [along(headBottom, up, -0.012), headBottom], 0.026, 10, {
    caps: true,
  });
  tube(
    draft,
    [
      along(seatTop, seatDirection, -0.005),
      along(seatTop, seatDirection, 0.012),
    ],
    0.0195,
    10,
    { caps: true },
  );
  const postTop = along(bb, seatDirection, spec.saddleHeight - 0.045);
  tube(draft, [seatTop, postTop], 0.0155, 10);
  setStyle(draft, { colour: COLOUR.alloy, metal: true });
  bar(
    draft,
    add(seatTop, [0.004, 0.006, 0.02]),
    add(seatTop, [0.05, -0.008, 0.024]),
    [0, 1, 0],
    0.01,
    0.004,
  );
  setStyle(draft, { colour: COLOUR.black, metal: false });
  box(draft, add(postTop, [0, 0.012, 0]), AXES, [0.025, 0.012, 0.02]);
  saddle(
    draft,
    add(postTop, [-0.15, 0.032, 0]),
    [1, 0, 0],
    0.27,
    0.14,
    0.036,
    0.05,
  );
  mass(0.6, postTop);

  // Fork (steered): black lowers and crown, chromed stanchions.
  setStyle(draft, {
    colour: COLOUR.black,
    metal: false,
    steered: true,
    tag: "fork",
  });
  const crownS = spec.fork.axleToCrown - 0.022;
  const legAt = (side: number, s: number) =>
    add(along(frontAxle, up, s), [0, 0, side * 0.061]);
  const steerAt = (s: number) =>
    along(along(frontAxle, forward, -spec.fork.offset), up, s);
  tube(draft, [steerAt(crownS), along(headTop, up, 0.055)], 0.0143, 10, {
    caps: true,
  });
  box(
    draft,
    lerp(steerAt(crownS), along(frontAxle, up, crownS), 0.55),
    basis(forward, up),
    [0.032, 0.016, 0.082],
  );
  [1, -1].forEach((side) => {
    setStyle(draft, { colour: COLOUR.chrome, metal: true });
    tube(draft, [legAt(side, crownS), legAt(side, crownS - 0.2)], 0.015, 10);
    setStyle(draft, { colour: COLOUR.black, metal: false });
    tube(
      draft,
      [legAt(side, crownS - 0.165), legAt(side, 0.04), legAt(side, -0.012)],
      [0.019, 0.018, 0.011],
      10,
      { caps: true },
    );
  });
  // The arch joins the lowers ahead of the stanchions.
  tube(
    draft,
    spline(
      [
        add(legAt(-1, crownS - 0.19), scale(forward, 0.012)),
        add(along(frontAxle, up, crownS - 0.165), scale(forward, 0.03)),
        add(legAt(1, crownS - 0.19), scale(forward, 0.012)),
      ],
      3,
    ),
    [0.011, 0.008],
    8,
  );
  mass(1.9, along(frontAxle, up, 0.3), true);

  // Stem, riser bar, grips, levers (steered).
  const clamp = along(headTop, up, 0.035);
  const stemDirection = rotate(forward, [0, 0, 1], spec.bar.stemAngle * DEG);
  const barCentre = along(clamp, stemDirection, spec.bar.stem);
  setStyle(draft, { colour: COLOUR.black, metal: false, tag: "bars" });
  tube(draft, [along(clamp, up, -0.022), along(clamp, up, 0.022)], 0.019, 10, {
    caps: true,
  });
  bar(draft, clamp, barCentre, [0, 0, 1], 0.032, 0.026);
  cylinder(draft, barCentre, [0, 0, 1], 0.02, -0.025, 0.025, 10);
  const half = spec.bar.width / 2;
  const back = Math.sin(9 * DEG);
  const barPoint = (z: number): Vec3 => {
    const side = Math.sign(z);
    const reach = Math.abs(z);
    // Flat through the clamp, rising to the grips with 9° back and 5° up sweep.
    const lift =
      reach < 0.07 ? 0 : spec.bar.rise * Math.min(1, (reach - 0.07) / 0.12);
    const sweep = reach < 0.18 ? 0 : (reach - 0.18) * back;
    const up5 = reach < 0.2 ? 0 : (reach - 0.2) * Math.sin(5 * DEG);
    return add(barCentre, [-sweep - lift * 0.4, lift + up5, side * reach]);
  };
  const barZs = [-half, -0.21, -0.15, -0.07, 0, 0.07, 0.15, 0.21, half];
  tube(
    draft,
    barZs.map(barPoint),
    barZs.map((z) =>
      Math.abs(z) < 0.04 ? 0.0159 : Math.abs(z) < 0.1 ? 0.014 : 0.0111,
    ),
    8,
    { caps: true },
  );
  [1, -1].forEach((side) => {
    setStyle(draft, { colour: COLOUR.rubber });
    tube(
      draft,
      [barPoint(side * (half - 0.135)), barPoint(side * half)],
      0.016,
      10,
      { caps: true },
    );
    // Lever clamp and blade, reaching forward and down.
    const leverRoot = barPoint(side * (half - 0.16));
    setStyle(draft, { colour: COLOUR.black });
    cylinder(
      draft,
      leverRoot,
      normalize(sub(barPoint(side * half), leverRoot)),
      0.017,
      -0.009,
      0.009,
      8,
    );
    setStyle(draft, { colour: COLOUR.alloy, metal: true });
    bar(
      draft,
      add(leverRoot, [0.03, -0.006, 0]),
      add(leverRoot, [0.075, -0.03, side * 0.075]),
      [0, 1, 0],
      0.012,
      0.007,
    );
  });
  mass(0.8, barCentre, true);

  // Wheels: black rims and hubs, stainless spokes, 160 mm rotors.
  const wheelFinish = {
    hub: COLOUR.black,
    hubMetal: false,
    rim: COLOUR.black,
    rimMetal: false,
    sidewall: COLOUR.rubber,
    spoke: COLOUR.stainless,
  };
  setStyle(draft, { steered: false });
  wheel(
    draft,
    spec,
    rearAxle,
    { flanges: [-0.034, 0.019], flangeRadius: 0.024, width: spec.hubs.rear },
    wheelFinish,
    "tyreR",
  );
  rotor(draft, rearAxle, -(rearHalf - 0.0151));
  mass(2.4, rearAxle);
  setStyle(draft, { steered: true });
  wheel(
    draft,
    spec,
    frontAxle,
    { flanges: [-0.031, 0.035], flangeRadius: 0.024, width: spec.hubs.front },
    wheelFinish,
    "tyreF",
  );
  rotor(draft, frontAxle, -(spec.hubs.front / 2 - 0.0151));
  mass(2.1, frontAxle, true);
  // Calipers: front behind the left leg, rear between the left stays.
  setStyle(draft, { colour: COLOUR.black, metal: false, tag: "brake" });
  const caliper = (centre: Vec3, angle: number, z: number) => {
    const radial: Vec3 = [Math.cos(angle), Math.sin(angle), 0];
    box(
      draft,
      add(along(centre, radial, 0.07), [0, 0, z]),
      [radial, [-radial[1], radial[0], 0], [0, 0, 1]],
      [0.018, 0.028, 0.017],
    );
  };
  caliper(frontAxle, 120 * DEG, -0.042);
  setStyle(draft, { steered: false });
  caliper(rearAxle, 18 * DEG, -0.054);

  // Drivetrain: 32T ring on a 50 mm chainline, cassette, derailleur, chain.
  const chainline = 0.05;
  const pitch = (teeth: number) => 0.0127 / (2 * Math.sin(Math.PI / teeth));
  setStyle(draft, { colour: COLOUR.black, metal: false, tag: "drive" });
  sprocket(
    draft,
    add(bb, [0, 0, chainline]),
    spec.chainring,
    pitch(spec.chainring),
    0.048,
    0.003,
  );
  for (let arm = 0; arm < 4; arm++) {
    const angle = arm * (Math.PI / 2) + 0.4;
    bar(
      draft,
      add(bb, [0, 0, chainline + 0.004]),
      add(bb, [
        0.052 * Math.cos(angle),
        0.052 * Math.sin(angle),
        chainline + 0.004,
      ]),
      [0, 0, 1],
      0.012,
      0.005,
    );
  }
  cranks(
    draft,
    bb,
    spec.crank,
    pose.crank,
    [0.058, 0.074],
    COLOUR.black,
    COLOUR.black,
    pose.pedal,
  );
  mass(1.3, bb);
  // Cassette, 11–34: eight cogs stepping inboard.
  const cogs = [11, 13, 15, 18, 21, 24, 28, 34];
  setStyle(draft, { colour: COLOUR.stainless, metal: true, tag: "drive" });
  const cogZ = (index: number) => 0.0585 - index * 0.0048;
  const cassette: Array<Array<[number, number]>> = [];
  cogs.forEach((teeth, index) => {
    const tip = pitch(teeth) + 0.003;
    const inner = index === 0 ? 0.017 : pitch(cogs[index - 1]!) + 0.003;
    const z = cogZ(index);
    cassette.push(
      [
        [tip, z],
        [inner, z],
      ],
      [
        [tip, z - 0.0018],
        [tip, z],
      ],
    );
    if (index === cogs.length - 1)
      cassette.push([
        [0.017, z - 0.0018],
        [tip, z - 0.0018],
      ]);
  });
  revolve(draft, rearAxle, [0, 0, 1], cassette, 10);
  const cogIndex = cogs.indexOf(spec.cog);
  const chainZ = cogZ(cogIndex) - 0.0009;
  // Derailleur: hanger, body, cage plates, jockey wheels.
  const upper = add(rearAxle, [0.006, -0.088, chainZ]);
  const lower = add(rearAxle, [0.042, -0.152, chainZ]);
  setStyle(draft, { colour: COLOUR.black, metal: false });
  bar(
    draft,
    add(rearAxle, [0, 0, rearHalf + 0.004]),
    add(rearAxle, [-0.012, -0.03, rearHalf + 0.006]),
    [0, 0, 1],
    0.016,
    0.005,
  );
  bar(
    draft,
    add(rearAxle, [-0.012, -0.03, rearHalf + 0.01]),
    add(upper, [-0.008, 0.006, 0.018]),
    [0, 0, 1],
    0.026,
    0.016,
  );
  [chainZ - 0.007, chainZ + 0.007].forEach((z, index) => {
    setStyle(draft, {
      colour: index ? COLOUR.alloy : COLOUR.black,
      metal: index === 1,
    });
    bar(
      draft,
      [upper[0], upper[1] + 0.012, z],
      [lower[0], lower[1] - 0.012, z],
      [0, 0, 1],
      0.026,
      0.002,
    );
  });
  setStyle(draft, { colour: COLOUR.black, metal: false });
  [upper, lower].forEach((centre) =>
    cylinder(draft, centre, [0, 0, 1], 0.026, -0.0035, 0.0035, 8, 0.006),
  );
  mass(0.9, add(rearAxle, [0, -0.05, 0.05]));
  // The kickstand, folded.
  mass(0.4, add(bb, [-0.21, 0, -0.055]));
  setStyle(draft, { colour: COLOUR.chain, metal: true, tag: "chain" });
  const chain = chainPath([
    {
      centre: [bb[0], bb[1], chainline],
      ccw: true,
      radius: pitch(spec.chainring),
    },
    {
      centre: [rearAxle[0], rearAxle[1], chainZ],
      ccw: true,
      radius: pitch(spec.cog),
    },
    { centre: upper, ccw: false, radius: pitch(11) },
    { centre: lower, ccw: true, radius: pitch(11) },
  ]);
  tube(draft, chain, CHAIN_SECTION, 4, {
    closed: true,
    flat: true,
    u: [0, 0, 1],
  });

  // Front brake hose from the left lever down the left leg; rear hose under
  // the top tube; gear cable under the down tube. Each bends where the bars
  // turn it.
  const steerPoint = steerer(g, pose.steer);
  const leftLever = steerPoint(
    add(barPoint(-(half - 0.16)), [0.01, 0.01, 0.01]),
  );
  cable(draft, [
    leftLever,
    steerPoint(add(barCentre, [0.08, -0.04, -0.12])),
    steerPoint(add(legAt(-1, crownS - 0.08), [0.02, 0, -0.022])),
    steerPoint(add(legAt(-1, 0.14), [-0.022, 0, -0.012])),
    steerPoint(
      add(
        along(frontAxle, [Math.cos(120 * DEG), Math.sin(120 * DEG), 0], 0.06),
        [0, 0, -0.042],
      ),
    ),
  ]);
  const rightLever = steerPoint(
    add(barPoint(half - 0.16), [0.01, 0.01, -0.01]),
  );
  cable(draft, [
    rightLever,
    steerPoint(add(barCentre, [0.07, -0.05, 0.1])),
    add(along(headTop, up, -0.05), [0.025, 0, 0.012]),
    add(lerp(headTop, topTubeRear, 0.5), [0, -0.024, 0]),
    add(topTubeRear, [-0.02, -0.03, -0.018]),
    add(rearAxle, [0.07, 0.11, -0.05]),
    add(
      along(rearAxle, [Math.cos(18 * DEG), Math.sin(18 * DEG), 0], 0.08),
      [0, 0, -0.054],
    ),
  ]);
  cable(draft, [
    steerPoint(add(barPoint(half - 0.19), [0, -0.012, 0])),
    steerPoint(add(barCentre, [0.05, -0.06, 0.08])),
    add(lerp(downTop, bb, 0.3), [0, -0.026, 0.012]),
    add(bb, [-0.03, -0.03, 0.03]),
    add(rearAxle, [-0.01, -0.04, rearHalf + 0.012]),
  ]);

  return {
    draft,
    geometry: g,
    masses,
    supports: [
      { name: "rear tyre", test: (i) => draft.styles[i]!.tag === "tyreR" },
      { name: "front tyre", test: (i) => draft.styles[i]!.tag === "tyreF" },
    ],
  };
}

// --- Variant 1: the BMX.
function buildBmx(draft: Draft, pose: Pose): BuiltBicycle {
  const spec = BICYCLE[1];
  const g = frameGeometry(spec);
  const {
    bb,
    forward,
    frontAxle,
    headBottom,
    headTop,
    rearAxle,
    seatDirection,
    up,
  } = g;
  const masses: BuiltBicycle["masses"] = [];
  const mass = (kg: number, point: Vec3, steered = false) =>
    masses.push({ kg, point, steered });
  const rearHalf = spec.hubs.rear / 2;

  // Frame: chromoly, Muted powder coat.
  setStyle(draft, {
    colour: COLOUR.muted,
    metal: false,
    steered: false,
    tag: "frame",
  });
  tube(
    draft,
    [along(headBottom, up, -0.004), along(headTop, up, 0.004)],
    0.0235,
    12,
    { caps: true },
  );
  const seatTop = along(bb, seatDirection, spec.seatTube);
  tube(
    draft,
    [along(headTop, up, -0.025), along(seatTop, seatDirection, -0.018)],
    0.0143,
    10,
  );
  tube(draft, [along(headBottom, up, 0.03), bb], 0.0175, 10);
  tube(draft, [bb, seatTop], 0.0143, 10);
  cylinder(draft, bb, [0, 0, 1], 0.0255, -0.0365, 0.0365, 12, 0.012);
  [1, -1].forEach((side) => {
    const dropout = add(rearAxle, [0.004, 0, side * (rearHalf - 0.005)]);
    tube(
      draft,
      [
        dropout,
        [0.17, (rearAxle[1] + bb[1]) / 2, side * 0.046],
        add(bb, [-0.03, 0, side * 0.03]),
      ],
      [0.0085, 0.0105, 0.0105],
      8,
    );
    const cluster = add(along(bb, seatDirection, spec.seatTube - 0.03), [
      -0.014,
      0,
      side * 0.016,
    ]);
    const stayTop = add(rearAxle, [0.01, 0.01, side * (rearHalf - 0.006)]);
    const bridge = lerp(stayTop, cluster, 0.45);
    bridge[2] = side * 0.045;
    tube(draft, [stayTop, bridge, cluster], [0.008, 0.0085, 0.009], 8);
    box(
      draft,
      add(rearAxle, [0.006, 0.002, side * (rearHalf - 0.004)]),
      AXES,
      [0.026, 0.017, 0.0025],
    );
  });
  // Typical freestyle part weights, about 11.9 kg in all. The frame's
  // 2.3 kg splits between its front triangle and its stays, BB, and dropouts.
  mass(1.3, lerp(bb, headTop, 0.45));
  mass(1, [0.17, (rearAxle[1] + bb[1]) / 2 + 0.05, 0]);

  // Pivotal post and a padded seat, nose up 8°.
  setStyle(draft, { colour: COLOUR.black, tag: "frame" });
  tube(
    draft,
    [
      along(seatTop, seatDirection, -0.004),
      along(seatTop, seatDirection, 0.014),
    ],
    0.0175,
    10,
    { caps: true },
  );
  const postTop = along(bb, seatDirection, spec.saddleHeight - 0.05);
  tube(draft, [seatTop, postTop], 0.0127, 10);
  const nose = rotate([1, 0, 0], [0, 0, 1], 8 * DEG);
  saddle(
    draft,
    add(add(postTop, [0, 0.03, 0]), scale(nose, -0.13)),
    nose,
    0.235,
    0.13,
    0.05,
    0.055,
  );
  mass(0.55, postTop);

  // Rigid fork and its dropouts and axle bolts (steered).
  setStyle(draft, {
    colour: COLOUR.muted,
    metal: false,
    steered: true,
    tag: "fork",
  });
  const crown = along(headBottom, up, -spec.fork.stack - 0.012);
  tube(draft, [crown, along(headTop, up, 0.03)], 0.0143, 10, { caps: true });
  box(draft, crown, basis(forward, up), [0.02, 0.012, 0.055]);
  [1, -1].forEach((side) => {
    const top = add(along(crown, up, -0.004), [0, 0, side * 0.045]);
    const bottom = add(frontAxle, [
      0.002,
      0.004,
      side * (spec.hubs.front / 2 + 0.003),
    ]);
    tube(
      draft,
      [top, lerp(top, bottom, 0.5), bottom],
      [0.0145, 0.012, 0.0095],
      10,
      { caps: true },
    );
    setStyle(draft, { colour: COLOUR.chrome, metal: true });
    cylinder(
      draft,
      add(frontAxle, [0, 0, side * (spec.hubs.front / 2 + 0.011)]),
      [0, 0, 1],
      0.009,
      -0.006,
      0.006,
      6,
      0.004,
    );
    setStyle(draft, { colour: COLOUR.muted, metal: false });
  });
  mass(0.95, along(frontAxle, up, 0.18), true);

  // Top-load stem and two-piece bars with a crossbar.
  const clamp = add(along(headTop, up, 0.05), scale(forward, spec.bar.stem));
  setStyle(draft, { colour: COLOUR.black, tag: "bars" });
  box(
    draft,
    along(along(headTop, up, 0.03), forward, 0.02),
    basis(forward, up),
    [0.035, 0.018, 0.03],
  );
  cylinder(draft, clamp, [0, 0, 1], 0.019, -0.03, 0.03, 10);
  setStyle(draft, { colour: COLOUR.chrome, metal: true });
  const back = Math.sin(12 * DEG);
  const half = spec.bar.width / 2;
  const rise = spec.bar.rise;
  const right: Vec3[] = [
    [0, 0, 0.04],
    [-0.006, 0.035, 0.074],
    [-0.022, rise - 0.035, 0.112],
    [-0.032, rise, 0.15],
    [-0.04 - (half - 0.17) * back, rise + 0.006, half],
  ];
  const barPath = [
    ...right
      .slice()
      .reverse()
      .map(([x, y, z]): Vec3 => [x, y, -z]),
    ...right,
  ].map((p) => add(clamp, p));
  tube(draft, spline(barPath, 3), 0.0111, 8, { caps: true });
  const crossY = 0.14;
  const crossAt = (side: number) => {
    const t = (crossY - 0.035) / (rise - 0.07);
    return add(clamp, [-0.006 - 0.016 * t, crossY, side * (0.074 + 0.038 * t)]);
  };
  tube(draft, [crossAt(-1), crossAt(1)], 0.011, 8);
  const gripAt = (side: number, inset: number): Vec3 =>
    add(clamp, [
      -0.04 - (half - inset - 0.17) * back,
      rise + 0.006 * (1 - inset / (half - 0.17)),
      side * (half - inset),
    ]);
  [1, -1].forEach((side) => {
    setStyle(draft, { colour: COLOUR.rubber, metal: false });
    tube(draft, [gripAt(side, 0.145), gripAt(side, -0.004)], 0.0165, 10, {
      caps: true,
    });
  });
  // Rear brake lever on the right.
  const leverRoot = gripAt(1, 0.165);
  setStyle(draft, { colour: COLOUR.black });
  cylinder(draft, leverRoot, [0, 0, 1], 0.017, -0.009, 0.009, 8);
  setStyle(draft, { colour: COLOUR.alloy, metal: true });
  bar(
    draft,
    add(leverRoot, [0.03, -0.006, 0]),
    add(leverRoot, [0.07, -0.03, 0.08]),
    [0, 1, 0],
    0.012,
    0.007,
  );
  // Bars and grips, and the stem below them.
  mass(1.1, add(clamp, [0, 0.12, 0]), true);
  mass(0.3, clamp, true);

  // Wheels: bright alloy rims and hubs, chromed spokes, gumwall tyres.
  const wheelFinish = {
    hub: COLOUR.alloy,
    hubMetal: true,
    rim: COLOUR.alloy,
    rimMetal: true,
    sidewall: COLOUR.gumwall,
    spoke: COLOUR.chrome,
  };
  setStyle(draft, { steered: false });
  wheel(
    draft,
    spec,
    rearAxle,
    { flanges: [-0.03, 0.03], flangeRadius: 0.022, width: spec.hubs.rear },
    wheelFinish,
    "tyreR",
  );
  // 20" wheels with tyres and tubes; the rear carries the driver.
  mass(2.3, rearAxle);
  setStyle(draft, { steered: true });
  wheel(
    draft,
    spec,
    frontAxle,
    { flanges: [-0.032, 0.032], flangeRadius: 0.022, width: spec.hubs.front },
    wheelFinish,
    "tyreF",
  );
  mass(2, frontAxle, true);
  // Rear axle nuts, 17 mm.
  setStyle(draft, {
    colour: COLOUR.chrome,
    metal: true,
    steered: false,
    tag: "frame",
  });
  [1, -1].forEach((side) =>
    cylinder(
      draft,
      add(rearAxle, [0, 0, side * (rearHalf + 0.008)]),
      [0, 0, 1],
      0.0098,
      -0.0055,
      0.0055,
      6,
      0.005,
    ),
  );

  // U-brake on the seat stays, its straddle cable over the tyre.
  const brakeAt = (side: number) => {
    const stay = lerp(
      add(rearAxle, [0.01, 0.01, 0]),
      along(bb, seatDirection, spec.seatTube - 0.03),
      0.62,
    );
    return add(stay, [0, 0, side * 0.05]);
  };
  setStyle(draft, { colour: COLOUR.black, metal: false, tag: "brake" });
  [1, -1].forEach((side) => {
    const base = brakeAt(side);
    bar(
      draft,
      base,
      add(base, [0.004, 0.05, -side * 0.025]),
      [1, 0, 0],
      0.014,
      0.008,
    );
  });
  setStyle(draft, { colour: COLOUR.stainless, metal: true });
  tube(
    draft,
    [
      add(brakeAt(-1), [0.004, 0.05, 0.025]),
      add(lerp(brakeAt(-1), brakeAt(1), 0.5), [0.004, 0.075, 0]),
      add(brakeAt(1), [0.004, 0.05, -0.025]),
    ],
    0.001,
    3,
  );

  // Drivetrain: Orange anodized 25T sprocket, 9T driver, chain, cranks.
  const chainline = 0.047;
  const pitch = (teeth: number) => 0.0127 / (2 * Math.sin(Math.PI / teeth));
  setStyle(draft, { colour: COLOUR.orange, metal: false, tag: "drive" });
  sprocket(
    draft,
    add(bb, [0, 0, chainline]),
    spec.chainring,
    pitch(spec.chainring),
    0.03,
    0.005,
  );
  setStyle(draft, { colour: COLOUR.stainless, metal: true });
  sprocket(
    draft,
    add(rearAxle, [0, 0, chainline]),
    spec.cog,
    pitch(spec.cog),
    0.012,
    0.0035,
  );
  // Moulded nylon pedals.
  cranks(
    draft,
    bb,
    spec.crank,
    pose.crank,
    [0.062, 0.076],
    COLOUR.plastic,
    COLOUR.black,
    pose.pedal,
  );
  setStyle(draft, { colour: COLOUR.chain, metal: true, tag: "chain" });
  tube(
    draft,
    chainPath([
      {
        centre: [bb[0], bb[1], chainline],
        ccw: true,
        radius: pitch(spec.chainring),
      },
      {
        centre: [rearAxle[0], rearAxle[1], chainline],
        ccw: true,
        radius: pitch(spec.cog),
      },
    ]),
    CHAIN_SECTION,
    4,
    { closed: true, flat: true, u: [0, 0, 1] },
  );
  // Cranks, BB, sprocket, pedals, and chain; then the brake.
  mass(2, bb);
  mass(0.35, lerp(rearAxle, seatTop, 0.6));

  // Rear brake cable: out of the lever in a loop ahead of the bars, along
  // the top tube, down to the straddle yoke.
  const steerPoint = steerer(g, pose.steer);
  cable(draft, [
    steerPoint(add(leverRoot, [0.012, 0.012, -0.012])),
    steerPoint(add(clamp, [0.09, 0.08, 0.06])),
    steerPoint(add(clamp, [0.05, -0.03, 0.02])),
    add(along(headTop, up, -0.04), [-0.03, 0.018, 0.015]),
    add(lerp(headTop, seatTop, 0.5), [0, 0.018, 0]),
    add(seatTop, [-0.03, 0.01, 0]),
    add(lerp(brakeAt(-1), brakeAt(1), 0.5), [0.004, 0.09, 0]),
  ]);

  return {
    draft,
    geometry: g,
    masses,
    supports: [
      { name: "rear tyre", test: (i) => draft.styles[i]!.tag === "tyreR" },
      { name: "front tyre", test: (i) => draft.styles[i]!.tag === "tyreF" },
    ],
  };
}

// --- Posing: steer the front end about its axis, roll about X (negative
// rolls toward the left, -Z), then pitch about the ground's Z.
function poser(geometry: FrameGeometry, pose: Pose) {
  const { headTop, up } = geometry;
  const cp = Math.cos(pose.pitch);
  const sp = Math.sin(pose.pitch);
  const cr = Math.cos(pose.roll);
  const sr = Math.sin(pose.roll);
  const turn = (v: Vec3): Vec3 => {
    const y = v[1] * cr - v[2] * sr;
    return [v[0] * cp - y * sp, v[0] * sp + y * cp, v[1] * sr + v[2] * cr];
  };
  // The steering's rotation, as the images of the three axes.
  const [sx, sy, sz] = AXES.map((axis) => rotate(axis, up, pose.steer));
  const steer = (v: Vec3): Vec3 => [
    sx![0] * v[0] + sy![0] * v[1] + sz![0] * v[2],
    sx![1] * v[0] + sy![1] * v[1] + sz![1] * v[2],
    sx![2] * v[0] + sy![2] * v[1] + sz![2] * v[2],
  ];
  return {
    normal: (n: Vec3, steered: boolean) => turn(steered ? steer(n) : n),
    point: (p: Vec3, steered: boolean) =>
      turn(steered ? add(headTop, steer(sub(p, headTop))) : p),
  };
}

// The hardtail's kickstand, built in the final frame and folded up under
// the left chainstay: an adjustable alloy leg from the plate behind the BB,
// its rubber foot toward the rear axle.
function kickstand(draft: Draft, plate: Vec3, mount: Vec3, foot: Vec3) {
  const direction = normalize(sub(foot, mount));
  setStyle(draft, {
    colour: COLOUR.black,
    metal: false,
    steered: false,
    tag: "stand",
  });
  box(
    draft,
    plate,
    basis(normalize(sub(mount, plate)), [0, 1, 0]),
    [0.04, 0.012, 0.022],
  );
  setStyle(draft, { colour: COLOUR.alloy, metal: true });
  tube(draft, [mount, along(foot, direction, -0.03)], [0.0095, 0.0075], 8, {
    u: [1, 0, 0],
  });
  setStyle(draft, { colour: COLOUR.rubber, metal: false });
  tube(draft, [along(foot, direction, -0.034), foot], 0.011, 8, {
    caps: true,
    u: [0, 1, 0],
  });
}

function buildBicycle(variant: number, rest?: Pose) {
  const draft: Draft = {
    indices: [],
    normals: [],
    positions: [],
    style: { colour: COLOUR.black, metal: false, steered: false, tag: "" },
    styles: [],
  };
  const index = Math.min(
    Math.max(Math.floor(variant), 0),
    BICYCLE_VARIANTS - 1,
  );
  const pose = rest ?? REST[index]!;
  const built =
    index === 0 ? buildHardtail(draft, pose) : buildBmx(draft, pose);
  const { geometry } = built;

  // Turn every vertex into its resting pose and set it on the ground.
  const { normal, point } = poser(geometry, pose);
  const place = (p: Vec3, steered: boolean) =>
    add(point(p, steered), pose.offset);
  draft.positions = draft.positions.map((p, i) => {
    const placed = place(p, draft.styles[i]!.steered);
    // A housing that reaches the ground lies on it.
    if (draft.styles[i]!.tag === "cable")
      placed[1] = Math.max(placed[1], 0.0005);
    return placed;
  });
  draft.normals = draft.normals.map((n, i) =>
    normal(n, draft.styles[i]!.steered),
  );
  // Each support's lowest vertex.
  const supports = built.supports.map((support) => {
    let lowest: Vec3 | null = null;
    draft.positions.forEach((p, i) => {
      if (support.test(i) && (!lowest || p[1] < lowest[1])) lowest = p;
    });
    return { name: support.name, point: lowest! as Vec3 };
  });
  if (index === 0) {
    kickstand(
      draft,
      place(add(geometry.bb, [-0.045, -0.03, -0.012]), false),
      place(add(geometry.bb, [-0.09, -0.032, -0.04]), false),
      place(add(geometry.rearAxle, [0.09, -0.032, -0.07]), false),
    );
  }
  const totalMass = built.masses.reduce((sum, mass) => sum + mass.kg, 0);
  const centreOfMass = built.masses
    .reduce<Vec3>(
      (sum, mass) => add(sum, scale(place(mass.point, mass.steered), mass.kg)),
      [0, 0, 0],
    )
    .map((value) => value / totalMass) as Vec3;
  return { centreOfMass, draft, pose, supports };
}

/**
 * One parked bicycle, standing at the origin: its coated and rubber parts
 * (dielectric) and its bare metal (metal), each coloured per vertex.
 */
export function createBicycleGeometry(variant: number) {
  const { draft } = buildBicycle(variant);
  const groups = {
    dielectric: {
      colors: [],
      indices: [],
      normals: [],
      positions: [],
    } as TreeMeshData,
    metal: {
      colors: [],
      indices: [],
      normals: [],
      positions: [],
    } as TreeMeshData,
  };
  const remap = new Array<number>(draft.positions.length);
  draft.positions.forEach((p, i) => {
    const { colour, metal } = draft.styles[i]!;
    const mesh = metal ? groups.metal : groups.dielectric;
    const n = draft.normals[i]!;
    remap[i] = mesh.positions.length / 3;
    mesh.positions.push(p[0], p[1], p[2]);
    mesh.normals.push(n[0], n[1], n[2]);
    mesh.colors!.push(colour[0], colour[1], colour[2], 1);
  });
  const { indices } = draft;
  for (let i = 0; i < indices.length; i += 3) {
    const mesh = draft.styles[indices[i]!]!.metal
      ? groups.metal
      : groups.dielectric;
    mesh.indices.push(
      remap[indices[i]!]!,
      remap[indices[i + 1]!]!,
      remap[indices[i + 2]!]!,
    );
  }
  return groups;
}

/**
 * Where a parked bicycle rests: each tyre's lowest point, its estimated
 * centre of mass, and its resting pose (radians and metres).
 */
export function getBicycleRest(variant: number) {
  const { centreOfMass, pose, supports } = buildBicycle(variant);
  return { centreOfMass, pose, supports };
}

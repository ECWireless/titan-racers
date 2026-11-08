import { seededRandom } from "./audio-synthesis";
import type { AudioSurface, ImpactMaterial } from "./race-audio-mapping";

/**
 * Impacts by what the kart hit, and landings by what it landed on.
 *
 * Every sound is modal or granular synthesis, rendered once per context into
 * one mono buffer of short segments (about 3 s in total). A contact force
 * pulse (a half-sine, shorter for harder pairs) drives banks of inharmonic
 * two-pole resonators, one per vibration mode, each with its own decay.
 * Granular parts (leaves, stones, bubbles) are many tiny damped modes. Each
 * event layers three or four segments with small rate, offset, and level
 * jitter, so repeats never sound identical. At most 8 nodes per event.
 */

type Mode = { f: number; tau: number; a: number };
type KartModes = { shell: Mode[]; plate: Mode[] };
type Random = () => number;
type Synth = (
  y: Float32Array,
  sampleRate: number,
  random: Random,
  kart: KartModes,
) => void;

const SEGMENTS = [
  ["crack", 0.09],
  ["brush", 0.08],
  ["rattle", 0.22],
  ["concrete", 0.08],
  ["drum", 0.36],
  ["rail", 0.7],
  ["wood", 0.16],
  ["foliage", 0.3],
  ["tire", 0.13],
  ["gravelLight", 0.1],
  ["gravelHeavy", 0.25],
  ["waterLight", 0.12],
  ["waterHeavy", 0.32],
  // Last, so adding it left every earlier segment's random draws unchanged.
  ["knock", 0.09],
] as const;
type SegmentName = (typeof SEGMENTS)[number][0];

// Half-sine contact force of duration `contact` whose samples sum to `area`.
// A shorter contact has a wider spectrum (first null at 1.5 / contact).
function pulse(
  x: Float32Array,
  sampleRate: number,
  start: number,
  contact: number,
  area: number,
) {
  const n0 = Math.round(start * sampleRate);
  const length = Math.max(1, Math.round(contact * sampleRate));
  const peak = (area * Math.PI) / (2 * length);
  for (let i = 0; i < length && n0 + i < x.length; i += 1) {
    x[n0 + i] += peak * Math.sin((Math.PI * (i + 0.5)) / length);
  }
}

// One two-pole resonator per mode: a·e^(-t/tau)·sin(2πft + φ). A random φ
// per mode (sound reaches the ear from different parts of the object) keeps
// the modes from all spiking in phase.
function resonate(
  x: Float32Array,
  y: Float32Array,
  sampleRate: number,
  modes: readonly Mode[],
  random: Random,
) {
  for (const { f, tau, a } of modes) {
    if (f >= sampleRate * 0.45) continue;
    const r = Math.exp(-1 / (tau * sampleRate));
    const theta = (2 * Math.PI * f) / sampleRate;
    const phase = random() * 2 * Math.PI;
    const c1 = 2 * r * Math.cos(theta);
    const c2 = -r * r;
    const b0 = a * Math.sin(theta + phase);
    const b1 = -a * r * Math.sin(phase);
    let x1 = 0;
    let y1 = 0;
    let y2 = 0;
    for (let i = 0; i < y.length; i += 1) {
      const value = b0 * x[i] + b1 * x1 + c1 * y1 + c2 * y2;
      x1 = x[i];
      y2 = y1;
      y1 = value;
      y[i] += value;
    }
  }
}

// A single tiny damped mode (a leaf, a stone, a bubble), optionally rising in
// pitch (`chirp` is the relative rise) and with a few samples of contact click.
function grain(
  y: Float32Array,
  sampleRate: number,
  random: Random,
  start: number,
  f: number,
  tau: number,
  a: number,
  chirp = 0,
  click = 0,
) {
  const n0 = Math.round(start * sampleRate);
  const length = Math.min(y.length - n0, Math.ceil(tau * sampleRate * 7));
  const ramp = 0.00012 * sampleRate + 1;
  let phase = 0;
  for (let i = 0; i < length; i += 1) {
    const time = i / sampleRate;
    phase +=
      (2 * Math.PI * f * (1 + chirp * Math.min(1, time / (tau * 4)))) /
      sampleRate;
    y[n0 + i] +=
      a * Math.exp(-time / tau) * Math.min(1, i / ramp) * Math.sin(phase);
  }
  for (let i = 0; i < 3 && click && n0 + i < y.length; i += 1) {
    y[n0 + i] += click * (random() * 2 - 1);
  }
}

const exponentialTime = (random: Random, mean: number, cap: number) =>
  Math.min(cap, -Math.log(1 - random() * 0.98) * mean);
const zeros = (y: Float32Array) => new Float32Array(y.length);
const jitter = (random: Random, f: number, spread: number) =>
  f * (1 + (random() * 2 - 1) * spread);
const scaled = (modes: readonly Mode[], k: number) =>
  modes.map((mode) => ({ ...mode, a: mode.a * k }));
const damped = (modes: readonly Mode[], k: number) =>
  modes.map((mode) => ({ ...mode, tau: mode.tau * k }));
const table = (
  random: Random,
  rows: ReadonlyArray<readonly [number, number, number]>,
  spread = 0.004,
) => rows.map(([f, tau, a]) => ({ f: jitter(random, f, spread), tau, a }));

// The kart is the same in every hit: a thin moulded shell (dense, well-damped
// panel modes peaking around 2 kHz, loss factor 0.025–0.06) plus a bolted
// 250 × 100 mm aluminium chassis plate (simply supported plate mode ratios).
function kartModes(random: Random): KartModes {
  const shell: Mode[] = [{ f: jitter(random, 185, 0.08), tau: 0.012, a: 0.3 }];
  for (let i = 0; i < 34; i += 1) {
    const f = 300 * Math.pow(7000 / 300, (i + random() * 0.9) / 34);
    const peak = 1 / (1 + (Math.log2(f / 2000) / 1.5) ** 2);
    shell.push({
      f,
      tau: Math.max(0.0025, 1 / (Math.PI * f * (0.025 + random() * 0.035))),
      a: peak * (0.3 + 0.7 * random()) * 0.45,
    });
  }
  const plate = [710, 1003, 1493, 2178, 2546, 2840, 3060, 3329, 4137].map(
    (f0) => {
      const f = jitter(random, f0, 0.03);
      return {
        f,
        tau: 1 / (Math.PI * f * (0.006 + 0.006 * random())),
        a: 0.22 / (1 + f / 3000),
      };
    },
  );
  return { shell, plate };
}

// A stone knock: a hard contact exciting the pebble's high modes and the bed.
function stone(
  y: Float32Array,
  sampleRate: number,
  random: Random,
  start: number,
  a: number,
) {
  for (let i = 0; i < 3; i += 1) {
    grain(
      y,
      sampleRate,
      random,
      start,
      2500 + random() * 6500,
      0.0004 + random() * 0.0008,
      a * (0.4 + 0.6 * random()) * 0.3,
    );
  }
  grain(
    y,
    sampleRate,
    random,
    start,
    900 + random() * 1100,
    0.0012 + random() * 0.001,
    a * 0.15,
    0,
    a * 0.1,
  );
}

// Shallow-stream splash: the flat chassis slapping the surface, entrained
// bubbles ringing at the Minnaert frequency (3.26 kHz·mm / radius) and rising
// in pitch, fine spray, and droplets falling back as small "plinks".
function water(
  y: Float32Array,
  sampleRate: number,
  random: Random,
  slap: number,
  bubbles: number,
  spray: number,
  plinks: number,
  spread: number,
) {
  const x = zeros(y);
  pulse(x, sampleRate, 0.001, slap > 0.7 ? 0.0012 : 0.002, slap);
  for (
    let i = Math.round(0.001 * sampleRate);
    i < Math.round(0.012 * sampleRate);
    i += 1
  ) {
    x[i] += slap * 0.015 * (random() * 2 - 1);
  }
  resonate(
    x,
    y,
    sampleRate,
    table(
      random,
      [
        [220, 0.006, 1],
        [410, 0.005, 0.9],
        [690, 0.004, 0.8],
        [1100, 0.003, 0.6],
        [1700, 0.0025, 0.45],
        [2600, 0.002, 0.3],
      ],
      0.05,
    ),
    random,
  );
  const bubble = (start: number, radius: number, a: number, chirp: number) => {
    const f = 3260 / radius;
    grain(
      y,
      sampleRate,
      random,
      start,
      f,
      1 / (Math.PI * f * (0.04 + 0.05 * random())),
      a,
      chirp,
    );
  };
  for (let i = 0; i < bubbles; i += 1) {
    bubble(
      0.003 + exponentialTime(random, spread / 4, spread),
      0.8 * Math.pow(6, random()),
      0.2 + 0.5 * random(),
      0.1 + 0.3 * random(),
    );
  }
  for (let i = 0; i < spray; i += 1) {
    grain(
      y,
      sampleRate,
      random,
      0.005 + random() * spread * 1.3,
      4000 + random() * 6000,
      0.0008 + random() * 0.0012,
      0.04 * random(),
    );
  }
  for (let i = 0; i < plinks; i += 1) {
    bubble(
      spread * 0.7 + random() * (y.length / sampleRate - spread * 0.7 - 0.03),
      0.9 + random() * 1.5,
      0.15 + 0.25 * random(),
      0.3 + 0.3 * random(),
    );
  }
}

const BEAM_RATIOS = [1, 2.756, 5.404, 8.933, 13.344, 18.64, 24.81, 31.86];

const SYNTH: Record<SegmentName, Synth> = {
  // Firm hit: a hard 0.25 ms bumper contact, then the shell slapping its body
  // posts.
  crack(y, sampleRate, random, kart) {
    const x = zeros(y);
    const x2 = zeros(y);
    pulse(x, sampleRate, 0.0008, 0.00025, 1);
    pulse(x, sampleRate, 0.004 + random() * 0.0015, 0.00018, 0.3);
    pulse(x, sampleRate, 0.009 + random() * 0.002, 0.0002, 0.12);
    pulse(x2, sampleRate, 0.0014, 0.0003, 0.7);
    resonate(x, y, sampleRate, kart.shell, random);
    resonate(x2, y, sampleRate, kart.plate, random);
  },
  // Light glancing brush: a soft 1.6 ms contact, then plastic stick-slip scuff.
  brush(y, sampleRate, random, kart) {
    const x = zeros(y);
    pulse(x, sampleRate, 0.001, 0.0016, 0.45);
    for (let t = 0.003; t < 0.062; t += 0.0005 + random() * 0.0022) {
      pulse(
        x,
        sampleRate,
        t,
        0.00006 + random() * 0.0001,
        (0.04 + 0.16 * random()) * (1 - t / 0.07),
      );
    }
    resonate(x, y, sampleRate, damped(kart.shell, 0.6), random);
    resonate(x, y, sampleRate, damped(scaled(kart.plate, 0.5), 0.25), random);
  },
  // Loose parts knocking after a big hit: the shell buzzing on its posts,
  // body clips, wing, arm stops, battery, antenna tube. Each rings its own
  // modes.
  rattle(y, sampleRate, random, kart) {
    const parts: ReadonlyArray<readonly [readonly number[], number, number]> = [
      [[2300, 3710, 5150, 6890], 0.003, 0.35],
      [[610, 1370, 2480, 3900], 0.008, 0.2],
      [[1150, 2030, 3260, 4720], 0.004, 0.25],
      [[240, 410, 730], 0.014, 0.08],
      [[880, 2410, 4730], 0.012, 0.12],
    ];
    const x = zeros(y);
    for (let t = 0.001; t < 0.19; t += 0.002 + random() * 0.01) {
      let pick = random();
      let part = parts[0];
      for (const candidate of parts) {
        pick -= candidate[2];
        if (pick <= 0) {
          part = candidate;
          break;
        }
      }
      const level = Math.exp(-t / 0.07) * (0.3 + 0.7 * random());
      pulse(x, sampleRate, t, 0.0001 + random() * 0.0002, level * 0.35);
      for (const f of part[0]) {
        grain(
          y,
          sampleRate,
          random,
          t,
          jitter(random, f, 0.03),
          part[1] * (0.7 + 0.6 * random()),
          level * (0.15 + 0.35 * random()),
        );
      }
    }
    resonate(x, y, sampleRate, kart.shell, random);
  },
  // Kerb or cast block: massive and bedded in soil, so a few heavily damped
  // modes, a hard 0.15 ms contact, and grit crushing under the bumper.
  concrete(y, sampleRate, random) {
    const x = zeros(y);
    pulse(x, sampleRate, 0.0008, 0.00015, 1);
    for (let i = 0; i < 28; i += 1) {
      pulse(
        x,
        sampleRate,
        0.0008 + random() * 0.005,
        0.00003 + random() * 0.00004,
        0.03 + 0.1 * random(),
      );
    }
    resonate(
      x,
      y,
      sampleRate,
      table(
        random,
        [
          [95, 0.02, 0.25],
          [330, 0.008, 0.35],
          [520, 0.006, 0.55],
          [780, 0.005, 0.6],
          [1150, 0.004, 0.6],
          [1630, 0.003, 0.5],
          [2240, 0.0025, 0.45],
          [2950, 0.002, 0.4],
          [3800, 0.0015, 0.3],
          [5100, 0.0012, 0.25],
        ],
        0.08,
      ),
      random,
    );
    resonate(
      x,
      y,
      sampleRate,
      Array.from({ length: 10 }, () => ({
        f: 3000 + random() * 6000,
        tau: 0.0005 + random() * 0.001,
        a: 0.25,
      })),
      random,
    );
    for (let i = 0; i < 8; i += 1) {
      grain(
        y,
        sampleRate,
        random,
        0.008 + random() * 0.04,
        2500 + random() * 5000,
        0.0007,
        0.05 * random(),
        0,
        0.02,
      );
    }
  },
  // Hollow steel drum barrel: dense low shell modes split into beating pairs
  // by seams and dents, the air-cavity mode, and a short high sheen.
  drum(y, sampleRate, random) {
    const x = zeros(y);
    pulse(x, sampleRate, 0.0008, 0.0006, 1);
    pulse(x, sampleRate, 0.0035 + random() * 0.001, 0.0005, 0.18);
    resonate(
      x,
      y,
      sampleRate,
      table(
        random,
        [
          [120, 0.03, 0.35],
          [196, 0.09, 0.45],
          [238, 0.1, 1],
          [240.7, 0.095, 0.8],
          [311, 0.085, 0.8],
          [315.2, 0.08, 0.6],
          [377, 0.07, 0.5],
          [446, 0.065, 0.6],
          [452, 0.06, 0.45],
          [534, 0.055, 0.45],
          [621, 0.05, 0.4],
          [629, 0.048, 0.3],
          [744, 0.045, 0.32],
          [868, 0.04, 0.28],
          [877, 0.038, 0.22],
          [1012, 0.035, 0.22],
          [1187, 0.03, 0.17],
          [1406, 0.025, 0.13],
          [1693, 0.02, 0.1],
          [2050, 0.016, 0.07],
          [2490, 0.012, 0.05],
        ],
        0.002,
        // A drum standing full or on the ground rings for half as long.
      ).map((mode) => ({ ...mode, tau: mode.tau * 0.5 })),
      random,
    );
    resonate(
      x,
      y,
      sampleRate,
      Array.from({ length: 14 }, () => ({
        f: 2500 + random() * 4000,
        tau: 0.004 + random() * 0.005,
        a: 0.012,
      })),
      random,
    );
  },
  // Steel pipe rail or post: free-free beam bending modes, each a
  // near-degenerate pair from the two bending planes, with low steel damping.
  rail(y, sampleRate, random) {
    const x = zeros(y);
    pulse(x, sampleRate, 0.0008, 0.00035, 1);
    const f1 = jitter(random, 172, 0.05);
    const modes: Mode[] = [
      { f: 6800, tau: 0.015, a: 0.02 },
      { f: 8900, tau: 0.01, a: 0.01 },
    ];
    const amplitudes = [0.25, 0.7, 1, 0.8, 0.6, 0.4, 0.25, 0.15];
    // Halved from a free pipe's: posts are set in footings and rails bolted.
    const decays = [0.1, 0.09, 0.08, 0.065, 0.05, 0.035, 0.025, 0.02];
    BEAM_RATIOS.forEach((ratio, i) => {
      modes.push(
        { f: f1 * ratio, tau: decays[i], a: amplitudes[i] * 0.6 },
        {
          f: f1 * ratio * (1.004 + 0.005 * random()),
          tau: decays[i] * 0.9,
          a: amplitudes[i] * 0.45,
        },
      );
    });
    resonate(x, y, sampleRate, modes, random);
  },
  // Timber edging board or post with soil packed behind it, like the
  // nursery's beds: the soil damps the board's bending and torsion modes to a
  // few ms and adds a low thud, so it knocks rather than rings. (The random
  // draws for slaps a free board would make are kept, with no force, so the
  // segments after this one keep their sound.)
  wood(y, sampleRate, random) {
    const x = zeros(y);
    pulse(x, sampleRate, 0.0008, 0.0009, 1);
    pulse(x, sampleRate, 0.007 + random() * 0.004, 0.0004, 0);
    pulse(x, sampleRate, 0.017 + random() * 0.004, 0.0005, 0);
    const f1 = jitter(random, 128, 0.1);
    const partial: Array<{ f: number; a: number; tau?: number }> = [
      { f: 95, tau: 0.015, a: 0.9 },
    ];
    BEAM_RATIOS.slice(0, 5).forEach((ratio, i) =>
      partial.push({ f: f1 * ratio, a: [0.35, 0.9, 1, 0.7, 0.45][i] }),
    );
    [520, 905, 1420, 2100, 2650].forEach((f, i) =>
      partial.push({
        f: jitter(random, f, 0.05),
        a: [0.6, 0.55, 0.4, 0.3, 0.2][i],
      }),
    );
    const modes: Mode[] = partial.map((mode) => ({
      ...mode,
      tau:
        mode.tau ??
        Math.min(0.012, 1 / (Math.PI * mode.f * (0.04 + 0.02 * random()))),
    }));
    for (let i = 0; i < 12; i += 1) {
      modes.push({
        f: 1200 + random() * 3300,
        tau: 0.002 + random() * 0.003,
        a: 0.04,
      });
    }
    resonate(x, y, sampleRate, modes, random);
  },
  // Hedge or turf berm: a soft 6 ms whump, hundreds of leaf contacts, a few
  // twig snaps, and some mulch crumbling.
  foliage(y, sampleRate, random) {
    const x = zeros(y);
    pulse(x, sampleRate, 0.001, 0.006, 1);
    resonate(
      x,
      y,
      sampleRate,
      [
        { f: 70, tau: 0.04, a: 1 },
        { f: 120, tau: 0.03, a: 0.6 },
        { f: 190, tau: 0.02, a: 0.3 },
      ],
      random,
    );
    for (let i = 0; i < 420; i += 1) {
      const a = 0.12 * random() ** 3;
      grain(
        y,
        sampleRate,
        random,
        0.003 + exponentialTime(random, 0.07, 0.27),
        1500 * Math.pow(4.5, random()),
        0.0006 + random() * 0.0018,
        a,
        0,
        a * 0.3,
      );
    }
    for (let i = 0; i < 4; i += 1) {
      const t = 0.004 + random() * 0.1;
      grain(
        y,
        sampleRate,
        random,
        t,
        1800 + random() * 2700,
        0.004,
        0.3,
        0,
        0.2,
      );
      grain(y, sampleRate, random, t, 1800 + random() * 2700, 0.003, 0.2);
    }
    for (let i = 0; i < 50; i += 1) {
      grain(
        y,
        sampleRate,
        random,
        0.002 + random() * 0.08,
        400 + random() * 1000,
        0.003 + random() * 0.002,
        0.12 * random(),
      );
    }
  },
  // One axle landing: a soft rubber and foam contact, the tread pat through
  // the shell, the chassis plate and springs through the shocks, and the
  // oil-shock chuff.
  tire(y, sampleRate, random, kart) {
    const x = zeros(y);
    const x2 = zeros(y);
    const x3 = zeros(y);
    const x4 = zeros(y);
    pulse(x, sampleRate, 0.001, 0.0035, 1);
    pulse(x2, sampleRate, 0.001, 0.0008, 0.3);
    pulse(x3, sampleRate, 0.004, 0.003, 0.9);
    for (
      let i = Math.round(0.002 * sampleRate);
      i < Math.round(0.05 * sampleRate);
      i += 1
    ) {
      const t = i / sampleRate - 0.002;
      x4[i] =
        0.05 *
        (random() * 2 - 1) *
        Math.min(1, t / 0.003) *
        Math.exp(-t / 0.025);
    }
    resonate(
      x,
      y,
      sampleRate,
      [
        { f: 140, tau: 0.012, a: 0.45 },
        { f: 230, tau: 0.01, a: 0.4 },
        { f: 470, tau: 0.008, a: 0.3 },
        { f: 640, tau: 0.007, a: 0.25 },
        { f: 900, tau: 0.006, a: 0.15 },
        { f: 1600, tau: 0.004, a: 0.08 },
      ],
      random,
    );
    resonate(x2, y, sampleRate, kart.shell, random);
    resonate(
      x3,
      y,
      sampleRate,
      [
        ...kart.plate,
        { f: 690, tau: 0.05, a: 0.04 },
        { f: 815, tau: 0.045, a: 0.035 },
      ],
      random,
    );
    resonate(
      x4,
      y,
      sampleRate,
      [
        { f: 450, tau: 0.0015, a: 1 },
        { f: 800, tau: 0.001, a: 0.8 },
      ],
      random,
    );
  },
  gravelLight(y, sampleRate, random) {
    for (let i = 0; i < 16; i += 1) {
      stone(
        y,
        sampleRate,
        random,
        0.001 + exponentialTime(random, 0.012, 0.05),
        0.3 + 0.7 * random(),
      );
    }
    for (let i = 0; i < 4; i += 1) {
      stone(y, sampleRate, random, 0.03 + random() * 0.06, 0.25 * random());
    }
  },
  // Stones knocked together under the tires, then scattered stones bouncing
  // back down.
  gravelHeavy(y, sampleRate, random) {
    const x = zeros(y);
    pulse(x, sampleRate, 0.001, 0.004, 0.6);
    resonate(
      x,
      y,
      sampleRate,
      [
        { f: 180, tau: 0.02, a: 1 },
        { f: 330, tau: 0.012, a: 0.5 },
      ],
      random,
    );
    for (let i = 0; i < 110; i += 1) {
      stone(
        y,
        sampleRate,
        random,
        0.001 + exponentialTime(random, 0.018, 0.08),
        random() ** 1.5,
      );
    }
    for (let i = 0; i < 26; i += 1) {
      const t = 0.05 + random() * 0.17;
      const a = 0.15 + 0.35 * random();
      stone(y, sampleRate, random, t, a);
      stone(y, sampleRate, random, t + 0.006 + random() * 0.009, a * 0.4);
    }
  },
  waterLight(y, sampleRate, random) {
    water(y, sampleRate, random, 0.5, 9, 20, 3, 0.05);
  },
  waterHeavy(y, sampleRate, random) {
    water(y, sampleRate, random, 1, 45, 140, 14, 0.12);
  },
  // The kart's side of a hit on something solid: the crack's contacts, with
  // the shell and the chassis plate damped as the hit presses them against
  // what they struck, so it reads as a dull knock rather than a hollow ring.
  knock(y, sampleRate, random, kart) {
    const x = zeros(y);
    const x2 = zeros(y);
    pulse(x, sampleRate, 0.0008, 0.0004, 1);
    pulse(x, sampleRate, 0.004 + random() * 0.0015, 0.0003, 0.2);
    pulse(x2, sampleRate, 0.0014, 0.0004, 0.5);
    resonate(x, y, sampleRate, damped(kart.shell, 0.5), random);
    resonate(x2, y, sampleRate, damped(kart.plate, 0.2), random);
  },
};

type Segment = { offset: number; duration: number };
type ImpactBank = {
  buffer: AudioBuffer;
  segments: Record<SegmentName, Segment>;
};

const banks = new WeakMap<BaseAudioContext, ImpactBank>();

function buildBank(context: BaseAudioContext): ImpactBank {
  const sampleRate = context.sampleRate;
  const random = seededRandom(0x7a175);
  const kart = kartModes(random);
  const layout = SEGMENTS.map(([name, seconds]) => ({
    name,
    length: Math.round(seconds * sampleRate),
  }));
  const total = layout.reduce((sum, { length }) => sum + length, 0);
  const buffer = context.createBuffer(1, total, sampleRate);
  const data = buffer.getChannelData(0);
  const segments = {} as Record<SegmentName, Segment>;
  let start = 0;
  for (const { name, length } of layout) {
    const y = new Float32Array(length);
    SYNTH[name](y, sampleRate, random, kart);
    const fade = Math.round(
      Math.min(0.06, length / sampleRate / 4) * sampleRate,
    );
    let peak = 1e-9;
    for (let i = 0; i < length; i += 1) {
      if (i > length - fade) {
        y[i] *= 0.5 - 0.5 * Math.cos((Math.PI * (length - i)) / fade);
      }
      peak = Math.max(peak, Math.abs(y[i]));
    }
    for (let i = 0; i < length; i += 1) data[start + i] = (0.9 * y[i]) / peak;
    segments[name] = {
      duration: length / sampleRate,
      offset: start / sampleRate,
    };
    start += length;
  }
  return { buffer, segments };
}

/** Renders the bank now, so the first hit of a race never stalls a frame. */
export function prepareImpactSounds(context: BaseAudioContext) {
  let bank = banks.get(context);
  if (!bank) {
    bank = buildBank(context);
    banks.set(context, bank);
  }
  return bank;
}

const between = (low: number, high: number) =>
  low + Math.random() * (high - low);

function gainInto(
  context: BaseAudioContext,
  value: number,
  destination: AudioNode,
  time: number,
) {
  const gain = context.createGain();
  gain.gain.setValueAtTime(value, time);
  gain.connect(destination);
  return gain;
}

// Starts one segment at `time`; `skip` jumps into the segment.
function playSegment(
  context: BaseAudioContext,
  bank: ImpactBank,
  name: SegmentName,
  destination: AudioNode,
  time: number,
  rate = 1,
  skip = 0,
) {
  const segment = bank.segments[name];
  const source = context.createBufferSource();
  source.buffer = bank.buffer;
  source.playbackRate.setValueAtTime(rate, time);
  source.connect(destination);
  source.start(time, segment.offset + skip, segment.duration - skip);
  source.stop(time + 1.45);
}

// Loose parts start knocking a few ms after the main contact on firm hits.
function playRattle(
  context: BaseAudioContext,
  bank: ImpactBank,
  output: AudioNode,
  time: number,
  level: number,
) {
  playSegment(
    context,
    bank,
    "rattle",
    gainInto(context, level, output, time),
    time + between(0.006, 0.016),
    between(0.92, 1.08),
    between(0, 0.025),
  );
}

const KART_CUTOFF: Record<
  Exclude<ImpactMaterial, "metal">,
  [number, number]
> = {
  concrete: [1000, 3500],
  soft: [450, 1400],
  wood: [700, 2000],
};
// What the struck object lets through: dull on concrete, a soil-backed
// board duller still, and the leaves of a hedge left bright.
const STRUCK_CUTOFF: Record<
  Exclude<ImpactMaterial, "metal">,
  [number, number]
> = {
  concrete: [1200, 3000],
  soft: [2500, 5000],
  wood: [500, 1200],
};
const KART_LEVEL: Record<Exclude<ImpactMaterial, "metal">, number> = {
  concrete: 0.85,
  soft: 0.35,
  wood: 0.5,
};
const STRUCK: Record<
  Exclude<ImpactMaterial, "metal">,
  [SegmentName, number]
> = {
  concrete: ["concrete", 0.55],
  soft: ["foliage", 0.28],
  wood: ["wood", 0.7],
};

/** `strength` 0–1: 0.05 a light brush, 0.3 a firm tap, 1 head-on at top speed. */
export function playImpactSound(
  context: BaseAudioContext,
  output: AudioNode,
  strength: number,
  material: ImpactMaterial,
  time: number,
) {
  const bank = prepareImpactSounds(context);
  const s = Math.min(1, Math.max(0, strength));
  const level = 0.06 + 0.94 * Math.pow(s, 0.85);
  const kart: SegmentName = s < between(0.1, 0.18) ? "brush" : "knock";
  // Loose parts rattle only on hard hits; a firm tap stays a dull knock.
  const shake = Math.min(1, Math.max(0, (s - 0.4) / 0.5));

  if (material === "metal") {
    // Plastic on steel: the steel rings, and harder hits excite the rail's
    // high modes more.
    playSegment(
      context,
      bank,
      kart,
      gainInto(context, level * 0.45 * between(0.85, 1.1), output, time),
      time,
      between(0.86, 0.94),
    );
    playSegment(
      context,
      bank,
      "drum",
      gainInto(
        context,
        level * 0.85 * between(0.3, 1) * Math.pow(s, 0.1),
        output,
        time,
      ),
      time,
      between(0.93, 1.07),
    );
    playSegment(
      context,
      bank,
      "rail",
      gainInto(
        context,
        level * 0.65 * between(0.3, 1) * Math.pow(s, 0.3),
        output,
        time,
      ),
      time,
      between(0.92, 1.08),
    );
    if (shake > 0) {
      playRattle(context, bank, output, time, level * 0.35 * shake);
    }
    return;
  }

  // Contact stiffness sets how bright the kart's own knock is: shortest on
  // concrete, softer on timber, a muffled push into foliage. Contact also
  // shortens as speed rises, so strength opens the filter.
  const [low, high] = KART_CUTOFF[material];
  const lowpass = context.createBiquadFilter();
  lowpass.type = "lowpass";
  lowpass.Q.setValueAtTime(0, time);
  lowpass.frequency.setValueAtTime(low + (high - low) * Math.pow(s, 0.7), time);
  lowpass.connect(
    gainInto(
      context,
      level * KART_LEVEL[material] * between(0.85, 1.1),
      output,
      time,
    ),
  );
  playSegment(context, bank, kart, lowpass, time, between(0.96, 1.04));

  const [struck, struckLevel] = STRUCK[material];
  const materialLevel =
    material === "soft" ? 0.35 + 0.65 * s : Math.pow(s, 0.15);
  const [struckLow, struckHigh] = STRUCK_CUTOFF[material];
  const struckLowpass = context.createBiquadFilter();
  struckLowpass.type = "lowpass";
  struckLowpass.Q.setValueAtTime(0, time);
  struckLowpass.frequency.setValueAtTime(
    struckLow + (struckHigh - struckLow) * s,
    time,
  );
  struckLowpass.connect(
    gainInto(
      context,
      level * struckLevel * materialLevel * between(0.85, 1.1),
      output,
      time,
    ),
  );
  playSegment(
    context,
    bank,
    struck,
    struckLowpass,
    time,
    material === "soft" ? between(1.1, 1.25) - 0.25 * s : between(0.94, 1.06),
  );
  if (shake > 0) {
    playRattle(
      context,
      bank,
      output,
      time,
      level * (material === "soft" ? 0.1 : 0.25) * shake,
    );
  }
}

const TIRE_LEVEL: Record<AudioSurface, number> = {
  asphalt: 1,
  concrete: 1,
  grass: 0.5,
  gravel: 0.65,
  water: 0.45,
};

/** `strength` 0–1: 0.1 a small hop, 1 the spin jump's landing (about 1 m). */
/**
 * A course door's own sounds, `strength` 0–1. Its latch gives with a short
 * metal clack and the plate's ring; its leaf meets a rubber stop, or its
 * frame, with a dull thud whose weight is the leaf's. Five nodes at most.
 */
export function playDoorSound(
  context: BaseAudioContext,
  output: AudioNode,
  kind: "latch" | "stop",
  strength: number,
  time: number,
) {
  const bank = prepareImpactSounds(context);
  const s = Math.min(1, Math.max(0, strength));
  const level = 0.1 + 0.9 * Math.pow(s, 0.8);
  if (kind === "latch") {
    playSegment(
      context,
      bank,
      "crack",
      gainInto(context, level * 0.7, output, time),
      time,
      between(1.25, 1.4),
    );
    playSegment(
      context,
      bank,
      "rail",
      gainInto(context, level * 0.25, output, time),
      time,
      between(1.1, 1.2),
    );
    return;
  }
  const lowpass = context.createBiquadFilter();
  lowpass.type = "lowpass";
  lowpass.Q.setValueAtTime(0, time);
  lowpass.frequency.setValueAtTime(220 + 380 * s, time);
  lowpass.connect(gainInto(context, level * 0.9, output, time));
  playSegment(context, bank, "drum", lowpass, time, between(0.55, 0.62));
}

export function playLandingSound(
  context: BaseAudioContext,
  output: AudioNode,
  strength: number,
  surface: AudioSurface,
  time: number,
) {
  const bank = prepareImpactSounds(context);
  const s = Math.min(1, Math.max(0, strength));
  const level = 0.1 + 0.9 * Math.pow(s, 0.8);
  const hard = surface === "asphalt" || surface === "concrete";

  // Turf swallows the high end of everything that touches it.
  let bus: AudioNode = output;
  if (surface === "grass") {
    const lowpass = context.createBiquadFilter();
    lowpass.type = "lowpass";
    lowpass.Q.setValueAtTime(0, time);
    lowpass.frequency.setValueAtTime(2200 + 1500 * s, time);
    lowpass.connect(output);
    bus = lowpass;
  }

  // Two axles touch down a few ms apart (less on a flat, heavy landing).
  const gap = (0.028 - 0.016 * s) * between(0.4, 1.3);
  const tires = gainInto(
    context,
    level * 0.7 * TIRE_LEVEL[surface] * between(0.9, 1.1),
    bus,
    time,
  );
  const first = Math.random() < 0.5 ? 0 : gap;
  playSegment(context, bank, "tire", tires, time + first, between(0.95, 1.05));
  playSegment(
    context,
    bank,
    "tire",
    tires,
    time + gap - first,
    between(0.95, 1.05),
  );

  // What the surface itself does.
  const [name, gain, rate]: [SegmentName, number, number] =
    surface === "asphalt"
      ? ["gravelLight", 0.25 + 0.2 * s, between(1.3, 1.45)]
      : surface === "concrete"
        ? ["concrete", 0.35 + 0.2 * s, between(1.05, 1.15)]
        : surface === "grass"
          ? ["foliage", 0.3, between(0.68, 0.78)]
          : surface === "gravel"
            ? [
                s < between(0.35, 0.5) ? "gravelLight" : "gravelHeavy",
                0.8,
                between(0.93, 1.07),
              ]
            : [
                s < between(0.3, 0.45) ? "waterLight" : "waterHeavy",
                0.9,
                between(0.92, 1.08),
              ];
  playSegment(
    context,
    bank,
    name,
    gainInto(context, level * gain * between(0.85, 1.1), bus, time),
    time,
    rate,
  );

  // Heavy landings bottom the skid plate on hard ground and shake loose parts.
  const shake = Math.max(0, (s - 0.3) / 0.7);
  const slap = hard && s > 0.45;
  if (!shake && !slap) return;
  const loose = gainInto(
    context,
    level * (surface === "grass" ? 0.15 : 0.32) * Math.max(shake, 0.3),
    output,
    time,
  );
  if (slap) {
    playSegment(
      context,
      bank,
      "crack",
      loose,
      time + Math.max(first, gap - first) + between(0.003, 0.008),
      between(0.72, 0.82),
    );
  }
  if (shake) {
    playSegment(
      context,
      bank,
      "rattle",
      loose,
      time + between(0.01, 0.02),
      between(0.92, 1.08),
      between(0, 0.025),
    );
  }
}

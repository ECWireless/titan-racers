import {
  cachedBuffer,
  chain,
  clamp,
  continuousVoice,
  createParameterSmoother,
  filterNode,
  gainNode,
  loopSource,
  noiseBuffer,
  seededRandom,
  smoothstep,
} from "./audio-synthesis";
import type { AudioSurface, AudioWheel } from "./race-audio-mapping";

/**
 * Small rubber RC tires rolling and scrubbing. Each voice sums the four
 * wheels by surface, so it costs the same however the kart is supported.
 */

// Pebble ticks (tiny stones ringing for 1–3 ms at 2–7 kHz) over the granular
// crunch of stones grinding against each other (300–1500 Hz grains).
function gravelBuffer(context: BaseAudioContext) {
  return cachedBuffer(context, "gravel", 0.95, (data, sampleRate) => {
    const random = seededRandom(23);
    const length = data.length;
    const grains = Math.round((length / sampleRate) * 320);
    for (let g = 0; g < grains; g += 1) {
      const start = Math.floor(random() * length);
      const grainLength = Math.floor(sampleRate * (0.004 + random() * 0.014));
      const amplitude = 0.08 + 0.3 * random() ** 2;
      const colour = 0.08 + random() * 0.25; // one-pole lowpass coefficient
      let filtered = 0;
      for (let i = 0; i < grainLength; i += 1) {
        filtered += colour * (random() * 2 - 1 - filtered);
        data[(start + i) % length] +=
          amplitude * filtered * Math.sin((Math.PI * i) / grainLength) * 3;
      }
    }
    const ticks = Math.round((length / sampleRate) * 110);
    for (let p = 0; p < ticks; p += 1) {
      const start = Math.floor(random() * length);
      const frequency = 2000 * 3.5 ** random();
      const decay = sampleRate * (0.0006 + random() * 0.0022);
      // No standout ticks to betray the loop.
      const amplitude = 0.3 + 0.7 * random() ** 2;
      const phase = random() * Math.PI * 2;
      for (let i = 0; i < decay * 6; i += 1) {
        data[(start + i) % length] +=
          amplitude *
          Math.exp(-i / decay) *
          Math.sin((2 * Math.PI * frequency * i) / sampleRate + phase);
      }
    }
  });
}

// Sloshing low gurgle, Minnaert bubble chirps, and high spray hiss. Envelopes
// use whole cycles per loop so the buffer loops seamlessly.
function waterBuffer(context: BaseAudioContext) {
  return cachedBuffer(context, "water", 0.9, (data, sampleRate) => {
    const random = seededRandom(37);
    const length = data.length;
    const period = length / sampleRate;
    const slosh: Array<[number, number, number]> = [];
    for (let k = 2; k <= 9; k += 1) {
      slosh.push([k / period, random() * Math.PI * 2, 0.5 / k ** 0.5]);
    }
    const spray: Array<[number, number, number]> = [];
    for (let k = 3; k <= 14; k += 1) {
      spray.push([k / period, random() * Math.PI * 2, 0.4 / k ** 0.4]);
    }
    let low1 = 0;
    let low2 = 0;
    let previous = 0;
    let sprayFiltered = 0;
    for (let i = 0; i < length; i += 1) {
      const time = i / sampleRate;
      let envelope = 0.35;
      for (const [f, phase, a] of slosh) {
        envelope += a * Math.sin(2 * Math.PI * f * time + phase);
      }
      let sprayEnvelope = 0.3;
      for (const [f, phase, a] of spray) {
        sprayEnvelope += a * Math.sin(2 * Math.PI * f * time + phase);
      }
      const white = random() * 2 - 1;
      low1 += 0.09 * (white - low1);
      low2 += 0.09 * (low1 - low2);
      // Differenced noise, lowpassed: 1–6 kHz spray.
      sprayFiltered += 0.45 * (white - previous - sprayFiltered);
      previous = white;
      data[i] =
        2.2 * low2 * Math.max(0, envelope) +
        1.1 * sprayFiltered * Math.max(0, sprayEnvelope) ** 1.5;
    }
    const bubbles = Math.round(period * 75);
    for (let b = 0; b < bubbles; b += 1) {
      const start = Math.floor(random() * length);
      const f0 = 450 * 5.5 ** random(); // bubble radius about 1–7 mm
      const tau = 0.0025 + 5 / f0; // larger bubbles ring longer
      const amplitude = (0.15 + 0.5 * random() ** 2) * Math.min(1, 900 / f0);
      let phase = 0;
      for (let i = 0; i < tau * 5 * sampleRate; i += 1) {
        const time = i / sampleRate;
        // Rising chirp near the surface.
        phase += (2 * Math.PI * f0 * (1 + 0.12 * (time / tau))) / sampleRate;
        data[(start + i) % length] +=
          amplitude * Math.exp(-time / tau) * Math.sin(phase);
      }
    }
  });
}

type SurfaceLevels = Record<AudioSurface, number>;
const emptyLevels = (): SurfaceLevels => ({
  asphalt: 0,
  concrete: 0,
  grass: 0,
  gravel: 0,
  water: 0,
});
// Each voice reuses one levels object, so updates allocate nothing.
const clearLevels = (levels: SurfaceLevels) => {
  levels.asphalt = 0;
  levels.concrete = 0;
  levels.grass = 0;
  levels.gravel = 0;
  levels.water = 0;
  return levels;
};
const usable = (wheel: AudioWheel) =>
  wheel.supported && wheel.surface !== null && wheel.speed > 0.05;

const TREAD_PITCH_M = 0.0065;

/**
 * How a small rubber tire sounds on asphalt, picked by listening over a
 * dry rasp and a low road roar: a soft hiss under the tread blocks' whir,
 * which rises in pitch with speed, and a little fine grit.
 */
const ASPHALT = {
  /** Grit ticks from the grain buffer, through a high band, Hz. */
  gritFrequency: [2200, 500],
  gritLevel: 0.14,
  /** Broad noise band: centre at rest and its rise to top speed, Hz. */
  hissFrequency: [600, 500],
  hissLevel: 0.525,
  hissQ: 0.8,
  /** The tread blocks' whir at speed over tread pitch. */
  treadLevel: 0.612,
  treadQ: 3,
} as const;
// Asphalt and concrete take their levels from ASPHALT and the hard-ground
// layers below.
const ROLL_LEVEL = { grass: 0.55, gravel: 1.5, water: 1.8 };

/**
 * Hard surfaces: a broadband hiss whose band rises with speed, plus a tread
 * "sing" at speed over tread pitch. Turf: a softer swish with random blade
 * modulation. Gravel: the grain buffer. Water: gurgle, bubbles, and spray.
 * 16 nodes.
 */
export function createTireRollVoice(
  context: BaseAudioContext,
  output: AudioNode,
) {
  const noise = noiseBuffer(context);
  const source = loopSource(context, noise, 1, 0);
  const hardFilter = filterNode(context, "bandpass", 3000, 0.6);
  const hardGain = gainNode(context);
  const treadFilter = filterNode(context, "bandpass", 1200, 6);
  const treadGain = gainNode(context);
  const grassFilter = filterNode(context, "bandpass", 1200, 0.8);
  const grassGain = gainNode(context);
  const blades = loopSource(context, noise, 0.0004, 0.5);
  const bladeDepth = gainNode(context);
  const gravelSource = loopSource(context, gravelBuffer(context), 1, 0);
  // Grains: a crunch on gravel, fine grit ticks on asphalt and concrete.
  const gravelFilter = filterNode(context, "bandpass", 900, 0.5);
  const gravelGain = gainNode(context);
  const waterSource = loopSource(context, waterBuffer(context), 1, 0.2);
  const waterFilter = filterNode(context, "bandpass", 1500, 0.4);
  const waterGain = gainNode(context);
  // Random slosh, so the water loop never repeats audibly.
  const waterDepth = gainNode(context);

  chain(source, hardFilter, hardGain, output);
  chain(source, treadFilter, treadGain, output);
  chain(source, grassFilter, grassGain, output);
  blades.connect(bladeDepth).connect(grassGain.gain);
  chain(gravelSource, gravelFilter, gravelGain, output);
  chain(waterSource, waterFilter, waterGain, output);
  blades.connect(waterDepth).connect(waterGain.gain);

  const set = createParameterSmoother();
  const surfaceLevels = emptyLevels();
  const nodes = [
    source,
    hardFilter,
    hardGain,
    treadFilter,
    treadGain,
    grassFilter,
    grassGain,
    blades,
    bladeDepth,
    gravelSource,
    gravelFilter,
    gravelGain,
    waterSource,
    waterFilter,
    waterGain,
    waterDepth,
  ];
  return continuousVoice<readonly AudioWheel[]>(
    nodes,
    [source, blades, gravelSource, waterSource],
    (wheels, time) => {
      const levels = clearLevels(surfaceLevels);
      let total = 0;
      let speedSum = 0;
      for (const wheel of wheels) {
        if (!usable(wheel)) continue;
        const speed = Math.min(wheel.speed, 20) / 17;
        const amplitude = (speed ** 1.3 * (0.55 + 0.9 * clamp(wheel.load))) / 4;
        levels[wheel.surface!] += amplitude;
        total += amplitude;
        speedSum += speed * amplitude;
      }
      const speed = total > 0 ? speedSum / total : 0;
      const hard = levels.asphalt + levels.concrete;
      const concreteShare = hard > 0 ? levels.concrete / hard : 0;
      const tau = 0.05;

      // Hard ground: a broad, dry noise band with fine grit and the tread's
      // whir, never a steady high hiss (fatiguing) or soft low blips (they
      // read as water). Concrete is smoother: a little higher, less grit.
      // The noise plays faster with speed, so its loop never settles into a
      // pattern.
      set(source.playbackRate, 0.8 + 0.4 * speed, time, tau);
      set(
        hardFilter.frequency,
        ASPHALT.hissFrequency[0] +
          ASPHALT.hissFrequency[1] * speed +
          concreteShare * (400 + 400 * speed),
        time,
        tau,
      );
      set(hardFilter.Q, ASPHALT.hissQ + 0.3 * concreteShare, time, tau);
      set(
        hardGain.gain,
        (levels.asphalt * ASPHALT.hissLevel + levels.concrete * 0.4) * 0.75,
        time,
        tau,
      );
      set(
        treadFilter.frequency,
        Math.max(80, (speed * 17) / TREAD_PITCH_M),
        time,
        tau,
      );
      set(treadFilter.Q, ASPHALT.treadQ, time, tau);
      set(
        treadGain.gain,
        (levels.asphalt * ASPHALT.treadLevel + levels.concrete * 0.25) * 0.9,
        time,
        tau,
      );

      const grass = levels.grass * ROLL_LEVEL.grass * 1.2;
      set(grassFilter.frequency, 500 + 900 * speed, time, tau);
      set(grassGain.gain, grass, time, tau);
      set(bladeDepth.gain, grass * 0.8, time, tau);
      set(blades.playbackRate, 0.00015 + 0.0007 * speed, time, tau);

      // Gravel's crunch, and the fine grit of asphalt and concrete, share
      // the grain buffer: the grit only through a high band, as ticks.
      const gravelGrains = levels.gravel * ROLL_LEVEL.gravel;
      const grains =
        gravelGrains +
        levels.asphalt * ASPHALT.gritLevel +
        levels.concrete * ASPHALT.gritLevel * 0.3;
      const gravelShare = grains > 0 ? gravelGrains / grains : 0;
      set(gravelGain.gain, grains * 0.9, time, tau);
      set(gravelSource.playbackRate, 0.65 + 0.6 * speed, time, tau);
      set(
        gravelFilter.frequency,
        gravelShare * (900 + 600 * speed) +
          (1 - gravelShare) *
            (ASPHALT.gritFrequency[0] + ASPHALT.gritFrequency[1] * speed),
        time,
        tau,
      );

      const water = levels.water * ROLL_LEVEL.water * 1.35;
      set(waterGain.gain, water, time, tau);
      set(waterDepth.gain, water * 0.7, time, tau);
      set(waterSource.playbackRate, 0.8 + 0.4 * speed, time, tau);
      set(waterFilter.frequency, 900 + 2600 * speed, time, tau);
    },
  );
}

const SQUEAL: Partial<Record<AudioSurface, number>> = {
  asphalt: 0.6,
  concrete: 1,
};

/**
 * Hard surfaces: a broadband rubber scuff plus a stick-slip squeal (two
 * narrow, inharmonic noise bands with a jittering centre). A locked wheel
 * skids: the squeal drops and steadies, and the scuff dominates. Turf tears,
 * gravel sprays pebbles, and water hisses. 16 nodes.
 */
export function createScrubVoice(context: BaseAudioContext, output: AudioNode) {
  const noise = noiseBuffer(context);
  const source = loopSource(context, noise, 1, 0.75);
  const scuffFilter = filterNode(context, "bandpass", 2600, 0.8);
  const scuffGain = gainNode(context);
  const squealA = filterNode(context, "bandpass", 2000, 18);
  const squealB = filterNode(context, "bandpass", 3000, 40);
  const squealGain = gainNode(context);
  const tearFilter = filterNode(context, "bandpass", 900, 0.6);
  const tearGain = gainNode(context);
  const rip = loopSource(context, noise, 0.0016, 0.1); // about 70 Hz-wide random
  const tearDepth = gainNode(context);
  const wobble = gainNode(context, 40);
  const gravelSource = loopSource(context, gravelBuffer(context), 1.3, 0.35);
  const gravelFilter = filterNode(context, "bandpass", 2400, 0.5);
  const gravelGain = gainNode(context);
  const sprayFilter = filterNode(context, "bandpass", 3000, 0.8);
  const sprayGain = gainNode(context);

  chain(source, scuffFilter, scuffGain, output);
  chain(source, squealA, squealGain, output);
  chain(source, squealB, squealGain);
  chain(source, tearFilter, tearGain, output);
  rip.connect(tearDepth).connect(tearGain.gain);
  rip.connect(wobble);
  wobble.connect(squealA.detune);
  wobble.connect(squealB.detune);
  chain(gravelSource, gravelFilter, gravelGain, output);
  chain(source, sprayFilter, sprayGain, output);

  const set = createParameterSmoother();
  const surfaceLevels = emptyLevels();
  const nodes = [
    source,
    scuffFilter,
    scuffGain,
    squealA,
    squealB,
    squealGain,
    tearFilter,
    tearGain,
    rip,
    tearDepth,
    wobble,
    gravelSource,
    gravelFilter,
    gravelGain,
    sprayFilter,
    sprayGain,
  ];
  return continuousVoice<readonly AudioWheel[]>(
    nodes,
    [source, rip, gravelSource],
    (wheels, time) => {
      const levels = clearLevels(surfaceLevels);
      let squeal = 0;
      let squealPitch = 0;
      let lockedEnergy = 0;
      let total = 0;
      for (const wheel of wheels) {
        if (!usable(wheel)) continue;
        const slip = wheel.locked
          ? Math.max(clamp(wheel.scrub), 0.55)
          : clamp(wheel.scrub);
        if (slip <= 0.001) continue;
        const speedFactor = Math.sqrt(Math.min(wheel.speed, 17) / 17);
        const press = 0.6 + 0.8 * clamp(wheel.load);
        const energy = (slip * speedFactor * press) / 4;
        const surface = wheel.surface!;
        levels[surface] += energy;
        total += energy;
        if (wheel.locked) lockedEnergy += energy;
        const squealLevel = SQUEAL[surface];
        if (squealLevel !== undefined) {
          // Squeal peaks near the grip limit and turns to roar in a full slide.
          const amount =
            (smoothstep(0.05, 0.55, slip) *
              (1 - 0.35 * slip * slip) *
              speedFactor *
              press *
              squealLevel) /
            4;
          squeal += amount;
          squealPitch +=
            amount *
            (surface === "concrete" ? 1800 : 1500) *
            (1 + 0.12 * speedFactor);
        }
      }
      const locked = total > 0 ? lockedEnergy / total : 0;
      const pitch =
        squeal > 0 ? (squealPitch / squeal) * (1 - 0.4 * locked) : 2000;
      const tau = 0.035;

      const hard = levels.asphalt + levels.concrete * 0.85;
      set(
        scuffGain.gain,
        (hard * (1 + 0.6 * locked) + 0.15 * (levels.grass + levels.gravel)) *
          1.1,
        time,
        tau,
      );
      set(
        scuffFilter.frequency,
        (levels.concrete > levels.asphalt ? 2000 : 1500) * (1 - 0.3 * locked),
        time,
        tau,
      );
      set(squealA.frequency, pitch, time, tau);
      // The second squeal band a fifth up, not an octave: a chirp that sits
      // in the range a tire actually sings, without a piercing top.
      set(squealB.frequency, pitch * 1.5, time, tau);
      set(squealGain.gain, squeal * (1 - 0.35 * locked) * 5, time, tau);
      set(wobble.gain, 25 + 55 * (1 - locked), time, tau);

      const tear = levels.grass * 2.2;
      set(tearGain.gain, tear, time, tau);
      set(tearDepth.gain, tear * 0.95, time, tau);
      set(gravelGain.gain, levels.gravel * 3.6, time, tau);
      set(sprayGain.gain, levels.water * 2.4, time, tau);
    },
  );
}

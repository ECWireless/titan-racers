/**
 * Shared building blocks for the generated race sounds. Every sound is
 * synthesized in code from oscillators, periodic waves, and a few buffers
 * generated once per audio context; nothing is downloaded.
 */

export function clamp(value: number | undefined, minimum = 0, maximum = 1) {
  const finite = Number.isFinite(value) ? (value as number) : 0;
  return Math.min(maximum, Math.max(minimum, finite));
}

export function smoothstep(edge0: number, edge1: number, value: number) {
  const progress = clamp((value - edge0) / (edge1 - edge0));
  return progress * progress * (3 - 2 * progress);
}

/** Deterministic generator, so generated buffers match on every run. */
export function seededRandom(seed: number) {
  let state = seed;
  return () => {
    state = (state + 0x6d2b79f5) | 0;
    let mixed = Math.imul(state ^ (state >>> 15), 1 | state);
    mixed = (mixed + Math.imul(mixed ^ (mixed >>> 7), 61 | mixed)) ^ mixed;
    return ((mixed ^ (mixed >>> 14)) >>> 0) / 4294967296;
  };
}

const contextCache = new WeakMap<BaseAudioContext, Map<string, unknown>>();

function cached<T>(context: BaseAudioContext, key: string, create: () => T) {
  let entries = contextCache.get(context);
  if (!entries) {
    entries = new Map();
    contextCache.set(context, entries);
  }
  if (!entries.has(key)) entries.set(key, create());
  return entries.get(key) as T;
}

/** A mono buffer filled once per context and normalized to a 0.95 peak. */
export function cachedBuffer(
  context: BaseAudioContext,
  key: string,
  seconds: number,
  fill: (data: Float32Array, sampleRate: number) => void,
) {
  return cached(context, `buffer:${key}`, () => {
    const length = Math.round(seconds * context.sampleRate);
    const buffer = context.createBuffer(1, length, context.sampleRate);
    const data = buffer.getChannelData(0);
    fill(data, context.sampleRate);
    let peak = 0;
    for (const value of data) peak = Math.max(peak, Math.abs(value));
    if (peak > 0)
      for (let i = 0; i < data.length; i += 1) data[i] *= 0.95 / peak;
    return buffer;
  });
}

/** A periodic wave from `{ harmonicNumber: amplitude }`, in sine phase. */
export function cachedWave(
  context: BaseAudioContext,
  key: string,
  partials: Record<number, number>,
) {
  return cached(context, `wave:${key}`, () => {
    const size = Math.max(...Object.keys(partials).map(Number)) + 1;
    const real = new Float32Array(size);
    const imag = new Float32Array(size);
    for (const [harmonic, amplitude] of Object.entries(partials)) {
      imag[Number(harmonic)] = amplitude;
    }
    return context.createPeriodicWave(real, imag);
  });
}

export function cachedCurve(
  context: BaseAudioContext,
  key: string,
  create: () => Float32Array<ArrayBuffer>,
) {
  return cached(context, `curve:${key}`, create);
}

export function noiseBuffer(context: BaseAudioContext) {
  return cachedBuffer(context, "noise", 1.5, (data) => {
    const random = seededRandom(11);
    for (let i = 0; i < data.length; i += 1) data[i] = random() * 2 - 1;
  });
}

export function gainNode(context: BaseAudioContext, value = 0) {
  const node = context.createGain();
  node.gain.value = value;
  return node;
}

export function filterNode(
  context: BaseAudioContext,
  type: BiquadFilterType,
  frequency: number,
  q = 0.707,
) {
  const node = context.createBiquadFilter();
  node.type = type;
  node.frequency.value = frequency;
  node.Q.value = q;
  return node;
}

export function loopSource(
  context: BaseAudioContext,
  buffer: AudioBuffer,
  rate: number,
  offset: number,
) {
  const source = context.createBufferSource();
  source.buffer = buffer;
  source.loop = true;
  source.playbackRate.value = rate;
  source.start(0, offset);
  return source;
}

export function chain(...nodes: AudioNode[]) {
  for (let i = 0; i < nodes.length - 1; i += 1) nodes[i].connect(nodes[i + 1]);
}

/**
 * Smoothed parameter writes that skip values that would not change anything,
 * so per-frame updates with steady state cost almost nothing.
 */
export function createParameterSmoother() {
  const last = new Map<AudioParam, number>();
  return (
    param: AudioParam,
    value: number,
    time: number,
    timeConstant: number,
  ) => {
    const previous = last.get(param);
    if (
      previous !== undefined &&
      Math.abs(previous - value) <= 1e-4 * Math.max(1e-3, Math.abs(value))
    ) {
      return;
    }
    last.set(param, value);
    param.setTargetAtTime(value, time, timeConstant);
  };
}

type ContinuousVoice<State> = {
  update: (state: State, time: number) => void;
  dispose: () => void;
};

export function continuousVoice<State>(
  nodes: AudioNode[],
  sources: AudioScheduledSourceNode[],
  update: (state: State, time: number) => void,
): ContinuousVoice<State> {
  return {
    update,
    dispose() {
      for (const source of sources) {
        try {
          source.stop();
        } catch {
          // Already stopped.
        }
      }
      for (const node of nodes) node.disconnect();
    },
  };
}

/** One envelope hit: a linear rise, an optional hold, then exponential decay. */
export type EnvelopeHit = {
  at: number;
  attack: number;
  hold?: number;
  peak: number;
  tau: number;
};

/**
 * Writes a sum of hits as one value curve over `duration`, fading its last
 * 5% to zero so stopping the sources never clicks.
 */
export function applyEnvelope(
  param: AudioParam,
  time: number,
  duration: number,
  hits: readonly EnvelopeHit[],
  points = 900,
) {
  const curve = new Float32Array(points);
  for (let i = 0; i < points; i += 1) {
    const at = (i / (points - 1)) * duration;
    let value = 0;
    for (const hit of hits) {
      const since = at - hit.at;
      if (since < 0) continue;
      const holdEnd = hit.attack + (hit.hold ?? 0);
      if (since < hit.attack) value += (hit.peak * since) / hit.attack;
      else
        value +=
          since < holdEnd
            ? hit.peak
            : hit.peak * Math.exp(-(since - holdEnd) / hit.tau);
    }
    curve[i] = value;
  }
  const fade = Math.floor(points * 0.05);
  for (let i = 0; i < fade; i += 1) curve[points - 1 - i] *= i / fade;
  param.setValueCurveAtTime(curve, time, duration);
}

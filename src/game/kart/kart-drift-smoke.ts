import * as pc from "playcanvas";

import type { DynamicWheelTelemetry } from "./dynamic-kart-controller";
import {
  REFERENCE_KART_MASS_SCALE,
  scaleReferenceKartLength,
} from "./kart-reference-construction";

const DRIFT_SMOKE_PARTICLE_LIFETIME = 0.72;
const DRIFT_SMOKE_PARTICLE_COUNT = 8;
const DRIFT_SMOKE_LOCAL_Y = scaleReferenceKartLength(-0.18);
const DRIFT_SMOKE_LOCAL_Z = scaleReferenceKartLength(0.08);
const COUNTDOWN_SMOKE_LOCAL_Y = scaleReferenceKartLength(0.45);
const COUNTDOWN_SMOKE_LOCAL_Z = scaleReferenceKartLength(0.35);

/** Shared presentation policy. These values do not alter tire forces or grip. */
export const KART_TIRE_SMOKE_POLICY = Object.freeze({
  countdownThrottleOnset: 0.35,
  heavyAlpha: 0.2,
  heavyTailAlpha: 0.13,
  lateralScrubPowerFullWatts: 770 * REFERENCE_KART_MASS_SCALE,
  lateralScrubPowerOnsetWatts: 165 * REFERENCE_KART_MASS_SCALE,
  lightAlpha: 0.24,
  lightTailAlpha: 0.15,
  releaseThresholdRatio: 0.75,
  // Smoke is a stylized screen-readable cue, not miniature solid geometry.
  // Its positions use construction scale, while particle size shrinks less
  // aggressively so the plume remains legible behind the RC kart.
  visualLinearScale: 0.5,
});

export type KartTireSmokePolicy = typeof KART_TIRE_SMOKE_POLICY;

type TireSmokeWheelSample = Pick<
  DynamicWheelTelemetry,
  | "appliedLateralTireForce"
  | "driven"
  | "lateralSpeed"
  | "name"
  | "supported"
>;

export type TireSmokeIntent = {
  countdownThrottle: number;
};

const NEUTRAL_TIRE_SMOKE_INTENT: TireSmokeIntent = {
  countdownThrottle: 0,
};

type DriftSmokeWheelMount = {
  name: string;
  pivot: pc.Entity;
};

type DriftSmokeEmitter = {
  active: boolean;
  component: pc.ParticleSystemComponent;
  entity: pc.Entity;
  level: 1 | 2;
  wheelName: string;
};

function clamp(value: number, minimum: number, maximum: number) {
  return Math.min(Math.max(value, minimum), maximum);
}

function smoothstep(value: number) {
  const clamped = clamp(value, 0, 1);
  return clamped * clamped * (3 - 2 * clamped);
}

export function getLateralScrubPower(wheel: TireSmokeWheelSample) {
  return (
    Math.abs(wheel.appliedLateralTireForce) * Math.abs(wheel.lateralSpeed)
  );
}

export function getDriftSmokeLevel(
  wheel: TireSmokeWheelSample,
  previousLevel = 0,
  policy: KartTireSmokePolicy = KART_TIRE_SMOKE_POLICY,
) {
  if (!wheel.name.startsWith("rear") || !wheel.supported) {
    return 0;
  }

  const releaseThreshold =
    policy.lateralScrubPowerOnsetWatts * policy.releaseThresholdRatio;
  const activationThreshold =
    previousLevel > 0
      ? releaseThreshold
      : policy.lateralScrubPowerOnsetWatts;
  const scrubPower = getLateralScrubPower(wheel);

  if (scrubPower < activationThreshold) {
    return 0;
  }

  const densityProgress =
    (scrubPower - releaseThreshold) /
    (policy.lateralScrubPowerFullWatts - releaseThreshold);

  return 2 * smoothstep(densityProgress);
}

export function getCountdownSmokeLevel(
  wheel: TireSmokeWheelSample,
  throttleDemand: number,
  wasActive = false,
  policy: KartTireSmokePolicy = KART_TIRE_SMOKE_POLICY,
) {
  if (!wheel.name.startsWith("rear") || !wheel.driven || !wheel.supported) {
    return 0;
  }

  const minimumThrottle = wasActive
    ? policy.countdownThrottleOnset * policy.releaseThresholdRatio
    : policy.countdownThrottleOnset;

  return throttleDemand >= minimumThrottle ? 2 : 0;
}

export function getTireSmokeLevel(
  wheel: TireSmokeWheelSample,
  intent: TireSmokeIntent = NEUTRAL_TIRE_SMOKE_INTENT,
  previousLevel = 0,
  policy: KartTireSmokePolicy = KART_TIRE_SMOKE_POLICY,
) {
  return Math.max(
    getDriftSmokeLevel(wheel, previousLevel, policy),
    getCountdownSmokeLevel(
      wheel,
      intent.countdownThrottle,
      previousLevel > 0,
      policy,
    ),
  );
}

export function shouldEmitDriftSmoke(
  wheel: TireSmokeWheelSample,
  wasActive = false,
  policy: KartTireSmokePolicy = KART_TIRE_SMOKE_POLICY,
) {
  return getDriftSmokeLevel(wheel, wasActive ? 1 : 0, policy) > 0;
}

function createSmokeEmitter(
  mount: DriftSmokeWheelMount,
  level: 1 | 2,
): DriftSmokeEmitter {
  const layerName = level === 1 ? "light" : "heavy";
  const entity = new pc.Entity(`kart-drift-smoke-${layerName}-${mount.name}`);
  entity.setLocalPosition(0, DRIFT_SMOKE_LOCAL_Y, DRIFT_SMOKE_LOCAL_Z);
  mount.pivot.addChild(entity);

  const alphaGraph = new pc.Curve([
    0,
    0,
    0.12,
    level === 1
      ? KART_TIRE_SMOKE_POLICY.lightAlpha
      : KART_TIRE_SMOKE_POLICY.heavyAlpha,
    0.58,
    level === 1
      ? KART_TIRE_SMOKE_POLICY.lightTailAlpha
      : KART_TIRE_SMOKE_POLICY.heavyTailAlpha,
    1,
    0,
  ]);
  alphaGraph.type = pc.CURVE_SMOOTHSTEP;

  const colorGraph = new pc.CurveSet([
    [0, 0.62, 1, 0.74],
    [0, 0.64, 1, 0.76],
    [0, 0.66, 1, 0.78],
  ]);
  colorGraph.type = pc.CURVE_LINEAR;

  const scaleGraph = new pc.Curve([
    0,
    0.12 * KART_TIRE_SMOKE_POLICY.visualLinearScale,
    0.35,
    0.26 * KART_TIRE_SMOKE_POLICY.visualLinearScale,
    1,
    (level === 1 ? 0.48 : 0.55) *
      KART_TIRE_SMOKE_POLICY.visualLinearScale,
  ]);
  scaleGraph.type = pc.CURVE_SMOOTHSTEP;

  const velocityGraph = new pc.CurveSet([
    [0, 0, 1, 0],
    [
      0,
      scaleReferenceKartLength(0.1),
      1,
      scaleReferenceKartLength(0.34),
    ],
    [0, 0, 1, 0],
  ]);
  velocityGraph.type = pc.CURVE_SMOOTHSTEP;

  const rateAtFullIntensity = level === 1 ? 0.09 : 0.075;
  const rate2AtFullIntensity = level === 1 ? 0.13 : 0.105;
  entity.addComponent("particlesystem", {
    alphaGraph,
    autoPlay: false,
    blendType: pc.BLEND_NORMAL,
    colorGraph,
    depthSoftening: 0,
    depthWrite: false,
    emitterRadius: scaleReferenceKartLength(0.035),
    emitterShape: pc.EMITTERSHAPE_SPHERE,
    initialVelocity: scaleReferenceKartLength(0.11),
    lifetime: DRIFT_SMOKE_PARTICLE_LIFETIME,
    lighting: false,
    localSpace: false,
    loop: true,
    numParticles: DRIFT_SMOKE_PARTICLE_COUNT,
    rate: rateAtFullIntensity,
    rate2: rate2AtFullIntensity,
    scaleGraph,
    sort: pc.PARTICLESORT_NONE,
    velocityGraph,
  });

  const component = entity.particlesystem;
  if (!component) {
    entity.destroy();
    throw new Error(`Unable to create drift smoke for ${mount.name}`);
  }
  component.stop();

  return {
    active: false,
    component,
    entity,
    level,
    wheelName: mount.name,
  };
}

function getEmitterIntensity(level: number, layer: 1 | 2) {
  return layer === 1 ? clamp(level, 0, 1) : clamp(level - 1, 0, 1);
}

function setEmitterIntensity(emitter: DriftSmokeEmitter, intensity: number) {
  const shouldEmit = intensity > 0;

  if (shouldEmit) {
    // ParticleSystemComponent rate/intensity setters rebuild and reset the
    // emitter. Updating either every fixed step prevents particles from ever
    // aging into view. Keep the authored full-density rate stable and vary the
    // renderer's color multiplier instead, which preserves continuous visual
    // intensity without restarting simulation.
    emitter.component.emitter?.material?.setParameter(
      "colorMult",
      intensity,
    );
  }

  if (shouldEmit === emitter.active) {
    return;
  }

  if (shouldEmit) {
    emitter.component.play();
  } else {
    // Stopping emission leaves already-emitted particles to fade naturally.
    emitter.component.stop();
  }
  emitter.active = shouldEmit;
}

export class KartDriftSmoke {
  private readonly emitters: DriftSmokeEmitter[];
  private readonly currentLevels = new Map<string, number>();
  private countdownLifted = false;

  constructor(wheels: readonly DriftSmokeWheelMount[]) {
    this.emitters = wheels.flatMap((wheel) => [
      createSmokeEmitter(wheel, 1),
      createSmokeEmitter(wheel, 2),
    ]);
  }

  get activeWheelNames() {
    return [...this.currentLevels]
      .filter(([, level]) => level > 0)
      .map(([wheelName]) => wheelName);
  }

  get levelsByWheel() {
    return Object.fromEntries(
      [...this.currentLevels].filter(([, level]) => level > 0),
    );
  }

  destroy() {
    this.emitters.forEach((emitter) => emitter.entity.destroy());
    this.emitters.length = 0;
    this.currentLevels.clear();
  }

  stop() {
    this.emitters.forEach((emitter) => setEmitterIntensity(emitter, 0));
    this.currentLevels.clear();
  }

  update(
    wheelTelemetry: readonly TireSmokeWheelSample[],
    intent: TireSmokeIntent = NEUTRAL_TIRE_SMOKE_INTENT,
  ) {
    const countdownLifted = intent.countdownThrottle > 0;
    if (countdownLifted !== this.countdownLifted) {
      this.countdownLifted = countdownLifted;
      this.emitters.forEach((emitter) =>
        emitter.entity.setLocalPosition(
          0,
          countdownLifted ? COUNTDOWN_SMOKE_LOCAL_Y : DRIFT_SMOKE_LOCAL_Y,
          countdownLifted ? COUNTDOWN_SMOKE_LOCAL_Z : DRIFT_SMOKE_LOCAL_Z,
        ),
      );
    }

    const telemetryByName = new Map(
      wheelTelemetry.map((wheel) => [wheel.name, wheel]),
    );
    const nextLevels = new Map(
      [...telemetryByName].map(([wheelName, telemetry]) => [
        wheelName,
        getTireSmokeLevel(
          telemetry,
          intent,
          this.currentLevels.get(wheelName) ?? 0,
        ),
      ]),
    );

    this.currentLevels.clear();
    nextLevels.forEach((level, wheelName) => {
      if (level > 0) {
        this.currentLevels.set(wheelName, level);
      }
    });
    this.emitters.forEach((emitter) =>
      setEmitterIntensity(
        emitter,
        getEmitterIntensity(
          nextLevels.get(emitter.wheelName) ?? 0,
          emitter.level,
        ),
      ),
    );
  }
}

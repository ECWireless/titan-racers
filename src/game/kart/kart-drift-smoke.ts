import * as pc from "playcanvas";

import type { KartTuning } from "../contracts";
import type { DynamicWheelTelemetry } from "./dynamic-kart-controller";
import { DEFAULT_KART_TUNING } from "./kart-tuning";

const DRIFT_SMOKE_PARTICLE_LIFETIME = 0.72;
const DRIFT_SMOKE_PARTICLE_COUNT = 8;

function degreesToRadians(degrees: number) {
  return degrees * (Math.PI / 180);
}

type DriftSmokeWheelSample = Pick<
  DynamicWheelTelemetry,
  "longitudinalSpeed" | "name" | "slipAngle" | "supported"
>;

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

export function getDriftSmokeLevel(
  wheel: DriftSmokeWheelSample,
  previousLevel = 0,
  tuning: KartTuning = DEFAULT_KART_TUNING,
) {
  if (!wheel.name.startsWith("rear") || !wheel.supported) {
    return 0;
  }

  const minimumSpeed =
    previousLevel > 0
      ? tuning.driftSmokeStopSpeed
      : tuning.driftSmokeStartSpeed;
  const minimumSlipAngle =
    previousLevel > 0
      ? degreesToRadians(tuning.driftSmokeStopSlipAngleDegrees)
      : degreesToRadians(tuning.driftSmokeStartSlipAngleDegrees);
  const slipAngle = Math.abs(wheel.slipAngle);

  if (
    Math.abs(wheel.longitudinalSpeed) < minimumSpeed ||
    slipAngle < minimumSlipAngle
  ) {
    return 0;
  }

  const heavySlipAngle =
    previousLevel >= 2
      ? degreesToRadians(tuning.heavyDriftSmokeStopSlipAngleDegrees)
      : degreesToRadians(tuning.heavyDriftSmokeStartSlipAngleDegrees);

  return slipAngle >= heavySlipAngle ? 2 : 1;
}

export function shouldEmitDriftSmoke(
  wheel: DriftSmokeWheelSample,
  wasActive = false,
  tuning: KartTuning = DEFAULT_KART_TUNING,
) {
  return getDriftSmokeLevel(wheel, wasActive ? 1 : 0, tuning) > 0;
}

function createSmokeEmitter(
  mount: DriftSmokeWheelMount,
  level: 1 | 2,
): DriftSmokeEmitter {
  const layerName = level === 1 ? "light" : "heavy";
  const entity = new pc.Entity(`kart-drift-smoke-${layerName}-${mount.name}`);
  entity.setLocalPosition(0, -0.18, 0.08);
  mount.pivot.addChild(entity);

  const alphaGraph = new pc.Curve([
    0,
    0,
    0.12,
    level === 1 ? 0.11 : 0.09,
    0.58,
    level === 1 ? 0.07 : 0.06,
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
    0.12,
    0.35,
    0.26,
    1,
    level === 1 ? 0.48 : 0.55,
  ]);
  scaleGraph.type = pc.CURVE_SMOOTHSTEP;

  const velocityGraph = new pc.CurveSet([
    [0, 0, 1, 0],
    [0, 0.1, 1, 0.34],
    [0, 0, 1, 0],
  ]);
  velocityGraph.type = pc.CURVE_SMOOTHSTEP;

  entity.addComponent("particlesystem", {
    alphaGraph,
    autoPlay: false,
    blendType: pc.BLEND_NORMAL,
    colorGraph,
    depthSoftening: 0,
    depthWrite: false,
    emitterRadius: 0.035,
    emitterShape: pc.EMITTERSHAPE_SPHERE,
    initialVelocity: 0.11,
    lifetime: DRIFT_SMOKE_PARTICLE_LIFETIME,
    lighting: false,
    localSpace: false,
    loop: true,
    numParticles: DRIFT_SMOKE_PARTICLE_COUNT,
    rate: level === 1 ? 0.09 : 0.075,
    rate2: level === 1 ? 0.13 : 0.105,
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

export class KartDriftSmoke {
  private readonly emitters: DriftSmokeEmitter[];
  private tuning: KartTuning;

  constructor(
    wheels: readonly DriftSmokeWheelMount[],
    tuning: KartTuning = DEFAULT_KART_TUNING,
  ) {
    this.tuning = { ...tuning };
    this.emitters = wheels
      .filter((wheel) => wheel.name.startsWith("rear"))
      .flatMap((wheel) => [
        createSmokeEmitter(wheel, 1),
        createSmokeEmitter(wheel, 2),
      ]);
  }

  get activeWheelNames() {
    return [
      ...new Set(
        this.emitters
          .filter((emitter) => emitter.active)
          .map((emitter) => emitter.wheelName),
      ),
    ];
  }

  get levelsByWheel() {
    return Object.fromEntries(
      this.activeWheelNames.map((wheelName) => [
        wheelName,
        Math.max(
          0,
          ...this.emitters
            .filter(
              (emitter) => emitter.active && emitter.wheelName === wheelName,
            )
            .map((emitter) => emitter.level),
        ),
      ]),
    );
  }

  destroy() {
    this.emitters.forEach((emitter) => emitter.entity.destroy());
    this.emitters.length = 0;
  }

  stop() {
    this.emitters.forEach((emitter) => {
      if (!emitter.active) {
        return;
      }
      emitter.component.stop();
      emitter.active = false;
    });
  }

  setTuning(tuning: KartTuning) {
    this.tuning = { ...tuning };
  }

  update(wheelTelemetry: readonly DriftSmokeWheelSample[]) {
    const telemetryByName = new Map(
      wheelTelemetry.map((wheel) => [wheel.name, wheel]),
    );

    const currentLevels = this.levelsByWheel;
    const nextLevels = new Map(
      [...telemetryByName].map(([wheelName, telemetry]) => [
        wheelName,
        getDriftSmokeLevel(
          telemetry,
          currentLevels[wheelName] ?? 0,
          this.tuning,
        ),
      ]),
    );

    this.emitters.forEach((emitter) => {
      const shouldEmit =
        emitter.level <= (nextLevels.get(emitter.wheelName) ?? 0);

      if (shouldEmit === emitter.active) {
        return;
      }

      if (shouldEmit) {
        emitter.component.play();
      } else {
        emitter.component.stop();
      }
      emitter.active = shouldEmit;
    });
  }
}

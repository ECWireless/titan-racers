import type { ApprovedComponentDefinition } from "./kart-component-registry";
import type { DeepReadonly } from "./immutable-registry";
import {
  buildBatteryLipoStandardV1,
  buildBrakesCombinedStandardV1,
  buildCoilover,
  buildMotorBrushlessStandardV1,
  buildReceiverEscStandardV1,
  buildSteeringServoStandardV1,
  buildTransmissionBalanced5to1V1,
  buildTransmissionShort8to1V1,
  buildTransmissionTall4to1V1,
  buildWheelTire,
  type KartCoiloverVisual,
  type KartPartFinish,
  type KartPartVisualPiece,
} from "./kart-part-visual-geometry";

type ReadonlyComponentDefinition = DeepReadonly<ApprovedComponentDefinition>;

/**
 * Presentation-only visuals for approved part versions (`id@version`). They
 * never feed derivation, revisions, or hashes, so they may improve without a
 * new part version; any change advances the thumbnail render version.
 */
export type KartPartVisual =
  | {
      kind: "pieces";
      build: (definition: ReadonlyComponentDefinition) => KartPartVisualPiece[];
    }
  | {
      kind: "coilover";
      build: (definition: ReadonlyComponentDefinition) => KartCoiloverVisual;
    };

const pieces = (build: () => KartPartVisualPiece[]): KartPartVisual => ({
  build,
  kind: "pieces",
});
const coilover: KartPartVisual = {
  build: (definition) => {
    const construction = definition.construction[0];
    if (
      definition.category !== "suspension" ||
      construction.shape !== "cylinder"
    ) {
      throw new Error(`${definition.id} is not a coilover.`);
    }
    return buildCoilover({
      anodized: construction.material.id === "material.structural-aluminum",
      bumpStart: definition.suspension.bumpStart,
      constructionRadius: construction.radius,
      extendedLength: definition.suspension.extendedLength,
      maximumStroke: definition.suspension.maximumStroke,
      springRate: definition.suspension.springRate,
    });
  },
  kind: "coilover",
};
const wheel: KartPartVisual = {
  build: (definition) => {
    if (definition.category !== "wheel-tire") {
      throw new Error(`${definition.id} is not a wheel.`);
    }
    return buildWheelTire(
      definition.wheelTire.radius,
      definition.wheelTire.width,
    );
  },
  kind: "pieces",
};

export const KART_PART_VISUALS: Readonly<Record<string, KartPartVisual>> = {
  "battery.lipo-standard@1": pieces(buildBatteryLipoStandardV1),
  "brakes.combined-standard@1": pieces(buildBrakesCombinedStandardV1),
  "control.receiver-esc-standard@1": pieces(buildReceiverEscStandardV1),
  "motor.brushless-standard@1": pieces(buildMotorBrushlessStandardV1),
  "steering.servo-standard@1": pieces(buildSteeringServoStandardV1),
  "suspension.compliant-long@1": coilover,
  "suspension.compliant-long@2": coilover,
  "suspension.firm-short@1": coilover,
  "transmission.balanced-5to1@1": pieces(buildTransmissionBalanced5to1V1),
  "transmission.short-8to1@1": pieces(buildTransmissionShort8to1V1),
  "transmission.tall-4to1@1": pieces(buildTransmissionTall4to1V1),
  "wheel-tire.large-standard@1": wheel,
  "wheel-tire.small-standard@1": wheel,
};

export function getKartPartVisual(reference: { id: string; version: number }) {
  return KART_PART_VISUALS[`${reference.id}@${reference.version}`] ?? null;
}

/** The finish a construction material takes when it carries authored color. */
export function getAuthoredMaterialFinish(materialId: string): KartPartFinish {
  if (materialId === "material.structural-aluminum") return "authored-anodized";
  if (materialId === "material.engineering-polymer") return "authored-polymer";
  return "authored-paint";
}

import type { KartAssemblyPrimitiveInstance } from "./kart-assembly-document";
import {
  buildCadPieces,
  getKartCadMesh,
  KART_CAD_MESHES,
  type KartCadMesh,
} from "./kart-cad-meshes";
import type { ApprovedComponentDefinition } from "./kart-component-registry";
import type { DeepReadonly } from "./immutable-registry";
import {
  BATTERY_LIPO_STANDARD_V1_LEADS,
  BRAKES_COMBINED_STANDARD_V1_LEADS,
  buildBatteryLipoStandardV1,
  buildBrakesCombinedStandardV1,
  buildCoilover,
  buildReceiverEscStandardV1,
  buildWheelTire,
  RECEIVER_ESC_STANDARD_V1_LEADS,
  type KartCoiloverVisual,
  type KartPartLead,
  type KartPartLeads,
  type KartPartVisualPiece,
  type Vec3,
} from "./kart-part-visual-geometry";
import {
  buildPrimitiveVisual,
  type KartPrimitiveVisualSpec,
} from "./kart-primitive-visual-geometry";

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
  // Version 2 of these parts only declares where they mount; they look the
  // same.
  "battery.lipo-standard@1": pieces(buildBatteryLipoStandardV1),
  "battery.lipo-standard@2": pieces(buildBatteryLipoStandardV1),
  "brakes.combined-standard@1": pieces(buildBrakesCombinedStandardV1),
  "brakes.combined-standard@2": pieces(buildBrakesCombinedStandardV1),
  "control.receiver-esc-standard@1": pieces(buildReceiverEscStandardV1),
  "control.receiver-esc-standard@2": pieces(buildReceiverEscStandardV1),
  "suspension.compliant-long@1": coilover,
  "suspension.compliant-long@2": coilover,
  "suspension.compliant-long@3": coilover,
  "suspension.firm-short@1": coilover,
  "suspension.firm-short@2": coilover,
  "wheel-tire.large-standard@1": wheel,
  "wheel-tire.small-standard@1": wheel,
  // Parts drawn from their committed CAD meshes (`cad/parts/`). A mesh's
  // moving pieces (the servo's horn) are drawn and posed by the assembly
  // visual.
  ...Object.fromEntries(
    KART_CAD_MESHES.map((mesh) => [mesh.part, pieces(() => buildCadPieces(mesh))]),
  ),
};

export function getKartPartVisual(reference: { id: string; version: number }) {
  return KART_PART_VISUALS[`${reference.id}@${reference.version}`] ?? null;
}

// Code-built parts' wires; both versions of each look the same.
const CODE_BUILT_LEADS: Readonly<Record<string, KartPartLeads>> = {
  "battery.lipo-standard": BATTERY_LIPO_STANDARD_V1_LEADS,
  "brakes.combined-standard": BRAKES_COMBINED_STANDARD_V1_LEADS,
  "control.receiver-esc-standard": RECEIVER_ESC_STANDARD_V1_LEADS,
};

/**
 * Where each of a part version's wires leaves it, by functional port: from
 * its code-built visual, or from its CAD mesh's `lead-<port>-<n>` points
 * (each a position and the way the wire leaves). Presentation only.
 */
export function getKartPartLeads(reference: {
  id: string;
  version: number;
}): KartPartLeads | null {
  const cad = getKartCadMesh(reference);
  if (cad) return getCadLeads(cad);
  return getKartPartVisual(reference) ? CODE_BUILT_LEADS[reference.id] ?? null : null;
}

const cadLeads = new WeakMap<KartCadMesh, KartPartLeads | null>();

function getCadLeads(mesh: KartCadMesh): KartPartLeads | null {
  if (cadLeads.has(mesh)) return cadLeads.get(mesh)!;
  const leads: Record<string, KartPartLead[]> = {};
  for (const [name, values] of Object.entries(mesh.points)) {
    const match = /^lead-(.+)-(\d+)$/.exec(name);
    if (!match) continue;
    const [x, y, z, dx, dy, dz] = values.map((value) => value / 1_000_000);
    (leads[match[1]] ??= [])[Number(match[2]) - 1] = {
      direction: [dx, dy, dz] as Vec3,
      position: [x, y, z],
    };
  }
  // A port whose wires aren't numbered 1, 2, … without a gap has none.
  for (const [port, wires] of Object.entries(leads)) {
    if (Object.keys(wires).length !== wires.length) delete leads[port];
  }
  const result = Object.keys(leads).length > 0 ? leads : null;
  cadLeads.set(mesh, result);
  return result;
}

/** The finish a construction material takes when it carries authored color. */
export function getAuthoredMaterialFinish(
  materialId: string,
): KartPrimitiveVisualSpec["finish"] {
  if (materialId === "material.structural-aluminum") return "authored-anodized";
  if (materialId === "material.engineering-polymer") return "authored-polymer";
  return "authored-paint";
}

/**
 * An authored primitive at its true size: role picks the form, metal is
 * machined and polymer molded, and solid steel structure is ballast.
 */
export function buildAuthoredPrimitiveVisual(
  primitive: KartAssemblyPrimitiveInstance,
): KartPartVisualPiece[] {
  const material = primitive.material.id;
  const steel = material === "material.steel";
  return buildPrimitiveVisual({
    construction: primitive.construction,
    edge:
      steel || material === "material.structural-aluminum"
        ? "machined"
        : "molded",
    finish: getAuthoredMaterialFinish(material),
    massBlock:
      steel &&
      primitive.role === "structure" &&
      primitive.construction.mode === "solid",
    role: primitive.role,
    shape:
      primitive.shape === "box"
        ? {
            kind: "box",
            size: [primitive.size.x, primitive.size.y, primitive.size.z],
          }
        : {
            height: primitive.height,
            kind: "cylinder",
            radius: primitive.radius,
          },
  });
}

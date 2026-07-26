import type { KartAssemblyDocument } from "./kart-assembly-document";
import {
  createOfficialKartAssembly,
  type OfficialKartAssemblyConfig,
} from "./official-kart-assembly";

export const HANDLING_KART_ID = "handling-kart";

const HANDLING_KART_CONFIG = {
  bodyMaterial: "material.engineering-polymer",
  bodySize: { x: 0.3, y: 0.045, z: 0.26 },
  bumperHeight: 0.24,
  bumperZ: 0.16,
  kartId: HANDLING_KART_ID,
  motionRatio: 0.8,
  name: "Handling Kart",
  practicalDescriptor:
    "Short gearing, wide track, and compliant suspension favor agile cornering.",
  suspensionComponentCenterY: 0.094,
  suspensionComponentPosition: "shock-midpoint",
  suspensionDefinitionId: "suspension.compliant-long",
  suspensionRestCompression: 0.03,
  trackWidth: 0.42,
  transmissionDefinitionId: "transmission.short-8to1",
  upperHousingSize: { x: 0.2, y: 0.075, z: 0.16 },
  visualIdentity: {
    accentColor: "#7ee081",
    primaryColor: "#176b5b",
  },
  wheelDefinitionId: "wheel-tire.small-standard",
  wheelbase: 0.26,
} as const satisfies OfficialKartAssemblyConfig;

/** Returns a fresh Handling Kart assembly containing construction inputs only. */
export function createHandlingKartDocument(
  kartId = HANDLING_KART_ID,
): KartAssemblyDocument {
  return createOfficialKartAssembly(HANDLING_KART_CONFIG, kartId);
}

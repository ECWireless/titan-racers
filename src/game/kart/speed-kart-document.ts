import type { KartAssemblyDocument } from "./kart-assembly-document";
import {
  createOfficialKartAssembly,
  type OfficialKartAssemblyConfig,
} from "./official-kart-assembly";

export const SPEED_KART_ID = "speed-kart";

const SPEED_KART_CONFIG = {
  bodyMaterial: "material.structural-aluminum",
  bodySize: { x: 0.28, y: 0.055, z: 0.34 },
  bumperHeight: 0.22,
  bumperZ: 0.205,
  kartId: SPEED_KART_ID,
  motionRatio: 0.85,
  name: "Speed Kart",
  practicalDescriptor:
    "Tall gearing, large wheels, and a low body favor top speed over tight turns.",
  suspensionComponentCenterY: 0.109,
  suspensionComponentPosition: "spring-arm",
  suspensionDefinitionId: "suspension.firm-short",
  suspensionRestCompression: 0.018,
  trackWidth: 0.36,
  transmissionDefinitionId: "transmission.tall-4to1",
  upperHousingSize: { x: 0.17, y: 0.075, z: 0.26 },
  visualIdentity: {
    accentColor: "#f6d55c",
    primaryColor: "#9d1c2b",
  },
  wheelDefinitionId: "wheel-tire.large-standard",
  wheelbase: 0.34,
} as const satisfies OfficialKartAssemblyConfig;

/** Returns a fresh Speed Kart assembly containing construction inputs only. */
export function createSpeedKartDocument(
  kartId = SPEED_KART_ID,
): KartAssemblyDocument {
  return createOfficialKartAssembly(SPEED_KART_CONFIG, kartId);
}

import type { KartAssemblyDocument } from "./kart-assembly-document";
import {
  createOfficialKartAssembly,
  type OfficialKartAssemblyConfig,
} from "./official-kart-assembly";

export const BALANCED_KART_ID = "balanced-kart";

const BALANCED_KART_CONFIG = {
  bodyMaterial: "material.structural-aluminum",
  bodySize: { x: 0.29, y: 0.07, z: 0.275 },
  bumperHeight: 0.22,
  bumperZ: 0.17,
  kartId: BALANCED_KART_ID,
  motionRatio: Math.sqrt(812.5 / 1_600),
  name: "Balanced Kart",
  practicalDescriptor:
    "Stable small-wheel setup with predictable steering and balanced speed.",
  suspensionComponentCenterY: 0.109,
  suspensionComponentPosition: "spring-arm",
  suspensionDefinitionId: "suspension.firm-short",
  suspensionRestCompression: 0.013,
  trackWidth: 0.39,
  transmissionDefinitionId: "transmission.balanced-5to1",
  upperHousingSize: { x: 0.18, y: 0.105, z: 0.195 },
  visualIdentity: {
    accentColor: "#f4b942",
    primaryColor: "#203040",
  },
  wheelDefinitionId: "wheel-tire.small-standard",
  wheelbase: 0.3,
} as const satisfies OfficialKartAssemblyConfig;

/**
 * Returns a fresh, complete Balanced Kart document suitable for initializing an
 * admin-owned draft.
 */
export function createBalancedKartDocument(
  kartId = BALANCED_KART_ID,
): KartAssemblyDocument {
  return createOfficialKartAssembly(BALANCED_KART_CONFIG, kartId);
}

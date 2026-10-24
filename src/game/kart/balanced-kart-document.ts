import type { KartAssemblyDocument } from "./kart-assembly-document";
import { RATED_SHOCK_INSTALLATION_RADIANS } from "./kart-component-registry";
import {
  createOfficialKartAssembly,
  type OfficialKartAssemblyConfig,
} from "./official-kart-assembly";

export const BALANCED_KART_ID = "balanced-kart";

const BALANCED_KART_CONFIG = {
  armLength: 0.115,
  chassis: {
    armMount: { x: 0.016, z: 0.06 },
    bumperSize: { x: 0.09, y: 0.02, z: 0.03 },
    equipment: {
      "battery-main": { x: -0.04, yawDegrees: 90, z: -0.035 },
      // Centers the mass on the kart's centerline.
      "brakes-main": { x: -0.0212, z: 0.04 },
      "controller-main": { x: 0.04, z: -0.06 },
      "motor-main": { x: 0.048, z: 0.035 },
      "steering-main": { x: 0, z: -0.115 },
      "transmission-main": { x: 0, z: 0.115 },
    },
    plate: {
      bottomY: 0.044,
      material: "material.structural-aluminum",
      size: { x: 0.134, y: 0.002, z: 0.375 },
    },
    shockTowerThickness: 0.004,
    topDeck: { bottomY: 0.085, size: { x: 0.04, y: 0.002 } },
  },
  kartId: BALANCED_KART_ID,
  motionRatio: Math.sqrt(812.5 / 1_600),
  name: "Balanced Kart",
  practicalDescriptor:
    "Stable small-wheel setup with predictable steering and balanced speed.",
  suspensionComponentPosition: "spring-arm",
  suspensionDefinitionId: "suspension.firm-short",
  suspensionDefinitionVersion: 2,
  // The same wheel sag as before, with the shock at a 30° installation.
  suspensionRestCompression: 0.013 * Math.cos(RATED_SHOCK_INSTALLATION_RADIANS),
  trackWidth: 0.34,
  transmissionDefinitionId: "transmission.balanced-5to1",
  visualIdentity: {
    accentColor: "#f4b942",
    primaryColor: "#203040",
  },
  wheelDefinitionId: "wheel-tire.small-standard",
  wheelbase: 0.345,
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

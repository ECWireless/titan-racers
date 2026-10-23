import type { KartAssemblyDocument } from "./kart-assembly-document";
import { RATED_SHOCK_INSTALLATION_RADIANS } from "./kart-component-registry";
import {
  createOfficialKartAssembly,
  type OfficialKartAssemblyConfig,
} from "./official-kart-assembly";

export const HANDLING_KART_ID = "handling-kart";

const HANDLING_KART_CONFIG = {
  armLength: 0.1,
  axleCenterZ: 0.01,
  chassis: {
    armMount: { x: 0.016, z: 0.06 },
    bumperSize: { x: 0.18, y: 0.02, z: 0.03 },
    equipment: {
      "battery-main": { x: -0.055, yawDegrees: 90, z: -0.06 },
      "brakes-main": { x: 0, z: -0.04 },
      "controller-main": { x: 0.05, z: -0.08 },
      "motor-main": { x: 0.052, z: -0.02 },
      "steering-main": { x: 0, z: -0.105 },
      "transmission-main": { x: 0, z: 0.07 },
    },
    plate: {
      bottomY: 0.044,
      material: "material.engineering-polymer",
      size: { x: 0.244, y: 0.003, z: 0.31 },
    },
    shockTowerThickness: 0.004,
    topDeck: { bottomY: 0.085, size: { x: 0.04, y: 0.002 } },
  },
  kartId: HANDLING_KART_ID,
  motionRatio: 0.8,
  name: "Handling Kart",
  practicalDescriptor:
    "Short gearing, wide track, and compliant suspension favor agile cornering.",
  suspensionComponentPosition: "shock-midpoint",
  suspensionDefinitionId: "suspension.compliant-long",
  suspensionDefinitionVersion: 3,
  // The same wheel sag as before, with the shock at a 30° installation.
  suspensionRestCompression: 0.006 * Math.cos(RATED_SHOCK_INSTALLATION_RADIANS),
  trackWidth: 0.42,
  transmissionDefinitionId: "transmission.short-8to1",
  visualIdentity: {
    accentColor: "#7ee081",
    primaryColor: "#176b5b",
  },
  wheelDefinitionId: "wheel-tire.small-standard",
  wheelbase: 0.28,
} as const satisfies OfficialKartAssemblyConfig;

/** Returns a fresh Handling Kart assembly containing construction inputs only. */
export function createHandlingKartDocument(
  kartId = HANDLING_KART_ID,
): KartAssemblyDocument {
  return createOfficialKartAssembly(HANDLING_KART_CONFIG, kartId);
}

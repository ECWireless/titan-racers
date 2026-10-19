import type { KartAssemblyDocument } from "./kart-assembly-document";
import {
  createOfficialKartAssembly,
  type OfficialKartAssemblyConfig,
} from "./official-kart-assembly";

export const SPEED_KART_ID = "speed-kart";

const SPEED_KART_CONFIG = {
  armLength: 0.095,
  chassis: {
    armMount: { x: 0.014, z: 0.018 },
    bumperSize: { x: 0.15, y: 0.02, z: 0.03 },
    equipment: {
      "battery-main": { x: -0.055, yawDegrees: 90, z: -0.02 },
      "brakes-main": { x: 0, z: 0.055 },
      "controller-main": { x: 0.05, z: -0.05 },
      "motor-main": { x: 0.052, z: 0.05 },
      "steering-main": { x: 0, z: -0.14 },
      "transmission-main": { x: 0, z: 0.135 },
    },
    plate: {
      bottomY: 0.058,
      material: "material.structural-aluminum",
      size: { x: 0.194, y: 0.002, z: 0.4 },
    },
    shockTowerThickness: 0.004,
    topDeck: { bottomY: 0.095, size: { x: 0.04, y: 0.002 } },
  },
  kartId: SPEED_KART_ID,
  motionRatio: 0.85,
  name: "Speed Kart",
  practicalDescriptor:
    "Tall gearing, large wheels, and a long wheelbase favor top speed over tight turns.",
  shockTopMount: { y: 0.125, z: 0.172 },
  suspensionComponentCenterY: 0.109,
  suspensionComponentPosition: "spring-arm",
  suspensionDefinitionId: "suspension.firm-short",
  suspensionRestCompression: 0.018,
  trackWidth: 0.36,
  transmissionDefinitionId: "transmission.tall-4to1",
  visualIdentity: {
    accentColor: "#f6d55c",
    primaryColor: "#9d1c2b",
  },
  wheelDefinitionId: "wheel-tire.large-standard",
  wheelbase: 0.37,
} as const satisfies OfficialKartAssemblyConfig;

/** Returns a fresh Speed Kart assembly containing construction inputs only. */
export function createSpeedKartDocument(
  kartId = SPEED_KART_ID,
): KartAssemblyDocument {
  return createOfficialKartAssembly(SPEED_KART_CONFIG, kartId);
}

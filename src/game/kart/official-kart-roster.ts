import {
  BALANCED_KART_ID,
  createBalancedKartDocument,
} from "./balanced-kart-document";
import {
  createHandlingKartDocument,
  HANDLING_KART_ID,
} from "./handling-kart-document";
import type { KartAssemblyDocument } from "./kart-assembly-document";
import {
  createSpeedKartDocument,
  SPEED_KART_ID,
} from "./speed-kart-document";

export const OFFICIAL_KART_IDS = Object.freeze([
  BALANCED_KART_ID,
  SPEED_KART_ID,
  HANDLING_KART_ID,
] as const);

export type OfficialKartId = (typeof OFFICIAL_KART_IDS)[number];

const OFFICIAL_KART_DOCUMENT_FACTORIES = {
  [BALANCED_KART_ID]: createBalancedKartDocument,
  [HANDLING_KART_ID]: createHandlingKartDocument,
  [SPEED_KART_ID]: createSpeedKartDocument,
} satisfies Record<OfficialKartId, () => KartAssemblyDocument>;

/**
 * Returns a fresh bundled assembly for each official roster entry. Persistence
 * and publication decide which revisions are player-visible.
 */
export function createOfficialKartRosterDocuments(): KartAssemblyDocument[] {
  return OFFICIAL_KART_IDS.map((kartId) =>
    OFFICIAL_KART_DOCUMENT_FACTORIES[kartId](),
  );
}

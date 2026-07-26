import {
  OfficialKartRosterAccess,
  type OfficialKartRosterCard,
} from "@/components/kart-editor/official-kart-roster-access";
import { deriveKartSnapshot } from "@/game/kart/kart-derivation";
import { createOfficialKartRosterDocuments } from "@/game/kart/official-kart-roster";

const officialKarts = createOfficialKartRosterDocuments().map((document) => ({
  kartId: document.kartId,
  name: document.name,
  practicalDescriptor: document.practicalDescriptor,
  stats: deriveKartSnapshot(document).playerStats,
  visualIdentity: document.visualIdentity,
})) satisfies OfficialKartRosterCard[];

export default function OfficialKartRosterPage() {
  return <OfficialKartRosterAccess officialKarts={officialKarts} />;
}

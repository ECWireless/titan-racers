import { expect, test } from "@playwright/test";

import { APPROVED_KART_COMPONENTS } from "../src/game/kart/kart-component-registry";
import {
  APPROVED_CONSTRUCTION_MATERIALS,
  APPROVED_SURFACE_MATERIALS,
  APPROVED_TIRE_COMPOUNDS,
  APPROVED_TIRE_SURFACE_INTERACTIONS,
} from "../src/game/kart/kart-material-registry";
import { registryEntryFingerprint } from "./support/registry-fingerprint";

/**
 * Persisted kart revisions reference registry entries by immutable id@version.
 * A changed fingerprint means published content was edited in place; restore
 * it and add a new version instead. Pin each new version deliberately.
 */
const PINNED_REGISTRY_FINGERPRINTS: Record<string, string> = {
  "surface.short-grass@1": "4f08c526469cbf82deb0db0c08d1d7ebfdf0cd82733ba3878d9978c4b4ff00f9",
  "interaction:tire-compound.standard-rubber@1+surface.short-grass@1/derivation-1": "e6e23af61a40e16f51dda5396421c90755f0df05562d63a75d78bef4c90348e0",
  "surface.lawn-grass@1": "f15fcd72967c366553b1a9e6e26e5b6dfb65c1781c54d330a88921e686e32a12",
  "interaction:tire-compound.standard-rubber@1+surface.lawn-grass@1/derivation-1": "19dad874e950204c041038bd0e5267d5ecf0106153612c6bc2e2a671109488b3",
  "battery.lipo-standard@1":
    "1c8675000da381b97c235d19db0e854b47c96c3f69699aad9151d9412d6821d1",
  "brakes.combined-standard@1":
    "83953ab5008acec5905958e0e60b860f6110273ada3750bd06565b1dd40c5031",
  "control.receiver-esc-standard@1":
    "1132d5d55fbd22ceef433ded406edf7b99e9e043dc7c267e3d24f05d533c0004",
  "interaction:tire-compound.standard-rubber@1+surface.standard-course@1/derivation-1":
    "a56c0234d65433e1d770d3542c46a1c041912ed22676d5fc76e1c8f62eb34f5a",
  "material.engineering-polymer@1":
    "78b4d80f8abbbc71230a760f13c2c65ec05b973cb9a621865dd1a4031bc67afe",
  "material.polycarbonate-shell@1":
    "82afdad69fa79e0ee40dfad66499253cc1d0a3e13540121c9777c7b99749405a",
  "material.steel@1":
    "974afadbe4b1cbbaebf8e6829d6bb24deb08c0f0521ac4aa7514a90dd30d6d60",
  "material.structural-aluminum@1":
    "740521e31fb74a69d3af3b9935ee37e89e8ce5cdb34ae38aefa25e580f623430",
  "motor.brushless-standard@1":
    "f036f3716a3e1374d28588e750eacd7ede3ce58d68b77aa0eea0469512fe8658",
  "steering.servo-standard@1":
    "8735768a580ab951db69792a6fc07383d0377ddaf1482a69323ca8a734f57ad7",
  "surface.standard-course@1":
    "e9f454dcd4b3d6f8cb6436bf89448ed49373a12df8f4a6bc59e41dfe834290af",
  "suspension.compliant-long@1":
    "6008e62d6dabfc8118d681d2aa83419705f85b7ee0b90e7e0cd604d661dc0807",
  "suspension.compliant-long@2":
    "4575933cd303203886285f980943fdd087e6788127bc84677baba1041e155d49",
  // Content changed in place during PR 3.3; the current content is canonical
  // because the official karts were authored against it.
  "suspension.firm-short@1":
    "da4dcbba70b0fef652035bead629f4c9d727d18a1722539c4afb6850791a9d21",
  "tire-compound.standard-rubber@1":
    "db0784c79307319a1f4a7ae48e9e4fe5196421da9903071afd9a91fe5ba63673",
  "transmission.balanced-5to1@1":
    "53b92e45cb7ba9d9d09bf422d7b6ad09a93c1d6873085eb46cda2f952186d20f",
  "transmission.short-8to1@1":
    "58574d9ba740526542884dc4d451ea3f33bce61be2151be85563dbd895218e51",
  "transmission.tall-4to1@1":
    "5ddba499cde85a26084c576691d306ae161c52f56b1d72bc6c1078f16ae73348",
  "wheel-tire.large-standard@1":
    "f0312ef848755ff072b54280094facbceed80551f2f6c6d7ce478713099eedac",
  "wheel-tire.small-standard@1":
    "fdc8a1d601131a257b528f0a93ee1e1b672abffd3d34f63a0dfa25573e0fbacf",
};

function currentRegistryFingerprints() {
  const fingerprints: Record<string, string> = {};
  [
    ...APPROVED_KART_COMPONENTS,
    ...APPROVED_CONSTRUCTION_MATERIALS,
    ...APPROVED_TIRE_COMPOUNDS,
    ...APPROVED_SURFACE_MATERIALS,
  ].forEach((entry) => {
    fingerprints[`${entry.id}@${entry.version}`] =
      registryEntryFingerprint(entry);
  });
  APPROVED_TIRE_SURFACE_INTERACTIONS.forEach((entry) => {
    const key = `interaction:${entry.tireCompound.id}@${entry.tireCompound.version}+${entry.surfaceMaterial.id}@${entry.surfaceMaterial.version}/derivation-${entry.derivationVersion}`;
    fingerprints[key] = registryEntryFingerprint(entry);
  });
  return fingerprints;
}

test.describe("approved kart registry immutability", () => {
  test("pins every approved registry version exactly once", () => {
    expect(Object.keys(currentRegistryFingerprints()).sort()).toEqual(
      Object.keys(PINNED_REGISTRY_FINGERPRINTS).sort(),
    );
  });

  test("never changes the content of a published registry version", () => {
    const current = currentRegistryFingerprints();
    Object.entries(PINNED_REGISTRY_FINGERPRINTS).forEach(([key, pinned]) => {
      expect(current[key], `${key} changed in place`).toBe(pinned);
    });
  });
});

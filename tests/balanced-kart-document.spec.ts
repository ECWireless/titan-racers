import { expect, test } from "@playwright/test";

import {
  BALANCED_KART_ID,
  createBalancedKartDocument,
} from "../src/game/kart/balanced-kart-document";
import { deriveKartSnapshot } from "../src/game/kart/kart-derivation";

test("ships a fresh valid Balanced Kart assembly template", () => {
  const first = createBalancedKartDocument();
  const second = createBalancedKartDocument();
  const snapshot = deriveKartSnapshot(first);

  expect(first).toEqual(second);
  expect(first).not.toBe(second);
  expect(first.kartId).toBe(BALANCED_KART_ID);
  expect(first.name).toBe("Balanced Kart");
  expect(snapshot.geometry.wheelStations).toHaveLength(4);
  expect(
    Math.max(...Object.values(snapshot.playerStats)) -
      Math.min(...Object.values(snapshot.playerStats)),
  ).toBeLessThanOrEqual(20);
});

test("can initialize a distinct protected draft ID without changing construction", () => {
  const document = createBalancedKartDocument("admin-kart-draft");
  const canonical = createBalancedKartDocument();
  expect(document.kartId).toBe("admin-kart-draft");
  expect({ ...document, kartId: BALANCED_KART_ID }).toEqual(canonical);
  expect(() => deriveKartSnapshot(document)).not.toThrow();
});

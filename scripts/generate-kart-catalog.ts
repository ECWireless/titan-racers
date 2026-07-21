import { writeFileSync } from "node:fs";
import { join } from "node:path";

import { renderKartCatalogReference } from "../src/game/kart/kart-catalog-documentation";

writeFileSync(
  join(process.cwd(), "docs/kart-system/generated-catalog.md"),
  renderKartCatalogReference(),
);

import { BRIDGE, bridgeCableHeight } from "./enclosure-structures";
import { FALLS_LAKE, PARK } from "./habitat-land";
import { NEUTRAL_WHITE, WARM_WHITE } from "./island-three";

/**
 * Lights seen across Island Three at dusk, drawn as points: the falls
 * bridge's cable necklace, deck lamps, and tower beacons, and a few floodlit
 * sports fields up the valley sides and across the cylinder. Each instance
 * is (axial, across, height above the ground, candela toward the viewer)
 * and (linear colour at unit luminance, valley index); the land's own
 * street lamps are drawn by the land shader instead. Fields stand on dry
 * land (checked by tests/island-three-enclosure.spec.ts).
 */

// Aviation red, linear at unit luminance.
const RED = [4.7, 0, 0] as const;

// Seen from afar: decorative cable lamps, road lamps on the deck, medium
// aviation beacons, and the spill of a sports floodlight toward the viewer.
const NECKLACE_CANDELA = 1_500;
const DECK_CANDELA = 2_000;
const BEACON_CANDELA = 2_000;
const FIELD_CANDELA = 50_000;
const LAMP_SPACING = 40;

/** Floodlit fields: valley, axial, across, in metres; four masts on each. */
const FIELDS = [
  [1, 12_400, 1_250],
  [1, 14_300, -1_400],
  [1, 11_600, -1_650],
  [0, 11_000, 600],
  [0, 4_500, -900],
  [2, 8_000, 1_000],
] as const;
const FIELD = { across: 35, along: 55, height: 18 };

type Light = {
  across: number;
  axial: number;
  candela: number;
  colour: readonly [number, number, number];
  height: number;
  valley: number;
};

function bridgeLights(): Light[] {
  const valley = PARK.seed - 1;
  const lights: Light[] = [];
  const along = (from: number, to: number) => {
    const count = Math.round((to - from) / LAMP_SPACING);
    return Array.from({ length: count + 1 }, (_, i) => from + ((to - from) * i) / count);
  };
  [-1, 1].forEach((side) => {
    along(-BRIDGE.anchor[0], BRIDGE.anchor[0]).forEach((across) =>
      lights.push({
        across: FALLS_LAKE.across + across,
        axial: FALLS_LAKE.axial + side * (BRIDGE.halfWidth + 1),
        candela: NECKLACE_CANDELA,
        colour: WARM_WHITE,
        height: bridgeCableHeight(across),
        valley,
      }),
    );
    // Deck lamps stand along its edges, short of the anchorages.
    const deckEnd = BRIDGE.anchor[0] - LAMP_SPACING;
    along(-deckEnd, deckEnd).forEach((across) =>
      lights.push({
        across: FALLS_LAKE.across + across,
        axial: FALLS_LAKE.axial + side * (BRIDGE.halfWidth - 1),
        candela: DECK_CANDELA,
        colour: WARM_WHITE,
        height: BRIDGE.deck + 6,
        valley,
      }),
    );
    [-1, 1].forEach((leg) =>
      lights.push({
        across: FALLS_LAKE.across + side * BRIDGE.tower,
        axial: FALLS_LAKE.axial + leg * (BRIDGE.halfWidth + 3),
        candela: BEACON_CANDELA,
        colour: RED,
        height: BRIDGE.towerTop + 5,
        valley,
      }),
    );
  });
  return lights;
}

function fieldLights(): Light[] {
  return FIELDS.flatMap(([valley, axial, across]) =>
    [-1, 1].flatMap((end) =>
      [-1, 1].map((side) => ({
        across: across + side * FIELD.across,
        axial: axial + end * FIELD.along,
        candela: FIELD_CANDELA,
        colour: NEUTRAL_WHITE,
        height: FIELD.height,
        valley,
      })),
    ),
  );
}

export function createDistantLights() {
  const lights = [...bridgeLights(), ...fieldLights()];
  return new Float32Array(
    lights.flatMap((light) => [
      light.axial,
      light.across,
      light.height,
      light.candela,
      ...light.colour,
      light.valley,
    ]),
  );
}

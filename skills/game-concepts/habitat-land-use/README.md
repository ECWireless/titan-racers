# Habitat Land Use

**Maturity:** Candidate (PR 4.3.4, 2026-10-24).

## Purpose and Scope

This node records what O'Neill and the design studies that followed put
inside a large rotating habitat, and what that means for Island Three's
valleys in Titan Racers. Read it before changing the valley land, the end
caps, distant structures, or before naming or placing a course. The
habitat's structure and placement conventions live in
[`docs/island-three.md`](../../../docs/island-three.md); the physics of the
spin lives in [`rotating-habitat-physics`](../rotating-habitat-physics/README.md).

## Standard

The valleys are where people live. Crops and heavy industry live elsewhere:

- **Agriculture is outside the valleys.** In O'Neill's Island Three the crops
  grow in small cylinders on a ring around each end cap, each module with the
  climate suited to its foods. The valleys hold gardens and orchards at most,
  never field-scale farming.
- **Heavy industry is outside too,** in zero-gravity works at the end of the
  cylinder, by the docks on the axis. Valleys keep light service
  infrastructure: maintenance yards, utility lanes, pumping and air plant.
- **The land is a landscape,** not a grid: rivers, lakes, woods, meadows, and
  hills, with houses scattered through it. Hills stay gentle, tens of
  metres: soil loads the hull, and gravity weakens toward the axis. The end
  cap at each end rises in terraces toward the axis.
- **People live in villages and small towns at low height.** Homes are one or
  two storeys, with clusters up to four or five storeys, often terraced, and
  parks beside the denser neighbourhoods. The design goal is "a city which
  does not dwarf its inhabitants", with long sightlines and natural light.
- **Transport is quiet.** No combustion vehicles: people walk, cycle, and ride
  electric transit. Elevators climb the end caps to the low-gravity axis and
  its docks (an interpretation of the torus study's spoke elevators).

## What It Means For Island Three

Island Three has about 400 km² of land per cylinder at Titan Racers' 4 km
radius: three valleys, each about 4.2 km wide and 32 km long. Sources give
"several million" people per pair of cylinders, about 130–400 m² per person.
That is suburban to small-town density, three to eight times roomier than the
torus study's 47 m² minimum. So:

- most land is open: parkland, meadow, woods, and water;
- villages and small towns cluster along the river and transit, with denser
  centres of four to five storeys;
- nothing needs residential towers. Height comes from a few structures with a
  purpose: elevator lines up the end caps, bridges, and civic buildings;
- quiet, rural land lies between settlements, far from the towns.

A building's "up" points at the axis, so on the valleys overhead buildings
hang down toward the viewer.

### Scale From The Floor

Across a habitat, single buildings vanish. A 15 m house subtends 0.4° from
2 km and 0.1° from the far side, 8 km overhead: texture, not form. Height
reads only from clusters and landmarks tens to hundreds of metres tall.

### Falling Water

Water falling from an end-cap terrace drifts anti-spinward as it falls, by
the spin alone (see
[`rotating-habitat-physics`](../rotating-habitat-physics/README.md)). For
water leaving the lip at rest relative to the habitat:

| Drop | Fall time | Anti-spinward drift |
| --- | --- | --- |
| 200 m | 6.6 s | 45 m |
| 400 m | 9.8 s | 133 m |
| 600 m | 12.5 s | 260 m |
| 800 m | 15.1 s | 426 m |

From 8 km away, a 45 m bend is about 0.3°, a few phone pixels; a fall of
400 m or more shows its bend clearly.

## Failure Modes

- **Farmland to the horizon.** It contradicts the separate agricultural
  modules and reads as flat ground with no height.
- **Skyscraper skylines.** Nothing in the habitat's density calls for them,
  and they dwarf the landscape the designs aim for.
- **Single houses as geometry far away.** They cost triangles and vanish
  below a pixel; draw them in the land shader.
- **Industrial yards in the valleys.** Heavy industry belongs in zero
  gravity, outside the living land.

## Sources

- G. K. O'Neill, *The Colonization of Space*, Physics Today 27(9), 1974. No
  combustion vehicles in the habitat.
- G. K. O'Neill, *The High Frontier*, 1976. Island Three with agricultural
  modules on a ring and zero-gravity industries at the end of the cylinder,
  as captioned in the [Don Davis High Frontier art show](https://ssi.org/?p=37).
- R. D. Johnson and C. Holbrow (eds.),
  [*Space Settlements: A Design Study*](https://nss.org/settlement/nasa/75SummerStudy/Table_of_Contents1.html),
  NASA SP-413, 1977. The Stanford torus, not Island Three: chapter 3 sets the
  47 m² per person and parks-beside-density criteria; chapter 5 describes
  low-rise, terraced housing, walking, bicycles, transit cars, elevators, and
  fabrication outside the living space. Its built-in agriculture does not
  transfer to Island Three.
- NASA Ames artwork, 1975
  ([catalogue](https://nss.org/settlement/nasa/70sArt/art.html)):
  Rick Guidice, AC75-1086, a valley of rivers, lakes, woods, and meadows
  with a terraced end cap; Don Davis, AC75-1883, an end cap with a long
  suspension bridge over a bay, after the Golden Gate from Sausalito.
- National Space Society,
  [*O'Neill Cylinder Space Settlement*](https://nss.org/o-neill-cylinder-space-settlement/):
  land area, population, weather, and the agricultural ring.
- Blue Origin's 2019 O'Neill-colony presentation, as reported by
  [NBC News](https://www.nbcnews.com/mach/science/jeff-bezos-foresees-trillion-people-living-millions-space-colonies-here-ncna1006036):
  cylinders specialised by use (cities, farms, a national-park cylinder,
  low-gravity flying) with high-speed trains.

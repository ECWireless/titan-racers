# Island Three

Every course sits inside Island Three, Gerard O'Neill's large space-habitat
design. This note owns the habitat's structure, the conventions that place a
course inside it, and how its sunlight reaches a course. The enclosure
registry lives in `src/game/enclosure/island-three.ts`; how it renders follows
[`visual-identity.md`](visual-identity.md).

## Structure

Island Three is a pair of counter-rotating cylinders joined at their ends,
whose spins cancel so the pair can keep its axis pointed at the Sun. Titan
Racers models one cylinder (`enclosure.island-three@1`):

| Feature | Value |
| --- | --- |
| Floor radius | 4,000 m (an 8 km diameter; some accounts give 6.4 km) |
| Interior length | 32,000 m |
| Spin for 1 g at the floor | √(g / R) ≈ 0.0495 rad/s: one turn every 127 s (0.47 rpm) |
| Circumference | Six equal strips along the full length: three land valleys alternating with three windows, each 60° (about 4.2 km wide) |
| Windows | Many small panes in aluminium or steel frames, which carry the air-pressure load |
| Mirrors | One long flat mirror per window, hinged at the window's anti-sun end, its free edge toward the Sun. It reflects sunlight in through the window; opening it fully so the window sees space makes night |
| Atmosphere | About half sea-level pressure (0.2 atm oxygen, 0.3 atm nitrogen), enough to haze the far side |

Sources: G. K. O'Neill, *The Colonization of Space*, Physics Today 27(9),
1974; G. K. O'Neill, *The High Frontier*, 1976; R. D. Johnson and C. Holbrow
(eds.), *Space Settlements: A Design Study*, NASA SP-413, 1977; the
[National Space Society summary](https://nss.org/o-neill-cylinder-space-settlement/).

### Interpretations

The sources do not specify these, so Titan Racers chooses them:

- **End caps** close each end of the cylinder.
- **Each valley is lit through the window opposite it.** A mirror's light
  enters its window and crosses the axis to the far valley, so from a valley
  floor the sun's image appears in the window overhead. All three mirrors
  share one angle per course.
- **Island Three orbits Saturn with Titan,** 1.22 million km from Saturn and
  9.54 AU from the Sun, where the Sun looks a tenth as wide as from Earth.
  The sun's image in the windows has that size.
- **Sunlight is not scaled for distance from the Sun.** The light level comes
  from the registry, not from where the habitat orbits.

### Rendering

The race draws the enclosure around the course as a distant layer
(`src/game/enclosure/enclosure-view.ts`). These choices are Titan Racers'
own:

- Window frames are sized to read from kilometres away: sills along each
  window edge, longerons every 10°, and ring frames every kilometre, with
  lighter mullions between them. The sources' panes are far smaller.
- Valleys are lived-in landscape built in code, following
  [habitat land use](../skills/game-concepts/habitat-land-use/README.md):
  meadows, woods, single park trees and footpaths, a river with lakes, a
  valley road, and towns, villages, and hamlets of houses in gardens. No
  settlement reaches Falls View Park, the sunward 6 km of the valley at
  azimuth 120°, whose lake lies below the sunward terraces.
- The valleys roll in hills up to about 65 m, kept gentle as
  [habitat land use](../skills/game-concepts/habitat-land-use/README.md)
  explains. Hills settle flat toward water, the windows, and the terraces,
  under settlements, and within 700 m of the falls lake's shore, where the
  bridge stands. Every valley is shaded by them; the course's own valley
  also rises in geometry, so hills show in silhouette where the view grazes.
- Each course sits in a flat, mown clearing of 220 m radius, ringed
  by clumps of real trees that open toward the sunward cap. A course that
  names its footprint draws the clearing's floor around it as its own
  drivable lawn, following the floor's curve out to the clearing's edge,
  where the habitat's painted lawn takes over. A park fence closes it 215 m
  out
  ([course data](../skills/project-systems/course-data/README.md)). Within 750 m of
  the course the woods and park trees are real trees, 10–24 m tall: three
  broadleaves and a fir, each a billboard baked from a scanned tree that
  turns to face the camera ([tree billboards](visual-identity.md#tree-billboards)).
  Beyond, the woods' canopy rises 12 m as relief. In the course's valley, the town
  and village centres stand as blocks of three to five storeys.
- End caps are ribbed plating. In each valley's sector, eight terraces climb
  from the floor to 0.7 R, reaching 800 m into the valley: each a 150 m step
  of retaining wall, planted slope, and level shelf, some shelves lined with
  terraced housing. An elevator line climbs each sector, up the terraces'
  faces and then the cap, to a hub at the axis where the docks are.
- The falls drop 800 m from a spillway in a granite gorge cut through the
  lowest six sunward terraces of Falls View Park, spinward of the course's
  view of the cap, into a plunge pool joined to its lake. Falling for 15 s,
  they bend about 426 m anti-spinward as the habitat turns beneath them,
  ignoring air drag (`src/game/enclosure/waterfall.ts`). Layered sheets
  break from clear water at the lip into strands and veils whose streaks
  move at the water's own speed, and spray billows where they land.
- The falls bridge, a suspension bridge after Don Davis's 1975 end-cap
  painting, crosses the Falls View Park lake: an 800 m main span, towers
  120 m high, and a deck that follows the floor's curve.
- The air hazes distance: clean-air scattering at half pressure plus
  moisture and dust, together giving 55 km visibility (the distance at which
  contrast falls to 2%), with the haze glowing with the daylight the mirrors
  let in (40% of the sunlight on the Starter Course's afternoon). The
  far side overhead keeps about 57% of its contrast. From Falls View Park the
  end caps, 2.5 and 29.5 km away, keep about 84% and 12%.
- The sun's image is traced through the mirrors, so it shows only where a
  32 km mirror can reflect it to the viewer. The twin cylinder is not drawn.
- The enclosure lights the course too. Besides the sun, a race's diffuse
  light is what the course sees around it: sunlit and shaded floors, caps
  and their terraces, windows showing the mirrors and black space, the haze,
  and the trees ringing its clearing
  (`src/game/enclosure/habitat-light.ts`). It is far dimmer than daylight on
  Earth, so sunlit and shaded ground differ strongly. The enclosure's
  surfaces take the same fill light.

### From Outside

The course loading screen shows Island Three from space
(`src/game/enclosure/exterior-view.ts`): one full-screen shader that traces
the hull, the mirrors, and Saturn, with no meshes or textures.

- The habitat turns at its true spin, one turn every 127 s; the camera, the
  Sun, and Saturn stay still. The camera looks back from the sunlit side, so
  the sunward cap and the mirrors' faces catch the Sun.
- The windows show the lit interior, drawn with the same land, cap, and
  mirror-light code as the race (`src/game/enclosure/habitat-glsl.ts`). The
  mirrors reflect the scene once.
- Saturn hangs behind the habitat as an oblate, banded globe. Titan orbits
  within 0.35° of the ring plane; the habitat's own orbit tilts 2°, so it
  sees the rings nearly edge-on but open enough to read. The Sun stands 20°
  above them. The rings shadow the globe and the
  globe shadows the rings. Saturnshine is the only light where the Sun does
  not reach.
- The camera frames one cylinder; its twin is not drawn. There are no stars:
  beside a sunlit habitat they are far too faint to show, as in a real
  camera.

The screen shows Island Three by day: past 80° the mirrors turn edge-on to
the Sun and the habitat would go dark from outside, so a dusk course's
habitat appears with its mirrors at 80°, while the race keeps its own time.
The screen holds for at least 2.5 s while the race builds behind it, then
fades into the countdown.

## Placing A Course

A course document names its enclosure by `id` and `version` and places its
flat local ground with four values:

| Field | Meaning |
| --- | --- |
| `axial` | Metres along the axis from the midpoint, positive toward the sunward end cap. Courses stay 1200 m clear of the caps, beyond their terraces. |
| `azimuth` | Degrees around the axis, increasing spinward. Valley *k* is centred at 120 *k*°, and courses stay 1.5° clear of the windows. |
| `heading` | Yaw in degrees from the course's −Z to the sunward axis. |
| `height` | Metres above the floor, at least 100 m clear of the axis. Floor courses use 0, or enough to keep the floor below a kart's eye where it curves up around the axis (about 1.3 m 100 m out); Falls View Park uses 0.9. |

The course origin sits on the placement with +Y toward the axis. The cylinder
spins right-handed about the sunward axis, so spinward = up × sunward. Course
physics stays local, with the spin's gravity and Coriolis acting on the kart
([environment](kart-system/environment.md#rotating-habitat)).

Outside production, `?axisRamp` races the Starter Course with a temporary
test ramp (`src/game/course/axis-ramp-test.ts`), shows the kart's altitude
above the floor and its gravity on the HUD, and records no telemetry. An
apron leaves the course through a gap in its perimeter wall, an open 20° ramp
climbs to a flat pad 500 m from the axis (1/8 g), and a final ramp ends in a
wall at the axis itself. Nothing else is walled, so karts can leave it
anywhere; one that does falls outward until the usual fall reset 10 m below
the floor. Its centreline runs sunward through the course origin, where
gravity keeps its direction and only weakens; off the centreline it tilts,
most near the axis. `?axisRamp=<height>` starts the kart that many metres up,
at most 10 m below the axis. The pad and axis lie 10–11 km from the course
origin, where single-precision physics positions step by about 1 mm, so
motion slower than about 0.1 m/s there is coarse or rounded away. A kart parked on
the ramp rolls back, as a free-rolling kart does on a 20° slope.

## Sunlight

The course's `mirrorAngle` (5–90°) is the opening of its mirror from the
window and sets the time of day. A flat mirror opened by α turns the Sun's
rays by 2α, so the sun's image sits 2α above the horizon:

- below 45° it sits toward the sunward end cap (morning);
- at 45° it is overhead (noon);
- above 45° it sits toward the anti-sun end cap (evening).

A mirror is only as long as the cylinder, so its light lands on a band of
the opposite valley that moves along the axis with the angle. A low morning
sun lights the anti-sun end, noon most of the floor, and a low evening sun
the sunward end. Below about 13° the light falls on the anti-sun cap and
above about 83° on the sunward cap, leaving the valley floors dark. A course
gets direct sun only if its placement lies in its mirror's band
(`sunReaches`), and the enclosure floors show the same band.
Outside it, the haze also loses its glow toward the sun's image.

### Dusk And Night

The daylight inside is what the mirrors send through the windows onto the
floors and caps (`daylight`). It peaks just after noon, where the mirror
catches the most sunlight (about 1.2 of noon's at 60°), and falls as the
mirror opens toward the anti-sun end: about half at 80°, a quarter at 84°
with all of it on the sunward cap, and none once the mirror stands fully
open at 90°, where the window sees only space. Closing a morning mirror
toward the window darkens the habitat the same way.

- The haze glows with the daylight, so it fades at dusk and is dark at
  night, and the habitat's light on the course fades with it.
- The race exposes for its course's key light, as eyes adjust fully at these
  levels, up to 64 times brighter (`adaptation` in `habitat-light.ts`). The
  key light counts the habitat's fill, any sun, and 40% of the light of the
  course's own floodlights, since the lit course fills under half the view.
  So a floodlit course reads brighter than day, while dusk shows in the dark
  haze, the missing sun shadows, and the dimmer valley around it.
- Island Three's lamps come on with the mirrors' schedule, below about a
  twentieth of noon's daylight, well before a light sensor would:
  street lamps along the valley roads and through the towns and villages,
  1000 cd each in warm white. Seen from afar they keep their total light, so
  a distant lamp is a faint point and a far town a dim glow, and they show
  only once the haze has dimmed. The enclosure view leaves out those near the
  course, whose lamps stand on their own masts.
- Brighter lights carry through the dusk haze from kilometres away: the falls
  bridge's necklace of lamps along its main cables, its deck lamps, and red
  beacons on its towers; a few floodlit sports fields up the valley sides
  and across the cylinder; and the falls themselves, floodlit to about
  300 lux like a landmark (`src/game/enclosure/distant-lights.ts`).
- A course has at most twelve floodlights, as a lit circuit has: 12 m
  masts with a sports floodlight of about 250,000 cd in neutral
  white (about 4500 K) shining down, on the habitat's lamp schedule, with no
  shadows. Falls View Park races at deep dusk (89.5°) under twelve, placed
  along its outdoor sections and its service road; the habitat gives about
  400 lux everywhere. Separately, up to eight park street lamps can stand
  on outdoor cylinder columns, at the habitat roads' 1,000 cd warm white,
  on the same schedule and without shadows. Falls View Park's return lane
  has four 6 m columns leading anti-sunward toward the tunnel portal; their
  light does not change the race's exposure. Indoor tunnel and work lamps
  share a separate twenty-lamp limit
  ([course data](../skills/project-systems/course-data/README.md)).

Everything rotates together, so the light holds still for a whole race. The
sun is the course's only shadow-casting light.

Courses saved before the enclosure existed are placed at the middle of the
first valley, turned and timed so the sun shines from their old key light's
direction. They use the evening side, whose light reaches the middle of the
habitat for sun elevations above about 27°.

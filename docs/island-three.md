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
- Valleys are farmland built in code: hedged fields, woods, a river,
  ponds, villages, and service roads. Each course sits in a mown clearing.
- End caps are flat, ribbed plating, with valley land terracing up their
  foot.
- The air hazes distance: clean-air scattering at half pressure plus
  moisture and dust, together giving 55 km visibility (the distance at which
  contrast falls to 2%), with the haze glowing at 40% of the sunlight. The
  far side overhead keeps about 57% of its contrast. On the Agricultural
  Zone's loop the end caps, 8 and 24 km away, keep about 57% and 18%.
- The sun's image is traced through the mirrors, so it shows only where a
  32 km mirror can reflect it to the viewer. The twin cylinder is not drawn.
- The enclosure lights the course too. Besides the sun, a race's diffuse
  light is what the course sees around it: sunlit and shaded floors, caps,
  windows showing the mirrors and black space, and the haze
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
- Saturn hangs behind the habitat as an oblate, banded globe. Titan orbits in
  the ring plane, so the habitat sits 2° above the rings and sees them nearly
  edge-on; the Sun stands 20° above them. The rings shadow the globe and the
  globe shadows the rings. Saturnshine is the only light where the Sun does
  not reach.
- The camera frames one cylinder; its twin is not drawn. There are no stars:
  beside a sunlit habitat they are far too faint to show, as in a real
  camera.

The screen holds for at least 2.5 s while the race builds behind it, then
fades into the countdown.

## Placing A Course

A course document names its enclosure by `id` and `version` and places its
flat local ground with four values:

| Field | Meaning |
| --- | --- |
| `axial` | Metres along the axis from the midpoint, positive toward the sunward end cap. Courses stay 500 m clear of the caps. |
| `azimuth` | Degrees around the axis, increasing spinward. Valley *k* is centred at 120 *k*°, and courses stay 1.5° clear of the windows. |
| `heading` | Yaw in degrees from the course's −Z to the sunward axis. |
| `height` | Metres above the floor, at least 100 m clear of the axis. Floor courses use 0. |

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
the ramp rolls back, as a free-rolling kart does on a 20° slope; in weak
gravity, finite wheel sweeps also hop on the slopes because grounded heave
damping only acts on near-level support.

## Sunlight

The course's `mirrorAngle` (5–85°) is the opening of its mirror from the
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

Everything rotates together, so the light holds still for a whole race. The
sun is the course's only shadow-casting light.

Courses saved before the enclosure existed are placed at the middle of the
first valley, turned and timed so the sun shines from their old key light's
direction. They use the evening side, whose light reaches the middle of the
habitat for sun elevations above about 27°.

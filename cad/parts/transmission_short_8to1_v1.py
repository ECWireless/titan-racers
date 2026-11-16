"""Short 8:1 transmission: the laydown gearbox with a 52-tooth spur and 13-tooth pinion.

See `_laydown_gearbox` for the real part it models and its frame.
"""

from . import _laydown_gearbox as laydown

PART = "transmission.short-8to1@1"

GEARBOX = laydown.Gearbox(
    part=PART,
    spur_teeth=52,
    pinion_teeth=13,
    envelope=(0.032, 0.017, 0.03),
    case_half_width=0.0105,
    diff_housing_radius=0.014,
    heavy=True,
)
POINTS = GEARBOX.points()


def build():
    return laydown.build(GEARBOX)


def mass_bodies():
    return laydown.mass_bodies(GEARBOX)

"""Tall 4:1 transmission: the laydown gearbox with a 36-tooth spur and 18-tooth pinion.

See `_laydown_gearbox` for the real part it models and its frame.
"""

from . import _laydown_gearbox as laydown

PART = "transmission.tall-4to1@1"

GEARBOX = laydown.Gearbox(
    part=PART,
    spur_teeth=36,
    pinion_teeth=18,
    envelope=(0.03, 0.015, 0.0275),
    case_half_width=0.0095,
    diff_housing_radius=0.0125,
    heavy=False,
)
POINTS = GEARBOX.points()


def build():
    return laydown.build(GEARBOX)


def mass_bodies():
    return laydown.mass_bodies(GEARBOX)

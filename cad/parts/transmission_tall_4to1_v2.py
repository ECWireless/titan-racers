"""Tall 4:1 transmission, version 2: the laydown gearbox with a motor plate, a 54-tooth spur, and a 27-tooth pinion.

See `_plate_gearbox` for the real part it models, its frame, and its
mounting points.
"""

from . import _plate_gearbox as plate

PART = "transmission.tall-4to1@2"

GEARBOX = plate.Gearbox(
    part=PART,
    spur_teeth=54,
    pinion_teeth=27,
    floor=-0.015,
    cup_mouth=0.03,
    case_half_width=0.0095,
    diff_housing_radius=0.0125,
    heavy=False,
)
POINTS = GEARBOX.points()


def build():
    return plate.build(GEARBOX)


def mass_bodies():
    return plate.mass_bodies(GEARBOX)

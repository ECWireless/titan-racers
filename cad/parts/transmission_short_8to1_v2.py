"""Short 8:1 transmission, version 2: the laydown gearbox with a motor plate, a 68-tooth spur, and a 17-tooth pinion.

See `_plate_gearbox` for the real part it models, its frame, and its
mounting points.
"""

from . import _plate_gearbox as plate

PART = "transmission.short-8to1@2"

GEARBOX = plate.Gearbox(
    part=PART,
    spur_teeth=68,
    pinion_teeth=17,
    floor=-0.017,
    cup_mouth=0.032,
    case_half_width=0.0105,
    diff_housing_radius=0.014,
    heavy=True,
)
POINTS = GEARBOX.points()


def build():
    return plate.build(GEARBOX)


def mass_bodies():
    return plate.mass_bodies(GEARBOX)

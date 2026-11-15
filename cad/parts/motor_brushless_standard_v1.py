"""Standard brushless motor: a sealed 540-size can (36 mm across).

Stand-in that proves the CAD pipeline; the PR 7.1 contest replaces it.
Frame: the motor axis is Z, with the 3.2 mm shaft leaving the drive end
toward -Z; the can is centred on the origin.
"""

from build123d import Box, Cylinder, GeomType, Pos, chamfer, fillet

PART = "motor.brushless-standard@1"

CAN_RADIUS = 0.018
CAN_LENGTH = 0.038
BARREL_RADIUS = 0.017  # recessed between the end collars
BARREL_LENGTH = 0.022
MOUNT_HOLE_SPACING = 0.025  # M3 holes on the drive face
SHAFT_RADIUS = 0.0016
SHAFT_TIP_Z = -0.030
BOSS_RADIUS = 0.006
BOSS_LENGTH = 0.0015
CAP_RADIUS = 0.0165
CAP_LENGTH = 0.0035

FRONT = -CAN_LENGTH / 2
REAR = CAN_LENGTH / 2


def can():
    body = Cylinder(CAN_RADIUS, CAN_LENGTH)
    body = fillet(body.edges().filter_by(GeomType.CIRCLE), 0.001)
    body -= Cylinder(CAN_RADIUS + 0.001, BARREL_LENGTH) - Cylinder(
        BARREL_RADIUS, BARREL_LENGTH
    )
    for x in (-MOUNT_HOLE_SPACING / 2, MOUNT_HOLE_SPACING / 2):
        body -= Pos(x, 0, FRONT) * Cylinder(0.0016, 0.004)
    return body


def shaft_and_boss():
    boss = Pos(0, 0, FRONT - BOSS_LENGTH / 2) * Cylinder(BOSS_RADIUS, BOSS_LENGTH)
    shaft_length = FRONT - SHAFT_TIP_Z
    shaft = Pos(0, 0, SHAFT_TIP_Z + shaft_length / 2) * Cylinder(
        SHAFT_RADIUS, shaft_length
    )
    shaft = chamfer(shaft.edges().sort_by()[0], 0.0004)
    return boss + shaft


def end_cap():
    cap = Pos(0, 0, REAR + CAP_LENGTH / 2) * Cylinder(CAP_RADIUS, CAP_LENGTH)
    return chamfer(cap.edges().sort_by()[-1], 0.0015)


def terminals():
    return [
        Pos(x, 0.006, REAR + CAP_LENGTH + 0.0015) * Box(0.004, 0.0015, 0.004)
        for x in (-0.007, 0, 0.007)
    ]


def build():
    return {
        "black-oxide-steel": can(),
        "bare-steel": shaft_and_boss(),
        "black-polymer": end_cap(),
        "copper": terminals(),
    }


def mass_bodies():
    """A coarse interior: can, end bells, stator, windings, rotor, shaft."""
    length = 0.026
    return [
        (Cylinder(CAN_RADIUS, CAN_LENGTH) - Cylinder(0.0172, CAN_LENGTH), "steel"),
        (Pos(0, 0, FRONT + 0.001) * Cylinder(0.0172, 0.002), "aluminum"),
        (Pos(0, 0, REAR - 0.001) * Cylinder(0.0172, 0.002), "aluminum"),
        (Cylinder(0.0172, length) - Cylinder(0.0125, length), "steel"),
        (Cylinder(0.0125, length) - Cylinder(0.0085, length), "copper"),
        (Cylinder(0.0075, length) - Cylinder(SHAFT_RADIUS, length), "neodymium"),
        (Pos(0, 0, -0.0055) * Cylinder(SHAFT_RADIUS, 0.049), "steel"),
        (end_cap(), "polymer"),
    ]

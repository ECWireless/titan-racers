"""Standard brushless motor: a sealed 540-size (3650) sensorless inrunner.

Modelled on the common sealed 36 mm can of that class (Hobbywing QuicRun
3650, Surpass Rocket 3650): a steel flux sleeve with heat-sink grooves
between machined aluminium end bells, a 12 mm bearing boss and two M3 holes
25 mm apart at the drive end, a 3.175 mm (1/8 in) shaft with a pinion
flat, and three phase tabs on the rear bell. The can is 43 mm long rather
than the class's 50 mm, to stay inside the part's 45 mm envelope.

Frame: the motor axis is Z, with the shaft leaving the drive end toward -Z;
the envelope is centred on the origin.
"""

from build123d import Box, Cylinder, Pos

from ._shapes import turned

PART = "motor.brushless-standard@1"

CAN_RADIUS = 0.018  # 36 mm, the 540 size
BELL_RADIUS = 0.0175  # end bells sit a step inside the sleeve
BOSS_FACE = -0.0225  # the envelope's drive end
MOUNT_FACE = -0.021
SLEEVE_FRONT = -0.0155
SLEEVE_REAR = 0.0125
REAR_FACE = 0.0205

BOSS_RADIUS = 0.006  # 12 mm bearing boss
MOUNT_CIRCLE_RADIUS = 0.0125  # M3 on a 25 mm circle
MOUNT_HOLE_RADIUS = 0.0015
MOUNT_HOLE_DEPTH = 0.003

SHAFT_RADIUS = 0.0015875  # 3.175 mm
SHAFT_TIP = -0.034  # 13 mm proud of the mount face
SHAFT_FLAT_LENGTH = 0.009
SHAFT_FLAT_DEPTH = 0.0004

GROOVE_COUNT = 3
GROOVE_PITCH = 0.006
GROOVE_WIDTH = 0.0024
GROOVE_DEPTH = 0.0012

TAB_SPACING = 0.0085
TAB_HEIGHT = 0.0085  # above the axis
TAB_SIZE = (0.0045, 0.0012, 0.0045)
TAB_BLOCK_SIZE = (0.026, 0.0055, 0.002)


def sleeve():
    """The steel flux sleeve, turned with V-shaped heat-sink grooves."""
    profile = [(SLEEVE_FRONT, 0), (SLEEVE_FRONT, CAN_RADIUS)]
    middle = (SLEEVE_FRONT + SLEEVE_REAR) / 2
    for index in range(GROOVE_COUNT):
        start = middle + (index - (GROOVE_COUNT - 1) / 2) * GROOVE_PITCH
        start -= GROOVE_WIDTH / 2
        profile += [
            (start, CAN_RADIUS),
            (start + GROOVE_WIDTH / 2, CAN_RADIUS - GROOVE_DEPTH),
            (start + GROOVE_WIDTH, CAN_RADIUS),
        ]
    profile += [(SLEEVE_REAR, CAN_RADIUS), (SLEEVE_REAR, 0)]
    return turned(profile)


def drive_bell():
    """The drive-end bell: mount face, bearing boss, and two M3 holes."""
    bell = turned(
        [
            (BOSS_FACE, 0),
            (BOSS_FACE, BOSS_RADIUS - 0.0006),
            (BOSS_FACE + 0.0006, BOSS_RADIUS),
            (MOUNT_FACE, BOSS_RADIUS),
            (MOUNT_FACE, BELL_RADIUS - 0.001),
            (MOUNT_FACE + 0.001, BELL_RADIUS),
            (SLEEVE_FRONT, BELL_RADIUS),
            (SLEEVE_FRONT, 0),
        ]
    )
    for side in (-1, 1):
        bell -= Pos(
            side * MOUNT_CIRCLE_RADIUS, 0, MOUNT_FACE + MOUNT_HOLE_DEPTH / 2
        ) * Cylinder(MOUNT_HOLE_RADIUS, MOUNT_HOLE_DEPTH)
    return bell


def rear_bell():
    """The rear bell, anodized in the builder's colour."""
    return turned(
        [
            (SLEEVE_REAR, 0),
            (SLEEVE_REAR, BELL_RADIUS),
            (REAR_FACE - 0.0015, BELL_RADIUS),
            (REAR_FACE, BELL_RADIUS - 0.0015),
            (REAR_FACE, 0),
        ]
    )


def shaft():
    """The shaft, with its pinion flat."""
    rod = turned(
        [
            (SHAFT_TIP, 0),
            (SHAFT_TIP, SHAFT_RADIUS),
            (BOSS_FACE + 0.001, SHAFT_RADIUS),
            (BOSS_FACE + 0.001, 0),
        ]
    )
    flat = Pos(
        0,
        SHAFT_RADIUS - SHAFT_FLAT_DEPTH + 0.001,
        SHAFT_TIP + SHAFT_FLAT_LENGTH / 2,
    ) * Box(0.004, 0.002, SHAFT_FLAT_LENGTH)
    return rod - flat


def tab_block():
    """The moulded insulator the phase tabs stand in."""
    width, height, depth = TAB_BLOCK_SIZE
    return Pos(0, TAB_HEIGHT, REAR_FACE + depth / 2) * Box(width, height, depth)


def tabs():
    width, thickness, length = TAB_SIZE
    seat = REAR_FACE + TAB_BLOCK_SIZE[2]
    solids = []
    for index in (-1, 0, 1):
        solids.append(
            Pos(index * TAB_SPACING, TAB_HEIGHT, seat + length / 2)
            * Box(width, thickness, length)
        )
    return solids


def build():
    return {
        "black-oxide-steel": sleeve(),
        "bare-aluminum": drive_bell(),
        "authored-anodized": rear_bell(),
        "bare-steel": shaft(),
        "black-polymer": tab_block(),
        "copper": tabs(),
    }


def mass_bodies():
    """A coarse interior: sleeve, bells, stator, windings, rotor, shaft."""
    stack = 0.024  # lamination stack and magnet length
    centre = Pos(0, 0, (SLEEVE_FRONT + SLEEVE_REAR) / 2)
    sleeve_length = SLEEVE_REAR - SLEEVE_FRONT
    drive_plate = MOUNT_FACE + 0.0015
    rear_plate = REAR_FACE - 0.0015
    shaft_length = REAR_FACE - SHAFT_TIP
    return [
        (
            centre * (Cylinder(CAN_RADIUS, sleeve_length) - Cylinder(0.017, sleeve_length)),
            "steel",
        ),
        # Each bell is a 3 mm plate with a rim; the rest is air and bearing.
        (Pos(0, 0, drive_plate) * Cylinder(BELL_RADIUS, 0.003), "aluminum"),
        (Pos(0, 0, rear_plate) * Cylinder(BELL_RADIUS, 0.003), "aluminum"),
        (centre * (Cylinder(0.017, stack) - Cylinder(0.0135, stack)), "steel"),
        # Slotless windings fill about half the gap they occupy.
        (centre * (Cylinder(0.0135, stack) - Cylinder(0.0115, stack)), "copper"),
        (centre * (Cylinder(0.0075, stack) - Cylinder(0.0025, stack)), "neodymium"),
        (
            Pos(0, 0, SHAFT_TIP + shaft_length / 2) * Cylinder(SHAFT_RADIUS, shaft_length),
            "steel",
        ),
        # Two 5 x 11 x 5 mm ball bearings.
        (Pos(0, 0, drive_plate) * (Cylinder(0.0055, 0.005) - Cylinder(0.0025, 0.005)), "steel"),
        (Pos(0, 0, rear_plate) * (Cylinder(0.0055, 0.005) - Cylinder(0.0025, 0.005)), "steel"),
        (tab_block(), "polymer"),
    ]

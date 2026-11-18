"""Standard steering servo: a low-profile standard-size servo and its horn.

Modelled on the low-profile standard class used in 1:10 cars (Savox
SC-1251MG: 40.8 x 20.2 x 25.4 mm): a finned aluminium centre case between
moulded covers, a 25-tooth 5.9 mm output spline in a round turret, and a
steering horn carrying a ball stud for each tie rod. Its mounting tabs are
the standard-size servo's: one at each end, 54.5 mm overall with holes
49.5 mm apart, moulded with the centre case's top. Version 1 had side lugs
instead, to stay inside a 42 mm envelope.

It rests on its bottom cover: `FLOOR` is its `base` mounting point.

Frame: +Y is up and the case rests on the envelope's floor; the output
shaft is vertical, 9 mm toward -Z (forward) of the centre. The horn points
back over the case and is exported as a moving piece, which the game turns
about `horn-pivot`'s vertical axis with the steering.
"""

from build123d import (
    Axis,
    Box,
    Circle,
    Cylinder,
    Plane,
    Pos,
    RegularPolygon,
    Rot,
    chamfer,
    extrude,
    fillet,
    make_hull,
)

from ._shapes import turned

PART = "steering.servo-standard@2"

CASE_WIDTH = 0.0202
CASE_LENGTH = 0.0408
CASE_CORNER = 0.0015
FLOOR = -0.015  # the envelope's floor
BOTTOM_COVER_TOP = -0.0105
CENTRE_CASE_TOP = 0.001
CASE_TOP = 0.009
CENTRE_CASE_INSET = 0.0003  # the covers stand a hair proud of the centre case

FIN_COUNT = 3
FIN_PITCH = 0.003
FIN_GROOVE = (0.0007, 0.0012, 0.03)  # depth, height, length

TAB_LENGTH = 0.0545  # tip to tip
TAB_WIDTH = 0.018
TAB_THICKNESS = 0.0025
TAB_HOLE_RADIUS = 0.0021  # for a rubber grommet's 4.2 mm core
TAB_HOLE_SPACING = 0.0495
TAB_SLOT_WIDTH = 0.0012  # each hole's slot to the tab's tip

OUTPUT_Z = -0.009
TURRET_RADIUS = 0.0052
TURRET_TOP = 0.0102
SPLINE_RADIUS = 0.00295  # 25 teeth, 5.9 mm
SPLINE_TOP = 0.0126

HORN_BOTTOM = 0.0106
HORN_TOP = 0.0128
HORN_HUB_RADIUS = 0.0046
HORN_RADIUS = 0.02  # output axis to the ball studs' line
HORN_STUD_OFFSET = 0.007  # each stud, either side of the centreline
HORN_STUD_PAD = 0.0034
HORN_SCREW_RADIUS = 0.0024
HORN_SCREW_TOP = 0.014
STUD_HEX_RADIUS = 0.0026  # 4.5 mm across flats
STUD_HEX_HEIGHT = 0.0016
STUD_NECK_RADIUS = 0.0012
BALL_HEIGHT = 0.0038  # ball centre above the horn

LEAD_BOOT = (0.007, 0.004, 0.0006)

BALL_Y = HORN_TOP + BALL_HEIGHT
STUD_Z = OUTPUT_Z + HORN_RADIUS

# Where the game's steering linkage meets the part, and where it mounts.
POINTS = {
    "mount-base": (0, FLOOR, 0),
    "horn-pivot": (0, HORN_BOTTOM, OUTPUT_Z),
    "horn-ball-left": (-HORN_STUD_OFFSET, BALL_Y, STUD_Z),
    "horn-ball-right": (HORN_STUD_OFFSET, BALL_Y, STUD_Z),
}


def case_section(bottom, top, inset=0.0):
    height = top - bottom
    block = Pos(0, (bottom + top) / 2, 0) * Box(
        CASE_WIDTH - 2 * inset, height, CASE_LENGTH - 2 * inset
    )
    return fillet(block.edges().filter_by(Axis.Y), CASE_CORNER)


def covers():
    """The moulded bottom cover and gear cover, with the output turret."""
    top = case_section(CENTRE_CASE_TOP, CASE_TOP)
    top = chamfer(top.edges().group_by(Axis.Y)[-1], 0.0006)
    turret = turned(
        [
            (CASE_TOP - 0.001, 0),
            (CASE_TOP - 0.001, TURRET_RADIUS),
            (TURRET_TOP, TURRET_RADIUS),
            (TURRET_TOP, 0),
        ],
        "y",
    )
    return [
        case_section(FLOOR, BOTTOM_COVER_TOP),
        top + Pos(0, 0, OUTPUT_Z) * turret,
    ]


def centre_case():
    """The aluminium centre case: heat-sink grooves and the mounting tabs."""
    case = case_section(BOTTOM_COVER_TOP, CENTRE_CASE_TOP, CENTRE_CASE_INSET)
    depth, height, length = FIN_GROOVE
    middle = (BOTTOM_COVER_TOP + CENTRE_CASE_TOP) / 2 - 0.0015
    for side in (-1, 1):
        for index in range(FIN_COUNT):
            y = middle + (index - (FIN_COUNT - 1) / 2) * FIN_PITCH
            x = side * (CASE_WIDTH / 2 - CENTRE_CASE_INSET)
            case -= Pos(x, y, 0) * Box(2 * depth, height, length)
    return case + tabs()


def tabs():
    """The mounting tabs at each end, under the top cover, each with a
    grommet hole slotted to its tip."""
    y = CENTRE_CASE_TOP - TAB_THICKNESS / 2
    plate = Pos(0, y, 0) * Box(TAB_WIDTH, TAB_THICKNESS, TAB_LENGTH)
    plate = fillet(
        plate.edges().filter_by(Axis.Y).group_by(Axis.Z)[0]
        + plate.edges().filter_by(Axis.Y).group_by(Axis.Z)[-1],
        0.0015,
    )
    for end in (-1, 1):
        hole_z = end * TAB_HOLE_SPACING / 2
        plate -= Pos(0, y, hole_z) * Rot(90, 0, 0) * Cylinder(
            TAB_HOLE_RADIUS, 0.01
        )
        slot = (TAB_LENGTH - TAB_HOLE_SPACING) / 2 + 0.001
        plate -= Pos(0, y, hole_z + end * slot / 2) * Box(
            TAB_SLOT_WIDTH, 0.01, slot
        )
    return plate


def spline():
    return Pos(0, 0, OUTPUT_Z) * turned(
        [
            (TURRET_TOP, 0),
            (TURRET_TOP, SPLINE_RADIUS),
            (SPLINE_TOP, SPLINE_RADIUS),
            (SPLINE_TOP, 0),
        ],
        "y",
    )


def lead_boot():
    """The lead's moulded strain relief on the rear face."""
    width, height, depth = LEAD_BOOT
    return Pos(0, FLOOR + 0.006, CASE_LENGTH / 2 + depth / 2 - 0.0005) * Box(
        width, height, depth + 0.001
    )


def horn_plate():
    """A steering horn: a splined hub and a pad for each tie rod's stud."""
    outline = Pos(0, OUTPUT_Z) * Circle(HORN_HUB_RADIUS)
    for side in (-1, 1):
        outline += Pos(side * HORN_STUD_OFFSET, STUD_Z) * Circle(HORN_STUD_PAD)
    # Sketched on XZ at the horn's top face and extruded down.
    return extrude(
        Plane.XZ.offset(-HORN_TOP) * make_hull(outline.edges()),
        HORN_TOP - HORN_BOTTOM,
    )


def horn_screw():
    return Pos(0, 0, OUTPUT_Z) * turned(
        [
            (HORN_TOP, 0),
            (HORN_TOP, HORN_SCREW_RADIUS),
            (HORN_SCREW_TOP, HORN_SCREW_RADIUS),
            (HORN_SCREW_TOP, 0),
        ],
        "y",
    )


def ball_studs():
    """Each stud's hex seat and neck; the tie rod's cup covers its ball."""
    studs = []
    for side in (-1, 1):
        seat = extrude(
            Plane.XZ.offset(-HORN_TOP - STUD_HEX_HEIGHT)
            * RegularPolygon(STUD_HEX_RADIUS, 6),
            STUD_HEX_HEIGHT,
        )
        neck = Pos(0, HORN_TOP + BALL_HEIGHT / 2 + STUD_HEX_HEIGHT / 2, 0) * Rot(
            90, 0, 0
        ) * Cylinder(STUD_NECK_RADIUS, BALL_HEIGHT - STUD_HEX_HEIGHT)
        studs.append(Pos(side * HORN_STUD_OFFSET, 0, STUD_Z) * (seat + neck))
    return studs


def build():
    return {
        "authored-polymer": covers(),
        "bare-aluminum": centre_case(),
        "bare-steel": spline(),
        "black-polymer": lead_boot(),
    }


def moving():
    return {
        "horn": {
            "black-polymer": horn_plate(),
            "black-oxide-steel": horn_screw(),
            "bare-steel": ball_studs(),
        }
    }


def mass_bodies():
    """A coarse interior: case walls, motor, gear train, board, and horn."""
    wall = 0.0015
    shell = lambda bottom, top: Pos(0, (bottom + top) / 2, 0) * (
        Box(CASE_WIDTH, top - bottom, CASE_LENGTH)
        - Box(CASE_WIDTH - 2 * wall, top - bottom, CASE_LENGTH - 2 * wall)
    )
    lid = lambda y: Pos(0, y, 0) * Box(CASE_WIDTH, wall, CASE_LENGTH)
    gear_y = (CENTRE_CASE_TOP + CASE_TOP) / 2
    motor_y = (FLOOR + CENTRE_CASE_TOP) / 2
    return [
        (shell(FLOOR, BOTTOM_COVER_TOP), "polymer"),
        (lid(FLOOR + wall / 2), "polymer"),
        (shell(BOTTOM_COVER_TOP, CENTRE_CASE_TOP), "aluminum"),
        (tabs() - Box(CASE_WIDTH, 0.01, CASE_LENGTH), "aluminum"),
        (shell(CENTRE_CASE_TOP, CASE_TOP), "polymer"),
        (lid(CASE_TOP - wall / 2), "polymer"),
        # A 12 mm coreless motor, upright at the rear of the case: half its
        # volume is steel and magnet, the rest winding and air.
        (Pos(0, motor_y, 0.011) * Rot(90, 0, 0) * Cylinder(0.006, 0.007), "steel"),
        (Pos(0, motor_y, 0.011) * Rot(90, 0, 0) * Cylinder(0.004, 0.012), "copper"),
        # The metal gear train: four steel gears on their shafts.
        (Pos(0, gear_y, -0.004) * Box(0.013, 0.0045, 0.026), "steel"),
        (
            Pos(0, (FLOOR + SPLINE_TOP) / 2 + 0.006, OUTPUT_Z)
            * Rot(90, 0, 0)
            * Cylinder(SPLINE_RADIUS, 0.014),
            "steel",
        ),
        # Control board and potentiometer.
        (Pos(0, FLOOR + 0.003, -0.006) * Box(0.016, 0.0016, 0.02), "polymer"),
        (horn_plate(), "polymer"),
    ]

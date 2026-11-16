"""The three transmissions: one laydown gearbox, drawn at three reductions.

Modelled on the low "laydown" 3-gear transmissions of 1:10 2WD cars (Team
Associated B6-series laydown): a split case holding a top-shaft gear, an
idler, and the differential gear in a row along the chassis, with the spur
gear outside the case on the top shaft and a slotted outdrive cup on each
side of the differential for a dogbone. The gearbox carries its own input
shaft and pinion, so its reduction shows as the pinion and spur sizes:

    overall reduction = (spur teeth / pinion teeth) x INTERNAL_REDUCTION

Frame: +Y is up and the case stands on the envelope's floor; the outdrives
lie along X, 9 mm toward +Z (rearward) of the centre, and the spur and
pinion are on the +X side.
"""

import math
from dataclasses import dataclass

from build123d import (
    Box,
    Circle,
    Cylinder,
    Plane,
    Pos,
    RegularPolygon,
    Rot,
    extrude,
    make_hull,
)

from ._shapes import gear_teeth, spur_gear, turned

MODULE = 0.0006  # 0.6 module, the common 1:10 pitch
TOP_GEAR_TEETH = 20
DIFF_GEAR_TEETH = 40
INTERNAL_REDUCTION = DIFF_GEAR_TEETH / TOP_GEAR_TEETH

OUTPUT_Z = 0.009  # differential and outdrive axis
TOP_SHAFT_Z = -0.013  # top shaft and spur axis
TOP_HOUSING_RADIUS = 0.0075
INPUT_BOSS_RADIUS = 0.0048
FOOT_HEIGHT = 0.005

SPUR_WIDTH = 0.0045
PINION_WIDTH = 0.006
GEAR_GAP = 0.0015  # case side to the gears' inner faces
INPUT_SHAFT_RADIUS = 0.0015875  # 3.175 mm, the motor shaft's size
INPUT_STUB = 0.008  # proud of the case on the -X side
SPUR_NUT_RADIUS = 0.0032

OUTPUT_SHAFT_RADIUS = 0.0026
CUP_RADIUS = 0.0055
CUP_BORE_RADIUS = 0.0042
CUP_LENGTH = 0.011
CUP_BORE_DEPTH = 0.008
CUP_SLOT_WIDTH = 0.0026  # for a dogbone's 2.5 mm cross pin
CUP_SLOT_DEPTH = 0.006
# A dogbone's ball rides this far inside the cup's mouth at rest.
CUP_BALL_DEPTH = 0.0038

BOLT_RADIUS = 0.0022  # M2.5 hex heads, 4 mm across flats
BOLT_HEIGHT = 0.0016


@dataclass(frozen=True)
class Gearbox:
    part: str
    spur_teeth: int
    pinion_teeth: int
    # Half the construction envelope: X, Y, Z.
    envelope: tuple[float, float, float]
    case_half_width: float
    diff_housing_radius: float
    # A painted steel case on a steel skid plate.
    heavy: bool = False

    @property
    def reduction(self):
        return self.spur_teeth / self.pinion_teeth * INTERNAL_REDUCTION

    @property
    def floor(self):
        return -self.envelope[1]

    @property
    def pinion_centre(self):
        """(y, z) of the input shaft: meshed with the spur, as far rearward
        as the envelope's height lets the pinion sit."""
        spur_pitch, _, _ = gear_teeth(self.spur_teeth, MODULE)
        pinion_pitch, pinion_tip, _ = gear_teeth(self.pinion_teeth, MODULE)
        distance = spur_pitch + pinion_pitch
        y = self.envelope[1] - 0.0003 - pinion_tip
        return y, TOP_SHAFT_Z + math.sqrt(distance**2 - y**2)

    @property
    def gear_x(self):
        return self.case_half_width + GEAR_GAP + PINION_WIDTH / 2

    @property
    def cup_mouth(self):
        return self.envelope[0]

    def points(self):
        """Where each dogbone's ball sits at rest, and the way it plunges."""
        ball = self.cup_mouth - CUP_BALL_DEPTH
        return {
            "output-left": (-ball, 0, OUTPUT_Z),
            "output-right": (ball, 0, OUTPUT_Z),
        }


def case_outline(gearbox: Gearbox, shrink=0.0):
    pinion_y, pinion_z = gearbox.pinion_centre
    outline = Pos(0, OUTPUT_Z) * Circle(gearbox.diff_housing_radius - shrink)
    outline += Pos(0, TOP_SHAFT_Z) * Circle(TOP_HOUSING_RADIUS - shrink)
    outline += Pos(pinion_y, pinion_z) * Circle(INPUT_BOSS_RADIUS - shrink)
    return make_hull(outline.edges())


def case(gearbox: Gearbox):
    """The split case and the foot it stands on."""
    half = gearbox.case_half_width
    # Sketched on YZ (sketch x is +Y, sketch y is +Z) and extruded along X.
    body = extrude(Plane.YZ * case_outline(gearbox), half, both=True)
    foot_length = gearbox.diff_housing_radius + OUTPUT_Z - TOP_SHAFT_Z
    body += Pos(
        0,
        gearbox.floor + FOOT_HEIGHT / 2,
        (OUTPUT_Z + gearbox.diff_housing_radius + TOP_SHAFT_Z) / 2 - 0.002,
    ) * Box(2 * half, FOOT_HEIGHT, foot_length)
    return body


def bolts(gearbox: Gearbox):
    """Hex bolts through the case halves, their heads on the -X side."""
    pinion_y, pinion_z = gearbox.pinion_centre
    ring = gearbox.diff_housing_radius - 0.003
    centres = [
        (ring * math.sin(angle), OUTPUT_Z + ring * math.cos(angle))
        for angle in (math.radians(55), math.radians(-55), math.radians(180))
    ]
    centres.append((-0.004, TOP_SHAFT_Z - 0.002))
    centres = [(y, z) for y, z in centres]
    head = extrude(
        Plane.YZ.offset(-gearbox.case_half_width - BOLT_HEIGHT)
        * RegularPolygon(BOLT_RADIUS, 6),
        BOLT_HEIGHT,
    )
    return [Pos(0, y, z) * head for y, z in centres]


def outdrives(gearbox: Gearbox):
    """Each side's output shaft and slotted dogbone cup."""
    mouth = gearbox.cup_mouth
    back = mouth - CUP_LENGTH
    cup = turned(
        [
            (gearbox.case_half_width - 0.001, 0),
            (gearbox.case_half_width - 0.001, OUTPUT_SHAFT_RADIUS),
            (back, OUTPUT_SHAFT_RADIUS),
            (back, CUP_RADIUS),
            (mouth, CUP_RADIUS),
            (mouth, CUP_BORE_RADIUS),
            (mouth - CUP_BORE_DEPTH, CUP_BORE_RADIUS),
            (mouth - CUP_BORE_DEPTH, 0),
        ],
        "x",
    )
    # The cross pin's slots, cut top and bottom.
    cup -= Pos(mouth - CUP_SLOT_DEPTH / 2 + 0.001, 0, 0) * Box(
        CUP_SLOT_DEPTH + 0.002, 0.02, CUP_SLOT_WIDTH
    )
    right = Pos(0, 0, OUTPUT_Z) * cup
    return [right, Pos(0, 0, OUTPUT_Z) * Rot(0, 180, 0) * cup]


def input_shaft(gearbox: Gearbox):
    """The input shaft: a stub for the motor on -X, through to the pinion."""
    y, z = gearbox.pinion_centre
    left = -gearbox.case_half_width - INPUT_STUB
    right = gearbox.gear_x + PINION_WIDTH / 2 + 0.001
    return Pos((left + right) / 2, y, z) * Rot(0, 90, 0) * Cylinder(
        INPUT_SHAFT_RADIUS, right - left
    )


def pinion(gearbox: Gearbox):
    y, z = gearbox.pinion_centre
    # Turned so a tooth gap faces the spur's tooth on the line of centres.
    toward_spur = math.atan2(-y, TOP_SHAFT_Z - z)
    step = 2 * math.pi / gearbox.pinion_teeth
    phase = toward_spur / step + 0.5
    return Pos(gearbox.gear_x, y, z) * spur_gear(
        gearbox.pinion_teeth, MODULE, PINION_WIDTH, phase=phase
    )


def spur(gearbox: Gearbox):
    y, z = gearbox.pinion_centre
    toward_pinion = math.atan2(y, z - TOP_SHAFT_Z)
    step = 2 * math.pi / gearbox.spur_teeth
    return Pos(gearbox.gear_x, 0, TOP_SHAFT_Z) * spur_gear(
        gearbox.spur_teeth, MODULE, SPUR_WIDTH, phase=toward_pinion / step, tip=0
    )


def spur_nut(gearbox: Gearbox):
    """The locknut that holds the spur on the top shaft."""
    face = gearbox.gear_x + SPUR_WIDTH / 2
    nut = extrude(
        Plane.YZ.offset(face) * RegularPolygon(SPUR_NUT_RADIUS, 6), 0.0025
    )
    return Pos(0, 0, TOP_SHAFT_Z) * nut


def skid_plate(gearbox: Gearbox):
    return Pos(0, gearbox.floor + 0.00075, 0.0005) * Box(
        2 * gearbox.case_half_width + 0.01, 0.0015, 2 * gearbox.envelope[2] - 0.004
    )


def build(gearbox: Gearbox):
    housing = "authored-paint" if gearbox.heavy else "authored-anodized"
    steel = [input_shaft(gearbox), pinion(gearbox), spur_nut(gearbox)]
    if gearbox.heavy:
        steel.append(skid_plate(gearbox))
    return {
        housing: case(gearbox),
        "black-polymer": spur(gearbox),
        "bare-steel": steel,
        "black-oxide-steel": outdrives(gearbox) + bolts(gearbox),
    }


def mass_bodies(gearbox: Gearbox):
    """A coarse interior: case walls, gears, differential, shafts, bearings."""
    wall = 0.002
    half = gearbox.case_half_width
    metal = "steel" if gearbox.heavy else "aluminum"
    outer = extrude(Plane.YZ * case_outline(gearbox), half, both=True)
    inner = extrude(Plane.YZ * case_outline(gearbox, wall), half - wall, both=True)
    disc = lambda radius, width, z: Pos(0, 0, z) * Rot(0, 90, 0) * Cylinder(
        radius, width
    )
    top_pitch, _, _ = gear_teeth(TOP_GEAR_TEETH, MODULE)
    diff_pitch, _, _ = gear_teeth(DIFF_GEAR_TEETH, MODULE)
    idler = (OUTPUT_Z + TOP_SHAFT_Z) / 2 + (top_pitch - diff_pitch) / 2
    idler_radius = (OUTPUT_Z - TOP_SHAFT_Z - top_pitch - diff_pitch) / 2
    bearing = lambda x, z: Pos(x, 0, z) * Rot(0, 90, 0) * (
        Cylinder(0.005, 0.004) - Cylinder(0.0025, 0.004)
    )
    bodies = [
        (outer - inner, metal),
        (case(gearbox) - outer, metal),
        (spur(gearbox), "polymer"),
        (pinion(gearbox), "steel"),
        (input_shaft(gearbox), "steel"),
        (spur_nut(gearbox), "steel"),
        # Internal gears: a steel top gear, and a moulded idler and
        # differential gear; the differential's steel is its outdrives.
        (disc(top_pitch, 0.006, TOP_SHAFT_Z), "steel"),
        (disc(idler_radius, 0.006, idler), "polymer"),
        (disc(diff_pitch, 0.006, OUTPUT_Z), "polymer"),
        (disc(0.0025, 2 * half + SPUR_WIDTH + 0.003, TOP_SHAFT_Z), "steel"),
        *((solid, "steel") for solid in outdrives(gearbox)),
        (disc(0.0045, 0.012, OUTPUT_Z), "steel"),
        *((solid, "steel") for solid in bolts(gearbox)),
    ]
    for side in (-1, 1):
        for z in (TOP_SHAFT_Z, idler, OUTPUT_Z):
            bodies.append((bearing(side * (half - wall - 0.002), z), "steel"))
    if gearbox.heavy:
        bodies.append((skid_plate(gearbox), "steel"))
    return bodies

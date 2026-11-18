"""The three version-2 transmissions: a laydown gearbox with a motor plate.

Modelled, like version 1 (`_laydown_gearbox`), on the low 3-gear laydown
transmissions of 1:10 2WD buggies (Team Associated B6-series): a split case
holding a top-shaft gear, an idler, and the differential gear in a row along
the chassis, a slotted outdrive cup on each side of the differential for a
dogbone, and the spur gear outside the case on the top shaft. Version 2 adds
what lets a motor bolt on, as on the real part:

- an aluminium motor plate outboard of the spur on the +X side, standing on
  the chassis, with a hole for the motor's boss (the motor's face covers
  its bolt pattern, which is not drawn);
- the pinion on the motor's shaft, meshed with the spur at its front, so
  the motor sits ahead of the gearbox with its shaft pointing to -X;
- a spur and pinion at a real car's size: a 54- to 68-tooth spur, 45 to
  56 mm across, so the motor clears the rear arms. They are 0.8 module (the
  metric 32 pitch of larger 1:10 cars; 2WD buggies usually run 48 pitch),
  which keeps each part within its triangle budget. The top shaft rises to
  carry the spur clear of the chassis;
- a flat pad on top of the differential housing for the rear shock tower.

    overall reduction = (spur teeth / pinion teeth) x INTERNAL_REDUCTION

The pinion belongs to the transmission, since its teeth set the reduction.

Frame: +Y is up and the case stands on `floor`; the outdrives lie along X
through the origin. Mounting points: `mount-base` (the floor footprint's
centre), `mount-motor-plate` (the plate's outer face on the motor's axis),
and `mount-tower-pad` (the pad's top centre).
"""

import math
from dataclasses import dataclass

from build123d import (
    Box,
    Circle,
    Cylinder,
    Plane,
    Polygon,
    Pos,
    RegularPolygon,
    Rot,
    extrude,
    make_hull,
)

from ._laydown_gearbox import (
    BOLT_HEIGHT,
    BOLT_RADIUS,
    CUP_BALL_DEPTH,
    CUP_BORE_DEPTH,
    CUP_BORE_RADIUS,
    CUP_LENGTH,
    CUP_RADIUS,
    CUP_SLOT_DEPTH,
    CUP_SLOT_WIDTH,
    DIFF_GEAR_TEETH,
    GEAR_GAP,
    INTERNAL_REDUCTION,
    MODULE,
    OUTPUT_SHAFT_RADIUS,
    PINION_WIDTH,
    SPUR_WIDTH,
    TOP_GEAR_TEETH,
    TOP_HOUSING_RADIUS,
)
from ._shapes import gear_teeth, spur_gear, turned

SPUR_FLOOR_CLEARANCE = 0.0015
SPUR_MODULE = 0.0008  # the spur and pinion; the internal gears keep MODULE
# The spur's teeth pass this far outside the output shaft.
SPUR_SHAFT_CLEARANCE = 0.001

MOTOR_RADIUS = 0.018  # a 540-size can
MOTOR_FLOOR_CLEARANCE = 0.001

PLATE_THICKNESS = 0.0025
PLATE_GAP = 0.0005  # the pinion's outer face to the plate
PLATE_MOTOR_RADIUS = 0.016  # around the motor's axis
PLATE_SHAFT_RADIUS = 0.006  # around the top shaft's bearing
BOSS_HOLE_RADIUS = 0.0065  # clears the motor's 12 mm boss
NUT_RADIUS = 0.0032  # the top shaft's locknut, outside the plate
NUT_HEIGHT = 0.0025

PAD_LENGTH = 0.008  # along Z
PAD_PROUD = 0.0015  # above the differential housing


@dataclass(frozen=True)
class Gearbox:
    part: str
    spur_teeth: int
    pinion_teeth: int
    floor: float  # below the outdrive axis
    cup_mouth: float  # each cup's mouth from the centreline
    case_half_width: float
    diff_housing_radius: float
    # A painted steel case on a steel skid plate.
    heavy: bool = False

    @property
    def reduction(self):
        return self.spur_teeth / self.pinion_teeth * INTERNAL_REDUCTION

    @property
    def train_length(self):
        """The top shaft's distance from the differential's axis: far enough
        that the spur clears the output shaft, with an idler between the top
        gear and the differential gear."""
        _, spur_tip, _ = gear_teeth(self.spur_teeth, SPUR_MODULE)
        return spur_tip + OUTPUT_SHAFT_RADIUS + SPUR_SHAFT_CLEARANCE

    @property
    def top_shaft(self):
        """(y, z) of the top shaft: high enough that the spur clears the
        chassis, ahead of the differential."""
        _, spur_tip, _ = gear_teeth(self.spur_teeth, SPUR_MODULE)
        y = self.floor + spur_tip + SPUR_FLOOR_CLEARANCE
        return y, -math.sqrt(self.train_length**2 - y**2)

    @property
    def motor_axis(self):
        """(y, z) of the pinion and motor: meshed with the spur's front, as
        low as the motor's can clears the chassis."""
        top_y, top_z = self.top_shaft
        spur_pitch, _, _ = gear_teeth(self.spur_teeth, SPUR_MODULE)
        pinion_pitch, _, _ = gear_teeth(self.pinion_teeth, SPUR_MODULE)
        distance = spur_pitch + pinion_pitch
        y = self.floor + MOTOR_RADIUS + MOTOR_FLOOR_CLEARANCE
        return y, top_z - math.sqrt(distance**2 - (top_y - y) ** 2)

    @property
    def gear_x(self):
        return self.case_half_width + GEAR_GAP + PINION_WIDTH / 2

    @property
    def plate_x(self):
        """The motor plate's inner and outer faces."""
        inner = self.gear_x + PINION_WIDTH / 2 + PLATE_GAP
        return inner, inner + PLATE_THICKNESS

    @property
    def pad_top(self):
        return self.diff_housing_radius + PAD_PROUD

    @property
    def case_rear(self):
        return self.diff_housing_radius

    @property
    def base_front(self):
        """The front of the floor footprint: the plate's foot."""
        _, motor_z = self.motor_axis
        return motor_z - PLATE_MOTOR_RADIUS

    def points(self):
        """Where each dogbone's ball sits at rest, and the mounting points."""
        ball = self.cup_mouth - CUP_BALL_DEPTH
        motor_y, motor_z = self.motor_axis
        return {
            "mount-base": (
                (self.plate_x[1] - self.case_half_width) / 2,
                self.floor,
                (self.base_front + self.case_rear) / 2,
            ),
            "mount-motor-plate": (self.plate_x[1], motor_y, motor_z),
            "mount-tower-pad": (0, self.pad_top, 0),
            "output-left": (-ball, 0, 0),
            "output-right": (ball, 0, 0),
        }


def case_outline(gearbox: Gearbox, shrink=0.0):
    """The case's side profile (sketch x is +Y, sketch y is +Z): the two
    housings and a flat foot on the floor beneath them."""
    top_y, top_z = gearbox.top_shaft
    foot = gearbox.floor + shrink
    outline = Circle(gearbox.diff_housing_radius - shrink)
    outline += Pos(top_y, top_z) * Circle(TOP_HOUSING_RADIUS - shrink)
    for z in (top_z - TOP_HOUSING_RADIUS + 0.002, gearbox.case_rear - 0.004):
        outline += Pos(foot + 0.0005, z) * Circle(0.0005)
    return make_hull(outline.edges())


def case(gearbox: Gearbox):
    """The split case and the tower pad on its differential housing."""
    half = gearbox.case_half_width
    body = extrude(Plane.YZ * case_outline(gearbox), half, both=True)
    pad_bottom = gearbox.diff_housing_radius - 0.003
    body += Pos(0, (pad_bottom + gearbox.pad_top) / 2, 0) * Box(
        2 * half, gearbox.pad_top - pad_bottom, PAD_LENGTH
    )
    return body


def bolts(gearbox: Gearbox):
    """Hex bolts through the case halves, their heads on the -X side."""
    top_y, top_z = gearbox.top_shaft
    ring = gearbox.diff_housing_radius - 0.003
    centres = [
        (ring * math.sin(angle), ring * math.cos(angle))
        for angle in (math.radians(-55), math.radians(180))
    ]
    centres.append((top_y - 0.002, top_z + 0.004))
    centres.append((gearbox.floor + 0.004, (top_z + gearbox.case_rear) / 2))
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
    return [cup, Rot(0, 180, 0) * cup]


def plate_outline(gearbox: Gearbox):
    """The motor plate's profile (sketch x is +Y, sketch y is +Z): an
    octagon about the motor, a square about the top shaft's bearing, and a
    foot on the floor. Straight edges keep it to a few triangles."""
    top_y, top_z = gearbox.top_shaft
    motor_y, motor_z = gearbox.motor_axis
    points = [
        (
            motor_y + PLATE_MOTOR_RADIUS * math.cos(angle),
            motor_z + PLATE_MOTOR_RADIUS * math.sin(angle),
        )
        for angle in (math.pi / 8 + index * math.pi / 4 for index in range(8))
    ]
    points += [
        (top_y + dy, top_z + dz)
        for dy in (-PLATE_SHAFT_RADIUS, PLATE_SHAFT_RADIUS)
        for dz in (-PLATE_SHAFT_RADIUS, PLATE_SHAFT_RADIUS)
    ]
    points += [(gearbox.floor, gearbox.base_front + 0.004), (gearbox.floor, top_z)]
    return Polygon(*convex_hull(points), align=None)


def convex_hull(points):
    """Andrew's monotone chain, counter-clockwise."""
    points = sorted(set(points))
    turn = lambda o, a, b: (a[0] - o[0]) * (b[1] - o[1]) - (a[1] - o[1]) * (b[0] - o[0])
    lower, upper = [], []
    for point in points:
        while len(lower) >= 2 and turn(lower[-2], lower[-1], point) <= 0:
            lower.pop()
        lower.append(point)
    for point in reversed(points):
        while len(upper) >= 2 and turn(upper[-2], upper[-1], point) <= 0:
            upper.pop()
        upper.append(point)
    return lower[:-1] + upper[:-1]


def motor_plate(gearbox: Gearbox):
    """The plate, with a twelve-sided hole for the motor's boss; the motor's
    face covers the rest of its bolt pattern."""
    inner, _ = gearbox.plate_x
    motor_y, motor_z = gearbox.motor_axis
    plate = extrude(Plane.YZ.offset(inner) * plate_outline(gearbox), PLATE_THICKNESS)
    hole = extrude(
        Plane.YZ.offset(inner - 0.001)
        * Pos(motor_y, motor_z)
        * RegularPolygon(BOSS_HOLE_RADIUS, 12),
        PLATE_THICKNESS + 0.002,
    )
    return plate - hole


def top_nut(gearbox: Gearbox):
    """The locknut holding the top shaft in the plate's bearing."""
    top_y, top_z = gearbox.top_shaft
    _, outer = gearbox.plate_x
    return extrude(
        Plane.YZ.offset(outer) * Pos(top_y, top_z) * RegularPolygon(NUT_RADIUS, 6),
        NUT_HEIGHT,
    )


def pinion(gearbox: Gearbox):
    motor_y, motor_z = gearbox.motor_axis
    top_y, top_z = gearbox.top_shaft
    # Turned so a tooth gap faces the spur's tooth on the line of centres.
    # `spur_gear` turns its sketch so that angle a points along
    # (y, z) = (sin a, -cos a).
    toward_spur = math.atan2(top_y - motor_y, -(top_z - motor_z))
    step = 2 * math.pi / gearbox.pinion_teeth
    phase = toward_spur / step + 0.5
    return Pos(gearbox.gear_x, motor_y, motor_z) * spur_gear(
        gearbox.pinion_teeth, SPUR_MODULE, PINION_WIDTH, phase=phase, tip=0
    )


def spur(gearbox: Gearbox):
    motor_y, motor_z = gearbox.motor_axis
    top_y, top_z = gearbox.top_shaft
    toward_pinion = math.atan2(motor_y - top_y, -(motor_z - top_z))
    step = 2 * math.pi / gearbox.spur_teeth
    return Pos(gearbox.gear_x, top_y, top_z) * spur_gear(
        gearbox.spur_teeth, SPUR_MODULE, SPUR_WIDTH, phase=toward_pinion / step, tip=0
    )


def skid_plate(gearbox: Gearbox):
    front = gearbox.top_shaft[1] - TOP_HOUSING_RADIUS
    return Pos(
        0, gearbox.floor + 0.00075, (front + gearbox.case_rear) / 2
    ) * Box(2 * gearbox.case_half_width + 0.01, 0.0015, gearbox.case_rear - front)


def build(gearbox: Gearbox):
    housing = "authored-paint" if gearbox.heavy else "authored-anodized"
    steel = [pinion(gearbox), top_nut(gearbox)]
    if gearbox.heavy:
        steel.append(skid_plate(gearbox))
    return {
        housing: case(gearbox),
        "bare-aluminum": motor_plate(gearbox),
        "black-polymer": spur(gearbox),
        "bare-steel": steel,
        "black-oxide-steel": outdrives(gearbox) + bolts(gearbox),
    }


def mass_bodies(gearbox: Gearbox):
    """A coarse interior: case walls, gears, differential, shafts, bearings."""
    wall = 0.002
    half = gearbox.case_half_width
    metal = "steel" if gearbox.heavy else "aluminum"
    top_y, top_z = gearbox.top_shaft
    outer = extrude(Plane.YZ * case_outline(gearbox), half, both=True)
    inner = extrude(Plane.YZ * case_outline(gearbox, wall), half - wall, both=True)
    disc = lambda radius, width, y, z: Pos(0, y, z) * Rot(0, 90, 0) * Cylinder(
        radius, width
    )
    top_pitch, _, _ = gear_teeth(TOP_GEAR_TEETH, MODULE)
    diff_pitch, _, _ = gear_teeth(DIFF_GEAR_TEETH, MODULE)
    # The idler sits on the line between the top shaft and the differential.
    idler_radius = (gearbox.train_length - top_pitch - diff_pitch) / 2
    along = (diff_pitch + idler_radius) / gearbox.train_length
    idler = (top_y * along, top_z * along)
    bearing = lambda x, y, z: Pos(x, y, z) * Rot(0, 90, 0) * (
        Cylinder(0.005, 0.004) - Cylinder(0.0025, 0.004)
    )
    _, plate_outer = gearbox.plate_x
    bodies = [
        (outer - inner, metal),
        (case(gearbox) - outer, metal),
        (motor_plate(gearbox), "aluminum"),
        (spur(gearbox), "polymer"),
        (pinion(gearbox), "steel"),
        (top_nut(gearbox), "steel"),
        # Internal gears: a steel top gear, and a moulded idler and
        # differential gear; the differential's steel is its outdrives.
        (disc(top_pitch, 0.006, top_y, top_z), "steel"),
        (disc(idler_radius, 0.006, *idler), "polymer"),
        (disc(diff_pitch, 0.006, 0, 0), "polymer"),
        (
            Pos((plate_outer - half) / 2, top_y, top_z)
            * Rot(0, 90, 0)
            * Cylinder(0.0025, plate_outer + half),
            "steel",
        ),
        *((solid, "steel") for solid in outdrives(gearbox)),
        (disc(0.0045, 0.012, 0, 0), "steel"),
        *((solid, "steel") for solid in bolts(gearbox)),
    ]
    for side in (-1, 1):
        for y, z in ((top_y, top_z), idler, (0, 0)):
            bodies.append((bearing(side * (half - wall - 0.002), y, z), "steel"))
    if gearbox.heavy:
        bodies.append((skid_plate(gearbox), "steel"))
    return bodies

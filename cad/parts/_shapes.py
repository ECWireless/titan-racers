"""Shapes shared by part models: turned profiles and low-tooth-count gears."""

import math

from build123d import Axis, Plane, Polygon, Rot, extrude, revolve


def turned(profile, axis="z"):
    """Revolve a closed (station along the axis, radius) profile.

    Turned parts are modelled as their lathe profile: every face is a plane,
    cylinder, or cone, which mesh to one row of facets each.
    """
    solid = revolve(
        Plane.XZ * Polygon(*[(r, a) for a, r in profile], align=None), Axis.Z
    )
    if axis == "x":
        return Rot(0, 90, 0) * solid
    if axis == "y":
        return Rot(-90, 0, 0) * solid
    return solid


def gear_teeth(teeth, module):
    """Pitch, tip, and root radii of a standard spur gear."""
    pitch = teeth * module / 2
    return pitch, pitch + module, pitch - 1.25 * module


def spur_gear(teeth, module, width, phase=0.0, tip=0.32):
    """A spur gear about +X, centred on the origin.

    Each tooth is two flanks and a flat tip `tip` of the pitch wide, meeting
    its neighbour in a V at the root: six triangles a tooth and its share of
    the two faces. A `tip` of 0 draws pointed teeth, four triangles each,
    for a large gear in dark plastic. `phase` turns the gear by that many
    teeth, to mesh it with its mate.
    """
    _, tip_radius, root = gear_teeth(teeth, module)
    step = 2 * math.pi / teeth
    profile = [(root, -0.5), (tip_radius, -tip / 2), (tip_radius, tip / 2)]
    points = []
    for tooth in range(teeth):
        centre = (tooth + phase) * step
        for radius, offset in profile if tip else profile[:2]:
            angle = centre + offset * step
            points.append((radius * math.cos(angle), radius * math.sin(angle)))
    blank = extrude(Polygon(*points, align=None), width / 2, both=True)
    # The sketch plane is XY (axis Z); turn the axis onto +X.
    return Rot(0, 90, 0) * blank

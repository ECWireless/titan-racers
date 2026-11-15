"""Write each CAD part's committed mesh for the game's part visuals.

Usage, from the repository root (the part contract is in cad/README.md):

    cad/.venv/bin/python cad/export.py            # write every part's mesh
    cad/.venv/bin/python cad/export.py --check    # fail if a mesh is stale
"""

from __future__ import annotations

import argparse
import importlib
import json
import pathlib
import sys

from build123d import CenterOf, Compound, Shape
from OCP.BRep import BRep_Tool
from OCP.BRepLib import BRepLib_ToolTriangulatedShape
from OCP.BRepMesh import BRepMesh_IncrementalMesh
from OCP.BRepTools import BRepTools
from OCP.IMeshTools import IMeshTools_Parameters
from OCP.TopLoc import TopLoc_Location

ROOT = pathlib.Path(__file__).resolve().parent
PARTS = ROOT / "parts"
OUT = ROOT.parent / "src" / "game" / "kart" / "cad-meshes"

# The part-visual finishes (KartPartFinish) a CAD part may use. Authored
# finishes take the builder's chosen colour.
FINISHES = {
    "authored-anodized",
    "authored-paint",
    "authored-polymer",
    "bare-aluminum",
    "bare-steel",
    "black-oxide-steel",
    "black-polymer",
    "copper",
    "rubber",
}

# Densities (kg/m³) for mass_bodies(); only reported, never raced.
MATERIALS = {
    "aluminum": 2700,
    "copper": 8960,
    "neodymium": 7500,
    "polymer": 1400,
    "steel": 7850,
}

TOLERANCE = 0.0001  # metres of chord error (0.1 mm)
ANGULAR_TOLERANCE = 0.3  # radians between neighbouring facets
MIN_SIZE = 0.0006  # shortest facet edge; keeps small fillets to a few rows
MAX_TRIANGLES = 2000

POSITION_SCALE = 1_000_000  # micrometres
NORMAL_SCALE = 10_000


def mesh_piece(finish: str, shape: Shape):
    # build123d meshes with a tolerance relative to each edge's size, so mesh
    # here with absolute ones, take normals from each face's surface, and
    # pass a huge tolerance so build123d keeps this mesh.
    params = IMeshTools_Parameters()
    params.Deflection = TOLERANCE
    params.Angle = ANGULAR_TOLERANCE
    params.MinSize = MIN_SIZE
    params.Relative = False
    params.InParallel = False
    BRepTools.Clean_s(shape.wrapped)
    BRepMesh_IncrementalMesh(shape.wrapped, params)
    for face in shape.faces():
        triangulation = BRep_Tool.Triangulation_s(face.wrapped, TopLoc_Location())
        BRepLib_ToolTriangulatedShape.ComputeNormals_s(face.wrapped, triangulation)
    vertices, triangles, normals, _ = shape.tessellate_with_uvs(
        1e9, ANGULAR_TOLERANCE, atlas_packing=False
    )
    positions: list[int] = []
    packed_normals: list[int] = []
    for vertex, normal in zip(vertices, normals):
        positions += [round(c * POSITION_SCALE) + 0 for c in vertex]
        length = normal.length or 1.0
        packed_normals += [round(c / length * NORMAL_SCALE) + 0 for c in normal]
    indices: list[int] = []
    for a, b, c in triangles:
        # Keep each triangle counter-clockwise seen from its normals' side.
        pa, pb, pc = vertices[a], vertices[b], vertices[c]
        facing = (pb - pa).cross(pc - pa).dot(normals[a] + normals[b] + normals[c])
        indices += [a, b, c] if facing >= 0 else [a, c, b]
    return {
        "finish": finish,
        "indices": indices,
        "normals": packed_normals,
        "positions": positions,
    }


def measure(bodies: list[tuple[Shape, str]]):
    mass = 0.0
    moment = [0.0, 0.0, 0.0]
    for shape, material in bodies:
        if material not in MATERIALS:
            raise ValueError(f"unknown material {material!r}")
        body_mass = shape.volume * MATERIALS[material]
        center = shape.center(CenterOf.MASS)
        mass += body_mass
        moment = [m + c * body_mass for m, c in zip(moment, center)]
    return {
        "centerOfMass": [round(m / mass, 5) + 0 for m in moment],
        "massKg": round(mass, 4),
    }


def export(name: str) -> tuple[pathlib.Path, str, int, dict | None]:
    module = importlib.import_module(f"parts.{name}")
    finishes = module.build()
    pieces = []
    for finish in sorted(finishes):
        if finish not in FINISHES:
            raise ValueError(f"{name}: unknown finish {finish!r}")
        solids = finishes[finish]
        shape = Compound(solids) if isinstance(solids, list) else solids
        pieces.append(mesh_piece(finish, shape))
    triangles = sum(len(p["indices"]) // 3 for p in pieces)
    if triangles > MAX_TRIANGLES:
        raise ValueError(f"{name}: {triangles} triangles (max {MAX_TRIANGLES})")
    measured = measure(module.mass_bodies()) if hasattr(module, "mass_bodies") else None
    lines = [
        "{",
        f'"part":{json.dumps(module.PART)},',
        f'"measured":{json.dumps(measured, sort_keys=True)},',
        '"pieces":[',
        ",\n".join(json.dumps(p, separators=(",", ":"), sort_keys=True) for p in pieces),
        "]}",
    ]
    return OUT / f"{module.PART}.json", "\n".join(lines) + "\n", triangles, measured


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    parser.add_argument("--check", action="store_true", help="fail on a stale mesh")
    args = parser.parse_args()
    sys.path.insert(0, str(ROOT))
    names = sorted(p.stem for p in PARTS.glob("*.py") if p.stem != "__init__")
    stale = []
    for name in names:
        path, text, triangles, measured = export(name)
        if args.check:
            if not path.exists() or path.read_text() != text:
                stale.append(path.name)
            continue
        OUT.mkdir(parents=True, exist_ok=True)
        path.write_text(text)
        print(f"{path.name}: {triangles} triangles, measured {measured}")
    if stale:
        print("stale CAD meshes: " + ", ".join(stale), file=sys.stderr)
        return 1
    if args.check:
        print(f"{len(names)} CAD meshes up to date")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())

# CAD Part Models

Development-only build123d models for kart part visuals. Nothing here runs in
the app: each model writes a committed mesh to `src/game/kart/cad-meshes/`,
and the part's visual reads that file (`src/game/kart/kart-cad-meshes.ts`).
How build123d behaves, and what the export works around, lives in
[`skills/tools/build123d-cad`](../skills/tools/build123d-cad/README.md).

## Setup

On Ubuntu, Python's `venv` module is a separate package
(`sudo apt install python3.14-venv`). Then, from the repository root:

```sh
python3 -m venv cad/.venv
cad/.venv/bin/pip install -r cad/requirements.txt
```

The environment is about 1 GB and is ignored by git.

## Commands

```sh
cad/.venv/bin/python cad/export.py            # write every part's mesh
cad/.venv/bin/python cad/export.py --check    # fail if a mesh is stale
```

Run `--check` before committing a model change; a rerun writes the same bytes.

## Writing A Part

One module per approved part version in `cad/parts/`, named after it
(`motor.brushless-standard@1` → `motor_brushless_standard_v1.py`):

- `PART`: the approved `id@version` it draws.
- `build()`: a dict from finish (`KartPartFinish`, such as `black-oxide-steel`)
  to a solid or list of solids, in the part's own frame: metres, +Y up, the
  same frame its code-built visual used.
- `mass_bodies()` (optional): `(solid, material)` pairs for a coarse
  interior, reported as measured mass and centre of mass to compare with
  the registry. It is never raced: corrections need a new part version.
- `moving()` (optional): a dict from a name to finishes and solids, like
  `build()`'s, for pieces the game poses, drawn at rest in the part's frame.
  The game turns each about its `<name>-pivot` point (the servo's `horn`).
- `POINTS` (optional): a dict from a name to a point in the part's frame
  where the kart's linkages meet the part: the servo's `horn-pivot` and
  `horn-ball-left`/`-right`, a transmission's `output-left`/`-right`. A part
  with mounting points also names each one `mount-<id>`; the registry's
  mounting points are tested against them.

A module whose name starts with an underscore is shared code, not a part:
`_shapes.py` (turned profiles and gears), `_laydown_gearbox.py` (the three
version-1 transmissions' one model), and `_plate_gearbox.py` (version 2's,
with a motor plate).

Keep dimensions as named constants modelled on a real 1:10 part, and import no
vendor models. Each part stays within 2,000 triangles, moving pieces
included; the export refuses more.
After adding a part, list its mesh in `KART_CAD_MESHES`
(`src/game/kart/kart-cad-meshes.ts`). Advance the kart thumbnail render
version when a change alters how an existing part version looks; a new
part version changes no saved kart's look. Pins in `requirements.txt` say
how to update them.

# build123d CAD

**Maturity:** Candidate (PR 7.1, 2026-11-15).

## Purpose And Scope

This node covers build123d 0.13 (Python, on OpenCASCADE) as Titan Racers'
development-only tool for modelling kart part visuals, and what its meshing
does that the export works around. Read it before writing or exporting a
model in `cad/`. Commands and the part-module contract live in
[`cad/README.md`](../../../cad/README.md); how the game draws part visuals
lives in [`kart-builder`](../../project-systems/kart-builder/README.md).

Models are plain Python scripts of named parameters; the game reads only the
meshes they write. build123d makes no network calls; why text-to-cad is not
used is a Phase 7 decision in `IMPLEMENTATION_PLAN.md`.

## Meshing

- **Relative tolerance.** `Shape.tessellate` and `tessellate_with_uvs` mesh
  through `Shape.mesh`, which passes the tolerance to OpenCASCADE's
  `BRepMesh_IncrementalMesh` as relative to each edge's size, and only when
  the shape has no mesh that already meets it. The export meshes with
  absolute `IMeshTools_Parameters` itself, then reads the result with a
  huge tolerance so build123d keeps that mesh.
- **Small fillets.** A fillet is a torus face, and a 1 mm fillet on a 36 mm
  can meshes to thousands of triangles at a 0.1 mm tolerance. A minimum
  facet size (`MinSize`, 0.6 mm) keeps it to a few rows.
- **Normals.** A fresh mesh has no normals, and `tessellate_with_uvs` then
  averages neighbouring triangles', which shades fillets unevenly. The
  export first sets
  each face's normals from its surface
  (`BRepLib_ToolTriangulatedShape::ComputeNormals`); build123d flips them
  for reversed faces. Faces are meshed separately, so normals split at
  every face boundary: hard edges stay hard and tangent fillets shade
  smoothly. The export checks each triangle's winding against its normals.
- **Determinism.** The same build123d and OpenCASCADE versions mesh the same
  model identically; positions are rounded to whole micrometres and normals
  to 1/10,000, so a rerun writes the same bytes.

## Measuring

`Shape.volume` and `Shape.center(CenterOf.MASS)` give each solid's volume and
centroid, so mass is volume × density. A visual model is mostly surface: a
motor's can, windings, magnets, and air are not one material. Measured mass
comes from separate interior solids with their own materials, and is a
report, never a raced value.

## Known Limits

- Version-sensitive: re-check the meshing notes when build123d or
  `cadquery-ocp` is upgraded, since a new mesher changes every committed mesh.
- No UVs are exported: part finishes are untextured or draw their detail in
  their shaders.

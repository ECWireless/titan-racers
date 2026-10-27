# Curved Course Geometry

**Maturity:** Validated (PR 4.4.2, 2026-10-26).

## Purpose And Scope

This node owns the engine-independent standard for curved course pieces:
walls, race barriers, kerbs, and later curved decks. Read it before authoring a
bend, adding a curved primitive, or reviewing how a curve looks or collides.

It refines the primitive catalog in
[`course-editing`](../course-editing/README.md) and the collision-geometry rules
in [`collisions`](../collisions/README.md). The PlayCanvas mapping lives in
[`tools/playcanvas-ammo/course-editing`](../../tools/playcanvas-ammo/course-editing/README.md);
Titan Racers' arc schema and tolerances in
[`project-systems/course-data`](../../project-systems/course-data/README.md).

## Standard

A curve is one authored primitive that sweeps a cross-section along a circular
arc, not a polyline of straight boxes. The engine generates one smooth surface
for it and a coarser set of convex collision pieces from the same few numbers
(inner radius, width, height, sweep).

## Desired Outcome

- A bend reads as one continuous curve at chase-camera distance: no kinks in its
  top edge, no faceted shading, no notches or spikes at joints.
- A kart sliding along it feels one smooth wall, with no bumps at piece joints.
- Authors place and size a bend with a handful of values; precision is derived,
  never hand-entered.
- It costs about what the box polyline it replaces cost.

## Core Principles

1. **Tessellate by error, not by count.** A chord spanning angle Δθ on radius r
   leaves a gap (sagitta) of s = r(1 − cos(Δθ/2)). Choose the segment count from
   a tolerance at the largest radius, and cap Δθ (about 6°) so small radii still
   read as round. Size the tolerance from screen error: a pixel covers
   s·H / (2·d·tan(fov/2)) at distance d, so pick the error that stays under a
   pixel or two at chase-camera distance.
2. **Share rings, mitre by construction.** Neighbouring segments share their
   vertex ring, so joints can neither gap nor overlap.
3. **Smooth where curved, sharp where folded.** Curved faces carry exact radial
   normals, so the whole bend shades as one surface; the top edge and end caps
   get their own vertices so those folds stay crisp. Skip faces nobody sees.
4. **Collide with convex pieces that meet on the convex side.** Each piece's
   convex-side face is the exact chord of the curve, so pieces meet there with
   no gap and no corner sticking out; their overlap hides inside the wall.
   Collision may be coarser than the visual: the convex face then sits at most
   the collision tolerance inside the surface, the concave face at most that
   far proud of it. A piece's inner corners also reach past its own segment by
   the wall's width × sin(half its angle), so at an open end grade the pieces
   short and let them grow as the arc behind them allows.
5. **Avoid triangle meshes for fast small vehicles.** Without internal-edge
   correction, a triangle mesh bumps wheels and hulls at shared edges ("ghost
   collisions"), and its faces have no thickness for CCD to rely on.
6. **Derive, don't store.** Segment counts and collision pieces follow from the
   authored dimensions at build time, so a tolerance change never rewrites data.

## Failure Modes

- **Box polylines.** Boxes sized to the centreline chord leave V-notches on the
  convex face; longer boxes poke spikes out of it; each box shades as a flat
  panel; and coarse steps miss the true curve by centimetres.
- **Fixed segment counts.** Too coarse on large radii, wasteful on small ones.

## Validation

- Generator tests: chord error within tolerance, unit normals that match
  triangle winding, collision pieces meeting exactly on the convex face, both
  faces and the open ends within the collision tolerance.
- Renders of the bend before and after, inspected at chase-camera distance.
- Kart checks along the curve: glancing slides with no bumps or launches, and
  head-on hits at top speed that hold.

## Known Limits

- Arcs of constant radius only; S-bends chain arcs. Rising (helical) and banked
  curves need per-point contact normals and are not yet supported.

## Sources

- Godot `Curve3D.tessellate` (angle tolerance) and `CSGPolygon3D` path
  simplification; Unity Splines `SplineExtrude`; Unreal `USplineMeshComponent`.
- Bullet `btInternalEdgeUtility`; Erin Catto, "Ghost Collisions" (Box2D, 2020).
- Cesium geometric and screen-space error.

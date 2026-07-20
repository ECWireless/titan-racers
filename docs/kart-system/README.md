# Kart System Architecture

This index is the human-readable entry point for Titan Racers kart behavior.
Code remains the executable source of truth; these documents explain ownership,
units, versioning, and allowed dependency direction.

## Canonical Handling Architecture

Four inputs are authoritative:

1. **Authored construction** records approved component versions, placement,
   attachment, mirroring, and bounded instance configuration.
2. **Versioned derived kart physics** deterministically resolves construction
   into mass properties, physical geometry, and a `KartPhysicalProfile` of
   force/capability outputs.
3. **World/environment** supplies gravity, contacted surface construction, and
   other race-world facts that do not belong to a kart.
4. **Shared gameplay policy** bounds requests and owns narrowly justified
   recovery or stability behavior that must be identical for every kart in a
   race ruleset.

The runtime physics solver is an executor, not a fifth tuning source. Its
contacts, loads, forces, velocities, and poses are ephemeral. Presentation is a
downstream observer and cannot change handling.

```text
assembly + component registry ----versioned derivation----> resolved kart physics
resolved kart physics + environment + shared policy -----> runtime solver state
runtime telemetry ---------------------------------------> presentation
```

## Documentation Map

- [Authored construction](./authored-construction.md)
- [Builder components and materials](./components-and-materials.md)
- [World and environment](./environment.md)
- [Derivation formulas](./derivation-formulas.md)
- [Runtime solver](./runtime-solver.md)
- [Shared gameplay policy](./gameplay-policy.md)
- [Presentation](./presentation.md)

## Versioning And Reproducibility

A published kart assembly revision is immutable. A resolved physical snapshot
records its derivation version and may be persisted for auditing and race
reproducibility, but remains non-editable derived evidence. A competitive run
must ultimately identify its course revision, kart revision, derivation
version and resolved-profile hash, environment version, runtime-solver version,
and gameplay-policy version. Presentation versions are separate because purely
visual changes do not alter competitive physics.

Unpublished development values may be re-resolved live through
`kart-development-values.ts`. That flat diagnostic adapter is not a persisted
kart format and must never be passed to runtime subsystems as a universal
tuning object.

## Unit Standard

Use SI units unless a field explicitly says otherwise:

- distance: metres (`m`);
- time: seconds (`s`);
- mass: kilograms (`kg`);
- force and impulse: newtons (`N`) and newton-seconds (`N·s`);
- torque and angular impulse: newton-metres (`N·m`) and
  newton-metre-seconds (`N·m·s`);
- speed and acceleration: `m/s` and `m/s²`;
- angles: degrees in authored/readable contracts, radians inside solver math;
- angular speed: `rad/s`; and
- power: watts (`W`).

// Identifies the complete shipped solver/environment/policy combination.
// Presentation changes do not advance this identity. Pre-versioning runs are null.
export const CURRENT_PHYSICS_VERSION = "rotating-habitat-v1" as const;

// Every identity a client may still report. Older tabs keep sending theirs
// until reloaded, so retired versions stay accepted.
export const ACCEPTED_PHYSICS_VERSIONS = [
  "surface-physics-v1",
  "collision-substeps-v1",
  "handbrake-clutch-v1",
  CURRENT_PHYSICS_VERSION,
] as const;

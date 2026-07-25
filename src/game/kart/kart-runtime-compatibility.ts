import type { ResolvedKartSnapshot } from "./kart-derivation";

export const KART_RUNTIME_INERTIA_COUPLING_TOLERANCE = 1e-9;

/**
 * PR 3.3 can apply Bullet's diagonal local-inertia vector only when the
 * authored document axes are already principal axes. PR 3.4 owns principal-axis
 * diagonalization and the matching compound/controller transform.
 */
export function hasRuntimeCompatibleInertia(
  snapshot: Pick<ResolvedKartSnapshot, "massProperties">,
) {
  const tensor = snapshot.massProperties.inertiaTensor;
  return Math.max(
    Math.abs(tensor.xy),
    Math.abs(tensor.xz),
    Math.abs(tensor.yx),
    Math.abs(tensor.yz),
    Math.abs(tensor.zx),
    Math.abs(tensor.zy),
  ) <= KART_RUNTIME_INERTIA_COUPLING_TOLERANCE;
}

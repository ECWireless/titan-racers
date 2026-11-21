import type { KartAssemblyDocument } from "./kart-assembly-document";
import type { KartAssemblyValidationIssue } from "./kart-assembly-validation";
import { checkKartClearance, type KartClash } from "./kart-clearance";
import { deriveKartSnapshot } from "./kart-derivation";

const millimetres = (meters: number) => `${(meters * 1000).toFixed(1)} mm`;

/** `wheel-front-left:tie-rod` reads as "wheel-front-left's tie rod". */
function describe(id: string) {
  const [instanceId, linkage] = id.split(":");
  return linkage
    ? `${instanceId}'s ${linkage.replace("-", " ")}`
    : instanceId;
}

function describeClash(
  { distance, first, pose, second }: KartClash,
  transmissionIds: Set<string>,
) {
  const where = pose
    ? ` at ${millimetres(pose.wheelTravel)} of wheel travel and ${pose.centerSteerDegrees.toFixed(1)}° of steering`
    : "";
  // A driveshaft is only measured against its own gearbox for its seating:
  // pulled out of its cup's slots, or bottomed out in it.
  if (first.endsWith(":driveshaft") && transmissionIds.has(second)) {
    return `${describe(first)} strays ${millimetres(-distance)} beyond where ${second}'s outdrive cup holds it${where}.`;
  }
  return `${describe(first)} and ${describe(second)} overlap by ${millimetres(-distance)}${where}.`;
}

/**
 * What the kart builder requires of a valid assembly before it saves: every
 * structural attachment names the mounting points it meets at, and no parts
 * clash, standing or through suspension travel and steering lock. Throws as
 * derivation does if the assembly is invalid.
 */
export function checkKartAssemblyFit(
  document: KartAssemblyDocument,
): KartAssemblyValidationIssue[] {
  const snapshot = deriveKartSnapshot(document);
  const issues: KartAssemblyValidationIssue[] = [];
  document.structuralAttachments.forEach(({ child, parent }, index) => {
    if (child.mount === null || parent.mount === null) {
      issues.push({
        code: "unnamed-mount",
        message: `${child.instanceId} must be snapped to ${parent.instanceId} by their mounting points.`,
        path: ["structuralAttachments", index],
      });
    }
  });
  const transmissionIds = new Set(
    document.componentInstances
      .filter(({ definition }) => definition.id.startsWith("transmission."))
      .map(({ id }) => id),
  );
  for (const clash of checkKartClearance(document, snapshot).clashes) {
    issues.push({
      code: "parts-clash",
      message: describeClash(clash, transmissionIds),
      path: [],
    });
  }
  return issues;
}

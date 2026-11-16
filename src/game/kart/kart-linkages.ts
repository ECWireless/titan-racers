import type {
  KartAssemblyComponentInstance,
  KartAssemblyDocument,
} from "./kart-assembly-document";
import { getKartCadMesh, type KartCadMesh } from "./kart-cad-meshes";
import { getApprovedKartComponent } from "./kart-component-registry";

/** A linkage between a part and a wheel it is connected to. */
export type KartLinkage = {
  /** The part's CAD mesh, whose named points the linkage attaches to. */
  mesh: KartCadMesh;
  part: KartAssemblyComponentInstance;
  wheel: KartAssemblyComponentInstance;
};

/**
 * The linkages a kart's connections call for: a tie rod for each wheel
 * connected to a steering servo, and a driveshaft for each wheel connected
 * to a transmission. A part draws one only if its CAD mesh names where it
 * attaches (a servo's horn, a transmission's outputs). Presentation only.
 */
export type KartLinkagePlan = {
  driveshafts: KartLinkage[];
  tieRods: KartLinkage[];
};

export function planKartLinkages(document: KartAssemblyDocument): KartLinkagePlan {
  const plan: KartLinkagePlan = { driveshafts: [], tieRods: [] };
  const instances = new Map(
    document.componentInstances.map((instance) => [instance.id, instance]),
  );
  const categoryOf = (instance: KartAssemblyComponentInstance) =>
    getApprovedKartComponent(instance.definition)?.category;
  for (const { from, to } of document.connections) {
    const ends = [instances.get(from.instanceId), instances.get(to.instanceId)];
    const wheel = ends.find((end) => end && categoryOf(end) === "wheel-tire");
    const part = ends.find((end) => end && end !== wheel);
    if (!wheel || !part) continue;
    const category = categoryOf(part);
    const mesh = getKartCadMesh(part.definition);
    if (!mesh) continue;
    const linkages =
      category === "steering" &&
      mesh.moving.horn &&
      ["horn-pivot", "horn-ball-left", "horn-ball-right"].every(
        (name) => mesh.points[name],
      )
        ? plan.tieRods
        : category === "transmission" && mesh.points["output-left"]
          ? plan.driveshafts
          : null;
    // One of each linkage per wheel.
    if (linkages && !linkages.some((linkage) => linkage.wheel === wheel)) {
      linkages.push({ mesh, part, wheel });
    }
  }
  return plan;
}

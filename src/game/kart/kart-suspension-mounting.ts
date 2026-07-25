import type { KartAssemblyComponentInstance } from "./kart-assembly-document";
import {
  addVector,
  rotationMatrix,
  transformVector,
  type KartVector,
} from "./kart-construction-geometry";

type SuspensionDefinition = {
  readonly suspension: {
    readonly mounting: {
      readonly armPivot: Readonly<KartVector>;
      readonly chassisAnchor: Readonly<KartVector>;
      readonly hubAnchor: Readonly<KartVector>;
      readonly springArmAnchor: Readonly<KartVector>;
    };
  };
};

export function resolveApprovedSuspensionMount(
  instance: KartAssemblyComponentInstance,
  definition: SuspensionDefinition,
) {
  const mirrorLocalX = instance.transform.position.x > 0;
  const rotation = rotationMatrix(instance.transform.rotationDegrees);
  const resolvePoint = (point: KartVector) =>
    addVector(
      transformVector(rotation, {
        ...point,
        x: mirrorLocalX ? -point.x : point.x,
      }),
      instance.transform.position,
    );

  return {
    armPivot: resolvePoint(definition.suspension.mounting.armPivot),
    chassisAnchor: resolvePoint(definition.suspension.mounting.chassisAnchor),
    hubAnchor: resolvePoint(definition.suspension.mounting.hubAnchor),
    springArmAnchor: resolvePoint(
      definition.suspension.mounting.springArmAnchor,
    ),
  };
}

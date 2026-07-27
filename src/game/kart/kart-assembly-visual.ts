import * as pc from "playcanvas";

import type {
  KartAssemblyComponentInstance,
  KartAssemblyDocument,
  KartAssemblyPrimitiveInstance,
} from "./kart-assembly-document";
import {
  type ApprovedComponentDefinition,
  getApprovedKartComponent,
} from "./kart-component-registry";

export type KartRenderedBounds = {
  center: pc.Vec3;
  maximum: pc.Vec3;
  minimum: pc.Vec3;
};

export function createKartPrimitiveVisualEntity(
  primitive: KartAssemblyPrimitiveInstance,
  material: pc.StandardMaterial,
) {
  const root = new pc.Entity(primitive.id);
  const visual = new pc.Entity(`${primitive.id}-visual`);
  visual.addComponent("model", { type: primitive.shape });
  root.setPosition(
    primitive.transform.position.x,
    primitive.transform.position.y,
    primitive.transform.position.z,
  );
  root.setEulerAngles(
    primitive.transform.rotationDegrees.x,
    primitive.transform.rotationDegrees.y,
    primitive.transform.rotationDegrees.z,
  );
  if (primitive.shape === "box") {
    root.setLocalScale(primitive.size.x, primitive.size.y, primitive.size.z);
  } else {
    visual.setLocalScale(
      primitive.radius * 2,
      primitive.height,
      primitive.radius * 2,
    );
    applyCylinderAxis(visual, primitive.axis);
  }
  visual.model?.meshInstances?.forEach((mesh) => {
    mesh.material = material;
  });
  root.addChild(visual);
  return root;
}

export function createKartComponentVisualEntity(
  instance: KartAssemblyComponentInstance,
  material: pc.StandardMaterial,
) {
  const root = new pc.Entity(instance.id);
  root.setPosition(
    instance.transform.position.x,
    instance.transform.position.y,
    instance.transform.position.z,
  );
  root.setEulerAngles(
    instance.transform.rotationDegrees.x,
    instance.transform.rotationDegrees.y,
    instance.transform.rotationDegrees.z,
  );
  const definition = getApprovedKartComponent(instance.definition);
  definition?.construction.forEach((construction, index) => {
    root.addChild(
      createConstructionEntity(
        `${instance.id}-construction-${index}`,
        construction,
        material,
      ),
    );
  });
  if (definition?.category === "suspension" && instance.suspensionMount) {
    root.addChild(
      createCoilover(
        instance.id,
        instance.suspensionMount,
        instance.transform,
        material,
      ),
    );
  }
  return root;
}

export function createKartAssemblyVisual(
  document: KartAssemblyDocument,
  createMaterial: (color: string) => pc.StandardMaterial,
) {
  const root = new pc.Entity(`${document.kartId}-visual`);
  const materials: pc.StandardMaterial[] = [];
  for (const primitive of document.primitiveInstances) {
    const material = createMaterial(primitive.visualColor);
    materials.push(material);
    root.addChild(createKartPrimitiveVisualEntity(primitive, material));
  }
  for (const instance of document.componentInstances) {
    const material = createMaterial(instance.visualColor);
    materials.push(material);
    root.addChild(createKartComponentVisualEntity(instance, material));
  }
  return { materials, root };
}

export function getRenderedKartBounds(root: pc.Entity): KartRenderedBounds | null {
  const minimum = new pc.Vec3(
    Number.POSITIVE_INFINITY,
    Number.POSITIVE_INFINITY,
    Number.POSITIVE_INFINITY,
  );
  const maximum = new pc.Vec3(
    Number.NEGATIVE_INFINITY,
    Number.NEGATIVE_INFINITY,
    Number.NEGATIVE_INFINITY,
  );
  let found = false;
  root.forEach((node) => {
    if (!(node instanceof pc.Entity)) return;
    node.model?.meshInstances?.forEach(({ aabb }) => {
      found = true;
      minimum.min(aabb.getMin());
      maximum.max(aabb.getMax());
    });
  });
  if (!found) return null;
  return {
    center: minimum.clone().add(maximum).mulScalar(0.5),
    maximum,
    minimum,
  };
}

function createConstructionEntity(
  name: string,
  construction: ApprovedComponentDefinition["construction"][number],
  material: pc.StandardMaterial,
) {
  const entity = new pc.Entity(name);
  entity.addComponent("model", { type: construction.shape });
  entity.setLocalPosition(
    construction.transform.position.x,
    construction.transform.position.y,
    construction.transform.position.z,
  );
  entity.setLocalEulerAngles(
    construction.transform.rotationDegrees.x,
    construction.transform.rotationDegrees.y,
    construction.transform.rotationDegrees.z,
  );
  if (construction.shape === "box") {
    entity.setLocalScale(
      construction.size.x,
      construction.size.y,
      construction.size.z,
    );
  } else {
    entity.setLocalScale(
      construction.radius * 2,
      construction.height,
      construction.radius * 2,
    );
    applyCylinderAxis(entity, construction.axis);
  }
  entity.model?.meshInstances?.forEach((mesh) => {
    mesh.material = material;
  });
  return entity;
}

function createCoilover(
  id: string,
  mount: NonNullable<
    KartAssemblyDocument["componentInstances"][number]["suspensionMount"]
  >,
  transform: KartAssemblyDocument["componentInstances"][number]["transform"],
  material: pc.StandardMaterial,
) {
  const root = new pc.Entity(`${id}-coilover`);
  const inverseRotation = new pc.Quat()
    .setFromEulerAngles(
      transform.rotationDegrees.x,
      transform.rotationDegrees.y,
      transform.rotationDegrees.z,
    )
    .invert();
  const toLocalPoint = (point: { x: number; y: number; z: number }) =>
    inverseRotation.transformVector(
      new pc.Vec3(
        point.x - transform.position.x,
        point.y - transform.position.y,
        point.z - transform.position.z,
      ),
    );
  const chassisAnchor = toLocalPoint(mount.chassisAnchor);
  const springArmAnchor = toLocalPoint(mount.springArmAnchor);
  const armPivot = toLocalPoint(mount.armPivot);
  const hubAnchor = toLocalPoint(mount.hubAnchor);
  root.addChild(
    createBarBetween(
      `${id}-damper`,
      chassisAnchor,
      springArmAnchor,
      0.009,
      material,
    ),
  );
  root.addChild(
    createBarBetween(
      `${id}-arm`,
      armPivot,
      hubAnchor,
      0.004,
      material,
    ),
  );

  const turns = 8;
  const segments = 32;
  const start = chassisAnchor;
  const end = springArmAnchor;
  const axis = new pc.Vec3().sub2(end, start);
  const length = Math.max(axis.length(), 0.001);
  axis.normalize();
  const reference = Math.abs(axis.y) < 0.9 ? pc.Vec3.UP : pc.Vec3.RIGHT;
  const side = new pc.Vec3().cross(axis, reference).normalize();
  const up = new pc.Vec3().cross(side, axis).normalize();
  let previous = start.clone();
  for (let index = 1; index <= segments; index += 1) {
    const t = index / segments;
    const angle = t * Math.PI * 2 * turns;
    const center = start.clone().add(axis.clone().mulScalar(length * t));
    const point = center
      .add(side.clone().mulScalar(Math.cos(angle) * 0.014))
      .add(up.clone().mulScalar(Math.sin(angle) * 0.014));
    root.addChild(
      createBarBetween(
        `${id}-coil-${index}`,
        toVector(previous),
        toVector(point),
        0.0017,
        material,
      ),
    );
    previous = point;
  }
  return root;
}

function createBarBetween(
  name: string,
  start: { x: number; y: number; z: number },
  end: { x: number; y: number; z: number },
  radius: number,
  material: pc.StandardMaterial,
) {
  const entity = new pc.Entity(name);
  entity.addComponent("model", { type: "cylinder" });
  const startVector = new pc.Vec3(start.x, start.y, start.z);
  const endVector = new pc.Vec3(end.x, end.y, end.z);
  const midpoint = startVector.clone().add(endVector).mulScalar(0.5);
  const length = Math.max(startVector.distance(endVector), 0.0001);
  entity.setPosition(midpoint);
  entity.setLocalScale(radius * 2, length, radius * 2);
  entity.lookAt(endVector);
  entity.rotateLocal(90, 0, 0);
  entity.model?.meshInstances?.forEach((mesh) => {
    mesh.material = material;
  });
  return entity;
}

function applyCylinderAxis(entity: pc.Entity, axis: "x" | "y" | "z") {
  if (axis === "x") entity.rotateLocal(0, 0, 90);
  if (axis === "z") entity.rotateLocal(90, 0, 0);
}

function toVector(value: { x: number; y: number; z: number }) {
  return { x: value.x, y: value.y, z: value.z };
}

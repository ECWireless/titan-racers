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

// One presentation-only builder for every kart surface: race, editor, and
// thumbnails. Wheels and suspension form a rig the race poses each frame; the
// editor and thumbnails show it at rest. Physics never reads these entities.

export type KartRenderedBounds = {
  center: pc.Vec3;
  maximum: pc.Vec3;
  minimum: pc.Vec3;
};

/** Callers own material lifecycle; the builder only requests materials. */
export type KartVisualMaterialFactory = (
  visualColor: string,
  instanceId: string,
) => pc.StandardMaterial;

type KartVector = { x: number; y: number; z: number };

export type KartSuspensionVisual = {
  armForward: pc.Entity;
  armRear: pc.Entity;
  chassisForwardAnchor: pc.Vec3;
  chassisRearAnchor: pc.Vec3;
  chassisShockAnchor: pc.Vec3;
  coil: pc.Entity[];
  /** Current spring-arm end of the shock and coil, in assembly axes. */
  coilEnd: pc.Vec3;
  hubAnchorY: number;
  instanceId: string;
  motionRatio: number;
  shock: pc.Entity;
  springArmAnchor: pc.Vec3;
};

export type KartWheelVisual = {
  /** Rest hub position in assembly axes. */
  hub: pc.Vec3;
  instanceId: string;
  /** Hub pivot in assembly axes; steering rotates it about local Y. */
  pivot: pc.Entity;
  suspension: KartSuspensionVisual | null;
};

export type KartAssemblyVisual = {
  instanceRoots: Map<string, pc.Entity>;
  root: pc.Entity;
  wheels: KartWheelVisual[];
};

const ARM_ANCHOR_HALF_SPREAD = 0.025;
const ARM_RADIUS = 0.005;
const COIL_RADIUS = 0.014;
const COIL_SEGMENTS = 32;
const COIL_TURNS = 8;
const COIL_WIRE_RADIUS = 0.0025;
const DAMPER_RADIUS = 0.009;
const HUB_EXTRA_WIDTH = 0.006;

export function createKartAssemblyVisual(
  document: KartAssemblyDocument,
  createMaterial: KartVisualMaterialFactory,
): KartAssemblyVisual {
  const root = new pc.Entity(`${document.kartId}-visual`);
  const instanceRoots = new Map<string, pc.Entity>();
  const materials = new Map<string, pc.StandardMaterial>();
  const materialFor = (instance: { id: string; visualColor: string }) => {
    let material = materials.get(instance.id);
    if (!material) {
      material = createMaterial(instance.visualColor, instance.id);
      materials.set(instance.id, material);
    }
    return material;
  };
  const wheelInstances: Array<{
    instance: KartAssemblyComponentInstance;
    radius: number;
    width: number;
  }> = [];

  for (const primitive of document.primitiveInstances) {
    const entity = createPrimitiveEntity(primitive, materialFor(primitive));
    instanceRoots.set(primitive.id, entity);
    root.addChild(entity);
  }

  for (const instance of document.componentInstances) {
    const definition = getApprovedKartComponent(instance.definition);
    const entity = createInstanceRoot(instance.id, instance.transform);
    instanceRoots.set(instance.id, entity);
    root.addChild(entity);
    if (definition?.category === "wheel-tire") {
      const { radius, width } = definition.wheelTire;
      wheelInstances.push({ instance, radius, width });
      continue;
    }
    const material = materialFor(instance);
    definition?.construction.forEach((construction, index) => {
      entity.addChild(
        createConstructionEntity(
          `${instance.id}-construction-${index}`,
          construction,
          material,
        ),
      );
    });
  }

  const wheels = wheelInstances.map(({ instance, radius, width }) => {
    const suspensionInstance = findWheelSuspension(document, instance.id);
    const wheelRoot = instanceRoots.get(instance.id)!;
    const wheelFrame = createAssemblyFrame(
      `${instance.id}-assembly-frame`,
      instance.transform,
    );
    wheelRoot.addChild(wheelFrame);
    const hub = toPcVector(instance.transform.position);
    const pivot = new pc.Entity(`${instance.id}-pivot`);
    pivot.setLocalPosition(hub);
    wheelFrame.addChild(pivot);
    const material = materialFor(instance);
    pivot.addChild(
      createWheelCylinder(
        `${instance.id}-tire`,
        new pc.Vec3(radius * 2, width, radius * 2),
        material,
      ),
    );
    pivot.addChild(
      createWheelCylinder(
        `${instance.id}-hub`,
        new pc.Vec3(radius, width + HUB_EXTRA_WIDTH, radius),
        material,
      ),
    );

    const wheel: KartWheelVisual = {
      hub,
      instanceId: instance.id,
      pivot,
      suspension: suspensionInstance
        ? createSuspensionVisual(
            suspensionInstance,
            instanceRoots.get(suspensionInstance.id)!,
            materialFor(suspensionInstance),
          )
        : null,
    };
    poseKartWheelVisual(wheel, hub.y);
    return wheel;
  });

  // A suspension without a connected wheel still shows its coilover at the
  // mount's own hub anchor.
  const riggedSuspensionIds = new Set(
    wheels.map((wheel) => wheel.suspension?.instanceId),
  );
  for (const instance of document.componentInstances) {
    if (
      !instance.suspensionMount ||
      riggedSuspensionIds.has(instance.id) ||
      getApprovedKartComponent(instance.definition)?.category !== "suspension"
    ) {
      continue;
    }
    const suspension = createSuspensionVisual(
      instance,
      instanceRoots.get(instance.id)!,
      materialFor(instance),
    );
    if (suspension) {
      poseKartSuspensionVisual(
        suspension,
        toPcVector(instance.suspensionMount.hubAnchor),
      );
    }
  }

  return { instanceRoots, root, wheels };
}

/** Places a wheel hub at `hubY` (assembly axes) and follows it with its rig. */
export function poseKartWheelVisual(wheel: KartWheelVisual, hubY: number) {
  const hub = new pc.Vec3(wheel.hub.x, hubY, wheel.hub.z);
  wheel.pivot.setLocalPosition(hub);
  if (wheel.suspension) poseKartSuspensionVisual(wheel.suspension, hub);
}

function poseKartSuspensionVisual(
  suspension: KartSuspensionVisual,
  hub: pc.Vec3,
) {
  const springArm = suspension.springArmAnchor.clone();
  springArm.y += (hub.y - suspension.hubAnchorY) * suspension.motionRatio;
  suspension.coilEnd.copy(springArm);
  placeBar(
    suspension.armForward,
    suspension.chassisForwardAnchor,
    hub,
    ARM_RADIUS,
  );
  placeBar(suspension.armRear, suspension.chassisRearAnchor, hub, ARM_RADIUS);
  placeBar(
    suspension.shock,
    suspension.chassisShockAnchor,
    springArm,
    DAMPER_RADIUS,
  );
  placeCoil(suspension.coil, suspension.chassisShockAnchor, springArm);
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

function createPrimitiveEntity(
  primitive: KartAssemblyPrimitiveInstance,
  material: pc.StandardMaterial,
) {
  const root = createInstanceRoot(primitive.id, primitive.transform);
  const visual = createModelEntity(
    `${primitive.id}-visual`,
    primitive.shape,
    material,
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
  root.addChild(visual);
  return root;
}

function createInstanceRoot(
  name: string,
  transform: KartAssemblyComponentInstance["transform"],
) {
  const root = new pc.Entity(name);
  root.setPosition(
    transform.position.x,
    transform.position.y,
    transform.position.z,
  );
  root.setEulerAngles(
    transform.rotationDegrees.x,
    transform.rotationDegrees.y,
    transform.rotationDegrees.z,
  );
  return root;
}

/**
 * A child frame that cancels its instance transform, so rig parts are placed
 * in assembly axes while still moving with their instance in the editor.
 * Wheel axles and suspension geometry come from positions and mounts, not the
 * instance rotation, matching derivation.
 */
function createAssemblyFrame(
  name: string,
  transform: KartAssemblyComponentInstance["transform"],
) {
  const frame = new pc.Entity(name);
  const inverseRotation = new pc.Quat()
    .setFromEulerAngles(
      transform.rotationDegrees.x,
      transform.rotationDegrees.y,
      transform.rotationDegrees.z,
    )
    .invert();
  frame.setLocalRotation(inverseRotation);
  frame.setLocalPosition(
    inverseRotation.transformVector(
      new pc.Vec3(
        -transform.position.x,
        -transform.position.y,
        -transform.position.z,
      ),
    ),
  );
  return frame;
}

function createConstructionEntity(
  name: string,
  construction: ApprovedComponentDefinition["construction"][number],
  material: pc.StandardMaterial,
) {
  const entity = createModelEntity(name, construction.shape, material);
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
  return entity;
}

function createWheelCylinder(
  name: string,
  scale: pc.Vec3,
  material: pc.StandardMaterial,
) {
  const entity = createModelEntity(name, "cylinder", material);
  entity.setLocalEulerAngles(0, 0, 90);
  entity.setLocalScale(scale);
  return entity;
}

function createSuspensionVisual(
  instance: KartAssemblyComponentInstance,
  instanceRoot: pc.Entity,
  material: pc.StandardMaterial,
): KartSuspensionVisual | null {
  const mount = instance.suspensionMount;
  if (!mount) return null;
  const coilover = createAssemblyFrame(
    `${instance.id}-coilover`,
    instance.transform,
  );
  instanceRoot.addChild(coilover);
  const createBar = (name: string, radius: number, shadows: boolean) => {
    const bar = createModelEntity(name, "cylinder", material);
    if (bar.model) {
      bar.model.castShadows = shadows;
      bar.model.receiveShadows = shadows;
    }
    bar.setLocalScale(radius * 2, 0.5, radius * 2);
    coilover.addChild(bar);
    return bar;
  };
  const armPivot = toPcVector(mount.armPivot);
  // Same expression as derivation, so race poses match the physics exactly.
  const hubLever = Math.hypot(
    mount.hubAnchor.x - mount.armPivot.x,
    mount.hubAnchor.y - mount.armPivot.y,
    mount.hubAnchor.z - mount.armPivot.z,
  );
  const springLever = Math.hypot(
    mount.springArmAnchor.x - mount.armPivot.x,
    mount.springArmAnchor.y - mount.armPivot.y,
    mount.springArmAnchor.z - mount.armPivot.z,
  );
  return {
    armForward: createBar(`${instance.id}-arm-forward`, ARM_RADIUS, true),
    armRear: createBar(`${instance.id}-arm-rear`, ARM_RADIUS, true),
    chassisForwardAnchor: armPivot
      .clone()
      .add(new pc.Vec3(0, 0, -ARM_ANCHOR_HALF_SPREAD)),
    chassisRearAnchor: armPivot
      .clone()
      .add(new pc.Vec3(0, 0, ARM_ANCHOR_HALF_SPREAD)),
    chassisShockAnchor: toPcVector(mount.chassisAnchor),
    coil: Array.from({ length: COIL_SEGMENTS }, (_, index) =>
      createBar(`${instance.id}-coil-${index + 1}`, COIL_WIRE_RADIUS, false),
    ),
    coilEnd: toPcVector(mount.springArmAnchor),
    hubAnchorY: mount.hubAnchor.y,
    instanceId: instance.id,
    motionRatio: springLever / hubLever,
    shock: createBar(`${instance.id}-damper`, DAMPER_RADIUS, false),
    springArmAnchor: toPcVector(mount.springArmAnchor),
  };
}

function findWheelSuspension(document: KartAssemblyDocument, wheelId: string) {
  return document.connections
    .filter(
      ({ from, to }) =>
        (from.instanceId === wheelId && from.portId === "hub-mount") ||
        (to.instanceId === wheelId && to.portId === "hub-mount"),
    )
    .map(({ from, to }) =>
      from.instanceId === wheelId ? to.instanceId : from.instanceId,
    )
    .map((id) =>
      document.componentInstances.find((instance) => instance.id === id),
    )
    .find(
      (instance): instance is KartAssemblyComponentInstance =>
        !!instance?.suspensionMount &&
        getApprovedKartComponent(instance.definition)?.category ===
          "suspension",
    );
}

function placeBar(
  bar: pc.Entity,
  start: pc.Vec3,
  end: pc.Vec3,
  radius: number,
) {
  const direction = end.clone().sub(start);
  const length = direction.length();
  if (length <= 0.0001) {
    bar.enabled = false;
    return;
  }
  bar.enabled = true;
  bar.setLocalPosition(start.clone().add(end).mulScalar(0.5));
  bar.setLocalRotation(
    new pc.Quat().setFromDirections(pc.Vec3.UP, direction.normalize()),
  );
  bar.setLocalScale(radius * 2, length, radius * 2);
}

function placeCoil(segments: pc.Entity[], start: pc.Vec3, end: pc.Vec3) {
  const axis = end.clone().sub(start);
  const length = axis.length();
  if (length <= 0.0001) {
    segments.forEach((segment) => {
      segment.enabled = false;
    });
    return;
  }
  axis.normalize();
  const reference = Math.abs(axis.y) < 0.9 ? pc.Vec3.UP : pc.Vec3.RIGHT;
  const side = new pc.Vec3().cross(axis, reference).normalize();
  const up = new pc.Vec3().cross(side, axis).normalize();
  let previous = start.clone();
  segments.forEach((segment, index) => {
    const t = (index + 1) / segments.length;
    const angle = t * Math.PI * 2 * COIL_TURNS;
    const point = start
      .clone()
      .add(axis.clone().mulScalar(length * t))
      .add(side.clone().mulScalar(Math.cos(angle) * COIL_RADIUS))
      .add(up.clone().mulScalar(Math.sin(angle) * COIL_RADIUS));
    placeBar(segment, previous, point, COIL_WIRE_RADIUS);
    previous = point;
  });
}

function createModelEntity(
  name: string,
  shape: "box" | "cylinder",
  material: pc.StandardMaterial,
) {
  const entity = new pc.Entity(name);
  entity.addComponent("model", { type: shape });
  entity.model?.meshInstances?.forEach((mesh) => {
    mesh.material = material;
  });
  return entity;
}

function applyCylinderAxis(entity: pc.Entity, axis: "x" | "y" | "z") {
  if (axis === "x") entity.rotateLocal(0, 0, 90);
  if (axis === "z") entity.rotateLocal(90, 0, 0);
}

function toPcVector(value: KartVector) {
  return new pc.Vec3(value.x, value.y, value.z);
}

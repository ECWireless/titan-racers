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
import type { DeepReadonly } from "./immutable-registry";
import type {
  KartCoiloverVisual,
  KartPartFinish,
  KartPartVisualPiece,
} from "./kart-part-visual-geometry";
import { buildSuspensionArm } from "./kart-part-visual-geometry";
import {
  getAuthoredMaterialFinish,
  getKartPartVisual,
} from "./kart-part-visuals";
import { getKartFinishColor } from "./kart-visual-material";

type ReadonlyComponentDefinition = DeepReadonly<ApprovedComponentDefinition>;
type CreatePieces = (
  name: string,
  pieces: KartPartVisualPiece[],
  skin: KartVisualSkin,
) => pc.Entity;

export type KartRenderedBounds = {
  center: pc.Vec3;
  maximum: pc.Vec3;
  minimum: pc.Vec3;
};

/** Callers own material lifecycle; the builder only requests materials. */
type KartVisualMaterialFactory = (
  finish: KartPartFinish,
  instanceId: string,
) => pc.StandardMaterial;

/** One instance's materials and its authored color. */
type KartVisualSkin = {
  visualColor: string;
  materialFor: (finish: KartPartFinish) => pc.StandardMaterial;
};

type KartVector = { x: number; y: number; z: number };

type KartSuspensionVisual = {
  arm: pc.Entity;
  armPivot: pc.Vec3;
  armRestLength: number;
  chassisShockAnchor: pc.Vec3;
  /** One helix mesh built at rest length and stretched between the perches. */
  coil: pc.Entity;
  coilRestLength: number;
  /** Spring seats measured from each eye along the shock. */
  perches: { bottom: number; top: number };
  /** Hub height (assembly axes) at which the mount geometry is at rest. */
  restHubY: number;
  instanceId: string;
  motionRatio: number;
  shaft: pc.Entity;
  /** The damper body, rigid with the chassis eye. */
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

type KartAssemblyVisual = {
  instanceRoots: Map<string, pc.Entity>;
  root: pc.Entity;
  wheels: KartWheelVisual[];
};

const ARM_ANCHOR_HALF_SPREAD = 0.025;
const COIL_SEGMENTS_PER_TURN = 12;
const COIL_WIRE_SIDES = 5;

export function createKartAssemblyVisual(
  document: KartAssemblyDocument,
  createMaterial: KartVisualMaterialFactory,
  device: pc.GraphicsDevice,
): KartAssemblyVisual {
  const root = new pc.Entity(`${document.kartId}-visual`);
  const instanceRoots = new Map<string, pc.Entity>();
  const materials = new Map<string, pc.StandardMaterial>();
  const materialsFor = (instance: {
    id: string;
    visualColor: string;
  }): KartVisualSkin => ({
    visualColor: instance.visualColor,
    materialFor: (finish) => {
      const key = `${instance.id}:${finish}`;
      let material = materials.get(key);
      if (!material) {
        material = createMaterial(finish, instance.id);
        materials.set(key, material);
      }
      return material;
    },
  });
  const createPieces: CreatePieces = (name, pieces, skin) =>
    createPieceEntity(name, pieces, skin, device);
  const wheelInstances: Array<{
    definition: ReadonlyComponentDefinition;
    instance: KartAssemblyComponentInstance;
  }> = [];

  for (const primitive of document.primitiveInstances) {
    const entity = createPrimitiveEntity(
      primitive,
      createPieces(
        `${primitive.id}-visual`,
        [
          createPrimitivePiece(
            primitive.shape,
            getAuthoredMaterialFinish(primitive.material.id),
          ),
        ],
        materialsFor(primitive),
      ),
    );
    instanceRoots.set(primitive.id, entity);
    root.addChild(entity);
  }

  for (const instance of document.componentInstances) {
    const definition = getApprovedKartComponent(instance.definition);
    const entity = createInstanceRoot(instance.id, instance.transform);
    instanceRoots.set(instance.id, entity);
    root.addChild(entity);
    if (!definition) continue;
    if (definition.category === "wheel-tire") {
      wheelInstances.push({ definition, instance });
      continue;
    }
    const visual = getKartPartVisual(instance.definition);
    // Suspension visuals are posed from the mounts once wheels are known.
    if (visual?.kind === "coilover" && instance.suspensionMount) continue;
    entity.addChild(
      visual?.kind === "pieces"
        ? createPieces(
            `${instance.id}-part`,
            visual.build(definition),
            materialsFor(instance),
          )
        : createConstructionEntity(
            instance.id,
            definition,
            materialsFor(instance),
            createPieces,
          ),
    );
  }

  const createSuspension = (
    instance: KartAssemblyComponentInstance,
    restHubY: number,
  ) => {
    const definition = getApprovedKartComponent(instance.definition);
    const visual = getKartPartVisual(instance.definition);
    if (
      !definition ||
      visual?.kind !== "coilover" ||
      !instance.suspensionMount
    ) {
      return null;
    }
    return createSuspensionVisual(
      instance,
      instance.suspensionMount,
      visual.build(definition),
      restHubY,
      instanceRoots.get(instance.id)!,
      materialsFor(instance),
      createPieces,
    );
  };

  const wheels = wheelInstances.map(({ definition, instance }) => {
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
    const visual = getKartPartVisual(instance.definition);
    const wheelVisual =
      visual?.kind === "pieces"
        ? createPieces(
            `${instance.id}-wheel`,
            visual.build(definition),
            materialsFor(instance),
          )
        : createConstructionEntity(
            instance.id,
            definition,
            materialsFor(instance),
            createPieces,
          );
    // Wheel visuals face outboard toward +X; left wheels turn around.
    if (hub.x < 0) wheelVisual.setLocalEulerAngles(0, 180, 0);
    pivot.addChild(wheelVisual);

    const wheel: KartWheelVisual = {
      hub,
      instanceId: instance.id,
      pivot,
      suspension: suspensionInstance
        ? createSuspension(suspensionInstance, hub.y)
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
    const suspension = createSuspension(
      instance,
      instance.suspensionMount.hubAnchor.y,
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
  springArm.y += (hub.y - suspension.restHubY) * suspension.motionRatio;
  poseArm(suspension, hub);

  const chassis = suspension.chassisShockAnchor;
  const axis = springArm.clone().sub(chassis);
  const length = axis.length();
  if (length <= 0.0001) return;
  axis.mulScalar(1 / length);
  const rotation = new pc.Quat().setFromDirections(pc.Vec3.UP, axis);
  suspension.shock.setLocalPosition(chassis);
  suspension.shock.setLocalRotation(rotation);
  // The shaft faces back up the shock with its eye pin parallel to the body's.
  suspension.shaft.setLocalPosition(springArm);
  suspension.shaft.setLocalRotation(
    rotation.clone().mul(new pc.Quat().setFromEulerAngles(0, 0, 180)),
  );
  // Stretching the helix compresses its pitch like a real spring (the wire
  // section flattens slightly with it).
  const { bottom, top } = suspension.perches;
  const coilLength = Math.max(length - top - bottom, 0);
  suspension.coil.setLocalPosition(
    chassis.clone().add(axis.clone().mulScalar(top)),
  );
  suspension.coil.setLocalRotation(rotation);
  suspension.coil.setLocalScale(1, coilLength / suspension.coilRestLength, 1);
}

/** Swings the A-arm about its chassis pivots and stretches it to the hub. */
function poseArm(suspension: KartSuspensionVisual, hub: pc.Vec3) {
  const toHub = hub.clone().sub(suspension.armPivot);
  const level = Math.hypot(toHub.x, toHub.z);
  // Arm visuals point +X toward the hub: yaw to it, then pitch about the
  // pivot axis, which keeps that axis level.
  const rotation = new pc.Quat().mul2(
    new pc.Quat().setFromEulerAngles(
      0,
      (Math.atan2(-toHub.z, toHub.x) * 180) / Math.PI,
      0,
    ),
    new pc.Quat().setFromEulerAngles(
      0,
      0,
      (Math.atan2(toHub.y, level) * 180) / Math.PI,
    ),
  );
  suspension.arm.setLocalPosition(suspension.armPivot);
  suspension.arm.setLocalRotation(rotation);
  suspension.arm.setLocalScale(
    toHub.length() / suspension.armRestLength,
    1,
    1,
  );
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
    node.render?.meshInstances?.forEach(({ aabb }) => {
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
  visual: pc.Entity,
) {
  const root = createInstanceRoot(primitive.id, primitive.transform);
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

/** Fallback for a part version without a visual: its construction primitives. */
function createConstructionEntity(
  instanceId: string,
  definition: ReadonlyComponentDefinition,
  skin: KartVisualSkin,
  createPieces: CreatePieces,
) {
  const root = new pc.Entity(`${instanceId}-construction`);
  definition.construction.forEach((construction, index) => {
    const entity = createPieces(
      `${instanceId}-construction-${index}`,
      [
        createPrimitivePiece(
          construction.shape,
          getAuthoredMaterialFinish(construction.material.id),
        ),
      ],
      skin,
    );
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
    root.addChild(entity);
  });
  return root;
}

function createSuspensionVisual(
  instance: KartAssemblyComponentInstance,
  mount: NonNullable<KartAssemblyComponentInstance["suspensionMount"]>,
  coilover: KartCoiloverVisual,
  restHubY: number,
  instanceRoot: pc.Entity,
  skin: KartVisualSkin,
  createPieces: CreatePieces,
): KartSuspensionVisual {
  const rig = createAssemblyFrame(
    `${instance.id}-coilover`,
    instance.transform,
  );
  instanceRoot.addChild(rig);
  const armPivot = toPcVector(mount.armPivot);
  const hubAnchor = toPcVector(mount.hubAnchor);
  const springArmAnchor = toPcVector(mount.springArmAnchor);
  const chassisShockAnchor = toPcVector(mount.chassisAnchor);
  // Same expression as derivation, so race poses match the physics exactly.
  const hubLever = hubAnchor.distance(armPivot);
  const springLever = springArmAnchor.distance(armPivot);
  const armRestLength = hubAnchor.distance(armPivot);
  const coilRestLength = Math.max(
    springArmAnchor.distance(chassisShockAnchor) -
      coilover.topPerch -
      coilover.bottomPerch,
    0.001,
  );

  const arm = createPieces(
    `${instance.id}-arm`,
    buildSuspensionArm(armRestLength, ARM_ANCHOR_HALF_SPREAD),
    skin,
  );
  const shock = createPieces(
    `${instance.id}-damper`,
    coilover.body,
    skin,
  );
  const shaft = createPieces(
    `${instance.id}-shaft`,
    coilover.shaft,
    skin,
  );
  const coil = createPieces(
    `${instance.id}-coil`,
    [createCoilPiece(coilover.spring, coilRestLength)],
    skin,
  );
  rig.addChild(arm);
  rig.addChild(shock);
  rig.addChild(shaft);
  rig.addChild(coil);

  return {
    arm,
    armPivot,
    armRestLength,
    chassisShockAnchor,
    coil,
    coilRestLength,
    perches: { bottom: coilover.bottomPerch, top: coilover.topPerch },
    restHubY,
    instanceId: instance.id,
    motionRatio: springLever / hubLever,
    shaft,
    shock,
    springArmAnchor,
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

/**
 * A helix tube from local y = 0 to `length`, so it scales along +Y. The
 * spring is the suspension's own color, as on real coilovers.
 */
function createCoilPiece(
  spring: KartCoiloverVisual["spring"],
  length: number,
): KartPartVisualPiece {
  const { meanRadius, turns, wireRadius } = spring;
  const steps = Math.ceil(turns * COIL_SEGMENTS_PER_TURN);
  const positions: number[] = [];
  const normals: number[] = [];
  const indices: number[] = [];
  const pitch = length / turns;
  const circumference = Math.PI * 2 * meanRadius;
  const tangentScale = Math.hypot(circumference, pitch);
  for (let step = 0; step <= steps; step += 1) {
    const t = step / steps;
    const angle = t * Math.PI * 2 * turns;
    const cos = Math.cos(angle);
    const sin = Math.sin(angle);
    const center = new pc.Vec3(cos * meanRadius, t * length, sin * meanRadius);
    const tangent = new pc.Vec3(
      (-sin * circumference) / tangentScale,
      pitch / tangentScale,
      (cos * circumference) / tangentScale,
    );
    const inward = new pc.Vec3(-cos, 0, -sin);
    const binormal = new pc.Vec3().cross(tangent, inward);
    for (let side = 0; side < COIL_WIRE_SIDES; side += 1) {
      const phi = (side / COIL_WIRE_SIDES) * Math.PI * 2;
      const normal = inward
        .clone()
        .mulScalar(Math.cos(phi))
        .add(binormal.clone().mulScalar(Math.sin(phi)));
      const point = center.clone().add(normal.clone().mulScalar(wireRadius));
      positions.push(point.x, point.y, point.z);
      normals.push(normal.x, normal.y, normal.z);
    }
  }
  for (let step = 0; step < steps; step += 1) {
    for (let side = 0; side < COIL_WIRE_SIDES; side += 1) {
      const a = step * COIL_WIRE_SIDES + side;
      const b = step * COIL_WIRE_SIDES + ((side + 1) % COIL_WIRE_SIDES);
      const c = a + COIL_WIRE_SIDES;
      const d = b + COIL_WIRE_SIDES;
      indices.push(a, b, c, b, d, c);
    }
  }
  return { finish: "authored-paint", indices, normals, positions };
}

const renderedColors = new WeakMap<pc.Entity, string>();

/** The authored color as rendered (after mapping), for test diagnostics. */
export function getRenderedKartColor(root: pc.Entity) {
  let color: string | null = null;
  root.forEach((node) => {
    if (!color && node instanceof pc.Entity) {
      color = renderedColors.get(node) ?? null;
    }
  });
  return color;
}

/** A unit box or Y-axis cylinder, scaled to size by its entity. */
function createPrimitivePiece(
  shape: "box" | "cylinder",
  finish: KartPartFinish,
): KartPartVisualPiece {
  const geometry =
    shape === "box"
      ? new pc.BoxGeometry()
      : new pc.CylinderGeometry({ capSegments: 24, height: 1, radius: 0.5 });
  return {
    finish,
    indices: [...geometry.indices!],
    normals: [...geometry.normals!],
    positions: [...geometry.positions!],
  };
}

function createPieceEntity(
  name: string,
  pieces: KartPartVisualPiece[],
  skin: KartVisualSkin,
  device: pc.GraphicsDevice,
) {
  const entity = new pc.Entity(name);
  entity.addComponent("render", {
    meshInstances: pieces.map((piece) => {
      const hex = getKartFinishColor(piece.finish, skin.visualColor);
      const color = new pc.Color().fromString(hex);
      const rgba = [color.r, color.g, color.b, 1].map((channel) =>
        Math.round(channel * 255),
      );
      const mesh = new pc.Mesh(device);
      mesh.setPositions(piece.positions);
      mesh.setNormals(piece.normals);
      mesh.setColors32(
        Array.from({ length: piece.positions.length / 3 }, () => rgba).flat(),
      );
      if (piece.finish.startsWith("authored-")) {
        renderedColors.set(entity, hex);
      }
      mesh.setIndices(piece.indices);
      mesh.update(pc.PRIMITIVE_TRIANGLES);
      return new pc.MeshInstance(mesh, skin.materialFor(piece.finish));
    }),
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

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
import { buildCadMovingPieces, getKartCadMesh } from "./kart-cad-meshes";
import {
  findWheelSuspension,
  getDriveshaftEnds,
  getHornAngle,
  getHornBall,
  getKnuckleBall,
  planKartLinkagePoses,
  type KartDriveshaftPose,
  type KartServoPose,
  type KartTieRodPose,
} from "./kart-linkage-poses";
import {
  ARM_PIVOT_HALF_SPREAD,
  buildAxleCup,
  buildDogbone,
  buildSteeringArm,
  buildTieRod,
  DRIVEN_ARM_DROP,
} from "./kart-linkage-visual-geometry";
import type {
  KartCoiloverVisual,
  KartPartFinish,
  KartPartVisualPiece,
} from "./kart-part-visual-geometry";
import {
  buildCoilSpring,
  buildSuspensionArm,
} from "./kart-part-visual-geometry";
import {
  buildAuthoredPrimitiveVisual,
  getAuthoredMaterialFinish,
  getKartPartVisual,
} from "./kart-part-visuals";
import { getKartFinishColor } from "./kart-visual-material";
import {
  buildKartCablePieces,
  KART_CABLE_RED,
  planKartCables,
} from "./kart-wiring";

type ReadonlyComponentDefinition = DeepReadonly<ApprovedComponentDefinition>;
// A wheel's pieces carry its index, so one batched draw can blur each
// wheel by its own spin.
type AssemblyPiece = KartPartVisualPiece & { wheelIndex?: number };
type CreatePieces = (
  name: string,
  pieces: AssemblyPiece[],
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

/** A servo's horn and the tie rods it moves, one for each steered wheel. */
type KartSteeringRigVisual = {
  /** Turns about its own +Y, the servo's output shaft. */
  horn: pc.Entity;
  /** Radians, as last posed. */
  hornAngle: number;
  pose: KartServoPose;
  /** Each rod's wheel steering angle, read from its pivot. */
  steerAngleOf: (wheelId: string) => number;
  tieRods: KartTieRodVisual[];
};

type KartTieRodVisual = {
  pivot: pc.Entity;
  pose: KartTieRodPose;
  rig: KartSteeringRigVisual;
  /** Drawn at rest length from the horn's ball along +X, in assembly axes. */
  rod: pc.Entity;
};

type KartDriveshaftVisual = {
  /** Rigid, from the axle cup's ball centre along +X, in assembly axes. */
  bone: pc.Entity;
  pose: KartDriveshaftPose;
};

export type KartWheelVisual = {
  /** This wheel's driveshaft from the transmission, if it is driven. */
  driveshaft: KartDriveshaftVisual | null;
  /** Rest hub position in assembly axes. */
  hub: pc.Vec3;
  instanceId: string;
  /** Hub pivot in assembly axes; steering rotates it about local Y. */
  pivot: pc.Entity;
  /** The hub height the suspension and driveshaft were last posed at. */
  posedHubY: number | null;
  /** Turns the wheel about the axle, the pivot's local X. */
  spin: pc.Entity;
  /** Index the wheel shaders read this wheel's blur by. */
  spinIndex: number;
  /** +1 when the wheel's own +X (outboard) is the pivot's +X, else -1. */
  axleSign: 1 | -1;
  suspension: KartSuspensionVisual | null;
  /** This wheel's tie rod from the servo's horn, if it is steered. */
  tieRod: KartTieRodVisual | null;
};

type KartAssemblyVisual = {
  /** The kart's cables, in assembly axes, or null if it has none. */
  cables: pc.Entity | null;
  instanceRoots: Map<string, pc.Entity>;
  root: pc.Entity;
  wheels: KartWheelVisual[];
};


/**
 * Builds a kart's visual. Without a device it builds the same entities with
 * no meshes, which pose like the drawn kart (for checking poses in Node).
 */
export function createKartAssemblyVisual(
  document: KartAssemblyDocument,
  createMaterial: KartVisualMaterialFactory,
  device: pc.GraphicsDevice | null,
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
  const linkages = planKartLinkagePoses(document);
  const drivenWheelIds = new Set(
    linkages.driveshafts.map(({ wheelId }) => wheelId),
  );
  // A CAD part's posed pieces (`<instance>:<name>`), drawn at rest.
  const movingParts = new Map<string, pc.Entity>();

  for (const primitive of document.primitiveInstances) {
    const entity = createPrimitiveEntity(
      primitive,
      createPieces(
        `${primitive.id}-visual`,
        buildAuthoredPrimitiveVisual(primitive),
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
    const cad = getKartCadMesh(instance.definition);
    for (const name of Object.keys(cad?.moving ?? {})) {
      const { pieces, pivot } = buildCadMovingPieces(cad!, name);
      const moving = createPieces(
        `${instance.id}-${name}`,
        pieces,
        materialsFor(instance),
      );
      moving.setLocalPosition(...pivot);
      entity.addChild(moving);
      movingParts.set(`${instance.id}:${name}`, moving);
    }
  }

  const createSuspension = (
    instance: KartAssemblyComponentInstance,
    restHubY: number,
    driven = false,
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
      driven ? DRIVEN_ARM_DROP : 0,
    );
  };
  const wheelFrames = new Map<string, pc.Entity>();

  const wheels = wheelInstances.map(({ definition, instance }, spinIndex) => {
    const suspensionInstance = findWheelSuspension(document, instance.id);
    const wheelRoot = instanceRoots.get(instance.id)!;
    const wheelFrame = createAssemblyFrame(
      `${instance.id}-assembly-frame`,
      instance.transform,
    );
    wheelRoot.addChild(wheelFrame);
    wheelFrames.set(instance.id, wheelFrame);
    const hub = toPcVector(instance.transform.position);
    const pivot = new pc.Entity(`${instance.id}-pivot`);
    pivot.setLocalPosition(hub);
    wheelFrame.addChild(pivot);
    const spin = new pc.Entity(`${instance.id}-spin`);
    pivot.addChild(spin);
    const visual = getKartPartVisual(instance.definition);
    const wheelVisual =
      visual?.kind === "pieces"
        ? createPieces(
            `${instance.id}-wheel`,
            visual
              .build(definition)
              .map((piece) => ({ ...piece, wheelIndex: spinIndex })),
            materialsFor(instance),
          )
        : createConstructionEntity(
            instance.id,
            definition,
            materialsFor(instance),
            createPieces,
          );
    // Wheel visuals face outboard toward +X; left wheels turn around.
    const axleSign = hub.x < 0 ? -1 : 1;
    if (axleSign < 0) wheelVisual.setLocalEulerAngles(0, 180, 0);
    spin.addChild(wheelVisual);

    const wheel: KartWheelVisual = {
      axleSign,
      driveshaft: null,
      hub,
      instanceId: instance.id,
      pivot,
      posedHubY: null,
      spin,
      spinIndex,
      suspension: suspensionInstance
        ? createSuspension(
            suspensionInstance,
            hub.y,
            drivenWheelIds.has(instance.id),
          )
        : null,
      tieRod: null,
    };
    return wheel;
  });

  // Linkages hang from their wheel's assembly frame, so they are posed in
  // assembly axes and shown or hidden with the wheel.
  for (const pose of linkages.servos) {
    const horn = movingParts.get(`${pose.servoId}:horn`);
    if (!horn) continue;
    const pivots = new Map<string, pc.Entity>();
    const rig: KartSteeringRigVisual = {
      horn,
      hornAngle: 0,
      pose,
      steerAngleOf: (wheelId) => getSteerAngle(pivots.get(wheelId)!),
      tieRods: [],
    };
    for (const tieRodPose of pose.tieRods) {
      const wheel = wheels.find(
        ({ instanceId }) => instanceId === tieRodPose.wheelId,
      );
      if (!wheel) continue;
      wheel.tieRod = createTieRodVisual(
        tieRodPose,
        rig,
        wheel,
        wheelFrames.get(wheel.instanceId)!,
        materialsFor(
          document.componentInstances.find(({ id }) => id === wheel.instanceId)!,
        ),
        createPieces,
      );
      rig.tieRods.push(wheel.tieRod);
      pivots.set(wheel.instanceId, wheel.pivot);
    }
  }
  for (const pose of linkages.driveshafts) {
    const wheel = wheels.find(({ instanceId }) => instanceId === pose.wheelId);
    // A draft's wheel without a suspension has no arm to carry its cup.
    if (!wheel?.suspension) continue;
    wheel.driveshaft = createDriveshaftVisual(
      pose,
      wheel.suspension,
      wheelFrames.get(wheel.instanceId)!,
      materialsFor(
        document.componentInstances.find(({ id }) => id === wheel.instanceId)!,
      ),
      // The cup rides the arm, so it selects and highlights with it.
      materialsFor(
        document.componentInstances.find(
          ({ id }) => id === wheel.suspension!.instanceId,
        )!,
      ),
      createPieces,
    );
  }
  for (const wheel of wheels) poseKartWheelVisual(wheel, wheel.hub.y);

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

  const cables = createKartCablesEntity(document, createMaterial, device);
  if (cables) root.addChild(cables);

  return { cables, instanceRoots, root, wheels };
}

/**
 * The key the kart's cables ask the material factory with; no instance id
 * can take this form.
 */
export const KART_CABLES_ID = "#cables";

/**
 * The kart's cables (`kart-wiring.ts`) as one entity in assembly axes, or
 * null if it has none. Callers can rebuild it alone as parts move. They
 * belong to no part, so picking passes through them.
 */
export function createKartCablesEntity(
  document: KartAssemblyDocument,
  createMaterial: KartVisualMaterialFactory,
  device: pc.GraphicsDevice | null,
) {
  const pieces = buildKartCablePieces(planKartCables(document));
  if (pieces.length === 0) return null;
  const entity = createPieceEntity(
    "cables",
    pieces,
    {
      materialFor: (finish) => createMaterial(finish, KART_CABLES_ID),
      visualColor: KART_CABLE_RED,
    },
    device,
    false,
  );
  entity.render?.meshInstances.forEach((mesh) => {
    mesh.pick = false;
  });
  return entity;
}

/**
 * Places a wheel hub at `hubY` (assembly axes) and follows it with its rig:
 * its arm and coilover, its driveshaft, and, from its pivot's steering as
 * well, its tie rod. Callers turn a steered wheel's pivot before this.
 */
export function poseKartWheelVisual(wheel: KartWheelVisual, hubY: number) {
  // The suspension and driveshaft move only with the hub, so a wheel that
  // only steers (a ghost's, or a kart's at rest) skips them.
  if (hubY !== wheel.posedHubY) {
    wheel.posedHubY = hubY;
    const hub = new pc.Vec3(wheel.hub.x, hubY, wheel.hub.z);
    wheel.pivot.setLocalPosition(hub);
    if (wheel.suspension) poseKartSuspensionVisual(wheel.suspension, hub);
    if (wheel.driveshaft) poseDriveshaft(wheel.driveshaft, hub);
  }
  if (wheel.tieRod) poseTieRod(wheel.tieRod);
}

// Scratch values for the linkage poses, which run every frame. Made on
// first use: Node specs import this module where PlayCanvas has no classes.
let linkScratch: {
  end: pc.Vec3;
  offset: pc.Vec3;
  rotation: pc.Quat;
  start: pc.Vec3;
} | null = null;
const scratch = () =>
  (linkScratch ??= {
    end: new pc.Vec3(),
    offset: new pc.Vec3(),
    rotation: new pc.Quat(),
    start: new pc.Vec3(),
  });

/**
 * Turns the horn with the steering, then runs every rod on it from the horn's
 * ball stud to its steering arm's.
 */
function poseTieRod(tieRod: KartTieRodVisual) {
  const rig = tieRod.rig;
  const hornAngle = getHornAngle(rig.pose, rig.steerAngleOf);
  if (hornAngle !== rig.hornAngle) {
    rig.hornAngle = hornAngle;
    rig.horn.setLocalRotation(setYaw(scratch().rotation, hornAngle));
  }
  // Every rod on the horn follows, including one whose wheel the caller
  // posed before turning this one.
  for (const rod of rig.tieRods) aimTieRod(rod, hornAngle);
}

function aimTieRod(tieRod: KartTieRodVisual, hornAngle: number) {
  const { end, start } = scratch();
  const pivot = tieRod.pivot;
  getHornBall(tieRod.pose, hornAngle, start);
  getKnuckleBall(
    tieRod.pose,
    pivot.getLocalPosition(),
    getSteerAngle(pivot),
    end,
  );
  aimLinkage(tieRod.rod, start, end, tieRod.pose.restLength);
}

/** A wheel pivot's steering angle, in radians about its +Y. */
function getSteerAngle(pivot: pc.Entity) {
  const rotation = pivot.getLocalRotation();
  return 2 * Math.atan2(rotation.y, rotation.w);
}

function setYaw(rotation: pc.Quat, radians: number) {
  return rotation.set(0, Math.sin(radians / 2), 0, Math.cos(radians / 2));
}

function poseDriveshaft(driveshaft: KartDriveshaftVisual, hub: pc.Vec3) {
  const { end, start } = scratch();
  getDriveshaftEnds(driveshaft.pose, hub, start, end);
  aimLinkage(driveshaft.bone, start, end);
}

/**
 * Puts a linkage at `start` with its +X toward `end` and its +Y in the
 * vertical plane through them: yaw, then pitch, as the suspension arms are
 * aimed. A linkage drawn `restLength` long is stretched to reach `end`.
 */
function aimLinkage(
  entity: pc.Entity,
  start: pc.Vec3,
  end: pc.Vec3,
  restLength?: number,
) {
  const { offset, rotation } = scratch();
  offset.sub2(end, start);
  const level = Math.hypot(offset.x, offset.z);
  const yaw = Math.atan2(-offset.z, offset.x) / 2;
  const pitch = Math.atan2(offset.y, level) / 2;
  const sinYaw = Math.sin(yaw);
  const cosYaw = Math.cos(yaw);
  const sinPitch = Math.sin(pitch);
  const cosPitch = Math.cos(pitch);
  entity.setLocalPosition(start);
  entity.setLocalRotation(
    rotation.set(
      sinYaw * sinPitch,
      sinYaw * cosPitch,
      cosYaw * sinPitch,
      cosYaw * cosPitch,
    ),
  );
  if (restLength) {
    entity.setLocalScale(offset.length() / restLength, 1, 1);
  }
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

/**
 * A point in an arm's plan: along it from the pivot toward the hub, and
 * across it (+Z of the arm's frame, which `poseArm` yaws to face the hub).
 */
function inArmPlan(point: pc.Vec3, pivot: pc.Vec3, hub: pc.Vec3) {
  const hx = hub.x - pivot.x;
  const hz = hub.z - pivot.z;
  const length = Math.hypot(hx, hz);
  const px = point.x - pivot.x;
  const pz = point.z - pivot.z;
  return { x: (px * hx + pz * hz) / length, z: (pz * hx - px * hz) / length };
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

/**
 * Primitive visuals are built at true size. A box root still carries its size
 * as scale, which the editor's scale gizmo edits, so its visual undoes it; a
 * drag preview stretches the visual until the committed size rebuilds it.
 */
function createPrimitiveEntity(
  primitive: KartAssemblyPrimitiveInstance,
  visual: pc.Entity,
) {
  const root = createInstanceRoot(primitive.id, primitive.transform);
  if (primitive.shape === "box") {
    const { x, y, z } = primitive.size;
    root.setLocalScale(x, y, z);
    visual.setLocalScale(1 / x, 1 / y, 1 / z);
  } else {
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
  armDrop: number,
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
    buildSuspensionArm(
      armRestLength,
      ARM_PIVOT_HALF_SPREAD,
      armDrop,
      inArmPlan(springArmAnchor, armPivot, hubAnchor),
    ),
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
    [buildCoilSpring(coilover.spring, coilRestLength)],
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

/** A steered wheel's steering arm, under its pivot, and its tie rod. */
function createTieRodVisual(
  pose: KartTieRodPose,
  rig: KartSteeringRigVisual,
  wheel: KartWheelVisual,
  wheelFrame: pc.Entity,
  skin: KartVisualSkin,
  createPieces: CreatePieces,
): KartTieRodVisual {
  wheel.pivot.addChild(
    createPieces(
      `${wheel.instanceId}-steering-arm`,
      buildSteeringArm(pose.steeringArm.reach, pose.steeringArm.length),
      skin,
    ),
  );
  const rod = createPieces(
    `${wheel.instanceId}-tie-rod`,
    buildTieRod(pose.restLength),
    skin,
  );
  wheelFrame.addChild(rod);
  return { pivot: wheel.pivot, pose, rig, rod };
}

/**
 * A driven wheel's axle cup, riding its suspension arm inboard of the lower
 * shock eye, and its dogbone to the transmission's nearer outdrive.
 */
function createDriveshaftVisual(
  pose: KartDriveshaftPose,
  suspension: KartSuspensionVisual,
  wheelFrame: pc.Entity,
  skin: KartVisualSkin,
  armSkin: KartVisualSkin,
  createPieces: CreatePieces,
): KartDriveshaftVisual {
  suspension.arm.addChild(
    createPieces(
      `${pose.wheelId}-axle-cup`,
      buildAxleCup(pose.axleCupStation, suspension.armRestLength),
      armSkin,
    ),
  );
  const bone = createPieces(
    `${pose.wheelId}-dogbone`,
    buildDogbone(pose.length),
    skin,
  );
  wheelFrame.addChild(bone);
  return { bone, pose };
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
  pieces: AssemblyPiece[],
  skin: KartVisualSkin,
  device: pc.GraphicsDevice | null,
  // Whether the skin's color is the kart's authored color (cables' isn't).
  authoredColor = true,
) {
  const entity = new pc.Entity(name);
  if (!device) return entity;
  entity.addComponent("render", {
    meshInstances: pieces.map((piece) => {
      const hex = getKartFinishColor(piece.finish, skin.visualColor);
      const color = new pc.Color().fromString(hex);
      // Alpha is unused by the opaque finishes, so it carries a wheel's
      // index for the wheel shaders.
      const rgba = [
        ...[color.r, color.g, color.b].map((channel) =>
          Math.round(channel * 255),
        ),
        piece.wheelIndex ?? 255,
      ];
      const mesh = new pc.Mesh(device);
      mesh.setPositions(piece.positions);
      mesh.setNormals(piece.normals);
      mesh.setColors32(
        Array.from({ length: piece.positions.length / 3 }, () => rgba).flat(),
      );
      if (piece.profile) mesh.setUvs(1, piece.profile);
      if (authoredColor && piece.finish.startsWith("authored-")) {
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

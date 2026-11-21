import {
  defaultKartComponentVisualColor,
  parseKartAssemblyDocument,
  type KartAssemblyDocument,
} from "./kart-assembly-document";
import {
  getApprovedKartComponent,
  RATED_SHOCK_INSTALLATION_RADIANS,
} from "./kart-component-registry";
import {
  addVector,
  rotationMatrix,
  subtractVector,
  transformVector,
  transposeMatrix,
} from "./kart-construction-geometry";
import { ARM_PIVOT_HALF_SPREAD } from "./kart-linkage-visual-geometry";

const ZERO_ROTATION = { x: 0, y: 0, z: 0 } as const;
// Material left around a hinge pin or shock eye, and the molded-black
// composite used for towers and bumpers.
const MOUNT_MARGIN = 0.006;
const COMPOSITE_BLACK = "#1f2328";
// The rear tower stands this far behind the gearbox's output axis, so its
// post clears the spur gear and still rests wholly on the pad.
const REAR_TOWER_SETBACK = 0.002;
// A shock tower's crossbar ends this far below each top eye, so the shock's
// body, which stops short of its eye, passes under the bar.
const SHOCK_EYE_EDGE_DISTANCE = 0.004;

type Vector = { x: number; y: number; z: number };

/** Parts whose footprint rests on the base plate. */
type EquipmentId =
  | "battery-main"
  | "brakes-main"
  | "controller-main"
  | "steering-main";

// Every part an official kart carries is a version that declares its
// mounting points.
const PART_VERSION = 2;

type StructuralMaterial =
  | "material.engineering-polymer"
  | "material.structural-aluminum";

/**
 * Open 1:10 RC construction: a machined base plate, a hinge-pin mount at each
 * lower arm deep enough to carry both arm legs, a shock tower over each axle
 * (a post between the mounts and a crossbar above the wheels), a narrow top
 * deck between the towers, and molded bumpers. Electronics sit on the plate.
 */
export type OfficialKartChassisLayout = {
  armMount: { x: number; z: number };
  bumperSize: Vector;
  equipment: Record<EquipmentId, { x: number; yawDegrees?: number; z: number }>;
  plate: { bottomY: number; material: StructuralMaterial; size: Vector };
  shockTowerThickness: number;
  topDeck: { bottomY: number; size: { x: number; y: number } };
  /** A block raising the gearbox off the plate, if any. */
  transmissionRiser?: number;
};

export type OfficialKartAssemblyConfig = {
  /** Lower-arm length from hinge pin to hub, in plan. */
  armLength: number;
  axleCenterZ?: number;
  chassis: OfficialKartChassisLayout;
  /**
   * How far the front shocks sit ahead of the axle, on the arms, so the tie
   * rods behind them pass clear at full lock.
   */
  frontShockLead?: number;
  kartId: string;
  motionRatio: number;
  name: string;
  practicalDescriptor: string;
  suspensionComponentPosition: "shock-midpoint" | "spring-arm";
  suspensionDefinitionId:
    | "suspension.compliant-long"
    | "suspension.firm-short";
  suspensionDefinitionVersion: 2 | 3;
  /** Shock compression at rest, metres. */
  suspensionRestCompression: number;
  trackWidth: number;
  transmissionDefinitionId:
    | "transmission.balanced-5to1"
    | "transmission.short-8to1"
    | "transmission.tall-4to1";
  visualIdentity: {
    accentColor: `#${string}`;
    primaryColor: `#${string}`;
  };
  wheelDefinitionId:
    | "wheel-tire.large-standard"
    | "wheel-tire.small-standard";
  wheelbase: number;
};

const definition = (id: string, version = 1) => ({ id, version });
const transform = (x: number, y: number, z: number) => ({
  position: { x, y, z },
  rotationDegrees: { ...ZERO_ROTATION },
});

type ComponentInstance = KartAssemblyDocument["componentInstances"][number];

function component(
  config: OfficialKartAssemblyConfig,
  id: string,
  definitionId: string,
  x: number,
  y: number,
  z: number,
  mirrorOf: string | null = null,
  suspensionMount: ComponentInstance["suspensionMount"] = null,
  definitionVersion = 1,
  yawDegrees = 0,
): ComponentInstance {
  return {
    definition: definition(definitionId, definitionVersion),
    id,
    kind: "component",
    mirrorOf,
    suspensionMount,
    transform: {
      position: { x, y, z },
      rotationDegrees: { ...ZERO_ROTATION, y: yawDegrees },
    },
    visualColor: defaultKartComponentVisualColor(
      definitionId,
      config.visualIdentity,
    ),
  };
}

function createSuspensionInstance(
  config: OfficialKartAssemblyConfig,
  id: string,
  side: "left" | "right",
  axleZ: number,
  mirrorOf: string | null,
  suspensionRestShockLength: number,
  wheelRadius: number,
  shockZ = axleZ,
) {
  const sign = side === "left" ? -1 : 1;
  const hubX = sign * (config.trackWidth / 2);
  const armPivotX = sign * (config.trackWidth / 2 - config.armLength);
  // The shock's arm eye sits the motion ratio's share of the arm out from the
  // pivot line's midpoint, ahead of the axle when the shock is.
  const springLever = config.armLength * config.motionRatio;
  if (Math.abs(shockZ - axleZ) >= springLever) {
    throw new Error("A shock can't sit that far off its arm's axle line.");
  }
  const springX =
    armPivotX + sign * Math.sqrt(springLever ** 2 - (shockZ - axleZ) ** 2);
  // The arm is level, so its eye moves straight up: the shock leans inward at
  // its coilover's rated 30° installation to its top eye on the tower, across
  // the kart at `shockZ`.
  const chassisAnchorY =
    wheelRadius +
    suspensionRestShockLength * Math.cos(RATED_SHOCK_INSTALLATION_RADIANS);
  const chassisAnchorX =
    springX -
    sign *
      Math.sqrt(
        suspensionRestShockLength ** 2 - (chassisAnchorY - wheelRadius) ** 2,
      );
  const componentX =
    config.suspensionComponentPosition === "shock-midpoint"
      ? (springX + chassisAnchorX) / 2
      : springX;
  return component(
    config,
    id,
    config.suspensionDefinitionId,
    componentX,
    (wheelRadius + chassisAnchorY) / 2,
    shockZ,
    mirrorOf,
    {
      armPivot: { x: armPivotX, y: wheelRadius, z: axleZ },
      chassisAnchor: { x: chassisAnchorX, y: chassisAnchorY, z: shockZ },
      hubAnchor: { x: hubX, y: wheelRadius, z: axleZ },
      springArmAnchor: { x: springX, y: wheelRadius, z: shockZ },
    },
    config.suspensionDefinitionVersion,
  );
}

function connection(
  id: string,
  fromInstance: string,
  fromPort: string,
  toInstance: string,
  toPort: string,
) {
  return {
    from: { instanceId: fromInstance, portId: fromPort },
    id,
    to: { instanceId: toInstance, portId: toPort },
  };
}

const relativeTo = (point: Vector, origin: Vector): Vector => ({
  x: point.x - origin.x,
  y: point.y - origin.y,
  z: point.z - origin.z,
});

type PrimitiveInstance = KartAssemblyDocument["primitiveInstances"][number];

function getMountPoint(
  definitionId: string,
  mountId: string,
): Vector {
  const mount = getApprovedKartComponent(
    definition(definitionId, PART_VERSION),
  )?.mounts?.find(({ id }) => id === mountId);
  if (!mount) {
    throw new Error(`${definitionId} has no ${mountId} mounting point.`);
  }
  return mount.position;
}

/** A placed part's mounting point, in assembly space. */
function getMount(instance: ComponentInstance, mountId: string): Vector {
  return addVector(
    instance.transform.position,
    transformVector(
      rotationMatrix(instance.transform.rotationDegrees),
      getMountPoint(instance.definition.id, mountId),
    ),
  );
}

/** Where a part goes so that its mounting point lands on `at`. */
function placeBy(
  definitionId: string,
  mountId: string,
  at: Vector,
  yawDegrees = 0,
): Vector {
  return subtractVector(
    at,
    transformVector(
      rotationMatrix({ ...ZERO_ROTATION, y: yawDegrees }),
      getMountPoint(definitionId, mountId),
    ),
  );
}

function createChassis(
  config: OfficialKartAssemblyConfig,
  componentInstances: KartAssemblyDocument["componentInstances"],
  { axleCenterZ, frontZ, rearZ, wheelRadius }: {
    axleCenterZ: number;
    frontZ: number;
    rearZ: number;
    wheelRadius: number;
  },
) {
  const layout = config.chassis;
  // The plate runs far enough to carry the hinge-pin mounts at both axles.
  const plate = {
    ...layout.plate,
    size: {
      ...layout.plate.size,
      z: Math.max(
        layout.plate.size.z,
        config.wheelbase + 2 * ARM_PIVOT_HALF_SPREAD + layout.armMount.z,
      ),
    },
  };
  const plateCenter = {
    x: 0,
    y: plate.bottomY + plate.size.y / 2,
    z: axleCenterZ,
  };
  const plateTopY = plate.bottomY + plate.size.y;
  const suspension = (station: string) =>
    componentInstances.find(({ id }) => id === `suspension-${station}`)!
      .suspensionMount!;
  const identity = config.visualIdentity;
  const box = (
    id: string,
    role: PrimitiveInstance["role"],
    material: string,
    size: Vector,
    position: Vector,
    visualColor: string,
    construction: PrimitiveInstance["construction"] = { mode: "solid" },
    mirrorOf: string | null = null,
  ): PrimitiveInstance => ({
    collision: "solid",
    construction,
    id,
    kind: "primitive",
    material: definition(material),
    mirrorOf,
    role,
    shape: "box",
    size,
    transform: transform(position.x, position.y, position.z),
    visualColor,
  });

  const primitiveInstances: PrimitiveInstance[] = [
    box(
      "chassis-plate",
      "structure",
      plate.material,
      plate.size,
      plateCenter,
      identity.primaryColor,
    ),
  ];
  const positions = new Map<string, Vector>([["chassis-plate", plateCenter]]);
  const attachments: KartAssemblyDocument["structuralAttachments"] = [];
  // `child`'s mount `childMount` meets `parent`'s `parentMount` at `at`.
  const attach = (
    [child, childMount]: [string, string],
    [parent, parentMount]: [string, string],
    at: Vector,
  ) => {
    // An anchor is in its instance's own frame.
    const anchor = (id: string) => {
      const primitive = positions.get(id);
      if (primitive) return relativeTo(at, primitive);
      const { position, rotationDegrees } = componentInstances.find(
        (instance) => instance.id === id,
      )!.transform;
      return transformVector(
        transposeMatrix(rotationMatrix(rotationDegrees)),
        relativeTo(at, position),
      );
    };
    attachments.push({
      child: { anchor: anchor(child), instanceId: child, mount: childMount },
      id: `mount-${child}`,
      parent: {
        anchor: anchor(parent),
        instanceId: parent,
        mount: parentMount,
      },
    });
  };
  const add = (primitive: PrimitiveInstance) => {
    primitiveInstances.push(primitive);
    positions.set(primitive.id, primitive.transform.position);
  };

  // Hinge-pin mounts: a block under each leg of each lower arm, so a
  // driveshaft passes between a driven arm's two.
  const mountHeight = wheelRadius + MOUNT_MARGIN - plateTopY;
  for (const [axle, axleZ] of [["front", frontZ], ["rear", rearZ]] as const) {
    const pivot = suspension(`${axle}-left`).armPivot;
    for (const side of ["left", "right"] as const) {
      for (const [leg, sign] of [["front", -1], ["rear", 1]] as const) {
        const id = `arm-mount-${axle}-${side}-${leg}`;
        const center = {
          x: side === "left" ? pivot.x : -pivot.x,
          y: plateTopY + mountHeight / 2,
          z: axleZ + sign * ARM_PIVOT_HALF_SPREAD,
        };
        add(
          box(
            id,
            "structure",
            "material.engineering-polymer",
            { ...layout.armMount, y: mountHeight },
            center,
            COMPOSITE_BLACK,
            { mode: "solid" },
            side === "right" ? `arm-mount-${axle}-left-${leg}` : null,
          ),
        );
        attach([id, "bottom"], ["chassis-plate", "top"], {
          ...center,
          y: plateTopY,
        });
      }
    }
  }

  // Composite shock towers: a narrow post between the hinge-pin mounts, and
  // a crossbar carrying both shock top eyes, high enough that the arms and
  // steered wheels pass under it. The front post stands on the plate, the
  // rear on the gearbox's tower pad.
  const transmission = componentInstances.find(
    ({ id }) => id === "transmission-main",
  )!;
  const towerPad = getMount(transmission, "tower-pad");
  for (const axle of ["front", "rear"] as const) {
    const anchor = suspension(`${axle}-left`).chassisAnchor;
    const top = anchor.y + MOUNT_MARGIN;
    // Low enough to hold the eye, high enough to clear the shock's body.
    const barBottom = anchor.y - SHOCK_EYE_EDGE_DISTANCE;
    const base =
      axle === "front"
        ? { mount: ["chassis-plate", "top"] as [string, string], y: plateTopY }
        : {
            mount: ["transmission-main", "tower-pad"] as [string, string],
            y: towerPad.y,
          };
    const postId = `shock-tower-${axle}`;
    const postCenter = { x: 0, y: (barBottom + base.y) / 2, z: anchor.z };
    add(
      box(
        postId,
        "structure",
        "material.engineering-polymer",
        {
          x: layout.topDeck.size.x + 2 * MOUNT_MARGIN,
          y: barBottom - base.y,
          z: layout.shockTowerThickness,
        },
        postCenter,
        COMPOSITE_BLACK,
      ),
    );
    attach([postId, "bottom"], base.mount, { ...postCenter, y: base.y });
    const barId = `shock-tower-${axle}-bar`;
    const barCenter = { x: 0, y: (top + barBottom) / 2, z: anchor.z };
    add(
      box(
        barId,
        "structure",
        "material.engineering-polymer",
        {
          x: 2 * (Math.abs(anchor.x) + MOUNT_MARGIN),
          y: top - barBottom,
          z: layout.shockTowerThickness,
        },
        barCenter,
        COMPOSITE_BLACK,
      ),
    );
    attach([barId, "bottom"], [postId, "top"], { ...barCenter, y: barBottom });
    for (const side of ["left", "right"] as const) {
      const station = `${axle}-${side}`;
      attach(
        [`suspension-${station}`, "chassis-anchor"],
        [barId, "pin"],
        suspension(station).chassisAnchor,
      );
    }
  }

  // Top deck spans the towers' inner faces.
  const front = positions.get("shock-tower-front")!.z;
  const rear = positions.get("shock-tower-rear")!.z;
  const inset = layout.shockTowerThickness / 2;
  const deckCenter = {
    x: 0,
    y: layout.topDeck.bottomY + layout.topDeck.size.y / 2,
    z: (front + rear) / 2,
  };
  add(
    box(
      "top-deck",
      "structure",
      "material.structural-aluminum",
      { ...layout.topDeck.size, z: rear - front - 2 * inset },
      deckCenter,
      identity.accentColor,
    ),
  );
  attach(["top-deck", "front"], ["shock-tower-front", "rear"], {
    ...deckCenter,
    z: front + inset,
  });

  // Molded bumpers butt against the plate ends.
  for (const [end, sign] of [["front", -1], ["rear", 1]] as const) {
    const edge = plateCenter.z + (sign * plate.size.z) / 2;
    const center = {
      x: 0,
      y: plate.bottomY + layout.bumperSize.y / 2,
      z: edge + (sign * layout.bumperSize.z) / 2,
    };
    const id = `${end}-bumper`;
    add(
      box(
        id,
        "guard",
        "material.engineering-polymer",
        layout.bumperSize,
        center,
        COMPOSITE_BLACK,
        { mode: "shell", thickness: 0.002 },
      ),
    );
    const [inner, outer] = sign < 0 ? ["rear", "front"] : ["front", "rear"];
    attach([id, inner], ["chassis-plate", outer], {
      ...plateCenter,
      z: edge,
    });
  }

  // Equipment rests on the plate by its footprint, the gearbox on its riser
  // if it has one, and the motor bolts to the gearbox's motor plate.
  for (const id of Object.keys(layout.equipment)) {
    const instance = componentInstances.find((part) => part.id === id)!;
    attach([id, "base"], ["chassis-plate", "top"], getMount(instance, "base"));
  }
  const footprint = getMount(transmission, "base");
  if (layout.transmissionRiser) {
    const area = getApprovedKartComponent(transmission.definition)!.mounts!
      .find(({ id }) => id === "base")!.area!;
    const center = {
      ...footprint,
      y: plateTopY + layout.transmissionRiser / 2,
    };
    add(
      box(
        "transmission-riser",
        "structure",
        "material.structural-aluminum",
        { x: area.x, y: layout.transmissionRiser, z: area.z },
        center,
        identity.primaryColor,
      ),
    );
    attach(["transmission-riser", "bottom"], ["chassis-plate", "top"], {
      ...footprint,
      y: plateTopY,
    });
    attach(["transmission-main", "base"], ["transmission-riser", "top"], footprint);
  } else {
    attach(["transmission-main", "base"], ["chassis-plate", "top"], footprint);
  }
  attach(
    ["motor-main", "motor-face"],
    ["transmission-main", "motor-plate"],
    getMount(transmission, "motor-plate"),
  );

  return { primitiveInstances, structuralAttachments: attachments };
}

/**
 * Builds a fresh official kart document from construction inputs. Validation
 * and derivation remain authoritative; resolved runtime values are never
 * authored into the assembly.
 */
export function createOfficialKartAssembly(
  config: OfficialKartAssemblyConfig,
  kartId = config.kartId,
): KartAssemblyDocument {
  const suspensionDefinition = getApprovedKartComponent(
    definition(
      config.suspensionDefinitionId,
      config.suspensionDefinitionVersion,
    ),
  );
  const wheelDefinition = getApprovedKartComponent(
    definition(config.wheelDefinitionId),
  );
  if (
    suspensionDefinition?.category !== "suspension" ||
    wheelDefinition?.category !== "wheel-tire"
  ) {
    throw new Error("Official kart construction references are unavailable.");
  }
  const suspensionRestShockLength =
    suspensionDefinition.suspension.extendedLength -
    config.suspensionRestCompression;
  const wheelRadius = wheelDefinition.wheelTire.radius;
  const axleCenterZ = config.axleCenterZ ?? 0;
  const frontZ = axleCenterZ - config.wheelbase / 2;
  const frontShockZ = frontZ - (config.frontShockLead ?? 0);
  const rearZ = axleCenterZ + config.wheelbase / 2;
  const rearShockZ = rearZ + REAR_TOWER_SETBACK;
  const wheelX = config.trackWidth / 2;
  const plateTopY =
    config.chassis.plate.bottomY + config.chassis.plate.size.y;
  // Each item rests on the plate by its footprint.
  const placed = (
    id: string,
    definitionId: string,
    position: Vector,
    yawDegrees = 0,
  ) =>
    component(
      config,
      id,
      definitionId,
      position.x,
      position.y,
      position.z,
      null,
      null,
      PART_VERSION,
      yawDegrees,
    );
  const equipment = (id: EquipmentId, definitionId: string) => {
    const { x, yawDegrees, z } = config.chassis.equipment[id];
    return placed(
      id,
      definitionId,
      placeBy(definitionId, "base", { x, y: plateTopY, z }, yawDegrees),
      yawDegrees,
    );
  };
  // The gearbox's outputs sit on the rear axle line, and the motor bolts on
  // ahead of it, its shaft pointing across the kart into the gearbox.
  const transmission = placed(
    "transmission-main",
    config.transmissionDefinitionId,
    {
      x: 0,
      y:
        plateTopY +
        (config.chassis.transmissionRiser ?? 0) -
        getMountPoint(config.transmissionDefinitionId, "base").y,
      z: rearZ,
    },
  );
  const motorYawDegrees = 90;
  const motor = placed(
    "motor-main",
    "motor.brushless-standard",
    placeBy(
      "motor.brushless-standard",
      "motor-face",
      getMount(transmission, "motor-plate"),
      motorYawDegrees,
    ),
    motorYawDegrees,
  );

  const componentInstances: KartAssemblyDocument["componentInstances"] = [
    equipment("battery-main", "battery.lipo-standard"),
    equipment("controller-main", "control.receiver-esc-standard"),
    motor,
    equipment("steering-main", "steering.servo-standard"),
    equipment("brakes-main", "brakes.combined-standard"),
    transmission,
    createSuspensionInstance(
      config,
      "suspension-front-left",
      "left",
      frontZ,
      null,
      suspensionRestShockLength,
      wheelRadius,
      frontShockZ,
    ),
    createSuspensionInstance(
      config,
      "suspension-front-right",
      "right",
      frontZ,
      "suspension-front-left",
      suspensionRestShockLength,
      wheelRadius,
      frontShockZ,
    ),
    createSuspensionInstance(
      config,
      "suspension-rear-left",
      "left",
      rearZ,
      null,
      suspensionRestShockLength,
      wheelRadius,
      rearShockZ,
    ),
    createSuspensionInstance(
      config,
      "suspension-rear-right",
      "right",
      rearZ,
      "suspension-rear-left",
      suspensionRestShockLength,
      wheelRadius,
      rearShockZ,
    ),
    component(
      config,
      "wheel-front-left",
      config.wheelDefinitionId,
      -wheelX,
      wheelRadius,
      frontZ,
    ),
    component(
      config,
      "wheel-front-right",
      config.wheelDefinitionId,
      wheelX,
      wheelRadius,
      frontZ,
      "wheel-front-left",
    ),
    component(
      config,
      "wheel-rear-left",
      config.wheelDefinitionId,
      -wheelX,
      wheelRadius,
      rearZ,
    ),
    component(
      config,
      "wheel-rear-right",
      config.wheelDefinitionId,
      wheelX,
      wheelRadius,
      rearZ,
      "wheel-rear-left",
    ),
  ];

  const stations = ["front-left", "front-right", "rear-left", "rear-right"];
  const connections: KartAssemblyDocument["connections"] = [
    connection(
      "power-battery-controller",
      "battery-main",
      "power",
      "controller-main",
      "battery-input",
    ),
    connection(
      "power-controller-motor",
      "controller-main",
      "motor-output",
      "motor-main",
      "power-input",
    ),
    connection(
      "control-controller-steering",
      "controller-main",
      "steering-output",
      "steering-main",
      "control-input",
    ),
    connection(
      "control-controller-brakes",
      "controller-main",
      "brake-output",
      "brakes-main",
      "control-input",
    ),
    connection(
      "drive-motor-transmission",
      "motor-main",
      "shaft-output",
      "transmission-main",
      "shaft-input",
    ),
    ...["rear-left", "rear-right"].map((station) =>
      connection(
        `drive-transmission-${station}`,
        "transmission-main",
        "drive-output",
        `wheel-${station}`,
        "drive-input",
      ),
    ),
    ...["front-left", "front-right"].map((station) =>
      connection(
        `steering-${station}`,
        "steering-main",
        "link-output",
        `wheel-${station}`,
        "steering-input",
      ),
    ),
    ...stations.map((station) =>
      connection(
        `service-brake-${station}`,
        "brakes-main",
        "service-output",
        `wheel-${station}`,
        "service-brake-input",
      ),
    ),
    ...["rear-left", "rear-right"].map((station) =>
      connection(
        `handbrake-${station}`,
        "brakes-main",
        "handbrake-output",
        `wheel-${station}`,
        "handbrake-input",
      ),
    ),
    ...stations.map((station) =>
      connection(
        `link-suspension-${station}`,
        `suspension-${station}`,
        "hub-mount",
        `wheel-${station}`,
        "hub-mount",
      ),
    ),
  ];

  const allInstances = new Map(
    componentInstances.map((instance) => [instance.id, instance]),
  );
  const wheelAttachments: KartAssemblyDocument["structuralAttachments"] =
    stations.map((station) => {
      const wheelInstance = allInstances.get(`wheel-${station}`)!;
      const suspensionInstance = allInstances.get(`suspension-${station}`)!;
      return {
        child: {
          anchor: { x: 0, y: 0, z: 0 },
          instanceId: wheelInstance.id,
          mount: "hub",
        },
        id: `mount-wheel-${station}`,
        parent: {
          anchor: relativeTo(
            wheelInstance.transform.position,
            suspensionInstance.transform.position,
          ),
          instanceId: suspensionInstance.id,
          mount: "hub-anchor",
        },
      };
    });
  const chassis = createChassis(config, componentInstances, {
    axleCenterZ,
    frontZ,
    rearZ,
    wheelRadius,
  });
  return parseKartAssemblyDocument({
    componentInstances,
    connections,
    kartId,
    name: config.name,
    practicalDescriptor: config.practicalDescriptor,
    primitiveInstances: chassis.primitiveInstances,
    schemaVersion: 3,
    structuralAttachments: [
      ...chassis.structuralAttachments,
      ...wheelAttachments,
    ],
    units: { angle: "degrees", length: "meters" },
    visualIdentity: config.visualIdentity,
  });
}

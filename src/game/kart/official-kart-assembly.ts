import {
  defaultKartComponentVisualColor,
  parseKartAssemblyDocument,
  type KartAssemblyDocument,
} from "./kart-assembly-document";
import { getApprovedKartComponent } from "./kart-component-registry";

const ZERO_ROTATION = { x: 0, y: 0, z: 0 } as const;
// Material left around a hinge pin or shock eye, and the molded-black
// composite used for towers and bumpers.
const MOUNT_MARGIN = 0.006;
const COMPOSITE_BLACK = "#1f2328";

type Vector = { x: number; y: number; z: number };

type EquipmentId =
  | "battery-main"
  | "brakes-main"
  | "controller-main"
  | "motor-main"
  | "steering-main"
  | "transmission-main";

type StructuralMaterial =
  | "material.engineering-polymer"
  | "material.structural-aluminum";

/**
 * Open 1:10 RC construction: a machined base plate, a hinge-pin mount at each
 * lower arm, an upright shock tower at each axle, a narrow top deck between
 * the towers, and molded bumpers. Electronics sit on the plate.
 */
export type OfficialKartChassisLayout = {
  armMount: { x: number; z: number };
  bumperSize: Vector;
  equipment: Record<EquipmentId, { x: number; yawDegrees?: number; z: number }>;
  plate: { bottomY: number; material: StructuralMaterial; size: Vector };
  shockTowerThickness: number;
  topDeck: { bottomY: number; size: { x: number; y: number } };
};

export type OfficialKartAssemblyConfig = {
  /** Lower-arm length from hinge pin to hub, in plan. */
  armLength: number;
  axleCenterZ?: number;
  chassis: OfficialKartChassisLayout;
  kartId: string;
  motionRatio: number;
  name: string;
  practicalDescriptor: string;
  /** Shock top eyes: height, and distance from the datum toward each axle. */
  shockTopMount: { y: number; z: number };
  suspensionComponentCenterY: number;
  suspensionComponentPosition: "shock-midpoint" | "spring-arm";
  suspensionDefinitionId:
    | "suspension.compliant-long"
    | "suspension.firm-short";
  suspensionDefinitionVersion?: 1 | 2;
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
) {
  const sign = side === "left" ? -1 : 1;
  const hubX = sign * (config.trackWidth / 2);
  const armPivotX = sign * (config.trackWidth / 2 - config.armLength);
  const springX =
    armPivotX + (hubX - armPivotX) * config.motionRatio;
  const chassisAnchorY = config.shockTopMount.y;
  const chassisAnchorZ = Math.sign(axleZ) * config.shockTopMount.z;
  const chassisAnchorX =
    springX -
    sign *
      Math.sqrt(
        suspensionRestShockLength ** 2 -
          (chassisAnchorY - wheelRadius) ** 2 -
          (chassisAnchorZ - axleZ) ** 2,
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
    config.suspensionComponentCenterY,
    axleZ,
    mirrorOf,
    {
      armPivot: { x: armPivotX, y: wheelRadius, z: axleZ },
      chassisAnchor: {
        x: chassisAnchorX,
        y: chassisAnchorY,
        z: chassisAnchorZ,
      },
      hubAnchor: { x: hubX, y: wheelRadius, z: axleZ },
      springArmAnchor: {
        x: springX,
        y: wheelRadius,
        z: axleZ,
      },
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
  const { plate } = layout;
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
  const attach = (child: string, parent: string, at: Vector) => {
    const childPosition =
      positions.get(child) ??
      componentInstances.find(({ id }) => id === child)!.transform.position;
    attachments.push({
      child: { anchor: relativeTo(at, childPosition), instanceId: child },
      id: `mount-${child}`,
      parent: {
        anchor: relativeTo(at, positions.get(parent)!),
        instanceId: parent,
      },
    });
  };
  const add = (primitive: PrimitiveInstance) => {
    primitiveInstances.push(primitive);
    positions.set(primitive.id, primitive.transform.position);
  };

  // Hinge-pin mounts: one block under each lower-arm pivot.
  const mountHeight = wheelRadius + MOUNT_MARGIN - plateTopY;
  for (const [axle, axleZ] of [["front", frontZ], ["rear", rearZ]] as const) {
    const pivot = suspension(`${axle}-left`).armPivot;
    for (const side of ["left", "right"] as const) {
      const id = `arm-mount-${axle}-${side}`;
      const center = {
        x: side === "left" ? pivot.x : -pivot.x,
        y: plateTopY + mountHeight / 2,
        z: axleZ,
      };
      add(
        box(
          id,
          "structure",
          "material.structural-aluminum",
          { ...layout.armMount, y: mountHeight },
          center,
          identity.accentColor,
          { mode: "solid" },
          side === "right" ? `arm-mount-${axle}-left` : null,
        ),
      );
      attach(id, "chassis-plate", { ...center, y: plateTopY });
    }
  }

  // Composite shock towers stand on the plate and carry each shock's top eye.
  for (const axle of ["front", "rear"] as const) {
    const anchor = suspension(`${axle}-left`).chassisAnchor;
    const top = anchor.y + MOUNT_MARGIN;
    const size = {
      x: 2 * (Math.abs(anchor.x) + MOUNT_MARGIN),
      y: top - plateTopY,
      z: layout.shockTowerThickness,
    };
    const center = { x: 0, y: (top + plateTopY) / 2, z: anchor.z };
    const id = `shock-tower-${axle}`;
    add(
      box(
        id,
        "structure",
        "material.engineering-polymer",
        size,
        center,
        COMPOSITE_BLACK,
      ),
    );
    attach(id, "chassis-plate", { ...center, y: plateTopY });
    for (const side of ["left", "right"] as const) {
      const station = `${axle}-${side}`;
      attach(`suspension-${station}`, id, suspension(station).chassisAnchor);
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
  attach("top-deck", "shock-tower-front", {
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
    attach(id, "chassis-plate", { ...plateCenter, z: edge });
  }

  for (const id of Object.keys(layout.equipment)) {
    const position = componentInstances.find(
      (instance) => instance.id === id,
    )!.transform.position;
    attach(id, "chassis-plate", { ...position, y: plateTopY });
  }

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
  const rearZ = axleCenterZ + config.wheelbase / 2;
  const wheelX = config.trackWidth / 2;
  const plateTopY =
    config.chassis.plate.bottomY + config.chassis.plate.size.y;
  // Each item rests on the plate.
  const equipment = (id: EquipmentId, definitionId: string) => {
    const placement = config.chassis.equipment[id];
    const [construction] = getApprovedKartComponent(definition(definitionId))!
      .construction;
    const halfHeight =
      construction.shape === "box"
        ? construction.size.y / 2
        : construction.axis === "y"
          ? construction.height / 2
          : construction.radius;
    return component(
      config,
      id,
      definitionId,
      placement.x,
      plateTopY + halfHeight,
      placement.z,
      null,
      null,
      1,
      placement.yawDegrees,
    );
  };

  const componentInstances: KartAssemblyDocument["componentInstances"] = [
    equipment("battery-main", "battery.lipo-standard"),
    equipment("controller-main", "control.receiver-esc-standard"),
    equipment("motor-main", "motor.brushless-standard"),
    equipment("steering-main", "steering.servo-standard"),
    equipment("brakes-main", "brakes.combined-standard"),
    equipment("transmission-main", config.transmissionDefinitionId),
    createSuspensionInstance(
      config,
      "suspension-front-left",
      "left",
      frontZ,
      null,
      suspensionRestShockLength,
      wheelRadius,
    ),
    createSuspensionInstance(
      config,
      "suspension-front-right",
      "right",
      frontZ,
      "suspension-front-left",
      suspensionRestShockLength,
      wheelRadius,
    ),
    createSuspensionInstance(
      config,
      "suspension-rear-left",
      "left",
      rearZ,
      null,
      suspensionRestShockLength,
      wheelRadius,
    ),
    createSuspensionInstance(
      config,
      "suspension-rear-right",
      "right",
      rearZ,
      "suspension-rear-left",
      suspensionRestShockLength,
      wheelRadius,
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
        },
        id: `mount-wheel-${station}`,
        parent: {
          anchor: relativeTo(
            wheelInstance.transform.position,
            suspensionInstance.transform.position,
          ),
          instanceId: suspensionInstance.id,
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
    schemaVersion: 2,
    structuralAttachments: [
      ...chassis.structuralAttachments,
      ...wheelAttachments,
    ],
    units: { angle: "degrees", length: "meters" },
    visualIdentity: config.visualIdentity,
  });
}

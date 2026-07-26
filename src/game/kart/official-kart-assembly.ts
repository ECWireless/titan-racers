import {
  defaultKartComponentVisualColor,
  defaultKartPrimitiveVisualColor,
  parseKartAssemblyDocument,
  type KartAssemblyDocument,
} from "./kart-assembly-document";
import { getApprovedKartComponent } from "./kart-component-registry";

const ZERO_ROTATION = { x: 0, y: 0, z: 0 } as const;

export type OfficialKartAssemblyConfig = {
  bodyMaterial:
    | "material.engineering-polymer"
    | "material.structural-aluminum";
  bodySize: { x: number; y: number; z: number };
  bumperHeight: number;
  bumperZ: number;
  kartId: string;
  motionRatio: number;
  name: string;
  practicalDescriptor: string;
  suspensionComponentCenterY: number;
  suspensionComponentPosition: "shock-midpoint" | "spring-arm";
  suspensionDefinitionId:
    | "suspension.compliant-long"
    | "suspension.firm-short";
  suspensionRestCompression: number;
  trackWidth: number;
  transmissionDefinitionId:
    | "transmission.balanced-5to1"
    | "transmission.short-8to1"
    | "transmission.tall-4to1";
  upperHousingSize: { x: number; y: number; z: number };
  visualIdentity: {
    accentColor: `#${string}`;
    primaryColor: `#${string}`;
  };
  wheelDefinitionId:
    | "wheel-tire.large-standard"
    | "wheel-tire.small-standard";
  wheelbase: number;
};

const definition = (id: string) => ({ id, version: 1 });
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
): ComponentInstance {
  return {
    definition: definition(definitionId),
    id,
    kind: "component",
    mirrorOf,
    suspensionMount,
    transform: transform(x, y, z),
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
  chassisTopY: number,
  mirrorOf: string | null,
  suspensionRestShockLength: number,
  wheelRadius: number,
) {
  const sign = side === "left" ? -1 : 1;
  const hubX = sign * (config.trackWidth / 2);
  const armPivotX = sign * (config.trackWidth / 2 - 0.08);
  const springX =
    armPivotX + (hubX - armPivotX) * config.motionRatio;
  const chassisAnchorZ = Math.sign(axleZ) * (config.bodySize.z / 2);
  const chassisAnchorX =
    springX -
    sign *
      Math.sqrt(
        suspensionRestShockLength ** 2 -
          (chassisTopY - wheelRadius) ** 2 -
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
        y: chassisTopY,
        z: chassisAnchorZ,
      },
      hubAnchor: { x: hubX, y: wheelRadius, z: axleZ },
      springArmAnchor: {
        x: springX,
        y: wheelRadius,
        z: axleZ,
      },
    },
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
    definition(config.suspensionDefinitionId),
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
  const frontZ = -config.wheelbase / 2;
  const rearZ = config.wheelbase / 2;
  const wheelX = config.trackWidth / 2;
  const chassisY = wheelRadius + 0.025;
  const chassisTopY = chassisY + config.bodySize.y / 2;
  const bumperY = chassisY + 0.047;

  const componentInstances: KartAssemblyDocument["componentInstances"] = [
    component(
      config,
      "battery-main",
      "battery.lipo-standard",
      0,
      chassisY + 0.03,
      0,
    ),
    component(
      config,
      "controller-main",
      "control.receiver-esc-standard",
      0,
      chassisY + 0.035,
      0,
    ),
    component(
      config,
      "motor-main",
      "motor.brushless-standard",
      0,
      chassisY + 0.03,
      0,
    ),
    component(
      config,
      "steering-main",
      "steering.servo-standard",
      0,
      chassisY + 0.03,
      0,
    ),
    component(
      config,
      "brakes-main",
      "brakes.combined-standard",
      0,
      chassisY + 0.025,
      0,
    ),
    component(
      config,
      "transmission-main",
      config.transmissionDefinitionId,
      0,
      chassisY + 0.025,
      0,
    ),
    createSuspensionInstance(
      config,
      "suspension-front-left",
      "left",
      frontZ,
      chassisTopY,
      null,
      suspensionRestShockLength,
      wheelRadius,
    ),
    createSuspensionInstance(
      config,
      "suspension-front-right",
      "right",
      frontZ,
      chassisTopY,
      "suspension-front-left",
      suspensionRestShockLength,
      wheelRadius,
    ),
    createSuspensionInstance(
      config,
      "suspension-rear-left",
      "left",
      rearZ,
      chassisTopY,
      null,
      suspensionRestShockLength,
      wheelRadius,
    ),
    createSuspensionInstance(
      config,
      "suspension-rear-right",
      "right",
      rearZ,
      chassisTopY,
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
  const chassisPosition = { x: 0, y: chassisY, z: 0 };
  const relativePosition = (
    child: { x: number; y: number; z: number },
    parent: { x: number; y: number; z: number },
  ) => ({
    x: child.x - parent.x,
    y: child.y - parent.y,
    z: child.z - parent.z,
  });
  const attachedToChassis = [
    "upper-housing",
    "front-bumper",
    "rear-bumper",
    "battery-main",
    "controller-main",
    "motor-main",
    "steering-main",
    "brakes-main",
    "transmission-main",
    "suspension-front-left",
    "suspension-front-right",
    "suspension-rear-left",
    "suspension-rear-right",
  ];
  const primitivePositions: Record<
    string,
    { x: number; y: number; z: number }
  > = {
    "front-bumper": { x: 0, y: bumperY, z: -config.bumperZ },
    "rear-bumper": { x: 0, y: bumperY, z: config.bumperZ },
    "upper-housing": { x: 0, y: chassisY + 0.0525, z: 0 },
  };
  const primitiveAttachmentAnchors: Record<
    string,
    {
      child: { x: number; y: number; z: number };
      parent: { x: number; y: number; z: number };
    }
  > = {
    "front-bumper": {
      child: { x: 0, y: 0, z: 0 },
      parent: { x: 0, y: 0.047, z: -config.bumperZ },
    },
    "rear-bumper": {
      child: { x: 0, y: 0, z: 0 },
      parent: { x: 0, y: 0.047, z: config.bumperZ },
    },
  };
  const structuralAttachments: KartAssemblyDocument["structuralAttachments"] = [
    ...attachedToChassis.map((childId) => {
      const childPosition =
        primitivePositions[childId] ??
        allInstances.get(childId)!.transform.position;
      const authoredAnchors = primitiveAttachmentAnchors[childId];
      const suspensionAnchor =
        allInstances.get(childId)?.suspensionMount?.chassisAnchor ?? null;
      return {
        child: {
          anchor:
            authoredAnchors?.child ??
            (suspensionAnchor
              ? relativePosition(suspensionAnchor, childPosition)
              : { x: 0, y: 0, z: 0 }),
          instanceId: childId,
        },
        id: `mount-${childId}`,
        parent: {
          anchor:
            authoredAnchors?.parent ??
            relativePosition(
              suspensionAnchor ?? childPosition,
              chassisPosition,
            ),
          instanceId: "chassis-plate",
        },
      };
    }),
    ...stations.map((station) => {
      const wheelInstance = allInstances.get(`wheel-${station}`)!;
      const suspensionInstance = allInstances.get(`suspension-${station}`)!;
      return {
        child: {
          anchor: { x: 0, y: 0, z: 0 },
          instanceId: wheelInstance.id,
        },
        id: `mount-wheel-${station}`,
        parent: {
          anchor: relativePosition(
            wheelInstance.transform.position,
            suspensionInstance.transform.position,
          ),
          instanceId: suspensionInstance.id,
        },
      };
    }),
  ];

  return parseKartAssemblyDocument({
    componentInstances,
    connections,
    kartId,
    name: config.name,
    practicalDescriptor: config.practicalDescriptor,
    primitiveInstances: [
      {
        collision: "solid",
        construction: { mode: "shell", thickness: 0.0005 },
        id: "chassis-plate",
        kind: "primitive",
        material: definition(config.bodyMaterial),
        mirrorOf: null,
        role: "structure",
        shape: "box",
        size: config.bodySize,
        transform: transform(0, chassisY, 0),
        visualColor: defaultKartPrimitiveVisualColor(
          "structure",
          config.visualIdentity,
        ),
      },
      {
        axis: "x",
        collision: "none",
        construction: { mode: "shell", thickness: 0.0005 },
        height: config.bumperHeight,
        id: "front-bumper",
        kind: "primitive",
        material: definition("material.engineering-polymer"),
        mirrorOf: null,
        radius: 0.06,
        role: "guard",
        shape: "cylinder",
        transform: transform(0, bumperY, -config.bumperZ),
        visualColor: defaultKartPrimitiveVisualColor(
          "guard",
          config.visualIdentity,
        ),
      },
      {
        axis: "x",
        collision: "none",
        construction: { mode: "shell", thickness: 0.0005 },
        height: config.bumperHeight,
        id: "rear-bumper",
        kind: "primitive",
        material: definition("material.engineering-polymer"),
        mirrorOf: null,
        radius: 0.06,
        role: "guard",
        shape: "cylinder",
        transform: transform(0, bumperY, config.bumperZ),
        visualColor: defaultKartPrimitiveVisualColor(
          "guard",
          config.visualIdentity,
        ),
      },
      {
        collision: "solid",
        construction: { mode: "shell", thickness: 0.0005 },
        id: "upper-housing",
        kind: "primitive",
        material: definition("material.polycarbonate-shell"),
        mirrorOf: null,
        role: "bodywork",
        shape: "box",
        size: config.upperHousingSize,
        transform: transform(0, chassisY + 0.0525, 0),
        visualColor: defaultKartPrimitiveVisualColor(
          "bodywork",
          config.visualIdentity,
        ),
      },
    ],
    schemaVersion: 2,
    structuralAttachments,
    units: { angle: "degrees", length: "meters" },
    visualIdentity: config.visualIdentity,
  });
}

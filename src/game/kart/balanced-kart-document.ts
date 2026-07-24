import {
  parseKartAssemblyDocument,
  type KartAssemblyDocument,
} from "./kart-assembly-document";

export const BALANCED_KART_ID = "balanced-kart";

const ZERO_ROTATION = { x: 0, y: 0, z: 0 } as const;
const BODY_SIZE = { x: 0.29, y: 0.07, z: 0.275 } as const;
const UPPER_HOUSING_SIZE = { x: 0.18, y: 0.105, z: 0.195 } as const;
const TRACK_WIDTH = 0.39;
const WHEELBASE = 0.3;
const WHEEL_RADIUS = 0.058;
const SUSPENSION_CHASSIS_Y = 0.16;
const MOTION_RATIO = Math.sqrt(812.5 / 1_600);

const definition = (id: string) => ({ id, version: 1 });
const transform = (x: number, y: number, z: number) => ({
  position: { x, y, z },
  rotationDegrees: { ...ZERO_ROTATION },
});

type ComponentInstance = KartAssemblyDocument["componentInstances"][number];

function component(
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
  };
}

function createSuspensionInstance(
  id: string,
  side: "left" | "right",
  axleZ: number,
  mirrorOf: string | null,
) {
  const sign = side === "left" ? -1 : 1;
  const hubX = sign * (TRACK_WIDTH / 2);
  const armPivotX = sign * (TRACK_WIDTH / 2 - 0.08);
  const springX = armPivotX + (hubX - armPivotX) * MOTION_RATIO;
  return component(
    id,
    "suspension.firm-short",
    springX,
    (WHEEL_RADIUS + SUSPENSION_CHASSIS_Y) / 2,
    axleZ,
    mirrorOf,
    {
      armPivot: { x: armPivotX, y: WHEEL_RADIUS, z: axleZ },
      chassisAnchor: { x: springX, y: SUSPENSION_CHASSIS_Y, z: axleZ },
      hubAnchor: { x: hubX, y: WHEEL_RADIUS, z: axleZ },
      springArmAnchor: { x: springX, y: WHEEL_RADIUS, z: axleZ },
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
 * Returns a fresh, complete Balanced Kart document suitable for initializing an
 * admin-owned draft. It contains construction inputs only; validation and
 * derivation remain authoritative and no resolved value is copied into it.
 */
export function createBalancedKartDocument(
  kartId = BALANCED_KART_ID,
): KartAssemblyDocument {
  const frontZ = -WHEELBASE / 2;
  const rearZ = WHEELBASE / 2;
  const wheelX = TRACK_WIDTH / 2;
  const chassisY = WHEEL_RADIUS + 0.025;
  const bumperY = chassisY + 0.047;

  const componentInstances: KartAssemblyDocument["componentInstances"] = [
    component("battery-main", "battery.lipo-standard", 0, chassisY + 0.03, 0),
    component(
      "controller-main",
      "control.receiver-esc-standard",
      0,
      chassisY + 0.035,
      0,
    ),
    component("motor-main", "motor.brushless-standard", 0, chassisY + 0.03, 0),
    component(
      "steering-main",
      "steering.servo-standard",
      0,
      chassisY + 0.03,
      0,
    ),
    component(
      "brakes-main",
      "brakes.combined-standard",
      0,
      chassisY + 0.025,
      0,
    ),
    component(
      "transmission-main",
      "transmission.tall-4to1",
      0,
      chassisY + 0.025,
      0,
    ),
    createSuspensionInstance("suspension-front-left", "left", frontZ, null),
    createSuspensionInstance(
      "suspension-front-right",
      "right",
      frontZ,
      "suspension-front-left",
    ),
    createSuspensionInstance("suspension-rear-left", "left", rearZ, null),
    createSuspensionInstance(
      "suspension-rear-right",
      "right",
      rearZ,
      "suspension-rear-left",
    ),
    component(
      "wheel-front-left",
      "wheel-tire.small-standard",
      -wheelX,
      WHEEL_RADIUS,
      frontZ,
    ),
    component(
      "wheel-front-right",
      "wheel-tire.small-standard",
      wheelX,
      WHEEL_RADIUS,
      frontZ,
      "wheel-front-left",
    ),
    component(
      "wheel-rear-left",
      "wheel-tire.small-standard",
      -wheelX,
      WHEEL_RADIUS,
      rearZ,
    ),
    component(
      "wheel-rear-right",
      "wheel-tire.small-standard",
      wheelX,
      WHEEL_RADIUS,
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
    "front-bumper": { x: 0, y: bumperY, z: -0.17 },
    "rear-bumper": { x: 0, y: bumperY, z: 0.17 },
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
      parent: { x: 0, y: 0.047, z: -0.17 },
    },
    "rear-bumper": {
      child: { x: 0, y: 0, z: 0 },
      parent: { x: 0, y: 0.047, z: 0.17 },
    },
  };
  const structuralAttachments: KartAssemblyDocument["structuralAttachments"] = [
    ...attachedToChassis.map((childId) => {
      const childPosition =
        primitivePositions[childId] ??
        allInstances.get(childId)!.transform.position;
      const authoredAnchors = primitiveAttachmentAnchors[childId];
      return {
        child: {
          anchor: authoredAnchors?.child ?? { x: 0, y: 0, z: 0 },
          instanceId: childId,
        },
        id: `mount-${childId}`,
        parent: {
          anchor:
            authoredAnchors?.parent ??
            relativePosition(childPosition, chassisPosition),
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
    name: "Balanced Kart",
    practicalDescriptor:
      "Stable small-wheel setup with predictable steering and balanced speed.",
    primitiveInstances: [
      {
        collision: "solid",
        construction: { mode: "shell", thickness: 0.0005 },
        id: "chassis-plate",
        kind: "primitive",
        material: definition("material.structural-aluminum"),
        mirrorOf: null,
        role: "structure",
        shape: "box",
        size: BODY_SIZE,
        transform: transform(0, chassisY, 0),
      },
      {
        axis: "x",
        collision: "none",
        construction: { mode: "shell", thickness: 0.0005 },
        height: 0.22,
        id: "front-bumper",
        kind: "primitive",
        material: definition("material.structural-aluminum"),
        mirrorOf: null,
        radius: 0.06,
        role: "guard",
        shape: "cylinder",
        transform: transform(0, bumperY, -0.17),
      },
      {
        axis: "x",
        collision: "none",
        construction: { mode: "shell", thickness: 0.0005 },
        height: 0.22,
        id: "rear-bumper",
        kind: "primitive",
        material: definition("material.structural-aluminum"),
        mirrorOf: null,
        radius: 0.06,
        role: "guard",
        shape: "cylinder",
        transform: transform(0, bumperY, 0.17),
      },
      {
        collision: "solid",
        construction: { mode: "shell", thickness: 0.001 },
        id: "upper-housing",
        kind: "primitive",
        material: definition("material.polycarbonate-shell"),
        mirrorOf: null,
        role: "bodywork",
        shape: "box",
        size: UPPER_HOUSING_SIZE,
        transform: transform(0, chassisY + 0.0525, 0),
      },
    ],
    schemaVersion: 1,
    structuralAttachments,
    units: { angle: "degrees", length: "meters" },
    visualIdentity: { accentColor: "#f4b942", primaryColor: "#203040" },
  });
}

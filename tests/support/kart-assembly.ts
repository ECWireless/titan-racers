import type { KartAssemblyDocument } from "../../src/game/kart/kart-assembly-document";

type FixtureOptions = {
  bodyMaterial?: "material.engineering-polymer" | "material.structural-aluminum";
  bodySize?: { x: number; y: number; z: number };
  kartId?: string;
  motionRatio?: number;
  suspension?: "suspension.compliant-long" | "suspension.firm-short";
  trackWidth?: number;
  transmission?: "transmission.short-8to1" | "transmission.tall-4to1";
  wheel?: "wheel-tire.large-standard" | "wheel-tire.small-standard";
  wheelbase?: number;
};

const zeroRotation = { x: 0, y: 0, z: 0 };
const definition = (id: string) => ({ id, version: 1 });
const transform = (x: number, y: number, z: number) => ({
  position: { x, y, z },
  rotationDegrees: { ...zeroRotation },
});

export function createValidKartAssembly(
  options: FixtureOptions = {},
): KartAssemblyDocument {
  const bodyMaterial = options.bodyMaterial ?? "material.structural-aluminum";
  const bodySize = options.bodySize ?? { x: 0.316, y: 0.03, z: 0.4 };
  const kartId = options.kartId ?? "balanced-fixture";
  const motionRatio = options.motionRatio ?? Math.sqrt(812.5 / 1_600);
  const suspension = options.suspension ?? "suspension.firm-short";
  const trackWidth = options.trackWidth ?? 0.39;
  const transmission = options.transmission ?? "transmission.tall-4to1";
  const wheel = options.wheel ?? "wheel-tire.small-standard";
  const wheelbase = options.wheelbase ?? 0.3;
  const wheelRadius = wheel === "wheel-tire.large-standard" ? 0.0725 : 0.058;
  const frontZ = -wheelbase / 2;
  const rearZ = wheelbase / 2;
  const wheelX = trackWidth / 2;
  const chassisY = wheelRadius + 0.025;

  const component = (
    id: string,
    definitionId: string,
    x: number,
    y: number,
    z: number,
    mirrorOf: string | null = null,
    suspensionMount: KartAssemblyDocument["componentInstances"][number]["suspensionMount"] = null,
  ): KartAssemblyDocument["componentInstances"][number] => ({
    definition: definition(definitionId),
    id,
    kind: "component",
    mirrorOf,
    suspensionMount,
    transform: transform(x, y, z),
  });

  const suspensionInstance = (
    id: string,
    side: "left" | "right",
    axleZ: number,
    mirrorOf: string | null,
  ) => {
    const sign = side === "left" ? -1 : 1;
    const hubX = sign * wheelX;
    const armPivotX = sign * (wheelX - 0.08);
    const springX = armPivotX + (hubX - armPivotX) * motionRatio;
    const springY = wheelRadius;
    return component(
      id,
      suspension,
      springX,
      (springY + 0.16) / 2,
      axleZ,
      mirrorOf,
      {
        armPivot: { x: armPivotX, y: wheelRadius, z: axleZ },
        chassisAnchor: { x: springX, y: 0.16, z: axleZ },
        hubAnchor: { x: hubX, y: wheelRadius, z: axleZ },
        springArmAnchor: { x: springX, y: springY, z: axleZ },
      },
    );
  };

  const componentInstances: KartAssemblyDocument["componentInstances"] = [
    component("battery-main", "battery.lipo-standard", 0, chassisY + 0.03, 0.03),
    component(
      "controller-main",
      "control.receiver-esc-standard",
      0,
      chassisY + 0.035,
      -0.045,
    ),
    component("motor-main", "motor.brushless-standard", 0, chassisY + 0.03, 0.1),
    component("steering-main", "steering.servo-standard", 0, chassisY + 0.03, frontZ),
    component("brakes-main", "brakes.combined-standard", 0, chassisY + 0.025, 0),
    component("transmission-main", transmission, 0, chassisY + 0.025, rearZ),
    suspensionInstance("suspension-front-left", "left", frontZ, null),
    suspensionInstance(
      "suspension-front-right",
      "right",
      frontZ,
      "suspension-front-left",
    ),
    suspensionInstance("suspension-rear-left", "left", rearZ, null),
    suspensionInstance(
      "suspension-rear-right",
      "right",
      rearZ,
      "suspension-rear-left",
    ),
    component("wheel-front-left", wheel, -wheelX, wheelRadius, frontZ),
    component(
      "wheel-front-right",
      wheel,
      wheelX,
      wheelRadius,
      frontZ,
      "wheel-front-left",
    ),
    component("wheel-rear-left", wheel, -wheelX, wheelRadius, rearZ),
    component(
      "wheel-rear-right",
      wheel,
      wheelX,
      wheelRadius,
      rearZ,
      "wheel-rear-left",
    ),
  ];

  const connect = (
    id: string,
    fromInstance: string,
    fromPort: string,
    toInstance: string,
    toPort: string,
  ) => ({
    from: { instanceId: fromInstance, portId: fromPort },
    id,
    to: { instanceId: toInstance, portId: toPort },
  });

  const connections: KartAssemblyDocument["connections"] = [
    connect("power-battery-controller", "battery-main", "power", "controller-main", "battery-input"),
    connect("power-controller-motor", "controller-main", "motor-output", "motor-main", "power-input"),
    connect("control-controller-steering", "controller-main", "steering-output", "steering-main", "control-input"),
    connect("control-controller-brakes", "controller-main", "brake-output", "brakes-main", "control-input"),
    connect("drive-motor-transmission", "motor-main", "shaft-output", "transmission-main", "shaft-input"),
    ...["rear-left", "rear-right"].map((station) =>
      connect(
        `drive-transmission-${station}`,
        "transmission-main",
        "drive-output",
        `wheel-${station}`,
        "drive-input",
      ),
    ),
    ...["front-left", "front-right"].map((station) =>
      connect(
        `steering-${station}`,
        "steering-main",
        "link-output",
        `wheel-${station}`,
        "steering-input",
      ),
    ),
    ...["front-left", "front-right", "rear-left", "rear-right"].map(
      (station) =>
        connect(
          `service-brake-${station}`,
          "brakes-main",
          "service-output",
          `wheel-${station}`,
          "service-brake-input",
        ),
    ),
    ...["rear-left", "rear-right"].map((station) =>
      connect(
        `handbrake-${station}`,
        "brakes-main",
        "handbrake-output",
        `wheel-${station}`,
        "handbrake-input",
      ),
    ),
    ...["front-left", "front-right", "rear-left", "rear-right"].map(
      (station) =>
        connect(
          `link-suspension-${station}`,
          `suspension-${station}`,
          "hub-mount",
          `wheel-${station}`,
          "hub-mount",
        ),
    ),
  ];

  const attachedToChassis = [
    "upper-housing",
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
  const structuralAttachments: KartAssemblyDocument["structuralAttachments"] = [
    ...attachedToChassis.map((childId) => {
      const childPosition =
        childId === "upper-housing"
          ? { x: 0, y: chassisY + 0.0525, z: 0.025 }
          : allInstances.get(childId)!.transform.position;
      return {
        child: { anchor: { x: 0, y: 0, z: 0 }, instanceId: childId },
        id: `mount-${childId}`,
        parent: {
          anchor: relativePosition(childPosition, chassisPosition),
          instanceId: "chassis-plate",
        },
      };
    }),
    ...["front-left", "front-right", "rear-left", "rear-right"].map(
      (station) => {
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
      },
    ),
  ];

  return {
    componentInstances,
    connections,
    kartId,
    name: "Assembly fixture",
    practicalDescriptor: "A deterministic complete kart assembly fixture.",
    primitiveInstances: [
      {
        collision: "solid",
        construction: { mode: "shell", thickness: 0.0005 },
        id: "chassis-plate",
        kind: "primitive",
        material: definition(bodyMaterial),
        mirrorOf: null,
        role: "structure",
        shape: "box",
        size: bodySize,
        transform: transform(0, chassisY, 0),
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
        size: { x: bodySize.x * 0.68, y: 0.075, z: bodySize.z * 0.45 },
        transform: transform(0, chassisY + 0.0525, 0.025),
      },
    ],
    schemaVersion: 1,
    structuralAttachments,
    units: { angle: "degrees", length: "meters" },
    visualIdentity: { accentColor: "#f4b942", primaryColor: "#203040" },
  };
}

export function createPredictedKartAssemblies() {
  return {
    balanced: createValidKartAssembly(),
    handling: createValidKartAssembly({
      bodyMaterial: "material.engineering-polymer",
      bodySize: { x: 0.3, y: 0.028, z: 0.36 },
      kartId: "handling-fixture",
      motionRatio: 0.8,
      suspension: "suspension.compliant-long",
      trackWidth: 0.42,
      transmission: "transmission.short-8to1",
      wheelbase: 0.26,
    }),
    speed: createValidKartAssembly({
      bodySize: { x: 0.28, y: 0.025, z: 0.45 },
      kartId: "speed-fixture",
      motionRatio: 0.85,
      trackWidth: 0.36,
      wheel: "wheel-tire.large-standard",
      wheelbase: 0.34,
    }),
  };
}

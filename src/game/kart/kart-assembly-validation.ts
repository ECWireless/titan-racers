import { z } from "zod";

import {
  type KartAssemblyComponentInstance,
  type KartAssemblyDocument,
  kartAssemblyDocumentSchema,
} from "./kart-assembly-document";
import {
  type ApprovedComponentDefinition,
  getApprovedKartComponent,
  type KartComponentCategory,
} from "./kart-component-registry";
import { getApprovedConstructionMaterial } from "./kart-material-registry";
import {
  addVector,
  buildComponentMassElements,
  buildPrimitiveMassElement,
  combineBounds,
  rotationMatrix,
  transformVector,
  type KartBounds,
} from "./kart-construction-geometry";

const MAXIMUM_ATTACHMENT_REACH_METERS = 0.075;

export type KartAssemblyValidationIssue = {
  code: string;
  message: string;
  path: (string | number)[];
};

export type ValidatedKartAssembly = {
  components: Map<
    string,
    {
      definition: Readonly<ApprovedComponentDefinition>;
      instance: KartAssemblyComponentInstance;
      index: number;
    }
  >;
  document: KartAssemblyDocument;
};

export type KartAssemblyValidationResult =
  | { issues: KartAssemblyValidationIssue[]; success: false }
  | { assembly: ValidatedKartAssembly; success: true };

export class KartAssemblyValidationError extends Error {
  readonly issues: KartAssemblyValidationIssue[];

  constructor(issues: KartAssemblyValidationIssue[]) {
    super("Kart assembly validation failed.");
    this.name = "KartAssemblyValidationError";
    this.issues = issues;
  }
}

function issue(
  issues: KartAssemblyValidationIssue[],
  code: string,
  message: string,
  path: (string | number)[],
) {
  issues.push({ code, message, path });
}

function registryKey(reference: { id: string; version: number }) {
  return `${reference.id}@${reference.version}`;
}

function distance(
  left: { x: number; y: number; z: number },
  right: { x: number; y: number; z: number },
) {
  return Math.hypot(left.x - right.x, left.y - right.y, left.z - right.z);
}

function expandedBounds(bounds: KartBounds): KartBounds {
  return {
    maximum: {
      x: bounds.maximum.x + MAXIMUM_ATTACHMENT_REACH_METERS,
      y: bounds.maximum.y + MAXIMUM_ATTACHMENT_REACH_METERS,
      z: bounds.maximum.z + MAXIMUM_ATTACHMENT_REACH_METERS,
    },
    minimum: {
      x: bounds.minimum.x - MAXIMUM_ATTACHMENT_REACH_METERS,
      y: bounds.minimum.y - MAXIMUM_ATTACHMENT_REACH_METERS,
      z: bounds.minimum.z - MAXIMUM_ATTACHMENT_REACH_METERS,
    },
  };
}

function pointWithinBounds(
  point: { x: number; y: number; z: number },
  bounds: KartBounds,
) {
  return (
    point.x >= bounds.minimum.x &&
    point.x <= bounds.maximum.x &&
    point.y >= bounds.minimum.y &&
    point.y <= bounds.maximum.y &&
    point.z >= bounds.minimum.z &&
    point.z <= bounds.maximum.z
  );
}

function attachmentEnvelope(
  instance:
    | KartAssemblyDocument["componentInstances"][number]
    | KartAssemblyDocument["primitiveInstances"][number],
  components: ValidatedKartAssembly["components"],
) {
  if (instance.kind === "primitive") {
    if (!getApprovedConstructionMaterial(instance.material)) return null;
    return expandedBounds(buildPrimitiveMassElement(instance).bounds);
  }
  const component = components.get(instance.id);
  if (!component) return null;
  return expandedBounds(
    combineBounds(
      buildComponentMassElements(instance, component.definition).map(
        ({ bounds }) => bounds,
      ),
    ),
  );
}

function addSchemaIssues(error: z.ZodError): KartAssemblyValidationIssue[] {
  return error.issues.map((schemaIssue) => ({
    code: "schema",
    message: schemaIssue.message,
    path: schemaIssue.path.map((segment) =>
      typeof segment === "symbol" ? segment.description ?? "symbol" : segment,
    ),
  }));
}

function validateIdentities(
  document: KartAssemblyDocument,
  issues: KartAssemblyValidationIssue[],
) {
  const seen = new Map<string, (string | number)[]>();
  const register = (id: string, path: (string | number)[]) => {
    const previous = seen.get(id);
    if (previous) {
      issue(
        issues,
        "duplicate-id",
        `Stable ID "${id}" was first declared at ${previous.join(".")}.`,
        path,
      );
    } else {
      seen.set(id, path);
    }
  };

  document.componentInstances.forEach((instance, index) =>
    register(instance.id, ["componentInstances", index, "id"]),
  );
  document.primitiveInstances.forEach((instance, index) =>
    register(instance.id, ["primitiveInstances", index, "id"]),
  );
  document.connections.forEach((connection, index) =>
    register(connection.id, ["connections", index, "id"]),
  );
  document.structuralAttachments.forEach((attachment, index) =>
    register(attachment.id, ["structuralAttachments", index, "id"]),
  );
}

function resolveComponents(
  document: KartAssemblyDocument,
  issues: KartAssemblyValidationIssue[],
) {
  const components: ValidatedKartAssembly["components"] = new Map();

  document.componentInstances.forEach((instance, index) => {
    const definition = getApprovedKartComponent(instance.definition);
    if (!definition) {
      issue(
        issues,
        "unknown-component",
        `Unknown approved component ${registryKey(instance.definition)}.`,
        ["componentInstances", index, "definition"],
      );
      return;
    }

    components.set(instance.id, {
      definition: definition as Readonly<ApprovedComponentDefinition>,
      index,
      instance,
    });
  });

  return components;
}

function validateComponentCounts(
  document: KartAssemblyDocument,
  components: ValidatedKartAssembly["components"],
  issues: KartAssemblyValidationIssue[],
) {
  const requiredCounts: Record<KartComponentCategory, number> = {
    battery: 1,
    brakes: 1,
    motor: 1,
    "receiver-speed-controller": 1,
    steering: 1,
    suspension: 4,
    transmission: 1,
    "wheel-tire": 4,
  };

  for (const [category, expected] of Object.entries(requiredCounts) as [
    KartComponentCategory,
    number,
  ][]) {
    const matching = [...components.values()].filter(
      ({ definition }) => definition.category === category,
    );
    if (matching.length !== expected) {
      issue(
        issues,
        "component-count",
        `Category "${category}" requires exactly ${expected} instance${expected === 1 ? "" : "s"}; found ${matching.length}.`,
        ["componentInstances"],
      );
    }

    const countsByDefinition = new Map<string, number>();
    for (const { definition } of matching) {
      const key = registryKey(definition);
      countsByDefinition.set(key, (countsByDefinition.get(key) ?? 0) + 1);
    }
    for (const [key, count] of countsByDefinition) {
      const definition = matching.find(
        ({ definition }) => registryKey(definition) === key,
      )?.definition;
      if (definition && count > definition.assembly.maximumInstances) {
        issue(
          issues,
          "component-instance-limit",
          `${key} permits at most ${definition.assembly.maximumInstances} instances; found ${count}.`,
          ["componentInstances"],
        );
      }
    }
  }

  for (const category of ["suspension", "wheel-tire"] as const) {
    const versions = new Set(
      [...components.values()]
        .filter(({ definition }) => definition.category === category)
        .map(({ definition }) => registryKey(definition)),
    );
    if (versions.size > 1) {
      issue(
        issues,
        "unsupported-mixed-components",
        `The current solver requires one ${category} definition at all four stations.`,
        ["componentInstances"],
      );
    }
  }

  document.componentInstances.forEach((instance, index) => {
    const resolved = components.get(instance.id);
    if (!resolved) return;

    if (resolved.definition.category === "suspension") {
      if (!instance.suspensionMount) {
        issue(
          issues,
          "missing-suspension-mount",
          "Suspension instances require authored mounting geometry.",
          ["componentInstances", index, "suspensionMount"],
        );
      }
    } else if (instance.suspensionMount) {
      issue(
        issues,
        "unexpected-suspension-mount",
        "Only suspension instances may define suspension mounting geometry.",
        ["componentInstances", index, "suspensionMount"],
      );
    }

    if (resolved.definition.category === "wheel-tire") {
      const axleDirection = transformVector(
        rotationMatrix(instance.transform.rotationDegrees),
        { x: 1, y: 0, z: 0 },
      );
      if (
        Math.abs(Math.abs(axleDirection.x) - 1) > 1e-6 ||
        Math.abs(axleDirection.y) > 1e-6 ||
        Math.abs(axleDirection.z) > 1e-6
      ) {
        issue(
          issues,
          "unsupported-wheel-orientation",
          "Wheel axles must remain parallel to the kart X axis.",
          ["componentInstances", index, "transform", "rotationDegrees"],
        );
      }
    }
  });
}

function validateMaterials(
  document: KartAssemblyDocument,
  issues: KartAssemblyValidationIssue[],
) {
  if (!document.primitiveInstances.some(({ collision }) => collision === "solid")) {
    issue(
      issues,
      "missing-collision-geometry",
      "A kart requires at least one solid authored collision primitive.",
      ["primitiveInstances"],
    );
  }

  document.primitiveInstances.forEach((primitive, index) => {
    const material = getApprovedConstructionMaterial(primitive.material);
    if (!material) {
      issue(
        issues,
        "unknown-material",
        `Unknown approved material ${registryKey(primitive.material)}.`,
        ["primitiveInstances", index, "material"],
      );
      return;
    }

    if (
      primitive.role === "bodywork" &&
      material.role !== "bodywork"
    ) {
      issue(
        issues,
        "incompatible-material",
        "Bodywork requires an approved bodywork material.",
        ["primitiveInstances", index, "material"],
      );
    }
    if (
      primitive.role === "structure" &&
      material.role === "bodywork"
    ) {
      issue(
        issues,
        "incompatible-material",
        "Structural primitives cannot use bodywork-only material.",
        ["primitiveInstances", index, "material"],
      );
    }

    if (primitive.construction.mode === "shell") {
      const minimumDimension =
        primitive.shape === "box"
          ? Math.min(primitive.size.x, primitive.size.y, primitive.size.z)
          : Math.min(primitive.radius * 2, primitive.height);
      if (primitive.construction.thickness * 2 >= minimumDimension) {
        issue(
          issues,
          "invalid-shell-thickness",
          "Shell thickness must leave a positive interior volume.",
          ["primitiveInstances", index, "construction", "thickness"],
        );
      }
    }
  });
}

function validateStructuralAttachments(
  document: KartAssemblyDocument,
  components: ValidatedKartAssembly["components"],
  issues: KartAssemblyValidationIssue[],
) {
  const instances = new Map(
    [...document.componentInstances, ...document.primitiveInstances].map(
      (instance) => [instance.id, instance],
    ),
  );
  const parentByChild = new Map<string, string>();

  document.structuralAttachments.forEach((attachment, index) => {
    const path = ["structuralAttachments", index] as (string | number)[];
    for (const endpointName of ["parent", "child"] as const) {
      const endpoint = attachment[endpointName];
      if (!instances.has(endpoint.instanceId)) {
        issue(
          issues,
          "unknown-attachment-instance",
          `Structural attachment references unknown instance "${endpoint.instanceId}".`,
          [...path, endpointName, "instanceId"],
        );
      }
    }
    if (attachment.parent.instanceId === attachment.child.instanceId) {
      issue(
        issues,
        "self-attachment",
        "An instance cannot be structurally attached to itself.",
        [...path, "child", "instanceId"],
      );
    }
    const parent = instances.get(attachment.parent.instanceId);
    const child = instances.get(attachment.child.instanceId);
    if (parent && child) {
      const worldAnchor = (
        instance: typeof parent,
        anchor: { x: number; y: number; z: number },
      ) =>
        addVector(
          instance.transform.position,
          transformVector(
            rotationMatrix(instance.transform.rotationDegrees),
            anchor,
          ),
        );
      const parentAnchor = worldAnchor(parent, attachment.parent.anchor);
      const childAnchor = worldAnchor(child, attachment.child.anchor);
      if (distance(parentAnchor, childAnchor) > 1e-6) {
        issue(
          issues,
          "separated-structural-attachment",
          "Structural attachment anchors must meet in assembly space.",
          path,
        );
      }
      for (const [endpointName, instance, anchor] of [
        ["parent", parent, parentAnchor],
        ["child", child, childAnchor],
      ] as const) {
        const envelope = attachmentEnvelope(instance, components);
        if (envelope && !pointWithinBounds(anchor, envelope)) {
          issue(
            issues,
            "attachment-anchor-outside-envelope",
            `Structural attachment anchors must remain within ${MAXIMUM_ATTACHMENT_REACH_METERS} m of the instance construction envelope.`,
            [...path, endpointName, "anchor"],
          );
        }
      }
    }
    const previousParent = parentByChild.get(attachment.child.instanceId);
    if (previousParent) {
      issue(
        issues,
        "multiple-structural-parents",
        `Instance "${attachment.child.instanceId}" is already attached to "${previousParent}".`,
        [...path, "child", "instanceId"],
      );
    } else {
      parentByChild.set(
        attachment.child.instanceId,
        attachment.parent.instanceId,
      );
    }
  });

  const roots = [...instances.keys()].filter((id) => !parentByChild.has(id));
  if (roots.length !== 1) {
    issue(
      issues,
      "structural-root-count",
      `A kart requires one connected structural root; found ${roots.length}.`,
      ["structuralAttachments"],
    );
  } else {
    const root = instances.get(roots[0]);
    if (!root || root.kind !== "primitive" || root.role !== "structure") {
      issue(
        issues,
        "invalid-structural-root",
        "The structural root must be an authored structural primitive.",
        ["structuralAttachments"],
      );
    }
  }

  for (const instanceId of instances.keys()) {
    const visited = new Set<string>();
    let current: string | undefined = instanceId;
    while (current && parentByChild.has(current)) {
      if (visited.has(current)) {
        issue(
          issues,
          "structural-cycle",
          `Structural attachments contain a cycle through "${current}".`,
          ["structuralAttachments"],
        );
        break;
      }
      visited.add(current);
      current = parentByChild.get(current);
    }
  }
}

function validateMirrors(
  document: KartAssemblyDocument,
  components: ValidatedKartAssembly["components"],
  issues: KartAssemblyValidationIssue[],
) {
  const instances = new Map(
    [...document.componentInstances, ...document.primitiveInstances].map(
      (instance) => [instance.id, instance],
    ),
  );

  [...document.componentInstances, ...document.primitiveInstances].forEach(
    (instance) => {
      if (!instance.mirrorOf) return;
      const mirrored = instances.get(instance.mirrorOf);
      const collection =
        instance.kind === "component"
          ? "componentInstances"
          : "primitiveInstances";
      const index =
        instance.kind === "component"
          ? document.componentInstances.findIndex(({ id }) => id === instance.id)
          : document.primitiveInstances.findIndex(({ id }) => id === instance.id);
      const path = [collection, index, "mirrorOf"];

      if (!mirrored || mirrored.kind !== instance.kind) {
        issue(
          issues,
          "invalid-mirror-reference",
          "Mirror references must identify an instance of the same kind.",
          path,
        );
        return;
      }
      if (mirrored.mirrorOf) {
        issue(
          issues,
          "mirror-chain",
          "A mirrored instance must reference an original, not another mirror.",
          path,
        );
      }
      if (instance.kind === "component") {
        const definition = components.get(instance.id)?.definition;
        if (!definition?.assembly.mirrorable) {
          issue(
            issues,
            "component-not-mirrorable",
            "This approved component cannot be mirrored.",
            path,
          );
        }
        if (
          mirrored.kind !== "component" ||
          registryKey(mirrored.definition) !== registryKey(instance.definition)
        ) {
          issue(
            issues,
            "mirror-definition-mismatch",
            "Mirrored components must reference the same immutable definition.",
            path,
          );
        }
      }
      if (
        Math.abs(instance.transform.position.x + mirrored.transform.position.x) >
          1e-6 ||
        Math.abs(instance.transform.position.y - mirrored.transform.position.y) >
          1e-6 ||
        Math.abs(instance.transform.position.z - mirrored.transform.position.z) >
          1e-6
      ) {
        issue(
          issues,
          "invalid-mirror-transform",
          "Mirrored instance positions must reflect exactly across the kart center plane.",
          path,
        );
      }
    },
  );
}

type ResolvedConnection = {
  from: {
    definition: Readonly<ApprovedComponentDefinition>;
    index: number;
    instance: KartAssemblyComponentInstance;
    port: Readonly<ApprovedComponentDefinition>["ports"][number];
  };
  index: number;
  to: {
    definition: Readonly<ApprovedComponentDefinition>;
    index: number;
    instance: KartAssemblyComponentInstance;
    port: Readonly<ApprovedComponentDefinition>["ports"][number];
  };
};

function validateFunctionalConnections(
  document: KartAssemblyDocument,
  components: ValidatedKartAssembly["components"],
  issues: KartAssemblyValidationIssue[],
) {
  const resolvedConnections: ResolvedConnection[] = [];
  const uses = new Map<string, number>();

  document.connections.forEach((connection, index) => {
    const resolveEndpoint = (endpointName: "from" | "to") => {
      const endpoint = connection[endpointName];
      const component = components.get(endpoint.instanceId);
      if (!component) {
        issue(
          issues,
          "unknown-connection-instance",
          `Connection references unknown component instance "${endpoint.instanceId}".`,
          ["connections", index, endpointName, "instanceId"],
        );
        return null;
      }
      const port = component.definition.ports.find(
        ({ id }) => id === endpoint.portId,
      );
      if (!port) {
        issue(
          issues,
          "unknown-component-port",
          `Component "${endpoint.instanceId}" has no port "${endpoint.portId}".`,
          ["connections", index, endpointName, "portId"],
        );
        return null;
      }
      const key = `${endpoint.instanceId}:${endpoint.portId}`;
      uses.set(key, (uses.get(key) ?? 0) + 1);
      return { ...component, port };
    };

    const from = resolveEndpoint("from");
    const to = resolveEndpoint("to");
    if (!from || !to) return;

    if (from.port.interface !== to.port.interface) {
      issue(
        issues,
        "incompatible-connection",
        `Port interfaces "${from.port.interface}" and "${to.port.interface}" are incompatible.`,
        ["connections", index],
      );
    }
    if (from.port.direction === "input") {
      issue(
        issues,
        "invalid-connection-direction",
        "The from endpoint cannot use an input-only port.",
        ["connections", index, "from", "portId"],
      );
    }
    if (to.port.direction === "output") {
      issue(
        issues,
        "invalid-connection-direction",
        "The to endpoint cannot use an output-only port.",
        ["connections", index, "to", "portId"],
      );
    }
    resolvedConnections.push({ from, index, to });
  });

  for (const { definition, instance, index } of components.values()) {
    for (const port of definition.ports) {
      const count = uses.get(`${instance.id}:${port.id}`) ?? 0;
      if (!port.multiple && count > 1) {
        issue(
          issues,
          "port-multiplicity",
          `Port "${port.id}" accepts only one connection.`,
          ["componentInstances", index, "definition"],
        );
      }
    }
  }

  const connectionsFor = (instanceId: string, interfaceName: string) =>
    resolvedConnections.filter(
      ({ from, to }) =>
        (from.instance.id === instanceId &&
          from.port.interface === interfaceName) ||
        (to.instance.id === instanceId && to.port.interface === interfaceName),
    );

  const exactInterfaceCounts: Partial<
    Record<KartComponentCategory, Record<string, number>>
  > = {
    battery: { "battery-power": 1 },
    brakes: { "brake-control": 1, "service-brake": 4, "wheel-handbrake": 2 },
    motor: { "motor-power": 1, "motor-shaft": 1 },
    "receiver-speed-controller": {
      "battery-power": 1,
      "brake-control": 1,
      "motor-power": 1,
      "steering-control": 1,
    },
    steering: { "steering-control": 1, "steering-link": 2 },
    suspension: { "suspension-hub": 1 },
    transmission: { "motor-shaft": 1, "wheel-drive": 2 },
  };

  for (const { definition, instance, index } of components.values()) {
    const requirements = exactInterfaceCounts[definition.category];
    for (const [interfaceName, expected] of Object.entries(requirements ?? {})) {
      const count = connectionsFor(instance.id, interfaceName).length;
      if (count !== expected) {
        issue(
          issues,
          "functional-connection-count",
          `${definition.label} requires ${expected} "${interfaceName}" connection${expected === 1 ? "" : "s"}; found ${count}.`,
          ["componentInstances", index, "definition"],
        );
      }
    }
  }

  const wheels = [...components.values()].filter(
    ({ definition }) => definition.category === "wheel-tire",
  );
  const stationRoles = wheels.map(({ instance, index }) => ({
    driven: connectionsFor(instance.id, "wheel-drive").length === 1,
    handbraked: connectionsFor(instance.id, "wheel-handbrake").length === 1,
    index,
    instance,
    serviceBraked: connectionsFor(instance.id, "service-brake").length === 1,
    steered: connectionsFor(instance.id, "steering-link").length === 1,
    suspended: connectionsFor(instance.id, "suspension-hub").length === 1,
  }));

  if (stationRoles.filter(({ driven }) => driven).length !== 2) {
    issue(issues, "driven-wheel-count", "Exactly two wheel stations must be driven.", [
      "connections",
    ]);
  }
  if (stationRoles.filter(({ steered }) => steered).length !== 2) {
    issue(issues, "steered-wheel-count", "Exactly two wheel stations must be steered.", [
      "connections",
    ]);
  }
  for (const station of stationRoles) {
    if (!station.serviceBraked || !station.suspended) {
      issue(
        issues,
        "incomplete-wheel-station",
        "Every wheel requires one suspension and one service-brake connection.",
        ["componentInstances", station.index],
      );
    }
    if (station.handbraked !== station.driven) {
      issue(
        issues,
        "handbrake-role-mismatch",
        "Rear handbrake connections must target exactly the driven wheels.",
        ["componentInstances", station.index],
      );
    }
    if (station.driven && station.steered) {
      issue(
        issues,
        "unsupported-wheel-role",
        "The Demo v1 solver does not support a wheel that is both driven and steered.",
        ["componentInstances", station.index],
      );
    }
  }

  const steered = stationRoles.filter(({ steered }) => steered);
  const driven = stationRoles.filter(({ driven }) => driven);
  const axleTrackWidths: number[] = [];
  for (const [label, axle] of [
    ["steered", steered],
    ["driven", driven],
  ] as const) {
    if (axle.length !== 2) continue;
    const [left, right] = axle
      .slice()
      .sort(
        (a, b) => a.instance.transform.position.x - b.instance.transform.position.x,
      );
    if (
      left.instance.transform.position.x >= 0 ||
      right.instance.transform.position.x <= 0
    ) {
      issue(
        issues,
        "invalid-axle-sides",
        `The ${label} axle requires one left and one right wheel.`,
        ["componentInstances"],
      );
    }
    if (
      Math.abs(
        left.instance.transform.position.z - right.instance.transform.position.z,
      ) > 0.01
    ) {
      issue(
        issues,
        "misaligned-axle",
        `The ${label} wheel centers must share an axle within 0.01 m.`,
        ["componentInstances"],
      );
    }
    const trackWidth =
      right.instance.transform.position.x - left.instance.transform.position.x;
    axleTrackWidths.push(trackWidth);
    if (trackWidth < 0.2 || trackWidth > 0.6) {
      issue(
        issues,
        "invalid-track-width",
        `The ${label} track width must be between 0.2 m and 0.6 m.`,
        ["componentInstances"],
      );
    }
    if (
      Math.abs(
        left.instance.transform.position.y - right.instance.transform.position.y,
      ) > 0.01
    ) {
      issue(
        issues,
        "misaligned-wheel-height",
        `The ${label} wheel centers must share a height within 0.01 m.`,
        ["componentInstances"],
      );
    }
  }

  if (
    axleTrackWidths.length === 2 &&
    Math.abs(axleTrackWidths[0] - axleTrackWidths[1]) > 0.01
  ) {
    issue(
      issues,
      "unsupported-track-stagger",
      "The current solver requires front and rear track widths to match within 0.01 m.",
      ["componentInstances"],
    );
  }

  if (
    stationRoles.length === 4 &&
    Math.max(
      ...stationRoles.map(({ instance }) => instance.transform.position.y),
    ) -
      Math.min(
        ...stationRoles.map(({ instance }) => instance.transform.position.y),
      ) >
      0.01
  ) {
    issue(
      issues,
      "unsupported-wheel-height-stagger",
      "The current solver requires all four wheel centers to share a height within 0.01 m.",
      ["componentInstances"],
    );
  }

  if (steered.length === 2 && driven.length === 2) {
    const frontZ =
      steered.reduce(
        (sum, station) => sum + station.instance.transform.position.z,
        0,
      ) / 2;
    const rearZ =
      driven.reduce(
        (sum, station) => sum + station.instance.transform.position.z,
        0,
      ) / 2;
    if (rearZ - frontZ < 0.15 || rearZ - frontZ > 0.6) {
      issue(
        issues,
        "invalid-wheelbase",
        "Wheelbase must be between 0.15 m and 0.6 m with steering at the front.",
        ["componentInstances"],
      );
    }
  }

  const suspensionConnections = resolvedConnections.filter(
    ({ from }) => from.port.interface === "suspension-hub",
  );
  const motionRatios: number[] = [];
  for (const connection of suspensionConnections) {
    const suspension =
      connection.from.definition.category === "suspension"
        ? connection.from
        : connection.to;
    const wheel =
      connection.from.definition.category === "wheel-tire"
        ? connection.from
        : connection.to;
    if (
      suspension.definition.category !== "suspension" ||
      wheel.definition.category !== "wheel-tire"
    ) {
      issue(
        issues,
        "invalid-suspension-connection",
        "Suspension hub connections must join one suspension to one wheel.",
        ["connections", connection.index],
      );
      continue;
    }
    const mount = suspension.instance.suspensionMount;
    if (!mount) continue;
    const suspensionEnvelope = attachmentEnvelope(
      suspension.instance,
      components,
    );
    if (suspensionEnvelope) {
      for (const anchorName of [
        "armPivot",
        "chassisAnchor",
        "hubAnchor",
        "springArmAnchor",
      ] as const) {
        if (!pointWithinBounds(mount[anchorName], suspensionEnvelope)) {
          issue(
            issues,
            "suspension-anchor-outside-envelope",
            `Suspension mounting anchors must remain within ${MAXIMUM_ATTACHMENT_REACH_METERS} m of the installed component construction envelope.`,
            [
              "componentInstances",
              suspension.index,
              "suspensionMount",
              anchorName,
            ],
          );
        }
      }
    }
    if (distance(mount.hubAnchor, wheel.instance.transform.position) > 0.005) {
      issue(
        issues,
        "suspension-hub-mismatch",
        "Suspension hub anchor must match the connected wheel center within 0.005 m.",
        ["componentInstances", suspension.index, "suspensionMount", "hubAnchor"],
      );
    }
    const hubLever = distance(mount.armPivot, mount.hubAnchor);
    const springLever = distance(mount.armPivot, mount.springArmAnchor);
    const motionRatio = hubLever > 0 ? springLever / hubLever : 0;
    motionRatios.push(motionRatio);
    if (motionRatio < 0.4 || motionRatio > 1) {
      issue(
        issues,
        "invalid-suspension-motion-ratio",
        "Suspension geometry must derive a motion ratio between 0.4 and 1.",
        ["componentInstances", suspension.index, "suspensionMount"],
      );
    }
    const shockLength = distance(mount.chassisAnchor, mount.springArmAnchor);
    const suspensionDefinition = suspension.definition;
    if (suspensionDefinition.category === "suspension") {
      const compression =
        suspensionDefinition.suspension.extendedLength - shockLength;
      if (
        compression < -1e-6 ||
        compression - suspensionDefinition.suspension.maximumStroke > 1e-6
      ) {
        issue(
          issues,
          "invalid-suspension-rest-length",
          "Authored suspension anchors must place the unit within its available stroke.",
          ["componentInstances", suspension.index, "suspensionMount"],
        );
      }
    }
  }
  if (
    motionRatios.length === 4 &&
    Math.max(...motionRatios) - Math.min(...motionRatios) > 1e-6
  ) {
    issue(
      issues,
      "unsupported-mixed-suspension-geometry",
      "The current solver requires the same derived motion ratio at all four wheel stations.",
      ["componentInstances"],
    );
  }

  return resolvedConnections;
}

export function validateKartAssembly(input: unknown): KartAssemblyValidationResult {
  const parsed = kartAssemblyDocumentSchema.safeParse(input);
  if (!parsed.success) {
    return { issues: addSchemaIssues(parsed.error), success: false };
  }

  const document = parsed.data;
  const issues: KartAssemblyValidationIssue[] = [];
  validateIdentities(document, issues);
  const components = resolveComponents(document, issues);
  validateComponentCounts(document, components, issues);
  validateMaterials(document, issues);
  validateStructuralAttachments(document, components, issues);
  validateMirrors(document, components, issues);
  validateFunctionalConnections(document, components, issues);

  if (issues.length > 0) return { issues, success: false };
  return { assembly: { components, document }, success: true };
}

export function parseValidatedKartAssembly(input: unknown) {
  const result = validateKartAssembly(input);
  if (!result.success) throw new KartAssemblyValidationError(result.issues);
  return result.assembly;
}

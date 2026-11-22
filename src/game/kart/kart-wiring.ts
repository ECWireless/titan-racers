import type { KartAssemblyDocument } from "./kart-assembly-document";
import { getApprovedKartComponent } from "./kart-component-registry";
import {
  buildComponentMassElements,
  buildPrimitiveMassElement,
  getSuspensionInstallationRatio,
  rotationMatrix,
  transformVector,
  transposeMatrix,
  type KartBounds,
  type KartMatrix3,
  type KartVector,
} from "./kart-construction-geometry";
import {
  findWheelSuspension,
  getDriveshaftEnds,
  getHornBall,
  getKnuckleBall,
  planKartLinkagePoses,
} from "./kart-linkage-poses";
import {
  getConvexShapeBounds,
  type KartConvexShape,
} from "./kart-convex-distance";
import {
  BALL_CUP_RADIUS,
  DOGBONE_BALL_RADIUS,
} from "./kart-linkage-visual-geometry";
import {
  piece,
  type KartPartLead,
  type KartPartVisualPiece,
} from "./kart-part-visual-geometry";
import { getKartPartLeads } from "./kart-part-visuals";

/**
 * Cables drawn from a kart's functional connections: the battery's leads to
 * the controller, and the controller's to the motor, steering servo, and
 * brakes. They lie along what they cross: over a height map of the chassis
 * plate, round the parts resting on it, and clear of the space the tie rods
 * and driveshafts sweep. Presentation only: nothing here feeds derivation or
 * the clearance check.
 */
export type KartCable = {
  color: "red" | "black";
  /** The two parts it joins. */
  parts: readonly [string, string];
  /** A plug housing over each end that plugs in, from its port outward. */
  plugs: { end: KartVector; start: KartVector }[];
  /** The centreline, in assembly axes, from one port to the other. */
  points: KartVector[];
  radius: number;
  sides: number;
};

/** The red of a positive power wire's insulation. */
export const KART_CABLE_RED = "#a8231c";

// 12-gauge silicone power wire, and a three-core servo lead drawn round.
const POWER_WIRE = { radius: 0.00165, sides: 5 };
const SIGNAL_LEAD = { radius: 0.0011, sides: 4 };
const POWER_INTERFACES = new Set(["battery-power", "motor-power"]);
const PLUG = { length: 0.006, radius: 0.0028 };

const CELL = 0.003;
const DIAGONAL = CELL * Math.SQRT2;
// How far the routing grid reaches past the plate, for ports beyond its edge.
const MARGIN = 0.024;
// A part whose bottom is within this of the plate rests on it; one higher
// up is a ceiling a cable may pass under.
const RESTING = 0.004;
// A cable stepping down off a part hangs, falling at most this many times
// as far as it runs; where a hang meets something overhead, the bundle is
// routed again round it, this many times at most.
const HANG_DROP = 4;
const REROUTES = 4;
// A run off the plate costs more, and climbing or dropping costs this much
// per metre against one per metre run, so cables keep to the plate and go
// round parts rather than over them.
const OFF_PLATE_COST = 2.5;
const CLIMB_COST = 5;
// Kept between a cable and a linkage's swept space, or a part's side.
const LINKAGE_CLEARANCE = 0.0015;
const SIDE_CLEARANCE = 0.001;
// A suspension drawn this far from working (a detached shock turned on its
// side) sweeps nothing: its wheel is taken at rest.
const MINIMUM_INSTALLATION_RATIO = 0.05;
const MAXIMUM_WHEEL_TRAVEL = 0.1;
// How far a lead runs from its port before it may turn, and how far along
// the bundle each wire joins its lane.
const STUB = 0.005;
const LANE_JOIN = 0.022;

type End = { direction: KartVector; plug: boolean; position: KartVector };
type Bundle = {
  colors: KartCable["color"][];
  from: End[];
  /** Wires that may swap lanes, as a brushless motor's three phases may. */
  interchangeable: boolean;
  parts: [string, string];
  to: End[];
  wire: { radius: number; sides: number };
};
type Grid = {
  blocked: Uint8Array;
  /** The lowest anything overhead comes down to, clearance included. */
  ceiling: Float64Array;
  floor: Float64Array;
  /** The top of any cable already laid over each cell. */
  laidTop: Float64Array;
  /** The lowest any linkage sweeps over each cell, clearance included. */
  linkageLow: Float64Array;
  nx: number;
  nz: number;
  offPlate: Uint8Array;
  x0: number;
  z0: number;
};

/**
 * Routing runs in the plate's own axes, its centre at the origin and its
 * top face up; the cables are turned back into the kart's axes.
 */
type PlateFrame = {
  toLocal: (point: KartVector) => KartVector;
  toLocalDirection: (direction: KartVector) => KartVector;
  toWorld: (point: KartVector) => KartVector;
};

export function planKartCables(document: KartAssemblyDocument): KartCable[] {
  const plate = findPlate(document);
  if (!plate) return [];
  const frame = plateFrame(plate.center, plate.rotation);
  const bundles = planBundles(document, frame);
  if (bundles.length === 0) return [];
  const { half: plateHalf } = plate;
  const top = plateHalf.y;
  const solids = listSolids(document, plate.id, frame);
  const sweeps = sampleLinkageSweeps(document).map(({ point, radius }) => ({
    point: frame.toLocal(point),
    radius,
  }));
  const nx = Math.ceil((2 * (plateHalf.x + MARGIN)) / CELL);
  const nz = Math.ceil((2 * (plateHalf.z + MARGIN)) / CELL);
  const x0 = -plateHalf.x - MARGIN;
  const z0 = -plateHalf.z - MARGIN;
  const offPlate = new Uint8Array(nx * nz);
  for (let k = 0; k < nz; k++) {
    for (let i = 0; i < nx; i++) {
      const x = x0 + (i + 0.5) * CELL;
      const z = z0 + (k + 0.5) * CELL;
      offPlate[i + k * nx] =
        Math.abs(x) > plateHalf.x || Math.abs(z) > plateHalf.z ? 1 : 0;
    }
  }
  const grid: Grid = {
    blocked: new Uint8Array(nx * nz),
    ceiling: new Float64Array(nx * nz),
    floor: new Float64Array(nx * nz),
    laidTop: new Float64Array(nx * nz),
    linkageLow: new Float64Array(nx * nz).fill(Infinity),
    nx,
    nz,
    offPlate,
    x0,
    z0,
  };
  // Swept once, as wide as the widest bundle needs.
  const widest = Math.max(
    ...bundles.map(({ from, wire }) => from.length * wire.radius),
  );
  for (const { point, radius } of sweeps) {
    const low = point.y - radius - LINKAGE_CLEARANCE;
    paint(grid, point, point, radius + widest + LINKAGE_CLEARANCE, (cell) => {
      grid.linkageLow[cell] = Math.min(grid.linkageLow[cell], low);
    });
  }
  const laid: Laid[] = [];
  const cables: KartCable[] = [];
  for (const bundle of bundles) {
    const { radius } = bundle.wire;
    const startStubs = bundle.from.map((end) => stub(end));
    const endStubs = bundle.to.map((end) => stub(end));
    const start = mean(startStubs);
    const end = mean(endStubs);
    const open = paintGrid(grid, top, solids, laid, bundle, [start, end]);
    let path = routeBundle(grid, start, end, radius, open);
    // A hang off a taller part stands above the floor it crosses; where
    // that meets something overhead, close those cells and route again,
    // keeping the last route found.
    for (let attempt = 0; path && attempt < REROUTES; attempt++) {
      let struck = false;
      for (const point of path) {
        const [i, k] = cellOf(grid, point.x, point.z);
        const cell = i + k * grid.nx;
        if (point.y + radius > grid.ceiling[cell] && !open.has(cell) && !grid.blocked[cell]) {
          paint(grid, point, point, CELL, (near) => {
            if (!open.has(near)) grid.blocked[near] = 1;
          });
          struck = true;
        }
      }
      if (!struck) break;
      path = routeBundle(grid, start, end, radius, open) ?? path;
    }
    if (!path) continue;
    for (const cable of layWires(bundle, path, startStubs, endStubs)) {
      // Curving out of a port, a wire never dips into the plate or under a
      // cable already laid; its ends stay on their ports.
      for (const point of cable.points.slice(1, -1)) {
        const [i, k] = cellOf(grid, point.x, point.z);
        point.y = Math.max(point.y, top + radius, grid.laidTop[i + k * grid.nx] + radius);
      }
      laid.push({ points: cable.points, radius });
      cables.push({
        ...cable,
        plugs: cable.plugs.map(({ end, start }) => ({
          end: frame.toWorld(end),
          start: frame.toWorld(start),
        })),
        points: cable.points.map(frame.toWorld),
      });
    }
  }
  return cables;
}

function plateFrame(center: KartVector, rotation: KartMatrix3): PlateFrame {
  const inverse = transposeMatrix(rotation);
  return {
    toLocal: (point) =>
      transformVector(inverse, {
        x: point.x - center.x,
        y: point.y - center.y,
        z: point.z - center.z,
      }),
    toLocalDirection: (direction) => transformVector(inverse, direction),
    toWorld: (point) => {
      const turned = transformVector(rotation, point);
      return {
        x: turned.x + center.x,
        y: turned.y + center.y,
        z: turned.z + center.z,
      };
    },
  };
}

/** The structural root: the box that hangs from nothing. */
function findPlate(document: KartAssemblyDocument) {
  const children = new Set(
    document.structuralAttachments.map(({ child }) => child.instanceId),
  );
  const plate = document.primitiveInstances.find(
    ({ id, shape }) => shape === "box" && !children.has(id),
  );
  if (plate?.shape !== "box") return null;
  return {
    center: plate.transform.position,
    half: { x: plate.size.x / 2, y: plate.size.y / 2, z: plate.size.z / 2 },
    id: plate.id,
    rotation: rotationMatrix(plate.transform.rotationDegrees),
  };
}

/** Each wired connection whose two ends both say where their wires leave. */
function planBundles(document: KartAssemblyDocument, frame: PlateFrame): Bundle[] {
  const instances = new Map(
    document.componentInstances.map((instance) => [instance.id, instance]),
  );
  const leadsOf = (endpoint: { instanceId: string; portId: string }) => {
    const instance = instances.get(endpoint.instanceId);
    if (!instance) return null;
    const leads = getKartPartLeads(instance.definition)?.[endpoint.portId];
    if (!leads?.length) return null;
    const rotation = rotationMatrix(instance.transform.rotationDegrees);
    const place = (lead: KartPartLead): End => {
      const [x, y, z] = lead.position;
      const [dx, dy, dz] = lead.direction;
      const offset = transformVector(rotation, { x, y, z });
      const { position } = instance.transform;
      return {
        direction: frame.toLocalDirection(
          transformVector(rotation, { x: dx, y: dy, z: dz }),
        ),
        plug: lead.plug === true,
        position: frame.toLocal({
          x: position.x + offset.x,
          y: position.y + offset.y,
          z: position.z + offset.z,
        }),
      };
    };
    const port = getApprovedKartComponent(instance.definition)?.ports.find(
      ({ id }) => id === endpoint.portId,
    );
    return { ends: leads.map(place), interface: port?.interface };
  };
  const bundles: Bundle[] = [];
  for (const { from, to } of document.connections) {
    const start = leadsOf(from);
    const end = leadsOf(to);
    if (!start || !end || start.ends.length !== end.ends.length) continue;
    const count = start.ends.length;
    bundles.push({
      colors: start.ends.map((_, index) =>
        count === 2 && index === 0 ? "red" : "black",
      ),
      from: start.ends,
      interchangeable: count === 3,
      parts: [from.instanceId, to.instanceId],
      to: end.ends,
      wire: POWER_INTERFACES.has(start.interface ?? "")
        ? POWER_WIRE
        : SIGNAL_LEAD,
    });
  }
  return bundles;
}

type Solid = { bounds: KartBounds; instanceId: string };
/** A wire already laid, as drawn, in the plate's axes. */
type Laid = { points: KartVector[]; radius: number };

/**
 * Everything a cable can meet near the plate, except wheels and shocks, as
 * bounds in the plate's axes.
 */
function listSolids(
  document: KartAssemblyDocument,
  plateId: string,
  frame: PlateFrame,
) {
  // Each solid turned into the plate's axes before it is bounded, so a
  // turned plate doesn't widen what stands on it.
  const local = (shape: KartConvexShape): KartBounds => {
    if (shape.kind === "rounded" || shape.kind === "hull") {
      // Not a construction shape; bound its kart-axis bounds' corners.
      const { maximum, minimum } = getConvexShapeBounds(shape);
      const corners = [0, 1, 2, 3, 4, 5, 6, 7].map((corner) =>
        frame.toLocal({
          x: corner & 1 ? maximum.x : minimum.x,
          y: corner & 2 ? maximum.y : minimum.y,
          z: corner & 4 ? maximum.z : minimum.z,
        }),
      );
      return getConvexShapeBounds({ kind: "rounded", points: corners, radius: 0 });
    }
    if (shape.kind === "cylinder") {
      return getConvexShapeBounds({
        ...shape,
        axis: frame.toLocalDirection(shape.axis),
        center: frame.toLocal(shape.center),
      });
    }
    const r = shape.rotation;
    const [a, b, c] = [0, 1, 2].map((column) =>
      frame.toLocalDirection({ x: r[column], y: r[3 + column], z: r[6 + column] }),
    );
    return getConvexShapeBounds({
      ...shape,
      center: frame.toLocal(shape.center),
      rotation: [a.x, b.x, c.x, a.y, b.y, c.y, a.z, b.z, c.z],
    });
  };
  const solids: Solid[] = document.primitiveInstances
    .filter(({ id }) => id !== plateId)
    .map((primitive) => ({
      bounds: local(buildPrimitiveMassElement(primitive).solid),
      instanceId: primitive.id,
    }));
  for (const instance of document.componentInstances) {
    const definition = getApprovedKartComponent(instance.definition);
    if (
      !definition ||
      definition.category === "wheel-tire" ||
      definition.category === "suspension"
    ) {
      continue;
    }
    for (const element of buildComponentMassElements(instance, definition)) {
      solids.push({ bounds: local(element.solid), instanceId: instance.id });
    }
  }
  return solids;
}

/**
 * Points along each tie rod and driveshaft through steering and travel,
 * with the radius they sweep. A wheel droops until its shock, drawn at
 * rest, is fully extended, and rises through the rest of the stroke;
 * steering spans the servo's whole throw, a little more than a race turns.
 */
function sampleLinkageSweeps(document: KartAssemblyDocument) {
  const linkages = planKartLinkagePoses(document);
  const samples: { point: KartVector; radius: number }[] = [];
  const wheelTravel = (wheelId: string) => {
    const suspension = findWheelSuspension(document, wheelId);
    const definition = suspension
      ? getApprovedKartComponent(suspension.definition)
      : null;
    if (definition?.category !== "suspension" || !suspension?.suspensionMount) {
      return [0];
    }
    const mount = suspension.suspensionMount;
    const { installationRatio } = getSuspensionInstallationRatio(mount);
    if (!(installationRatio >= MINIMUM_INSTALLATION_RATIO)) return [0];
    const { extendedLength, maximumStroke } = definition.suspension;
    const restLength = Math.hypot(
      mount.chassisAnchor.x - mount.springArmAnchor.x,
      mount.chassisAnchor.y - mount.springArmAnchor.y,
      mount.chassisAnchor.z - mount.springArmAnchor.z,
    );
    const droop = Math.min(
      Math.max(extendedLength - restLength, 0) / installationRatio,
      MAXIMUM_WHEEL_TRAVEL,
    );
    const bump = Math.min(
      Math.max(maximumStroke / installationRatio - droop, 0),
      MAXIMUM_WHEEL_TRAVEL,
    );
    return [-droop, -droop / 2, 0, bump / 2, bump];
  };
  const hubOf = (wheelId: string, travel: number) => {
    const wheel = document.componentInstances.find(({ id }) => id === wheelId);
    const hub = wheel?.transform.position ?? { x: 0, y: 0, z: 0 };
    return { ...hub, y: hub.y + travel };
  };
  const along = (start: KartVector, end: KartVector, radius: number) => {
    const length = Math.hypot(end.x - start.x, end.y - start.y, end.z - start.z);
    // A linkage is a hand's breadth long; a broken draft's is capped.
    const steps = Math.min(100, Math.max(1, Math.ceil(length / CELL)));
    for (let step = 0; step <= steps; step++) {
      const t = step / steps;
      samples.push({
        point: {
          x: start.x + (end.x - start.x) * t,
          y: start.y + (end.y - start.y) * t,
          z: start.z + (end.z - start.z) * t,
        },
        radius,
      });
    }
  };
  for (const servo of linkages.servos) {
    for (const rod of servo.tieRods) {
      for (const turn of [-1, -0.5, 0, 0.5, 1]) {
        const hornAngle = turn * servo.maximumHornAngle;
        const steer = rod.hornRatio === 0 ? 0 : hornAngle / rod.hornRatio;
        for (const travel of wheelTravel(rod.wheelId)) {
          along(
            getHornBall(rod, hornAngle, { x: 0, y: 0, z: 0 }),
            getKnuckleBall(rod, hubOf(rod.wheelId, travel), steer, {
              x: 0,
              y: 0,
              z: 0,
            }),
            BALL_CUP_RADIUS,
          );
        }
      }
    }
  }
  for (const driveshaft of linkages.driveshafts) {
    for (const travel of wheelTravel(driveshaft.wheelId)) {
      const start = { x: 0, y: 0, z: 0 };
      const end = { x: 0, y: 0, z: 0 };
      getDriveshaftEnds(
        driveshaft,
        hubOf(driveshaft.wheelId, travel),
        start,
        end,
      );
      along(start, end, DOGBONE_BALL_RADIUS);
    }
  }
  return samples;
}

/**
 * The floor a bundle lies on: the plate, raised by every part resting on it
 * and by cables already laid. A cell is blocked where a cable lying on it
 * would reach what is overhead: a part's underside (except the two it
 * joins, whose wires leave from under them), or the space a linkage
 * sweeps. Each end's stub stands beside its own part, within the margin its
 * part's side keeps, so the floor there is the stub's own height (and any
 * cable already laid there); a lead leaves its port wherever its part puts
 * it, so a little way round each stub is open. Returns the open cells.
 */
function paintGrid(
  grid: Grid,
  top: number,
  solids: readonly Solid[],
  laid: readonly Laid[],
  bundle: Bundle,
  stubs: readonly KartVector[],
) {
  const { blocked, ceiling, floor, laidTop, linkageLow } = grid;
  const { radius } = bundle.wire;
  const half = bundle.from.length * radius;
  floor.fill(top);
  laidTop.fill(-Infinity);
  ceiling.set(linkageLow);
  for (const { bounds, instanceId } of solids) {
    if (bounds.minimum.y <= top + RESTING) {
      paint(grid, bounds.minimum, bounds.maximum, half + SIDE_CLEARANCE, (cell) => {
        floor[cell] = Math.max(floor[cell], bounds.maximum.y);
      });
    } else if (!bundle.parts.includes(instanceId)) {
      const underside = bounds.minimum.y - SIDE_CLEARANCE;
      paint(grid, bounds.minimum, bounds.maximum, half + SIDE_CLEARANCE, (cell) => {
        ceiling[cell] = Math.min(ceiling[cell], underside);
      });
    }
  }
  for (const point of stubs) {
    paint(grid, point, point, half + SIDE_CLEARANCE, (cell) => {
      floor[cell] = Math.max(top, Math.min(floor[cell], point.y - radius));
    });
  }
  for (const wire of laid) {
    // Along each of its segments, its top one radius above its centreline.
    for (let index = 1; index < wire.points.length; index++) {
      const from = wire.points[index - 1];
      const to = wire.points[index];
      const steps = Math.max(1, Math.ceil(length(subtract(to, from)) / (CELL / 2)));
      for (let step = 0; step <= steps; step++) {
        const point = lerp(from, to, step / steps);
        paint(grid, point, point, wire.radius + half, (cell) => {
          floor[cell] = Math.max(floor[cell], point.y + wire.radius);
          laidTop[cell] = Math.max(laidTop[cell], point.y + wire.radius);
        });
      }
    }
  }
  for (let cell = 0; cell < floor.length; cell++) {
    blocked[cell] = floor[cell] + 2 * radius > ceiling[cell] ? 1 : 0;
  }
  const open = new Set<number>();
  for (const point of stubs) {
    paint(grid, point, point, half + SIDE_CLEARANCE + 2 * CELL, (cell) => {
      blocked[cell] = 0;
      open.add(cell);
    });
  }
  return open;
}

function paint(
  grid: Grid,
  minimum: KartVector,
  maximum: KartVector,
  inflate: number,
  apply: (cell: number) => void,
) {
  const [i0, k0] = cellOf(grid, minimum.x - inflate, minimum.z - inflate);
  const [i1, k1] = cellOf(grid, maximum.x + inflate, maximum.z + inflate);
  for (let k = k0; k <= k1; k++) {
    for (let i = i0; i <= i1; i++) apply(i + k * grid.nx);
  }
}

function cellOf(grid: Grid, x: number, z: number): [number, number] {
  return [
    Math.min(grid.nx - 1, Math.max(0, Math.floor((x - grid.x0) / CELL))),
    Math.min(grid.nz - 1, Math.max(0, Math.floor((z - grid.z0) / CELL))),
  ];
}

/**
 * The bundle's centreline from stub to stub: the cheapest path over the
 * grid, pulled taut wherever the floor stays level, then laid on the floor.
 * A step down hangs off its edge, falling at most `HANG_DROP` times as far
 * as it runs.
 */
function routeBundle(
  grid: Grid,
  start: KartVector,
  end: KartVector,
  radius: number,
  open: ReadonlySet<number>,
): KartVector[] | null {
  const { floor, nx } = grid;
  const [si, sk] = cellOf(grid, start.x, start.z);
  const [ei, ek] = cellOf(grid, end.x, end.z);
  const cells = searchCells(grid, si + sk * nx, ei + ek * nx);
  if (!cells) return null;
  // Each cell's centre, but the stubs themselves at the ends.
  const at = cells.map((cell) => ({
    x: grid.x0 + ((cell % nx) + 0.5) * CELL,
    z: grid.z0 + (Math.floor(cell / nx) + 0.5) * CELL,
  }));
  at[0] = { x: start.x, z: start.z };
  at[at.length - 1] = { x: end.x, z: end.z };
  const plan = [at[0]];
  for (let index = 0; index < cells.length - 1; ) {
    let next = cells.length - 1;
    while (
      next > index + 1 &&
      !isLevel(grid, at[index], at[next], cells[index], open)
    ) {
      next--;
    }
    plan.push(at[next]);
    index = next;
  }
  const floorAt = (x: number, z: number) => {
    const [i, k] = cellOf(grid, x, z);
    return floor[i + k * nx] + radius;
  };
  const draped: KartVector[] = [];
  for (let index = 0; index < plan.length - 1; index++) {
    const from = plan[index];
    const to = plan[index + 1];
    const steps = Math.max(
      1,
      Math.ceil(Math.hypot(to.x - from.x, to.z - from.z) / (CELL / 2)),
    );
    for (let step = 0; step < steps; step++) {
      const x = from.x + ((to.x - from.x) * step) / steps;
      const z = from.z + ((to.z - from.z) * step) / steps;
      draped.push({ x, y: floorAt(x, z), z });
    }
  }
  draped[0] = { ...start };
  draped.push({ ...end });
  for (let pass = 0; pass < 2; pass++) {
    for (let index = 1; index < draped.length; index++) {
      draped[index].y = Math.max(draped[index].y, draped[index - 1].y - HANG_DROP * (CELL / 2));
    }
    for (let index = draped.length - 2; index >= 0; index--) {
      draped[index].y = Math.max(draped[index].y, draped[index + 1].y - HANG_DROP * (CELL / 2));
    }
  }
  return draped;
}

/** A* over the grid's cells, eight ways, from `start` to `goal`. */
function searchCells(grid: Grid, start: number, goal: number): number[] | null {
  const { blocked, floor, nx, nz, offPlate } = grid;
  const cost = new Float64Array(nx * nz).fill(Infinity);
  const from = new Int32Array(nx * nz).fill(-1);
  const heap = new MinHeap();
  const gi = goal % nx;
  const gk = Math.floor(goal / nx);
  const estimate = (cell: number) => {
    const di = (cell % nx) - gi;
    const dk = Math.floor(cell / nx) - gk;
    return Math.sqrt(di * di + dk * dk) * CELL;
  };
  cost[start] = 0;
  heap.push(start, estimate(start));
  while (heap.size > 0) {
    const cell = heap.pop();
    if (cell === goal) break;
    const ci = cell % nx;
    const ck = Math.floor(cell / nx);
    for (let di = -1; di <= 1; di++) {
      for (let dk = -1; dk <= 1; dk++) {
        if (di === 0 && dk === 0) continue;
        const i = ci + di;
        const k = ck + dk;
        if (i < 0 || k < 0 || i >= nx || k >= nz) continue;
        const next = i + k * nx;
        if (blocked[next] && next !== goal) continue;
        const run =
          (di !== 0 && dk !== 0 ? DIAGONAL : CELL) *
          (offPlate[next] ? OFF_PLATE_COST : 1);
        const step = run + CLIMB_COST * Math.abs(floor[next] - floor[cell]);
        if (cost[cell] + step < cost[next]) {
          cost[next] = cost[cell] + step;
          from[next] = cell;
          heap.push(next, cost[next] + estimate(next));
        }
      }
    }
  }
  if (from[goal] === -1 && goal !== start) return null;
  const path: number[] = [];
  for (let cell = goal; cell !== -1; cell = from[cell]) path.push(cell);
  return path.reverse();
}

/**
 * Whether a straight run from `a` to `b` keeps to the level of the cell it
 * starts in (`from`), unblocked outside the stubs' open cells, read at the
 * points the drape reads.
 */
function isLevel(
  grid: Grid,
  a: { x: number; z: number },
  b: { x: number; z: number },
  from: number,
  open: ReadonlySet<number>,
) {
  const { blocked, floor, nx, offPlate } = grid;
  // Every cell the segment passes through (Amanatides and Woo's walk).
  let [i, k] = cellOf(grid, a.x, a.z);
  const [i1, k1] = cellOf(grid, b.x, b.z);
  const dx = b.x - a.x;
  const dz = b.z - a.z;
  const stepI = Math.sign(dx);
  const stepK = Math.sign(dz);
  const edge = (start: number, origin: number, index: number, step: number) =>
    origin + (index + (step > 0 ? 1 : 0)) * CELL - start;
  let nextI = dx !== 0 ? edge(a.x, grid.x0, i, stepI) / dx : Infinity;
  let nextK = dz !== 0 ? edge(a.z, grid.z0, k, stepK) / dz : Infinity;
  const deltaI = dx !== 0 ? CELL / Math.abs(dx) : Infinity;
  const deltaK = dz !== 0 ? CELL / Math.abs(dz) : Infinity;
  for (let visits = 0; visits <= grid.nx + grid.nz; visits++) {
    if (i < 0 || k < 0 || i >= nx || k >= grid.nz) return false;
    const cell = i + k * nx;
    if (
      (blocked[cell] && !open.has(cell)) ||
      Math.abs(floor[cell] - floor[from]) > 0.0002 ||
      offPlate[cell] !== offPlate[from]
    ) {
      return false;
    }
    if (i === i1 && k === k1) return true;
    if (nextI < nextK) {
      i += stepI;
      nextI += deltaI;
    } else {
      k += stepK;
      nextK += deltaK;
    }
  }
  return true;
}

class MinHeap {
  private cells: number[] = [];
  private keys: number[] = [];

  get size() {
    return this.cells.length;
  }

  push(cell: number, key: number) {
    const { cells, keys } = this;
    let index = cells.length;
    cells.push(cell);
    keys.push(key);
    while (index > 0) {
      const parent = (index - 1) >> 1;
      if (keys[parent] <= keys[index]) break;
      this.swap(index, parent);
      index = parent;
    }
  }

  pop() {
    const { cells, keys } = this;
    const top = cells[0];
    const lastCell = cells.pop()!;
    const lastKey = keys.pop()!;
    if (cells.length > 0) {
      cells[0] = lastCell;
      keys[0] = lastKey;
      let index = 0;
      for (;;) {
        const left = 2 * index + 1;
        const right = left + 1;
        let least = index;
        if (left < keys.length && keys[left] < keys[least]) least = left;
        if (right < keys.length && keys[right] < keys[least]) least = right;
        if (least === index) break;
        this.swap(index, least);
        index = least;
      }
    }
    return top;
  }

  private swap(a: number, b: number) {
    [this.cells[a], this.cells[b]] = [this.cells[b], this.cells[a]];
    [this.keys[a], this.keys[b]] = [this.keys[b], this.keys[a]];
  }
}

/** Where a lead's run from its port ends, past any plug housing. */
function stub(end: End): KartVector {
  return offset(end.position, end.direction, (end.plug ? PLUG.length : 0) + STUB);
}

/**
 * Each wire of a bundle in its own lane beside the centreline, curving
 * into it a little way along from its port, so it leaves the port square.
 */
function layWires(
  bundle: Bundle,
  path: KartVector[],
  startStubs: KartVector[],
  endStubs: KartVector[],
): KartCable[] {
  const { radius, sides } = bundle.wire;
  const count = bundle.from.length;
  const pitch = 2 * radius * 1.04;
  const sideways = lateralDirections(path);
  const startLanes = laneOrder(startStubs, sideways[0]);
  const endLanes = laneOrder(endStubs, sideways[sideways.length - 1]);
  const distance = [0];
  for (let index = 1; index < path.length; index++) {
    distance.push(distance[index - 1] + length(subtract(path[index], path[index - 1])));
  }
  const total = distance[distance.length - 1];
  const join = Math.min(LANE_JOIN, total * 0.3);
  const first = Math.max(1, distance.findIndex((value) => value >= join));
  let last = path.length - 2;
  while (last > first + 1 && total - distance[last] < join) last--;
  const cables: KartCable[] = [];
  for (let wire = 0; wire < count; wire++) {
    // Interchangeable wires pair by lane, so none cross.
    const other = bundle.interchangeable
      ? endLanes.indexOf(startLanes[wire])
      : wire;
    const startOffset = (startLanes[wire] - (count - 1) / 2) * pitch;
    const endOffset = (endLanes[other] - (count - 1) / 2) * pitch;
    // Wires whose lanes must swap (a power lead's red and black can't) cross
    // over the last stretch, the last one lifted over the other.
    const lifted =
      startLanes[wire] !== endLanes[other] && wire === count - 1;
    const middle: KartVector[] = [];
    const place = (point: KartVector, across: { x: number; z: number }, t: number) => {
      const swap = Math.min(1, Math.max(0, (t - 0.8) / 0.2));
      const lane = startOffset + (endOffset - startOffset) * swap;
      middle.push({
        x: point.x + across.x * lane,
        y:
          point.y +
          (lifted ? pitch * Math.min(1, 2 * Math.sin(Math.PI * swap)) : 0),
        z: point.z + across.z * lane,
      });
    };
    // The path's own points, and through a lift points at set stages of
    // it, so the crossing is drawn however few points the path has there.
    const span = last - first;
    const stages = [...Array(span + 1).keys()].map((step) => step / Math.max(1, span));
    if (lifted && span > 0) {
      stages.push(...[0.1, 0.25, 0.5, 0.75, 0.9].map((stage) => 0.8 + 0.2 * stage));
      stages.sort((left, right) => left - right);
    }
    for (const t of stages) {
      const at = first + t * span;
      const below = Math.min(Math.floor(at), last);
      const above = Math.min(below + 1, last);
      place(
        lerp(path[below], path[above], at - below),
        sideways[Math.round(at)],
        t,
      );
    }
    const from = bundle.from[wire];
    const to = bundle.to[other];
    let points: KartVector[];
    if (middle.length < 2) {
      // Too short a run for lanes: straight from port to port, a wire
      // that must cross the other lifted over it.
      points = [
        ...curveIn(leadStart(from), from.direction, leadStart(to), scale(to.direction, -1)),
        leadStart(to),
      ].map((point, index, all) =>
        lifted
          ? { ...point, y: point.y + pitch * Math.sin((Math.PI * index) / (all.length - 1)) }
          : point,
      );
    } else {
      const head = curveIn(
        leadStart(from),
        from.direction,
        middle[0],
        unit(subtract(middle[1], middle[0])),
      );
      const tail = curveIn(
        leadStart(to),
        to.direction,
        middle[middle.length - 1],
        unit(subtract(middle[middle.length - 2], middle[middle.length - 1])),
      ).reverse();
      points = [...head, ...middle, ...tail];
    }
    cables.push({
      color: bundle.colors[wire],
      parts: bundle.parts,
      plugs: [from, to]
        .filter(({ plug }) => plug)
        .map((end) => ({ end: leadStart(end), start: end.position })),
      points: simplify(points, 0.0004),
      radius,
      sides,
    });
  }
  return cables;
}

const leadStart = (end: End) =>
  end.plug ? offset(end.position, end.direction, PLUG.length) : end.position;

/** Each point's sideways direction in plan; where it drops straight down, its nearest run's. */
function lateralDirections(path: KartVector[]) {
  const directions: ({ x: number; z: number } | null)[] = path.map((_, index) => {
    const before = path[Math.max(0, index - 2)];
    const after = path[Math.min(path.length - 1, index + 2)];
    const run = Math.hypot(after.x - before.x, after.z - before.z);
    return run > 0.0015
      ? { x: -(after.z - before.z) / run, z: (after.x - before.x) / run }
      : null;
  });
  for (let index = 1; index < directions.length; index++) {
    directions[index] ??= directions[index - 1];
  }
  for (let index = directions.length - 2; index >= 0; index--) {
    directions[index] ??= directions[index + 1];
  }
  return directions.map((direction) => direction ?? { x: 1, z: 0 });
}

/** Each wire's lane, ranked by where its stub stands across the bundle. */
function laneOrder(stubs: KartVector[], sideways: { x: number; z: number }) {
  const center = mean(stubs);
  const lanes = new Array<number>(stubs.length);
  stubs
    .map((point, wire) => ({
      across: (point.x - center.x) * sideways.x + (point.z - center.z) * sideways.z,
      wire,
    }))
    .sort((left, right) => left.across - right.across || left.wire - right.wire)
    .forEach(({ wire }, lane) => (lanes[wire] = lane));
  return lanes;
}

/** A cubic curve leaving `start` along `direction` and arriving at `join` along `along`. */
function curveIn(
  start: KartVector,
  direction: KartVector,
  join: KartVector,
  along: KartVector,
) {
  const reach = length(subtract(join, start)) * 0.45;
  const control1 = offset(start, direction, reach);
  const control2 = offset(join, along, -reach);
  const points: KartVector[] = [];
  const steps = 4;
  for (let step = 0; step < steps; step++) {
    const u = step / steps;
    const w = 1 - u;
    const blend = (a: number, b: number, c: number, d: number) =>
      w * w * w * a + 3 * w * w * u * b + 3 * w * u * u * c + u * u * u * d;
    points.push({
      x: blend(start.x, control1.x, control2.x, join.x),
      y: blend(start.y, control1.y, control2.y, join.y),
      z: blend(start.z, control1.z, control2.z, join.z),
    });
  }
  return points;
}

/** Ramer–Douglas–Peucker: drops points within `tolerance` of the line kept. */
function simplify(points: KartVector[], tolerance: number): KartVector[] {
  if (points.length < 3) return points;
  const first = points[0];
  const last = points[points.length - 1];
  let worst = 0;
  let worstIndex = 0;
  for (let index = 1; index < points.length - 1; index++) {
    const gap = distanceToSegment(points[index], first, last);
    if (gap > worst) {
      worst = gap;
      worstIndex = index;
    }
  }
  if (worst <= tolerance) return [first, last];
  return [
    ...simplify(points.slice(0, worstIndex + 1), tolerance).slice(0, -1),
    ...simplify(points.slice(worstIndex), tolerance),
  ];
}

function distanceToSegment(point: KartVector, start: KartVector, end: KartVector) {
  const span = subtract(end, start);
  const squared = dot(span, span);
  const t =
    squared > 0
      ? Math.min(1, Math.max(0, dot(subtract(point, start), span) / squared))
      : 0;
  return length(subtract(point, offset(start, span, t)));
}

// A cable's bends: the tightest radius, and the most each segment turns.
const BEND_RADIUS = 0.004;
const BEND_STEP = Math.PI / 3;

/**
 * The cables' meshes: black insulation in the fixed black polymer, and red
 * in the authored polymer, coloured `KART_CABLE_RED` by its caller, so the
 * cables add no material of their own. Pieces with no triangles are left out.
 */
export function buildKartCablePieces(
  cables: readonly KartCable[],
): KartPartVisualPiece[] {
  const black = piece("black-polymer");
  const red = piece("authored-polymer");
  for (const cable of cables) {
    const mesh = cable.color === "red" ? red : black;
    tube(mesh, roundCorners(cable.points, cable.radius), cable.radius, cable.sides);
    for (const plug of cable.plugs) {
      tube(mesh, [plug.start, plug.end], PLUG.radius, 6);
    }
  }
  return [black, red].filter(({ indices }) => indices.length > 0);
}

/**
 * The polyline with each corner turned on an arc no tighter than the bend
 * radius. A corner with too little room for an arc wider than the wire is
 * left as a joint, so its inside never folds over itself. Points closer
 * than the wire is thick are merged.
 */
function roundCorners(input: KartVector[], radius: number) {
  const points = input.filter(
    (point, index) =>
      index === 0 ||
      index === input.length - 1 ||
      length(subtract(point, input[index - 1])) >= 2 * radius,
  );
  const rounded = [points[0]];
  for (let index = 1; index < points.length - 1; index++) {
    const corner = points[index];
    const back = subtract(points[index - 1], corner);
    const ahead = subtract(points[index + 1], corner);
    const toBack = unit(back);
    const toAhead = unit(ahead);
    const turn = Math.PI - Math.acos(Math.min(1, Math.max(-1, dot(toBack, toAhead))));
    if (turn < 0.05) {
      rounded.push(corner);
      continue;
    }
    const cut = Math.min(
      BEND_RADIUS * Math.tan(turn / 2),
      length(back) / 2,
      length(ahead) / 2,
    );
    if (cut / Math.tan(turn / 2) < 1.5 * radius) {
      rounded.push(corner);
      continue;
    }
    const enter = offset(corner, toBack, cut);
    const leave = offset(corner, toAhead, cut);
    const steps = Math.max(1, Math.ceil(turn / BEND_STEP));
    for (let step = 0; step <= steps; step++) {
      const t = step / steps;
      // A quadratic curve through the corner.
      rounded.push({
        x: (1 - t) ** 2 * enter.x + 2 * (1 - t) * t * corner.x + t * t * leave.x,
        y: (1 - t) ** 2 * enter.y + 2 * (1 - t) * t * corner.y + t * t * leave.y,
        z: (1 - t) ** 2 * enter.z + 2 * (1 - t) * t * corner.z + t * t * leave.z,
      });
    }
  }
  rounded.push(points[points.length - 1]);
  return rounded;
}

/**
 * A capped tube along `path`, its rings kept from twisting. A joint whose
 * ring, tilted half its turn, would reach back past a neighbour's, or that
 * stands within half the radius of one, is left out, so the tube never
 * folds over itself.
 */
function tube(
  mesh: KartPartVisualPiece,
  input: KartVector[],
  radius: number,
  sides: number,
) {
  const path = [...input];
  for (let dropped = true; dropped; ) {
    dropped = false;
    for (let index = 1; index < path.length - 1; index++) {
      const back = subtract(path[index - 1], path[index]);
      const ahead = subtract(path[index + 1], path[index]);
      const turn =
        Math.PI -
        Math.acos(Math.min(1, Math.max(-1, dot(unit(back), unit(ahead)))));
      const reach = Math.max(radius * Math.tan(Math.min(turn, 3) / 2), radius / 2);
      if (length(back) <= reach || length(ahead) <= reach) {
        path.splice(index, 1);
        dropped = true;
        break;
      }
    }
  }
  if (path.length < 2) return;
  const first = mesh.positions.length / 3;
  const tangentAt = (index: number) =>
    unit(
      index === 0
        ? subtract(path[1], path[0])
        : index === path.length - 1
          ? subtract(path[index], path[index - 1])
          : add(
              unit(subtract(path[index], path[index - 1])),
              unit(subtract(path[index + 1], path[index])),
            ),
    );
  const start = tangentAt(0);
  let normal = unit(
    cross(start, Math.abs(start.y) < 0.9 ? { x: 0, y: 1, z: 0 } : { x: 1, y: 0, z: 0 }),
  );
  for (let index = 0; index < path.length; index++) {
    const tangent = tangentAt(index);
    normal = unit(subtract(normal, scale(tangent, dot(normal, tangent))));
    const binormal = cross(tangent, normal);
    for (let side = 0; side < sides; side++) {
      const angle = (side / sides) * Math.PI * 2;
      const out = add(scale(normal, Math.cos(angle)), scale(binormal, Math.sin(angle)));
      const point = offset(path[index], out, radius);
      mesh.positions.push(point.x, point.y, point.z);
      mesh.normals.push(out.x, out.y, out.z);
    }
  }
  for (let index = 0; index < path.length - 1; index++) {
    for (let side = 0; side < sides; side++) {
      const a = first + index * sides + side;
      const b = first + index * sides + ((side + 1) % sides);
      mesh.indices.push(a, b, a + sides, b, b + sides, a + sides);
    }
  }
  for (const [ring, facing] of [
    [0, -1],
    [path.length - 1, 1],
  ] as const) {
    const tangent = scale(tangentAt(ring), facing);
    const cap = mesh.positions.length / 3;
    for (let side = 0; side < sides; side++) {
      const at = (first + ring * sides + side) * 3;
      mesh.positions.push(
        mesh.positions[at],
        mesh.positions[at + 1],
        mesh.positions[at + 2],
      );
      mesh.normals.push(tangent.x, tangent.y, tangent.z);
    }
    for (let side = 1; side < sides - 1; side++) {
      if (facing > 0) mesh.indices.push(cap, cap + side, cap + side + 1);
      else mesh.indices.push(cap, cap + side + 1, cap + side);
    }
  }
}

const add = (a: KartVector, b: KartVector) => ({ x: a.x + b.x, y: a.y + b.y, z: a.z + b.z });
const subtract = (a: KartVector, b: KartVector) => ({
  x: a.x - b.x,
  y: a.y - b.y,
  z: a.z - b.z,
});
const scale = (a: KartVector, s: number) => ({ x: a.x * s, y: a.y * s, z: a.z * s });
const offset = (a: KartVector, direction: KartVector, distance: number) =>
  add(a, scale(direction, distance));
const dot = (a: KartVector, b: KartVector) => a.x * b.x + a.y * b.y + a.z * b.z;
const cross = (a: KartVector, b: KartVector) => ({
  x: a.y * b.z - a.z * b.y,
  y: a.z * b.x - a.x * b.z,
  z: a.x * b.y - a.y * b.x,
});
const length = (a: KartVector) => Math.hypot(a.x, a.y, a.z);
const lerp = (a: KartVector, b: KartVector, t: number) =>
  add(a, scale(subtract(b, a), t));
const unit = (a: KartVector) => scale(a, 1 / (length(a) || 1));
const mean = (points: readonly KartVector[]) =>
  scale(
    points.reduce((sum, point) => add(sum, point), { x: 0, y: 0, z: 0 }),
    1 / points.length,
  );

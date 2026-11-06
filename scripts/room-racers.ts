import "dotenv/config";

import { STEP_MICROSECONDS } from "../src/game/race/race-verification";
import { createRoomCourse } from "../src/game/room/room-course";
import { CURRENT_PHYSICS_VERSION } from "../src/game/physics/physics-version";
import {
  isRoomCode,
  parseServerMessage,
  ROOM_PROTOCOL,
  ROOM_STATE_HZ,
  type RoomClientMessage,
  type RoomServerMessage,
} from "../src/game/room/room-protocol";
import {
  randomRoomPlayerKey,
  type RoomCourse,
  roomKartContact,
  signRoomToken,
} from "../src/game/room/room-signing";

/**
 * Local QA only: up to three guests join a room on `pnpm rooms:dev`, pick a
 * kart, and drive the line through every gate at a steady pace, so one
 * person can try a full room. They are drawn without physics, so the line
 * passes through anything in the way.
 *
 *   pnpm rooms:racers <room code> [count] [--app URL] [--origin URL]
 *
 * The app (default http://127.0.0.1:3000) serves the published course and
 * karts; the origin must be one the room server allows.
 */

type Vector = { x: number; y: number; z: number };
type Gate = RoomCourse["startGate"];

const STATE_MS = 1_000 / ROOM_STATE_HZ;
const RIDE_HEIGHT = 0.12;
/** A crossing's state lands this far past its gate... */
const CROSSING = 0.05;
/** ...a fixed step after the point before it, as the room checks. */
const STEP_US = STEP_MICROSECONDS;

function option(name: string, fallback: string) {
  const index = process.argv.indexOf(name);
  return index > 0 ? process.argv[index + 1] : fallback;
}

const add = (a: Vector, b: Vector, by = 1) => ({
  x: a.x + b.x * by,
  y: a.y + b.y * by,
  z: a.z + b.z * by,
});
const length = (a: Vector) => Math.hypot(a.x, a.y, a.z);

/** On the ground under a gate, `along` its forward. */
function throughGate(gate: Gate, along: number) {
  return add(
    { ...gate.center, y: gate.center.y - gate.halfExtents.y + RIDE_HEIGHT },
    gate.forward,
    along,
  );
}

/** Launches build to top speed at about this rate, m/s². */
const LAUNCH = 4;

/** How far a racer has gone `seconds` after the start, and how fast. */
function travel(seconds: number, top: number) {
  const launch = top / LAUNCH;
  if (seconds <= launch) {
    return { distance: (LAUNCH * seconds * seconds) / 2, speed: LAUNCH * seconds };
  }
  return { distance: top * (seconds - launch / 2), speed: top };
}

/** When a racer reaches `distance` along its line. */
function reaching(distance: number, top: number) {
  const launch = top / LAUNCH;
  const launched = (LAUNCH * launch * launch) / 2;
  return distance <= launched
    ? Math.sqrt((2 * distance) / LAUNCH)
    : distance / top + launch / 2;
}

/**
 * The line a racer drives: from its grid slot straight down the start, as
 * far as the first checkpoint is ahead, then through each gate in order,
 * lap after lap, meeting each one square on; and where each gate falls.
 */
function racingLine(course: RoomCourse, slot: number) {
  const gates = Array.from({ length: course.lapCount }, () => [
    ...course.checkpoints.map(({ gate }) => gate),
    course.startGate,
  ]).flat();
  const grid = { ...course.grid[slot], y: course.grid[slot].y + RIDE_HEIGHT };
  const ahead = course.startGate.forward;
  const first = throughGate(gates[0], -1.5);
  const reach = Math.max(
    0,
    (first.x - grid.x) * ahead.x +
      (first.y - grid.y) * ahead.y +
      (first.z - grid.z) * ahead.z -
      10,
  );
  const points: Vector[] = [grid, add(grid, ahead, reach)];
  const crossings: number[] = [];
  let distance = reach;
  const to = (point: Vector) => {
    distance += length(add(point, points.at(-1)!, -1));
    points.push(point);
  };
  for (const gate of gates) {
    to(throughGate(gate, -1.5));
    to(throughGate(gate, 0));
    crossings.push(distance);
    to(throughGate(gate, 1.5));
  }
  return { points, crossings };
}

/** Position and heading `distance` along the line. */
function along(points: Vector[], distance: number) {
  let left = Math.max(0, distance);
  for (let index = 1; index < points.length; index += 1) {
    const segment = add(points[index], points[index - 1], -1);
    const size = length(segment);
    if (left <= size || index === points.length - 1) {
      const direction = size > 0 ? add({ x: 0, y: 0, z: 0 }, segment, 1 / size) : segment;
      return {
        position: add(points[index - 1], segment, size > 0 ? Math.min(1, left / size) : 0),
        direction,
      };
    }
    left -= size;
  }
  return { position: points[0], direction: { x: 0, y: 0, z: -1 } };
}

const round = (value: number, places: number) =>
  Math.round(value * 10 ** places) / 10 ** places;

function kartState(
  t: number,
  { position, direction }: ReturnType<typeof along>,
  speed: number,
  gateFrom?: Vector,
): Extract<RoomClientMessage, { type: "state" }> {
  // Facing along the line: karts face -z.
  const yaw = Math.atan2(-direction.x, -direction.z);
  const point = ({ x, y, z }: Vector): [number, number, number] => [
    round(x, 3),
    round(y, 3),
    round(z, 3),
  ];
  return {
    type: "state",
    t: Math.round(t),
    p: point(position),
    q: [0, round(Math.sin(yaw / 2), 4), 0, round(Math.cos(yaw / 2), 4)],
    v: [
      round(direction.x * speed, 2),
      round(direction.y * speed, 2),
      round(direction.z * speed, 2),
    ],
    w: [0, 0, 0],
    s: 0,
    r: false,
    ...(gateFrom ? { g: point(gateFrom) } : {}),
  };
}

async function main() {
  const code = process.argv[2];
  const count = Math.min(3, Math.max(1, Number(process.argv[3]) || 1));
  const app = option("--app", "http://127.0.0.1:3000");
  const origin = option("--origin", app);
  const server =
    process.env.NEXT_PUBLIC_ROOM_SERVER_URL?.trim() || "ws://127.0.0.1:8787";
  if (!isRoomCode(code)) {
    throw new Error("Usage: pnpm rooms:racers <room code> [1-3] [--app URL]");
  }
  if (!/^ws:\/\/(127\.0\.0\.1|localhost)(:\d+)?$/.test(server)) {
    throw new Error("Room racers run only against a local room server.");
  }
  const secret = process.env.ROOM_SERVER_SECRET?.trim() ?? "";
  if (secret.length < 32) {
    throw new Error("Set ROOM_SERVER_SECRET, as the room server has it.");
  }
  const [publication, roster] = await Promise.all([
    fetch(`${app}/api/courses/falls-view-park/published`).then((response) =>
      response.json(),
    ),
    fetch(`${app}/api/karts/official`).then((response) => response.json()),
  ]);
  const course = createRoomCourse(publication.document);
  const karts = (
    roster.karts as Array<{
      runtime: {
        kartId: string;
        revision: number;
        resolvedSnapshot: Parameters<typeof roomKartContact>[0];
      };
    }>
  ).map(({ runtime }) => ({
    id: runtime.kartId,
    revision: runtime.revision,
    contact: roomKartContact(runtime.resolvedSnapshot),
  }));

  const racers = await Promise.all(
    Array.from({ length: count }, async (_, index) => {
      const token = await signRoomToken(secret, {
        protocol: ROOM_PROTOCOL,
        room: code,
        courseId: publication.courseId,
        courseRevision: publication.revision,
        course,
        physicsVersion: CURRENT_PHYSICS_VERSION,
        karts,
        player: { key: randomRoomPlayerKey(), username: null, signedIn: false },
      });
      return race(`${server}/v1/rooms/${code}?token=${token}`, origin, {
        course,
        kartId: karts[index % karts.length].id,
        // A little apart, so they spread out.
        speed: 9 + index * 1.5,
      });
    }),
  );
  console.log(`${count} racer(s) in room ${code}. Ctrl+C to leave.`);
  // Leaving closes each socket with 1000, freeing its seat at once; the
  // close frames need a moment to go.
  process.on("SIGINT", () => {
    for (const leave of racers) leave();
    setTimeout(() => process.exit(0), 300);
  });
}

/** One guest racer; returns how to make it leave. */
function race(
  url: string,
  origin: string,
  { course, kartId, speed }: { course: RoomCourse; kartId: string; speed: number },
) {
  // Node's WebSocket (undici) takes headers, so it can send an Origin.
  const socket = new WebSocket(url, {
    headers: { origin },
  } as unknown as string[]);
  const send = (message: RoomClientMessage) => {
    if (socket.readyState === WebSocket.OPEN) {
      socket.send(JSON.stringify(message));
    }
  };
  let you: string | null = null;
  let offsetMs = 0;
  let snapshot: Extract<RoomServerMessage, { type: "room" }> | null = null;
  let driving: ReturnType<typeof setInterval> | null = null;

  const pings = setInterval(() => send({ type: "ping", t: Date.now() }), 1_000);
  socket.addEventListener("message", (event) => {
    const message = parseServerMessage(event.data);
    if (!message) return;
    if (message.type === "welcome") you = message.you;
    if (message.type === "pong") {
      const now = Date.now();
      offsetMs = message.serverAt - (message.t + now) / 2;
    }
    if (message.type !== "room") return;
    snapshot = message;
    const me = message.players.find(({ id }) => id === you);
    const entry = message.race?.entrants.find(({ id }) => id === you);
    if (message.phase === "lobby" && me && !me.ready) {
      send({ type: "choose_kart", kartId });
    }
    if (message.phase === "loading" && entry) {
      send({ type: "loaded", raceId: message.race!.id });
    }
    if (message.phase === "racing" && entry && !driving) {
      driving = drive(entry.slot, message.race!.id);
    }
    if (message.phase !== "racing" && driving) {
      clearInterval(driving);
      driving = null;
    }
  });
  socket.addEventListener("close", (event) => {
    console.log(`A racer was closed (${event.code}).`);
    clearInterval(pings);
    if (driving) clearInterval(driving);
  });

  function drive(slot: number, raceId: string) {
    const { points, crossings } = racingLine(course, slot);
    let crossed = 0;
    let lastT = -1;
    return setInterval(() => {
      const racingAt = snapshot?.race?.id === raceId ? snapshot.race.racingAt : null;
      if (racingAt === null || crossed > crossings.length - 1) return;
      const t = Math.max(0, (Date.now() + offsetMs - racingAt) * 1_000);
      if (t <= lastT) return;
      const { distance, speed: now } = travel(t / 1_000_000, speed);
      // Reaching a gate's step before, the crossing step goes instead: it
      // lands just past the gate, a step after where it starts.
      const crossingT =
        reaching(crossings[crossed] + CROSSING, speed) * 1_000_000;
      const beforeT = crossingT - STEP_US;
      if (t >= beforeT) {
        send(
          kartState(
            crossingT,
            along(points, travel(crossingT / 1_000_000, speed).distance),
            travel(crossingT / 1_000_000, speed).speed,
            along(points, travel(beforeT / 1_000_000, speed).distance).position,
          ),
        );
        lastT = crossingT;
        crossed += 1;
        return;
      }
      send(kartState(t, along(points, distance), now));
      lastT = t;
    }, STATE_MS);
  }

  return () => {
    clearInterval(pings);
    if (driving) clearInterval(driving);
    socket.close(1000);
  };
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});

import { DurableObject } from "cloudflare:workers";

import {
  isRoomCode,
  parseClientMessage,
  ROOM_CLOSE,
  ROOM_PROTOCOL,
  ROOM_STATE_HZ,
  type RoomClientMessage,
  type RoomRaceReport,
  type RoomServerMessage,
} from "../../src/game/room/room-protocol";
import {
  applyRoomEvent,
  canRelayState,
  createRoomState,
  nextRoomDeadline,
  roomSnapshot,
  type RoomEvent,
  type RoomOutcome,
  type RoomState,
} from "../../src/game/room/room-rules";
import {
  readRoomToken,
  ROOM_REPORT_SIGNATURE_HEADER,
  signRoomReport,
  type RoomToken,
} from "../../src/game/room/room-signing";

/**
 * The room server: a Worker that checks each join, then one Durable Object
 * per room holding its players' WebSockets (hibernating between messages),
 * its state, and finished races waiting to reach the app. The rules live in
 * src/game/room; this file is transport only.
 */
export interface Env {
  ROOMS: DurableObjectNamespace<Room>;
  ROOM_SERVER_SECRET: string;
  /** Comma-separated page origins allowed to open rooms. */
  APP_ORIGINS: string;
  /** Where finished races are reported. */
  APP_RESULTS_URL: string;
}

const ROOM_PATH = /^\/v1\/rooms\/([^/]+)$/;
const TOKEN_HEADER = "x-room-token";
/** An empty room's storage is deleted this long after its last player left. */
const EMPTY_ROOM_MS = 10 * 60_000;
const REPORT_RETRY_MS = 30_000;
const REPORT_ATTEMPTS = 20;

const CLOSE_REASONS: Record<number, string> = {
  [ROOM_CLOSE.closed]: "Room closed",
  [ROOM_CLOSE.full]: "Room full",
  [ROOM_CLOSE.version]: "Refresh to join",
  [ROOM_CLOSE.token]: "Join link expired",
  [ROOM_CLOSE.replaced]: "Joined from another tab",
  [ROOM_CLOSE.protocol]: "Bad message",
};

/**
 * Accepts and closes at once, so the page can read why. It is not a
 * hibernating socket: it only carries the refusal.
 */
function refuse(code: number) {
  const { 0: client, 1: server } = new WebSocketPair();
  server.accept();
  server.close(code, CLOSE_REASONS[code]);
  return new Response(null, { status: 101, webSocket: client });
}

export default {
  async fetch(request, env): Promise<Response> {
    const url = new URL(request.url);
    const code = ROOM_PATH.exec(url.pathname)?.[1];
    if (!isRoomCode(code)) return new Response("Not found", { status: 404 });
    if (request.headers.get("Upgrade")?.toLowerCase() !== "websocket") {
      return new Response("Expected a WebSocket", { status: 426 });
    }
    const origins = new Set(
      env.APP_ORIGINS.split(",").map((origin) => origin.trim()),
    );
    if (!origins.has(request.headers.get("Origin") ?? "")) {
      return new Response("Forbidden", { status: 403 });
    }
    const token = await readRoomToken(
      env.ROOM_SERVER_SECRET,
      url.searchParams.get("token") ?? "",
    );
    if (!token || token.room !== code) return refuse(ROOM_CLOSE.token);
    if (token.protocol !== ROOM_PROTOCOL) return refuse(ROOM_CLOSE.version);
    // Only checked joins reach (and are billed to) the room's object.
    return env.ROOMS.getByName(code).fetch("https://room/join", {
      headers: { Upgrade: "websocket", [TOKEN_HEADER]: JSON.stringify(token) },
    });
  },
} satisfies ExportedHandler<Env>;

/** Which seat a socket speaks for; null once retired or refused. */
type Attachment = { playerId: string } | null;

type PendingReport = {
  report: RoomRaceReport;
  attempts: number;
  nextAttemptAt: number;
};

/** A client may send states at up to twice the agreed rate. */
const MIN_STATE_GAP_MS = 1_000 / (2 * ROOM_STATE_HZ);
const REPORT_TIMEOUT_MS = 10_000;

function send(socket: WebSocket, message: RoomServerMessage | string) {
  try {
    socket.send(
      typeof message === "string" ? message : JSON.stringify(message),
    );
  } catch {
    // A socket already closing misses the message; its close follows.
  }
}

function seatOf(socket: WebSocket) {
  return (socket.deserializeAttachment() as Attachment)?.playerId ?? null;
}

/** Stops a socket speaking for its seat, then closes it. */
function retire(socket: WebSocket, code: number) {
  socket.serializeAttachment(null satisfies Attachment);
  try {
    socket.close(code, CLOSE_REASONS[code]);
  } catch {
    // Already closing.
  }
}

function eventFor(
  message: Exclude<RoomClientMessage, { type: "ping" | "state" }>,
  playerId: string,
  now: number,
): RoomEvent {
  switch (message.type) {
    case "choose_kart":
      return { type: "choose_kart", now, playerId, kartId: message.kartId };
    case "start":
      return { type: "start", now, playerId, raceId: crypto.randomUUID() };
    case "loaded":
      return { type: "loaded", now, playerId, raceId: message.raceId };
    case "gate":
      return { ...message, now, playerId };
    case "finish":
      return { ...message, now, playerId };
  }
}

export class Room extends DurableObject<Env> {
  private state: RoomState | null;
  /** When each seat last had a state relayed; lost on hibernation. */
  private lastStateAt = new Map<string, number>();

  constructor(ctx: DurableObjectState, env: Env) {
    super(ctx, env);
    const stored = ctx.storage.kv.get<RoomState>("room") ?? null;
    if (stored && stored.protocol !== ROOM_PROTOCOL) {
      // Sockets outlived a deploy to a newer protocol.
      for (const socket of ctx.getWebSockets()) {
        retire(socket, ROOM_CLOSE.version);
      }
      ctx.storage.kv.delete("room");
      this.state = null;
    } else {
      this.state = stored;
    }
  }

  async fetch(request: Request) {
    const token = JSON.parse(request.headers.get(TOKEN_HEADER)!) as RoomToken;
    const outcome = applyRoomEvent(this.state ?? createRoomState(token), {
      type: "join",
      now: Date.now(),
      token,
    });
    if (!outcome.joined) {
      return refuse(
        outcome.refused === "full" ? ROOM_CLOSE.full : ROOM_CLOSE.version,
      );
    }
    const { 0: client, 1: server } = new WebSocketPair();
    const { playerId, replaced } = outcome.joined;
    if (replaced) {
      for (const socket of this.ctx.getWebSockets(playerId)) {
        retire(socket, ROOM_CLOSE.replaced);
      }
    }
    this.ctx.acceptWebSocket(server, [playerId]);
    server.serializeAttachment({ playerId } satisfies Attachment);
    send(server, { type: "welcome", you: playerId });
    this.commit(outcome);
    return new Response(null, { status: 101, webSocket: client });
  }

  async webSocketMessage(socket: WebSocket, frame: string | ArrayBuffer) {
    const message = parseClientMessage(frame);
    if (!message) {
      this.drop(socket, ROOM_CLOSE.protocol);
      return;
    }
    const playerId = seatOf(socket);
    if (!playerId || !this.state?.players.some(({ id }) => id === playerId)) {
      retire(socket, ROOM_CLOSE.closed);
      return;
    }
    const now = Date.now();
    // Busy sockets must not keep an overdue deadline waiting on the alarm.
    const deadline = nextRoomDeadline(this.state);
    if (deadline !== null && deadline <= now) {
      this.commit(applyRoomEvent(this.state, { type: "tick", now }));
    }
    if (message.type === "ping") {
      send(socket, { type: "pong", t: message.t, serverAt: now });
      return;
    }
    if (message.type === "state") {
      const last = this.lastStateAt.get(playerId) ?? -Infinity;
      if (now - last < MIN_STATE_GAP_MS) return;
      if (!canRelayState(this.state, playerId)) return;
      this.lastStateAt.set(playerId, now);
      const relayed = JSON.stringify({ ...message, from: playerId });
      for (const other of this.ctx.getWebSockets()) {
        if (other !== socket && seatOf(other)) send(other, relayed);
      }
      return;
    }
    this.commit(applyRoomEvent(this.state, eventFor(message, playerId, now)));
  }

  async webSocketClose(socket: WebSocket) {
    this.left(socket);
  }

  async webSocketError(socket: WebSocket) {
    this.left(socket);
  }

  /** Closes a misbehaving socket and frees its seat at once. */
  private drop(socket: WebSocket, code: number) {
    const playerId = seatOf(socket);
    retire(socket, code);
    if (playerId) this.vacate(playerId);
  }

  private left(socket: WebSocket) {
    const playerId = seatOf(socket);
    if (playerId) this.vacate(playerId, socket);
  }

  private vacate(playerId: string, closing?: WebSocket) {
    if (!this.state) return;
    // A seat another tab took over is still held.
    const held = this.ctx
      .getWebSockets(playerId)
      .some((socket) => socket !== closing && seatOf(socket) === playerId);
    if (held) return;
    this.commit(
      applyRoomEvent(this.state, { type: "leave", now: Date.now(), playerId }),
    );
  }

  async alarm() {
    const now = Date.now();
    if (this.state) {
      this.commit(applyRoomEvent(this.state, { type: "tick", now }));
    }
    if (this.isEmpty() && this.reports().length === 0) {
      const emptySince = this.ctx.storage.kv.get<number>("emptySince");
      if (emptySince !== undefined && now >= emptySince + EMPTY_ROOM_MS) {
        await this.ctx.storage.deleteAll();
        this.state = null;
        return;
      }
    }
    await Promise.all(
      this.reports()
        .filter(({ nextAttemptAt }) => nextAttemptAt <= now)
        .map(({ report }) => this.sendReport(report.raceId)),
    );
    this.schedule();
  }

  private isEmpty() {
    return !this.state || this.state.players.length === 0;
  }

  private commit(outcome: RoomOutcome) {
    this.state = outcome.state;
    const kv = this.ctx.storage.kv;
    kv.put("room", outcome.state);
    if (this.isEmpty()) {
      if (kv.get("emptySince") === undefined) kv.put("emptySince", Date.now());
    } else {
      kv.delete("emptySince");
    }
    if (outcome.changed) {
      const snapshot = JSON.stringify(roomSnapshot(outcome.state));
      for (const socket of this.ctx.getWebSockets()) {
        if (seatOf(socket)) send(socket, snapshot);
      }
    }
    if (outcome.report) {
      kv.put("reports", [
        ...this.reports(),
        { report: outcome.report, attempts: 0, nextAttemptAt: Date.now() },
      ]);
      this.ctx.waitUntil(this.sendReport(outcome.report.raceId));
    }
    this.schedule();
  }

  private reports() {
    return this.ctx.storage.kv.get<PendingReport[]>("reports") ?? [];
  }

  private putReports(reports: PendingReport[]) {
    this.ctx.storage.kv.put("reports", reports);
    this.schedule();
  }

  /**
   * One attempt to send a finished race. Its retry is booked before the
   * request, so a crash, a hang, or a second caller waits for it. The app
   * stores each race once, so a repeat is harmless.
   */
  private async sendReport(raceId: string) {
    const pending = this.reports().find(
      ({ report }) => report.raceId === raceId,
    );
    if (!pending || pending.nextAttemptAt > Date.now()) return;
    const attempts = pending.attempts + 1;
    const others = () =>
      this.reports().filter(({ report }) => report.raceId !== raceId);
    this.putReports([
      ...others(),
      { ...pending, attempts, nextAttemptAt: Date.now() + REPORT_RETRY_MS },
    ]);
    let done = false;
    try {
      const body = JSON.stringify(pending.report);
      const response = await fetch(this.env.APP_RESULTS_URL, {
        method: "POST",
        headers: {
          "content-type": "application/json",
          [ROOM_REPORT_SIGNATURE_HEADER]: await signRoomReport(
            this.env.ROOM_SERVER_SECRET,
            body,
          ),
        },
        body,
        signal: AbortSignal.timeout(REPORT_TIMEOUT_MS),
      });
      // Other refusals won't change on retry.
      const transient =
        response.status >= 500 ||
        response.status === 408 ||
        response.status === 429;
      done = response.ok || !transient;
      if (!response.ok) {
        console.error(`Room report ${response.status}`, raceId);
      }
    } catch (error) {
      console.error("Room report failed", error);
    }
    if (done || attempts >= REPORT_ATTEMPTS) this.putReports(others());
  }

  /** One alarm for the soonest of: a race deadline, a retry, cleanup. */
  private schedule() {
    const reports = this.reports();
    const times = reports.map(({ nextAttemptAt }) => nextAttemptAt);
    const deadline = this.state ? nextRoomDeadline(this.state) : null;
    if (deadline !== null) times.push(deadline);
    const emptySince = this.ctx.storage.kv.get<number>("emptySince");
    // Cleanup waits for reports, whose retries wake the room meanwhile.
    if (emptySince !== undefined && reports.length === 0) {
      times.push(emptySince + EMPTY_ROOM_MS);
    }
    if (times.length === 0) {
      void this.ctx.storage.deleteAlarm();
    } else {
      void this.ctx.storage.setAlarm(Math.min(...times));
    }
  }
}

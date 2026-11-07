import { DurableObject } from "cloudflare:workers";

import {
  contactEntrants,
  RoomContacts,
  roomContactMessage,
  type RoomContact,
} from "../../src/game/room/room-contacts";
import {
  isRoomCode,
  parseClientMessage,
  ROOM_CLOSE,
  ROOM_PROTOCOL,
  type RoomClientMessage,
  type RoomRaceReport,
  type RoomServerMessage,
} from "../../src/game/room/room-protocol";
import {
  applyRoomEvent,
  createRoomState,
  nextRoomDeadline,
  roomResume,
  roomSnapshot,
  type RoomEvent,
  type RoomKartState,
  type RoomOutcome,
  type RoomState,
} from "../../src/game/room/room-rules";
import {
  readRoomToken,
  ROOM_REPORT_SIGNATURE_HEADER,
  roomContactShape,
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
/**
 * A connection silent this long is treated as dropped: pages ping every
 * second in a race, and every 20 s otherwise, when the room may sleep. A
 * page busy loading a course is given the longer limit.
 */
const SILENT_RACING_MS = 5_000;
const SILENT_MS = 30_000;
/** A resent state this far behind the room's clock is history to others. */
const RESENT_RELAY_US = 500_000;
/** The close code a page sends to leave; any other holds its seat. */
const LEAVING = 1000;
const REPORT_ATTEMPTS = 20;

/**
 * Accepts and closes at once, so the page can read why. It is not a
 * hibernating socket: it only carries the refusal.
 */
function refuse(code: number) {
  const { 0: client, 1: server } = new WebSocketPair();
  server.accept();
  server.close(code);
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

/**
 * Which seat a socket speaks for, and when it was last heard (to the
 * second, so it isn't rewritten for every state); null once retired or
 * refused. It outlives hibernation, so a silent socket stays silent.
 */
type Attachment = { playerId: string; heardAt: number } | null;
/** How finely a socket's last-heard time is kept. */
const HEARD_GRAIN_MS = 1_000;

type PendingReport = {
  report: RoomRaceReport;
  attempts: number;
  nextAttemptAt: number;
};

/**
 * What a socket may send before it is closed, since each frame is billed: a
 * burst, refilled each second. A client sends about 32 frames a second (30
 * states, a ping, and gates), and a stalled network can deliver many at
 * once. Messages that change the
 * room, and kart states it stores, each a write, get a smaller allowance.
 */
const FRAME_BUDGET = { burst: 600, perSecond: 60 };
const ACTION_BUDGET = { burst: 20, perSecond: 5 };
/**
 * Resent batches that store something (a gate or a reset) have their own:
 * a 30 s outage's backlog is about 45 batches, every one of which may.
 */
const RESEND_BUDGET = { burst: 60, perSecond: 2 };

type Allowance = {
  at: number;
  frames: number;
  actions: number;
  resends: number;
};

function refill(allowance: Allowance, now: number) {
  const seconds = Math.max(0, now - allowance.at) / 1_000;
  allowance.at = now;
  allowance.frames = Math.min(
    FRAME_BUDGET.burst,
    allowance.frames + seconds * FRAME_BUDGET.perSecond,
  );
  allowance.actions = Math.min(
    ACTION_BUDGET.burst,
    allowance.actions + seconds * ACTION_BUDGET.perSecond,
  );
  allowance.resends = Math.min(
    RESEND_BUDGET.burst,
    allowance.resends + seconds * RESEND_BUDGET.perSecond,
  );
}
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

function attachmentOf(socket: WebSocket) {
  return socket.deserializeAttachment() as Attachment;
}

function seatOf(socket: WebSocket) {
  return attachmentOf(socket)?.playerId ?? null;
}

/** Stops a socket speaking for its seat, then closes it. */
function retire(socket: WebSocket, code: number) {
  socket.serializeAttachment(null satisfies Attachment);
  try {
    socket.close(code);
  } catch {
    // Already closing.
  }
}

function eventFor(
  message: Exclude<RoomClientMessage, { type: "ping" | "state" | "states" }>,
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
    case "sit_out":
      return { type: "sit_out", now, playerId, raceId: message.raceId };
  }
}

export class Room extends DurableObject<Env> {
  private state: RoomState | null;
  /** What each socket may still send; lost on hibernation. */
  private allowances = new WeakMap<WebSocket, Allowance>();
  /**
   * The race's touches between karts, kept in memory only: a race keeps the
   * room awake, and a restart at worst records a touch in progress twice.
   */
  private contacts = new RoomContacts();
  private contactsRace: string | null = null;

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
    // An emptied room starts afresh, on the joiner's course and versions.
    const current = this.state?.players.length
      ? this.state
      : createRoomState(token);
    const outcome = applyRoomEvent(current, {
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
    server.serializeAttachment({
      playerId,
      heardAt: Date.now(),
    } satisfies Attachment);
    send(server, {
      type: "welcome",
      you: playerId,
      resume: roomResume(outcome.state, playerId),
    });
    this.commit(outcome);
    return new Response(null, { status: 101, webSocket: client });
  }

  async webSocketMessage(socket: WebSocket, frame: string | ArrayBuffer) {
    const now = Date.now();
    let allowance = this.allowances.get(socket);
    if (allowance) {
      refill(allowance, now);
    } else {
      allowance = {
        at: now,
        frames: FRAME_BUDGET.burst,
        actions: ACTION_BUDGET.burst,
        resends: RESEND_BUDGET.burst,
      };
      this.allowances.set(socket, allowance);
    }
    allowance.frames -= 1;
    const heard = attachmentOf(socket);
    if (heard && now - heard.heardAt >= HEARD_GRAIN_MS) {
      socket.serializeAttachment({ ...heard, heardAt: now } satisfies Attachment);
    }
    const message = parseClientMessage(frame);
    if (
      message &&
      message.type !== "ping" &&
      message.type !== "state" &&
      message.type !== "states"
    ) {
      allowance.actions -= 1;
    }
    if (allowance.frames < 0 || allowance.actions < 0) {
      this.drop(socket, ROOM_CLOSE.protocol);
      return;
    }
    if (!message) {
      this.drop(socket, ROOM_CLOSE.protocol);
      return;
    }
    const playerId = seatOf(socket);
    if (!playerId || !this.state?.players.some(({ id }) => id === playerId)) {
      retire(socket, ROOM_CLOSE.closed);
      return;
    }
    // Busy sockets must not keep an overdue deadline waiting on the alarm.
    const deadline = nextRoomDeadline(this.state);
    if (deadline !== null && deadline <= now) {
      this.commit(applyRoomEvent(this.state, { type: "tick", now }));
    }
    this.dropSilent(now);
    if (message.type === "ping") {
      send(socket, { type: "pong", t: message.t, serverAt: now });
      return;
    }
    if (message.type === "state" || message.type === "states") {
      this.kartStates(socket, allowance, playerId, message, now);
      return;
    }
    this.commit(applyRoomEvent(this.state, eventFor(message, playerId, now)));
  }

  /**
   * Checks a live state, or a resent batch, through the rules. A batch is
   * stored once, however many gates or resets it holds, and spends one
   * write from the resend allowance, so a long outage's resend can't
   * exhaust the live one. Others hear only what is recent enough to draw: a live
   * state, or a resent one within half a second of the room's clock, in
   * order, so a reset among them still snaps.
   */
  private kartStates(
    socket: WebSocket,
    allowance: Allowance,
    playerId: string,
    message: Extract<RoomClientMessage, { type: "state" | "states" }>,
    now: number,
  ) {
    const resent = message.type === "states";
    const states = resent ? message.states : [message];
    let outcome: RoomOutcome | null = null;
    let changed = false;
    let stored = false;
    let report: RoomOutcome["report"];
    const relayed: string[] = [];
    const contacts: RoomContact[] = [];
    for (const state of states) {
      outcome = applyRoomEvent(outcome?.state ?? this.state!, {
        type: "state",
        now,
        playerId,
        state,
      });
      changed ||= outcome.changed;
      stored ||= outcome.changed || Boolean(outcome.persist);
      report ??= outcome.report;
      const racingAt = outcome.state.race?.racingAt;
      const recent =
        !resent ||
        (racingAt != null &&
          state.t >= (now - racingAt) * 1_000 - RESENT_RELAY_US);
      if (outcome.accepted && recent) {
        relayed.push(JSON.stringify({ ...state, type: "state", from: playerId }));
      }
      // Only live states touch: a resent one is history.
      if (outcome.accepted && resent) {
        this.raceContacts(outcome.state)?.resent(playerId, state);
      } else if (outcome.accepted) {
        contacts.push(...this.touches(outcome.state, playerId, state, now));
      }
    }
    if (!outcome) return;
    if (stored) {
      if (resent) allowance.resends -= 1;
      else allowance.actions -= 1;
      if (allowance.actions < 0 || allowance.resends < 0) {
        this.drop(socket, ROOM_CLOSE.protocol);
        return;
      }
    }
    this.commit({
      state: outcome.state,
      changed,
      persist: stored,
      report,
    });
    for (const frame of relayed) {
      for (const other of this.ctx.getWebSockets()) {
        if (other !== socket && seatOf(other)) send(other, frame);
      }
    }
    for (const contact of contacts) {
      for (const id of [contact.a, contact.b]) {
        const frame = JSON.stringify(roomContactMessage(contact, id));
        for (const seat of this.ctx.getWebSockets(id)) {
          if (seatOf(seat) === id) send(seat, frame);
        }
      }
    }
  }

  /** The racing race's contacts, started afresh for each race. */
  private raceContacts(state: RoomState) {
    const race = state.race;
    if (!race || race.racingAt === null) return null;
    if (this.contactsRace !== race.id) {
      this.contacts.clear();
      this.contactsRace = race.id;
    }
    return this.contacts;
  }

  /** The touches a kart's accepted live state opens with the others. */
  private touches(
    state: RoomState,
    playerId: string,
    kartState: RoomKartState,
    now: number,
  ): RoomContact[] {
    const contacts = this.raceContacts(state);
    const race = state.race;
    if (!contacts || !race || race.racingAt === null) return [];
    // Each kart races with the shape it started with.
    const racing = contactEntrants(state).map((entrant) => ({
      id: entrant.id,
      shape: roomContactShape(entrant.contact),
    }));
    const kart = racing.find(({ id }) => id === playerId);
    if (!kart) return [];
    return contacts.live(
      kart,
      kartState,
      Math.max(0, now - race.racingAt) * 1_000,
      racing.filter(({ id }) => id !== playerId),
    );
  }

  async webSocketClose(socket: WebSocket, code: number) {
    this.closed(socket, code === LEAVING ? "leave" : "disconnect");
  }

  async webSocketError(socket: WebSocket) {
    this.closed(socket, "disconnect");
  }

  /** Closes a misbehaving socket and frees its seat at once. */
  private drop(socket: WebSocket, code: number) {
    const playerId = seatOf(socket);
    retire(socket, code);
    if (playerId) this.vacate(playerId, "leave");
  }

  private closed(socket: WebSocket, how: "leave" | "disconnect") {
    const playerId = seatOf(socket);
    if (playerId) this.vacate(playerId, how, socket);
  }

  /**
   * Treats each silent socket as dropped: a page that vanished without a
   * close (a phone off the network) would otherwise hold its seat.
   */
  private dropSilent(now: number) {
    const racing = this.state?.race?.racingAt != null;
    for (const socket of this.ctx.getWebSockets()) {
      const heard = attachmentOf(socket);
      if (
        heard &&
        now - heard.heardAt > (racing ? SILENT_RACING_MS : SILENT_MS)
      ) {
        retire(socket, ROOM_CLOSE.silent);
        this.vacate(heard.playerId, "disconnect", socket);
      }
    }
  }

  /** When the next socket would fall silent, for the alarm. */
  private silenceDeadline() {
    const racing = this.state?.race?.racingAt != null;
    const times = this.ctx
      .getWebSockets()
      .flatMap((socket) => {
        const heard = attachmentOf(socket);
        return heard
          ? [heard.heardAt + (racing ? SILENT_RACING_MS : SILENT_MS)]
          : [];
      });
    return times.length === 0 ? null : Math.min(...times) + 1;
  }

  /**
   * A seat's last socket closed: a page leaving frees it, and any other
   * close holds it while the page reconnects.
   */
  private vacate(
    playerId: string,
    how: "leave" | "disconnect",
    closing?: WebSocket,
  ) {
    if (!this.state) return;
    // A seat another tab took over is still held.
    const held = this.ctx
      .getWebSockets(playerId)
      .some((socket) => socket !== closing && seatOf(socket) === playerId);
    if (held) return;
    this.commit(
      applyRoomEvent(this.state, { type: how, now: Date.now(), playerId }),
    );
  }

  async alarm() {
    const now = Date.now();
    this.dropSilent(now);
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
    // Nothing changed, so nothing is written: each write is billed.
    if (!outcome.changed && !outcome.persist && !outcome.report) return;
    const kv = this.ctx.storage.kv;
    kv.put("room", outcome.state);
    const emptySince = kv.get<number>("emptySince");
    if (this.isEmpty()) {
      if (emptySince === undefined) kv.put("emptySince", Date.now());
    } else if (emptySince !== undefined) {
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
    const silence = this.silenceDeadline();
    if (silence !== null) times.push(silence);
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

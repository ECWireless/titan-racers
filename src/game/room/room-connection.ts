import { RoomClock } from "./room-clock";
import {
  parseServerMessage,
  ROOM_CLOSE,
  ROOM_RESEND_BATCH,
  ROOM_SEAT_HOLD_MS,
  type RoomClientMessage,
  type RoomSnapshot,
} from "./room-protocol";
import { OpponentTracks } from "./room-race";

/**
 * A page's connection to its room: it fetches a join token, holds one
 * WebSocket, keeps the room's clock from pings, and collects opponents'
 * states. A dropped connection reconnects by itself to the same seat, and
 * the states the room missed meanwhile are resent, so the kart races on.
 */
export type RoomView = {
  status: "connecting" | "open" | "reconnecting" | "closed";
  you: string | null;
  room: RoomSnapshot | null;
  /** Each race's results as first seen; the room keeps only its latest. */
  results: Record<string, NonNullable<RoomSnapshot["lastRace"]>>;
  /** Why the room is gone, in player copy. */
  closedReason: string | null;
};

type KartStateMessage = Extract<RoomClientMessage, { type: "state" }>;
type RaceNotice = Extract<RoomClientMessage, { type: "loaded" | "sit_out" }>;

const INITIAL_PINGS = 5;
const INITIAL_PING_GAP_MS = 150;
/** How often the connection checks its pings. */
const CHECK_INTERVAL_MS = 1_000;
/** In a race, a ping a second, so silence shows within seconds. */
const RACE_PING_INTERVAL_MS = 1_000;
const RACE_PING_TIMEOUT_MS = 3_000;
/** Between races the room can sleep, so pings are rarer. */
const LOBBY_PING_INTERVAL_MS = 20_000;
const LOBBY_PING_TIMEOUT_MS = 8_000;
const TOKEN_TIMEOUT_MS = 10_000;
/** Joining that takes longer than this has failed. */
const WELCOME_TIMEOUT_MS = 15_000;
const RECONNECT_DELAYS_MS = [250, 1_000, 2_000, 4_000];
const RECONNECT_MAX_DELAY_MS = 5_000;
/** Past its seat's hold, reconnecting has stopped being worth it. */
const RECONNECT_GIVE_UP_MS = ROOM_SEAT_HOLD_MS + 10_000;
/** A minute of states at 30 a second, kept to resend. */
const BACKLOG_LIMIT = 1_800;
/** Closing without leaving (a frozen page, a silent room): the seat holds. */
const HOLD_CLOSE = 4_100;

export const CONNECTING_ROOM_VIEW: RoomView = {
  status: "connecting",
  you: null,
  room: null,
  results: {},
  closedReason: null,
};

const CLOSE_COPY: Record<number, string> = {
  [ROOM_CLOSE.closed]: "This room has closed.",
  [ROOM_CLOSE.full]: "This room is full. Up to 4 can race.",
  [ROOM_CLOSE.version]: "The game has updated. Refresh to join this room.",
  [ROOM_CLOSE.token]: "Couldn't join this room. Refresh to try again.",
  [ROOM_CLOSE.replaced]: "You joined this room in another tab.",
  [ROOM_CLOSE.protocol]: "Lost the room. Refresh to rejoin.",
};
const LOST_COPY = "Lost connection to the room. Refresh to rejoin.";

/** A random secret that lets this page, and only it, retake its seat. */
function randomSeatSecret() {
  let binary = "";
  for (const byte of crypto.getRandomValues(new Uint8Array(32))) {
    binary += String.fromCharCode(byte);
  }
  return btoa(binary)
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/, "");
}

export class RoomConnection {
  readonly clock = new RoomClock();
  readonly opponents = new OpponentTracks();
  private view = CONNECTING_ROOM_VIEW;
  private lastHeardAt = 0;
  private lastPingAt = 0;
  private lastCheckAt = 0;
  private readonly listeners = new Set<() => void>();
  private socket: WebSocket | null = null;
  private timers: number[] = [];
  private reconnectTimer: number | null = null;
  /** Bumped by each open and close, so only the latest open connects. */
  private generation = 0;
  private readonly seat = randomSeatSecret();
  /** When the connection dropped, while reconnecting. */
  private droppedAt: number | null = null;
  private reconnectAttempt = 0;
  /** This race's states, kept to resend what the room missed. */
  private backlog: KartStateMessage[] = [];
  /** Live states wait until the room has said what it missed. */
  private resumed = false;
  /**
   * That this page loaded or sat out its race, said again after each
   * reconnect, since one sent as the connection dropped may be lost; the
   * room ignores a repeat.
   */
  private raceNotice: RaceNotice | null = null;
  private removeLifecycleListeners: (() => void) | null = null;

  constructor(
    private readonly code: string,
    private readonly serverUrl: string,
  ) {}

  subscribe = (listener: () => void) => {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  };

  getView = () => this.view;

  private update(next: Partial<RoomView>) {
    this.view = { ...this.view, ...next };
    for (const listener of this.listeners) listener();
  }

  async open() {
    this.generation += 1;
    this.droppedAt = null;
    this.reconnectAttempt = 0;
    this.listenToLifecycle();
    this.update({ status: "connecting", closedReason: null });
    await this.connect(this.generation);
  }

  private async connect(generation: number) {
    let token: string;
    try {
      const response = await fetch(`/api/rooms/${this.code}/token`, {
        body: JSON.stringify({ seat: this.seat }),
        cache: "no-store",
        headers: { "content-type": "application/json" },
        method: "POST",
        signal: AbortSignal.timeout(TOKEN_TIMEOUT_MS),
      });
      if (!response.ok) throw new Error(String(response.status));
      ({ token } = (await response.json()) as { token: string });
    } catch {
      if (generation !== this.generation) return;
      if (this.droppedAt === null) {
        this.finish("Rooms are unavailable right now. Try again soon.");
      } else {
        this.scheduleReconnect();
      }
      return;
    }
    if (generation !== this.generation) return;
    const socket = new WebSocket(
      `${this.serverUrl}/v1/rooms/${this.code}?token=${encodeURIComponent(token)}`,
    );
    this.socket = socket;
    this.resumed = false;
    this.lastHeardAt = performance.now();
    this.lastPingAt = 0;
    this.lastCheckAt = performance.now();
    this.timers.push(
      window.setTimeout(() => {
        if (this.socket !== socket || this.resumed) return;
        if (this.droppedAt === null) {
          this.lost(socket, CLOSE_COPY[ROOM_CLOSE.token]);
        } else {
          this.drop(socket);
        }
      }, WELCOME_TIMEOUT_MS),
    );
    socket.addEventListener("open", () => {
      for (let index = 0; index < INITIAL_PINGS; index += 1) {
        this.timers.push(
          window.setTimeout(() => this.ping(), index * INITIAL_PING_GAP_MS),
        );
      }
      this.timers.push(
        window.setInterval(() => this.checkPings(socket), CHECK_INTERVAL_MS),
      );
    });
    socket.addEventListener("message", (event) => {
      if (this.socket !== socket) return;
      this.lastHeardAt = performance.now();
      this.receive(event.data);
    });
    socket.addEventListener("close", (event) => {
      if (this.socket !== socket) return;
      this.socket = null;
      this.stopTimers();
      const terminal = CLOSE_COPY[event.code];
      if (terminal) this.finish(terminal);
      else this.reconnect();
    });
  }

  private checkPings(socket: WebSocket) {
    const now = performance.now();
    // A check that ran late means this page was busy (loading a course, or
    // throttled in the background), so a pong may be waiting to be read.
    const late = now - this.lastCheckAt > 2 * CHECK_INTERVAL_MS;
    this.lastCheckAt = now;
    // Pings come each second from a race's start, to keep the clock, but
    // silence counts quickly only once it is racing.
    const race = this.view.room?.race;
    const racing = race?.racingAt != null;
    // Only an unanswered ping counts: a background tab's timers can run a
    // minute apart without the room having gone anywhere.
    if (
      !late &&
      this.lastPingAt > this.lastHeardAt &&
      now - this.lastPingAt >
        (racing ? RACE_PING_TIMEOUT_MS : LOBBY_PING_TIMEOUT_MS)
    ) {
      this.drop(socket);
    } else if (
      now - this.lastPingAt >=
      (race ? RACE_PING_INTERVAL_MS : LOBBY_PING_INTERVAL_MS)
    ) {
      this.ping();
    }
  }

  private ping() {
    const now = performance.now();
    // An earlier ping still unanswered keeps its own time.
    if (this.lastPingAt <= this.lastHeardAt) this.lastPingAt = now;
    this.sendNow({ type: "ping", t: now });
  }

  /**
   * A page coming back from the background checks its connection at once;
   * a frozen one closes it, holding its seat, and reconnects on resume.
   */
  private listenToLifecycle() {
    if (this.removeLifecycleListeners) return;
    const visible = () => {
      if (document.visibilityState === "visible" && this.socket) this.ping();
    };
    const freeze = () => {
      const socket = this.socket;
      if (!socket) return;
      this.socket = null;
      this.stopTimers();
      socket.close(HOLD_CLOSE);
      this.droppedAt = performance.now();
      this.update({ status: "reconnecting" });
    };
    const resume = () => {
      if (this.view.status !== "reconnecting" || this.socket) return;
      this.cancelReconnect();
      void this.connect(this.generation);
    };
    document.addEventListener("visibilitychange", visible);
    document.addEventListener("freeze", freeze);
    document.addEventListener("resume", resume);
    this.removeLifecycleListeners = () => {
      document.removeEventListener("visibilitychange", visible);
      document.removeEventListener("freeze", freeze);
      document.removeEventListener("resume", resume);
    };
  }

  private receive(frame: unknown) {
    const message = parseServerMessage(frame);
    if (!message) return;
    switch (message.type) {
      case "welcome": {
        // Back too late for the seat: a new one, with nothing to resend.
        if (this.view.you !== null && message.you !== this.view.you) {
          this.backlog = [];
        }
        if (
          this.raceNotice &&
          this.raceNotice.raceId === this.view.room?.race?.id
        ) {
          this.sendNow(this.raceNotice);
        }
        if (message.resume !== null) this.resend(message.resume);
        this.resumed = true;
        this.droppedAt = null;
        this.reconnectAttempt = 0;
        this.update({ status: "open", you: message.you });
        break;
      }
      case "pong":
        this.clock.addSample(message.t, message.serverAt, performance.now());
        break;
      case "state":
        this.opponents.add(message);
        break;
      case "room": {
        const previous = this.view.room?.race?.id;
        if (message.race?.id !== previous) {
          this.opponents.clear();
          this.backlog = [];
        }
        for (const entrant of message.race?.entrants ?? []) {
          if (entrant.left) this.opponents.hide(entrant.id);
        }
        const { lastRace } = message;
        this.update({
          room: message,
          results:
            lastRace && !this.view.results[lastRace.id]
              ? { ...this.view.results, [lastRace.id]: lastRace }
              : this.view.results,
        });
        break;
      }
    }
  }

  /** Sends the states after the last the room accepted, oldest first. */
  private resend(after: number) {
    const missed = this.backlog
      .filter(({ t }) => t > after)
      .map(({ t, p, q, v, s, r, g }) => ({ t, p, q, v, s, r, g }));
    for (let start = 0; start < missed.length; start += ROOM_RESEND_BATCH) {
      this.sendNow({
        type: "states",
        states: missed.slice(start, start + ROOM_RESEND_BATCH),
      });
    }
  }

  /**
   * Sends to the room. Kart states are also kept for this race, and while
   * the connection is down or not yet resumed they wait to be resent.
   */
  send(message: RoomClientMessage) {
    if (message.type === "loaded" || message.type === "sit_out") {
      this.raceNotice = message;
    }
    if (message.type === "state") {
      this.backlog.push(message);
      if (this.backlog.length > BACKLOG_LIMIT) this.backlog.shift();
      if (!this.resumed) return;
    }
    this.sendNow(message);
  }

  private sendNow(message: RoomClientMessage) {
    if (this.socket?.readyState === WebSocket.OPEN) {
      this.socket.send(JSON.stringify(message));
    }
  }

  /**
   * The room's race time at a local time (by default, now), or null before
   * racing has a start.
   */
  raceMicroseconds(localTime = performance.now()) {
    const racingAt = this.view.room?.race?.racingAt;
    if (racingAt == null || !this.clock.synced) return null;
    return Math.round((this.clock.serverNow(localTime) - racingAt) * 1_000);
  }

  /** Gives up on a socket that has gone quiet, and reconnects. */
  private drop(socket: WebSocket) {
    this.socket = null;
    this.stopTimers();
    socket.close(HOLD_CLOSE);
    this.reconnect();
  }

  /** Gives up on a socket for good. */
  private lost(socket: WebSocket, reason: string) {
    this.socket = null;
    socket.close();
    this.finish(reason);
  }

  private reconnect() {
    // A first join that never opened has nothing to come back to.
    if (this.view.you === null) {
      this.finish(LOST_COPY);
      return;
    }
    this.droppedAt ??= performance.now();
    this.update({ status: "reconnecting" });
    this.scheduleReconnect();
  }

  private scheduleReconnect() {
    if (
      this.droppedAt !== null &&
      performance.now() - this.droppedAt > RECONNECT_GIVE_UP_MS
    ) {
      this.finish(LOST_COPY);
      return;
    }
    const delay =
      RECONNECT_DELAYS_MS[this.reconnectAttempt] ?? RECONNECT_MAX_DELAY_MS;
    this.reconnectAttempt += 1;
    this.cancelReconnect();
    const generation = this.generation;
    this.reconnectTimer = window.setTimeout(() => {
      this.reconnectTimer = null;
      if (generation === this.generation && !this.socket) {
        void this.connect(generation);
      }
    }, delay);
  }

  private cancelReconnect() {
    if (this.reconnectTimer !== null) {
      window.clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }
  }

  private finish(reason: string) {
    this.stopTimers();
    this.cancelReconnect();
    this.update({ status: "closed", closedReason: reason });
  }

  private stopTimers() {
    for (const timer of this.timers) {
      window.clearTimeout(timer);
      window.clearInterval(timer);
    }
    this.timers = [];
  }

  /** Leaves the room, freeing the seat at once; a later open joins again. */
  close() {
    this.generation += 1;
    this.stopTimers();
    this.cancelReconnect();
    this.removeLifecycleListeners?.();
    this.removeLifecycleListeners = null;
    const socket = this.socket;
    this.socket = null;
    socket?.close(1000);
  }
}

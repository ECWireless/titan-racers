import { RoomClock } from "./room-clock";
import {
  parseServerMessage,
  ROOM_CLOSE,
  type RoomClientMessage,
  type RoomSnapshot,
} from "./room-protocol";
import { OpponentTracks } from "./room-race";

/**
 * A page's connection to its room: it fetches a join token, holds one
 * WebSocket, keeps the room's clock from pings, and collects opponents'
 * states. It does not reconnect; a dropped connection ends the visit.
 */
export type RoomView = {
  status: "connecting" | "open" | "closed";
  you: string | null;
  room: RoomSnapshot | null;
  /** Each race's results as first seen; the room keeps only its latest. */
  results: Record<string, NonNullable<RoomSnapshot["lastRace"]>>;
  /** Why the room is gone, in player copy. */
  closedReason: string | null;
};

const INITIAL_PINGS = 5;
const INITIAL_PING_GAP_MS = 150;
const PING_INTERVAL_MS = 5_000;
const TOKEN_TIMEOUT_MS = 10_000;
/** Joining that takes longer than this has failed. */
const WELCOME_TIMEOUT_MS = 15_000;
/** A ping unanswered for this long means the room is gone. */
const PING_TIMEOUT_MS = 15_000;

const CLOSE_COPY: Record<number, string> = {
  [ROOM_CLOSE.closed]: "This room has closed.",
  [ROOM_CLOSE.full]: "This room is full. Up to 4 can race.",
  [ROOM_CLOSE.version]: "The game has updated. Refresh to join this room.",
  [ROOM_CLOSE.token]: "Couldn't join this room. Refresh to try again.",
  [ROOM_CLOSE.replaced]: "You joined this room in another tab.",
  [ROOM_CLOSE.protocol]: "Lost the room. Refresh to rejoin.",
};
const LOST_COPY = "Lost connection to the room. Refresh to rejoin.";

export class RoomConnection {
  readonly clock = new RoomClock();
  readonly opponents = new OpponentTracks();
  private view: RoomView = {
    status: "connecting",
    you: null,
    room: null,
    results: {},
    closedReason: null,
  };
  private lastHeardAt = 0;
  private lastPingAt = 0;
  private readonly listeners = new Set<() => void>();
  private socket: WebSocket | null = null;
  private timers: number[] = [];
  /** Bumped by each open and close, so only the latest open connects. */
  private generation = 0;

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
    const generation = ++this.generation;
    this.update({ status: "connecting", closedReason: null });
    let token: string;
    try {
      const response = await fetch(`/api/rooms/${this.code}/token`, {
        body: "{}",
        cache: "no-store",
        headers: { "content-type": "application/json" },
        method: "POST",
        signal: AbortSignal.timeout(TOKEN_TIMEOUT_MS),
      });
      if (!response.ok) throw new Error(String(response.status));
      ({ token } = (await response.json()) as { token: string });
    } catch {
      if (generation === this.generation) {
        this.finish("Rooms are unavailable right now. Try again soon.");
      }
      return;
    }
    if (generation !== this.generation) return;
    const socket = new WebSocket(
      `${this.serverUrl}/v1/rooms/${this.code}?token=${encodeURIComponent(token)}`,
    );
    this.socket = socket;
    this.lastHeardAt = performance.now();
    this.timers.push(
      window.setTimeout(() => {
        if (this.socket === socket && this.view.status === "connecting") {
          this.drop(socket, CLOSE_COPY[ROOM_CLOSE.token]);
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
        window.setInterval(() => {
          // Only an unanswered ping counts: a background tab's timers can
          // run a minute apart without the room having gone anywhere.
          const now = performance.now();
          if (
            this.lastPingAt > this.lastHeardAt &&
            now - this.lastPingAt > PING_TIMEOUT_MS
          ) {
            this.drop(socket, LOST_COPY);
          } else {
            this.ping();
          }
        }, PING_INTERVAL_MS),
      );
    });
    socket.addEventListener("message", (event) => {
      this.lastHeardAt = performance.now();
      this.receive(event.data);
    });
    socket.addEventListener("close", (event) => {
      if (this.socket !== socket) return;
      this.socket = null;
      this.finish(CLOSE_COPY[event.code] ?? LOST_COPY);
    });
  }

  private ping() {
    const now = performance.now();
    // An earlier ping still unanswered keeps its own time.
    if (this.lastPingAt <= this.lastHeardAt) this.lastPingAt = now;
    this.send({ type: "ping", t: now });
  }

  private receive(frame: unknown) {
    const message = parseServerMessage(frame);
    if (!message) return;
    switch (message.type) {
      case "welcome":
        this.update({ status: "open", you: message.you });
        break;
      case "pong":
        this.clock.addSample(message.t, message.serverAt, performance.now());
        break;
      case "state":
        this.opponents.add(message);
        break;
      case "room": {
        const previous = this.view.room?.race?.id;
        if (message.race?.id !== previous) this.opponents.clear();
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

  send(message: RoomClientMessage) {
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

  /** Gives up on a socket that has gone quiet. */
  private drop(socket: WebSocket, reason: string) {
    this.socket = null;
    socket.close();
    this.finish(reason);
  }

  private finish(reason: string) {
    this.stopTimers();
    this.update({ status: "closed", closedReason: reason });
  }

  private stopTimers() {
    for (const timer of this.timers) {
      window.clearTimeout(timer);
      window.clearInterval(timer);
    }
    this.timers = [];
  }

  /** Leaves the room; a later open joins again. */
  close() {
    this.generation += 1;
    this.stopTimers();
    const socket = this.socket;
    this.socket = null;
    socket?.close(1000);
  }
}

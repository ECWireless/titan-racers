"use client";

import Image from "next/image";
import Link from "next/link";
import {
  type KeyboardEvent,
  type ReactNode,
  useEffect,
  useMemo,
  useRef,
  useState,
  useSyncExternalStore,
} from "react";

import { endRaceAudio, unlockRaceAudio } from "@/game/audio/race-audio";
import {
  BUNDLED_COURSE_DOCUMENTS,
  type CourseDocument,
} from "@/game/course/course-document";
import { FALLS_VIEW_PARK_COURSE_ID } from "@/game/course/course-ids";
import { publishedCourseRuntimeSchema } from "@/game/course/course-publication";
import { useControllerMenuNavigation } from "@/game/input/use-controller-menu-navigation";
import { pauseKartThumbnailRendering } from "@/game/kart/kart-thumbnail-renderer";
import { formatRaceTime } from "@/game/race/race-presentation";
import {
  CONNECTING_ROOM_VIEW,
  RoomConnection,
} from "@/game/room/room-connection";
import { ROOM_MIN_RACERS, type RoomSnapshot } from "@/game/room/room-protocol";
import {
  type CanvasRoom,
  opponentFootprint,
  opponentKart,
} from "@/game/room/room-race";
import { copyLink, copyNoteFor } from "@/lib/share-link";

import {
  COURSE_LOADING_FADE_MS,
  CourseLoadingScreen,
} from "./course-loading-screen";
import { HomeKartCard } from "./home-steps";
import {
  loadOfficialKartRoster,
  type PlayableOfficialKart,
  playableOfficialKarts,
} from "./official-karts";
import { SoloTimeTrialCanvas } from "./solo-time-trial-canvas";

/**
 * A private room: a lobby where each player picks a kart (which marks them
 * ready) and the host starts, then the race on the room's clock, then the
 * room's results and Race again. Joining needs only the link.
 */

type ActiveRace = {
  id: string;
  room: CanvasRoom;
  course: CourseDocument;
  kart: PlayableOfficialKart;
};

const noSubscription = () => () => {};

const PANEL =
  "grid gap-4 border border-titan-ice/18 bg-titan-black/72 p-5 backdrop-blur";
const LABEL =
  "font-mono text-[0.62rem] font-bold uppercase tracking-[0.18em] text-titan-muted";

function placeLabel(place: number) {
  return ["1st", "2nd", "3rd", "4th"][place - 1] ?? `${place}th`;
}

/** A remaining time in whole seconds, as m:ss. */
function formatCountdown(milliseconds: number) {
  const seconds = Math.max(0, Math.ceil(milliseconds / 1_000));
  return `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, "0")}`;
}

async function loadRoomCourse(courseId: string, revision: number) {
  const response = await fetch(
    `/api/courses/${courseId}/published?revision=${revision}`,
    { cache: "no-store", signal: AbortSignal.timeout(10_000) },
  );
  if (!response.ok) throw new Error("Course unavailable.");
  return publishedCourseRuntimeSchema.parse(await response.json()).document;
}

export function RoomPlay({ code }: { code: string }) {
  const serverUrl = process.env.NEXT_PUBLIC_ROOM_SERVER_URL?.trim() ?? "";
  const connection = useMemo(
    () => (serverUrl ? new RoomConnection(code, serverUrl) : null),
    [code, serverUrl],
  );
  useEffect(() => {
    if (!connection) return;
    void connection.open();
    return () => connection.close();
  }, [connection]);
  const view = useSyncExternalStore(
    connection?.subscribe ?? noSubscription,
    connection?.getView ?? (() => CONNECTING_ROOM_VIEW),
    () => CONNECTING_ROOM_VIEW,
  );

  const [karts, setKarts] = useState<PlayableOfficialKart[] | null>(null);
  useEffect(() => {
    let cancelled = false;
    void loadOfficialKartRoster()
      .then((roster) => {
        if (!cancelled) setKarts(playableOfficialKarts(roster));
      })
      .catch(() => {
        if (!cancelled) setKarts([]);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  // A kart chosen on home comes along in the link, once.
  const kartFromHomeRef = useRef<string | null | undefined>(undefined);
  useEffect(() => {
    if (view.status !== "open" || !connection) return;
    if (kartFromHomeRef.current === undefined) {
      const params = new URLSearchParams(window.location.search);
      kartFromHomeRef.current = params.get("kart");
      if (params.has("kart")) {
        window.history.replaceState(null, "", window.location.pathname);
      }
    }
    const kartId = kartFromHomeRef.current;
    if (kartId && karts?.some(({ document }) => document.kartId === kartId)) {
      kartFromHomeRef.current = null;
      connection.send({ type: "choose_kart", kartId });
    }
  }, [connection, karts, view.status]);

  const [activeRace, setActiveRace] = useState<ActiveRace | null>(null);
  // Why this page sits a race out, shown until that race is over.
  const [raceProblem, setRaceProblem] = useState<{
    raceId: string;
    message: string;
  } | null>(null);
  // The last race this page loaded, so it is entered only once.
  const enteredRaceRef = useRef<string | null>(null);
  const room = view.room;
  const you = view.you;
  const race = room?.race ?? null;
  const yourEntry = race?.entrants.find(({ id }) => id === you) ?? null;

  useEffect(() => {
    if (!connection || !race || !yourEntry || !karts) return;
    if (enteredRaceRef.current === race.id) return;
    enteredRaceRef.current = race.id;
    const raceId = race.id;
    // A race already under way can't be joined from scratch (a reload, or
    // a second tab, takes the seat back): this page sits it out, so no one
    // waits for it, and the player waits for the next.
    const sitOut = () => connection.send({ type: "sit_out", raceId });
    if (race.racingAt !== null) {
      sitOut();
      return;
    }
    const kartFor = (kartId: string) =>
      karts.find(({ document }) => document.kartId === kartId);
    const kart = kartFor(yourEntry.kartId);
    const opponents = race.entrants.flatMap((entrant) => {
      const opponent = kartFor(entrant.kartId);
      return entrant.id === you || !opponent
        ? []
        : [
            {
              id: entrant.id,
              kart: opponentKart(opponent.document, opponent.resolvedSnapshot),
              footprint: opponentFootprint(opponent.resolvedSnapshot),
              noLoadSpeed:
                opponent.resolvedSnapshot.physicalProfile.drivetrain
                  .noLoadSpeed,
            },
          ];
    });
    const courseRevision = room!.courseRevision;
    const courseId = room!.courseId;
    const slot = yourEntry.slot;
    void (async () => {
      try {
        // The room races the revision it was given; a kart republished
        // since sits this race out rather than race something else.
        if (!kart || kart.revision !== yourEntry.kartRevision) {
          sitOut();
          setRaceProblem({
            raceId,
            message:
              "Your kart was updated since you chose it. Refresh to race the next one.",
          });
          return;
        }
        const course = await loadRoomCourse(courseId, courseRevision);
        setActiveRace({
          id: raceId,
          course,
          kart,
          room: {
            slot,
            opponents,
            raceMicroseconds: (localTime) =>
              connection.raceMicroseconds(localTime),
            opponentPose: (id, time, frameSeconds, out) =>
              connection.opponents.pose(id, time, frameSeconds, out),
            opponentStats: () => connection.opponents.stats(),
            send: (message) => connection.send(message),
          },
        });
      } catch {
        sitOut();
        setRaceProblem({
          raceId,
          message: "The course couldn't be loaded for this race.",
        });
      }
    })();
  }, [connection, karts, race, room, you, yourEntry]);

  function leaveRace() {
    endRaceAudio();
    setActiveRace(null);
    setRaceProblem(null);
  }

  function leaveRoom() {
    endRaceAudio();
    connection?.close();
    window.location.assign("/");
  }

  function chooseKart(kartId: string) {
    // Inside the click: iPhone Safari allows race sound only from one.
    unlockRaceAudio();
    connection?.send({ type: "choose_kart", kartId });
  }

  if (!serverUrl) {
    return (
      <RoomMessage
        message="Racing friends is coming soon."
        onLeave={leaveRoom}
      />
    );
  }
  if (view.status === "closed") {
    return (
      <RoomMessage
        message={view.closedReason ?? "This room has closed."}
        onLeave={leaveRoom}
      />
    );
  }
  if (!room || !you || karts === null) {
    return <RoomMessage message="Joining the room…" onLeave={leaveRoom} />;
  }

  // The race and lobby carry on while the page reconnects.
  const reconnecting =
    view.status === "reconnecting" ? <ReconnectingNotice /> : null;

  if (activeRace) {
    return (
      <>
        {reconnecting}
        <RoomRace
          activeRace={activeRace}
          connection={connection!}
          key={activeRace.id}
          karts={karts}
          results={view.results[activeRace.id] ?? null}
          room={room}
          you={you}
          onLeaveRace={leaveRace}
          onLeaveRoom={leaveRoom}
          onRaceAgain={() => {
            const kartId = activeRace.kart.document.kartId;
            leaveRace();
            chooseKart(kartId);
          }}
          />
      </>
    );
  }

  return (
    <>
      {reconnecting}
      <RoomLobby
        code={code}
        karts={karts}
        problem={
          raceProblem && raceProblem.raceId === room.race?.id
            ? raceProblem.message
            : null
        }
        room={room}
        you={you}
        onChooseKart={chooseKart}
        onLeave={leaveRoom}
        onStart={() => {
          unlockRaceAudio();
          setRaceProblem(null);
          connection?.send({ type: "start" });
        }}
        />
    </>
  );
}

function ReconnectingNotice() {
  return (
    <p
      className="pointer-events-none fixed inset-x-0 top-[max(0.75rem,env(safe-area-inset-top))] z-[70] mx-auto w-fit border border-titan-hazard/50 bg-titan-black/90 px-4 py-2 font-mono text-xs font-bold uppercase tracking-[0.18em] text-titan-hazard"
      role="status"
    >
      Reconnecting…
    </p>
  );
}

// Back (Escape, or a controller's B) does nothing here: leaving a room is
// its own button, never a stray press.
function RoomFrame({ children }: { children: ReactNode }) {
  const menuRef = useRef<HTMLElement | null>(null);
  useControllerMenuNavigation({
    containerRef: menuRef,
    enabled: true,
    keyboard: true,
    navigationMode: "spatial",
  });
  return (
    <main
      className="relative z-10 mx-auto flex min-h-screen w-full max-w-5xl flex-col gap-8 px-4 py-6 text-titan-ice sm:px-8"
      ref={menuRef}
    >
      <header>
        <Link href="/" aria-label="Titan Racers home">
          <Image
            src="/titan-racers-logo.png"
            alt="Titan Racers"
            width={300}
            height={60}
            priority
            className="h-11 w-auto sm:h-14"
          />
        </Link>
      </header>
      {children}
    </main>
  );
}

function RoomMessage({
  message,
  onLeave,
}: {
  message: string;
  onLeave: () => void;
}) {
  return (
    <RoomFrame>
      <section className={`${PANEL} max-w-lg`} role="status">
        <p className="text-base leading-6">{message}</p>
        <button
          className="titan-button titan-button-secondary"
          data-controller-default="true"
          type="button"
          onClick={onLeave}
        >
          Back to home
        </button>
      </section>
    </RoomFrame>
  );
}

function RoomLobby({
  code,
  karts,
  problem,
  room,
  you,
  onChooseKart,
  onLeave,
  onStart,
}: {
  code: string;
  karts: PlayableOfficialKart[];
  problem: string | null;
  room: RoomSnapshot;
  you: string;
  onChooseKart: (kartId: string) => void;
  onLeave: () => void;
  onStart: () => void;
}) {
  const [copyNote, setCopyNote] = useState<string | null>(null);
  const me = room.players.find(({ id }) => id === you);
  const host = room.hostId === you;
  // A seat held for a dropped connection sits the next race out.
  const ready = room.players.filter(
    (player) => player.ready && player.connected,
  ).length;
  const away = room.players.some(({ connected }) => !connected);
  const racing = room.race !== null;
  const kartName = (kartId: string | null) =>
    karts.find(({ document }) => document.kartId === kartId)?.document.name ??
    null;

  let startNote: string;
  if (racing && room.race?.entrants.some(({ id }) => id === you)) {
    // Loading the course, or back from a reload after the race started.
    startNote =
      room.race.racingAt === null
        ? "Starting the race…"
        : "A race is under way without you. Choose a kart when it ends.";
  } else if (racing) {
    startNote = me?.ready
      ? "A race is under way. You're in the next one."
      : "A race is under way. Choose a kart to race the next one.";
  } else if (ready < ROOM_MIN_RACERS) {
    startNote =
      room.players.length < ROOM_MIN_RACERS
        ? "Share the link: you need at least one friend to race."
        : away
          ? "Waiting for everyone to reconnect and choose a kart."
          : "Waiting for everyone to choose a kart.";
  } else if (host) {
    startNote =
      ready < room.players.length
        ? away
          ? "Anyone reconnecting or still choosing waits for the next race."
          : "Anyone who hasn't chosen a kart waits for the next race."
        : "Everyone's ready.";
  } else {
    startNote = "The host starts the race.";
  }

  return (
    <RoomFrame>
      <section aria-labelledby="room-title" className="grid gap-6">
        <div className="grid gap-2">
          <p className={LABEL}>Race Friends · Falls View Park</p>
          <h1
            className="text-3xl font-black uppercase tracking-[-0.04em] sm:text-5xl"
            id="room-title"
          >
            Private room
          </h1>
          <p className="max-w-xl text-sm leading-6 text-titan-ice/72">
            Up to 4 can race. Anyone with this room&apos;s link can join, with
            or without an account.
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-3">
          <button
            className="titan-button titan-button-secondary"
            type="button"
            onClick={async () => {
              setCopyNote(null);
              const outcome = await copyLink(
                new URL(`/room/${code}`, window.location.origin).href,
              );
              setCopyNote(copyNoteFor(outcome));
            }}
          >
            Copy room link
          </button>
          <p aria-live="polite" className="font-mono text-xs text-titan-ice/76">
            {copyNote}
          </p>
        </div>

        {room.lastRace ? (
          <div className={PANEL}>
            <h2 className={LABEL}>Last race</h2>
            <RoomResultsList
              karts={karts}
              lastRace={room.lastRace}
              title="Last race"
              you={you}
            />
          </div>
        ) : null}

        <div className={PANEL}>
          <h2 className={LABEL}>
            Racers {room.players.length}/4
          </h2>
          <ul className="grid gap-2" aria-label="Racers in this room">
            {room.players.map((player) => (
              <li
                className="flex flex-wrap items-center justify-between gap-2 border-b border-titan-ice/10 pb-2 last:border-b-0 last:pb-0"
                key={player.id}
              >
                <span className="flex items-center gap-2 font-bold">
                  {player.name}
                  {player.id === you ? (
                    <span className="text-titan-hazard"> (you)</span>
                  ) : null}
                  {player.id === room.hostId ? (
                    <span className="border border-titan-ice/24 px-2 py-0.5 font-mono text-[0.56rem] uppercase tracking-[0.14em] text-titan-ice/70">
                      Host
                    </span>
                  ) : null}
                </span>
                <span className="font-mono text-xs uppercase tracking-[0.12em] text-titan-ice/70">
                  {!player.connected
                    ? "Reconnecting…"
                    : player.ready
                      ? `Ready · ${kartName(player.kartId) ?? "Kart"}`
                      : "Choosing a kart"}
                </span>
              </li>
            ))}
          </ul>
        </div>

        <div className="grid gap-3">
          <h2 className={LABEL}>Choose your kart</h2>
          {karts.length === 0 ? (
            <p className={PANEL} role="status">
              No official karts are available right now.
            </p>
          ) : (
            <div
              aria-label="Official kart selection"
              className="grid gap-4 md:grid-cols-3"
              role="group"
            >
              {karts.map((kart) => (
                <HomeKartCard
                  chosen={
                    me?.ready === true && me.kartId === kart.document.kartId
                  }
                  kart={kart}
                  key={kart.document.kartId}
                  onChoose={() => onChooseKart(kart.document.kartId)}
                />
              ))}
            </div>
          )}
        </div>

        <div className="grid max-w-xl gap-3">
          <p aria-live="polite" className="text-sm leading-6 text-titan-ice/76">
            {problem ?? startNote}
          </p>
          {host ? (
            <button
              className="titan-button titan-button-primary min-h-16 text-base"
              data-ui-sound="start"
              disabled={racing || ready < ROOM_MIN_RACERS || !me?.ready}
              type="button"
              onClick={onStart}
            >
              Start race
            </button>
          ) : null}
          <button
            className="titan-button titan-button-secondary"
            type="button"
            onClick={onLeave}
          >
            Leave room
          </button>
        </div>
      </section>
    </RoomFrame>
  );
}

function RoomResultsList({
  karts,
  lastRace,
  title,
  you,
}: {
  karts: PlayableOfficialKart[];
  lastRace: NonNullable<RoomSnapshot["lastRace"]>;
  title: string;
  you: string;
}) {
  return (
    <ol aria-label={`${title} results`} className="grid gap-2">
      {lastRace.entries.map((entry) => (
        <li
          className="grid grid-cols-[2.5rem_minmax(0,1fr)_auto] items-center gap-3 text-sm"
          key={entry.id}
        >
          <span className="font-mono font-black text-titan-hazard">
            {placeLabel(entry.place)}
          </span>
          <span className="grid min-w-0">
            <span className="truncate font-bold">
              {entry.name}
              {entry.id === you ? " (you)" : ""}
            </span>
            <span className="truncate font-mono text-[0.62rem] uppercase tracking-[0.12em] text-titan-ice/60">
              {karts.find(({ document }) => document.kartId === entry.kartId)
                ?.document.name ?? "Kart"}
            </span>
          </span>
          <span className="text-right font-mono font-bold tabular-nums">
            {entry.timeMicroseconds === null
              ? "Did not finish"
              : formatRaceTime(entry.timeMicroseconds, 3)}
          </span>
        </li>
      ))}
    </ol>
  );
}

type Cover = "on" | "leaving" | "off";

function RoomRace({
  activeRace,
  connection,
  karts,
  results,
  room,
  you,
  onLeaveRace,
  onLeaveRoom,
  onRaceAgain,
}: {
  activeRace: ActiveRace;
  connection: RoomConnection;
  karts: PlayableOfficialKart[];
  /** This race's results, kept even once the room moves on. */
  results: NonNullable<RoomSnapshot["lastRace"]> | null;
  room: RoomSnapshot;
  you: string;
  onLeaveRace: () => void;
  onLeaveRoom: () => void;
  onRaceAgain: () => void;
}) {
  const [thumbnailsPaused, setThumbnailsPaused] = useState(false);
  const [scene, setScene] = useState<"loading" | "ready" | "failed">(
    "loading",
  );
  const [cover, setCover] = useState<Cover>("on");
  const resultsRef = useRef<HTMLDivElement | null>(null);
  const primaryRef = useRef<HTMLButtonElement | null>(null);
  const race = room.race?.id === activeRace.id ? room.race : null;
  const yourEntry = race?.entrants.find(({ id }) => id === you) ?? null;
  // The race went on without this player, or was called off.
  const missed = !results && (!race || !yourEntry || yourEntry.left);

  // Leaving the race, however it ends, ends its sound.
  useEffect(() => () => endRaceAudio(), []);

  // The race renders without competing for the GPU with kart thumbnails.
  useEffect(() => {
    const pause = pauseKartThumbnailRendering();
    let cancelled = false;
    void pause.ready.then(() => {
      if (!cancelled) setThumbnailsPaused(true);
    });
    return () => {
      cancelled = true;
      pause.release();
    };
  }, []);

  // The loading screen lifts once this race is ready and the room has a
  // start time (the canvas then counts down to the room's start), or at
  // once if the race failed to load, to show why.
  const racingAt = race?.racingAt ?? null;
  useEffect(() => {
    if (cover !== "on" || scene === "loading") return;
    if (scene === "ready" && racingAt === null) return;
    const lift = window.setTimeout(() => setCover("leaving"), 0);
    return () => window.clearTimeout(lift);
  }, [cover, racingAt, scene]);
  useEffect(() => {
    if (cover !== "leaving") return;
    const reducedMotion = window.matchMedia(
      "(prefers-reduced-motion: reduce)",
    ).matches;
    const done = window.setTimeout(
      () => setCover("off"),
      reducedMotion ? 0 : COURSE_LOADING_FADE_MS,
    );
    return () => window.clearTimeout(done);
  }, [cover]);

  // Counts down to the race's end once someone has finished.
  const [endsInMs, setEndsInMs] = useState<number | null>(null);
  const endsBy = race?.endsBy ?? null;
  const someoneFinished =
    race?.entrants.some(({ finishMicroseconds }) => finishMicroseconds !== null) ??
    false;
  useEffect(() => {
    if (!someoneFinished || endsBy === null) return;
    const tick = () =>
      setEndsInMs(connection.clock.localTimeOf(endsBy) - performance.now());
    const timer = window.setInterval(tick, 500);
    const first = window.setTimeout(tick, 0);
    return () => {
      window.clearInterval(timer);
      window.clearTimeout(first);
    };
  }, [connection, endsBy, someoneFinished]);

  const ended = results !== null || missed;
  const backToRoom = results ? onRaceAgain : onLeaveRace;
  useControllerMenuNavigation({
    containerRef: resultsRef,
    enabled: ended,
    onBack: backToRoom,
  });
  // The dialog takes focus as it opens, from the race now inert beneath.
  useEffect(() => {
    if (!ended) return;
    const frame = requestAnimationFrame(() => primaryRef.current?.focus());
    return () => cancelAnimationFrame(frame);
  }, [ended]);

  function keepFocusInDialog(event: KeyboardEvent<HTMLDivElement>) {
    if (event.key !== "Tab") return;
    const buttons = Array.from(
      event.currentTarget.querySelectorAll<HTMLElement>("button:not(:disabled)"),
    );
    const first = buttons[0];
    const last = buttons.at(-1);
    if (!first || !last) return;
    if (event.shiftKey && document.activeElement === first) {
      event.preventDefault();
      last.focus();
    } else if (!event.shiftKey && document.activeElement === last) {
      event.preventDefault();
      first.focus();
    }
  }

  // As on home, the race counts as uncovered once the screen starts to fade.
  const covered = cover === "on";
  const enclosure =
    BUNDLED_COURSE_DOCUMENTS[FALLS_VIEW_PARK_COURSE_ID].enclosure;
  const youFinished = yourEntry?.finishMicroseconds != null;
  const yourPlace = race
    ? race.entrants.findIndex(({ id }) => id === you) + 1
    : 0;

  return (
    <>
      {/* A race that's over, or went on without this player, isn't run
          (or heard, or driven) behind the dialog. */}
      {thumbnailsPaused && !ended ? (
        <div className="contents" inert={covered}>
          <SoloTimeTrialCanvas
            courseDocument={activeRace.course}
            courseRevision={room.courseRevision}
            covered={covered}
            ghosts={false}
            kartDocument={activeRace.kart.document}
            kartRevision={activeRace.kart.revision}
            kartSnapshot={activeRace.kart.resolvedSnapshot}
            recordTelemetry={false}
            room={activeRace.room}
            submitsRuns={false}
            onExit={onLeaveRoom}
            onLoaded={(ready) => {
              setScene(ready ? "ready" : "failed");
              // A page that can't race says so, so no one waits for it.
              connection.send({
                type: ready ? "loaded" : "sit_out",
                raceId: activeRace.id,
              });
            }}
          />
        </div>
      ) : null}
      {race && !covered && results === null ? (
        <section
          aria-label="Standings"
          className="pointer-events-none fixed left-[max(0.75rem,env(safe-area-inset-left))] top-24 z-[60] grid gap-1 border border-titan-ice/18 bg-titan-black/72 p-2 font-mono text-xs text-titan-ice backdrop-blur"
        >
          <ol className="grid gap-1">
            {race.entrants.map((entrant, index) => (
              <li
                className={`flex gap-2 ${
                  entrant.id === you ? "text-titan-hazard" : ""
                } ${entrant.left ? "text-titan-ice/45 line-through" : ""}`}
                key={entrant.id}
              >
                <span className="tabular-nums">{index + 1}</span>
                <span className="max-w-32 truncate">
                  {entrant.id === you ? "You" : entrant.name}
                </span>
              </li>
            ))}
          </ol>
          {someoneFinished && endsInMs !== null ? (
            <p className="text-titan-ice/70">
              Race ends in {formatCountdown(endsInMs)}
            </p>
          ) : null}
        </section>
      ) : null}
      {youFinished && race && results === null ? (
        <div
          className="pointer-events-none fixed inset-x-0 top-1/3 z-[60] grid place-items-center px-4 text-center font-mono text-titan-ice"
          role="status"
        >
          <p className="border border-titan-hazard/50 bg-titan-black/90 px-6 py-4">
            <span className="block text-xs font-bold uppercase tracking-[0.2em] text-titan-hazard">
              Finished · {placeLabel(yourPlace)}
            </span>
            <span className="mt-1 block text-sm text-titan-ice/76">
              Waiting for the others
            </span>
          </p>
        </div>
      ) : null}
      {ended ? (
        <div
          aria-labelledby="room-results-title"
          aria-modal="true"
          className="fixed inset-0 z-[60] grid place-items-center overflow-y-auto bg-titan-black/76 px-4 py-4 font-mono text-titan-ice backdrop-blur-sm [place-items:safe_center]"
          role="dialog"
          onKeyDown={keepFocusInDialog}
        >
          <div
            className="grid w-full max-w-md gap-5 border border-titan-hazard/50 bg-titan-black/96 p-6 shadow-[0_24px_90px_rgb(0_0_0/0.7)]"
            ref={resultsRef}
          >
            <p
              className="text-xs font-bold uppercase tracking-[0.2em] text-titan-hazard"
              id="room-results-title"
            >
              {results ? "Results" : "Race over"}
            </p>
            {results ? (
              <RoomResultsList
                karts={karts}
                lastRace={results}
                title="This race"
                you={you}
              />
            ) : (
              <p className="text-sm leading-6 text-titan-ice/76">
                {!race
                  ? "The race was called off: not enough racers were ready in time."
                  : yourEntry?.left
                    ? "You were disconnected too long to finish this race."
                    : scene === "failed"
                      ? "The race goes on without you: the course couldn't be loaded on this device."
                      : "The race started without you: the course took too long to load on this device."}
              </p>
            )}
            <div className="grid gap-3">
              <button
                className="titan-button titan-button-primary"
                data-controller-default="true"
                data-ui-sound="start"
                ref={primaryRef}
                type="button"
                onClick={backToRoom}
              >
                {results ? "Race again" : "Back to the room"}
              </button>
              <button
                className="titan-button titan-button-secondary"
                type="button"
                onClick={onLeaveRoom}
              >
                Leave room
              </button>
            </div>
          </div>
        </div>
      ) : null}
      {cover !== "off" && !ended ? (
        <CourseLoadingScreen
          courseName={activeRace.course.name}
          enclosure={enclosure}
          leaving={cover === "leaving"}
          onExit={onLeaveRoom}
          onFirstFrame={() => undefined}
        />
      ) : null}
    </>
  );
}


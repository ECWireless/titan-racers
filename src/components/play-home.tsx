"use client";

import Image from "next/image";
import Link from "next/link";
import {
  type ReactNode,
  useEffect,
  useMemo,
  useRef,
  useState,
  useSyncExternalStore,
} from "react";

import {
  BUNDLED_COURSE_DOCUMENTS,
  type CourseDocument,
} from "@/game/course/course-document";
import {
  CURRENT_GUEST_COURSE_ID,
  SANDBOX_COURSE_ID,
} from "@/game/course/course-ids";
import { withAxisRampTest } from "@/game/course/axis-ramp-test";
import { prewarmCourseScene } from "@/game/course/course-prewarm";
import { loadCourseSurfaceImages } from "@/game/course/course-surface-textures";
import { publishedCourseRuntimeSchema } from "@/game/course/course-publication";
import { useControllerMenuNavigation } from "@/game/input/use-controller-menu-navigation";
import { racerOnboardingPath } from "@/lib/racer-username";
import type { KartAssemblyDocument } from "@/game/kart/kart-assembly-document";
import type { PersistedResolvedKartSnapshot } from "@/game/kart/kart-derivation";
import { pauseKartThumbnailRendering } from "@/game/kart/kart-thumbnail-renderer";
import {
  createBundledOfficialKartRoster,
  type OfficialKartRoster,
} from "@/game/kart/official-kart-roster";

import { drawsEnclosure } from "@/game/enclosure/enclosure-view";
import { fetchRaceGhost, fetchRacerGhost } from "@/game/ghost/board-ghost";
import {
  type BoardGhost,
  type DeviceGhost,
  type GhostChoice,
  type RacerGhostSource,
  readGhostChoice,
  readGhostSwitch,
  subscribeGhostChoice,
  subscribeGhostSwitch,
  writeGhostChoice,
  writeGhostSwitch,
} from "@/game/ghost/device-ghost";
import { loadAmmoPhysics } from "@/game/runtime/playcanvas-application";
import { loadTreeImages } from "@/game/enclosure/tree-images";
import type { CourseEnclosure } from "@/game/enclosure/island-three";
import { endRaceAudio, unlockRaceAudio } from "@/game/audio/race-audio";
import { RACE_LAP_COUNT } from "@/game/race/race-course";
import { formatRaceTime } from "@/game/race/race-presentation";
import { createRoomCode } from "@/game/room/room-protocol";
import { exactRacerUsernameSchema } from "@/lib/racer-username";

import {
  COURSE_LOADING_FADE_MS,
  CourseLoadingScreen,
} from "./course-loading-screen";
import type { CourseLoadTimings } from "./frame-budget-overlay";
import { keepKartThumbnail } from "./kart-thumbnail";
import {
  HomeChoice,
  HomeCourseCard,
  HomeKartCard,
  HomeBackdrop,
  HomeStartStep,
  type HomeStep,
  HomeStepFrame,
} from "./home-steps";
import {
  CourseEditorIcon,
  DashboardIcon,
  KartBuilderIcon,
  LeaderboardIcon,
  ProfileIcon,
  SignInIcon,
  SignOutIcon,
  SoundIcon,
} from "./menu-icons";
import {
  loadOfficialKartRoster,
  type PlayableOfficialKart,
  playableOfficialKarts,
} from "./official-karts";
import { SoloTimeTrialCanvas } from "./solo-time-trial-canvas";
import { StoredSoundToggle, VolumeControl } from "./setting-switch";

const UTILITY_MENU_ITEM =
  "flex items-center gap-3 border border-transparent px-4 py-3 font-mono text-xs font-bold uppercase tracking-[0.14em] text-titan-ice/78 transition hover:border-titan-ice/20 hover:bg-titan-ice/[0.06] hover:text-titan-hazard focus-visible:border-titan-hazard focus-visible:bg-titan-hazard/[0.08] focus-visible:text-titan-hazard focus-visible:outline-none";

// The loading screen stays up at least this long, even when the course is
// ready sooner.
const COURSE_LOADING_HOLD_MS = 2_500;

type CourseLoading = {
  courseName: string;
  enclosure: CourseEnclosure;
  leaving: boolean;
};

/** A course to race and its published revision, or null for the seed. */
type RaceCourse = { document: CourseDocument; revision: number | null };

// Non-production test hooks: `?sandbox-course` races the physics sandbox;
// `?axisRamp` adds the ramp to the habitat axis and records no telemetry, and
// `?axisRamp=<height>` starts the kart that many metres up it.
function axisRampStartHeight() {
  if (process.env.NODE_ENV === "production") return null;
  const value = new URLSearchParams(window.location.search).get("axisRamp");
  if (value === null) return null;
  const height = Number(value);
  return Number.isNaN(height) ? 0 : height;
}

function soloCourseId() {
  return process.env.NODE_ENV !== "production" &&
    (new URLSearchParams(window.location.search).has("sandbox-course") ||
      axisRampStartHeight() !== null)
    ? SANDBOX_COURSE_ID
    : CURRENT_GUEST_COURSE_ID;
}

// Only published revisions can count on the board, so these wait out a
// page busy loading the race; a server that is down still fails at once.
const PUBLISHED_LOAD_TIMEOUT_MS = 10_000;

async function loadPublishedCourse(courseId: string): Promise<RaceCourse> {
  const response = await fetch(
    `/api/courses/${courseId}/published`,
    {
      cache: "no-store",
      signal: AbortSignal.timeout(PUBLISHED_LOAD_TIMEOUT_MS),
    },
  );
  if (!response.ok) throw new Error("Published course unavailable.");
  const { document, revision } = publishedCourseRuntimeSchema.parse(
    await response.json(),
  );
  return { document, revision };
}

/** A racer named by a ghost link (`?ghost=<username>`), and where from. */
type RacerLink = { source: RacerGhostSource; username: string };

function parseRacerLink(search: string): RacerLink | null {
  const params = new URLSearchParams(search);
  const username = exactRacerUsernameSchema.safeParse(params.get("ghost") ?? "");
  if (!username.success) return null;
  return {
    source:
      params.get("from") === "leaderboard" ? "leaderboard_racer" : "shared_link",
    username: username.data,
  };
}

// The address is read in the browser only; home never navigates itself.
const subscribeToNothing = () => () => {};

// Each step after the first is a history entry on the same address, so the
// browser's or phone's back goes back a step. An entry also keeps the choices
// made so far, so coming back to home (from the leaderboard, or a reload)
// reopens the step it was on, and back still walks the steps before it.
const HISTORY_STEP_KEY = "titanHomeStep";
const HISTORY_KART_KEY = "titanHomeKart";
const HISTORY_COURSE_SKIPPED_KEY = "titanHomeCourseSkipped";
// A race adds its own entry on the last step's, so back leaves the race.
const HISTORY_RACING_KEY = "titanHomeRacing";
const HOME_STEPS: readonly HomeStep[] = ["start", "kart", "course", "race"];

function historyField(state: unknown, key: string): unknown {
  return state && typeof state === "object"
    ? (state as Record<string, unknown>)[key]
    : undefined;
}

function historyStep(state: unknown): HomeStep | null {
  const step = historyField(state, HISTORY_STEP_KEY);
  return HOME_STEPS.find((candidate) => candidate === step) ?? null;
}

/**
 * A step's history entry, with the choices made to reach it. It keeps the
 * current entry's other state, Next's own included: an entry written while
 * the page hydrates may come before Next starts adding it.
 */
function historyEntry(
  step: HomeStep,
  { courseSkipped, kartId }: { courseSkipped: boolean; kartId: string | null },
) {
  const current: unknown = window.history.state;
  const entry: Record<string, unknown> = {
    ...(current && typeof current === "object" ? current : {}),
    [HISTORY_COURSE_SKIPPED_KEY]: courseSkipped,
    [HISTORY_KART_KEY]: kartId,
    [HISTORY_STEP_KEY]: step,
  };
  delete entry[HISTORY_RACING_KEY];
  return entry;
}

function historyRacing(state: unknown) {
  return Boolean(
    state &&
      typeof state === "object" &&
      (state as Record<string, unknown>)[HISTORY_RACING_KEY],
  );
}

export function PlayHome() {
  const homeMenuRef = useRef<HTMLElement | null>(null);
  const utilityMenuRef = useRef<HTMLDivElement | null>(null);
  const utilityMenuButtonRef = useRef<HTMLButtonElement | null>(null);
  const resumeThumbnailRenderingRef = useRef<(() => void) | null>(null);
  const [mode, setMode] = useState<"home" | "solo">("home");
  const [step, setStep] = useState<HomeStep>("start");
  // A ghost link's racer fixes the course to their board.
  const [courseSkipped, setCourseSkipped] = useState(false);
  // Bumped when a step opens or a race exits, to focus its first choice;
  // the first screen opens focused too.
  const [focusRequest, setFocusRequest] = useState(1);
  const stepRef = useRef<HTMLDivElement | null>(null);
  // A race is starting or running, so back should leave it.
  const racingRef = useRef(false);
  const exitRaceRef = useRef<() => void>(() => undefined);
  const [courseLoading, setCourseLoading] = useState<CourseLoading | null>(
    null,
  );
  const [loadTimings, setLoadTimings] = useState<CourseLoadTimings>();
  const courseLoadingStartRef = useRef<number | null>(null);
  const stopPrewarmRef = useRef<(() => void) | null>(null);
  const coverPaintedRef = useRef<(() => void) | null>(null);
  const revealTimerRef = useRef<number | null>(null);
  const raceExitRef = useRef<(() => void) | null>(null);
  const [utilityMenuOpen, setUtilityMenuOpen] = useState(false);
  // Whether to offer Sign in or Sign out (neither until known), checked each
  // time the menu opens.
  const [signedIn, setSignedIn] = useState<boolean | null>(null);
  // Admins also get the dashboard; the server checks the role again there.
  const [admin, setAdmin] = useState(false);
  // A racer with no login method can't sign back in, so Sign out asks first.
  const [onlyThisBrowser, setOnlyThisBrowser] = useState(false);
  const [confirmingSignOut, setConfirmingSignOut] = useState(false);
  const keepRacingRef = useRef<HTMLButtonElement | null>(null);
  const [toast, setToast] = useState<string | null>(null);
  const [soloPending, setSoloPending] = useState(false);
  // Multiplayer opens a private room; it needs the room server's address.
  const roomsAvailable = Boolean(process.env.NEXT_PUBLIC_ROOM_SERVER_URL?.trim());
  const [rosterPending, setRosterPending] = useState(true);
  const [officialKarts, setOfficialKarts] = useState<PlayableOfficialKart[]>([]);
  const [selectedKartId, setSelectedKartId] = useState<string | null>(null);
  const [axisRampTest, setAxisRampTest] = useState(false);
  const [courseDocument, setCourseDocument] = useState<CourseDocument>(
    BUNDLED_COURSE_DOCUMENTS[CURRENT_GUEST_COURSE_ID],
  );
  const [courseRevision, setCourseRevision] = useState<number | null>(null);
  const [kartRevision, setKartRevision] = useState<number | null>(null);
  const [kartDocument, setKartDocument] = useState<
    KartAssemblyDocument | undefined
  >(undefined);
  const [kartSnapshot, setKartSnapshot] = useState<
    PersistedResolvedKartSnapshot | undefined
  >(undefined);
  const [boardGhost, setBoardGhost] = useState<BoardGhost | null>(null);
  // A ghost link's racer, raced unless another ghost is chosen. Their best
  // is undefined while it loads.
  const locationSearch = useSyncExternalStore(
    subscribeToNothing,
    () => window.location.search,
    () => "",
  );
  const racerGhost = useMemo(
    () => parseRacerLink(locationSearch),
    [locationSearch],
  );
  const racerGhostRequestRef = useRef<ReturnType<
    typeof fetchRacerGhost
  > | null>(null);
  const [racerGhostFound, setRacerGhostFound] = useState<
    Awaited<ReturnType<typeof fetchRacerGhost>> | undefined
  >(undefined);
  const [racerGhostChosen, setRacerGhostChosen] = useState(true);
  // Read from storage only in the browser; the server renders the default.
  const ghostChoice = useSyncExternalStore<GhostChoice>(
    subscribeGhostChoice,
    readGhostChoice,
    () => "course_best",
  );
  const ghostSwitch = useSyncExternalStore(
    subscribeGhostSwitch,
    readGhostSwitch,
    () => true,
  );

  function showStep(
    next: HomeStep,
    choices: { courseSkipped?: boolean; kartId?: string | null } = {},
  ) {
    window.history.pushState(
      historyEntry(next, {
        courseSkipped: choices.courseSkipped ?? courseSkipped,
        kartId: choices.kartId ?? selectedKartId,
      }),
      "",
    );
    setStep(next);
    setFocusRequest((request) => request + 1);
  }

  function goBack() {
    if (step === "start") return;
    if (historyStep(window.history.state) === step) {
      window.history.back();
      return;
    }
    // This step has no entry of its own (a reload's leftovers): step back
    // without one.
    setStep(
      step === "race"
        ? courseSkipped
          ? "kart"
          : "course"
        : step === "course"
          ? "kart"
          : "start",
    );
    setFocusRequest((request) => request + 1);
  }

  useControllerMenuNavigation({
    containerRef: homeMenuRef,
    // A press while the karts load would land on Back, so only back works.
    backOnly: step === "kart" && rosterPending,
    enabled: mode === "home" && courseLoading === null,
    keyboard: true,
    navigationMode: "spatial",
    onBack: utilityMenuOpen
      ? () => {
          setUtilityMenuOpen(false);
          utilityMenuButtonRef.current?.focus();
        }
      : step !== "start"
        ? goBack
        : undefined,
  });

  useEffect(() => {
    // A race the opening entry held is over, leaving its mode.
    const state: unknown = window.history.state;
    if (historyRacing(state)) {
      const rest = { ...(state as Record<string, unknown>) };
      delete rest[HISTORY_RACING_KEY];
      window.history.replaceState(rest, "");
    }
    const onPopState = (event: PopStateEvent) => {
      // Forward onto a finished race's entry steps past it.
      if (!racingRef.current && historyRacing(event.state)) {
        window.history.back();
        return;
      }
      // Back from a race leaves it, landing on the last step. The choices
      // made since stand.
      if (racingRef.current) exitRaceRef.current();
      setStep(historyStep(event.state) ?? "start");
      setFocusRequest((request) => request + 1);
    };
    window.addEventListener("popstate", onPopState);
    return () => {
      window.removeEventListener("popstate", onPopState);
      // Leaving home while a race loads ends it (and its hold on sound).
      if (racingRef.current) endRaceAudio();
    };
  }, []);

  // Coming back to home (from the leaderboard, or a reload) reopens the
  // step its entry holds, with the choices that reached it, once the entry
  // is read in the browser.
  const openingEntry = useSyncExternalStore<unknown>(
    subscribeToNothing,
    () => window.history.state,
    () => null,
  );
  const [entryRestored, setEntryRestored] = useState(false);
  // A leaderboard row's Race opens straight on the kart, once the address is
  // read in the browser, on an entry of its own (below).
  const [leaderboardEntry, setLeaderboardEntry] = useState(false);
  let entryReopened = false;
  if (!entryRestored && openingEntry !== null) {
    setEntryRestored(true);
    const openingStep = historyStep(openingEntry);
    if (openingStep) {
      entryReopened = true;
      const kartId = historyField(openingEntry, HISTORY_KART_KEY);
      if (typeof kartId === "string") setSelectedKartId(kartId);
      setCourseSkipped(
        historyField(openingEntry, HISTORY_COURSE_SKIPPED_KEY) === true,
      );
      setStep(openingStep);
      setFocusRequest((request) => request + 1);
      // A leaderboard row's link coming back reopens its step too.
      setLeaderboardEntry(true);
    }
  }
  if (
    !entryReopened &&
    racerGhost?.source === "leaderboard_racer" &&
    !leaderboardEntry
  ) {
    setLeaderboardEntry(true);
    setCourseSkipped(true);
    setStep("kart");
    setFocusRequest((request) => request + 1);
  }
  useEffect(() => {
    if (leaderboardEntry && !historyStep(window.history.state)) {
      window.history.pushState(
        historyEntry("kart", { courseSkipped: true, kartId: null }),
        "",
      );
    }
  }, [leaderboardEntry]);

  useEffect(() => {
    // Once mounted, the race records its own exit.
    exitRaceRef.current = () => (raceExitRef.current ?? exitSolo)();
  });

  // The karts arriving refocuses only their own step, and a ghost link's
  // racer appearing or going refocuses only the first screen.
  const kartsLoading = step === "kart" && rosterPending;
  const challengeShown =
    step === "start" &&
    racerGhost !== null &&
    typeof racerGhostFound !== "string";
  useEffect(() => {
    if (mode !== "home") return;
    stepRef.current
      ?.querySelector<HTMLElement>('[data-controller-default="true"]')
      ?.focus();
  }, [challengeShown, focusRequest, kartsLoading, mode, step]);

  useEffect(() => {
    let active = true;
    // Load physics and decode the course finishes and the habitat's trees
    // while the player picks a kart, so the race rarely waits for them. A
    // failed physics load is reported by the race, which receives the same
    // failure.
    loadAmmoPhysics().catch(() => {});
    void loadCourseSurfaceImages();
    if (drawsEnclosure()) void loadTreeImages();
    // Build the course's lighting and planting ahead too; a race stops
    // whatever is left, so it never competes with the race's own setup.
    const stopPrewarm = prewarmCourseScene(
      BUNDLED_COURSE_DOCUMENTS[soloCourseId()],
    );
    stopPrewarmRef.current = stopPrewarm;

    void (async () => {
      let roster: OfficialKartRoster;
      try {
        roster = await loadOfficialKartRoster();
      } catch {
        roster = createBundledOfficialKartRoster();
      }
      if (!active) return;

      const nextKarts = playableOfficialKarts(roster);
      // Draw pictures the server lacks while the player is on the first
      // screen, as the karts' step would; a race start drops what is left.
      for (const kart of nextKarts) {
        if (!kart.thumbnailSource) {
          keepKartThumbnail(kart.document).catch(() => undefined);
        }
      }
      setOfficialKarts(nextKarts);
      setSelectedKartId((current) =>
        nextKarts.some(({ document }) => document.kartId === current)
          ? current
          : (nextKarts[0]?.document.kartId ?? null),
      );
      setRosterPending(false);
    })();

    return () => {
      active = false;
      stopPrewarm();
    };
  }, []);

  useEffect(() => {
    if (!racerGhost) return;
    let active = true;
    const request = fetchRacerGhost(CURRENT_GUEST_COURSE_ID, racerGhost.username);
    racerGhostRequestRef.current = request;
    void request.then((ghost) => {
      if (active) setRacerGhostFound(ghost);
    });
    return () => {
      active = false;
    };
  }, [racerGhost]);

  // Each visit renews a signed-in racer's session cookie (at most daily);
  // a racer kept in this browser exists only through it.
  useEffect(() => {
    void fetch("/api/auth/get-session", { cache: "no-store" }).catch(
      () => undefined,
    );
  }, []);

  useEffect(() => {
    if (!utilityMenuOpen) return;
    let active = true;
    void fetch("/api/auth/get-session", { cache: "no-store" })
      .then((response) => (response.ok ? response.json() : null))
      .then(
        async (
          session: {
            session?: unknown;
            user?: { isAnonymous?: unknown };
          } | null,
        ) => {
          if (!active) return;
          setSignedIn(Boolean(session?.session));
          // Ask first until the racer is known to have a login method.
          const startedHere = session?.user?.isAnonymous === true;
          setOnlyThisBrowser(startedHere);
          const [isAdmin, methods] = session?.session
            ? await Promise.all([
                fetch("/api/admin", { cache: "no-store" })
                  .then((response) => (response.ok ? response.json() : null))
                  .then(
                    (role: { admin?: unknown } | null) => role?.admin === true,
                  ),
                // Only a racer who started on this browser can lack a method.
                startedHere
                  ? fetch("/api/profile", { cache: "no-store" })
                      .then((response) => (response.ok ? response.json() : null))
                      .then(
                        (profile: { loginMethods?: unknown[] } | null) =>
                          profile?.loginMethods?.length ?? null,
                      )
                  : null,
              ])
            : [false, null];
          if (!active) return;
          setAdmin(isAdmin);
          if (methods !== null) setOnlyThisBrowser(methods === 0);
        },
      )
      .catch(() => undefined);
    return () => {
      active = false;
    };
  }, [utilityMenuOpen]);

  useEffect(() => {
    if (confirmingSignOut) keepRacingRef.current?.focus();
  }, [confirmingSignOut]);

  async function signOut() {
    const response = await fetch("/api/auth/sign-out", {
      body: JSON.stringify({}),
      headers: { "content-type": "application/json" },
      method: "POST",
    }).catch(() => null);
    if (!response?.ok) {
      setToast("sign out failed, please retry");
      return;
    }
    setToast(null);
    setSignedIn(false);
    setAdmin(false);
    setOnlyThisBrowser(false);
    setUtilityMenuOpen(false);
    utilityMenuButtonRef.current?.focus();
  }

  useEffect(() => {
    if (!utilityMenuOpen) return;

    const closeFromOutside = (event: PointerEvent) => {
      if (
        event.target instanceof Node &&
        !utilityMenuRef.current?.contains(event.target)
      ) {
        setUtilityMenuOpen(false);
      }
    };
    const closeFromEscape = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;
      // Used here: back must not also take it a step back.
      event.preventDefault();
      setUtilityMenuOpen(false);
      utilityMenuButtonRef.current?.focus();
    };

    document.addEventListener("pointerdown", closeFromOutside);
    document.addEventListener("keydown", closeFromEscape);
    return () => {
      document.removeEventListener("pointerdown", closeFromOutside);
      document.removeEventListener("keydown", closeFromEscape);
    };
  }, [utilityMenuOpen]);

  useEffect(
    () => () => {
      resumeThumbnailRenderingRef.current?.();
      resumeThumbnailRenderingRef.current = null;
      if (revealTimerRef.current !== null) {
        window.clearTimeout(revealTimerRef.current);
      }
    },
    [],
  );

  async function startSoloTimeTrial() {
    const selectedKart = officialKarts.find(
      ({ document }) => document.kartId === selectedKartId,
    );
    if (!selectedKart) return;

    // Still inside the click: the only moment iPhone Safari allows sound.
    unlockRaceAudio();
    racingRef.current = true;
    window.history.pushState(
      {
        ...historyEntry("race", {
          courseSkipped,
          kartId: selectedKart.document.kartId,
        }),
        [HISTORY_RACING_KEY]: true,
      },
      "",
    );
    setUtilityMenuOpen(false);
    setSoloPending(true);
    stopPrewarmRef.current?.();
    const courseId = soloCourseId();
    const nextCoursePromise = loadPublishedCourse(courseId).catch(
      (): RaceCourse => ({
        document: BUNDLED_COURSE_DOCUMENTS[courseId],
        revision: null,
      }),
    );
    const thumbnailPause = pauseKartThumbnailRendering();
    resumeThumbnailRenderingRef.current = thumbnailPause.release;
    // The loading screen shows the bundled course's habitat at once, and
    // the race mounts only after its first frame, so the race's own setup
    // cannot delay it.
    let coverPainted = Promise.resolve();
    if (drawsEnclosure()) {
      const bundledCourse = BUNDLED_COURSE_DOCUMENTS[courseId];
      courseLoadingStartRef.current = performance.now();
      coverPainted = new Promise((resolve) => {
        coverPaintedRef.current = resolve;
      });
      setLoadTimings({
        coverFirstFrameMs: null,
        raceReadyMs: null,
        revealedMs: null,
      });
      setCourseLoading({
        courseName: bundledCourse.name,
        enclosure: bundledCourse.enclosure,
        leaving: false,
      });
    }
    // The ramp test changes the course, so it races no board's ghost. The
    // ghost loads once the revision is known, alongside the rest.
    const rampHeight = axisRampStartHeight();
    const linkedRacer = racerGhostChosen ? racerGhost : null;
    const linkedRequest = racerGhostRequestRef.current;
    const nextBoardGhostPromise =
      rampHeight === null
        ? nextCoursePromise.then(async (course): Promise<BoardGhost | null> => {
            // A linked racer's best counts only on the board being raced.
            const onBoard = (
              linked: Awaited<ReturnType<typeof fetchRacerGhost>> | null,
            ): linked is DeviceGhost =>
              typeof linked === "object" &&
              linked?.courseId === courseId &&
              linked.courseRevision === course.revision;
            let linked = linkedRacer ? await linkedRequest : null;
            if (linkedRacer && typeof linked === "object" && !onBoard(linked)) {
              // The course was published again since home opened: their
              // best on the new board, if they have one, kept for later
              // races too, and home says if they have none.
              const refreshed = fetchRacerGhost(courseId, linkedRacer.username);
              racerGhostRequestRef.current = refreshed;
              linked = await refreshed;
              setRacerGhostFound(
                onBoard(linked)
                  ? linked
                  : typeof linked === "string"
                    ? linked
                    : "none",
              );
            }
            if (linkedRacer && onBoard(linked)) {
              return { ghost: linked, kind: linkedRacer.source };
            }
            return fetchRaceGhost(courseId, course.revision, readGhostChoice());
          })
        : Promise.resolve(null);
    const [, nextCourse, , nextBoardGhost] = await Promise.all([
      thumbnailPause.ready,
      nextCoursePromise,
      coverPainted,
      nextBoardGhostPromise,
    ]);
    if (resumeThumbnailRenderingRef.current !== thumbnailPause.release) return;
    // Name the course being raced. The habitat view stays as it is rather
    // than restart for a published course's slightly different placement.
    setCourseLoading(
      (current) =>
        current && { ...current, courseName: nextCourse.document.name },
    );
    setBoardGhost(nextBoardGhost);
    setCourseDocument(
      rampHeight === null
        ? nextCourse.document
        : withAxisRampTest(nextCourse.document, rampHeight),
    );
    // The ramp test changes the course, so it no longer is that revision.
    setCourseRevision(rampHeight === null ? nextCourse.revision : null);
    setKartRevision(selectedKart.revision);
    setAxisRampTest(rampHeight !== null);
    setKartDocument(selectedKart.document);
    setKartSnapshot(selectedKart.resolvedSnapshot);
    setSoloPending(false);
    setMode("solo");
  }

  function markCoverPainted() {
    const start = courseLoadingStartRef.current;
    if (start !== null) {
      const coverFirstFrameMs = performance.now() - start;
      setLoadTimings(
        (timings) =>
          timings && {
            ...timings,
            coverFirstFrameMs: timings.coverFirstFrameMs ?? coverFirstFrameMs,
          },
      );
    }
    coverPaintedRef.current?.();
    coverPaintedRef.current = null;
  }

  // Lifts the loading screen once the race is ready and the minimum hold
  // has passed, or at once if the race failed to load.
  function revealRace(ready: boolean) {
    const start = courseLoadingStartRef.current;
    if (start === null) return;
    const raceReadyMs = performance.now() - start;
    setLoadTimings((timings) => timings && { ...timings, raceReadyMs });
    const hold = ready ? Math.max(0, COURSE_LOADING_HOLD_MS - raceReadyMs) : 0;
    revealTimerRef.current = window.setTimeout(() => {
      const revealedMs = performance.now() - start;
      setLoadTimings((timings) => timings && { ...timings, revealedMs });
      setCourseLoading((current) => current && { ...current, leaving: true });
      const reducedMotion = window.matchMedia(
        "(prefers-reduced-motion: reduce)",
      ).matches;
      revealTimerRef.current = window.setTimeout(
        () => {
          revealTimerRef.current = null;
          courseLoadingStartRef.current = null;
          setCourseLoading(null);
        },
        reducedMotion ? 0 : COURSE_LOADING_FADE_MS,
      );
    }, hold);
  }

  function exitSolo() {
    racingRef.current = false;
    // Leaving by Exit drops the race's entry; leaving by back already has.
    if (historyRacing(window.history.state)) window.history.back();
    // Covers a race left during loading, before its audio existed.
    endRaceAudio();
    if (revealTimerRef.current !== null) {
      window.clearTimeout(revealTimerRef.current);
      revealTimerRef.current = null;
    }
    courseLoadingStartRef.current = null;
    // Settles a start still waiting on the screen; it then sees the exit.
    coverPaintedRef.current?.();
    coverPaintedRef.current = null;
    resumeThumbnailRenderingRef.current?.();
    resumeThumbnailRenderingRef.current = null;
    setCourseLoading(null);
    setSoloPending(false);
    setMode("home");
    setFocusRequest((request) => request + 1);
  }

  const covered = courseLoading !== null && !courseLoading.leaving;
  // Offered while it loads or once found; a racer with no time is not.
  const racerGhostOffered =
    racerGhost !== null &&
    typeof racerGhostFound !== "string" &&
    racerGhostChosen;
  const racerGhostNote =
    racerGhost && typeof racerGhostFound === "string"
      ? `${
          racerGhostFound === "none"
            ? `@${racerGhost.username} has no time on this course yet`
            : `@${racerGhost.username}'s ghost couldn't be loaded`
        }, so you'll race ${
          !ghostSwitch
            ? "without a ghost"
            : ghostChoice === "own_best"
              ? "your best"
              : "the course best"
        }.`
      : null;
  const loadingScreen = courseLoading ? (
    <CourseLoadingScreen
      courseName={courseLoading.courseName}
      enclosure={courseLoading.enclosure}
      leaving={courseLoading.leaving}
      // Once mounted, the race records its own exit.
      onExit={() => (raceExitRef.current ?? exitSolo)()}
      onFirstFrame={markCoverPainted}
    />
  ) : null;

  // The loading screen keeps one place in the tree across both modes, so it
  // is not remounted when the race mounts beneath it.
  if (mode === "solo") {
    return (
      <>
        <div className="contents" inert={covered}>
          <SoloTimeTrialCanvas
            courseDocument={courseDocument}
            courseRevision={courseRevision}
            exitRef={raceExitRef}
            ghosts={!axisRampTest}
            kartDocument={kartDocument}
            kartRevision={kartRevision}
            kartSnapshot={kartSnapshot}
            boardGhost={boardGhost}
            loadTimings={loadTimings}
            covered={covered}
            recordTelemetry={!axisRampTest}
            showHabitatReadout={axisRampTest}
            submitsRuns={!axisRampTest}
            onExit={exitSolo}
            onLoaded={revealRace}
          />
        </div>
        {loadingScreen}
      </>
    );
  }

  const selectedKart = officialKarts.find(
    ({ document }) => document.kartId === selectedKartId,
  );
  // The course raced; outside production a test hook can swap the sandbox in.
  const stepCourse =
    BUNDLED_COURSE_DOCUMENTS[
      step === "start" ? CURRENT_GUEST_COURSE_ID : soloCourseId()
    ];
  const rail = (
    [
      ["kart", "Kart", selectedKart?.document.name ?? null],
      ["course", "Course", stepCourse.name],
      ["race", "Ghost", null],
    ] as const
  ).map(([railStep, label, value]) => ({
    current: railStep === step,
    label,
    value:
      HOME_STEPS.indexOf(railStep) < HOME_STEPS.indexOf(step) ||
      (railStep === "course" && courseSkipped)
        ? value
        : null,
  }));

  function chooseGhost(choice: GhostChoice | "none") {
    if (choice === "none") {
      writeGhostSwitch(false);
    } else {
      writeGhostChoice(choice);
      writeGhostSwitch(true);
    }
    setRacerGhostChosen(false);
  }

  let stepContent: ReactNode;
  if (step === "start") {
    stepContent = (
      <HomeStartStep
        challenge={
          racerGhost && typeof racerGhostFound !== "string"
            ? {
                time: racerGhostFound
                  ? formatRaceTime(racerGhostFound.timeMicroseconds, 3)
                  : null,
                username: racerGhost.username,
              }
            : null
        }
        multiplayerAvailable={roomsAvailable}
        note={racerGhostNote}
        // A new room, where each racer chooses a kart and the host the
        // course.
        onMultiplayer={() => {
          if (roomsAvailable) {
            window.location.assign(`/room/${createRoomCode()}`);
          }
        }}
        onTimeTrial={() => {
          setCourseSkipped(false);
          showStep("kart", { courseSkipped: false });
        }}
        onRaceChallenge={() => {
          setRacerGhostChosen(true);
          setCourseSkipped(true);
          showStep("kart", { courseSkipped: true });
        }}
      />
    );
  } else if (step === "kart") {
    stepContent = (
      <HomeStepFrame
        onBack={goBack}
        rail={rail}
        title="Choose your kart"
        titleId="kart-selection-title"
      >
        {rosterPending ? (
          <p
            className="border border-titan-ice/18 bg-titan-black p-5 font-mono text-sm text-titan-ice/70"
            role="status"
          >
            Loading official karts…
          </p>
        ) : officialKarts.length === 0 ? (
          <p
            className="border border-titan-ice/18 bg-titan-black p-5 text-sm text-titan-ice/72"
            role="status"
          >
            No official karts are currently published.
          </p>
        ) : (
          <div
            aria-label="Official kart selection"
            className="grid gap-4 md:grid-cols-3"
            role="group"
          >
            {officialKarts.map((kart) => (
              <HomeKartCard
                chosen={kart.document.kartId === selectedKartId}
                kart={kart}
                key={kart.document.kartId}
                onChoose={() => {
                  setSelectedKartId(kart.document.kartId);
                  showStep(courseSkipped ? "race" : "course", {
                    kartId: kart.document.kartId,
                  });
                }}
              />
            ))}
          </div>
        )}
      </HomeStepFrame>
    );
  } else if (step === "course") {
    stepContent = (
      <HomeStepFrame
        onBack={goBack}
        rail={rail}
        title="Choose your course"
        titleId="course-selection-title"
      >
        <div
          aria-label="Course selection"
          className="grid gap-4 md:max-w-md"
          role="group"
        >
          <HomeCourseCard
            course={stepCourse}
            laps={RACE_LAP_COUNT}
            onChoose={() => showStep("race")}
          />
        </div>
      </HomeStepFrame>
    );
  } else {
    stepContent = (
      <HomeStepFrame
        onBack={goBack}
        rail={rail}
        title="Choose your race"
        titleId="race-mode-title"
      >
        <div className="grid max-w-2xl gap-6">
          <div className="grid gap-2">
            <p
              className="font-mono text-[0.62rem] font-bold uppercase tracking-[0.18em] text-titan-muted"
              id="ghost-choice-label"
            >
              Ghost
            </p>
            <div
              aria-labelledby="ghost-choice-label"
              className="grid gap-2 sm:grid-cols-3"
              role="group"
            >
              {racerGhost && typeof racerGhostFound !== "string" ? (
                <HomeChoice
                  chosen={racerGhostChosen}
                  className="sm:col-span-3"
                  onChoose={() => setRacerGhostChosen(true)}
                >
                  @{racerGhost.username}
                  {racerGhostFound
                    ? ` · ${formatRaceTime(racerGhostFound.timeMicroseconds, 3)}`
                    : ""}
                </HomeChoice>
              ) : null}
              {(
                [
                  ["course_best", "Course best"],
                  ["own_best", "Your best"],
                  ["none", "No ghost"],
                ] as const
              ).map(([choice, label]) => (
                <HomeChoice
                  chosen={
                    !racerGhostOffered &&
                    (choice === "none"
                      ? !ghostSwitch
                      : ghostSwitch && ghostChoice === choice)
                  }
                  key={choice}
                  onChoose={() => chooseGhost(choice)}
                >
                  {label}
                </HomeChoice>
              ))}
            </div>
            <p
              className={
                racerGhostNote
                  ? "text-xs leading-5 text-titan-ice/70"
                  : "sr-only"
              }
              aria-live="polite"
            >
              {racerGhostNote}
            </p>
          </div>
          <button
            className="titan-button titan-button-primary min-h-16 text-base"
            data-controller-default="true"
            data-ui-sound="start"
            disabled={soloPending || !selectedKart}
            type="button"
            data-first-click-only=""
            onClick={(event) => {
              // A double-click's second click is not a second start.
              if (event.detail > 1) return;
              void startSoloTimeTrial();
            }}
          >
            {soloPending ? "Preparing race…" : "Start race"}
          </button>
        </div>
      </HomeStepFrame>
    );
  }

  const homeScreen = (
    <section
      inert={courseLoading !== null}
      ref={homeMenuRef}
      className="relative z-10 mx-auto flex min-h-svh w-full max-w-7xl flex-col px-5 py-6 sm:px-8 lg:px-12"
    >
      <header className="relative flex items-center justify-between gap-6">
        <Image
          src="/titan-racers-logo.png"
          alt="Titan Racers"
          width={300}
          height={60}
          priority
          className="h-11 w-auto sm:h-14"
        />
        <div className="relative" ref={utilityMenuRef}>
          <button
            aria-controls="home-utility-menu"
            aria-expanded={utilityMenuOpen}
            aria-label={
              utilityMenuOpen ? "Close utility menu" : "Open utility menu"
            }
            className="grid size-12 place-content-center gap-1.5 border border-titan-ice/50 bg-transparent text-titan-ice transition hover:border-titan-hazard hover:text-titan-hazard focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-titan-hazard"
            ref={utilityMenuButtonRef}
            type="button"
            onClick={() => {
              setConfirmingSignOut(false);
              // Another tab may have changed who is signed in, so offer
              // neither Sign in nor Sign out until this opening checks.
              if (!utilityMenuOpen) setSignedIn(null);
              setUtilityMenuOpen(!utilityMenuOpen);
            }}
          >
            <span className="h-0.5 w-6 bg-current" />
            <span className="h-0.5 w-6 bg-current" />
            <span className="h-0.5 w-6 bg-current" />
          </button>
          {utilityMenuOpen ? (
            <div
              className="absolute right-0 top-[calc(100%+0.6rem)] z-40 grid w-72 gap-2 border border-titan-ice/24 bg-titan-black/96 p-2 shadow-[0_24px_60px_rgb(0_0_0/0.68)] backdrop-blur"
              id="home-utility-menu"
            >
              <nav aria-label="Leaderboard, account, and protected tools" className="grid">
                {(
                  [
                    ["Leaderboard", "/leaderboard", <LeaderboardIcon key="icon" />],
                    ["Profile", "/profile", <ProfileIcon key="icon" />],
                    ["Kart Builder", "/admin/karts", <KartBuilderIcon key="icon" />],
                    ["Course Editor", "/admin/courses", <CourseEditorIcon key="icon" />],
                  ] as const
                ).map(([label, href, icon]) => (
                  <Link
                    className={UTILITY_MENU_ITEM}
                    href={href}
                    key={href}
                    onClick={() => setUtilityMenuOpen(false)}
                  >
                    {icon}
                    {label}
                  </Link>
                ))}
                {admin ? (
                  <Link
                    className={UTILITY_MENU_ITEM}
                    href="/admin"
                    onClick={() => setUtilityMenuOpen(false)}
                  >
                    <DashboardIcon />
                    Dashboard
                  </Link>
                ) : null}
                {signedIn === false ? (
                  <Link
                    className={UTILITY_MENU_ITEM}
                    // Signing in returns here, never to the profile.
                    href={racerOnboardingPath("/")}
                    onClick={() => setUtilityMenuOpen(false)}
                  >
                    <SignInIcon />
                    Sign in
                  </Link>
                ) : null}
                {signedIn && confirmingSignOut ? (
                  <div
                    aria-labelledby="home-sign-out-warning"
                    className="grid gap-1 border border-red-300/45 p-2"
                    role="group"
                  >
                    <p
                      className="px-2 py-1 text-sm leading-5 text-titan-ice"
                      id="home-sign-out-warning"
                    >
                      Sign out and lose this account? It lives only in this
                      browser, so there&apos;s no way back in.
                    </p>
                    <button
                      className={`${UTILITY_MENU_ITEM} text-left`}
                      ref={keepRacingRef}
                      type="button"
                      onClick={() => {
                        setConfirmingSignOut(false);
                        requestAnimationFrame(() =>
                          document.getElementById("home-sign-out-trigger")?.focus(),
                        );
                      }}
                    >
                      <span className="font-mono text-xs font-bold uppercase tracking-[0.14em]">
                        Keep racing
                      </span>
                    </button>
                    <button
                      className={`${UTILITY_MENU_ITEM} text-left`}
                      type="button"
                      onClick={() => void signOut()}
                    >
                      <span className="font-mono text-xs font-bold uppercase tracking-[0.14em]">
                        Sign out anyway
                      </span>
                    </button>
                  </div>
                ) : signedIn ? (
                  <button
                    className={`${UTILITY_MENU_ITEM} text-left`}
                    id="home-sign-out-trigger"
                    type="button"
                    onClick={() =>
                      onlyThisBrowser
                        ? setConfirmingSignOut(true)
                        : void signOut()
                    }
                  >
                    <SignOutIcon />
                    {/* The global `button { font: inherit }` overrides the
                        button's own font classes. */}
                    <span className="font-mono text-xs font-bold uppercase tracking-[0.14em]">
                      Sign out
                    </span>
                  </button>
                ) : null}
              </nav>
              <div className="border-t border-titan-ice/15 px-2 pb-2 pt-3">
                <div className="grid gap-2">
                  <StoredSoundToggle icon={<SoundIcon />} />
                  <VolumeControl />
                </div>
              </div>
            </div>
          ) : null}
        </div>
      </header>

      {/* On a phone or an upright tablet, the first screen sits below the
          backdrop's render. */}
      <div
        className={`grid flex-1 py-10 ${
          step === "start"
            ? "content-end pb-4 lg:content-center lg:pb-10"
            : "content-center"
        }`}
        key={step}
        ref={stepRef}
      >
        {stepContent}
      </div>
      <div
        className={
          toast
            ? "pointer-events-none fixed inset-x-0 bottom-6 z-30 flex justify-center font-mono text-xs font-bold uppercase tracking-[0.18em] text-titan-ice/78"
            : "sr-only"
        }
        role="status"
        aria-live="polite"
      >
        {toast ? (
          <span className="inline-flex border border-titan-orange bg-titan-black/78 px-4 py-3 shadow-[0_20px_60px_rgb(0_0_0/0.42)]">
            {toast}
          </span>
        ) : null}
      </div>
    </section>
  );

  return (
    <>
      <HomeBackdrop dim={step !== "start"} />
      {homeScreen}
      {loadingScreen}
    </>
  );
}

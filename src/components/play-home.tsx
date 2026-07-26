"use client";

import Image from "next/image";
import Link from "next/link";
import { useEffect, useRef, useState } from "react";

import {
  ROUGH_COURSE_DOCUMENT,
  type CourseDocument,
} from "@/game/course/course-document";
import { CURRENT_GUEST_COURSE_ID } from "@/game/course/course-ids";
import { publishedCourseRuntimeSchema } from "@/game/course/course-publication";
import { useControllerMenuNavigation } from "@/game/input/use-controller-menu-navigation";
import type { KartAssemblyDocument } from "@/game/kart/kart-assembly-document";
import type { PersistedResolvedKartSnapshot } from "@/game/kart/kart-derivation";
import {
  createBundledOfficialKartRoster,
  officialKartRosterSchema,
  type OfficialKartRoster,
} from "@/game/kart/official-kart-roster";

import { SoloTimeTrialCanvas } from "./solo-time-trial-canvas";

type PlayableOfficialKart = {
  assemblerCredit: string;
  document: KartAssemblyDocument;
  resolvedSnapshot: PersistedResolvedKartSnapshot;
};

async function loadPublishedCourse() {
  const response = await fetch(
    `/api/courses/${CURRENT_GUEST_COURSE_ID}/published`,
    {
      cache: "no-store",
      signal: AbortSignal.timeout(3_000),
    },
  );
  if (!response.ok) throw new Error("Published course unavailable.");
  return publishedCourseRuntimeSchema.parse(await response.json()).document;
}

async function loadOfficialKartRoster() {
  const response = await fetch("/api/karts/official", {
    cache: "no-store",
    signal: AbortSignal.timeout(3_000),
  });
  if (!response.ok) throw new Error("Official kart roster unavailable.");
  return officialKartRosterSchema.parse(await response.json());
}

function playableOfficialKarts(
  roster: OfficialKartRoster,
): PlayableOfficialKart[] {
  return roster.karts.map((entry) =>
    "runtime" in entry
      ? {
          assemblerCredit: entry.assemblerCredit,
          document: entry.runtime.document,
          resolvedSnapshot: entry.runtime.resolvedSnapshot,
        }
      : {
          assemblerCredit: entry.assemblerCredit,
          document: entry.document,
          resolvedSnapshot: entry.resolvedSnapshot,
        },
  );
}

export function PlayHome() {
  const homeMenuRef = useRef<HTMLElement | null>(null);
  const [mode, setMode] = useState<"home" | "solo">("home");
  const [toast, setToast] = useState<string | null>(null);
  const [soloPending, setSoloPending] = useState(false);
  const [rosterPending, setRosterPending] = useState(true);
  const [officialKarts, setOfficialKarts] = useState<PlayableOfficialKart[]>([]);
  const [selectedKartId, setSelectedKartId] = useState<string | null>(null);
  const [courseDocument, setCourseDocument] = useState<CourseDocument>(
    ROUGH_COURSE_DOCUMENT,
  );
  const [kartDocument, setKartDocument] = useState<
    KartAssemblyDocument | undefined
  >(undefined);
  const [kartSnapshot, setKartSnapshot] = useState<
    PersistedResolvedKartSnapshot | undefined
  >(undefined);

  useControllerMenuNavigation({
    containerRef: homeMenuRef,
    enabled: mode === "home",
    navigationMode: "spatial",
  });

  useEffect(() => {
    let active = true;

    void (async () => {
      let roster: OfficialKartRoster;
      try {
        roster = await loadOfficialKartRoster();
      } catch {
        roster = createBundledOfficialKartRoster();
      }
      if (!active) return;

      const nextKarts = playableOfficialKarts(roster);
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
    };
  }, []);

  function showComingSoon() {
    setToast("coming soon");
  }

  async function startSoloTimeTrial() {
    const selectedKart = officialKarts.find(
      ({ document }) => document.kartId === selectedKartId,
    );
    if (!selectedKart) return;

    setSoloPending(true);
    let nextCourse = ROUGH_COURSE_DOCUMENT;
    try {
      nextCourse = await loadPublishedCourse();
    } catch {
      // The bundled course preserves frictionless guest play.
    }
    setCourseDocument(nextCourse);
    setKartDocument(selectedKart.document);
    setKartSnapshot(selectedKart.resolvedSnapshot);
    setSoloPending(false);
    setMode("solo");
  }

  if (mode === "solo") {
    return (
      <SoloTimeTrialCanvas
        courseDocument={courseDocument}
        kartDocument={kartDocument}
        kartSnapshot={kartSnapshot}
        onExit={() => setMode("home")}
      />
    );
  }

  return (
    <section
      ref={homeMenuRef}
      className="relative z-10 mx-auto flex min-h-screen w-full max-w-7xl flex-col px-5 py-6 sm:px-8 lg:px-12"
    >
      <header className="flex items-center justify-between gap-6">
        <Image
          src="/titan-racers-logo.png"
          alt="Titan Racers"
          width={300}
          height={60}
          priority
          className="h-11 w-auto sm:h-14"
        />
        <nav
          aria-label="Protected tools"
          className="flex flex-wrap justify-end gap-2"
        >
          <Link
            className="border border-titan-ice/20 bg-titan-black/36 px-3 py-2 font-mono text-[0.68rem] font-bold uppercase tracking-[0.14em] text-titan-ice/72 backdrop-blur transition hover:border-titan-hazard hover:text-titan-hazard focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-titan-hazard"
            href="/admin/karts"
          >
            Kart Builder
          </Link>
          <Link
            className="border border-titan-ice/20 bg-titan-black/36 px-3 py-2 font-mono text-[0.68rem] font-bold uppercase tracking-[0.14em] text-titan-ice/72 backdrop-blur transition hover:border-titan-hazard hover:text-titan-hazard focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-titan-hazard"
            href="/editor"
          >
            Course Editor
          </Link>
        </nav>
      </header>

      <div className="grid flex-1 content-center gap-8 py-10 lg:grid-cols-[minmax(0,1fr)_20rem] lg:items-center">
        <section className="grid gap-5" aria-labelledby="kart-selection-title">
          <div className="grid gap-2">
            <p className="font-mono text-xs font-bold uppercase tracking-[0.22em] text-titan-hazard">
              Official roster
            </p>
            <h1
              className="text-3xl font-black uppercase tracking-[-0.04em] sm:text-5xl"
              id="kart-selection-title"
            >
              Choose your kart
            </h1>
          </div>

          {rosterPending ? (
            <p
              className="border border-titan-ice/18 bg-titan-black/68 p-5 font-mono text-sm text-titan-ice/70 backdrop-blur"
              role="status"
            >
              Loading official karts…
            </p>
          ) : officialKarts.length === 0 ? (
            <p
              className="border border-titan-ice/18 bg-titan-black/68 p-5 text-sm text-titan-ice/72 backdrop-blur"
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
              {officialKarts.map((kart) => {
                const selected = kart.document.kartId === selectedKartId;
                return (
                  <button
                    aria-pressed={selected}
                    className={`grid min-w-0 content-start gap-4 border p-4 text-left shadow-[0_20px_60px_rgb(0_0_0/0.35)] backdrop-blur transition ${
                      selected
                        ? "border-titan-hazard bg-titan-black/90"
                        : "border-titan-ice/18 bg-titan-black/68 hover:border-titan-ice/45"
                    }`}
                    key={kart.document.kartId}
                    type="button"
                    onClick={() => setSelectedKartId(kart.document.kartId)}
                  >
                    <span
                      aria-hidden="true"
                      className="h-2 w-full"
                      style={{
                        background: `linear-gradient(90deg, ${kart.document.visualIdentity.primaryColor} 0 72%, ${kart.document.visualIdentity.accentColor} 72% 100%)`,
                      }}
                    />
                    <span className="grid gap-1">
                      <strong className="text-xl font-black uppercase tracking-[-0.03em]">
                        {kart.document.name}
                      </strong>
                      <span className="font-mono text-[0.62rem] font-bold uppercase tracking-[0.12em] text-titan-hazard">
                        Assembled by {kart.assemblerCredit}
                      </span>
                    </span>
                    <span className="min-h-16 text-xs leading-5 text-titan-ice/68">
                      {kart.document.practicalDescriptor}
                    </span>
                    <span className="grid gap-2">
                      {Object.entries(kart.resolvedSnapshot.playerStats).map(
                        ([label, value]) => (
                          <span
                            className="grid grid-cols-[5.5rem_1fr_1.5rem] items-center gap-2"
                            key={label}
                          >
                            <span className="font-mono text-[0.56rem] font-bold uppercase tracking-[0.09em] text-titan-muted">
                              {label}
                            </span>
                            <span className="h-1.5 overflow-hidden bg-titan-ice/10">
                              <span
                                className="block h-full bg-titan-orange"
                                style={{ width: `${value}%` }}
                              />
                            </span>
                            <span className="text-right font-mono text-[0.6rem] font-bold">
                              {value}
                            </span>
                          </span>
                        ),
                      )}
                    </span>
                  </button>
                );
              })}
            </div>
          )}
        </section>

        <section
          aria-labelledby="game-mode-title"
          className="grid gap-4 border border-titan-ice/18 bg-titan-black/68 p-5 backdrop-blur"
        >
          <p
            className="font-mono text-xs font-bold uppercase tracking-[0.22em] text-titan-hazard"
            id="game-mode-title"
          >
            Choose game mode
          </p>
          <button
            className="titan-button titan-button-primary"
            data-controller-default="true"
            type="button"
            onClick={showComingSoon}
          >
            Race Friends
          </button>
          <button
            className="titan-button titan-button-secondary"
            disabled={rosterPending || !selectedKartId || soloPending}
            type="button"
            onClick={() => void startSoloTimeTrial()}
          >
            {soloPending ? "Preparing Race…" : "Solo Time Trial"}
          </button>
          <div
            className={
              toast
                ? "font-mono text-xs font-bold uppercase tracking-[0.18em] text-titan-ice/78"
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
      </div>
    </section>
  );
}

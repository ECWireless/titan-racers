"use client";

import Image from "next/image";
import Link from "next/link";
import { useRef, useState } from "react";

import {
  ROUGH_COURSE_DOCUMENT,
  type CourseDocument,
} from "@/game/course/course-document";
import { CURRENT_GUEST_COURSE_ID } from "@/game/course/course-ids";
import { publishedCourseRuntimeSchema } from "@/game/course/course-publication";
import { useControllerMenuNavigation } from "@/game/input/use-controller-menu-navigation";
import type { KartAssemblyDocument } from "@/game/kart/kart-assembly-document";
import { BALANCED_KART_ID } from "@/game/kart/balanced-kart-document";
import { publishedKartRuntimeSchema } from "@/game/kart/kart-publication";

import { SoloTimeTrialCanvas } from "./solo-time-trial-canvas";

const actions = [
  {
    label: "Race Friends",
    variant: "primary",
  },
  {
    label: "Solo Time Trial",
    variant: "secondary",
  },
] as const;

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

async function loadPublishedKart() {
  const response = await fetch(`/api/karts/${BALANCED_KART_ID}/published`, {
    cache: "no-store",
    signal: AbortSignal.timeout(3_000),
  });
  if (!response.ok) throw new Error("Published kart unavailable.");
  return publishedKartRuntimeSchema.parse(await response.json());
}

export function PlayHome() {
  const homeMenuRef = useRef<HTMLElement | null>(null);
  const [mode, setMode] = useState<"home" | "solo">("home");
  const [toast, setToast] = useState<string | null>(null);
  const [soloPending, setSoloPending] = useState(false);
  const [courseDocument, setCourseDocument] = useState<CourseDocument>(
    ROUGH_COURSE_DOCUMENT,
  );
  const [kartDocument, setKartDocument] = useState<
    KartAssemblyDocument | undefined
  >(undefined);
  const [kartSnapshot, setKartSnapshot] = useState<
    Awaited<ReturnType<typeof loadPublishedKart>>["resolvedSnapshot"] | undefined
  >(undefined);

  useControllerMenuNavigation({
    containerRef: homeMenuRef,
    enabled: mode === "home",
    navigationMode: "spatial",
  });

  function showComingSoon() {
    setToast("coming soon");
  }

  async function startSoloTimeTrial() {
    setSoloPending(true);
    const [courseResult, kartResult] = await Promise.allSettled([
      loadPublishedCourse(),
      loadPublishedKart(),
    ]);
    setCourseDocument(
      courseResult.status === "fulfilled"
        ? courseResult.value
        : ROUGH_COURSE_DOCUMENT,
    );
    setKartDocument(
      kartResult.status === "fulfilled"
        ? kartResult.value.document
        : undefined,
    );
    setKartSnapshot(
      kartResult.status === "fulfilled"
        ? kartResult.value.resolvedSnapshot
        : undefined,
    );
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
        <nav aria-label="Protected tools" className="flex flex-wrap justify-end gap-2">
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

      <div className="flex flex-1 items-center justify-center py-16 text-center">
        <div className="w-full max-w-md">
          <p className="mb-4 font-mono text-xs font-bold uppercase tracking-[0.22em] text-titan-hazard">
            Choose game mode
          </p>
          <div className="grid gap-4">
            {actions.map((action) => (
              <button
                key={action.label}
                data-controller-default={
                  action.label === "Race Friends" ? "true" : undefined
                }
                disabled={action.label === "Solo Time Trial" && soloPending}
                className={
                  action.variant === "primary"
                    ? "titan-button titan-button-primary"
                    : "titan-button titan-button-secondary"
                }
                type="button"
                onClick={
                  action.label === "Solo Time Trial"
                    ? () => void startSoloTimeTrial()
                    : showComingSoon
                }
              >
                {action.label === "Solo Time Trial" && soloPending
                  ? "Preparing Race…"
                  : action.label}
              </button>
            ))}
          </div>
          <div
            className="mt-5 min-h-10 font-mono text-xs font-bold uppercase tracking-[0.18em] text-titan-ice/78"
            role="status"
            aria-live="polite"
          >
            {toast ? (
              <span className="inline-flex border border-titan-orange bg-titan-black/78 px-4 py-3 shadow-[0_20px_60px_rgb(0_0_0/0.42)]">
                {toast}
              </span>
            ) : null}
          </div>
        </div>
      </div>
    </section>
  );
}

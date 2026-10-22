"use client";

import Image from "next/image";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useRef, useState } from "react";

import type { OfficialCourseId } from "@/game/course/course-ids";
import { useControllerMenuNavigation } from "@/game/input/use-controller-menu-navigation";
import { racerOnboardingPath } from "@/lib/racer-username";

import {
  courseEditorPath,
  persistedCourseRevisionSchema,
} from "./course-editor-access";

export type OfficialCourseRosterCard = {
  courseId: OfficialCourseId;
  name: string;
  purpose: string;
};

type DraftState =
  | { action: "checking" | "create" | "onboard" | "open" | "sign-in" }
  | {
      action: "continue";
      name: string;
      publishedRevision: number | null;
      revision: number;
    };

const draftActionLabels = {
  checking: "Checking…",
  continue: "Edit",
  create: "Create",
  onboard: "Complete account",
  open: "Open editor",
  "sign-in": "Sign in",
} as const satisfies Record<DraftState["action"], string>;

export function OfficialCourseRosterAccess({
  officialCourses,
}: {
  officialCourses: OfficialCourseRosterCard[];
}) {
  const rosterRef = useRef<HTMLElement | null>(null);
  const router = useRouter();
  const [draftStates, setDraftStates] = useState<
    Partial<Record<OfficialCourseId, DraftState>>
  >({});

  useControllerMenuNavigation({
    containerRef: rosterRef,
    enabled: true,
    navigationMode: "spatial",
    onBack: () => router.push("/"),
  });

  useEffect(() => {
    let active = true;
    for (const { courseId } of officialCourses) {
      void (async () => {
        let nextState: DraftState;
        try {
          const response = await fetch(`/api/admin/courses/${courseId}`, {
            cache: "no-store",
            credentials: "include",
            signal: AbortSignal.timeout(3_000),
          });
          if (response.status === 200) {
            const revision = persistedCourseRevisionSchema.parse(
              await response.json(),
            );
            nextState = {
              action: "continue",
              name: revision.document.name,
              publishedRevision: revision.publication?.revision ?? null,
              revision: revision.revision,
            };
          } else {
            nextState = {
              action:
                response.status === 404
                  ? "create"
                  : response.status === 428
                    ? "onboard"
                    : response.status === 401 || response.status === 403
                      ? "sign-in"
                      : "open",
            };
          }
        } catch {
          nextState = { action: "open" };
        }
        if (active) {
          setDraftStates((current) => ({ ...current, [courseId]: nextState }));
        }
      })();
    }
    return () => {
      active = false;
    };
  }, [officialCourses]);

  return (
    <main
      ref={rosterRef}
      className="relative min-h-screen overflow-hidden bg-titan-black px-5 py-6 text-titan-ice sm:px-8 lg:px-12"
    >
      <div className="absolute inset-0 bg-[radial-gradient(circle_at_50%_15%,rgb(52_64_74/0.42),transparent_42%),linear-gradient(145deg,rgb(7_7_6),rgb(20_18_15))]" />
      <div className="relative mx-auto grid w-full max-w-7xl gap-10">
        <header className="flex flex-wrap items-center justify-between gap-6">
          <Link
            aria-label="Back to racing"
            className="focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-titan-hazard"
            href="/"
          >
            <Image
              src="/titan-racers-logo.png"
              alt="Titan Racers"
              width={300}
              height={60}
              priority
              className="h-11 w-auto sm:h-14"
            />
          </Link>
          <Link className="titan-button titan-button-secondary" href="/">
            Back to racing
          </Link>
        </header>

        <section className="grid gap-4">
          <p className="font-mono text-xs font-bold uppercase tracking-[0.22em] text-titan-hazard">
            Protected tooling
          </p>
          <div className="grid max-w-3xl gap-3">
            <h1 className="text-4xl font-black uppercase tracking-[-0.04em] sm:text-6xl">
              Official Courses
            </h1>
            <p className="max-w-2xl text-sm leading-6 text-titan-ice/70 sm:text-base">
              Select an official course to create its first draft from its
              seed or continue editing its latest revision.
            </p>
          </div>
        </section>

        <section
          aria-label="Official course drafts"
          className="grid gap-5 md:grid-cols-2"
        >
          {officialCourses.map((course, index) => {
            const draft = draftStates[course.courseId] ?? {
              action: "checking" as const,
            };
            const editorPath = courseEditorPath(course.courseId);
            const name = draft.action === "continue" ? draft.name : course.name;
            return (
              <article
                key={course.courseId}
                className="grid min-w-0 gap-6 border border-titan-ice/18 bg-titan-black/72 p-5 shadow-[0_24px_70px_rgb(0_0_0/0.38)] backdrop-blur sm:p-6"
              >
                <div className="grid gap-2">
                  <h2 className="text-2xl font-black uppercase tracking-[-0.03em]">
                    {name}
                  </h2>
                  <p className="min-h-12 text-sm leading-6 text-titan-ice/68">
                    {course.purpose}
                  </p>
                </div>
                <p className="font-mono text-[0.65rem] font-bold uppercase tracking-[0.13em] text-titan-muted">
                  {draft.action === "continue"
                    ? `Draft r${draft.revision} · Published ${
                        draft.publishedRevision
                          ? `r${draft.publishedRevision}`
                          : "none"
                      }`
                    : draft.action === "create"
                      ? "No draft yet"
                      : " "}
                </p>
                <Link
                  aria-label={`${draftActionLabels[draft.action]} ${name}`}
                  className="titan-button titan-button-primary mt-auto"
                  data-controller-default={index === 0 ? "true" : undefined}
                  href={
                    draft.action === "onboard"
                      ? racerOnboardingPath(editorPath)
                      : editorPath
                  }
                >
                  {draftActionLabels[draft.action]}
                </Link>
              </article>
            );
          })}
        </section>
      </div>
    </main>
  );
}

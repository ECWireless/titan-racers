"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { z } from "zod";

import {
  courseDocumentSchema,
  ROUGH_COURSE_DOCUMENT,
} from "@/game/course/course-document";
import { COURSE_EDITOR_OBJECT_LIMIT } from "@/game/editor/course-editor-document";

import { CourseEditorShell } from "./course-editor-shell";

export const COURSE_EDITOR_COURSE_ID = "rough-course";

export const persistedCourseRevisionSchema = z
  .strictObject({
    authorUserId: z.string().min(1),
    courseId: z.string().min(1),
    createdAt: z.string().datetime(),
    document: courseDocumentSchema,
    revision: z.number().int().positive(),
    schemaVersion: z.number().int().positive(),
  })
  .superRefine((revision, context) => {
    if (revision.document.objects.length > COURSE_EDITOR_OBJECT_LIMIT) {
      context.addIssue({
        code: "custom",
        message: `The course editor supports at most ${COURSE_EDITOR_OBJECT_LIMIT} objects.`,
        path: ["document", "objects"],
      });
    }
  });

export type CourseEditorRevision = z.infer<
  typeof persistedCourseRevisionSchema
>;

type AccessState =
  | { status: "loading" }
  | { message: string; status: "error" }
  | { status: "unauthenticated" }
  | { status: "forbidden" }
  | { status: "not-found" }
  | { revision: CourseEditorRevision; status: "ready" };

async function resolveAccessState(): Promise<AccessState> {
  try {
    const response = await fetch(`/api/admin/courses/${COURSE_EDITOR_COURSE_ID}`, {
      cache: "no-store",
      credentials: "include",
    });

    if (response.status === 401) {
      return { status: "unauthenticated" };
    }

    if (response.status === 403) {
      return { status: "forbidden" };
    }

    if (response.status === 404) {
      return { status: "not-found" };
    }

    if (!response.ok) {
      return {
        message:
          response.status === 503
              ? "Course editing is not configured in this environment."
              : "The course revision could not be loaded.",
        status: "error",
      };
    }

    const revision = persistedCourseRevisionSchema.parse(await response.json());
    return { revision, status: "ready" };
  } catch {
    return {
      message: "The course revision response was unavailable or invalid.",
      status: "error",
    };
  }
}

export function CourseEditorAccess() {
  const [accessState, setAccessState] = useState<AccessState>({
    status: "loading",
  });
  const [signInPending, setSignInPending] = useState(false);
  const [signOutPending, setSignOutPending] = useState(false);
  const [initializationPending, setInitializationPending] = useState(false);

  async function loadCourse() {
    setAccessState({ status: "loading" });
    setAccessState(await resolveAccessState());
  }

  useEffect(() => {
    let active = true;

    void resolveAccessState().then((nextState) => {
      if (active) {
        setAccessState(nextState);
      }
    });

    return () => {
      active = false;
    };
  }, []);

  async function signInWithGoogle() {
    setSignInPending(true);

    try {
      const response = await fetch("/api/auth/sign-in/social", {
        body: JSON.stringify({ callbackURL: "/editor", provider: "google" }),
        headers: { "content-type": "application/json" },
        method: "POST",
      });

      if (!response.ok) {
        throw new Error("Google sign-in could not be started.");
      }

      const payload = z
        .object({ url: z.string().url() })
        .parse(await response.json());
      window.location.assign(payload.url);
    } catch {
      setAccessState({
        message: "Google sign-in could not be started.",
        status: "error",
      });
      setSignInPending(false);
    }
  }

  async function initializeSeedCourse() {
    setInitializationPending(true);

    try {
      const response = await fetch(`/api/admin/courses/${COURSE_EDITOR_COURSE_ID}`, {
        body: JSON.stringify({
          document: ROUGH_COURSE_DOCUMENT,
          expectedRevision: null,
        }),
        credentials: "include",
        headers: { "content-type": "application/json" },
        method: "PUT",
      });

      if (response.status === 409) {
        setAccessState(await resolveAccessState());
        return;
      }

      if (!response.ok) {
        throw new Error("The seed course could not be initialized.");
      }

      const revision = persistedCourseRevisionSchema.parse(
        await response.json(),
      );
      setAccessState({ revision, status: "ready" });
    } catch {
      setAccessState({
        message: "The seed course could not be initialized.",
        status: "error",
      });
    } finally {
      setInitializationPending(false);
    }
  }

  async function signOut() {
    setSignOutPending(true);

    try {
      const response = await fetch("/api/auth/sign-out", {
        body: JSON.stringify({}),
        credentials: "include",
        headers: { "content-type": "application/json" },
        method: "POST",
      });

      if (!response.ok) {
        throw new Error("Sign out failed.");
      }

      setAccessState({ status: "unauthenticated" });
    } catch {
      setAccessState({
        message: "Sign out failed. Please retry.",
        status: "error",
      });
    } finally {
      setSignOutPending(false);
    }
  }

  if (accessState.status === "ready") {
    return (
      <CourseEditorShell
        revision={accessState.revision}
        signOutPending={signOutPending}
        onSignOut={() => void signOut()}
      />
    );
  }

  return (
    <main className="relative grid min-h-screen place-items-center overflow-hidden bg-titan-black px-5 py-10 text-titan-ice">
      <div className="absolute inset-0 bg-[radial-gradient(circle_at_50%_20%,rgb(52_64_74/0.42),transparent_45%),linear-gradient(145deg,rgb(7_7_6),rgb(20_18_15))]" />
      <section className="relative grid w-full max-w-lg gap-6 border border-titan-ice/20 bg-titan-black/88 p-6 shadow-[0_28px_100px_rgb(0_0_0/0.62)] sm:p-9">
        <div className="grid gap-3">
          <p className="font-mono text-xs font-bold uppercase tracking-[0.22em] text-titan-hazard">
            Protected tooling
          </p>
          <h1 className="text-3xl font-black uppercase tracking-[-0.04em] sm:text-4xl">
            Course Editor
          </h1>
        </div>

        <AccessMessage accessState={accessState} />

        <div className="grid gap-3 sm:grid-cols-2">
          {accessState.status === "unauthenticated" ? (
            <button
              className="titan-button titan-button-primary"
              disabled={signInPending}
              type="button"
              onClick={() => void signInWithGoogle()}
            >
              {signInPending ? "Connecting..." : "Continue with Google"}
            </button>
          ) : accessState.status === "not-found" ? (
            <button
              className="titan-button titan-button-primary"
              disabled={initializationPending}
              type="button"
              onClick={() => void initializeSeedCourse()}
            >
              {initializationPending ? "Initializing..." : "Initialize seed course"}
            </button>
          ) : accessState.status === "forbidden" ? (
            <button
              className="titan-button titan-button-primary"
              disabled={signOutPending}
              type="button"
              onClick={() => void signOut()}
            >
              {signOutPending ? "Signing out..." : "Sign out"}
            </button>
          ) : accessState.status === "error" ? (
            <button
              className="titan-button titan-button-primary"
              type="button"
              onClick={() => void loadCourse()}
            >
              Retry
            </button>
          ) : null}
          <Link className="titan-button titan-button-secondary" href="/">
            Back to racing
          </Link>
        </div>
      </section>
    </main>
  );
}

function AccessMessage({ accessState }: { accessState: AccessState }) {
  if (accessState.status === "loading") {
    return (
      <p className="border border-titan-ice/15 bg-titan-ice/[0.04] px-4 py-3 font-mono text-xs font-bold uppercase tracking-[0.14em] text-titan-muted" role="status">
        Checking course access...
      </p>
    );
  }

  if (accessState.status === "unauthenticated") {
    return (
      <p className="border border-titan-hazard/35 bg-titan-hazard/[0.06] px-4 py-3 text-sm text-titan-ice/78">
        Sign in with an approved admin account to continue.
      </p>
    );
  }

  if (accessState.status === "forbidden") {
    return (
      <p className="border border-titan-rust/55 bg-titan-rust/10 px-4 py-3 text-sm text-titan-ice/78" role="alert">
        This account does not have course-editor access.
      </p>
    );
  }

  if (accessState.status === "not-found") {
    return (
      <p className="border border-titan-hazard/35 bg-titan-hazard/[0.06] px-4 py-3 text-sm text-titan-ice/78">
        No rough-course revision exists yet. Initialize it from the validated
        recovery seed to begin authoring.
      </p>
    );
  }

  if (accessState.status === "error") {
    return (
      <p className="border border-titan-rust/55 bg-titan-rust/10 px-4 py-3 text-sm text-titan-ice/78" role="alert">
        {accessState.message}
      </p>
    );
  }

  return null;
}

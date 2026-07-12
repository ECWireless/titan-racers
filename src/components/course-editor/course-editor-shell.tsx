"use client";

import Link from "next/link";
import { useEffect, useMemo, useRef, useState } from "react";

import { CommandHistory } from "@/game/editor/command-history";

import type { CourseEditorRevision } from "./course-editor-access";

type MobilePanel = "course" | "inspector" | null;

export function CourseEditorShell({
  onSignOut,
  revision,
  signOutPending,
}: {
  onSignOut: () => void;
  revision: CourseEditorRevision;
  signOutPending: boolean;
}) {
  const history = useMemo(
    () => new CommandHistory(revision.document),
    [revision.document],
  );
  const [mobilePanel, setMobilePanel] = useState<MobilePanel>(null);
  const closePanelButtonRef = useRef<HTMLButtonElement>(null);
  const coursePanelButtonRef = useRef<HTMLButtonElement>(null);
  const inspectorPanelButtonRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    if (mobilePanel) {
      closePanelButtonRef.current?.focus();
    }
  }, [mobilePanel]);

  useEffect(() => {
    const desktopQuery = window.matchMedia("(min-width: 1024px)");
    const closePanelAtDesktop = (event: MediaQueryListEvent) => {
      if (event.matches) {
        setMobilePanel(null);
      }
    };

    desktopQuery.addEventListener("change", closePanelAtDesktop);
    return () => desktopQuery.removeEventListener("change", closePanelAtDesktop);
  }, []);

  function closeMobilePanel() {
    const trigger =
      mobilePanel === "course"
        ? coursePanelButtonRef.current
        : inspectorPanelButtonRef.current;

    setMobilePanel(null);
    requestAnimationFrame(() => trigger?.focus());
  }

  function handleMobilePanelKeyDown(
    event: React.KeyboardEvent<HTMLDivElement>,
  ) {
    if (event.key === "Escape") {
      event.preventDefault();
      closeMobilePanel();
      return;
    }

    if (event.key !== "Tab") {
      return;
    }

    const panel = event.currentTarget;
    const focusable = Array.from(
      panel.querySelectorAll<HTMLElement>(
        'button:not(:disabled), [href], input:not(:disabled), select:not(:disabled), textarea:not(:disabled), [tabindex]:not([tabindex="-1"])',
      ),
    );

    if (focusable.length === 0) {
      event.preventDefault();
      panel.focus();
      return;
    }

    const first = focusable[0];
    const last = focusable[focusable.length - 1];

    if (event.shiftKey && document.activeElement === first) {
      event.preventDefault();
      last.focus();
    } else if (!event.shiftKey && document.activeElement === last) {
      event.preventDefault();
      first.focus();
    }
  }

  return (
    <main
      className="grid h-[100dvh] min-h-0 grid-rows-[auto_minmax(0,1fr)] overflow-hidden bg-titan-black font-mono text-titan-ice"
      data-testid="course-editor-shell"
    >
      <header
        className="flex min-h-14 items-center gap-2 border-b border-titan-ice/15 bg-titan-panel px-3 py-2 sm:px-4"
        inert={mobilePanel !== null}
      >
        <Link
          className="mr-1 border border-titan-ice/20 px-3 py-2 text-[0.68rem] font-bold uppercase tracking-[0.12em] text-titan-ice/74 hover:border-titan-hazard hover:text-titan-hazard focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-titan-hazard"
          href="/"
        >
          Exit
        </Link>
        <div className="min-w-0 flex-1">
          <p className="truncate text-[0.65rem] font-bold uppercase tracking-[0.18em] text-titan-hazard">
            Course Editor
          </p>
          <p className="truncate text-sm font-bold text-titan-ice">
            {revision.document.name}
          </p>
        </div>
        <span
          className="hidden border border-titan-ice/15 bg-titan-black/40 px-3 py-2 text-[0.65rem] font-bold uppercase tracking-[0.12em] text-titan-muted sm:inline-flex"
          data-testid="editor-revision"
        >
          Revision {revision.revision}
        </span>
        <button
          aria-label="Undo"
          className="editor-tool-button"
          disabled={!history.canUndo}
          type="button"
        >
          ↶
        </button>
        <button
          aria-label="Redo"
          className="editor-tool-button"
          disabled={!history.canRedo}
          type="button"
        >
          ↷
        </button>
        <span className="hidden text-[0.65rem] font-bold uppercase tracking-[0.12em] text-titan-muted lg:inline">
          Saved
        </span>
        <button
          className="hidden border border-titan-ice/20 px-3 py-2 text-[0.65rem] font-bold uppercase tracking-[0.12em] text-titan-ice/72 hover:border-titan-hazard hover:text-titan-hazard focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-titan-hazard sm:inline-flex"
          disabled={signOutPending}
          type="button"
          onClick={onSignOut}
        >
          {signOutPending ? "Signing out..." : "Sign out"}
        </button>
      </header>

      <div className="relative grid min-h-0 lg:grid-cols-[16rem_minmax(0,1fr)_19rem]">
        <EditorPanel
          className="hidden border-r lg:flex"
          inert={mobilePanel !== null}
          title="Course"
        >
          <CourseOutline revision={revision} />
        </EditorPanel>

        <section
          className="relative grid min-h-0 place-items-center overflow-hidden bg-[radial-gradient(circle_at_50%_42%,rgb(52_64_74/0.34),transparent_48%),linear-gradient(rgb(247_242_232/0.035)_1px,transparent_1px),linear-gradient(90deg,rgb(247_242_232/0.035)_1px,transparent_1px)] bg-[size:auto,2rem_2rem,2rem_2rem]"
          inert={mobilePanel !== null}
        >
          <div className="max-w-md px-7 text-center">
            <p className="text-xs font-bold uppercase tracking-[0.2em] text-titan-hazard">
              Loaded revision workspace
            </p>
            <p className="mt-3 text-sm leading-6 text-titan-ice/64">
              Course geometry and authoring controls arrive in the next reviewed
              unit. This shell is connected to the protected revision boundary.
            </p>
          </div>

          <div className="absolute bottom-3 left-16 right-3 flex items-center justify-between gap-2 sm:left-3 lg:hidden">
            <button
              className="editor-mobile-panel-button"
              ref={coursePanelButtonRef}
              type="button"
              onClick={() => setMobilePanel("course")}
            >
              Course
            </button>
            <span className="border border-titan-ice/15 bg-titan-black/78 px-3 py-2 text-[0.62rem] font-bold uppercase tracking-[0.12em] text-titan-muted backdrop-blur">
              Rev {revision.revision}
            </span>
            <button
              className="editor-mobile-panel-button"
              ref={inspectorPanelButtonRef}
              type="button"
              onClick={() => setMobilePanel("inspector")}
            >
              Inspector
            </button>
          </div>
          <button
            className="absolute right-3 top-3 border border-titan-ice/20 bg-titan-black/78 px-3 py-2 text-[0.62rem] font-bold uppercase tracking-[0.12em] text-titan-ice/72 backdrop-blur hover:border-titan-hazard hover:text-titan-hazard focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-titan-hazard sm:hidden"
            disabled={signOutPending}
            type="button"
            onClick={onSignOut}
          >
            {signOutPending ? "Signing out..." : "Sign out"}
          </button>
        </section>

        <EditorPanel
          className="hidden border-l lg:flex"
          inert={mobilePanel !== null}
          title="Inspector"
        >
          <Inspector revision={revision} />
        </EditorPanel>

        {mobilePanel ? (
          <div
            aria-labelledby="mobile-editor-panel-title"
            aria-modal="true"
            className="absolute inset-x-3 bottom-16 top-3 z-20 flex flex-col overflow-hidden border border-titan-ice/20 bg-titan-panel/98 shadow-[0_20px_80px_rgb(0_0_0/0.68)] backdrop-blur lg:hidden"
            role="dialog"
            tabIndex={-1}
            onKeyDown={handleMobilePanelKeyDown}
          >
            <div className="flex items-center justify-between border-b border-titan-ice/15 px-4 py-3">
              <h2
                className="text-xs font-bold uppercase tracking-[0.18em] text-titan-hazard"
                id="mobile-editor-panel-title"
              >
                {mobilePanel === "course" ? "Course" : "Inspector"}
              </h2>
              <button
                aria-label="Close panel"
                className="editor-tool-button"
                ref={closePanelButtonRef}
                type="button"
                onClick={closeMobilePanel}
              >
                ×
              </button>
            </div>
            <div className="min-h-0 flex-1 overflow-y-auto p-3">
              {mobilePanel === "course" ? (
                <CourseOutline revision={revision} />
              ) : (
                <Inspector revision={revision} />
              )}
            </div>
          </div>
        ) : null}
      </div>
    </main>
  );
}

function EditorPanel({
  children,
  className,
  inert,
  title,
}: {
  children: React.ReactNode;
  className: string;
  inert: boolean;
  title: string;
}) {
  return (
    <aside
      className={`${className} min-h-0 flex-col border-titan-ice/15 bg-titan-panel`}
      inert={inert}
    >
      <h2 className="border-b border-titan-ice/15 px-4 py-3 text-xs font-bold uppercase tracking-[0.18em] text-titan-hazard">
        {title}
      </h2>
      <div className="min-h-0 flex-1 overflow-y-auto p-3">{children}</div>
    </aside>
  );
}

function CourseOutline({ revision }: { revision: CourseEditorRevision }) {
  return (
    <div className="grid gap-2 text-xs">
      <OutlineRow label="Start" value="1" />
      <OutlineRow
        label="Checkpoints"
        value={String(revision.document.checkpoints.length)}
      />
      <OutlineRow
        label="Course objects"
        value={String(revision.document.objects.length)}
      />
      <OutlineRow
        label="Directional lights"
        value={String(revision.document.lighting.directionalLights.length)}
      />
    </div>
  );
}

function OutlineRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex w-full items-center justify-between border border-titan-ice/10 bg-titan-black/24 px-3 py-3 text-left text-titan-ice/72">
      <span>{label}</span>
      <span className="text-titan-muted">{value}</span>
    </div>
  );
}

function Inspector({ revision }: { revision: CourseEditorRevision }) {
  return (
    <dl className="grid gap-4 text-xs">
      <InspectorField label="Course ID" value={revision.courseId} />
      <InspectorField label="Schema" value={`v${revision.schemaVersion}`} />
      <InspectorField label="Units" value={revision.document.units} />
      <InspectorField label="Status" value="Loaded · clean" />
    </dl>
  );
}

function InspectorField({ label, value }: { label: string; value: string }) {
  return (
    <div className="grid gap-1 border-b border-titan-ice/10 pb-3">
      <dt className="font-bold uppercase tracking-[0.12em] text-titan-muted">
        {label}
      </dt>
      <dd className="break-words text-titan-ice/82">{value}</dd>
    </div>
  );
}

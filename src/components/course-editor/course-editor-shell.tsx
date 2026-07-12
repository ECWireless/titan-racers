"use client";

import Link from "next/link";
import { useEffect, useId, useRef, useState } from "react";
import { createPortal } from "react-dom";

import type { CourseDocument } from "@/game/course/course-document";
import {
  COURSE_OBJECT_PRESETS,
  COURSE_EDITOR_OBJECT_LIMIT,
  type CourseEditorSelection,
  type CourseObjectPreset,
  addCourseCheckpoint,
  addCourseObjectPreset,
  collectCourseDocumentIds,
  deleteCourseSelection,
  getSelectionGeometry,
  nudgeSelection,
  renameCourseObject,
  scaleSelectionAxis,
} from "@/game/editor/course-editor-document";
import type { CourseEditorTool } from "@/game/editor/course-editor-scene";
import { CommandHistory } from "@/game/editor/command-history";

import type { CourseEditorRevision } from "./course-editor-access";
import { CourseEditorCanvas } from "./course-editor-canvas";

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
  const [history] = useState(
    () => new CommandHistory<CourseDocument>(revision.document),
  );
  const [document, setDocument] = useState(revision.document);
  const [historyVersion, setHistoryVersion] = useState(0);
  const [frameRequest, setFrameRequest] = useState(0);
  const [selection, setSelection] = useState<CourseEditorSelection>({
    id: revision.document.start.id,
    kind: "start",
  });
  const [tool, setTool] = useState<CourseEditorTool>("translate");
  const [snapEnabled, setSnapEnabled] = useState(true);
  const [collisionVisible, setCollisionVisible] = useState(false);
  const [cameraHelpOpen, setCameraHelpOpen] = useState(false);
  const [mobilePanel, setMobilePanel] = useState<MobilePanel>(null);
  const issuedIdsRef = useRef(collectCourseDocumentIds(revision.document));
  const closePanelButtonRef = useRef<HTMLButtonElement>(null);
  const coursePanelButtonRef = useRef<HTMLButtonElement>(null);
  const inspectorPanelButtonRef = useRef<HTMLButtonElement>(null);
  const selectedGeometry = getSelectionGeometry(document, selection);
  const selectedObject =
    selection.kind === "object"
      ? document.objects.find(({ id }) => id === selection.id)
      : undefined;
  const courseModalOpen = mobilePanel === "course";

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

  function commitDocument(label: string, nextDocument: CourseDocument) {
    const previousDocument = history.current;
    if (previousDocument === nextDocument) {
      return;
    }

    const current = history.execute({
      apply: () => nextDocument,
      label,
      revert: () => previousDocument,
    });
    setDocument(current);
    setHistoryVersion((version) => version + 1);
  }

  function undo() {
    setDocument(history.undo());
    setHistoryVersion((version) => version + 1);
  }

  function redo() {
    setDocument(history.redo());
    setHistoryVersion((version) => version + 1);
  }

  function addPreset(preset: CourseObjectPreset) {
    const nextDocument = addCourseObjectPreset(
      document,
      preset,
      issuedIdsRef.current,
    );
    if (nextDocument === document) {
      return;
    }
    const nextObject = nextDocument.objects.at(-1);
    commitDocument(`Add ${preset}`, nextDocument);
    if (nextObject) {
      issuedIdsRef.current.add(nextObject.id);
      setSelection({ id: nextObject.id, kind: "object" });
      closePanelToViewport();
    }
  }

  function addCheckpoint() {
    const nextDocument = addCourseCheckpoint(document, issuedIdsRef.current);
    const checkpoint = nextDocument.checkpoints.at(-1);
    commitDocument("Add checkpoint", nextDocument);
    if (checkpoint) {
      issuedIdsRef.current.add(checkpoint.id);
      setSelection({ id: checkpoint.id, kind: "checkpoint" });
      closePanelToViewport();
    }
  }

  function deleteSelection() {
    const nextDocument = deleteCourseSelection(document, selection);
    if (nextDocument === document) {
      return;
    }

    commitDocument(`Delete ${selection.id}`, nextDocument);
    setSelection({ id: nextDocument.start.id, kind: "start" });
    closePanelToViewport();
  }

  function nudge(
    field: "position" | "rotation",
    axis: "x" | "y" | "z",
    delta: number,
  ) {
    commitDocument(
      `${field === "position" ? "Move" : "Rotate"} ${selection.id}`,
      nudgeSelection(document, selection, field, axis, delta),
    );
  }

  function renameObject(label: string) {
    commitDocument(
      `Rename ${selection.id}`,
      renameCourseObject(document, selection, label),
    );
  }

  function scaleAxis(axis: "x" | "y" | "z", multiplier: number) {
    commitDocument(
      `Scale ${selection.id}`,
      scaleSelectionAxis(document, selection, axis, multiplier),
    );
  }

  function closeMobilePanel() {
    const trigger =
      mobilePanel === "course"
        ? coursePanelButtonRef.current
        : inspectorPanelButtonRef.current;

    setMobilePanel(null);
    requestAnimationFrame(() => trigger?.focus());
  }

  function closePanelToViewport() {
    if (!mobilePanel) {
      return;
    }

    setMobilePanel(null);
    requestAnimationFrame(() => {
      window.document
        .querySelector<HTMLCanvasElement>("[data-testid='course-editor-canvas']")
        ?.focus();
    });
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

    const focusable = Array.from(
      event.currentTarget.querySelectorAll<HTMLElement>(
        'button:not(:disabled), [href], input:not(:disabled), select:not(:disabled), textarea:not(:disabled), [tabindex]:not([tabindex="-1"])',
      ),
    );
    if (focusable.length === 0) {
      event.preventDefault();
      event.currentTarget.focus();
      return;
    }

    const first = focusable[0];
    const last = focusable[focusable.length - 1];
    if (event.shiftKey && window.document.activeElement === first) {
      event.preventDefault();
      last.focus();
    } else if (!event.shiftKey && window.document.activeElement === last) {
      event.preventDefault();
      first.focus();
    }
  }

  const canDelete =
    selection.kind === "object" ||
    (selection.kind === "checkpoint" && document.checkpoints.length > 1);
  void historyVersion;

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      const target = event.target;
      if (
        target instanceof HTMLInputElement ||
        target instanceof HTMLTextAreaElement ||
        target instanceof HTMLSelectElement ||
        mobilePanel
      ) {
        return;
      }

      const commandKey = event.ctrlKey || event.metaKey;
      if (commandKey && event.key.toLowerCase() === "z") {
        event.preventDefault();
        if (event.shiftKey) {
          redo();
        } else {
          undo();
        }
        return;
      } else if (commandKey && event.key.toLowerCase() === "y") {
        event.preventDefault();
        redo();
        return;
      }

      const viewportFocused =
        target instanceof HTMLCanvasElement &&
        target.dataset.testid === "course-editor-canvas";
      if (!viewportFocused) {
        return;
      }

      if (event.key === "1") {
        setTool("translate");
      } else if (event.key === "2") {
        setTool("rotate");
      } else if (event.key === "3" && selection.kind !== "start") {
        setTool("scale");
      } else if (event.key.toLowerCase() === "f") {
        setFrameRequest((request) => request + 1);
      } else if ((event.key === "Delete" || event.key === "Backspace") && canDelete) {
        event.preventDefault();
        deleteSelection();
      }
    };

    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
    // The handler intentionally rebinds with the current document/history state.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [canDelete, document, history, mobilePanel, selection]);

  return (
    <main
      className="grid h-[100dvh] min-h-0 w-full min-w-0 max-w-full grid-rows-[auto_auto_minmax(0,1fr)] overflow-hidden bg-titan-black font-mono text-titan-ice"
      data-testid="course-editor-shell"
    >
      <header
        className="flex min-h-14 items-center gap-2 border-b border-titan-ice/15 bg-titan-panel px-3 py-2 sm:px-4"
        inert={courseModalOpen}
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
            {document.name}
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
          onClick={undo}
        >
          ↶
        </button>
        <button
          aria-label="Redo"
          className="editor-tool-button"
          disabled={!history.canRedo}
          type="button"
          onClick={redo}
        >
          ↷
        </button>
        <span
          className={`hidden text-[0.65rem] font-bold uppercase tracking-[0.12em] lg:inline ${
            history.isDirty ? "text-titan-hazard" : "text-titan-muted"
          }`}
        >
          {history.isDirty ? "Unsaved" : "Saved"}
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

      <div
        className="min-w-0 max-w-full overflow-hidden"
        data-testid="editor-toolbar-shell"
        inert={courseModalOpen}
      >
        <EditorToolbar
          collisionVisible={collisionVisible}
          cameraHelpOpen={cameraHelpOpen}
          selection={selection}
          snapEnabled={snapEnabled}
          tool={tool}
          onCollisionToggle={() => setCollisionVisible((visible) => !visible)}
          onCameraHelpToggle={() => setCameraHelpOpen((open) => !open)}
          onFrame={() => setFrameRequest((request) => request + 1)}
          onSnapToggle={() => setSnapEnabled((enabled) => !enabled)}
          onToolChange={setTool}
        />
      </div>

      <div
        className={`editor-mobile-workspace relative flex min-h-0 w-full min-w-0 max-w-full flex-col overflow-hidden lg:grid lg:grid-cols-[17rem_minmax(0,1fr)_20rem] lg:grid-rows-1 ${
          mobilePanel === "inspector"
            ? "editor-mobile-workspace-inspector"
            : ""
        }`}
      >
        <EditorPanel
          className="hidden border-r lg:flex"
          inert={courseModalOpen}
          title="Course"
        >
          <CoursePanel
            document={document}
            selection={selection}
            onAddCheckpoint={addCheckpoint}
            onAddPreset={addPreset}
            onSelect={setSelection}
          />
        </EditorPanel>

        <section
          className="relative min-h-0 min-w-0 flex-1 overflow-hidden"
          inert={courseModalOpen}
        >
          <CourseEditorCanvas
            collisionVisible={collisionVisible}
            document={document}
            frameRequest={frameRequest}
            selection={selection}
            snapEnabled={snapEnabled}
            tool={tool}
            onDocumentChange={commitDocument}
            onSelectionChange={setSelection}
          />

          {cameraHelpOpen ? (
            <section
              aria-label="Camera controls"
              className="absolute left-3 top-3 z-10 grid w-[min(19rem,calc(100%-1.5rem))] gap-3 border border-titan-ice/24 bg-titan-black/92 p-3 text-[0.68rem] shadow-[0_16px_50px_rgb(0_0_0/0.55)] backdrop-blur"
              id="camera-controls-help"
            >
              <div className="flex items-center justify-between gap-3">
                <h2 className="font-bold uppercase tracking-[0.14em] text-titan-hazard">
                  Camera controls
                </h2>
                <button
                  aria-label="Close camera controls"
                  className="grid h-8 w-8 place-items-center border border-titan-ice/20 text-titan-ice/78 hover:border-titan-hazard hover:text-titan-hazard"
                  type="button"
                  onClick={() => setCameraHelpOpen(false)}
                >
                  ×
                </button>
              </div>
              <div className="grid grid-cols-[auto_1fr] gap-x-3 gap-y-1 text-titan-ice/82">
                <span className="font-bold uppercase text-titan-muted">Touch</span>
                <span>1 finger orbit · 2 finger pan · pinch zoom</span>
                <span className="font-bold uppercase text-titan-muted">Mouse</span>
                <span>Right-drag orbit · Shift-drag pan · wheel zoom</span>
              </div>
            </section>
          ) : null}

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
              {history.isDirty ? "Unsaved" : `Rev ${revision.revision}`}
            </span>
            <button
              className="editor-mobile-panel-button"
              ref={inspectorPanelButtonRef}
              type="button"
              onClick={() => {
                setMobilePanel((panel) =>
                  panel === "inspector" ? null : "inspector",
                );
                requestAnimationFrame(() =>
                  setFrameRequest((request) => request + 1),
                );
              }}
            >
              {mobilePanel === "inspector" ? "Hide inspector" : "Inspector"}
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
          inert={courseModalOpen}
          title="Inspector"
        >
          <Inspector
            canDelete={canDelete}
            geometry={selectedGeometry}
            objectName={selectedObject?.label ?? selectedObject?.id ?? null}
            scaleShape={selectedObject?.visual.shape ?? "box"}
            selection={selection}
            onDelete={deleteSelection}
            onNudge={nudge}
            onRename={renameObject}
            onScale={scaleAxis}
          />
        </EditorPanel>

        {mobilePanel === "inspector" ? (
          <aside
            aria-label="Inspector"
            className="editor-mobile-inspector z-10 flex h-[46dvh] min-h-56 min-w-0 shrink-0 flex-col overflow-hidden border-t border-titan-ice/24 bg-titan-panel shadow-[0_-18px_60px_rgb(0_0_0/0.5)] lg:hidden"
            onKeyDown={(event) => {
              if (event.key === "Escape") {
                event.preventDefault();
                closeMobilePanel();
              }
            }}
          >
            <div className="flex min-h-12 shrink-0 items-center justify-between border-b border-titan-ice/15 px-4 py-2">
              <div>
                <h2 className="text-xs font-bold uppercase tracking-[0.18em] text-titan-hazard">
                  Inspector
                </h2>
                <p className="mt-0.5 max-w-[15rem] truncate text-[0.6rem] uppercase tracking-[0.1em] text-titan-muted">
                  Editing {selectedObject?.label ?? selection.id}
                </p>
              </div>
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
            <div className="min-h-0 min-w-0 flex-1 overscroll-contain overflow-y-auto overflow-x-hidden p-4">
              <Inspector
                canDelete={canDelete}
                geometry={selectedGeometry}
                objectName={selectedObject?.label ?? selectedObject?.id ?? null}
                scaleShape={selectedObject?.visual.shape ?? "box"}
                selection={selection}
                onDelete={deleteSelection}
                onNudge={nudge}
                onRename={renameObject}
                onScale={scaleAxis}
              />
            </div>
          </aside>
        ) : null}

        {courseModalOpen ? (
          <>
            <button
              aria-label="Dismiss panel"
              className="fixed inset-0 z-20 cursor-default bg-titan-black/66 lg:hidden"
              type="button"
              onClick={closeMobilePanel}
            />
            <div
              aria-labelledby="mobile-editor-panel-title"
              aria-modal="true"
              className="fixed inset-x-0 bottom-0 z-30 mx-auto flex max-h-[82dvh] min-h-0 w-full min-w-0 max-w-xl flex-col overflow-hidden border-t border-titan-ice/24 bg-titan-panel shadow-[0_-20px_80px_rgb(0_0_0/0.72)] sm:bottom-4 sm:border lg:hidden"
              role="dialog"
              tabIndex={-1}
              onKeyDown={handleMobilePanelKeyDown}
            >
            <div className="flex min-h-14 shrink-0 items-center justify-between border-b border-titan-ice/15 px-4 py-2">
              <h2
                className="text-xs font-bold uppercase tracking-[0.18em] text-titan-hazard"
                id="mobile-editor-panel-title"
              >
                Course
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
            <div className="min-h-0 min-w-0 flex-1 overscroll-contain overflow-y-auto overflow-x-hidden p-4">
              <CoursePanel
                document={document}
                selection={selection}
                onAddCheckpoint={addCheckpoint}
                onAddPreset={addPreset}
                onSelect={(nextSelection) => {
                  setSelection(nextSelection);
                  closePanelToViewport();
                }}
              />
            </div>
          </div>
          </>
        ) : null}
      </div>
    </main>
  );
}

function EditorToolbar({
  cameraHelpOpen,
  collisionVisible,
  onCameraHelpToggle,
  onCollisionToggle,
  onFrame,
  onSnapToggle,
  onToolChange,
  selection,
  snapEnabled,
  tool,
}: {
  cameraHelpOpen: boolean;
  collisionVisible: boolean;
  onCameraHelpToggle: () => void;
  onCollisionToggle: () => void;
  onFrame: () => void;
  onSnapToggle: () => void;
  onToolChange: (tool: CourseEditorTool) => void;
  selection: CourseEditorSelection;
  snapEnabled: boolean;
  tool: CourseEditorTool;
}) {
  return (
    <div className="flex min-h-12 items-center gap-2 overflow-x-auto border-b border-titan-ice/15 bg-titan-black px-3 py-2">
      {(["translate", "rotate", "scale"] as const).map((candidate) => (
        <ToolbarIconButton
          active={tool === candidate}
          disabled={candidate === "scale" && selection.kind === "start"}
          key={candidate}
          label={
            candidate === "translate"
              ? "Move"
              : candidate.charAt(0).toUpperCase() + candidate.slice(1)
          }
          tooltip={
            candidate === "translate"
              ? "Move selection (1)"
              : candidate === "rotate"
                ? "Rotate selection (2)"
                : selection.kind === "start"
                  ? "Scale is unavailable for the start position"
                  : "Scale selection by axis (3)"
          }
          onClick={() => onToolChange(candidate)}
        >
          <ToolbarIcon name={candidate} />
        </ToolbarIconButton>
      ))}
      <span className="h-7 w-px shrink-0 bg-titan-ice/15" />
      <ToolbarIconButton
        active={snapEnabled}
        activeClassName="border-titan-blue/60 text-titan-blue"
        label={`Snap ${snapEnabled ? "On" : "Off"}`}
        tooltip={`Snapping ${snapEnabled ? "on" : "off"}: 0.25 m move, 5° rotate, 10% scale`}
        onClick={onSnapToggle}
      >
        <ToolbarIcon name="snap" />
        <span
          aria-hidden="true"
          className={`absolute right-1 top-1 h-1.5 w-1.5 rounded-full ${
            snapEnabled ? "bg-titan-blue" : "bg-titan-muted/45"
          }`}
        />
      </ToolbarIconButton>
      <ToolbarIconButton
        active={collisionVisible}
        activeClassName="border-titan-orange/60 text-titan-orange"
        label={`${collisionVisible ? "Hide" : "Show"} collision shapes`}
        tooltip={`${collisionVisible ? "Hide" : "Show"} the physics shapes the kart collides with`}
        onClick={onCollisionToggle}
      >
        <ToolbarIcon name="collision" />
      </ToolbarIconButton>
      <ToolbarIconButton
        label="Frame selection"
        tooltip="Center the camera on the selection (F)"
        onClick={onFrame}
      >
        <ToolbarIcon name="frame" />
      </ToolbarIconButton>
      <ToolbarIconButton
        active={cameraHelpOpen}
        controls="camera-controls-help"
        expanded={cameraHelpOpen}
        label="Camera controls"
        tooltip="Camera gestures for mouse and touch"
        onClick={onCameraHelpToggle}
      >
        <ToolbarIcon name="help" />
      </ToolbarIconButton>
    </div>
  );
}

function ToolbarIconButton({
  active,
  activeClassName = "border-titan-hazard bg-titan-hazard/10 text-titan-hazard",
  children,
  controls,
  disabled = false,
  expanded,
  label,
  onClick,
  tooltip,
}: {
  active?: boolean;
  activeClassName?: string;
  children: React.ReactNode;
  controls?: string;
  disabled?: boolean;
  expanded?: boolean;
  label: string;
  onClick: () => void;
  tooltip: string;
}) {
  const buttonRef = useRef<HTMLButtonElement>(null);
  const tooltipId = useId();
  const [tooltipPosition, setTooltipPosition] = useState<{
    left: number;
    top: number;
  } | null>(null);

  function showTooltip() {
    const bounds = buttonRef.current?.getBoundingClientRect();
    if (!bounds) {
      return;
    }

    setTooltipPosition({
      left: Math.min(
        window.innerWidth - 150,
        Math.max(150, bounds.left + bounds.width / 2),
      ),
      top: bounds.bottom + 8,
    });
  }

  return (
    <>
      <button
        aria-controls={controls}
        aria-describedby={tooltipId}
        aria-disabled={disabled}
        aria-expanded={expanded}
        aria-label={label}
        aria-pressed={active}
        className={`relative grid h-10 w-10 shrink-0 place-items-center border ${
          disabled
            ? "cursor-not-allowed border-titan-ice/12 text-titan-muted/35"
            : active
              ? activeClassName
              : "border-titan-ice/18 text-titan-ice/72 hover:border-titan-ice/40"
        }`}
        ref={buttonRef}
        type="button"
        onBlur={() => setTooltipPosition(null)}
        onClick={() => !disabled && onClick()}
        onFocus={showTooltip}
        onMouseEnter={showTooltip}
        onMouseLeave={() => setTooltipPosition(null)}
      >
        {children}
      </button>
      {tooltipPosition
        ? createPortal(
            <span
              className="pointer-events-none fixed z-[100] w-max max-w-[min(18rem,calc(100vw-1.5rem))] -translate-x-1/2 border border-titan-ice/20 bg-titan-black/96 px-2 py-1.5 text-center text-[0.62rem] font-bold uppercase tracking-[0.08em] text-titan-ice shadow-[0_8px_30px_rgb(0_0_0/0.6)]"
              id={tooltipId}
              role="tooltip"
              style={tooltipPosition}
            >
              {tooltip}
            </span>,
            document.body,
          )
        : (
            <span className="sr-only" id={tooltipId} role="tooltip">
              {tooltip}
            </span>
          )}
    </>
  );
}

function ToolbarIcon({
  name,
}: {
  name:
    | CourseEditorTool
    | "collision"
    | "frame"
    | "help"
    | "snap";
}) {
  const common = {
    "aria-hidden": true,
    className: "h-5 w-5",
    fill: "none",
    stroke: "currentColor",
    strokeLinecap: "round" as const,
    strokeLinejoin: "round" as const,
    strokeWidth: 1.7,
    viewBox: "0 0 24 24",
  };

  if (name === "translate") {
    return (
      <svg {...common}>
        <path d="M12 3v18M3 12h18M9 6l3-3 3 3M9 18l3 3 3-3M6 9l-3 3 3 3M18 9l3 3-3 3" />
      </svg>
    );
  }
  if (name === "rotate") {
    return (
      <svg {...common}>
        <path d="M20 7v5h-5M4 17v-5h5M18.5 10A7 7 0 0 0 6.2 6.2L4 9M5.5 14A7 7 0 0 0 17.8 17.8L20 15" />
      </svg>
    );
  }
  if (name === "scale") {
    return (
      <svg {...common}>
        <path d="M8 4H4v4M16 20h4v-4M4 4l6 6M20 20l-6-6M14 4h6v6M20 4l-6 6M10 14l-6 6" />
      </svg>
    );
  }
  if (name === "snap") {
    return (
      <svg {...common}>
        <path d="M6 4v9a6 6 0 0 0 12 0V4M6 8h4M14 8h4" />
      </svg>
    );
  }
  if (name === "collision") {
    return (
      <svg {...common}>
        <path d="m12 3 8 4.5v9L12 21l-8-4.5v-9L12 3ZM4 7.5l8 4.5 8-4.5M12 12v9" />
      </svg>
    );
  }
  if (name === "frame") {
    return (
      <svg {...common}>
        <path d="M4 9V4h5M15 4h5v5M20 15v5h-5M9 20H4v-5" />
        <circle cx="12" cy="12" r="2.5" />
      </svg>
    );
  }
  return (
    <svg {...common}>
      <circle cx="12" cy="12" r="9" />
      <path d="M9.8 9a2.4 2.4 0 1 1 3.4 2.2c-.8.4-1.2.9-1.2 1.8M12 17h.01" />
    </svg>
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
      aria-label={title}
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

function CoursePanel({
  document,
  onAddCheckpoint,
  onAddPreset,
  onSelect,
  selection,
}: {
  document: CourseDocument;
  onAddCheckpoint: () => void;
  onAddPreset: (preset: CourseObjectPreset) => void;
  onSelect: (selection: CourseEditorSelection) => void;
  selection: CourseEditorSelection;
}) {
  return (
    <div className="grid min-w-0 gap-5 text-xs">
      <section className="grid gap-2">
        <h3 className="font-bold uppercase tracking-[0.14em] text-titan-muted">
          Add object
        </h3>
        <div className="grid min-w-0 grid-cols-2 gap-2">
          {COURSE_OBJECT_PRESETS.map((preset) => (
            <button
              className="min-h-11 border border-titan-ice/15 bg-titan-black/24 px-2 py-2 font-bold uppercase tracking-[0.08em] text-titan-ice/78 hover:border-titan-hazard hover:text-titan-hazard focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-titan-hazard disabled:cursor-not-allowed disabled:opacity-35"
              disabled={document.objects.length >= COURSE_EDITOR_OBJECT_LIMIT}
              key={preset}
              title={
                document.objects.length >= COURSE_EDITOR_OBJECT_LIMIT
                  ? `Editor object limit reached (${COURSE_EDITOR_OBJECT_LIMIT})`
                  : `Add ${preset}`
              }
              type="button"
              onClick={() => onAddPreset(preset)}
            >
              {preset}
            </button>
          ))}
        </div>
        <button
          className="min-h-11 border border-titan-blue/40 bg-titan-blue/5 px-3 py-2 font-bold uppercase tracking-[0.08em] text-titan-blue hover:border-titan-blue focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-titan-blue"
          type="button"
          onClick={onAddCheckpoint}
        >
          Add checkpoint
        </button>
      </section>

      <section className="grid gap-2">
        <h3 className="font-bold uppercase tracking-[0.14em] text-titan-muted">
          Course outline
        </h3>
        <SelectionRow
          active={selection.kind === "start"}
          label="Start"
          meta="Spawn"
          onClick={() => onSelect({ id: document.start.id, kind: "start" })}
        />
        {document.checkpoints.map((checkpoint) => (
          <SelectionRow
            active={
              selection.kind === "checkpoint" && selection.id === checkpoint.id
            }
            key={checkpoint.id}
            label={`Checkpoint ${checkpoint.order}`}
            meta={checkpoint.id}
            onClick={() =>
              onSelect({ id: checkpoint.id, kind: "checkpoint" })
            }
          />
        ))}
        {document.objects.map((object) => (
          <SelectionRow
            active={selection.kind === "object" && selection.id === object.id}
            disabled={!object.editable}
            key={object.id}
            label={object.label ?? object.id}
            meta={
              object.editable
                ? object.label
                  ? `${object.category} · ${object.id}`
                  : object.category
                : "Locked"
            }
            onClick={() => onSelect({ id: object.id, kind: "object" })}
          />
        ))}
      </section>
    </div>
  );
}

function SelectionRow({
  active,
  disabled = false,
  label,
  meta,
  onClick,
}: {
  active: boolean;
  disabled?: boolean;
  label: string;
  meta: string;
  onClick: () => void;
}) {
  return (
    <button
      aria-pressed={active}
      className={`grid min-h-12 w-full gap-1 border px-3 py-2 text-left ${
        active
          ? "border-titan-hazard bg-titan-hazard/8 text-titan-hazard"
          : "border-titan-ice/10 bg-titan-black/24 text-titan-ice/72 hover:border-titan-ice/30"
      } disabled:cursor-not-allowed disabled:opacity-42`}
      disabled={disabled}
      type="button"
      onClick={onClick}
    >
      <span className="truncate font-bold">{label}</span>
      <span className="truncate text-[0.58rem] uppercase tracking-[0.08em] text-titan-muted">
        {meta}
      </span>
    </button>
  );
}

function Inspector({
  canDelete,
  geometry,
  objectName,
  onDelete,
  onNudge,
  onRename,
  onScale,
  scaleShape,
  selection,
}: {
  canDelete: boolean;
  geometry: ReturnType<typeof getSelectionGeometry>;
  objectName: string | null;
  onDelete: () => void;
  onNudge: (
    field: "position" | "rotation",
    axis: "x" | "y" | "z",
    delta: number,
  ) => void;
  onRename: (label: string) => void;
  onScale: (axis: "x" | "y" | "z", multiplier: number) => void;
  scaleShape: "box" | "cylinder";
  selection: CourseEditorSelection;
}) {
  if (!geometry) {
    return <p className="text-xs text-titan-muted">Selection unavailable.</p>;
  }

  return (
    <div className="grid gap-4 text-xs">
      <div className="grid gap-1 border-b border-titan-ice/10 pb-3">
        <p className="font-bold uppercase tracking-[0.12em] text-titan-muted">
          Selected
        </p>
        <p className="break-words text-sm font-bold text-titan-ice" data-testid="editor-selection">
          {selection.id}
        </p>
        <p className="uppercase tracking-[0.1em] text-titan-muted">
          {selection.kind}
        </p>
      </div>
      {selection.kind === "object" && objectName ? (
        <ObjectNameControl
          key={`${selection.id}:${objectName}`}
          name={objectName}
          stableId={selection.id}
          onRename={onRename}
        />
      ) : null}
      <NudgeGroup
        label="Position"
        step={0.25}
        values={geometry.position}
        onNudge={(axis, delta) => onNudge("position", axis, delta)}
      />
      <NudgeGroup
        label="Rotation"
        step={5}
        values={geometry.rotation}
        onNudge={(axis, delta) => onNudge("rotation", axis, delta)}
      />
      {geometry.scale ? (
        <fieldset className="grid gap-2 border-t border-titan-ice/10 pt-3">
          <legend className="mb-1 font-bold uppercase tracking-[0.12em] text-titan-muted">
            Scale by axis
          </legend>
          {(["x", "y", "z"] as const).map((axis) => (
            <div
              className="grid grid-cols-[2.5rem_1fr_2.75rem_2.75rem] items-center gap-2"
              key={axis}
            >
              <span className="font-bold uppercase text-titan-muted">{axis}</span>
              <output
                className="truncate text-right text-titan-ice/86"
                data-testid={`scale-${axis}-value`}
              >
                {geometry.scale?.[axis].toFixed(2)}
              </output>
              <button
                aria-label={`Scale ${axis} decrease`}
                className="h-10 border border-titan-ice/18 text-base hover:border-titan-hazard hover:text-titan-hazard"
                type="button"
                onClick={() => onScale(axis, 1 / 1.1)}
              >
                −
              </button>
              <button
                aria-label={`Scale ${axis} increase`}
                className="h-10 border border-titan-ice/18 text-base hover:border-titan-hazard hover:text-titan-hazard"
                type="button"
                onClick={() => onScale(axis, 1.1)}
              >
                +
              </button>
            </div>
          ))}
          <p className="text-[0.62rem] leading-relaxed text-titan-muted">
            {scaleShape === "cylinder"
              ? "Cylinder X/Z stay paired as one collision radius; Y changes height."
              : "Each axis updates its matching visual and collision dimension."}
          </p>
        </fieldset>
      ) : null}
      <button
        className="min-h-11 border border-titan-rust/55 px-3 py-2 font-bold uppercase tracking-[0.1em] text-titan-rust hover:border-titan-rust hover:bg-titan-rust/10 disabled:cursor-not-allowed disabled:opacity-35"
        disabled={!canDelete}
        type="button"
        onClick={onDelete}
      >
        {selection.kind === "start" ? "Start cannot be deleted" : "Delete selected"}
      </button>
    </div>
  );
}

function ObjectNameControl({
  name,
  onRename,
  stableId,
}: {
  name: string;
  onRename: (name: string) => void;
  stableId: string;
}) {
  const [draft, setDraft] = useState(name);

  return (
    <form
      className="grid gap-2"
      onSubmit={(event) => {
        event.preventDefault();
        onRename(draft);
      }}
    >
      <p className="font-bold uppercase tracking-[0.12em] text-titan-muted">
        Object name
      </p>
      <div className="grid grid-cols-[minmax(0,1fr)_auto] gap-2">
        <input
          aria-label="Object name"
          className="min-h-11 min-w-0 border border-titan-ice/18 bg-titan-black/36 px-3 text-titan-ice outline-none focus:border-titan-hazard"
          maxLength={80}
          value={draft}
          onChange={(event) => setDraft(event.target.value)}
        />
        <button
          className="min-h-11 border border-titan-ice/18 px-3 font-bold uppercase tracking-[0.08em] hover:border-titan-hazard hover:text-titan-hazard disabled:cursor-not-allowed disabled:opacity-35"
          disabled={!draft.trim() || draft.trim() === name}
          type="submit"
        >
          Apply
        </button>
      </div>
      <p className="text-[0.62rem] leading-relaxed text-titan-muted">
        Stable ID: {stableId}
      </p>
    </form>
  );
}

function NudgeGroup({
  label,
  onNudge,
  step,
  values,
}: {
  label: string;
  onNudge: (axis: "x" | "y" | "z", delta: number) => void;
  step: number;
  values: { x: number; y: number; z: number };
}) {
  return (
    <fieldset className="grid gap-2">
      <legend className="mb-1 font-bold uppercase tracking-[0.12em] text-titan-muted">
        {label}
      </legend>
      {(["x", "y", "z"] as const).map((axis) => (
        <div className="grid grid-cols-[2.5rem_1fr_2.75rem_2.75rem] items-center gap-2" key={axis}>
          <span className="font-bold uppercase text-titan-muted">{axis}</span>
          <output
            className="truncate text-right text-titan-ice/86"
            data-testid={`${label.toLowerCase()}-${axis}-value`}
          >
            {values[axis].toFixed(2)}
          </output>
          <button
            aria-label={`${label} ${axis} decrease`}
            className="h-10 border border-titan-ice/18 text-base hover:border-titan-hazard hover:text-titan-hazard"
            type="button"
            onClick={() => onNudge(axis, -step)}
          >
            −
          </button>
          <button
            aria-label={`${label} ${axis} increase`}
            className="h-10 border border-titan-ice/18 text-base hover:border-titan-hazard hover:text-titan-hazard"
            type="button"
            onClick={() => onNudge(axis, step)}
          >
            +
          </button>
        </div>
      ))}
    </fieldset>
  );
}

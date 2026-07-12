"use client";

import { useEffect, useRef, useState } from "react";

import type { CourseDocument } from "@/game/course/course-document";
import type { CourseEditorSelection } from "@/game/editor/course-editor-document";
import {
  CourseEditorScene,
  type CourseEditorTool,
} from "@/game/editor/course-editor-scene";

type CourseEditorCanvasProps = {
  collisionVisible: boolean;
  document: CourseDocument;
  frameRequest: number;
  onDocumentChange: (label: string, document: CourseDocument) => void;
  onSelectionChange: (selection: CourseEditorSelection) => void;
  selection: CourseEditorSelection;
  snapEnabled: boolean;
  tool: CourseEditorTool;
};

export function CourseEditorCanvas({
  collisionVisible,
  document,
  frameRequest,
  onDocumentChange,
  onSelectionChange,
  selection,
  snapEnabled,
  tool,
}: CourseEditorCanvasProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const callbacksRef = useRef({ onDocumentChange, onSelectionChange });
  const sceneRef = useRef<CourseEditorScene | null>(null);
  const [status, setStatus] = useState<"loading" | "ready" | "error">(
    "loading",
  );

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) {
      return;
    }

    let active = true;
    let scene: CourseEditorScene | null = null;
    try {
      scene = new CourseEditorScene(canvas, document, selection, {
        onDocumentChange: (label, nextDocument) =>
          callbacksRef.current.onDocumentChange(label, nextDocument),
        onSelectionChange: (nextSelection) =>
          callbacksRef.current.onSelectionChange(nextSelection),
      });
      sceneRef.current = scene;
      queueMicrotask(() => active && setStatus("ready"));
    } catch (error) {
      console.error("Unable to start the course editor scene", error);
      queueMicrotask(() => active && setStatus("error"));
    }

    return () => {
      active = false;
      sceneRef.current = null;
      scene?.destroy();
    };
    // Scene lifecycle is intentionally tied only to the canvas mount. Prop
    // synchronization is handled by the focused effects below.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) {
      return;
    }

    const getSelectionMappingCount = (
      event: CustomEvent<{ respond: (count: number) => void }>,
    ) => event.detail.respond(sceneRef.current?.getSelectionMappingCount() ?? 0);
    canvas.addEventListener(
      "getCourseEditorSelectionMappingCount",
      getSelectionMappingCount as EventListener,
    );
    return () =>
      canvas.removeEventListener(
        "getCourseEditorSelectionMappingCount",
        getSelectionMappingCount as EventListener,
      );
  }, []);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) {
      return;
    }

    const getScaleGizmoPoints = (
      event: CustomEvent<{
        axis: "x" | "y" | "z";
        respond: (
          points: {
            handle: { x: number; y: number } | null;
            origin: { x: number; y: number } | null;
          } | null,
        ) => void;
      }>,
    ) => {
      event.detail.respond(
        sceneRef.current?.getScaleGizmoCanvasPoints(event.detail.axis) ?? null,
      );
    };
    canvas.addEventListener(
      "getCourseEditorScaleGizmoPoints",
      getScaleGizmoPoints as EventListener,
    );
    return () =>
      canvas.removeEventListener(
        "getCourseEditorScaleGizmoPoints",
        getScaleGizmoPoints as EventListener,
      );
  }, []);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) {
      return;
    }

    const getTranslateGizmoPoints = (
      event: CustomEvent<{
        axis: "x" | "y" | "z";
        respond: (
          points: {
            head: { x: number; y: number } | null;
            origin: { x: number; y: number } | null;
          } | null,
        ) => void;
      }>,
    ) => {
      event.detail.respond(
        sceneRef.current?.getTranslateGizmoCanvasPoints(event.detail.axis) ??
          null,
      );
    };
    canvas.addEventListener(
      "getCourseEditorTranslateGizmoPoints",
      getTranslateGizmoPoints as EventListener,
    );
    return () =>
      canvas.removeEventListener(
        "getCourseEditorTranslateGizmoPoints",
        getTranslateGizmoPoints as EventListener,
      );
  }, []);

  useEffect(() => {
    callbacksRef.current = { onDocumentChange, onSelectionChange };
  }, [onDocumentChange, onSelectionChange]);

  useEffect(() => {
    sceneRef.current?.setOptions({
      onDocumentChange: (label, nextDocument) =>
        callbacksRef.current.onDocumentChange(label, nextDocument),
      onSelectionChange: (nextSelection) =>
        callbacksRef.current.onSelectionChange(nextSelection),
    });
  }, [onDocumentChange, onSelectionChange]);

  useEffect(() => sceneRef.current?.setDocument(document), [document]);
  useEffect(() => sceneRef.current?.setSelection(selection), [selection]);
  useEffect(() => sceneRef.current?.setSnapEnabled(snapEnabled), [snapEnabled]);
  useEffect(() => sceneRef.current?.setTool(tool), [tool]);
  useEffect(() => {
    if (frameRequest > 0) {
      sceneRef.current?.frameSelection();
    }
  }, [frameRequest]);
  useEffect(
    () => sceneRef.current?.setCollisionVisible(collisionVisible),
    [collisionVisible],
  );

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) {
      return;
    }

    const getSelectionPoint = (
      event: CustomEvent<{
        respond: (point: { x: number; y: number } | null) => void;
        selection: CourseEditorSelection;
      }>,
    ) => {
      event.detail.respond(
        sceneRef.current?.getSelectionCanvasPoint(event.detail.selection) ?? null,
      );
    };
    canvas.addEventListener(
      "getCourseEditorSelectionPoint",
      getSelectionPoint as EventListener,
    );
    return () =>
      canvas.removeEventListener(
        "getCourseEditorSelectionPoint",
        getSelectionPoint as EventListener,
      );
  }, []);

  return (
    <div className="relative h-full min-h-0 w-full overflow-hidden">
      <canvas
        aria-label="Course editor 3D viewport"
        className="block h-full w-full touch-none cursor-default outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-titan-hazard"
        data-colliders-visible={collisionVisible ? "true" : "false"}
        data-scene-ready={status === "ready" ? "true" : "false"}
        data-selected-id={selection.id}
        data-snap-enabled={snapEnabled ? "true" : "false"}
        data-tool={tool}
        data-testid="course-editor-canvas"
        ref={canvasRef}
        tabIndex={0}
      />
      {status !== "ready" ? (
        <div
          className="absolute inset-0 grid place-items-center bg-titan-black/88 px-6 text-center text-xs font-bold uppercase tracking-[0.16em] text-titan-muted"
          role={status === "error" ? "alert" : "status"}
        >
          {status === "error"
            ? "The 3D editor could not start."
            : "Loading course viewport..."}
        </div>
      ) : null}
    </div>
  );
}

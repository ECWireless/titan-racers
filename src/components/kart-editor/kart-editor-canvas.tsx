"use client";

import { useEffect, useRef, useState } from "react";

import {
  getKartMirrorCounterpartIds,
  type KartEditorSelection,
} from "@/game/editor/kart-editor-document";
import { KartEditorScene } from "@/game/editor/kart-editor-scene";
import type { EditorTransformTool } from "@/game/editor/editor-viewport";
import type { KartAssemblyDocument } from "@/game/kart/kart-assembly-document";

type KartEditorCanvasProps = {
  attachmentParentId: string;
  disabled: boolean;
  document: KartAssemblyDocument;
  frameRequest: number;
  mirrorPair: boolean;
  onDocumentChange: (label: string, document: KartAssemblyDocument) => void;
  onSelectionChange: (selection: KartEditorSelection | null) => void;
  retainedIds: ReadonlySet<string>;
  selection: KartEditorSelection | null;
  selectionState: "attachable" | "invalid" | "valid";
  snapEnabled: boolean;
  tool: EditorTransformTool;
};

export function KartEditorCanvas({
  attachmentParentId,
  disabled,
  document,
  frameRequest,
  mirrorPair,
  onDocumentChange,
  onSelectionChange,
  retainedIds,
  selection,
  selectionState,
  snapEnabled,
  tool,
}: KartEditorCanvasProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const callbacksRef = useRef({ onDocumentChange, onSelectionChange });
  const sceneRef = useRef<KartEditorScene | null>(null);
  const [cameraRevision, setCameraRevision] = useState(0);
  const [cameraPivot, setCameraPivot] = useState("[0,0,0]");
  const [documentBoundsCenter, setDocumentBoundsCenter] = useState("[0,0,0]");
  const [status, setStatus] = useState<"loading" | "ready" | "error">(
    "loading",
  );
  const [transformValidity, setTransformValidity] = useState<
    "attachable" | "idle" | "invalid" | "valid"
  >("idle");
  const mirrorCounterpartIds = selection
    ? getKartMirrorCounterpartIds(document, selection)
    : [];

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    let active = true;
    let scene: KartEditorScene | null = null;
    try {
      scene = new KartEditorScene(canvas, document, selection, {
        attachmentParentId,
        mirrorPair,
        onCameraChange: (pivot) => {
          setCameraPivot(JSON.stringify([pivot.x, pivot.y, pivot.z]));
          setCameraRevision((revision) => revision + 1);
        },
        onDocumentChange: (label, nextDocument) =>
          callbacksRef.current.onDocumentChange(label, nextDocument),
        onDocumentBoundsChange: (center) =>
          setDocumentBoundsCenter(
            JSON.stringify([center.x, center.y, center.z]),
          ),
        onSelectionChange: (nextSelection) =>
          callbacksRef.current.onSelectionChange(nextSelection),
        onTransformStateChange: (state) =>
          setTransformValidity(state ?? "idle"),
        retainedIds,
        selectionState,
      });
      sceneRef.current = scene;
      queueMicrotask(() => active && setStatus("ready"));
    } catch (error) {
      console.error("Unable to start the kart editor scene", error);
      queueMicrotask(() => active && setStatus("error"));
    }
    return () => {
      active = false;
      sceneRef.current = null;
      scene?.destroy();
    };
    // The scene owns its mount lifecycle; focused effects synchronize state.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    callbacksRef.current = { onDocumentChange, onSelectionChange };
    sceneRef.current?.setOptions({
      attachmentParentId,
      mirrorPair,
      onCameraChange: (pivot) => {
        setCameraPivot(JSON.stringify([pivot.x, pivot.y, pivot.z]));
        setCameraRevision((revision) => revision + 1);
      },
      onDocumentChange: (label, nextDocument) =>
        callbacksRef.current.onDocumentChange(label, nextDocument),
      onDocumentBoundsChange: (center) =>
        setDocumentBoundsCenter(JSON.stringify([center.x, center.y, center.z])),
      onSelectionChange: (nextSelection) =>
        callbacksRef.current.onSelectionChange(nextSelection),
      onTransformStateChange: (state) => setTransformValidity(state ?? "idle"),
      retainedIds,
      selectionState,
    });
  }, [
    attachmentParentId,
    mirrorPair,
    onDocumentChange,
    onSelectionChange,
    retainedIds,
    selectionState,
  ]);

  useEffect(() => sceneRef.current?.setDocument(document), [document]);
  useEffect(
    () => sceneRef.current?.setInteractionEnabled(!disabled),
    [disabled],
  );
  useEffect(() => sceneRef.current?.setSelection(selection), [selection]);
  useEffect(() => sceneRef.current?.setSnapEnabled(snapEnabled), [snapEnabled]);
  useEffect(() => sceneRef.current?.setTool(tool), [tool]);
  useEffect(() => {
    if (frameRequest > 0) sceneRef.current?.frameSelection();
  }, [frameRequest]);

  useEffect(() => {
    if (process.env.NODE_ENV === "production") return;
    const canvas = canvasRef.current;
    if (!canvas) return;
    const onVisualColorRequest = (event: Event) => {
      const detail = (
        event as CustomEvent<{
          instanceId: string;
          respond: (
            color: { x: number; y: number; z: number } | null,
          ) => void;
        }>
      ).detail;
      detail.respond(
        sceneRef.current?.getInstanceVisualColor(detail.instanceId) ?? null,
      );
    };
    canvas.addEventListener(
      "getKartEditorInstanceVisualColor",
      onVisualColorRequest,
    );
    return () =>
      canvas.removeEventListener(
        "getKartEditorInstanceVisualColor",
        onVisualColorRequest,
      );
  }, []);

  return (
    <div className="relative min-h-0 flex-1 overflow-hidden bg-[#070706]">
      <canvas
        aria-disabled={disabled}
        aria-label="Kart assembly viewport"
        className="h-full min-h-[18rem] w-full touch-none outline-none"
        data-camera-pivot={cameraPivot}
        data-camera-revision={cameraRevision}
        data-document-bounds-center={documentBoundsCenter}
        data-editor-status={status}
        data-mirror-counterpart-ids={mirrorCounterpartIds.join(" ")}
        data-selection-id={selection?.id ?? ""}
        data-selection-validity={selection === null ? "none" : selectionState}
        data-transform-validity={transformValidity}
        ref={canvasRef}
        tabIndex={disabled ? -1 : 0}
      />
      {status !== "ready" ? (
        <div
          className="pointer-events-none absolute inset-0 grid place-items-center bg-titan-black/82 px-6 text-center font-mono text-xs font-bold uppercase tracking-[0.16em] text-titan-muted"
          role={status === "error" ? "alert" : "status"}
        >
          {status === "error"
            ? "Kart viewport unavailable"
            : "Preparing kart workspace…"}
        </div>
      ) : null}
    </div>
  );
}

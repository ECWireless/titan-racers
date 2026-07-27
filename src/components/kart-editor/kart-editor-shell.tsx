"use client";

import { useRouter } from "next/navigation";
import {
  useCallback,
  useEffect,
  useId,
  useMemo,
  useRef,
  useState,
} from "react";

import { CommandHistory } from "@/game/editor/command-history";
import type { EditorControllerViewportHandle } from "@/game/editor/editor-controller-viewport";
import { EditorControllerAxisIndicator } from "@/components/editor-controller-axis-indicator";
import {
  EDITOR_ROTATE_SNAP,
  type EditorTransformTool,
} from "@/game/editor/editor-viewport";
import {
  type KartEditorSelection,
  type KartPrimitivePreset,
  addKartPrimitive,
  attachKartInstance,
  canAlignKartMirrorPair,
  canAttachKartInstanceAtCurrentPosition,
  canAttachKartInstanceTo,
  collectKartDocumentIds,
  deleteKartInstance,
  detachKartInstance,
  getKartEditorInstance,
  getKartMirrorCounterpartIds,
  mirrorKartInstance,
  reconcileKartEditorSelection,
  replaceKartComponentDefinition,
  updateKartIdentity,
  updateKartInstanceVisualColor,
  updateKartInstanceTransformAndAttachment,
  updateKartPrimitiveGeometry,
} from "@/game/editor/kart-editor-document";
import {
  ROUGH_COURSE_DOCUMENT,
  type CourseDocument,
} from "@/game/course/course-document";
import { CURRENT_GUEST_COURSE_ID } from "@/game/course/course-ids";
import { publishedCourseRuntimeSchema } from "@/game/course/course-publication";
import type { KartAssemblyDocument } from "@/game/kart/kart-assembly-document";
import {
  KartAssemblyValidationError,
  validateKartAssembly,
} from "@/game/kart/kart-assembly-validation";
import {
  APPROVED_COMPONENTS_BY_CATEGORY,
  getApprovedKartComponent,
} from "@/game/kart/kart-component-registry";
import { deriveKartSnapshot } from "@/game/kart/kart-derivation";
import { buildPrimitiveMassElement } from "@/game/kart/kart-construction-geometry";
import { getApprovedConstructionMaterial } from "@/game/kart/kart-material-registry";
import {
  type PersistedKartRevision,
  kartPublicationEventSchema,
  persistedKartRevisionSchema,
} from "@/game/kart/kart-publication";
import { serializeKartAssemblyDocument } from "@/game/kart/kart-assembly-document";
import { isEditableKeyboardTarget } from "@/game/input/keyboard-input";
import { useEditorController } from "@/game/input/use-editor-controller";
import { KART_EDITOR_TRANSLATE_SNAP } from "@/game/editor/kart-editor-scene";

import { SoloTimeTrialCanvas } from "../solo-time-trial-canvas";
import {
  EditorToolbarIcon,
  type EditorToolbarIconName,
} from "../editor/editor-toolbar-icon";
import { EditorSection } from "../editor/editor-section";
import { KartDerivedEvidence } from "../kart-derived-evidence";
import { KartEditorCanvas } from "./kart-editor-canvas";
import { persistKartRevisionThumbnail } from "./persist-kart-thumbnail";

type OperationState =
  | { status: "idle" }
  | { message: string; status: "error" }
  | { message: string; status: "success" }
  | { status: "saving" | "publishing" | "unpublishing" | "loading" };
type KartConfirmationAction =
  | "exit"
  | "latest"
  | "revert"
  | "sign-out"
  | "unpublish";

const primitivePresets: Array<{
  id: KartPrimitivePreset;
  label: string;
}> = [
  { id: "box-structure", label: "Structure plate" },
  { id: "box-body", label: "Body panel" },
  { id: "cylinder-guard", label: "Guard tube" },
];

function getPrimaryStructuralRootId(document: KartAssemblyDocument) {
  const instanceIds = [
    ...document.primitiveInstances.map(({ id }) => id),
    ...document.componentInstances.map(({ id }) => id),
  ];
  const childIds = new Set(
    document.structuralAttachments.map(({ child }) => child.instanceId),
  );
  const childrenByParent = new Map<string, string[]>();
  for (const attachment of document.structuralAttachments) {
    const children = childrenByParent.get(attachment.parent.instanceId) ?? [];
    children.push(attachment.child.instanceId);
    childrenByParent.set(attachment.parent.instanceId, children);
  }
  const subtreeSize = (rootId: string) => {
    const visited = new Set<string>();
    const pending = [rootId];
    while (pending.length > 0) {
      const instanceId = pending.pop()!;
      if (visited.has(instanceId)) continue;
      visited.add(instanceId);
      pending.push(...(childrenByParent.get(instanceId) ?? []));
    }
    return visited.size;
  };
  return instanceIds
    .filter((id) => !childIds.has(id))
    .reduce<{ id: string; size: number } | null>((largest, id) => {
      const size = subtreeSize(id);
      return !largest || size > largest.size ? { id, size } : largest;
    }, null)?.id;
}

export function KartEditorShell({
  onSignOut,
  revision,
  signOutError,
  signOutPending,
}: {
  onSignOut: () => void;
  revision: PersistedKartRevision;
  signOutError: string | null;
  signOutPending: boolean;
}) {
  const router = useRouter();
  const [history] = useState(
    () => new CommandHistory<KartAssemblyDocument>(revision.document),
  );
  const [document, setDocument] = useState(revision.document);
  const [currentRevision, setCurrentRevision] = useState(revision);
  const [identityDraft, setIdentityDraft] = useState({
    name: revision.document.name,
    practicalDescriptor: revision.document.practicalDescriptor,
  });
  const [historyVersion, setHistoryVersion] = useState(0);
  const [selection, setSelection] = useState<KartEditorSelection | null>(null);
  const [tool, setTool] = useState<EditorTransformTool>("translate");
  const [snapEnabled, setSnapEnabled] = useState(true);
  const [mirrorPair, setMirrorPair] = useState(false);
  const [frameRequest, setFrameRequest] = useState(0);
  const [actionsOpen, setActionsOpen] = useState(false);
  const [cameraHelpOpen, setCameraHelpOpen] = useState(false);
  const [controllerAxis, setControllerAxis] = useState<"x" | "y" | "z">("x");
  const [attachmentParentId, setAttachmentParentId] = useState("");
  const [mobilePanel, setMobilePanel] = useState<
    "outline" | "inspector" | null
  >(null);
  const [operation, setOperation] = useState<OperationState>({
    status: "idle",
  });
  const [confirmationAction, setConfirmationAction] =
    useState<KartConfirmationAction | null>(null);
  const [testSession, setTestSession] = useState<{
    courseDocument: CourseDocument;
    kartDocument: KartAssemblyDocument;
    kartRevision: number;
    kartSnapshot: PersistedKartRevision["resolvedSnapshot"];
  } | null>(null);
  const [testPending, setTestPending] = useState(false);
  const operationPendingRef = useRef(false);
  const testButtonRef = useRef<HTMLButtonElement>(null);
  const testModeTriggerRef = useRef(false);
  const actionsButtonRef = useRef<HTMLButtonElement>(null);
  const actionsContainerRef = useRef<HTMLDivElement>(null);
  const outlinePanelButtonRef = useRef<HTMLButtonElement>(null);
  const outlinePanelRef = useRef<HTMLElement>(null);
  const inspectorPanelButtonRef = useRef<HTMLButtonElement>(null);
  const inspectorPanelRef = useRef<HTMLElement>(null);
  const issuedIdsRef = useRef(collectKartDocumentIds(revision.document));
  const confirmationFocusRef = useRef<HTMLElement | null>(null);
  const shellRef = useRef<HTMLElement>(null);
  const viewportControllerRef =
    useRef<EditorControllerViewportHandle>(null);

  useEffect(() => {
    if (testSession || !testModeTriggerRef.current) return;
    const frame = requestAnimationFrame(() => {
      testButtonRef.current?.focus();
      testModeTriggerRef.current = false;
    });
    return () => cancelAnimationFrame(frame);
  }, [testSession]);

  const validation = useMemo(() => validateKartAssembly(document), [document]);
  const derivation = useMemo(() => {
    if (!validation.success) {
      return { issues: validation.issues, snapshot: null };
    }
    try {
      return { issues: [], snapshot: deriveKartSnapshot(document) };
    } catch (error) {
      return {
        issues:
          error instanceof KartAssemblyValidationError
            ? error.issues
            : [
                {
                  code: "derivation-failed",
                  message:
                    error instanceof Error
                      ? error.message
                      : "Kart derivation failed.",
                  path: [] as (string | number)[],
                },
              ],
        snapshot: null,
      };
    }
  }, [document, validation]);
  const selectedInstance = getKartEditorInstance(document, selection);
  const selectedDefinition =
    selectedInstance?.kind === "component"
      ? getApprovedKartComponent(selectedInstance.definition)
      : null;
  const scaleAvailable =
    selectedInstance?.kind === "primitive" && selectedInstance.shape === "box";
  const scaleUnavailableReason = scaleAvailable
    ? null
    : selectedInstance?.kind === "component"
      ? "Approved components have fixed dimensions"
      : selectedInstance?.kind === "primitive"
        ? "Edit cylinder radius and height in the Inspector"
        : "Select a box primitive to scale";
  const selectedAttachmentIndex = selection
    ? document.structuralAttachments.findIndex(
        ({ child }) => child.instanceId === selection.id,
      )
    : -1;
  const selectedStructuralAttachment =
    selectedAttachmentIndex >= 0
      ? document.structuralAttachments[selectedAttachmentIndex]
      : null;
  const selectedMirrorCounterpartIds = selection
    ? getKartMirrorCounterpartIds(document, selection)
    : [];
  const canAlignSelectedMirror =
    selection !== null && canAlignKartMirrorPair(document, selection);
  const canMirrorSelection =
    selectedInstance !== null &&
    selectedInstance.mirrorOf === null &&
    selectedMirrorCounterpartIds.length === 0 &&
    (selectedInstance.kind === "primitive" ||
      selectedDefinition?.assembly.mirrorable === true);
  const selectedAttachmentNeedsRefresh =
    selectedStructuralAttachment !== null &&
    derivation.issues.some(
      (issue) =>
        (issue.code === "separated-structural-attachment" ||
          issue.code === "attachment-anchor-outside-envelope") &&
        issue.path[0] === "structuralAttachments" &&
        issue.path[1] === selectedAttachmentIndex,
    );
  const primaryStructuralRootId = useMemo(
    () => getPrimaryStructuralRootId(document),
    [document],
  );
  const attachmentPositionValid =
    selection !== null &&
    attachmentParentId !== "" &&
    canAttachKartInstanceAtCurrentPosition(
      document,
      selection,
      attachmentParentId,
      issuedIdsRef.current,
    );
  const selectionStructureState: "attachable" | "invalid" | "valid" =
    selection === null
      ? "valid"
      : selectedStructuralAttachment
        ? selectedAttachmentNeedsRefresh
          ? "invalid"
          : "valid"
        : selection.id === primaryStructuralRootId
          ? "valid"
          : attachmentPositionValid
            ? "attachable"
            : "invalid";
  const attachmentActionAvailable =
    selectedStructuralAttachment !== null ||
    (attachmentParentId !== "" && attachmentPositionValid);
  const selectedAttachmentTargetInvalid =
    selection !== null &&
    selectedStructuralAttachment === null &&
    attachmentParentId !== "" &&
    !attachmentPositionValid;
  const selectedAttachmentTargetValid =
    selection !== null &&
    selectedStructuralAttachment === null &&
    attachmentParentId !== "" &&
    attachmentPositionValid;
  const attachmentActionLabel = selectedStructuralAttachment
    ? `Detach from ${selectedStructuralAttachment.parent.instanceId}`
    : attachmentParentId
      ? `Attach to ${attachmentParentId}`
      : "Attach to parent";
  const attachmentActionTooltip = attachmentActionAvailable
    ? attachmentActionLabel
    : attachmentParentId === ""
      ? "Choose a structural parent first"
      : "Move the component within the target parent’s attachment range";
  const mirrorActionTooltip = canMirrorSelection
    ? "Create a linked copy across the kart center plane"
    : selectedInstance?.mirrorOf
      ? "Select the original component to create a mirror"
      : selectedMirrorCounterpartIds.length > 0
        ? "This component already has a mirrored counterpart"
        : "This approved component cannot be mirrored";
  const operationPending =
    operation.status === "saving" ||
    operation.status === "publishing" ||
    operation.status === "unpublishing" ||
    operation.status === "loading";
  const workspaceLocked = operationPending || signOutPending;
  const published =
    currentRevision.publication?.action === "publish"
      ? currentRevision.publication
      : null;

  const commitDocument = useCallback(
    (label: string, nextDocument: KartAssemblyDocument) => {
      if (
        operationPendingRef.current ||
        signOutPending ||
        nextDocument === document
      ) {
        return;
      }
      const previous = document;
      issuedIdsRef.current = collectKartDocumentIds(
        nextDocument,
        issuedIdsRef.current,
      );
      setDocument(
        history.execute({
          apply: () => nextDocument,
          label,
          revert: () => previous,
        }),
      );
      setSelection((current) =>
        reconcileKartEditorSelection(nextDocument, current),
      );
      setHistoryVersion((version) => version + 1);
      setOperation({ status: "idle" });
    },
    [document, history, signOutPending],
  );

  useEffect(() => {
    if (!mobilePanel) return;
    const panel =
      mobilePanel === "outline"
        ? outlinePanelRef.current
        : inspectorPanelRef.current;
    requestAnimationFrame(() => {
      panel
        ?.querySelector<HTMLElement>(
          'button:not(:disabled), input:not(:disabled), select:not(:disabled), textarea:not(:disabled), [tabindex]:not([tabindex="-1"])',
        )
        ?.focus();
    });
  }, [mobilePanel]);

  useEffect(() => {
    const desktopQuery = window.matchMedia("(min-width: 1024px)");
    const closePanelAtDesktop = (event: MediaQueryListEvent) => {
      if (event.matches) setMobilePanel(null);
    };
    desktopQuery.addEventListener("change", closePanelAtDesktop);
    return () =>
      desktopQuery.removeEventListener("change", closePanelAtDesktop);
  }, []);

  useEffect(() => {
    if (!actionsOpen) return;

    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.preventDefault();
        setActionsOpen(false);
        actionsButtonRef.current?.focus();
      }
    };
    const closeOutside = (event: PointerEvent) => {
      if (
        event.target instanceof Node &&
        !actionsContainerRef.current?.contains(event.target)
      ) {
        setActionsOpen(false);
      }
    };

    window.addEventListener("keydown", closeOnEscape);
    window.addEventListener("pointerdown", closeOutside);
    return () => {
      window.removeEventListener("keydown", closeOnEscape);
      window.removeEventListener("pointerdown", closeOutside);
    };
  }, [actionsOpen]);

  useEffect(() => {
    const onBeforeUnload = (event: BeforeUnloadEvent) => {
      if (!history.isDirty) return;
      event.preventDefault();
      event.returnValue = "";
    };
    window.addEventListener("beforeunload", onBeforeUnload);
    return () => window.removeEventListener("beforeunload", onBeforeUnload);
  }, [history, historyVersion]);

  useEffect(() => {
    if (testSession || signOutPending) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (
        isEditableKeyboardTarget(event.target) ||
        operationPendingRef.current ||
        confirmationAction
      ) {
        return;
      }
      const modifier = event.ctrlKey || event.metaKey;
      if (modifier && event.key.toLowerCase() === "s") {
        event.preventDefault();
        void saveDraft();
        return;
      }
      if (modifier && event.key.toLowerCase() === "z") {
        event.preventDefault();
        if (event.shiftKey) redo();
        else undo();
        return;
      }
      if (modifier && event.key.toLowerCase() === "y") {
        event.preventDefault();
        redo();
        return;
      }
      if (!modifier && !event.altKey && !event.shiftKey) {
        if (event.key === "1") setTool("translate");
        if (event.key === "2") setTool("rotate");
        if (event.key === "3" && scaleAvailable) setTool("scale");
        if (event.key.toLowerCase() === "f") {
          setFrameRequest((request) => request + 1);
        }
      }
      if (event.key === "Delete" && selection) {
        event.preventDefault();
        removeSelection();
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
    // State-changing command callbacks intentionally refresh the listener.
  });

  function undo() {
    if (!history.canUndo || operationPendingRef.current || signOutPending)
      return;
    const next = history.undo();
    setDocument(next);
    syncIdentityDraft(next);
    syncEditorSelection(next, reconcileKartEditorSelection(next, selection));
    setHistoryVersion((version) => version + 1);
  }

  function redo() {
    if (!history.canRedo || operationPendingRef.current || signOutPending)
      return;
    const next = history.redo();
    setDocument(next);
    syncIdentityDraft(next);
    syncEditorSelection(next, reconcileKartEditorSelection(next, selection));
    setHistoryVersion((version) => version + 1);
  }

  function addPrimitive(preset: KartPrimitivePreset) {
    try {
      const added = addKartPrimitive(document, preset, issuedIdsRef.current);
      commitDocument(`Add ${preset}`, added.document);
      syncEditorSelection(added.document, added.selection);
    } catch (error) {
      showCommandError(error);
    }
  }

  function removeSelection() {
    if (!selection) return;
    if (selection.kind === "component") {
      showCommandError(
        new Error(
          "Functional components are replaced with approved variants rather than deleted, preserving their validated port connections.",
        ),
      );
      return;
    }
    const next = deleteKartInstance(document, selection);
    commitDocument(`Delete ${selection.id}`, next);
    selectInstance(null);
  }

  function mirrorSelection() {
    if (!selection) return;
    try {
      const mirrored = mirrorKartInstance(
        document,
        selection,
        issuedIdsRef.current,
      );
      commitDocument(`Mirror ${selection.id}`, mirrored.document);
      syncEditorSelection(mirrored.document, mirrored.selection);
    } catch (error) {
      showCommandError(error);
    }
  }

  function toggleSelectionAttachment() {
    if (!selection) return;
    try {
      if (selectedStructuralAttachment) {
        commitDocument(
          `Detach ${selection.id}`,
          detachKartInstance(document, selection),
        );
        return;
      }
      if (!attachmentParentId) return;
      commitDocument(
        `Attach ${selection.id}`,
        attachKartInstance(
          document,
          selection,
          attachmentParentId,
          issuedIdsRef.current,
        ),
      );
    } catch (error) {
      showCommandError(error);
    }
  }

  function syncEditorSelection(
    nextDocument: KartAssemblyDocument,
    nextSelection: KartEditorSelection | null,
  ) {
    const nextInstance = getKartEditorInstance(nextDocument, nextSelection);
    const nextAttachment = nextSelection
      ? nextDocument.structuralAttachments.find(
          ({ child }) => child.instanceId === nextSelection.id,
        )
      : null;
    setSelection(nextSelection);
    setAttachmentParentId(nextAttachment?.parent.instanceId ?? "");
    setMirrorPair(
      nextSelection !== null &&
        canAlignKartMirrorPair(nextDocument, nextSelection),
    );
    if (
      tool === "scale" &&
      !(nextInstance?.kind === "primitive" && nextInstance.shape === "box")
    ) {
      setTool("translate");
    }
  }

  function selectInstance(nextSelection: KartEditorSelection | null) {
    syncEditorSelection(document, nextSelection);
  }

  function showCommandError(error: unknown) {
    setOperation({
      message:
        error instanceof Error
          ? error.message
          : "The edit could not be applied.",
      status: "error",
    });
  }

  async function startSandboxTest() {
    testModeTriggerRef.current = true;
    setTestPending(true);
    try {
      const courseDocument = await fetch(
        `/api/courses/${CURRENT_GUEST_COURSE_ID}/published`,
        {
          cache: "no-store",
          signal: AbortSignal.timeout(3_000),
        },
      )
        .then(async (response) =>
          response.ok
            ? publishedCourseRuntimeSchema.parse(await response.json()).document
            : ROUGH_COURSE_DOCUMENT,
        )
        .catch(() => ROUGH_COURSE_DOCUMENT);
      setTestSession({
        courseDocument,
        kartDocument: currentRevision.document,
        kartRevision: currentRevision.revision,
        kartSnapshot: currentRevision.resolvedSnapshot,
      });
    } catch (error) {
      testModeTriggerRef.current = false;
      showCommandError(error);
    } finally {
      setTestPending(false);
    }
  }

  function syncIdentityDraft(nextDocument: KartAssemblyDocument) {
    setIdentityDraft({
      name: nextDocument.name,
      practicalDescriptor: nextDocument.practicalDescriptor,
    });
  }

  function commitIdentityField(
    field: "name" | "practicalDescriptor",
    value: string,
  ) {
    if (value === document[field]) {
      setIdentityDraft((current) => ({ ...current, [field]: document[field] }));
      return;
    }
    try {
      const next = updateKartIdentity(document, { [field]: value });
      syncIdentityDraft(next);
      commitDocument(
        field === "name" ? "Rename kart" : "Edit descriptor",
        next,
      );
    } catch (error) {
      setIdentityDraft((current) => ({
        ...current,
        [field]: document[field],
      }));
      showCommandError(error);
    }
  }

  async function saveDraft() {
    if (
      operationPendingRef.current ||
      signOutPending ||
      !history.isDirty ||
      !derivation.snapshot
    ) {
      return;
    }
    setActionsOpen(false);
    operationPendingRef.current = true;
    setOperation({ status: "saving" });
    try {
      const response = await fetch(`/api/admin/karts/${document.kartId}`, {
        body: JSON.stringify({
          document,
          expectedRevision: currentRevision.revision,
        }),
        credentials: "include",
        headers: { "content-type": "application/json" },
        method: "PUT",
      });
      if (response.status === 409) {
        setOperation({
          message:
            "Another administrator saved this kart first. Load the latest draft or download a backup before continuing.",
          status: "error",
        });
        return;
      }
      if (!response.ok) throw new Error("The kart draft could not be saved.");
      const saved = persistedKartRevisionSchema.parse(await response.json());
      const withThumbnail = await persistKartRevisionThumbnail(saved);
      history.markClean();
      setCurrentRevision(withThumbnail);
      setHistoryVersion((version) => version + 1);
      setOperation({
        message: `Draft revision ${saved.revision} saved.`,
        status: "success",
      });
    } catch {
      setOperation({
        message: "The kart draft could not be saved. Local changes are intact.",
        status: "error",
      });
    } finally {
      operationPendingRef.current = false;
    }
  }

  async function loadLatestDraft(confirmed = false) {
    if (
      operationPendingRef.current ||
      signOutPending
    ) {
      return;
    }
    if (history.isDirty && !confirmed) {
      openConfirmation("latest");
      return;
    }
    setActionsOpen(false);
    operationPendingRef.current = true;
    setOperation({ status: "loading" });
    try {
      const response = await fetch(`/api/admin/karts/${document.kartId}`, {
        cache: "no-store",
        credentials: "include",
      });
      if (!response.ok)
        throw new Error("The latest kart draft could not load.");
      const latest = persistedKartRevisionSchema.parse(await response.json());
      issuedIdsRef.current = collectKartDocumentIds(
        latest.document,
        issuedIdsRef.current,
      );
      setDocument(history.reload(latest.document));
      syncIdentityDraft(latest.document);
      setCurrentRevision(latest);
      selectInstance(null);
      setHistoryVersion((version) => version + 1);
      setOperation({
        message: `Loaded draft revision ${latest.revision}.`,
        status: "success",
      });
    } catch {
      setOperation({
        message: "The latest draft could not be loaded. Local work is intact.",
        status: "error",
      });
    } finally {
      operationPendingRef.current = false;
    }
  }

  async function changePublication(action: "publish" | "unpublish") {
    if (
      operationPendingRef.current ||
      signOutPending ||
      (action === "publish" && history.isDirty) ||
      (action === "publish" && published?.revision === currentRevision.revision)
    ) {
      return;
    }
    setActionsOpen(false);
    operationPendingRef.current = true;
    setOperation({
      status: action === "publish" ? "publishing" : "unpublishing",
    });
    try {
      const response = await fetch(
        `/api/admin/karts/${document.kartId}/publication`,
        {
          body: JSON.stringify({
            action,
            expectedPublicationEventId:
              currentRevision.publication?.eventId ?? null,
            ...(action === "publish"
              ? { revision: currentRevision.revision }
              : {}),
          }),
          credentials: "include",
          headers: { "content-type": "application/json" },
          method: "POST",
        },
      );
      if (response.status === 409) {
        setOperation({
          message:
            "Publication changed in another session. Load the latest draft status before retrying.",
          status: "error",
        });
        return;
      }
      if (!response.ok) {
        throw new Error(`The kart could not be ${action}ed.`);
      }
      const publication = kartPublicationEventSchema.parse(
        await response.json(),
      );
      setCurrentRevision((current) => ({ ...current, publication }));
      setOperation({
        message:
          action === "publish"
            ? `Revision ${publication.revision} published.`
            : "Kart unpublished.",
        status: "success",
      });
    } catch {
      setOperation({
        message:
          action === "publish"
            ? "The saved draft could not be published."
            : "The kart could not be unpublished.",
        status: "error",
      });
    } finally {
      operationPendingRef.current = false;
    }
  }

  function requestUnpublish(confirmed = false) {
    if (!published) return;
    if (!confirmed) {
      openConfirmation("unpublish");
      return;
    }
    void changePublication("unpublish");
  }

  function revertDraft(confirmed = false) {
    if (operationPendingRef.current || signOutPending) return;
    if (history.isDirty && !confirmed) {
      openConfirmation("revert");
      return;
    }
    const reverted = history.resetToLoaded();
    setDocument(reverted);
    syncIdentityDraft(reverted);
    selectInstance(null);
    setHistoryVersion((version) => version + 1);
    setOperation({ status: "idle" });
  }

  function downloadBackup() {
    const url = URL.createObjectURL(
      new Blob([serializeKartAssemblyDocument(document)], {
        type: "application/json",
      }),
    );
    const link = window.document.createElement("a");
    link.download = `${document.kartId}.draft-r${currentRevision.revision}.json`;
    link.href = url;
    link.click();
    URL.revokeObjectURL(url);
  }

  function requestExit(confirmed = false) {
    if (operationPendingRef.current || signOutPending) return;
    if (history.isDirty && !confirmed) {
      openConfirmation("exit");
      return;
    }
    router.push("/");
  }

  function requestSignOut(confirmed = false) {
    if (operationPendingRef.current) return;
    if (history.isDirty && !confirmed) {
      openConfirmation("sign-out");
      return;
    }
    onSignOut();
  }

  function openConfirmation(action: KartConfirmationAction) {
    const activeElement = window.document.activeElement;
    confirmationFocusRef.current =
      activeElement instanceof HTMLElement ? activeElement : null;
    setConfirmationAction(action);
  }

  function cancelConfirmation() {
    setConfirmationAction(null);
    const invokingElement = confirmationFocusRef.current;
    confirmationFocusRef.current = null;
    requestAnimationFrame(() => {
      if (invokingElement?.isConnected) {
        invokingElement.focus();
        return;
      }
      actionsButtonRef.current?.focus();
      if (window.document.activeElement === window.document.body) {
        viewportControllerRef.current?.getElement()?.focus();
      }
    });
  }

  function confirmAction() {
    const action = confirmationAction;
    setConfirmationAction(null);
    confirmationFocusRef.current = null;
    if (action === "latest") {
      void loadLatestDraft(true);
    } else if (action === "revert") {
      revertDraft(true);
    } else if (action === "unpublish") {
      requestUnpublish(true);
    } else if (action === "exit") {
      requestExit(true);
    } else if (action === "sign-out") {
      requestSignOut(true);
    }
  }

  function openMobilePanel(panel: "outline" | "inspector") {
    setMobilePanel(panel);
  }

  function closeMobilePanel() {
    const trigger =
      mobilePanel === "outline"
        ? outlinePanelButtonRef.current
        : inspectorPanelButtonRef.current;
    setMobilePanel(null);
    requestAnimationFrame(() => trigger?.focus());
  }

  function handleMobilePanelKeyDown(event: React.KeyboardEvent<HTMLElement>) {
    if (event.key === "Escape") {
      event.preventDefault();
      closeMobilePanel();
      return;
    }
    if (event.key !== "Tab") return;
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

  function updateSelectedTransform(
    group: "position" | "rotationDegrees",
    axis: "x" | "y" | "z",
    value: number,
  ) {
    if (!selection || !selectedInstance) return;
    try {
      commitDocument(
        `Edit ${selection.id} ${group}`,
        updateKartInstanceTransformAndAttachment(
          document,
          selection,
          {
            ...selectedInstance.transform,
            [group]: {
              ...selectedInstance.transform[group],
              [axis]: value,
            },
          },
          attachmentParentId,
          issuedIdsRef.current,
          mirrorPair,
        ),
      );
    } catch (error) {
      showCommandError(error);
    }
  }

  const { controllerConnected, viewportEngaged } = useEditorController({
    contextKey: [
      actionsOpen ? "actions" : "",
      cameraHelpOpen ? "help" : "",
      confirmationAction ?? "",
      mobilePanel ?? "",
    ].join(":"),
    disabled: workspaceLocked,
    onAxisCycle: (direction) => {
      const axes = ["x", "y", "z"] as const;
      setControllerAxis((axis) => {
        const index = axes.indexOf(axis);
        return axes[(index + direction + axes.length) % axes.length];
      });
    },
    onBack: () => {
      if (actionsOpen) {
        setActionsOpen(false);
        actionsButtonRef.current?.focus();
        return true;
      }
      if (cameraHelpOpen) {
        setCameraHelpOpen(false);
        return true;
      }
      if (mobilePanel) {
        closeMobilePanel();
        return true;
      }
      return false;
    },
    onFrame: () => setFrameRequest((request) => request + 1),
    onHelp: () => setCameraHelpOpen((open) => !open),
    onToolCycle: (direction) => {
      const tools: EditorTransformTool[] = scaleAvailable
        ? ["translate", "rotate", "scale"]
        : ["translate", "rotate"];
      setTool((current) => {
        const index = Math.max(0, tools.indexOf(current));
        return tools[(index + direction + tools.length) % tools.length];
      });
    },
    onTransformDirection: (direction) => {
      if (!selection || !selectedInstance) return;
      if (tool === "translate") {
        const step =
          viewportControllerRef.current?.resolveTranslationStep(direction);
        if (!step) return;
        setControllerAxis(step.axis);
        updateSelectedTransform(
          "position",
          step.axis,
          selectedInstance.transform.position[step.axis] +
            step.sign * KART_EDITOR_TRANSLATE_SNAP,
        );
      } else if (tool === "rotate") {
        const sign = direction === "right" || direction === "up" ? 1 : -1;
        updateSelectedTransform(
          "rotationDegrees",
          controllerAxis,
          selectedInstance.transform.rotationDegrees[controllerAxis] +
            sign * EDITOR_ROTATE_SNAP,
        );
      } else if (
        tool === "scale" &&
        selectedInstance.kind === "primitive" &&
        selectedInstance.shape === "box"
      ) {
        const grow = direction === "right" || direction === "up";
        try {
          commitDocument(
            `Scale ${selection.id}`,
            updateKartPrimitiveGeometry(
              document,
              selection.id,
              {
                shape: "box",
                size: {
                  ...selectedInstance.size,
                  [controllerAxis]:
                    selectedInstance.size[controllerAxis] *
                    (grow ? 1.1 : 1 / 1.1),
                },
              },
              mirrorPair,
            ),
          );
        } catch (error) {
          showCommandError(error);
        }
      }
    },
    shellRef,
    viewportRef: viewportControllerRef,
  });

  if (testSession) {
    return (
      <SoloTimeTrialCanvas
        courseDocument={testSession.courseDocument}
        kartDocument={testSession.kartDocument}
        kartSnapshot={testSession.kartSnapshot}
        recordTelemetry={false}
        sessionLabel={`Saved r${testSession.kartRevision} on sandbox course · ${testSession.kartDocument.name}`}
        onExit={() => setTestSession(null)}
      />
    );
  }

  return (
    <main
      className="flex h-dvh min-h-0 flex-col overflow-hidden bg-titan-black text-titan-ice"
      ref={shellRef}
    >
      <header
        className="relative z-50 flex min-h-14 shrink-0 items-center gap-1 border-b border-titan-ice/15 bg-titan-panel px-2 py-2 sm:gap-2 sm:px-4"
        data-editor-controller-region="header"
        data-testid="kart-editor-header"
        inert={mobilePanel !== null || confirmationAction !== null}
      >
        <button
          aria-label="Exit kart editor"
          className="mr-1 shrink-0 border border-titan-ice/20 px-2 py-2 font-mono text-[0.68rem] font-bold uppercase tracking-[0.12em] text-titan-ice/74 hover:border-titan-hazard hover:text-titan-hazard focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-titan-hazard sm:px-3"
          disabled={workspaceLocked}
          type="button"
          onClick={() => requestExit()}
        >
          <span aria-hidden="true" className="sm:hidden">
            ←
          </span>
          <span className="hidden sm:inline">Exit</span>
        </button>
        <div className="min-w-0 flex-1">
          <p className="truncate font-mono text-[0.65rem] font-bold uppercase tracking-[0.18em] text-titan-hazard">
            Kart Editor
          </p>
          <h1 className="truncate text-sm font-bold text-titan-ice">
            {document.name}
          </h1>
        </div>
        <span
          className="hidden border border-titan-ice/15 bg-titan-black/40 px-3 py-2 font-mono text-[0.65rem] font-bold uppercase tracking-[0.12em] text-titan-muted sm:inline-flex"
          data-testid="kart-editor-revision"
        >
          Draft r{currentRevision.revision} · Published{" "}
          {published ? `r${published.revision}` : "none"}
        </span>
        <button
          aria-label="Undo"
          className="editor-tool-button"
          disabled={!history.canUndo || workspaceLocked}
          title="Undo (Ctrl/Cmd+Z)"
          type="button"
          onClick={undo}
        >
          ↶
        </button>
        <button
          aria-label="Redo"
          className="editor-tool-button"
          disabled={!history.canRedo || workspaceLocked}
          title="Redo (Ctrl/Cmd+Shift+Z)"
          type="button"
          onClick={redo}
        >
          ↷
        </button>
        <span
          className={`hidden font-mono text-[0.65rem] font-bold uppercase tracking-[0.12em] lg:inline ${
            history.isDirty ? "text-titan-hazard" : "text-titan-muted"
          }`}
        >
          {history.isDirty ? "Unsaved changes" : "Draft saved"}
        </span>
        <button
          aria-label="Save draft"
          className="editor-tool-button"
          disabled={!history.isDirty || !derivation.snapshot || workspaceLocked}
          title={
            operation.status === "saving"
              ? "Saving draft…"
              : history.isDirty
                ? "Save private draft (Ctrl/Cmd+S)"
                : "Draft is saved"
          }
          type="button"
          onClick={() => void saveDraft()}
        >
          <EditorToolbarIcon name="save" />
        </button>
        <div className="hidden sm:block">
          <button
            aria-label="Publish saved draft"
            className="editor-tool-button"
            disabled={
              history.isDirty ||
              workspaceLocked ||
              published?.revision === currentRevision.revision
            }
            title={
              operation.status === "publishing"
                ? `Publishing draft r${currentRevision.revision}…`
                : history.isDirty
                  ? "Save the draft before publishing"
                  : published?.revision === currentRevision.revision
                      ? `Draft r${currentRevision.revision} is published`
                      : `Publish draft r${currentRevision.revision}`
            }
            type="button"
            onClick={() => void changePublication("publish")}
          >
            <EditorToolbarIcon name="publish" />
          </button>
        </div>
        <div className="relative" ref={actionsContainerRef}>
          <button
            aria-controls="kart-actions-list"
            aria-expanded={actionsOpen}
            aria-label="Kart actions"
            className="editor-tool-button"
            disabled={workspaceLocked}
            ref={actionsButtonRef}
            type="button"
            onClick={() => setActionsOpen((open) => !open)}
          >
            ⋯
          </button>
          {actionsOpen ? (
            <div
              className="absolute right-0 top-[calc(100%+0.5rem)] z-40 grid w-56 border border-titan-ice/20 bg-titan-black/98 p-1 shadow-[0_18px_55px_rgb(0_0_0/0.65)]"
              id="kart-actions-list"
            >
              <KartAction
                disabled={!history.isDirty}
                label="Revert changes"
                onClick={() => {
                  setActionsOpen(false);
                  revertDraft();
                }}
              />
              <KartAction
                label="Load latest draft"
                onClick={() => {
                  setActionsOpen(false);
                  void loadLatestDraft();
                }}
              />
              <KartAction
                label="Download backup"
                onClick={() => {
                  setActionsOpen(false);
                  downloadBackup();
                }}
              />
              {published ? (
                <KartAction
                  label={
                    operation.status === "unpublishing"
                      ? "Unpublishing…"
                      : "Unpublish"
                  }
                  onClick={() => {
                    setActionsOpen(false);
                    requestUnpublish();
                  }}
                />
              ) : null}
              <div className="sm:hidden">
                <KartAction
                  disabled={
                    history.isDirty ||
                    published?.revision === currentRevision.revision
                  }
                  label="Publish saved draft"
                  onClick={() => {
                    setActionsOpen(false);
                    void changePublication("publish");
                  }}
                />
                <KartAction
                  disabled={signOutPending}
                  label={signOutPending ? "Signing out…" : "Sign out"}
                  onClick={() => {
                    setActionsOpen(false);
                    requestSignOut();
                  }}
                />
              </div>
            </div>
          ) : null}
        </div>
        <button
          className="hidden border border-titan-ice/20 px-3 py-2 font-mono text-[0.65rem] font-bold uppercase tracking-[0.12em] text-titan-ice/72 hover:border-titan-hazard hover:text-titan-hazard focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-titan-hazard sm:inline-flex"
          disabled={signOutPending || operationPending}
          type="button"
          onClick={() => requestSignOut()}
        >
          {signOutPending ? "Signing out…" : "Sign out"}
        </button>
      </header>

      {operation.status !== "idle" ? (
        <div
          className={`shrink-0 border-b px-4 py-2 font-mono text-xs font-bold uppercase tracking-[0.12em] ${
            operation.status === "error"
              ? "border-titan-rust/50 bg-titan-rust/10 text-titan-ice"
              : operation.status === "success"
                ? "border-emerald-400/30 bg-emerald-400/10 text-emerald-100"
                : "border-titan-hazard/30 bg-titan-hazard/10 text-titan-hazard"
          }`}
          role={operation.status === "error" ? "alert" : "status"}
        >
          {"message" in operation
            ? operation.message
            : operation.status === "loading"
              ? "Loading latest draft…"
              : `${operation.status}…`}
        </div>
      ) : null}

      {signOutError ? (
        <div
          className="shrink-0 border-b border-titan-rust/50 bg-titan-rust/10 px-4 py-2 text-sm text-titan-ice"
          role="alert"
        >
          {signOutError}
        </div>
      ) : null}

      <div
        className="flex min-h-12 shrink-0 items-center gap-2 overflow-x-auto border-b border-titan-ice/15 bg-titan-black px-3 py-2"
        data-editor-controller-region="toolbar"
        data-testid="kart-editor-toolbar"
        inert={mobilePanel !== null || confirmationAction !== null}
      >
        {(["translate", "rotate", "scale"] as const).map((candidate, index) => (
          <button
            aria-label={
              candidate === "translate" ? "Move" : humanize(candidate)
            }
            aria-describedby={
              candidate === "scale" && scaleUnavailableReason
                ? "kart-scale-unavailable-reason"
                : undefined
            }
            aria-disabled={
              candidate === "scale" && !scaleAvailable ? true : undefined
            }
            aria-pressed={tool === candidate}
            className={`editor-tool-button ${
              tool === candidate
                ? "!border-titan-hazard !bg-titan-hazard/10 !text-titan-hazard"
                : ""
            } ${
              candidate === "scale" && !scaleAvailable
                ? "cursor-not-allowed opacity-45"
                : ""
            }`}
            disabled={workspaceLocked}
            key={candidate}
            title={
              candidate === "scale" && scaleUnavailableReason
                ? scaleUnavailableReason
                : `${
                    candidate === "translate" ? "Move" : humanize(candidate)
                  } selection (${index + 1})`
            }
            type="button"
            onClick={() => {
              if (candidate !== "scale" || scaleAvailable) setTool(candidate);
            }}
          >
            <EditorToolbarIcon name={candidate} />
          </button>
        ))}
        {controllerConnected ? (
          <EditorControllerAxisIndicator
            axis={controllerAxis}
            testId="kart-controller-axis"
          />
        ) : null}
        {scaleUnavailableReason ? (
          <span className="sr-only" id="kart-scale-unavailable-reason">
            {scaleUnavailableReason}
          </span>
        ) : null}
        <span className="h-7 w-px shrink-0 bg-titan-ice/15" />
        <button
          aria-label={`Snap ${snapEnabled ? "On" : "Off"}`}
          aria-pressed={snapEnabled}
          className={`editor-tool-button ${
            snapEnabled ? "!border-titan-blue/60 !text-titan-blue" : ""
          }`}
          disabled={workspaceLocked}
          title={`Snapping ${snapEnabled ? "on" : "off"}: position, rotation, and scale`}
          type="button"
          onClick={() => setSnapEnabled((enabled) => !enabled)}
        >
          <EditorToolbarIcon name="snap" />
          <span
            aria-hidden="true"
            className={`absolute right-1 top-1 h-1.5 w-1.5 rounded-full ${
              snapEnabled ? "bg-titan-blue" : "bg-titan-muted/45"
            }`}
          />
        </button>
        <button
          aria-label="Frame selection"
          className="editor-tool-button"
          disabled={workspaceLocked}
          title="Center the camera on the selection (F)"
          type="button"
          onClick={() => setFrameRequest((request) => request + 1)}
        >
          <EditorToolbarIcon name="frame" />
        </button>
        <button
          aria-controls="kart-camera-controls-help"
          aria-expanded={cameraHelpOpen}
          aria-label="Camera controls"
          aria-pressed={cameraHelpOpen}
          className={`editor-tool-button ${
            cameraHelpOpen
              ? "!border-titan-hazard !bg-titan-hazard/10 !text-titan-hazard"
              : ""
          }`}
          disabled={workspaceLocked}
          title="Camera gestures for mouse and touch"
          type="button"
          onClick={() => setCameraHelpOpen((open) => !open)}
        >
          <EditorToolbarIcon name="help" />
        </button>
      </div>

      <fieldset
        className="relative grid min-h-0 flex-1 grid-cols-1 grid-rows-1 overflow-hidden lg:grid-cols-[18rem_minmax(0,1fr)_23rem]"
        disabled={workspaceLocked}
        inert={confirmationAction !== null}
      >
        {mobilePanel ? (
          <button
            aria-label="Close editor panel"
            className="fixed inset-0 z-[60] bg-black/60 lg:hidden"
            type="button"
            onClick={closeMobilePanel}
          />
        ) : null}
        <aside
          aria-label="Kart and assembly"
          aria-modal={mobilePanel === "outline" ? true : undefined}
          className={`fixed inset-x-0 bottom-0 z-[70] max-h-[72dvh] content-start gap-5 overflow-y-auto border-t border-titan-ice/25 bg-[#0c0f11] p-4 shadow-[0_-18px_60px_rgb(0_0_0/0.55)] ${
            mobilePanel === "outline" ? "grid" : "hidden"
          } lg:static lg:order-1 lg:z-auto lg:grid lg:min-h-0 lg:max-h-none lg:border-r lg:border-t-0 lg:shadow-none`}
          data-editor-controller-region="outline"
          id="kart-outline-panel"
          ref={outlinePanelRef}
          role={mobilePanel === "outline" ? "dialog" : undefined}
          tabIndex={-1}
          onKeyDown={handleMobilePanelKeyDown}
        >
          <button
            className="editor-list-button lg:hidden"
            data-controller-default="true"
            data-editor-controller-back="true"
            type="button"
            onClick={closeMobilePanel}
          >
            Close kart and assembly
          </button>
          <EditorSection title="Kart">
            <label className="grid gap-1 text-xs">
              <span className="font-mono font-bold uppercase tracking-[0.12em] text-titan-muted">
                Name
              </span>
              <input
                className="editor-input"
                maxLength={80}
                value={identityDraft.name}
                onBlur={(event) =>
                  commitIdentityField("name", event.target.value)
                }
                onChange={(event) =>
                  setIdentityDraft((current) => ({
                    ...current,
                    name: event.target.value,
                  }))
                }
              />
            </label>
            <label className="grid gap-1 text-xs">
              <span className="font-mono font-bold uppercase tracking-[0.12em] text-titan-muted">
                Description
              </span>
              <textarea
                className="editor-input min-h-20 resize-y"
                maxLength={160}
                value={identityDraft.practicalDescriptor}
                onBlur={(event) =>
                  commitIdentityField("practicalDescriptor", event.target.value)
                }
                onChange={(event) =>
                  setIdentityDraft((current) => ({
                    ...current,
                    practicalDescriptor: event.target.value,
                  }))
                }
              />
            </label>
          </EditorSection>

          <EditorSection title="Add construction">
            <div className="grid gap-2">
              {primitivePresets.map((preset) => (
                <button
                  className="editor-list-button"
                  key={preset.id}
                  type="button"
                  onClick={() => addPrimitive(preset.id)}
                >
                  + {preset.label}
                </button>
              ))}
            </div>
          </EditorSection>

          <EditorSection title="Assembly outline">
            <p className="font-mono text-[0.65rem] uppercase tracking-[0.12em] text-titan-muted">
              Components
            </p>
            <div className="grid gap-1">
              {document.componentInstances.map((instance) => (
                <OutlineButton
                  active={
                    selection?.kind === "component" &&
                    selection.id === instance.id
                  }
                  key={instance.id}
                  label={
                    getApprovedKartComponent(instance.definition)?.label ??
                    instance.id
                  }
                  meta={instance.id}
                  onClick={() =>
                    selectInstance({ id: instance.id, kind: "component" })
                  }
                />
              ))}
            </div>
            <p className="mt-2 font-mono text-[0.65rem] uppercase tracking-[0.12em] text-titan-muted">
              Primitives
            </p>
            <div className="grid gap-1">
              {document.primitiveInstances.map((instance) => (
                <OutlineButton
                  active={
                    selection?.kind === "primitive" &&
                    selection.id === instance.id
                  }
                  key={instance.id}
                  label={`${humanize(instance.role)} ${instance.shape}`}
                  meta={instance.id}
                  onClick={() =>
                    selectInstance({ id: instance.id, kind: "primitive" })
                  }
                />
              ))}
            </div>
          </EditorSection>
        </aside>

        <section
          className="relative order-1 flex min-h-0 min-w-0 flex-col bg-[#070706] lg:order-2"
          data-editor-controller-region="viewport"
          data-testid="kart-editor-viewport-region"
          inert={mobilePanel !== null}
        >
          <KartEditorCanvas
            attachmentParentId={attachmentParentId}
            disabled={workspaceLocked}
            document={document}
            frameRequest={frameRequest}
            mirrorPair={mirrorPair}
            onDocumentChange={commitDocument}
            onSelectionChange={selectInstance}
            retainedIds={issuedIdsRef.current}
            selection={selection}
            selectionState={selectionStructureState}
            snapEnabled={snapEnabled}
            tool={tool}
            ref={viewportControllerRef}
          />
          {controllerConnected ? (
            <div
              className="pointer-events-none absolute bottom-40 left-1/2 z-10 -translate-x-1/2 border border-titan-blue/45 bg-titan-black/88 px-3 py-2 text-center font-mono text-[0.6rem] font-bold uppercase tracking-[0.1em] text-titan-ice/82 shadow-[0_10px_35px_rgb(0_0_0/0.45)]"
              data-testid="kart-controller-status"
            >
              {viewportEngaged
                ? `Controller viewport · ${tool} ${controllerAxis.toUpperCase()} · B exits`
                : "Controller ready · focus viewport and press A"}
            </div>
          ) : null}
          {viewportEngaged ? (
            <div
              aria-hidden="true"
              className="pointer-events-none absolute left-1/2 top-[calc(50%-4rem)] z-10 h-5 w-5 -translate-x-1/2 -translate-y-1/2 before:absolute before:left-1/2 before:top-0 before:h-full before:w-px before:-translate-x-1/2 before:bg-titan-hazard/80 after:absolute after:left-0 after:top-1/2 after:h-px after:w-full after:-translate-y-1/2 after:bg-titan-hazard/80"
              data-testid="kart-controller-reticle"
            />
          ) : null}
          {cameraHelpOpen ? (
            <section
              aria-label="Camera controls"
              className="absolute left-3 top-3 z-10 grid w-[min(19rem,calc(100%-1.5rem))] gap-3 border border-titan-ice/24 bg-titan-black/92 p-3 font-mono text-[0.68rem] shadow-[0_16px_50px_rgb(0_0_0/0.55)] backdrop-blur"
              id="kart-camera-controls-help"
            >
              <div className="flex items-center justify-between gap-3">
                <h2 className="font-bold uppercase tracking-[0.14em] text-titan-hazard">
                  Camera controls
                </h2>
                <button
                  aria-label="Close camera controls"
                  className="grid h-8 w-8 place-items-center border border-titan-ice/20 text-titan-ice/78 hover:border-titan-hazard hover:text-titan-hazard"
                  data-controller-default="true"
                  data-editor-controller-back="true"
                  type="button"
                  onClick={() => setCameraHelpOpen(false)}
                >
                  ×
                </button>
              </div>
              <div className="grid grid-cols-[auto_1fr] gap-x-3 gap-y-1 text-titan-ice/82">
                <span className="font-bold uppercase text-titan-muted">
                  Touch
                </span>
                <span>1 finger orbit · 2 finger pan · pinch zoom</span>
                <span className="font-bold uppercase text-titan-muted">
                  Mouse
                </span>
                <span>Right-drag orbit · Shift-drag pan · wheel zoom</span>
                <span className="font-bold uppercase text-titan-muted">
                  Pad
                </span>
                <span>
                  A engage/select · sticks pan/orbit · triggers zoom · LB/RB
                  tool · X axis · Y frame · D-pad transform · B exit
                </span>
              </div>
              <p className="text-titan-muted">
                Controller input is best-effort for spatial editing; use pointer
                or numeric fields for precise freeform changes.
              </p>
            </section>
          ) : null}
          <div className="grid gap-1 border-t border-titan-ice/15 bg-[#0b0d0e] p-3">
            <button
              aria-busy={testPending}
              className="titan-button titan-button-primary !min-h-11 !py-2"
              disabled={testPending}
              ref={testButtonRef}
              type="button"
              onClick={startSandboxTest}
            >
              {testPending ? "Loading sandbox…" : "Test saved kart"}
            </button>
            <p className="text-xs leading-relaxed text-titan-muted">
              Drive saved revision {currentRevision.revision} on the current
              sandbox course. Unsaved changes are not included.
            </p>
          </div>
          <div className="absolute bottom-3 left-3 right-3 z-20 grid grid-cols-2 gap-2 lg:hidden">
            <button
              aria-controls="kart-outline-panel"
              aria-expanded={mobilePanel === "outline"}
              className="editor-mobile-panel-button"
              ref={outlinePanelButtonRef}
              type="button"
              onClick={() => openMobilePanel("outline")}
            >
              Kart &amp; parts
            </button>
            <button
              aria-controls="kart-inspector-panel"
              aria-expanded={mobilePanel === "inspector"}
              className="editor-mobile-panel-button"
              ref={inspectorPanelButtonRef}
              type="button"
              onClick={() => openMobilePanel("inspector")}
            >
              Inspector
            </button>
          </div>
        </section>

        <aside
          aria-label="Inspector"
          aria-modal={mobilePanel === "inspector" ? true : undefined}
          className={`fixed inset-x-0 bottom-0 z-[70] max-h-[72dvh] content-start gap-5 overflow-y-auto border-t border-titan-ice/25 bg-[#0c0f11] p-4 shadow-[0_-18px_60px_rgb(0_0_0/0.55)] ${
            mobilePanel === "inspector" ? "grid" : "hidden"
          } lg:static lg:order-3 lg:z-auto lg:grid lg:min-h-0 lg:max-h-none lg:border-l lg:border-t-0 lg:shadow-none`}
          data-editor-controller-region="inspector"
          id="kart-inspector-panel"
          ref={inspectorPanelRef}
          role={mobilePanel === "inspector" ? "dialog" : undefined}
          tabIndex={-1}
          onKeyDown={handleMobilePanelKeyDown}
        >
          <button
            className="editor-list-button lg:hidden"
            data-controller-default="true"
            data-editor-controller-back="true"
            type="button"
            onClick={closeMobilePanel}
          >
            Close inspector
          </button>
          <EditorSection title="Inspector">
            {selection && selectedInstance ? (
              <>
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <p className="truncate font-bold">{selection.id}</p>
                    <p className="font-mono text-[0.65rem] uppercase tracking-[0.1em] text-titan-muted">
                      {selectedInstance.kind === "component"
                        ? selectedDefinition?.label
                        : `${selectedInstance.role} ${selectedInstance.shape}`}
                    </p>
                  </div>
                  <div
                    aria-label="Selection actions"
                    className="flex shrink-0 gap-2"
                    role="group"
                  >
                    <InspectorIconButton
                      disabled={!attachmentActionAvailable}
                      icon={selectedStructuralAttachment ? "detach" : "attach"}
                      label={attachmentActionLabel}
                      tooltip={attachmentActionTooltip}
                      onClick={toggleSelectionAttachment}
                    />
                    <InspectorIconButton
                      disabled={!canMirrorSelection}
                      icon="mirror"
                      label="Mirror across center plane"
                      tooltip={mirrorActionTooltip}
                      onClick={mirrorSelection}
                    />
                    {selectedInstance.kind === "primitive" ? (
                      <InspectorIconButton
                        destructive
                        icon="delete"
                        label="Delete primitive"
                        tooltip="Delete this primitive (Delete)"
                        onClick={removeSelection}
                      />
                    ) : null}
                  </div>
                </div>
                {selectedDefinition ? (
                  <div className="grid gap-3">
                    <label className="grid gap-1 text-xs">
                      <span className="font-mono font-bold uppercase tracking-[0.1em] text-titan-muted">
                        Choose variant
                      </span>
                      <select
                        className="editor-input"
                        value={selectedDefinition.id}
                        onChange={(event) => {
                          try {
                            commitDocument(
                              `Change ${selectedInstance.id} component`,
                              replaceKartComponentDefinition(
                                document,
                                selectedInstance.id,
                                event.target.value,
                              ),
                            );
                          } catch (error) {
                            showCommandError(error);
                          }
                        }}
                      >
                        {APPROVED_COMPONENTS_BY_CATEGORY[
                          selectedDefinition.category
                        ].map((definition) => (
                          <option key={definition.id} value={definition.id}>
                            {definition.label} — {definition.tradeoff}
                          </option>
                        ))}
                      </select>
                    </label>
                    <p className="text-xs text-titan-muted">
                      {selectedDefinition.summary}
                    </p>
                    <ComponentPhysicalAttributes
                      definition={selectedDefinition}
                    />
                  </div>
                ) : selectedInstance.kind === "primitive" ? (
                  <PrimitivePhysicalAttributes instance={selectedInstance} />
                ) : null}
                <label className="grid gap-1 text-xs">
                  <span className="font-mono font-bold uppercase tracking-[0.1em] text-titan-muted">
                    Color
                  </span>
                  <input
                    aria-label={
                      selectedInstance.kind === "component"
                        ? "Selected component color"
                        : "Selected primitive color"
                    }
                    className="h-11 w-full cursor-pointer border border-titan-ice/20 bg-transparent"
                    type="color"
                    value={selectedInstance.visualColor}
                    onChange={(event) =>
                      commitDocument(
                        `Change ${selectedInstance.id} color`,
                        updateKartInstanceVisualColor(
                          document,
                          selection,
                          event.target.value,
                        ),
                      )
                    }
                  />
                </label>
                {selectedAttachmentNeedsRefresh ? (
                  <div
                    className="grid gap-2 border border-titan-hazard/50 bg-titan-hazard/10 p-3 text-sm text-titan-ice"
                    role="alert"
                  >
                    <p className="font-bold text-titan-hazard">
                      Outside attachment range
                    </p>
                    <p>
                      {selection.id} is outside{" "}
                      {selectedStructuralAttachment.parent.instanceId}’s
                      attachment range and must be detached.
                    </p>
                  </div>
                ) : null}
                {selectedAttachmentTargetInvalid ? (
                  <div
                    className="grid gap-2 border border-titan-hazard/50 bg-titan-hazard/10 p-3 text-sm text-titan-ice"
                    role="alert"
                  >
                    <p className="font-bold text-titan-hazard">
                      Outside attachment range
                    </p>
                    <p>
                      {selection.id} is detached from {attachmentParentId}. Move
                      it into that parent’s attachment range before attaching.
                    </p>
                  </div>
                ) : null}
                {selectedAttachmentTargetValid ? (
                  <div className="grid gap-2 border border-amber-400/50 bg-amber-400/10 p-3 text-sm text-titan-ice">
                    <p className="font-bold text-amber-300">Ready to attach</p>
                    <p>
                      {selection.id} is positioned within {attachmentParentId}’s
                      attachment range. Use Attach to confirm the relationship.
                    </p>
                  </div>
                ) : null}
                <label className="grid gap-1 text-xs">
                  <span className="font-mono font-bold uppercase tracking-[0.1em] text-titan-muted">
                    Structural parent
                  </span>
                  <select
                    className="editor-input"
                    disabled={selectedStructuralAttachment !== null}
                    title={
                      selectedStructuralAttachment
                        ? "Detach before choosing another structural parent"
                        : undefined
                    }
                    value={attachmentParentId}
                    onChange={(event) =>
                      setAttachmentParentId(event.target.value)
                    }
                  >
                    <option value="">Choose parent…</option>
                    {[
                      ...document.primitiveInstances,
                      ...document.componentInstances,
                    ]
                      .filter(({ id }) =>
                        canAttachKartInstanceTo(document, selection, id),
                      )
                      .map(({ id }) => (
                        <option key={id} value={id}>
                          {id}
                        </option>
                      ))}
                  </select>
                </label>
                {selectedMirrorCounterpartIds.length > 0 ? (
                  <div className="grid gap-2 border border-titan-hazard/35 bg-titan-hazard/8 px-3 py-2 text-sm">
                    <div className="flex items-start gap-2">
                      <span
                        aria-hidden="true"
                        className="mt-1 h-2.5 w-2.5 shrink-0 rounded-full bg-titan-hazard shadow-[0_0_10px_rgb(255_122_24/0.85)]"
                      />
                      <div className="min-w-0">
                        <p className="font-bold text-titan-ice/82">
                          Mirrored component
                        </p>
                        <p className="break-words font-mono text-[0.65rem] text-titan-hazard">
                          {selectedMirrorCounterpartIds.join(", ")}
                        </p>
                      </div>
                    </div>
                    {canAlignSelectedMirror ? (
                      <label className="flex min-h-9 items-center justify-between gap-3 border-t border-titan-ice/10 pt-2">
                        <span className="font-bold text-titan-ice/82">
                          Keep mirrored component aligned
                        </span>
                        <input
                          aria-label="Keep mirrored component aligned"
                          checked={mirrorPair}
                          className="h-5 w-5 shrink-0 accent-titan-hazard"
                          type="checkbox"
                          onChange={(event) =>
                            setMirrorPair(event.target.checked)
                          }
                        />
                      </label>
                    ) : null}
                  </div>
                ) : null}
                <VectorEditor
                  label="Position (m)"
                  value={selectedInstance.transform.position}
                  onChange={(axis, value) =>
                    updateSelectedTransform("position", axis, value)
                  }
                />
                <VectorEditor
                  label="Rotation (deg)"
                  step={5}
                  value={selectedInstance.transform.rotationDegrees}
                  onChange={(axis, value) =>
                    updateSelectedTransform("rotationDegrees", axis, value)
                  }
                />
                {selectedInstance.kind === "primitive" ? (
                  <PrimitiveGeometryEditor
                    instance={selectedInstance}
                    onChange={(values) => {
                      try {
                        commitDocument(
                          `Resize ${selectedInstance.id}`,
                          updateKartPrimitiveGeometry(
                            document,
                            selectedInstance.id,
                            values,
                            mirrorPair,
                          ),
                        );
                      } catch (error) {
                        showCommandError(error);
                      }
                    }}
                  />
                ) : null}
              </>
            ) : (
              <p className="text-sm text-titan-muted">
                Select a component or primitive in the outline or viewport.
              </p>
            )}
          </EditorSection>

          <EditorSection title="Live validation">
            {derivation.snapshot ? (
              <div className="grid gap-2">
                <p
                  className="border border-emerald-400/30 bg-emerald-400/10 p-3 text-sm text-emerald-100"
                  role="status"
                >
                  Assembly is valid and deterministically derived.
                </p>
              </div>
            ) : (
              <>
                <p
                  className="border border-titan-rust/50 bg-titan-rust/10 p-3 text-sm text-titan-ice"
                  role="alert"
                >
                  Invalid construction cannot be saved or published. Testing
                  continues to use the last saved revision.
                </p>
                <ol className="grid gap-2 text-xs">
                  {derivation.issues.slice(0, 10).map((issue, index) => (
                    <li
                      className="border-l-2 border-titan-rust pl-3"
                      key={`${issue.code}-${index}`}
                    >
                      <span className="font-mono text-[0.62rem] uppercase tracking-[0.08em] text-titan-rust">
                        {formatIssuePath(issue.path, issue.code)}
                      </span>
                      <br />
                      {issue.message}
                    </li>
                  ))}
                </ol>
              </>
            )}
          </EditorSection>

          {derivation.snapshot ? (
            <KartDerivedEvidence snapshot={derivation.snapshot} />
          ) : null}
        </aside>
      </fieldset>
      {confirmationAction ? (
        <KartConfirmationDialog
          action={confirmationAction}
          documentName={document.name}
          publishedRevision={published?.revision ?? null}
          onCancel={cancelConfirmation}
          onConfirm={confirmAction}
        />
      ) : null}
    </main>
  );
}

function KartConfirmationDialog({
  action,
  documentName,
  onCancel,
  onConfirm,
  publishedRevision,
}: {
  action: KartConfirmationAction;
  documentName: string;
  onCancel: () => void;
  onConfirm: () => void;
  publishedRevision: number | null;
}) {
  const cancelButtonRef = useRef<HTMLButtonElement>(null);
  const actionLabel =
    action === "latest"
      ? "Load latest draft"
      : action === "revert"
        ? "Revert changes"
        : action === "unpublish"
          ? "Unpublish kart"
          : action === "exit"
            ? "Exit editor"
            : "Sign out";
  const title =
    action === "unpublish"
      ? "Unpublish kart?"
      : "Discard unsaved changes?";
  const description =
    action === "latest"
      ? "Loading the latest saved draft replaces your local unsaved work. Download a backup first if you may need it."
      : action === "revert"
        ? "Reverting restores the last loaded or saved draft and removes your local unsaved work."
        : action === "unpublish"
          ? `${documentName} revision ${publishedRevision ?? ""} will no longer be available to players.`
          : action === "exit"
            ? "Exiting now removes your local unsaved work. Save a draft or keep editing if you may need it."
            : "Signing out now removes your local unsaved work. Save a draft or keep editing if you may need it.";

  useEffect(() => {
    cancelButtonRef.current?.focus();
  }, []);

  return (
    <div
      className="fixed inset-0 z-[80] grid place-items-center bg-titan-black/74 p-4"
      onKeyDown={(event) => {
        if (event.key === "Escape") {
          event.preventDefault();
          onCancel();
          return;
        }
        if (event.key !== "Tab") return;
        const buttons = Array.from(
          event.currentTarget.querySelectorAll<HTMLButtonElement>(
            "button:not(:disabled)",
          ),
        );
        const first = buttons[0];
        const last = buttons.at(-1);
        if (event.shiftKey && document.activeElement === first) {
          event.preventDefault();
          last?.focus();
        } else if (!event.shiftKey && document.activeElement === last) {
          event.preventDefault();
          first?.focus();
        }
      }}
    >
      <section
        aria-labelledby="kart-confirmation-title"
        aria-modal="true"
        className="grid w-full max-w-md gap-5 border border-titan-ice/24 bg-titan-panel p-5 shadow-[0_24px_90px_rgb(0_0_0/0.8)]"
        data-editor-controller-region="confirmation-dialog"
        role="dialog"
      >
        <div>
          <h2
            className="font-mono text-sm font-bold uppercase tracking-[0.12em] text-titan-hazard"
            id="kart-confirmation-title"
          >
            {title}
          </h2>
          <p className="mt-2 text-sm leading-relaxed text-titan-ice/76">
            {description}
          </p>
        </div>
        <div className="flex flex-wrap justify-end gap-2">
          <button
            className="min-h-10 border border-titan-ice/22 px-3 font-mono text-[0.65rem] font-bold uppercase tracking-[0.08em] text-titan-ice/78 hover:border-titan-hazard hover:text-titan-hazard"
            data-controller-default="true"
            data-editor-controller-back="true"
            ref={cancelButtonRef}
            type="button"
            onClick={onCancel}
          >
            {action === "unpublish" ? "Keep published" : "Keep editing"}
          </button>
          <button
            className="min-h-10 border border-titan-rust/65 bg-titan-rust/8 px-3 font-mono text-[0.65rem] font-bold uppercase tracking-[0.08em] text-titan-rust"
            type="button"
            onClick={onConfirm}
          >
            {actionLabel}
          </button>
        </div>
      </section>
    </div>
  );
}

function InspectorIconButton({
  destructive = false,
  disabled = false,
  icon,
  label,
  onClick,
  tooltip,
}: {
  destructive?: boolean;
  disabled?: boolean;
  icon: Extract<
    EditorToolbarIconName,
    "attach" | "delete" | "detach" | "mirror"
  >;
  label: string;
  onClick: () => void;
  tooltip: string;
}) {
  const tooltipId = useId();
  return (
    <span className="group relative">
      <button
        aria-describedby={tooltipId}
        aria-label={label}
        className={`grid h-9 w-9 place-items-center border bg-titan-black/35 transition focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-titan-hazard ${
          destructive
            ? "border-titan-rust/60 text-titan-rust hover:border-titan-rust hover:bg-titan-rust/10"
            : "border-titan-ice/20 text-titan-ice/80 hover:border-titan-hazard hover:bg-titan-hazard/10 hover:text-titan-hazard"
        } disabled:border-titan-ice/10 disabled:bg-titan-black/20 disabled:text-titan-muted/40`}
        disabled={disabled}
        title={tooltip}
        type="button"
        onClick={onClick}
      >
        <EditorToolbarIcon name={icon} />
      </button>
      <span
        className="pointer-events-none absolute right-0 top-[calc(100%+0.5rem)] z-30 w-max max-w-52 border border-titan-ice/20 bg-[#080a0b] px-2 py-1.5 text-right font-mono text-[0.62rem] font-bold uppercase tracking-[0.08em] text-titan-ice opacity-0 shadow-xl transition-opacity group-hover:opacity-100 group-focus-within:opacity-100"
        id={tooltipId}
        role="tooltip"
      >
        {tooltip}
      </span>
    </span>
  );
}

function KartAction({
  disabled = false,
  label,
  onClick,
}: {
  disabled?: boolean;
  label: string;
  onClick: () => void;
}) {
  return (
    <button
      className="min-h-10 px-3 py-2 text-left font-mono text-[0.65rem] font-bold uppercase tracking-[0.08em] text-titan-ice/78 hover:bg-titan-ice/8 hover:text-titan-hazard disabled:cursor-not-allowed disabled:text-titan-muted/55 disabled:hover:bg-transparent"
      disabled={disabled}
      type="button"
      onClick={onClick}
    >
      {label}
    </button>
  );
}

function OutlineButton({
  active,
  label,
  meta,
  onClick,
}: {
  active: boolean;
  label: string;
  meta: string;
  onClick: () => void;
}) {
  return (
    <button
      aria-pressed={active}
      className={`grid min-h-11 gap-0.5 border px-3 py-2 text-left ${
        active
          ? "border-titan-hazard bg-titan-hazard/10"
          : "border-titan-ice/15 bg-titan-black/30 hover:border-titan-ice/40"
      }`}
      type="button"
      onClick={onClick}
    >
      <span className="text-xs font-bold">{label}</span>
      <span className="truncate font-mono text-[0.58rem] uppercase tracking-[0.08em] text-titan-muted">
        {meta}
      </span>
    </button>
  );
}

function VectorEditor({
  label,
  onChange,
  step = 0.005,
  value,
}: {
  label: string;
  onChange: (axis: "x" | "y" | "z", value: number) => void;
  step?: number;
  value: { x: number; y: number; z: number };
}) {
  return (
    <fieldset className="grid gap-1">
      <legend className="font-mono text-[0.65rem] font-bold uppercase tracking-[0.1em] text-titan-muted">
        {label}
      </legend>
      <div className="grid grid-cols-3 gap-2">
        {(["x", "y", "z"] as const).map((axis) => (
          <label className="grid gap-1 text-[0.65rem]" key={axis}>
            <span className="font-mono uppercase text-titan-muted">{axis}</span>
            <input
              className="editor-input"
              step={step}
              type="number"
              value={roundForInput(value[axis])}
              onChange={(event) =>
                onChange(axis, event.currentTarget.valueAsNumber)
              }
            />
          </label>
        ))}
      </div>
    </fieldset>
  );
}

function PrimitiveGeometryEditor({
  instance,
  onChange,
}: {
  instance: KartAssemblyDocument["primitiveInstances"][number];
  onChange: (
    value:
      | { shape: "box"; size: { x: number; y: number; z: number } }
      | { height: number; radius: number; shape: "cylinder" },
  ) => void;
}) {
  if (instance.shape === "box") {
    return (
      <VectorEditor
        label="Size (m)"
        value={instance.size}
        onChange={(axis, value) =>
          onChange({
            shape: "box",
            size: { ...instance.size, [axis]: value },
          })
        }
      />
    );
  }
  return (
    <div className="grid grid-cols-2 gap-2">
      {(["radius", "height"] as const).map((field) => (
        <label className="grid gap-1 text-xs" key={field}>
          <span className="font-mono uppercase text-titan-muted">
            {field} (m)
          </span>
          <input
            className="editor-input"
            min={0.001}
            step={0.005}
            type="number"
            value={roundForInput(instance[field])}
            onChange={(event) =>
              onChange({
                height:
                  field === "height"
                    ? event.currentTarget.valueAsNumber
                    : instance.height,
                radius:
                  field === "radius"
                    ? event.currentTarget.valueAsNumber
                    : instance.radius,
                shape: "cylinder",
              })
            }
          />
        </label>
      ))}
    </div>
  );
}

function PrimitivePhysicalAttributes({
  instance,
}: {
  instance: KartAssemblyDocument["primitiveInstances"][number];
}) {
  const material = getApprovedConstructionMaterial(instance.material);
  let mass: number | null = null;
  try {
    mass = buildPrimitiveMassElement(instance).mass;
  } catch {
    // Live validation reports unavailable material definitions separately.
  }
  return (
    <div className="grid gap-2 border border-titan-ice/15 bg-titan-black/25 p-3">
      <p className="font-mono text-[0.65rem] font-bold uppercase tracking-[0.1em] text-titan-hazard">
        Physical attributes
      </p>
      <Readout
        label="Mass"
        value={mass === null ? "Unavailable" : `${mass.toFixed(3)} kg`}
      />
      <Readout
        label="Material"
        value={material?.label ?? instance.material.id}
      />
      {material ? (
        <Readout
          label="Density"
          value={`${material.density.toFixed(0)} kg/m³`}
        />
      ) : null}
      <Readout
        label="Construction"
        value={
          instance.construction.mode === "solid"
            ? "Solid"
            : `${formatMillimeters(instance.construction.thickness)} shell`
        }
      />
      {instance.shape === "box" ? (
        <Readout
          label="Dimensions"
          value={`${formatMillimeters(instance.size.x)} × ${formatMillimeters(instance.size.y)} × ${formatMillimeters(instance.size.z)}`}
        />
      ) : (
        <>
          <Readout
            label="Radius / height"
            value={`${formatMillimeters(instance.radius)} / ${formatMillimeters(instance.height)}`}
          />
          <Readout label="Cylinder axis" value={instance.axis.toUpperCase()} />
        </>
      )}
      <Readout label="Collision" value={humanize(instance.collision)} />
    </div>
  );
}

function ComponentPhysicalAttributes({
  definition,
}: {
  definition: NonNullable<ReturnType<typeof getApprovedKartComponent>>;
}) {
  const attributes = [
    { label: "Mass", value: `${definition.mass.toFixed(3)} kg` },
  ];
  switch (definition.category) {
    case "battery":
      attributes.push(
        { label: "Voltage", value: `${definition.electrical.voltage} V` },
        {
          label: "Maximum current",
          value: `${definition.electrical.maximumCurrent} A`,
        },
      );
      break;
    case "receiver-speed-controller":
      attributes.push(
        {
          label: "Maximum voltage",
          value: `${definition.electrical.maximumVoltage} V`,
        },
        {
          label: "Maximum motor current",
          value: `${definition.electrical.maximumMotorCurrent} A`,
        },
      );
      break;
    case "motor":
      attributes.push(
        {
          label: "Speed constant",
          value: `${definition.electrical.speedConstantRpmPerVolt.toFixed(0)} rpm/V`,
        },
        {
          label: "Safe current",
          value: `${definition.electrical.safeCurrent} A`,
        },
        {
          label: "Winding resistance",
          value: `${definition.electrical.windingResistance} Ω`,
        },
      );
      break;
    case "steering":
      attributes.push(
        {
          label: "Maximum travel",
          value: `${definition.steering.maximumTravelDegrees}°`,
        },
        {
          label: "Maximum torque",
          value: `${definition.steering.maximumTorque.toFixed(2)} N·m`,
        },
      );
      break;
    case "brakes":
      attributes.push(
        {
          label: "Service-brake torque",
          value: `${definition.brakes.totalServiceBrakeTorque.toFixed(3)} N·m`,
        },
        {
          label: "Handbrake torque",
          value: `${definition.brakes.totalHandbrakeTorque.toFixed(3)} N·m`,
        },
      );
      break;
    case "transmission":
      attributes.push(
        {
          label: "Reduction ratio",
          value: `${definition.transmission.motorRotationsPerWheelRotation}:1`,
        },
        {
          label: "Efficiency",
          value: `${(definition.transmission.efficiency * 100).toFixed(1)}%`,
        },
      );
      break;
    case "suspension":
      attributes.push(
        {
          label: "Spring rate",
          value: `${definition.suspension.springRate.toFixed(0)} N/m`,
        },
        {
          label: "Damper rate",
          value: `${definition.suspension.damperRate.toFixed(2)} N·s/m`,
        },
        {
          label: "Maximum stroke",
          value: formatMillimeters(definition.suspension.maximumStroke),
        },
        {
          label: "Bump starts",
          value: formatMillimeters(definition.suspension.bumpStart),
        },
      );
      break;
    case "wheel-tire":
      attributes.push(
        {
          label: "Radius",
          value: formatMillimeters(definition.wheelTire.radius),
        },
        {
          label: "Width",
          value: formatMillimeters(definition.wheelTire.width),
        },
        {
          label: "Tire compound",
          value: definition.wheelTire.tireCompound.id,
        },
      );
      break;
  }

  return (
    <div className="grid gap-2 border border-titan-ice/15 bg-titan-black/25 p-3">
      <p className="font-mono text-[0.65rem] font-bold uppercase tracking-[0.1em] text-titan-hazard">
        Physical attributes
      </p>
      {attributes.map((attribute) => (
        <Readout
          key={attribute.label}
          label={attribute.label}
          value={attribute.value}
        />
      ))}
    </div>
  );
}

function Readout({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-start justify-between gap-3 text-xs">
      <span className="text-titan-muted">{label}</span>
      <output className="text-right font-mono text-titan-ice">{value}</output>
    </div>
  );
}

function humanize(value: string) {
  return value
    .replace(/([a-z])([A-Z])/g, "$1 $2")
    .replaceAll("-", " ")
    .replace(/^./, (letter) => letter.toUpperCase());
}

function formatIssuePath(path: (string | number)[], fallback: string) {
  if (path.length === 0) return humanize(fallback);
  return path
    .map((segment) =>
      typeof segment === "number" ? `Item ${segment + 1}` : humanize(segment),
    )
    .join(" › ");
}

function roundForInput(value: number) {
  return Number(value.toFixed(5));
}

function formatMillimeters(value: number) {
  return `${(value * 1_000).toFixed(1)} mm`;
}

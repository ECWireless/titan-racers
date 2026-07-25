import {
  useEffect,
  useRef,
  useState,
  type RefObject,
} from "react";

import type { EditorControllerViewportHandle } from "../editor/editor-controller-viewport";
import {
  EditorGamepadInput,
  type EditorGamepadActions,
} from "./editor-gamepad-input";
import {
  findSpatialNavigationCandidate,
  type SpatialCandidate,
} from "./editor-spatial-navigation";

const FOCUSABLE_SELECTOR = [
  "button:not(:disabled)",
  "a[href]",
  "input:not(:disabled)",
  "select:not(:disabled)",
  "textarea:not(:disabled)",
  '[tabindex]:not([tabindex="-1"])',
].join(",");

type EditorControllerOptions = {
  contextKey: string;
  disabled: boolean;
  onAxisCycle: (direction: -1 | 1) => void;
  onBack: () => boolean;
  onFrame: () => void;
  onHelp: () => void;
  onToolCycle: (direction: -1 | 1) => void;
  onTransformDirection: (
    direction: NonNullable<EditorGamepadActions["transformDirection"]>,
  ) => void;
  shellRef: RefObject<HTMLElement | null>;
  viewportRef: RefObject<EditorControllerViewportHandle | null>;
};

function isRendered(element: HTMLElement) {
  return element.getClientRects().length > 0;
}

function isEligible(element: HTMLElement) {
  return (
    isRendered(element) &&
    !element.closest("[inert]") &&
    element.getAttribute("aria-disabled") !== "true" &&
    !("disabled" in element && Boolean(element.disabled))
  );
}

function activeDialog(shell: HTMLElement) {
  return Array.from(
    shell.querySelectorAll<HTMLElement>('[role="dialog"]'),
  ).filter(isRendered).at(-1) ?? null;
}

function controllerRegion(element: HTMLElement, scope: HTMLElement) {
  const region = element.closest<HTMLElement>(
    '[data-editor-controller-region], [role="dialog"]',
  );
  return region && scope.contains(region)
    ? region.dataset.editorControllerRegion ??
        region.getAttribute("aria-label") ??
        region.id ??
        "dialog"
    : null;
}

function focusCandidates(scope: HTMLElement) {
  return Array.from(
    scope.querySelectorAll<HTMLElement>(FOCUSABLE_SELECTOR),
  ).filter(isEligible);
}

function defaultCandidate(scope: HTMLElement, candidates: HTMLElement[]) {
  return (
    candidates.find(
      (candidate) => candidate.dataset.controllerDefault === "true",
    ) ??
    (scope.matches(FOCUSABLE_SELECTOR) && isEligible(scope) ? scope : null) ??
    candidates[0] ??
    null
  );
}

function asSpatialCandidate(
  element: HTMLElement,
  scope: HTMLElement,
  order: number,
): SpatialCandidate<HTMLElement> {
  const rect = element.getBoundingClientRect();
  return {
    order,
    rect: {
      bottom: rect.bottom,
      left: rect.left,
      right: rect.right,
      top: rect.top,
    },
    region: controllerRegion(element, scope),
    value: element,
  };
}

function hasViewportActivity(actions: EditorGamepadActions) {
  return (
    Math.abs(actions.orbitX) > 0 ||
    Math.abs(actions.orbitY) > 0 ||
    Math.abs(actions.panX) > 0 ||
    Math.abs(actions.panY) > 0 ||
    Math.abs(actions.zoom) > 0
  );
}

export function useEditorController({
  contextKey,
  disabled,
  onAxisCycle,
  onBack,
  onFrame,
  onHelp,
  onToolCycle,
  onTransformDirection,
  shellRef,
  viewportRef,
}: EditorControllerOptions) {
  const callbacksRef = useRef({
    onAxisCycle,
    onBack,
    onFrame,
    onHelp,
    onToolCycle,
    onTransformDirection,
  });
  const [controllerConnected, setControllerConnected] = useState(false);
  const [viewportEngaged, setViewportEngaged] = useState(false);
  const connectedRef = useRef(false);
  const engagedRef = useRef(false);

  useEffect(() => {
    callbacksRef.current = {
      onAxisCycle,
      onBack,
      onFrame,
      onHelp,
      onToolCycle,
      onTransformDirection,
    };
  }, [
    onAxisCycle,
    onBack,
    onFrame,
    onHelp,
    onToolCycle,
    onTransformDirection,
  ]);

  useEffect(() => {
    const shell = shellRef.current;
    if (!shell || disabled) {
      engagedRef.current = false;
      setViewportEngaged(false);
      setControllerConnected(false);
      return;
    }

    const input = new EditorGamepadInput(
      () => navigator.getGamepads?.() ?? [],
    );
    let animationFrame = 0;
    let lastFrameAt = performance.now();
    let pointerIdleTimer = 0;

    const clearPointerIdleTimer = () => {
      window.clearTimeout(pointerIdleTimer);
      pointerIdleTimer = 0;
    };

    const setEngaged = (engaged: boolean) => {
      engagedRef.current = engaged;
      setViewportEngaged(engaged);
      const canvas = shell.querySelector<HTMLCanvasElement>(
        '[data-editor-controller-viewport="true"]',
      );
      if (canvas) {
        canvas.dataset.controllerEngaged = String(engaged);
      }
      input.setContext(engaged ? "viewport" : "ui");
    };

    const showControllerFocus = () => {
      shell.dataset.controllerNavigation = "true";
    };
    const clearControllerFocus = () => {
      delete shell.dataset.controllerNavigation;
      delete shell.dataset.controllerPointerActive;
      clearPointerIdleTimer();
    };
    const focusElement = (element: HTMLElement) => {
      showControllerFocus();
      element.focus();
      element.scrollIntoView({ block: "nearest", inline: "nearest" });
    };
    const getScope = () => activeDialog(shell) ?? shell;
    const getCurrent = (scope: HTMLElement, items: HTMLElement[]) => {
      const active = document.activeElement;
      return active instanceof HTMLElement &&
        scope.contains(active) &&
        isEligible(active)
        ? active
        : defaultCandidate(scope, items);
    };
    const moveFocus = (direction: NonNullable<EditorGamepadActions["move"]>) => {
      const scope = getScope();
      const items = focusCandidates(scope);
      const current = getCurrent(scope, items);
      if (!current) return;
      const candidates = items.map((item, order) =>
        asSpatialCandidate(item, scope, order),
      );
      const origin =
        candidates.find(({ value }) => value === current) ??
        asSpatialCandidate(current, scope, -1);
      const target = findSpatialNavigationCandidate(
        origin,
        candidates,
        direction,
      );
      focusElement(target?.value ?? current);
    };
    const activateCurrent = () => {
      const scope = getScope();
      const items = focusCandidates(scope);
      const current = getCurrent(scope, items);
      if (!current) return;
      focusElement(current);
      if (current === viewportRef.current?.getElement()) {
        setEngaged(true);
        return;
      }
      current.click();
    };
    const back = () => {
      if (callbacksRef.current.onBack()) {
        input.clear();
        return;
      }
      const scope = getScope();
      if (scope !== shell) {
        const safeBack = scope.querySelector<HTMLElement>(
          '[data-editor-controller-back="true"], [data-controller-default="true"]',
        );
        if (safeBack && isEligible(safeBack)) {
          focusElement(safeBack);
          safeBack.click();
          input.clear();
          return;
        }
      }
      const canvas = viewportRef.current?.getElement();
      if (canvas) focusElement(canvas);
    };

    const poll = (nowMs: number) => {
      const deltaSeconds = Math.min(0.05, Math.max(0, (nowMs - lastFrameAt) / 1000));
      lastFrameAt = nowMs;
      const actions = input.sample(nowMs);
      if (actions.connected !== connectedRef.current) {
        connectedRef.current = actions.connected;
        setControllerConnected(actions.connected);
      }
      if (!actions.connected && engagedRef.current) {
        setEngaged(false);
      }

      const hasAction =
        actions.move !== null ||
        actions.confirmRequested ||
        actions.backRequested ||
        actions.frameRequested ||
        actions.helpRequested ||
        actions.toolCycle !== 0 ||
        actions.axisCycle !== 0 ||
        actions.transformDirection !== null ||
        hasViewportActivity(actions);
      if (hasAction) showControllerFocus();

      if (engagedRef.current) {
        const canvas = viewportRef.current?.getElement();
        if (
          activeDialog(shell) ||
          !canvas ||
          document.activeElement !== canvas
        ) {
          setEngaged(false);
        } else if (actions.backRequested) {
          setEngaged(false);
        } else {
          if (hasViewportActivity(actions)) {
            viewportRef.current?.applyControllerCamera(
              {
                orbitX: actions.orbitX,
                orbitY: actions.orbitY,
                panX: actions.panX,
                panY: actions.panY,
                zoom: actions.zoom,
              },
              deltaSeconds,
            );
          }
          if (actions.confirmRequested) viewportRef.current?.selectAtCenter();
          if (actions.frameRequested) callbacksRef.current.onFrame();
          if (actions.helpRequested) callbacksRef.current.onHelp();
          if (actions.toolCycle !== 0) {
            callbacksRef.current.onToolCycle(actions.toolCycle);
          }
          if (actions.axisCycle !== 0) {
            callbacksRef.current.onAxisCycle(actions.axisCycle);
          }
          if (actions.transformDirection) {
            callbacksRef.current.onTransformDirection(
              actions.transformDirection,
            );
          }
        }
      } else if (actions.helpRequested) {
        callbacksRef.current.onHelp();
      } else if (actions.backRequested) {
        back();
      } else if (actions.move) {
        moveFocus(actions.move);
      } else if (actions.confirmRequested) {
        activateCurrent();
      }

      animationFrame = window.requestAnimationFrame(poll);
    };

    const clear = () => {
      input.clear();
      if (engagedRef.current) setEngaged(false);
    };
    const onPointerDown = () => {
      clearControllerFocus();
      clear();
    };
    const onPointerMove = () => {
      if (shell.dataset.controllerNavigation !== "true") return;
      shell.dataset.controllerPointerActive = "true";
      clearPointerIdleTimer();
      pointerIdleTimer = window.setTimeout(() => {
        delete shell.dataset.controllerPointerActive;
        pointerIdleTimer = 0;
      }, 1_000);
    };
    const clearControllerState = () => {
      clearControllerFocus();
      clear();
    };
    const onVisibilityChange = () => {
      if (document.hidden) {
        clearControllerState();
      }
    };

    shell.dataset.editorControllerReady = "true";
    shell.addEventListener("pointerdown", onPointerDown);
    shell.addEventListener("pointermove", onPointerMove);
    window.addEventListener("blur", clearControllerState);
    window.addEventListener("gamepaddisconnected", clearControllerState);
    document.addEventListener("visibilitychange", onVisibilityChange);
    animationFrame = window.requestAnimationFrame(poll);

    return () => {
      window.cancelAnimationFrame(animationFrame);
      shell.removeEventListener("pointerdown", onPointerDown);
      shell.removeEventListener("pointermove", onPointerMove);
      window.removeEventListener("blur", clearControllerState);
      window.removeEventListener(
        "gamepaddisconnected",
        clearControllerState,
      );
      document.removeEventListener("visibilitychange", onVisibilityChange);
      delete shell.dataset.editorControllerReady;
      clearControllerFocus();
      const canvas = shell.querySelector<HTMLCanvasElement>(
        '[data-editor-controller-viewport="true"]',
      );
      if (canvas) delete canvas.dataset.controllerEngaged;
      input.clear();
      connectedRef.current = false;
      engagedRef.current = false;
      setControllerConnected(false);
      setViewportEngaged(false);
    };
  }, [contextKey, disabled, shellRef, viewportRef]);

  return { controllerConnected, viewportEngaged };
}

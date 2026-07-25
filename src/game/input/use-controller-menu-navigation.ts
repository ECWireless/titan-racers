import { useEffect, useRef, type RefObject } from "react";

import {
  EditorGamepadInput,
  type EditorFocusDirection,
} from "./editor-gamepad-input";
import { GamepadMenuInput } from "./gamepad-menu-input";
import {
  findSpatialNavigationCandidate,
  type SpatialCandidate,
} from "./editor-spatial-navigation";

const MENU_ITEM_SELECTOR =
  'button:not(:disabled), a[href], [tabindex]:not([tabindex="-1"])';

type ControllerMenuNavigationOptions = {
  containerRef: RefObject<HTMLElement | null>;
  enabled: boolean;
  navigationMode?: "linear" | "spatial";
  onBack?: () => void;
  onMenu?: () => void;
};

function isRendered(element: HTMLElement) {
  return element.getClientRects().length > 0;
}

export function useControllerMenuNavigation({
  containerRef,
  enabled,
  navigationMode = "linear",
  onBack,
  onMenu,
}: ControllerMenuNavigationOptions) {
  const onBackRef = useRef(onBack);
  const onMenuRef = useRef(onMenu);

  useEffect(() => {
    onBackRef.current = onBack;
    onMenuRef.current = onMenu;
  }, [onBack, onMenu]);

  useEffect(() => {
    if (!enabled) {
      return;
    }

    const getGamepads = () => navigator.getGamepads?.() ?? [];
    const linearInput =
      navigationMode === "linear" ? new GamepadMenuInput(getGamepads) : null;
    const spatialInput =
      navigationMode === "spatial"
        ? new EditorGamepadInput(getGamepads)
        : null;
    const initialContainer = containerRef.current;
    if (initialContainer) {
      initialContainer.dataset.controllerMenuReady = "true";
    }
    let animationFrame = 0;
    let pointerIdleTimer = 0;

    const clearPointerIdleTimer = () => {
      window.clearTimeout(pointerIdleTimer);
      pointerIdleTimer = 0;
    };

    const getItems = () => {
      const container = containerRef.current;
      if (!container) {
        return [];
      }
      return Array.from(
        container.querySelectorAll<HTMLElement>(MENU_ITEM_SELECTOR),
      ).filter(isRendered);
    };

    const focusItem = (item: HTMLElement, container: HTMLElement) => {
      container.dataset.controllerNavigation = "true";
      item.focus();
    };

    const getFocusedOrDefault = (items: HTMLElement[]) => {
      const focusedIndex = items.indexOf(
        window.document.activeElement as HTMLElement,
      );
      if (focusedIndex >= 0) {
        return focusedIndex;
      }
      const declaredDefault = items.findIndex(
        (item) => item.dataset.controllerDefault === "true",
      );
      return declaredDefault >= 0 ? declaredDefault : 0;
    };

    const moveSpatialFocus = (
      direction: EditorFocusDirection,
      current: HTMLElement,
      items: HTMLElement[],
      container: HTMLElement,
    ) => {
      const candidates = items.map((item, order) => {
        const rect = item.getBoundingClientRect();
        return {
          order,
          rect: {
            bottom: rect.bottom,
            left: rect.left,
            right: rect.right,
            top: rect.top,
          },
          region: null,
          value: item,
        } satisfies SpatialCandidate<HTMLElement>;
      });
      const origin = candidates.find(({ value }) => value === current);
      if (!origin) return;
      const target = findSpatialNavigationCandidate(
        origin,
        candidates,
        direction,
      );
      focusItem(target?.value ?? current, container);
    };

    const poll = (nowMs: number) => {
      const container = containerRef.current;
      if (container) {
        let backRequested = false;
        let confirmRequested = false;
        let menuRequested = false;
        let move = 0;
        let moveDirection: EditorFocusDirection | null = null;
        if (spatialInput) {
          const actions = spatialInput.sample(nowMs);
          backRequested = actions.backRequested;
          confirmRequested = actions.confirmRequested;
          menuRequested = actions.helpRequested;
          moveDirection = actions.move;
        } else if (linearInput) {
          const actions = linearInput.sample(nowMs);
          backRequested = actions.backRequested;
          confirmRequested = actions.confirmRequested;
          menuRequested = actions.menuRequested;
          move = actions.move;
        }
        const items = getItems();
        const hasAction =
          move !== 0 ||
          moveDirection !== null ||
          confirmRequested ||
          backRequested ||
          menuRequested;

        if (hasAction && items.length > 0) {
          const currentIndex = getFocusedOrDefault(items);
          const current = items[currentIndex];
          if (current && window.document.activeElement !== current) {
            focusItem(current, container);
          }

          if (menuRequested && onMenuRef.current) {
            onMenuRef.current();
          } else if (backRequested && onBackRef.current) {
            onBackRef.current();
          } else if (moveDirection) {
            if (current) {
              moveSpatialFocus(
                moveDirection,
                current,
                items,
                container,
              );
            }
          } else if (move !== 0) {
            const nextIndex =
              (currentIndex + move + items.length) % items.length;
            const next = items[nextIndex];
            if (next) {
              focusItem(next, container);
            }
          } else if (confirmRequested) {
            current?.click();
          }
        } else if (hasAction) {
          if (menuRequested && onMenuRef.current) {
            onMenuRef.current();
          } else if (backRequested && onBackRef.current) {
            onBackRef.current();
          }
        }
      }
      animationFrame = window.requestAnimationFrame(poll);
    };

    const clear = () => {
      linearInput?.clear();
      spatialInput?.clear();
    };
    const clearControllerPresentation = () => {
      if (containerRef.current) {
        delete containerRef.current.dataset.controllerNavigation;
        delete containerRef.current.dataset.controllerPointerActive;
      }
      clearPointerIdleTimer();
    };
    const onPointerDown = () => clearControllerPresentation();
    const onPointerMove = () => {
      const container = containerRef.current;
      if (!container || container.dataset.controllerNavigation !== "true") {
        return;
      }
      container.dataset.controllerPointerActive = "true";
      clearPointerIdleTimer();
      pointerIdleTimer = window.setTimeout(() => {
        delete container.dataset.controllerPointerActive;
        pointerIdleTimer = 0;
      }, 1_000);
    };
    const clearControllerState = () => {
      clear();
      clearControllerPresentation();
    };
    const onVisibilityChange = () => {
      if (document.hidden) {
        clearControllerState();
      }
    };

    initialContainer?.addEventListener("pointerdown", onPointerDown);
    initialContainer?.addEventListener("pointermove", onPointerMove);
    window.addEventListener("blur", clearControllerState);
    window.addEventListener("gamepaddisconnected", clearControllerState);
    document.addEventListener("visibilitychange", onVisibilityChange);
    animationFrame = window.requestAnimationFrame(poll);

    return () => {
      window.cancelAnimationFrame(animationFrame);
      initialContainer?.removeEventListener("pointerdown", onPointerDown);
      initialContainer?.removeEventListener("pointermove", onPointerMove);
      window.removeEventListener("blur", clearControllerState);
      window.removeEventListener(
        "gamepaddisconnected",
        clearControllerState,
      );
      document.removeEventListener("visibilitychange", onVisibilityChange);
      clearControllerPresentation();
      if (initialContainer) {
        delete initialContainer.dataset.controllerMenuReady;
      }
      clear();
    };
  }, [containerRef, enabled, navigationMode]);
}

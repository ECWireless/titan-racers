import { useEffect, useRef, type RefObject } from "react";

import { playUiSound } from "@/game/audio/ui-sounds";

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
  /** Only back (and menu) respond, as while a screen's choices load. */
  backOnly?: boolean;
  containerRef: RefObject<HTMLElement | null>;
  enabled: boolean;
  /**
   * Spatial menus only: arrow keys move focus as the stick does, and Escape
   * goes back. Off in races, where the arrows drive.
   */
  keyboard?: boolean;
  navigationMode?: "linear" | "spatial";
  onBack?: () => void;
  onMenu?: () => void;
};

function isRendered(element: HTMLElement) {
  return element.getClientRects().length > 0;
}

export function useControllerMenuNavigation({
  backOnly = false,
  containerRef,
  enabled,
  keyboard = false,
  navigationMode = "linear",
  onBack,
  onMenu,
}: ControllerMenuNavigationOptions) {
  const backOnlyRef = useRef(backOnly);
  const onBackRef = useRef(onBack);
  const onMenuRef = useRef(onMenu);

  useEffect(() => {
    backOnlyRef.current = backOnly;
    onBackRef.current = onBack;
    onMenuRef.current = onMenu;
  }, [backOnly, onBack, onMenu]);

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

    const focusItem = (
      item: HTMLElement,
      container: HTMLElement,
      fromController = true,
    ) => {
      if (fromController) container.dataset.controllerNavigation = "true";
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
      fromController = true,
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
      if (target && target.value !== current) playUiSound("move");
      focusItem(target?.value ?? current, container, fromController);
    };

    const keyDirections: Record<string, EditorFocusDirection> = {
      ArrowDown: "down",
      ArrowLeft: "left",
      ArrowRight: "right",
      ArrowUp: "up",
    };
    const onKeyDown = (event: KeyboardEvent) => {
      const container = containerRef.current;
      if (
        !container ||
        event.defaultPrevented ||
        event.altKey ||
        event.ctrlKey ||
        event.metaKey ||
        event.shiftKey
      ) {
        return;
      }
      const target = event.target;
      if (
        target instanceof HTMLElement &&
        (target.isContentEditable ||
          target.closest("input, textarea, select") !== null)
      ) {
        return;
      }
      if (event.key === "Escape") {
        if (!onBackRef.current) return;
        event.preventDefault();
        playUiSound("back");
        onBackRef.current();
        return;
      }
      const direction = keyDirections[event.key];
      if (!direction || backOnlyRef.current) return;
      const items = getItems();
      if (items.length === 0) return;
      event.preventDefault();
      const focusedIndex = items.indexOf(
        window.document.activeElement as HTMLElement,
      );
      if (focusedIndex < 0) {
        const current = items[getFocusedOrDefault(items)];
        if (current) focusItem(current, container, false);
        return;
      }
      const current = items[focusedIndex];
      if (current) {
        moveSpatialFocus(direction, current, items, container, false);
      }
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
        if (backOnlyRef.current) {
          confirmRequested = false;
          move = 0;
          moveDirection = null;
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
            playUiSound("back");
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
              if (next !== current) playUiSound("move");
              focusItem(next, container);
            }
          } else if (confirmRequested) {
            current?.click();
          }
        } else if (hasAction) {
          if (menuRequested && onMenuRef.current) {
            onMenuRef.current();
          } else if (backRequested && onBackRef.current) {
            playUiSound("back");
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
    const clearControllerState = () => {
      clear();
      clearControllerPresentation();
    };
    const onPointerDown = () => clearControllerState();
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
    const onVisibilityChange = () => {
      if (document.hidden) {
        clearControllerState();
      }
    };

    const keyboardNavigation = keyboard && navigationMode === "spatial";
    if (keyboardNavigation) {
      window.addEventListener("keydown", onKeyDown);
    }
    initialContainer?.addEventListener("pointerdown", onPointerDown);
    initialContainer?.addEventListener("pointermove", onPointerMove);
    window.addEventListener("blur", clearControllerState);
    window.addEventListener("gamepaddisconnected", clearControllerState);
    document.addEventListener("visibilitychange", onVisibilityChange);
    animationFrame = window.requestAnimationFrame(poll);

    return () => {
      window.cancelAnimationFrame(animationFrame);
      if (keyboardNavigation) {
        window.removeEventListener("keydown", onKeyDown);
      }
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
  }, [containerRef, enabled, keyboard, navigationMode]);
}

import { useEffect, useRef, type RefObject } from "react";

import { GamepadMenuInput } from "./gamepad-menu-input";

const MENU_ITEM_SELECTOR =
  'button:not(:disabled), a[href], [tabindex]:not([tabindex="-1"])';

type ControllerMenuNavigationOptions = {
  containerRef: RefObject<HTMLElement | null>;
  enabled: boolean;
  onBack?: () => void;
  onMenu?: () => void;
};

function isRendered(element: HTMLElement) {
  return element.getClientRects().length > 0;
}

export function useControllerMenuNavigation({
  containerRef,
  enabled,
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

    const input = new GamepadMenuInput(
      () => navigator.getGamepads?.() ?? [],
    );
    const initialContainer = containerRef.current;
    if (initialContainer) {
      initialContainer.dataset.controllerMenuReady = "true";
    }
    let animationFrame = 0;

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

    const poll = (nowMs: number) => {
      const container = containerRef.current;
      if (container) {
        const actions = input.sample(nowMs);
        const items = getItems();
        const hasAction =
          actions.move !== 0 ||
          actions.confirmRequested ||
          actions.backRequested ||
          actions.menuRequested;

        if (hasAction && items.length > 0) {
          const currentIndex = getFocusedOrDefault(items);
          const current = items[currentIndex];
          if (current && window.document.activeElement !== current) {
            focusItem(current, container);
          }

          if (actions.menuRequested && onMenuRef.current) {
            onMenuRef.current();
          } else if (actions.backRequested && onBackRef.current) {
            onBackRef.current();
          } else if (actions.move !== 0) {
            const nextIndex =
              (currentIndex + actions.move + items.length) % items.length;
            const next = items[nextIndex];
            if (next) {
              focusItem(next, container);
            }
          } else if (actions.confirmRequested) {
            current?.click();
          }
        } else if (hasAction) {
          if (actions.menuRequested && onMenuRef.current) {
            onMenuRef.current();
          } else if (actions.backRequested && onBackRef.current) {
            onBackRef.current();
          }
        }
      }
      animationFrame = window.requestAnimationFrame(poll);
    };

    const clear = () => input.clear();
    const clearControllerPresentation = () => {
      if (containerRef.current) {
        delete containerRef.current.dataset.controllerNavigation;
      }
    };
    const onPointerDown = () => clearControllerPresentation();
    const onVisibilityChange = () => {
      if (document.hidden) {
        clear();
        clearControllerPresentation();
      }
    };

    initialContainer?.addEventListener("pointerdown", onPointerDown);
    window.addEventListener("blur", clear);
    document.addEventListener("visibilitychange", onVisibilityChange);
    animationFrame = window.requestAnimationFrame(poll);

    return () => {
      window.cancelAnimationFrame(animationFrame);
      initialContainer?.removeEventListener("pointerdown", onPointerDown);
      window.removeEventListener("blur", clear);
      document.removeEventListener("visibilitychange", onVisibilityChange);
      clearControllerPresentation();
      if (initialContainer) {
        delete initialContainer.dataset.controllerMenuReady;
      }
      input.clear();
    };
  }, [containerRef, enabled]);
}

"use client";

import { useEffect } from "react";

import {
  playUiSound,
  uiSoundFor,
  wakeUiSound,
} from "@/game/audio/ui-sounds";

/**
 * Plays a menu sound for every button, link, and switch activated anywhere
 * in the app, by pointer, key, or controller. A sound due before the audio
 * has started is skipped rather than played late. It listens after the page's
 * own handlers, so a switch sounds as it lands (turning Sound effects on
 * sounds; turning it off is silent).
 */
export function UiSounds() {
  useEffect(() => {
    const onClick = (event: MouseEvent) => {
      const control =
        event.target instanceof Element
          ? event.target.closest("button, a[href], [role='switch']")
          : null;
      const sound = control ? uiSoundFor(control) : null;
      if (sound) playUiSound(sound);
    };
    // Browsers start audio only inside a gesture, and starting takes a
    // moment: a pointer's down wakes it before its click's sound.
    const wakeEvents = ["pointerdown", "keydown", "touchend"] as const;
    wakeEvents.forEach((name) =>
      window.addEventListener(name, wakeUiSound, { capture: true }),
    );
    window.addEventListener("click", onClick);
    return () => {
      wakeEvents.forEach((name) =>
        window.removeEventListener(name, wakeUiSound, { capture: true }),
      );
      window.removeEventListener("click", onClick);
    };
  }, []);
  return null;
}

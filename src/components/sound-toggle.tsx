"use client";

import { useState } from "react";

import { readSoundOn, writeSoundOn } from "@/game/audio/race-audio";

/** The player's Sound effects switch, saved on this device as it changes. */
export function SoundToggle({
  on,
  onChange,
}: {
  on: boolean;
  onChange: (on: boolean) => void;
}) {
  return (
    <button
      aria-checked={on}
      className="flex min-h-[3.25rem] w-full items-center justify-between gap-4 border border-titan-ice/20 bg-titan-black/60 px-4 py-3 text-titan-ice/85 transition hover:border-titan-hazard hover:text-titan-ice focus-visible:border-titan-hazard focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-titan-hazard motion-reduce:transition-none"
      role="switch"
      type="button"
      onClick={() => {
        writeSoundOn(!on);
        onChange(!on);
      }}
    >
      {/* The global `button { font: inherit }` would override these on the
          button itself. */}
      <span className="whitespace-nowrap text-left font-mono text-xs font-bold uppercase tracking-[0.14em]">
        Sound effects
      </span>
      <span
        aria-hidden="true"
        className={`relative h-5 w-10 shrink-0 border transition-colors motion-reduce:transition-none ${
          on
            ? "border-titan-hazard bg-titan-hazard/25"
            : "border-titan-ice/30 bg-titan-black"
        }`}
      >
        <span
          className={`absolute top-[3px] size-3 transition-[left,background-color] motion-reduce:transition-none ${
            on ? "left-[23px] bg-titan-hazard" : "left-[3px] bg-titan-ice/45"
          }`}
        />
      </span>
    </button>
  );
}

/**
 * The switch outside a race, such as in the home menu. It mounts only after
 * a click opens its menu, so reading storage at once is safe.
 */
export function StoredSoundToggle() {
  const [on, setOn] = useState(readSoundOn);
  return <SoundToggle on={on} onChange={setOn} />;
}

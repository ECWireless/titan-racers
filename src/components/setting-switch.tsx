"use client";

import { type ReactNode, useId, useState } from "react";

import {
  readSoundOn,
  readVolume,
  writeSoundOn,
  writeVolume,
} from "@/game/audio/race-audio";
import { writeGhostSwitch } from "@/game/ghost/device-ghost";

type StoredSwitchProps = {
  on: boolean;
  onChange: (on: boolean) => void;
};

/** The player's Sound effects switch, saved on this device as it changes. */
export function SoundToggle({
  icon,
  on,
  onChange,
}: StoredSwitchProps & { icon?: ReactNode }) {
  return (
    <SettingSwitch
      icon={icon}
      label="Sound effects"
      on={on}
      onToggle={() => {
        writeSoundOn(!on);
        onChange(!on);
      }}
    />
  );
}

/** The player's Ghost switch, saved on this device as it changes. */
export function GhostToggle({ on, onChange }: StoredSwitchProps) {
  return (
    <SettingSwitch
      label="Ghost"
      on={on}
      onToggle={() => {
        writeGhostSwitch(!on);
        onChange(!on);
      }}
    />
  );
}

function SettingSwitch({
  icon,
  label,
  on,
  onToggle,
}: {
  icon?: ReactNode;
  label: string;
  on: boolean;
  onToggle: () => void;
}) {
  return (
    <button
      aria-checked={on}
      className="flex min-h-[3.25rem] w-full items-center justify-between gap-4 border border-titan-ice/20 bg-titan-black/60 px-4 py-3 text-titan-ice/85 transition hover:border-titan-hazard hover:text-titan-ice focus-visible:border-titan-hazard focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-titan-hazard motion-reduce:transition-none"
      role="switch"
      type="button"
      onClick={onToggle}
    >
      {/* The global `button { font: inherit }` would override these on the
          button itself. */}
      <span className="flex items-center gap-3 whitespace-nowrap text-left font-mono text-xs font-bold uppercase tracking-[0.14em]">
        {icon}
        {label}
      </span>
      <span
        aria-hidden="true"
        className={`relative h-5 w-10 shrink-0 border transition-colors motion-reduce:transition-none ${
          on
            ? "border-titan-ice bg-titan-ice/15"
            : "border-titan-ice/30 bg-titan-black"
        }`}
      >
        <span
          className={`absolute top-[3px] size-3 transition-[left,background-color] motion-reduce:transition-none ${
            on ? "left-[23px] bg-titan-ice" : "left-[3px] bg-titan-ice/45"
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
export function StoredSoundToggle({ icon }: { icon?: ReactNode }) {
  const [on, setOn] = useState(readSoundOn);
  return <SoundToggle icon={icon} on={on} onChange={setOn} />;
}

const VOLUME_BUTTON =
  "grid size-9 place-items-center border border-titan-ice/24 font-mono text-base font-bold text-titan-ice/85 transition hover:border-titan-hazard hover:text-titan-hazard focus-visible:border-titan-hazard focus-visible:text-titan-hazard focus-visible:outline-none";

/**
 * The player's volume for race and menu sound, in tenths, saved on this
 * device. Buttons rather than a slider, so a controller adjusts it in every
 * menu. Each step plays a tick at the new level; a step past either end
 * says it is unavailable.
 */
export function VolumeControl() {
  const labelId = useId();
  // Mounts only inside a menu opened in the browser, so storage is there.
  const [level, setLevel] = useState(readVolume);
  const percent = Math.round(level * 100);
  const change = (tenths: number) => {
    const next = Math.min(1, Math.max(0, Math.round(level * 10 + tenths) / 10));
    setLevel(next);
    writeVolume(next);
  };
  return (
    <div
      aria-labelledby={labelId}
      className="flex min-h-[3.25rem] w-full items-center justify-between gap-4 border border-titan-ice/20 bg-titan-black/60 px-4 py-2 text-titan-ice/85"
      role="group"
    >
      <span
        className="font-mono text-xs font-bold uppercase tracking-[0.14em]"
        id={labelId}
      >
        Volume
      </span>
      <span className="flex items-center gap-2">
        <button
          aria-disabled={percent === 0 ? "true" : undefined}
          aria-label="Lower volume"
          className={VOLUME_BUTTON}
          data-ui-sound="toggle"
          type="button"
          onClick={() => change(-1)}
        >
          −
        </button>
        <output
          aria-live="polite"
          className="w-12 text-center font-mono text-xs font-bold tabular-nums"
        >
          {percent}%
        </output>
        <button
          aria-disabled={percent === 100 ? "true" : undefined}
          aria-label="Raise volume"
          className={VOLUME_BUTTON}
          data-ui-sound="toggle"
          type="button"
          onClick={() => change(1)}
        >
          +
        </button>
      </span>
    </div>
  );
}

"use client";

import { useEffect, useRef } from "react";

import type { PersistedResolvedKartSnapshot } from "@/game/kart/kart-derivation";
import type { DeepReadonly } from "@/game/kart/immutable-registry";

import { KartDerivedEvidence } from "./kart-derived-evidence";

type KartStatsDrawerProps = {
  onClose: () => void;
  snapshot: DeepReadonly<PersistedResolvedKartSnapshot>;
};

export function KartStatsDrawer({
  onClose,
  snapshot,
}: KartStatsDrawerProps) {
  const closeButtonRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    closeButtonRef.current?.focus();
  }, []);

  return (
    <section
      aria-labelledby="kart-stats-title"
      className="fixed bottom-[max(0.75rem,env(safe-area-inset-bottom))] right-[max(0.75rem,env(safe-area-inset-right))] top-[4.25rem] z-[25] flex w-[min(22rem,calc(100vw-1.5rem))] flex-col overflow-hidden border border-titan-ice/25 bg-titan-black/94 text-titan-ice shadow-[0_24px_90px_rgb(0_0_0/0.62)] backdrop-blur"
      id="kart-stats-drawer"
    >
      <div className="flex items-start justify-between gap-4 border-b border-titan-ice/15 p-3">
        <div className="grid gap-1">
          <h2
            className="font-mono text-xs font-black uppercase tracking-[0.16em] text-titan-hazard"
            id="kart-stats-title"
          >
            Kart stats
          </h2>
          <p className="font-mono text-[0.65rem] leading-4 text-titan-ice/55">
            Construction-derived snapshot · T closes
          </p>
        </div>
        <button
          aria-keyshortcuts="T"
          className="border border-titan-ice/20 px-2 py-1 font-mono text-[0.65rem] font-bold uppercase tracking-[0.1em] text-titan-ice/80 hover:border-titan-hazard hover:text-titan-hazard focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-titan-hazard"
          ref={closeButtonRef}
          type="button"
          onClick={onClose}
        >
          Close
        </button>
      </div>

      <div className="grid min-h-0 flex-1 content-start gap-5 overflow-y-auto p-4">
        <KartDerivedEvidence snapshot={snapshot} />
      </div>
    </section>
  );
}

"use client";

import Image from "next/image";
import { useState } from "react";

const actions = [
  {
    label: "Race Friends",
    variant: "primary",
  },
  {
    label: "Solo Time Trial",
    variant: "secondary",
  },
] as const;

export function PlayHome() {
  const [toast, setToast] = useState<string | null>(null);

  function showComingSoon() {
    setToast("coming soon");
  }

  return (
    <section className="relative z-10 mx-auto flex min-h-screen w-full max-w-7xl flex-col px-5 py-6 sm:px-8 lg:px-12">
      <header className="flex items-center justify-between gap-6">
        <Image
          src="/titan-racers-logo.png"
          alt="Titan Racers"
          width={300}
          height={60}
          priority
          className="h-11 w-auto sm:h-14"
        />
      </header>

      <div className="flex flex-1 items-center justify-center py-16 text-center">
        <div className="w-full max-w-md">
          <p className="mb-4 font-mono text-xs font-bold uppercase tracking-[0.22em] text-titan-hazard">
            Choose game mode
          </p>
          <div className="grid gap-4">
            {actions.map((action) => (
              <button
                key={action.label}
                className={
                  action.variant === "primary"
                    ? "titan-button titan-button-primary"
                    : "titan-button titan-button-secondary"
                }
                type="button"
                onClick={showComingSoon}
              >
                {action.label}
              </button>
            ))}
          </div>
          <div
            className="mt-5 min-h-10 font-mono text-xs font-bold uppercase tracking-[0.18em] text-titan-ice/78"
            role="status"
            aria-live="polite"
          >
            {toast ? (
              <span className="inline-flex border border-titan-orange bg-titan-black/78 px-4 py-3 shadow-[0_20px_60px_rgb(0_0_0/0.42)]">
                {toast}
              </span>
            ) : null}
          </div>
        </div>
      </div>
    </section>
  );
}

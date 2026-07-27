"use client";

import Image from "next/image";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useRef, useState } from "react";

import { useControllerMenuNavigation } from "@/game/input/use-controller-menu-navigation";
import type { KartAssemblyDocument } from "@/game/kart/kart-assembly-document";
import { persistedKartRevisionSchema } from "@/game/kart/kart-publication";
import { racerOnboardingPath } from "@/lib/racer-username";

import { KartThumbnail } from "../kart-thumbnail";

export type OfficialKartRosterCard = {
  document: KartAssemblyDocument;
  kartId: string;
  name: string;
  practicalDescriptor: string;
  stats: {
    acceleration: number;
    handling: number;
    speed: number;
    stability: number;
  };
  visualIdentity: {
    accentColor: string;
    primaryColor: string;
  };
};

type DraftAction =
  | "checking"
  | "continue"
  | "create"
  | "onboard"
  | "open"
  | "sign-in";

type DraftState = {
  action: DraftAction;
  document: KartAssemblyDocument;
  revision: number | null;
  stats: OfficialKartRosterCard["stats"];
  thumbnailAvailable: boolean;
};

const draftActionLabels = {
  checking: "Checking…",
  continue: "Continue",
  create: "Create",
  onboard: "Complete account",
  open: "Open builder",
  "sign-in": "Sign in",
} as const satisfies Record<DraftAction, string>;

export function OfficialKartRosterAccess({
  officialKarts,
}: {
  officialKarts: OfficialKartRosterCard[];
}) {
  const rosterRef = useRef<HTMLElement | null>(null);
  const router = useRouter();
  const [draftStates, setDraftStates] = useState<Record<string, DraftState>>(
    () =>
      Object.fromEntries(
        officialKarts.map(({ document, kartId }) => [
          kartId,
          {
            action: "checking",
            document,
            revision: null,
            stats: officialKarts.find((kart) => kart.kartId === kartId)!.stats,
            thumbnailAvailable: false,
          },
        ]),
      ),
  );

  useControllerMenuNavigation({
    containerRef: rosterRef,
    enabled: true,
    navigationMode: "spatial",
    onBack: () => router.push("/"),
  });

  useEffect(() => {
    let active = true;
    for (const { kartId } of officialKarts) {
      void (async () => {
        let nextState: DraftState;
        try {
          const response = await fetch(`/api/admin/karts/${kartId}`, {
            cache: "no-store",
            credentials: "include",
            signal: AbortSignal.timeout(3_000),
          });
          if (response.status === 200) {
            const revision = persistedKartRevisionSchema.parse(
              await response.json(),
            );
            nextState = {
              action: "continue",
              document: revision.document,
              revision: revision.revision,
              stats: revision.resolvedSnapshot.playerStats,
              thumbnailAvailable: revision.thumbnailAvailable,
            };
          } else {
            const action =
              response.status === 404
                ? "create"
                : response.status === 428
                  ? "onboard"
                  : response.status === 401 || response.status === 403
                    ? "sign-in"
                    : "open";
            nextState = {
              action,
              document: officialKarts.find(
                (kart) => kart.kartId === kartId,
              )!.document,
              revision: null,
              stats: officialKarts.find(
                (kart) => kart.kartId === kartId,
              )!.stats,
              thumbnailAvailable: false,
            };
          }
        } catch {
          nextState = {
            action: "open",
            document: officialKarts.find((kart) => kart.kartId === kartId)!
              .document,
            revision: null,
            stats: officialKarts.find((kart) => kart.kartId === kartId)!.stats,
            thumbnailAvailable: false,
          };
        }
        if (active) {
          setDraftStates((current) => ({ ...current, [kartId]: nextState }));
        }
      })();
    }
    return () => {
      active = false;
    };
  }, [officialKarts]);

  return (
    <main
      ref={rosterRef}
      className="relative min-h-screen overflow-hidden bg-titan-black px-5 py-6 text-titan-ice sm:px-8 lg:px-12"
    >
      <div className="absolute inset-0 bg-[radial-gradient(circle_at_50%_15%,rgb(52_64_74/0.42),transparent_42%),linear-gradient(145deg,rgb(7_7_6),rgb(20_18_15))]" />
      <div className="relative mx-auto grid w-full max-w-7xl gap-10">
        <header className="flex flex-wrap items-center justify-between gap-6">
          <Link
            aria-label="Back to racing"
            className="focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-titan-hazard"
            href="/"
          >
            <Image
              src="/titan-racers-logo.png"
              alt="Titan Racers"
              width={300}
              height={60}
              priority
              className="h-11 w-auto sm:h-14"
            />
          </Link>
          <Link
            className="titan-button titan-button-secondary"
            href="/"
          >
            Back to racing
          </Link>
        </header>

        <section className="grid gap-4">
          <p className="font-mono text-xs font-bold uppercase tracking-[0.22em] text-titan-hazard">
            Protected tooling
          </p>
          <div className="grid max-w-3xl gap-3">
            <h1 className="text-4xl font-black uppercase tracking-[-0.04em] sm:text-6xl">
              Official Karts
            </h1>
            <p className="max-w-2xl text-sm leading-6 text-titan-ice/70 sm:text-base">
              Select an official kart to create its first validated draft or
              continue editing its current revision.
            </p>
          </div>
        </section>

        <section
          aria-label="Official kart drafts"
          className="grid gap-5 lg:grid-cols-3"
        >
          {officialKarts.map((kart) => {
            const draft = draftStates[kart.kartId] ?? {
              action: "open" as const,
              document: kart.document,
              revision: null,
              stats: kart.stats,
              thumbnailAvailable: false,
            };
            const thumbnailSource =
              draft.thumbnailAvailable && draft.revision
                ? `/api/admin/karts/${kart.kartId}/revisions/${draft.revision}/thumbnail`
                : null;
            return (
              <article
                key={kart.kartId}
                className="grid min-w-0 gap-6 border border-titan-ice/18 bg-titan-black/72 p-5 shadow-[0_24px_70px_rgb(0_0_0/0.38)] backdrop-blur sm:p-6"
              >
                <KartThumbnail
                  document={draft.document}
                  initialized={draft.action === "continue"}
                  source={thumbnailSource}
                />
                <div className="grid gap-4">
                  <div
                    aria-hidden="true"
                    className="h-2 w-full"
                    style={{
                      background: `linear-gradient(90deg, ${draft.document.visualIdentity.primaryColor} 0 72%, ${draft.document.visualIdentity.accentColor} 72% 100%)`,
                    }}
                  />
                  <div className="grid gap-2">
                    <h2 className="text-2xl font-black uppercase tracking-[-0.03em]">
                      {draft.document.name}
                    </h2>
                    <p className="min-h-12 text-sm leading-6 text-titan-ice/68">
                      {draft.document.practicalDescriptor}
                    </p>
                  </div>
                </div>

                <dl className="grid gap-3">
                  {Object.entries(draft.stats).map(([label, value]) => (
                    <div
                      key={label}
                      className="grid grid-cols-[6.5rem_1fr_2rem] items-center gap-3"
                    >
                      <dt className="font-mono text-[0.65rem] font-bold uppercase tracking-[0.13em] text-titan-muted">
                        {label}
                      </dt>
                      <dd className="h-2 overflow-hidden bg-titan-ice/10">
                        <span
                          className="block h-full bg-titan-hazard"
                          style={{ width: `${value}%` }}
                        />
                      </dd>
                      <dd className="text-right font-mono text-xs font-bold text-titan-ice">
                        {value}
                      </dd>
                    </div>
                  ))}
                </dl>

                <Link
                  className="titan-button titan-button-primary mt-auto"
                  data-controller-default={
                    kart.kartId === "balanced-kart" ? "true" : undefined
                  }
                  href={
                    draft.action === "onboard"
                      ? racerOnboardingPath(`/admin/karts/${kart.kartId}`)
                      : `/admin/karts/${kart.kartId}`
                  }
                >
                  {draftActionLabels[draft.action]}
                </Link>
              </article>
            );
          })}
        </section>
      </div>
    </main>
  );
}

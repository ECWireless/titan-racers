"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import { z } from "zod";

import { createBalancedKartDocument } from "@/game/kart/balanced-kart-document";
import {
  type PersistedKartRevision,
  persistedKartRevisionSchema,
} from "@/game/kart/kart-publication";
import {
  createOfficialKartDocument,
  OFFICIAL_KART_IDS,
  type OfficialKartId,
} from "@/game/kart/official-kart-roster";

import { KartEditorShell } from "./kart-editor-shell";

type AccessState =
  | { status: "loading" }
  | { message: string; status: "error" }
  | { status: "unauthenticated" }
  | { status: "forbidden" }
  | { status: "not-found" }
  | { revision: PersistedKartRevision; status: "ready" };

async function resolveAccessState(kartId: string): Promise<AccessState> {
  try {
    const response = await fetch(`/api/admin/karts/${kartId}`, {
      cache: "no-store",
      credentials: "include",
    });
    if (response.status === 401) return { status: "unauthenticated" };
    if (response.status === 403) return { status: "forbidden" };
    if (response.status === 404) return { status: "not-found" };
    if (!response.ok) {
      return {
        message:
          response.status === 503
            ? "Kart editing is not configured in this environment."
            : "The kart revision could not be loaded.",
        status: "error",
      };
    }
    return {
      revision: persistedKartRevisionSchema.parse(await response.json()),
      status: "ready",
    };
  } catch {
    return {
      message: "The kart revision response was unavailable or invalid.",
      status: "error",
    };
  }
}

export function KartEditorAccess({ kartId }: { kartId: string }) {
  const startingDocument = useMemo(() => {
    const officialKartId = OFFICIAL_KART_IDS.find(
      (candidate): candidate is OfficialKartId => candidate === kartId,
    );
    return officialKartId
      ? createOfficialKartDocument(officialKartId)
      : createBalancedKartDocument(kartId);
  }, [kartId]);
  const [accessState, setAccessState] = useState<AccessState>({
    status: "loading",
  });
  const [initializationPending, setInitializationPending] = useState(false);
  const [signInPending, setSignInPending] = useState(false);
  const [signOutPending, setSignOutPending] = useState(false);
  const [signOutError, setSignOutError] = useState<string | null>(null);

  useEffect(() => {
    let active = true;
    void resolveAccessState(kartId).then((nextState) => {
      if (active) setAccessState(nextState);
    });
    return () => {
      active = false;
    };
  }, [kartId]);

  async function loadKart() {
    setAccessState({ status: "loading" });
    setAccessState(await resolveAccessState(kartId));
  }

  async function signInWithGoogle({
    replaceCurrentSession = false,
  }: { replaceCurrentSession?: boolean } = {}) {
    setSignInPending(true);
    try {
      if (replaceCurrentSession) {
        const signOutResponse = await fetch("/api/auth/sign-out", {
          body: JSON.stringify({}),
          credentials: "include",
          headers: { "content-type": "application/json" },
          method: "POST",
        });
        if (!signOutResponse.ok) {
          throw new Error("The current account could not be signed out.");
        }
      }
      const response = await fetch("/api/auth/sign-in/social", {
        body: JSON.stringify({
          callbackURL: `/admin/karts/${kartId}`,
          provider: "google",
        }),
        credentials: "include",
        headers: { "content-type": "application/json" },
        method: "POST",
      });
      if (!response.ok) throw new Error("Google sign-in could not be started.");
      const payload = z
        .object({ url: z.string().url() })
        .parse(await response.json());
      window.location.assign(payload.url);
    } catch {
      setAccessState({
        message: "Google sign-in could not be started.",
        status: "error",
      });
      setSignInPending(false);
    }
  }

  async function initializeKart() {
    setInitializationPending(true);
    try {
      const response = await fetch(`/api/admin/karts/${kartId}`, {
        body: JSON.stringify({
          document: startingDocument,
          expectedRevision: null,
        }),
        credentials: "include",
        headers: { "content-type": "application/json" },
        method: "PUT",
      });
      if (response.status === 409) {
        setAccessState(await resolveAccessState(kartId));
        return;
      }
      if (!response.ok) throw new Error("The kart could not be initialized.");
      setAccessState({
        revision: persistedKartRevisionSchema.parse(await response.json()),
        status: "ready",
      });
    } catch {
      setAccessState({
        message: `The ${startingDocument.name} starting draft could not be initialized.`,
        status: "error",
      });
    } finally {
      setInitializationPending(false);
    }
  }

  async function signOut() {
    setSignOutError(null);
    setSignOutPending(true);
    try {
      const response = await fetch("/api/auth/sign-out", {
        body: JSON.stringify({}),
        credentials: "include",
        headers: { "content-type": "application/json" },
        method: "POST",
      });
      if (!response.ok) throw new Error("Sign out failed.");
      setAccessState({ status: "unauthenticated" });
    } catch {
      setSignOutError("Sign out failed. Local changes are intact; please retry.");
    } finally {
      setSignOutPending(false);
    }
  }

  if (accessState.status === "ready") {
    return (
      <KartEditorShell
        key={accessState.revision.kartId}
        revision={accessState.revision}
        signOutError={signOutError}
        signOutPending={signOutPending}
        onSignOut={() => void signOut()}
      />
    );
  }

  return (
    <main className="relative grid min-h-screen place-items-center overflow-hidden bg-titan-black px-5 py-10 text-titan-ice">
      <div className="absolute inset-0 bg-[radial-gradient(circle_at_50%_20%,rgb(52_64_74/0.42),transparent_45%),linear-gradient(145deg,rgb(7_7_6),rgb(20_18_15))]" />
      <section className="relative grid w-full max-w-lg gap-6 border border-titan-ice/20 bg-titan-black/88 p-6 shadow-[0_28px_100px_rgb(0_0_0/0.62)] sm:p-9">
        <div className="grid gap-3">
          <p className="font-mono text-xs font-bold uppercase tracking-[0.22em] text-titan-hazard">
            Protected tooling
          </p>
          <h1 className="text-3xl font-black uppercase tracking-[-0.04em] sm:text-4xl">
            Kart Builder
          </h1>
        </div>
        <AccessMessage accessState={accessState} />
        <div className="grid gap-3 sm:grid-cols-2">
          {accessState.status === "unauthenticated" ? (
            <button
              className="titan-button titan-button-primary"
              disabled={signInPending}
              type="button"
              onClick={() => void signInWithGoogle()}
            >
              {signInPending ? "Connecting…" : "Continue with Google"}
            </button>
          ) : accessState.status === "not-found" ? (
            <button
              className="titan-button titan-button-primary"
              disabled={initializationPending}
              type="button"
              onClick={() => void initializeKart()}
            >
              {initializationPending
                ? "Initializing…"
                : `Create ${startingDocument.name} draft`}
            </button>
          ) : accessState.status === "forbidden" ? (
            <button
              className="titan-button titan-button-primary"
              disabled={signInPending}
              type="button"
              onClick={() =>
                void signInWithGoogle({ replaceCurrentSession: true })
              }
            >
              {signInPending
                ? "Choosing account…"
                : "Choose another Google account"}
            </button>
          ) : accessState.status === "error" ? (
            <button
              className="titan-button titan-button-primary"
              type="button"
              onClick={() => void loadKart()}
            >
              Retry
            </button>
          ) : null}
          <Link className="titan-button titan-button-secondary" href="/">
            Back to racing
          </Link>
        </div>
      </section>
    </main>
  );
}

function AccessMessage({ accessState }: { accessState: AccessState }) {
  if (accessState.status === "loading") {
    return (
      <p
        className="border border-titan-ice/15 bg-titan-ice/[0.04] px-4 py-3 font-mono text-xs font-bold uppercase tracking-[0.14em] text-titan-muted"
        role="status"
      >
        Checking kart-builder access…
      </p>
    );
  }
  if (accessState.status === "unauthenticated") {
    return (
      <p className="border border-titan-hazard/35 bg-titan-hazard/[0.06] px-4 py-3 text-sm text-titan-ice/78">
        Sign in with an approved admin account to continue.
      </p>
    );
  }
  if (accessState.status === "forbidden") {
    return (
      <p
        className="border border-titan-rust/55 bg-titan-rust/10 px-4 py-3 text-sm text-titan-ice/78"
        role="alert"
      >
        This account does not have kart-builder access. Choose another Google
        account to continue.
      </p>
    );
  }
  if (accessState.status === "not-found") {
    return (
      <p className="border border-titan-hazard/35 bg-titan-hazard/[0.06] px-4 py-3 text-sm text-titan-ice/78">
        No draft exists for this kart ID. Create its validated starting
        assembly to begin authoring.
      </p>
    );
  }
  if (accessState.status === "error") {
    return (
      <p
        className="border border-titan-rust/55 bg-titan-rust/10 px-4 py-3 text-sm text-titan-ice/78"
        role="alert"
      >
        {accessState.message}
      </p>
    );
  }
  return null;
}

"use client";

import Link from "next/link";
import { useState } from "react";
import { z } from "zod";

import type { GameplayDashboardRange } from "@/game/telemetry/gameplay-dashboard";
import {
  CourseEditorIcon,
  DashboardIcon,
  KartBuilderIcon,
  RaceFlagIcon,
  SignOutIcon,
  TelemetryIcon,
} from "@/components/menu-icons";
import { racerOnboardingPath } from "@/lib/racer-username";

const REPORTING_RANGES: Array<{ label: string; value: GameplayDashboardRange }> = [
  { label: "7 days", value: "7d" },
  { label: "30 days", value: "30d" },
  { label: "All time", value: "all" },
];

/** Where loading a protected admin page's data stands. */
export type AdminAccessState<T> =
  | { status: "loading" }
  | { message: string; status: "error" }
  | { status: "unauthenticated" }
  | { status: "onboarding-required" }
  | { status: "forbidden" }
  | { data: T; status: "ready" };

export async function loadAdminData<T>(
  url: string,
  schema: z.ZodType<T>,
): Promise<AdminAccessState<T>> {
  try {
    const response = await fetch(url, {
      cache: "no-store",
      credentials: "include",
    });
    if (response.status === 401) return { status: "unauthenticated" };
    if (response.status === 428) return { status: "onboarding-required" };
    if (response.status === 403) return { status: "forbidden" };
    if (!response.ok) {
      return {
        message:
          response.status === 503
            ? "Admin tools are not configured in this environment."
            : "This page's data could not be loaded.",
        status: "error",
      };
    }
    return { data: schema.parse(await response.json()), status: "ready" };
  } catch {
    return {
      message: "The response was unavailable or invalid.",
      status: "error",
    };
  }
}

/** The admin's browser time zone, or UTC when the browser has none. */
export function browserTimeZone() {
  const zone = Intl.DateTimeFormat().resolvedOptions().timeZone;
  return zone && zone !== "Etc/Unknown" ? zone : "UTC";
}

async function signOutRequest() {
  const response = await fetch("/api/auth/sign-out", {
    body: JSON.stringify({}),
    credentials: "include",
    headers: { "content-type": "application/json" },
    method: "POST",
  });
  if (!response.ok) throw new Error("Sign out failed.");
}

/**
 * Google sign-in and sign-out for a protected admin page; signing in returns
 * to `returnPath`.
 */
export function useAdminSession<T>(
  returnPath: string,
  setAccessState: (state: AdminAccessState<T>) => void,
) {
  const [signInPending, setSignInPending] = useState(false);
  const [signOutPending, setSignOutPending] = useState(false);

  async function signIn({
    replaceCurrentSession = false,
  }: { replaceCurrentSession?: boolean } = {}) {
    setSignInPending(true);
    try {
      if (replaceCurrentSession) await signOutRequest();
      const response = await fetch("/api/auth/sign-in/social", {
        body: JSON.stringify({
          callbackURL: returnPath,
          newUserCallbackURL: racerOnboardingPath(returnPath),
          provider: "google",
        }),
        credentials: "include",
        headers: { "content-type": "application/json" },
        method: "POST",
      });
      if (!response.ok) throw new Error("Google sign-in could not be started.");
      const payload = z.object({ url: z.string().url() }).parse(await response.json());
      window.location.assign(payload.url);
    } catch {
      setAccessState({
        message: "Google sign-in could not be started.",
        status: "error",
      });
      setSignInPending(false);
    }
  }

  async function signOut() {
    setSignOutPending(true);
    try {
      await signOutRequest();
      setAccessState({ status: "unauthenticated" });
    } catch {
      setAccessState({ message: "Sign out failed. Please retry.", status: "error" });
    } finally {
      setSignOutPending(false);
    }
  }

  return { signIn, signInPending, signOut, signOutPending };
}

export function ProtectedAdminAccess({
  accessState,
  returnPath,
  signInPending,
  title,
  onRetry,
  onSignIn,
}: {
  accessState: Exclude<AdminAccessState<unknown>, { status: "ready" }>;
  returnPath: string;
  signInPending: boolean;
  title: string;
  onRetry: () => void;
  onSignIn: (options?: { replaceCurrentSession?: boolean }) => Promise<void>;
}) {
  const message =
    accessState.status === "loading"
      ? "Checking admin access..."
      : accessState.status === "unauthenticated"
        ? "Sign in with an approved admin account to continue."
        : accessState.status === "onboarding-required"
          ? "Choose your permanent racer username before opening protected tools."
          : accessState.status === "forbidden"
            ? "This account does not have admin access."
            : accessState.message;

  return (
    <main className="relative grid min-h-screen place-items-center overflow-hidden bg-titan-black px-5 py-10 text-titan-ice">
      <div className="absolute inset-0 bg-[radial-gradient(circle_at_50%_20%,rgb(52_64_74/0.42),transparent_45%),linear-gradient(145deg,rgb(7_7_6),rgb(20_18_15))]" />
      <section className="relative grid w-full max-w-lg gap-6 border border-titan-ice/20 bg-titan-black/88 p-6 shadow-[0_28px_100px_rgb(0_0_0/0.62)] sm:p-9">
        <div className="grid gap-3">
          <p className="font-mono text-xs font-bold uppercase tracking-[0.22em] text-titan-hazard">
            Protected tooling
          </p>
          <h1 className="text-3xl font-black uppercase tracking-[-0.04em] sm:text-4xl">
            {title}
          </h1>
        </div>
        <p
          className="border border-titan-ice/15 bg-titan-ice/[0.04] px-4 py-3 text-sm text-titan-ice/78"
          role={accessState.status === "error" ? "alert" : "status"}
        >
          {message}
        </p>
        <div className="grid gap-3 sm:grid-cols-2">
          {accessState.status === "unauthenticated" ? (
            <button
              className="titan-button titan-button-primary"
              disabled={signInPending}
              type="button"
              onClick={() => void onSignIn()}
            >
              {signInPending ? "Connecting..." : "Continue with Google"}
            </button>
          ) : accessState.status === "onboarding-required" ? (
            <Link
              className="titan-button titan-button-primary"
              href={racerOnboardingPath(returnPath)}
            >
              Complete account
            </Link>
          ) : accessState.status === "forbidden" ? (
            <button
              className="titan-button titan-button-primary"
              disabled={signInPending}
              type="button"
              onClick={() => void onSignIn({ replaceCurrentSession: true })}
            >
              {signInPending ? "Choosing account..." : "Choose another account"}
            </button>
          ) : accessState.status === "error" ? (
            <button
              className="titan-button titan-button-primary"
              type="button"
              onClick={onRetry}
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

/** The 7-day, 30-day, and all-time choice both admin dashboards share. */
export function ReportingPeriod({
  value,
  onChange,
}: {
  value: GameplayDashboardRange;
  onChange: (value: GameplayDashboardRange) => void;
}) {
  return (
    <section aria-label="Reporting period" className="flex flex-wrap gap-2">
      {REPORTING_RANGES.map((option) => (
        <button
          aria-pressed={value === option.value}
          className={`min-h-10 border px-4 font-mono text-xs font-bold uppercase tracking-[0.12em] transition ${
            value === option.value
              ? "border-titan-hazard bg-titan-hazard/10 text-titan-hazard"
              : "border-titan-ice/20 text-titan-ice/64 hover:border-titan-ice/50 hover:text-titan-ice"
          }`}
          key={option.value}
          type="button"
          onClick={() => onChange(option.value)}
        >
          {option.label}
        </button>
      ))}
    </section>
  );
}

export function MetricRows({ rows }: { rows: Array<[string, number]> }) {
  return (
    <dl className="grid gap-3">
      {rows.map(([label, value]) => (
        <div className="flex items-center justify-between gap-4 border-b border-titan-ice/10 pb-2" key={label}>
          <dt className="text-sm text-titan-ice/65">{label}</dt>
          <dd className="font-mono font-bold tabular-nums">{value.toLocaleString()}</dd>
        </div>
      ))}
    </dl>
  );
}

const ADMIN_LINKS = [
  ["Racing", "/", <RaceFlagIcon key="racing" />],
  ["Dashboard", "/admin", <DashboardIcon key="dashboard" />],
  ["Telemetry", "/admin/telemetry", <TelemetryIcon key="telemetry" />],
  ["Course editor", "/admin/courses", <CourseEditorIcon key="courses" />],
  ["Kart editor", "/admin/karts", <KartBuilderIcon key="karts" />],
] as const;

const ICON_BUTTON =
  "group relative grid size-10 place-items-center border transition focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-titan-hazard";

/** A label under an icon button on hover or keyboard focus. */
function IconLabel({ children }: { children: string }) {
  return (
    <span
      aria-hidden="true"
      className="pointer-events-none absolute top-full left-1/2 z-10 mt-1.5 hidden -translate-x-1/2 whitespace-nowrap border border-titan-ice/20 bg-titan-panel px-2 py-1 font-mono text-[0.65rem] uppercase tracking-[0.12em] text-titan-ice group-hover:block group-focus-visible:block"
    >
      {children}
    </span>
  );
}

/** The admin pages' compact icon navigation, marking the page you're on. */
export function AdminNav({
  current,
  signOutPending,
  onSignOut,
}: {
  current: string;
  signOutPending: boolean;
  onSignOut: () => void;
}) {
  return (
    <nav aria-label="Admin navigation" className="flex flex-wrap items-center gap-1.5">
      {ADMIN_LINKS.map(([label, href, icon]) => (
        <Link
          aria-current={href === current ? "page" : undefined}
          aria-label={label}
          className={`${ICON_BUTTON} ${
            href === current
              ? "border-titan-hazard bg-titan-hazard/10 text-titan-hazard"
              : "border-titan-ice/20 text-titan-ice/70 hover:border-titan-ice/50 hover:text-titan-ice"
          }`}
          href={href}
          key={href}
        >
          {icon}
          <IconLabel>{label}</IconLabel>
        </Link>
      ))}
      <span aria-hidden="true" className="mx-1 h-6 w-px bg-titan-ice/15" />
      <button
        aria-label={signOutPending ? "Signing out" : "Sign out"}
        className={`${ICON_BUTTON} border-titan-ice/20 text-titan-ice/70 hover:border-titan-ice/50 hover:text-titan-ice disabled:opacity-50`}
        disabled={signOutPending}
        type="button"
        onClick={onSignOut}
      >
        <SignOutIcon />
        <IconLabel>{signOutPending ? "Signing out" : "Sign out"}</IconLabel>
      </button>
    </nav>
  );
}

"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { z } from "zod";

import {
  gameplayDashboardSchema,
  type GameplayDashboard,
  type GameplayDashboardRange,
} from "@/game/telemetry/gameplay-dashboard";

type AccessState =
  | { status: "loading" }
  | { message: string; status: "error" }
  | { status: "unauthenticated" }
  | { status: "forbidden" }
  | { dashboard: GameplayDashboard; status: "ready" };

const ranges: Array<{ label: string; value: GameplayDashboardRange }> = [
  { label: "7 days", value: "7d" },
  { label: "30 days", value: "30d" },
  { label: "All time", value: "all" },
];

async function resolveAccessState(
  range: GameplayDashboardRange,
): Promise<AccessState> {
  try {
    const response = await fetch(`/api/admin/telemetry?range=${range}`, {
      cache: "no-store",
      credentials: "include",
    });

    if (response.status === 401) {
      return { status: "unauthenticated" };
    }
    if (response.status === 403) {
      return { status: "forbidden" };
    }
    if (!response.ok) {
      return {
        message:
          response.status === 503
            ? "Telemetry administration is not configured in this environment."
            : "Gameplay telemetry could not be loaded.",
        status: "error",
      };
    }

    return {
      dashboard: gameplayDashboardSchema.parse(await response.json()),
      status: "ready",
    };
  } catch {
    return {
      message: "The telemetry response was unavailable or invalid.",
      status: "error",
    };
  }
}

export function TelemetryDashboardAccess() {
  const [range, setRange] = useState<GameplayDashboardRange>("7d");
  const [accessState, setAccessState] = useState<AccessState>({
    status: "loading",
  });
  const [signInPending, setSignInPending] = useState(false);
  const [signOutPending, setSignOutPending] = useState(false);

  useEffect(() => {
    let active = true;
    void resolveAccessState(range).then((nextState) => {
      if (active) {
        setAccessState(nextState);
      }
    });

    return () => {
      active = false;
    };
  }, [range]);

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
          callbackURL: "/admin/telemetry",
          provider: "google",
        }),
        credentials: "include",
        headers: { "content-type": "application/json" },
        method: "POST",
      });
      if (!response.ok) {
        throw new Error("Google sign-in could not be started.");
      }

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
      const response = await fetch("/api/auth/sign-out", {
        body: JSON.stringify({}),
        credentials: "include",
        headers: { "content-type": "application/json" },
        method: "POST",
      });
      if (!response.ok) {
        throw new Error("Sign out failed.");
      }
      setAccessState({ status: "unauthenticated" });
    } catch {
      setAccessState({ message: "Sign out failed. Please retry.", status: "error" });
    } finally {
      setSignOutPending(false);
    }
  }

  if (accessState.status !== "ready") {
    return (
      <ProtectedTelemetryAccess
        accessState={accessState}
        signInPending={signInPending}
        onRetry={() => {
          setAccessState({ status: "loading" });
          void resolveAccessState(range).then(setAccessState);
        }}
        onSignIn={signInWithGoogle}
      />
    );
  }

  return (
    <TelemetryDashboard
      dashboard={accessState.dashboard}
      range={range}
      signOutPending={signOutPending}
      onRangeChange={setRange}
      onSignOut={() => void signOut()}
    />
  );
}

function ProtectedTelemetryAccess({
  accessState,
  signInPending,
  onRetry,
  onSignIn,
}: {
  accessState: Exclude<AccessState, { status: "ready" }>;
  signInPending: boolean;
  onRetry: () => void;
  onSignIn: (options?: { replaceCurrentSession?: boolean }) => Promise<void>;
}) {
  const message =
    accessState.status === "loading"
      ? "Checking telemetry access..."
      : accessState.status === "unauthenticated"
        ? "Sign in with an approved admin account to continue."
        : accessState.status === "forbidden"
          ? "This account does not have telemetry access."
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
            Gameplay Telemetry
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

function formatDuration(milliseconds: number | null) {
  if (milliseconds === null) {
    return "—";
  }
  if (milliseconds < 10_000) {
    return `${(milliseconds / 1_000).toFixed(1)}s`;
  }
  const minutes = Math.floor(milliseconds / 60_000);
  const seconds = Math.round((milliseconds % 60_000) / 1_000);
  return minutes > 0 ? `${minutes}m ${seconds}s` : `${seconds}s`;
}

function TelemetryDashboard({
  dashboard,
  range,
  signOutPending,
  onRangeChange,
  onSignOut,
}: {
  dashboard: GameplayDashboard;
  range: GameplayDashboardRange;
  signOutPending: boolean;
  onRangeChange: (range: GameplayDashboardRange) => void;
  onSignOut: () => void;
}) {
  const summaryCards = [
    ["Attempts", dashboard.summary.attempts.toLocaleString()],
    ["Completion rate", `${Math.round(dashboard.summary.completionRate * 100)}%`],
    ["Median load", formatDuration(dashboard.summary.medianLoadTimeMs)],
    ["Median race", formatDuration(dashboard.summary.medianCompletedRaceTimeMs)],
  ];
  const maximumDailyAttempts = Math.max(
    1,
    ...dashboard.daily.map(({ attempts }) => attempts),
  );

  return (
    <main className="min-h-screen bg-titan-black px-4 py-5 text-titan-ice sm:px-7 lg:px-10">
      <div className="mx-auto grid w-full max-w-7xl gap-7">
        <header className="flex flex-col gap-5 border-b border-titan-ice/15 pb-6 sm:flex-row sm:items-end sm:justify-between">
          <div className="grid gap-2">
            <p className="font-mono text-xs font-bold uppercase tracking-[0.22em] text-titan-hazard">
              Admin operations
            </p>
            <h1 className="text-3xl font-black uppercase tracking-[-0.04em] sm:text-5xl">
              Gameplay Telemetry
            </h1>
            <p className="max-w-2xl text-sm text-titan-ice/62">
              Anonymous run-level summaries. No raw controls, kart paths, IP
              addresses, user agents, or persistent guest identities.
            </p>
          </div>
          <nav aria-label="Admin navigation" className="flex flex-wrap gap-2">
            <Link className="titan-button titan-button-secondary px-4" href="/">
              Racing
            </Link>
            <Link className="titan-button titan-button-secondary px-4" href="/editor">
              Course editor
            </Link>
            <button
              className="titan-button titan-button-secondary px-4"
              disabled={signOutPending}
              type="button"
              onClick={onSignOut}
            >
              {signOutPending ? "Signing out..." : "Sign out"}
            </button>
          </nav>
        </header>

        <section aria-label="Reporting period" className="flex flex-wrap gap-2">
          {ranges.map((option) => (
            <button
              aria-pressed={range === option.value}
              className={`min-h-10 border px-4 font-mono text-xs font-bold uppercase tracking-[0.12em] transition ${
                range === option.value
                  ? "border-titan-hazard bg-titan-hazard/10 text-titan-hazard"
                  : "border-titan-ice/20 text-titan-ice/64 hover:border-titan-ice/50 hover:text-titan-ice"
              }`}
              key={option.value}
              type="button"
              onClick={() => onRangeChange(option.value)}
            >
              {option.label}
            </button>
          ))}
        </section>

        <section aria-label="Run summary" className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          {summaryCards.map(([label, value]) => (
            <article className="grid gap-2 border border-titan-ice/15 bg-titan-ice/[0.035] p-4" key={label}>
              <p className="font-mono text-[0.66rem] font-bold uppercase tracking-[0.14em] text-titan-muted">
                {label}
              </p>
              <p className="text-2xl font-black tabular-nums">{value}</p>
            </article>
          ))}
        </section>

        {dashboard.summary.attempts === 0 ? (
          <section className="border border-dashed border-titan-ice/25 px-6 py-14 text-center">
            <h2 className="text-xl font-black uppercase">No gameplay runs yet</h2>
            <p className="mt-2 text-sm text-titan-ice/60">
              Attempts in this reporting period will appear after telemetry is received.
            </p>
          </section>
        ) : (
          <div className="grid gap-6 lg:grid-cols-[1.35fr_1fr]">
            <section className="grid gap-5 border border-titan-ice/15 p-5 sm:p-6 lg:col-span-2" aria-labelledby="funnel-title">
              <div>
                <h2 className="text-lg font-black uppercase" id="funnel-title">Run funnel</h2>
                <p className="mt-1 text-xs text-titan-muted">Each percentage is conversion from the stage immediately before it.</p>
              </div>
              <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
                <FunnelStage label="Attempted" value={dashboard.funnel.attempts.count} />
                <FunnelStage label="Loaded" value={dashboard.funnel.loaded.count} conversionRate={dashboard.funnel.loaded.conversionRate} />
                <FunnelStage label="Racing" value={dashboard.funnel.racing.count} conversionRate={dashboard.funnel.racing.conversionRate} />
                <FunnelStage label="Finished" value={dashboard.funnel.completed.count} conversionRate={dashboard.funnel.completed.conversionRate} />
              </div>
            </section>

            <section className="border border-titan-ice/15 p-5 sm:p-6" aria-labelledby="daily-runs-title">
              <div className="mb-5 flex items-center justify-between gap-4">
                <h2 className="text-lg font-black uppercase" id="daily-runs-title">Daily runs</h2>
                <span className="font-mono text-[0.65rem] uppercase tracking-[0.12em] text-titan-muted">Attempts / finishes</span>
              </div>
              <div className="grid gap-3">
                {dashboard.daily.map((day) => (
                  <div className="grid grid-cols-[6.5rem_1fr_auto] items-center gap-3" key={day.date}>
                    <time className="font-mono text-xs text-titan-ice/64" dateTime={day.date}>{day.date}</time>
                    <div className="h-3 bg-titan-ice/10" aria-hidden="true">
                      <div className="h-full bg-titan-hazard" style={{ width: `${(day.attempts / maximumDailyAttempts) * 100}%` }} />
                    </div>
                    <span className="min-w-14 text-right font-mono text-xs tabular-nums">{day.attempts} / {day.completed}</span>
                  </div>
                ))}
              </div>
            </section>

            <section className="grid gap-4 border border-titan-ice/15 p-5 sm:p-6" aria-labelledby="outcomes-title">
              <h2 className="text-lg font-black uppercase" id="outcomes-title">Outcomes</h2>
              <MetricRows rows={[
                ["Completed", dashboard.outcomes.completed],
                ["Exited", dashboard.outcomes.exited],
                ["Load failed", dashboard.outcomes.loadFailed],
                ["Runtime failed", dashboard.outcomes.runtimeFailed],
                ["Active", dashboard.outcomes.active],
                ["Unfinished (30m+)", dashboard.outcomes.unfinished],
              ]} />
            </section>

            <section className="grid gap-5 border border-titan-ice/15 p-5 sm:p-6" aria-labelledby="inputs-title">
              <h2 className="text-lg font-black uppercase" id="inputs-title">Controls used</h2>
              <MetricRows rows={[
                ["Keyboard", dashboard.inputFamilies.keyboard],
                ["Touch", dashboard.inputFamilies.touch],
                ["Controller", dashboard.inputFamilies.gamepad],
              ]} />
              <p className="text-xs leading-relaxed text-titan-muted">A run can include more than one input family after switching controls.</p>
            </section>

            <section className="grid gap-5 border border-titan-ice/15 p-5 sm:p-6" aria-labelledby="recoveries-title">
              <h2 className="text-lg font-black uppercase" id="recoveries-title">Recoveries after race start</h2>
              <MetricRows rows={[
                ["No recoveries", dashboard.recoveries.zero],
                ["One recovery", dashboard.recoveries.one],
                ["Multiple recoveries", dashboard.recoveries.multiple],
              ]} />
              <p className="text-xs leading-relaxed text-titan-muted">Terminal racing runs only ({dashboard.recoveries.sampleSize.toLocaleString()} runs).</p>
            </section>
          </div>
        )}

        <section className="grid gap-4 border border-titan-ice/15 p-5 sm:p-6" aria-labelledby="failures-title">
          <div>
            <h2 className="text-lg font-black uppercase" id="failures-title">Grouped failures</h2>
            <p className="mt-1 text-xs text-titan-muted">Counts by allowlisted category, stage, and deployment; raw errors and stack traces are never collected.</p>
          </div>
          {dashboard.failureGroups.length === 0 ? (
            <p className="border border-dashed border-titan-ice/20 px-4 py-8 text-center text-sm text-titan-ice/58">No failures in this reporting period.</p>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full min-w-[38rem] border-collapse text-left text-sm">
                <thead className="font-mono text-[0.65rem] uppercase tracking-[0.12em] text-titan-muted">
                  <tr className="border-b border-titan-ice/15">
                    <th className="px-3 py-3">Count</th>
                    <th className="px-3 py-3">Failure</th>
                    <th className="px-3 py-3">Stage</th>
                    <th className="px-3 py-3">Deployment</th>
                    <th className="px-3 py-3">Last seen</th>
                  </tr>
                </thead>
                <tbody>
                  {dashboard.failureGroups.map((failure) => (
                    <tr className="border-b border-titan-ice/10" key={`${failure.stage}-${failure.failureCode}-${failure.deploymentVersion}`}>
                      <td className="px-3 py-3 font-mono text-xs font-bold tabular-nums">{failure.count.toLocaleString()}</td>
                      <td className="px-3 py-3 font-mono text-xs text-titan-rust">{failure.failureCode}</td>
                      <td className="px-3 py-3 capitalize">{failure.stage}</td>
                      <td className="px-3 py-3 font-mono text-xs">{failure.deploymentVersion.slice(0, 10)}</td>
                      <td className="px-3 py-3 font-mono text-xs"><time dateTime={failure.lastOccurredAt}>{new Date(failure.lastOccurredAt).toLocaleString()}</time></td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </section>

        <footer className="flex flex-wrap justify-between gap-3 border-t border-titan-ice/10 py-5 font-mono text-[0.65rem] uppercase tracking-[0.1em] text-titan-muted">
          <span>Anonymous runs: {dashboard.attribution.anonymous}</span>
          <span>Authenticated runs: {dashboard.attribution.authenticated}</span>
        </footer>
      </div>
    </main>
  );
}

function FunnelStage({
  conversionRate,
  label,
  value,
}: {
  conversionRate?: number;
  label: string;
  value: number;
}) {
  return (
    <article className="grid gap-1 border-l-2 border-titan-hazard bg-titan-ice/[0.035] px-4 py-3">
      <p className="font-mono text-[0.66rem] font-bold uppercase tracking-[0.14em] text-titan-muted">{label}</p>
      <p className="text-2xl font-black tabular-nums">{value.toLocaleString()}</p>
      <p className="text-xs text-titan-ice/58">
        {conversionRate === undefined
          ? "Baseline"
          : `${Math.round(conversionRate * 100)}% from prior stage`}
      </p>
    </article>
  );
}

function MetricRows({ rows }: { rows: Array<[string, number]> }) {
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

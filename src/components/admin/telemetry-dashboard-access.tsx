"use client";

import { useEffect, useState } from "react";

import {
  AdminNav,
  type AdminAccessState,
  browserTimeZone,
  loadAdminData,
  MetricRows,
  ProtectedAdminAccess,
  ReportingPeriod,
  useAdminSession,
} from "@/components/admin/admin-access";
import {
  gameplayDashboardSchema,
  type GameplayDashboard,
  type GameplayDashboardRange,
} from "@/game/telemetry/gameplay-dashboard";

const RETURN_PATH = "/admin/telemetry";

const loadTelemetry = (range: GameplayDashboardRange) =>
  loadAdminData(
    `/api/admin/telemetry?range=${range}&tz=${encodeURIComponent(browserTimeZone())}`,
    gameplayDashboardSchema,
  );

export function TelemetryDashboardAccess() {
  const [range, setRange] = useState<GameplayDashboardRange>("7d");
  const [accessState, setAccessState] = useState<AdminAccessState<GameplayDashboard>>({
    status: "loading",
  });
  const session = useAdminSession(RETURN_PATH, setAccessState);

  useEffect(() => {
    let active = true;
    void loadTelemetry(range).then((nextState) => {
      if (active) setAccessState(nextState);
    });
    return () => {
      active = false;
    };
  }, [range]);

  if (accessState.status !== "ready") {
    return (
      <ProtectedAdminAccess
        accessState={accessState}
        returnPath={RETURN_PATH}
        signInPending={session.signInPending}
        title="Gameplay Telemetry"
        onRetry={() => {
          setAccessState({ status: "loading" });
          void loadTelemetry(range).then(setAccessState);
        }}
        onSignIn={session.signIn}
      />
    );
  }

  return (
    <TelemetryDashboard
      dashboard={accessState.data}
      range={range}
      signOutPending={session.signOutPending}
      onRangeChange={setRange}
      onSignOut={() => void session.signOut()}
    />
  );
}

function formatDuration(milliseconds: number | null) {
  if (milliseconds === null) {
    return "—";
  }
  if (milliseconds < 10_000) {
    return `${(milliseconds / 1_000).toFixed(1)}s`;
  }
  const totalSeconds = Math.round(milliseconds / 1_000);
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
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

  return (
    <main className="min-h-screen bg-titan-black px-4 py-5 text-titan-ice sm:px-7 lg:px-10">
      <div className="mx-auto grid w-full max-w-7xl gap-7">
        <header className="flex flex-col gap-5 border-b border-titan-ice/15 pb-6 sm:flex-row sm:items-start sm:justify-between">
          <div className="grid gap-2">
            <p className="font-mono text-xs font-bold uppercase tracking-[0.22em] text-titan-hazard">
              Admin operations
            </p>
            <h1 className="text-3xl font-black uppercase tracking-[-0.04em] sm:text-5xl">
              Gameplay Telemetry
            </h1>
            <p className="max-w-2xl text-sm text-titan-ice/62">
              Anonymous run-level summaries for the current solo time trial
              course. No raw controls, kart paths, IP addresses, user agents,
              or persistent guest identities.
            </p>
          </div>
          <AdminNav current="/admin/telemetry" signOutPending={signOutPending} onSignOut={onSignOut} />
        </header>

        <ReportingPeriod value={range} onChange={onRangeChange} />

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
          <div className="grid gap-6 lg:grid-cols-2">
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

            <section className="grid gap-5 border border-titan-ice/15 p-5 sm:p-6" aria-labelledby="runtime-health-title">
              <h2 className="text-lg font-black uppercase" id="runtime-health-title">Runtime health</h2>
              <MetricRows rows={[
                ["Runs safety-paused", dashboard.runtimeHealth.runsWithAutomaticPauses],
                ["Runs with discarded time", dashboard.runtimeHealth.runsWithDiscardedTime],
              ]} />
              <p className="text-xs leading-relaxed text-titan-muted">
                Median discarded time among affected runs: {dashboard.runtimeHealth.medianDiscardedTimeMs === null ? "—" : formatDuration(dashboard.runtimeHealth.medianDiscardedTimeMs)}.
              </p>
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

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
  type AdminOverview,
  adminOverviewSchema,
} from "@/game/telemetry/admin-overview";
import type { GameplayDashboardRange } from "@/game/telemetry/gameplay-dashboard";

const RETURN_PATH = "/admin";

// One hue in two steps per chart, checked against the page's near-black.
const FINISHED = "#ffbd59";
const NOT_FINISHED = "#8a6a3a";
const SIGNED_IN = "#42a5ff";
const GUEST = "#2f6798";

const loadOverview = (range: GameplayDashboardRange) =>
  loadAdminData(
    `/api/admin/overview?range=${range}&tz=${encodeURIComponent(browserTimeZone())}`,
    adminOverviewSchema,
  );

export function AdminOverviewAccess() {
  const [range, setRange] = useState<GameplayDashboardRange>("7d");
  const [accessState, setAccessState] = useState<AdminAccessState<AdminOverview>>({
    status: "loading",
  });
  const session = useAdminSession(RETURN_PATH, setAccessState);
  const { signedOut } = session;

  useEffect(() => {
    let active = true;
    void loadOverview(range).then((nextState) => {
      if (active && !signedOut.current) setAccessState(nextState);
    });
    return () => {
      active = false;
    };
  }, [range, signedOut]);

  if (accessState.status !== "ready") {
    return (
      <ProtectedAdminAccess
        accessState={accessState}
        returnPath={RETURN_PATH}
        signInPending={session.signInPending}
        title="Dashboard"
        onRetry={() => {
          setAccessState({ status: "loading" });
          void loadOverview(range).then(setAccessState);
        }}
        onSignIn={session.signIn}
      />
    );
  }

  return (
    <Overview
      overview={accessState.data}
      range={range}
      signOutPending={session.signOutPending}
      onRangeChange={setRange}
      onSignOut={() => void session.signOut()}
    />
  );
}

function share(part: number, whole: number) {
  return whole === 0 ? "—" : `${Math.round((part / whole) * 100)}%`;
}

// Bucket dates are calendar dates, so they are read and shown as UTC.
function formatDay(date: string, style: "short" | "long" = "short") {
  return new Intl.DateTimeFormat("en-US", {
    day: "numeric",
    month: "short",
    timeZone: "UTC",
    ...(style === "long" ? { weekday: "short" } : {}),
  }).format(new Date(`${date}T00:00:00Z`));
}

function Overview({
  overview,
  range,
  signOutPending,
  onRangeChange,
  onSignOut,
}: {
  overview: AdminOverview;
  range: GameplayDashboardRange;
  signOutPending: boolean;
  onRangeChange: (range: GameplayDashboardRange) => void;
  onSignOut: () => void;
}) {
  const { races, racers, leaderboard } = overview;
  const signUps =
    racers.signUps.browser + racers.signUps.google + racers.signUps.wallet;
  const period = overview.bucket === "week" ? "week" : "day";
  const tiles: Array<[string, number, string | null]> = [
    ["Races started", races.started, null],
    ["Races finished", races.finished, `${share(races.finished, races.started)} of races started`],
    ["Signed-in racers", racers.active, `${share(races.signedIn, races.started)} of races signed in`],
    ["Sign-ups", signUps, null],
    ["Leaderboard runs", leaderboard.verified, `${leaderboard.rejected.toLocaleString()} rejected`],
    ["New personal bests", leaderboard.personalBests, `${leaderboard.courseRecords.toLocaleString()} course records`],
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
              Dashboard
            </h1>
            <p className="max-w-2xl text-sm text-titan-ice/62">
              The official course at a glance: races, racers, the
              leaderboard, karts, and sharing. Counts only. Days run midnight
              to midnight in {overview.timeZone}.
            </p>
          </div>
          <AdminNav current="/admin" signOutPending={signOutPending} onSignOut={onSignOut} />
        </header>

        <ReportingPeriod value={range} onChange={onRangeChange} />

        <section aria-label="At a glance" className="grid grid-cols-2 gap-3 lg:grid-cols-3 xl:grid-cols-6">
          {tiles.map(([label, value, note]) => (
            <article className="grid content-start gap-2 border border-titan-ice/15 bg-titan-ice/[0.035] p-4" key={label}>
              <p className="font-mono text-[0.66rem] font-bold uppercase tracking-[0.14em] text-titan-muted">
                {label}
              </p>
              <p className="text-3xl font-black tabular-nums">{value.toLocaleString()}</p>
              {note ? <p className="text-xs text-titan-ice/58">{note}</p> : null}
            </article>
          ))}
        </section>

        <Panel title={`Races each ${period}`}>
          <ColumnChart
            buckets={overview.activity.map((bucket) => ({
              date: bucket.date,
              values: [bucket.finished, bucket.started - bucket.finished],
            }))}
            key={overview.range}
            period={period}
            series={[
              { color: FINISHED, name: "Finished" },
              { color: NOT_FINISHED, name: "Didn't finish" },
            ]}
            totalLabel="Started"
          />
        </Panel>

        <div className="grid gap-6 lg:grid-cols-[1.35fr_1fr]">
          <Panel title={`Signed-in racers each ${period}`}>
            <ColumnChart
              buckets={overview.activity.map((bucket) => ({
                date: bucket.date,
                values: [bucket.signedInRacers],
              }))}
              key={overview.range}
              period={period}
              series={[{ color: SIGNED_IN, name: "Signed-in racers" }]}
            />
          </Panel>

          <Panel
            note="Races count as signed in from this dashboard's release on; earlier races all show as guest. Sign-ups count each racer by how they joined; racers started on one browser count as signed in, and as kept once they add a login method."
            title="Who's racing"
          >
            <SplitBar
              parts={[
                { color: SIGNED_IN, name: "Signed in", value: races.signedIn },
                { color: GUEST, name: "Guest", value: races.guest },
              ]}
            />
            <MetricRows rows={[
              ["Google sign-ups", racers.signUps.google],
              ["Wallet sign-ups", racers.signUps.wallet],
              ["This-browser sign-ups", racers.signUps.browser],
              ["Kept with a login method", racers.signUps.browserKept],
            ]} />
          </Panel>
        </div>

        <div className="grid gap-6 md:grid-cols-2 xl:grid-cols-4">
          <Panel
            note="New bests beat every earlier run: the racer's own, or anyone's for a course record. Ties don't count."
            title="Leaderboard"
          >
            <MetricRows rows={[
              ["Verified runs", leaderboard.verified],
              ["Rejected runs", leaderboard.rejected],
              ["Sent after signing in", leaderboard.afterSignIn],
              ["New personal bests", leaderboard.personalBests],
              ["New course records", leaderboard.courseRecords],
            ]} />
          </Panel>

          <Panel note="Races from older builds that didn't record a kart aren't counted." title="Races per kart">
            <BarRows rows={overview.karts.map((kart) => [kart.name, kart.races])} />
          </Panel>

          <Panel title="Ghost choices">
            <BarRows rows={[
              ["No ghost", overview.ghosts.none],
              ["Own best", overview.ghosts.ownBest],
              ["Course best", overview.ghosts.courseBest],
              ["From a shared link", overview.ghosts.sharedLink],
              ["From the leaderboard", overview.ghosts.leaderboardRacer],
            ]} />
          </Panel>

          <Panel
            note="Links copied from the results screen after a finish. Races they led to are under Ghost choices."
            title="Replays and sharing"
          >
            <MetricRows rows={[
              ["Links copied", races.resultsShared],
              ["Race again", races.raceAgain],
            ]} />
          </Panel>
        </div>
      </div>
    </main>
  );
}

function Panel({
  children,
  note,
  title,
}: {
  children: React.ReactNode;
  note?: string;
  title: string;
}) {
  const id = `panel-${title.toLowerCase().replace(/[^a-z]+/g, "-")}`;
  return (
    <section aria-labelledby={id} className="grid content-start gap-5 border border-titan-ice/15 p-5 sm:p-6">
      <h2 className="text-lg font-black uppercase" id={id}>{title}</h2>
      {children}
      {note ? <p className="text-xs leading-relaxed text-titan-muted">{note}</p> : null}
    </section>
  );
}

/** The smallest of 1, 2, or 5 times a power of ten at or above `value`. */
function niceCeiling(value: number) {
  if (value <= 1) return 1;
  const power = 10 ** Math.floor(Math.log10(value));
  return [1, 2, 5, 10].map((step) => step * power).find((step) => step >= value)!;
}

// The top segment of a stacked column, which gets the rounded end.
function topPart(values: number[]) {
  return values.reduce((last, value, part) => (value > 0 ? part : last), -1);
}

// Centred over its column, or held to the chart's edge near either side.
function tooltipPlacement(fraction: number): React.CSSProperties {
  if (fraction < 0.3) return { left: `${fraction * 100}%` };
  if (fraction > 0.7) return { right: `${(1 - fraction) * 100}%` };
  return { left: `${fraction * 100}%`, transform: "translateX(-50%)" };
}

/**
 * Columns from one baseline, stacked when there are several series, with
 * a tooltip on hover or tap and the same numbers as a table.
 */
function ColumnChart({
  buckets,
  period,
  series,
  totalLabel,
}: {
  buckets: Array<{ date: string; values: number[] }>;
  period: "day" | "week";
  series: Array<{ color: string; name: string }>;
  totalLabel?: string;
}) {
  const [active, setActive] = useState<number | null>(null);
  const totals = buckets.map(({ values }) => values.reduce((sum, value) => sum + value, 0));
  const top = niceCeiling(Math.max(0, ...totals));
  const labelEvery = Math.ceil(buckets.length / 7);
  const shown = active === null ? null : buckets[active];
  const dateLabel = (date: string) =>
    period === "week" ? `Week of ${formatDay(date)}` : formatDay(date, "long");

  return (
    <div className="grid gap-3">
      {series.length > 1 ? (
        <ul className="flex flex-wrap gap-x-5 gap-y-2 text-xs text-titan-ice/70">
          {series.map((entry) => (
            <li className="flex items-center gap-2" key={entry.name}>
              <span aria-hidden="true" className="size-3 rounded-[2px]" style={{ background: entry.color }} />
              {entry.name}
            </li>
          ))}
        </ul>
      ) : null}
      <div aria-hidden="true" className="relative grid grid-cols-[2.5rem_1fr] gap-2">
        <div className="relative h-44 font-mono text-[0.65rem] text-titan-muted">
          {[top, top / 2, 0].map((tick, index) => (
            <span className="absolute right-0 -translate-y-1/2 tabular-nums" key={index} style={{ top: `${index * 50}%` }}>
              {Number.isInteger(tick) ? tick.toLocaleString() : ""}
            </span>
          ))}
        </div>
        <div className="relative h-44" onMouseLeave={() => setActive(null)}>
          {[0, 50, 100].map((offset) => (
            <div className="absolute inset-x-0 h-px bg-titan-ice/10" key={offset} style={{ top: `${offset}%` }} />
          ))}
          <div className="absolute inset-0 flex items-end gap-[2px]">
            {buckets.map((bucket, index) => (
              <div
                className={`flex h-full flex-1 cursor-default items-end justify-center ${active === index ? "bg-titan-ice/[0.06]" : ""}`}
                key={bucket.date}
                onClick={() => setActive(active === index ? null : index)}
                onMouseEnter={() => setActive(index)}
              >
                <div
                  className="flex w-full max-w-6 flex-col-reverse gap-[2px]"
                  // A column of one still shows on a tall scale.
                  style={{ height: totals[index] > 0 ? `max(4px, ${(totals[index] / top) * 100}%)` : 0 }}
                >
                  {bucket.values.map((value, part) =>
                    value > 0 ? (
                      <div
                        className={part === topPart(bucket.values) ? "rounded-t-[4px]" : ""}
                        key={part}
                        style={{ background: series[part].color, flexGrow: value }}
                      />
                    ) : null,
                  )}
                </div>
              </div>
            ))}
          </div>
          {shown && active !== null ? (
            <div
              className="pointer-events-none absolute top-0 z-10 grid min-w-36 gap-1 border border-titan-ice/20 bg-titan-panel px-3 py-2 text-xs shadow-lg"
              style={tooltipPlacement((active + 0.5) / buckets.length)}
            >
              <p className="font-bold">{dateLabel(shown.date)}</p>
              {series.map((entry, part) => (
                <p className="flex items-center justify-between gap-4" key={entry.name}>
                  <span className="flex items-center gap-2 text-titan-ice/70">
                    <span className="size-2 rounded-[2px]" style={{ background: entry.color }} />
                    {entry.name}
                  </span>
                  <span className="font-mono tabular-nums">{shown.values[part].toLocaleString()}</span>
                </p>
              ))}
              {totalLabel ? (
                <p className="flex justify-between gap-4 border-t border-titan-ice/10 pt-1">
                  <span className="text-titan-ice/70">{totalLabel}</span>
                  <span className="font-mono tabular-nums">{totals[active].toLocaleString()}</span>
                </p>
              ) : null}
            </div>
          ) : null}
        </div>
        <div />
        <div className="flex gap-[2px] font-mono text-[0.65rem] text-titan-muted">
          {buckets.map((bucket, index) => (
            // Counted back from the latest, which always has a label.
            <span className="flex min-w-0 flex-1 justify-center" key={bucket.date}>
              {(buckets.length - 1 - index) % labelEvery === 0 ? (
                <span className="whitespace-nowrap">{formatDay(bucket.date)}</span>
              ) : null}
            </span>
          ))}
        </div>
      </div>
      <details className="text-xs text-titan-ice/70">
        <summary className="cursor-pointer font-mono uppercase tracking-[0.12em] text-titan-muted">Table view</summary>
        <div className="mt-3 max-h-64 overflow-auto">
          <table className="w-full border-collapse text-left">
            <thead className="font-mono text-[0.65rem] uppercase tracking-[0.12em] text-titan-muted">
              <tr className="border-b border-titan-ice/15">
                <th className="py-2 pr-3">{period === "week" ? "Week of" : "Day"}</th>
                {series.map((entry) => (
                  <th className="py-2 pr-3 text-right" key={entry.name}>{entry.name}</th>
                ))}
                {totalLabel ? <th className="py-2 text-right">{totalLabel}</th> : null}
              </tr>
            </thead>
            <tbody>
              {buckets.map((bucket, index) => (
                <tr className="border-b border-titan-ice/10" key={bucket.date}>
                  <td className="py-1.5 pr-3"><time dateTime={bucket.date}>{formatDay(bucket.date, "long")}</time></td>
                  {bucket.values.map((value, part) => (
                    <td className="py-1.5 pr-3 text-right font-mono tabular-nums" key={part}>{value.toLocaleString()}</td>
                  ))}
                  {totalLabel ? <td className="py-1.5 text-right font-mono tabular-nums">{totals[index].toLocaleString()}</td> : null}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </details>
    </div>
  );
}

/** One whole split into its parts, each named with its share beside it. */
function SplitBar({
  parts,
}: {
  parts: Array<{ color: string; name: string; value: number }>;
}) {
  const total = parts.reduce((sum, part) => sum + part.value, 0);
  return (
    <div className="grid gap-3">
      <div aria-hidden="true" className="flex h-8 gap-[2px] bg-titan-ice/10">
        {total > 0
          ? parts.map((part) =>
              part.value > 0 ? (
                <div key={part.name} style={{ background: part.color, flexGrow: part.value }} />
              ) : null,
            )
          : null}
      </div>
      <dl className="flex flex-wrap gap-x-6 gap-y-2 text-sm">
        {parts.map((part) => (
          <div className="flex items-center gap-2" key={part.name}>
            <dt className="flex items-center gap-2 text-titan-ice/65">
              <span aria-hidden="true" className="size-3 rounded-[2px]" style={{ background: part.color }} />
              {part.name} races
            </dt>
            <dd className="font-mono font-bold tabular-nums">
              {part.value.toLocaleString()} · {share(part.value, total)}
            </dd>
          </div>
        ))}
      </dl>
    </div>
  );
}

/** Rows ranked largest first, each with a bar against the largest. */
function BarRows({ rows }: { rows: Array<[string, number]> }) {
  const largest = Math.max(1, ...rows.map(([, value]) => value));
  const ranked = [...rows].sort((left, right) => right[1] - left[1]);
  return (
    <dl className="grid gap-3">
      {ranked.map(([label, value]) => (
        <div className="grid gap-1.5" key={label}>
          <div className="flex items-center justify-between gap-4">
            <dt className="text-sm text-titan-ice/65">{label}</dt>
            <dd className="font-mono font-bold tabular-nums">{value.toLocaleString()}</dd>
          </div>
          <div aria-hidden="true" className="h-2 bg-titan-ice/10">
            <div className="h-full rounded-r-[4px] bg-titan-hazard" style={{ width: `${(value / largest) * 100}%` }} />
          </div>
        </div>
      ))}
    </dl>
  );
}

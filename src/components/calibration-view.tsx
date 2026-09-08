import { Link } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { useEffect, useMemo, useState } from "react";
import { SignalBadge } from "@/components/signal-badge";
import { Button } from "@/components/ui/button";
import { isPrintMarket } from "@/lib/crypto";
import {
  collectDeskSnaps,
  scoredRows,
  seriesGroup,
  summarize,
  summarizeByHorizon,
  summarizeBySeries,
  useCalibration,
} from "@/lib/calibration";
import { getSettlements } from "@/lib/desk-fn";
import { exportBookJson, exportScoresCsv } from "@/lib/export";
import { useBlotter } from "@/lib/blotter";
import { useBot } from "@/lib/bot";
import { useForecasts } from "@/lib/forecasts";
import { useWatchlist } from "@/lib/watchlist";
import { pct, relativeClose, usdTarget } from "@/lib/format";
import type { DeskResponse } from "@/lib/types";
import { cn } from "@/lib/utils";

type Filter = "honest" | "all" | "fifteen" | "signals";

export function CalibrationView({
  desk,
  deskError,
  deskFetching,
}: {
  desk?: DeskResponse;
  deskError?: string;
  deskFetching?: boolean;
}) {
  const snaps = useCalibration((s) => s.snaps);
  const verdicts = useCalibration((s) => s.verdicts);
  const capture = useCalibration((s) => s.capture);
  const watch = useWatchlist((s) => s.tickers);
  const lots = useBlotter((s) => s.lots);
  const grokByTicker = useForecasts((s) => s.byTicker);
  const [filter, setFilter] = useState<Filter>("honest");

  useEffect(() => {
    if (!desk) return;
    capture(
      collectDeskSnaps(
        desk,
        watch,
        lots.filter((l) => l.status === "open").map((l) => l.ticker),
        grokByTicker,
      ),
    );
  }, [desk, watch, lots, capture, grokByTicker]);

  const scored = useMemo(() => scoredRows(snaps, verdicts), [snaps, verdicts]);
  const bySeries = useMemo(() => summarizeBySeries(scored), [scored]);
  const byHorizon = useMemo(() => summarizeByHorizon(scored), [scored]);
  const latestModel = useMemo(() => {
    let newest = "";
    for (const s of Object.values(snaps)) {
      const t = s.lastSnappedAt ?? s.snappedAt;
      if (t > newest) newest = t;
    }
    if (!newest) return "";
    const snap = Object.values(snaps).find((s) => (s.lastSnappedAt ?? s.snappedAt) === newest);
    return snap?.modelVersion ?? "";
  }, [snaps]);
  const visible = useMemo(() => {
    if (filter === "honest") return scored.filter((r) => r.informative);
    if (filter === "fifteen") return scored.filter((r) => isPrintMarket(r.seriesTicker));
    if (filter === "signals") return scored.filter((r) => r.signal !== "hold");
    return scored;
  }, [scored, filter]);
  const stats = useMemo(() => summarize(scored), [scored]);

  const pending = Object.keys(snaps).filter((t) => !verdicts[t]).length;
  const lastSnapAt = useMemo(() => {
    let latest = 0;
    for (const s of Object.values(snaps)) {
      const t = Date.parse(s.lastSnappedAt ?? s.snappedAt);
      if (t > latest) latest = t;
    }
    return latest ? new Date(latest).toISOString() : "";
  }, [snaps]);
  const liveFifteen = useMemo(
    () =>
      Object.values(snaps)
        .filter((s) => isPrintMarket(s.seriesTicker) && !verdicts[s.ticker])
        .sort((a, b) => a.seriesTicker.localeCompare(b.seriesTicker)),
    [snaps, verdicts],
  );
  const marks = useBlotter((s) => s.marks);
  const bot = useBot();

  const hist = useQuery({
    queryKey: ["settlements", "history"],
    queryFn: () => getSettlements({ data: { tickers: [] } }),
    staleTime: 30_000,
    refetchInterval: 60_000,
  });

  return (
    <div className="flex flex-col gap-6">
      <div>
        <h1 className="text-3xl font-medium tracking-tight md:text-4xl">Calibration</h1>
        <p className="mt-2 max-w-xl text-sm leading-relaxed text-muted">
          Live quotes are snapshotted as the desk refreshes. After Kalshi settles, Fairline
          scores fair against YES=1 / NO=0. Headline numbers use the honest set: mid still
          between 8¢ and 92¢, and the snapshot at least 90 seconds before close. Slam-dunk
          99¢ rungs do not count as skill. Paper lots on scored tickers settle automatically.
        </p>
      </div>

      <section className="rounded-xl bg-surface px-4 py-3 shadow-[var(--shadow-border)] md:px-5">
        <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-sm">
          <span className="inline-flex items-center gap-2 text-fg">
            <span
              className={cn(
                "size-1.5 rounded-full",
                desk ? "live-dot bg-yes" : deskFetching ? "bg-muted" : "bg-no",
              )}
            />
            {desk ? "Live" : deskFetching ? "Loading books" : deskError ? "Desk offline" : "Waiting for books"}
          </span>
          <span className="text-muted">
            {lastSnapAt ? `Last snap ${relativeClose(lastSnapAt)}` : "No snapshots yet"}
          </span>
          <span className="text-muted tabular-nums">{pending} open</span>
        </div>
        {liveFifteen.length ? (
          <ul className="mt-3 grid gap-2 sm:grid-cols-2">
            {liveFifteen.map((s) => (
              <li key={s.ticker} className="flex items-baseline justify-between gap-2 text-sm">
                <span className="truncate text-muted">
                  {s.seriesTicker.includes("ETH")
                    ? "ETH 15m"
                    : s.seriesTicker.includes("GOLD")
                      ? "Gold 15m"
                      : "BTC 15m"}
                  {s.target ? ` ${usdTarget(s.target)}` : ""}
                </span>
                <span className="shrink-0 tabular-nums">
                  {pct(s.mid, 0)}
                  <span className="text-subtle"> → </span>
                  <span className="text-fg">{pct(s.fair, 0)}</span>
                  <span className="ml-2 text-xs text-subtle">{relativeClose(s.closeTime)}</span>
                </span>
              </li>
            ))}
          </ul>
        ) : null}
        {deskError ? <p className="mt-2 text-xs text-no">{deskError}</p> : null}
      </section>

      <section className="grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-6">
        <Stat
          label="Honest"
          value={`${stats.honestN}/${stats.n}`}
          hint={pending ? `${pending} waiting` : "live vs all"}
        />
        <Stat
          label="Model Brier"
          value={stats.honestN ? stats.honestBrier.toFixed(3) : "—"}
          hint="lower is better"
        />
        <Stat
          label="vs market"
          value={
            stats.honestN
              ? `${stats.honestSkill >= 0 ? "+" : ""}${stats.honestSkill.toFixed(3)}`
              : "—"
          }
          hint="market Brier − model"
        />
        <Stat
          label="15m Brier"
          value={stats.fifteenN ? stats.fifteenBrier.toFixed(3) : "—"}
          hint={`${stats.fifteenN} honest prints`}
        />
        <Stat
          label="Signals"
          value={
            stats.signalN
              ? `${stats.signalHits}/${stats.signalN}`
              : "—"
          }
          hint="buy YES/NO hits"
        />
        <Stat
          label="Side"
          value={stats.sideN ? pct(stats.sideHits / stats.sideN, 0) : "—"}
          hint="fair vs mid"
        />
      </section>

      {latestModel ? (
        <p className="-mt-2 text-[11px] text-subtle tabular-nums">
          Scoring against model {latestModel} — every snapshot records the model version that
          produced its fair value.
        </p>
      ) : null}

      {bySeries.length > 0 ? (
        <section className="rounded-xl bg-surface px-4 py-4 shadow-[var(--shadow-border)] md:px-5">
          <p className="text-xs font-medium tracking-wide text-subtle uppercase">
            By series (honest rows)
          </p>
          <p className="mt-1 text-xs text-muted">
            Ladder rungs from one event are grouped together — they are not independent samples.
          </p>
          <div className="mt-3 overflow-x-auto">
            <table className="w-full min-w-[34rem] text-left text-sm">
              <thead>
                <tr className="border-b border-border text-[11px] tracking-wide text-subtle uppercase">
                  <th className="py-1.5 pr-3 font-medium">Series</th>
                  <th className="py-1.5 pr-3 text-right font-medium">N (events)</th>
                  <th className="py-1.5 pr-3 text-right font-medium">Model Brier</th>
                  <th className="py-1.5 pr-3 text-right font-medium">Market Brier</th>
                  <th className="py-1.5 text-right font-medium">Skill</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border">
                {bySeries.map((g) => {
                  const sg = seriesGroup(g.key);
                  return (
                    <tr key={g.key}>
                      <td className="py-2 pr-3">
                        {sg.label}
                        {g.isLadder ? (
                          <span className="ml-1 text-[10px] text-subtle">ladder</span>
                        ) : null}
                      </td>
                      <td className="py-2 pr-3 text-right tabular-nums text-muted">
                        {g.honestN > 0 ? `${g.honestN} (${g.honestEvents})` : `${g.n} (${g.events})`}
                      </td>
                      <td className="py-2 pr-3 text-right tabular-nums">
                        {g.honestN > 0 ? g.honestBrier.toFixed(3) : "—"}
                      </td>
                      <td className="py-2 pr-3 text-right tabular-nums text-muted">
                        {g.honestN > 0 ? g.honestMarketBrier.toFixed(3) : "—"}
                      </td>
                      <td
                        className={cn(
                          "py-2 text-right tabular-nums",
                          g.honestN > 0 && g.honestSkill > 0.002
                            ? "text-yes"
                            : g.honestN > 0 && g.honestSkill < -0.002
                              ? "text-no"
                              : "text-subtle",
                        )}
                      >
                        {g.honestN > 0 ? `${g.honestSkill >= 0 ? "+" : ""}${g.honestSkill.toFixed(3)}` : "—"}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </section>
      ) : null}

      {byHorizon.length > 0 ? (
        <section className="rounded-xl bg-surface px-4 py-4 shadow-[var(--shadow-border)] md:px-5">
          <p className="text-xs font-medium tracking-wide text-subtle uppercase">
            By lead time (honest rows)
          </p>
          <div className="mt-3 overflow-x-auto">
            <table className="w-full min-w-[30rem] text-left text-sm">
              <thead>
                <tr className="border-b border-border text-[11px] tracking-wide text-subtle uppercase">
                  <th className="py-1.5 pr-3 font-medium">Snap before close</th>
                  <th className="py-1.5 pr-3 text-right font-medium">N</th>
                  <th className="py-1.5 pr-3 text-right font-medium">Model Brier</th>
                  <th className="py-1.5 pr-3 text-right font-medium">Market Brier</th>
                  <th className="py-1.5 text-right font-medium">Skill</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border">
                {byHorizon.map((h) => (
                  <tr key={h.label}>
                    <td className="py-2 pr-3">{h.label}</td>
                    <td className="py-2 pr-3 text-right tabular-nums text-muted">{h.n}</td>
                    <td className="py-2 pr-3 text-right tabular-nums">{h.brier.toFixed(3)}</td>
                    <td className="py-2 pr-3 text-right tabular-nums text-muted">
                      {h.marketBrier.toFixed(3)}
                    </td>
                    <td
                      className={cn(
                        "py-2 text-right tabular-nums",
                        h.skill > 0.002 ? "text-yes" : h.skill < -0.002 ? "text-no" : "text-subtle",
                      )}
                    >
                      {h.skill >= 0 ? "+" : ""}
                      {h.skill.toFixed(3)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      ) : null}

      {stats.honestN > 0 ? (
        <section className="rounded-xl bg-surface px-4 py-4 shadow-[var(--shadow-border)] md:px-5">
          <p className="text-xs font-medium tracking-wide text-subtle uppercase">Reliability</p>
          <p className="mt-1 text-xs text-muted">
            Honest rows only. In a calibrated model, average fair in a bin matches how often YES actually settled.
          </p>
          <ol className="mt-4 grid grid-cols-5 gap-2">
            {stats.bins.map((b) => (
              <li key={b.lo} className="flex flex-col gap-1">
                <div className="flex h-16 items-end gap-0.5">
                  <span
                    className="w-1/2 rounded-sm bg-elevated"
                    style={{ height: `${Math.max(4, b.avgFair * 100)}%` }}
                    title={`fair ${pct(b.avgFair, 0)}`}
                  />
                  <span
                    className="w-1/2 rounded-sm bg-accent"
                    style={{ height: `${Math.max(4, b.freq * 100)}%` }}
                    title={`YES ${pct(b.freq, 0)}`}
                  />
                </div>
                <p className="text-[10px] tabular-nums text-subtle">
                  {Math.round(b.lo * 100)}–{Math.round(b.hi * 100)}
                </p>
                <p className="text-[10px] tabular-nums text-muted">{b.n}</p>
              </li>
            ))}
          </ol>
          <p className="mt-2 text-[10px] text-subtle">Grey = model fair · accent = realized YES rate</p>
        </section>
      ) : stats.n > 0 ? (
        <section className="rounded-xl bg-surface px-6 py-8 text-center shadow-[var(--shadow-border)]">
          <p className="text-sm text-muted">
            {stats.n} scored print{stats.n === 1 ? "" : "s"}, none honest — mids were outside
            8¢–92¢ or snapped inside 90s of close. Open All scored to see them. They do not
            count as skill.
          </p>
        </section>
      ) : (
        <section className="rounded-xl bg-surface px-6 py-10 text-center shadow-[var(--shadow-border)]">
          <p className="text-sm text-muted">
            {pending
              ? `${pending} live snapshot${pending === 1 ? "" : "s"} waiting for Kalshi to settle. Headline Brier stays empty until an honest print scores — mid still 8¢–92¢, snapped ≥90s before close.`
              : "Nothing scored yet. Leave the desk open through a 15-minute BTC print — that is the fastest loop."}
          </p>
          <Button asChild className="mt-4">
            <Link to="/">Back to the desk</Link>
          </Button>
        </section>
      )}

      <div className="flex flex-wrap gap-2">
        {(
          [
            ["honest", "Honest"],
            ["all", "All scored"],
            ["fifteen", "15-minute"],
            ["signals", "Signals"],
          ] as const
        ).map(([id, label]) => (
          <Button
            key={id}
            type="button"
            size="sm"
            variant={filter === id ? "primary" : "secondary"}
            onClick={() => setFilter(id)}
          >
            {label}
          </Button>
        ))}
        <Button
          variant="secondary"
          size="sm"
          onClick={() => exportScoresCsv(visible.length ? visible : scored)}
          disabled={scored.length === 0}
        >
          Export CSV
        </Button>
        <Button
          variant="ghost"
          size="sm"
          onClick={() =>
            exportBookJson({
              lots,
              marks,
              snaps,
              verdicts,
              scored,
              bot: {
                on: bot.on,
                universe: bot.universe,
                sessionFills: bot.sessionFills,
                lastNote: bot.lastNote,
              },
            })
          }
        >
          Export JSON
        </Button>
      </div>

      {visible.length > 0 ? (
        <section className="rounded-xl bg-surface shadow-[var(--shadow-border)]">
          <ol className="divide-y divide-border">
            {visible.slice(0, 80).map((r) => (
              <li key={r.ticker}>
                <Link
                  to="/market/$ticker"
                  params={{ ticker: r.ticker }}
                  className="flex flex-col gap-1 px-4 py-3 hover:bg-elevated md:grid md:grid-cols-12 md:items-center md:gap-2"
                >
                  <span className="min-w-0 md:col-span-4">
                    <span className="block truncate font-medium">{r.title || r.eventTitle}</span>
                    <span className="text-xs text-subtle">
                      {isPrintMarket(r.seriesTicker) && r.target
                        ? usdTarget(r.target)
                        : r.eventTitle}
                    </span>
                  </span>
                  <span className="text-sm tabular-nums text-muted md:col-span-2 md:text-right">
                    {pct(r.mid, 0)}
                    <span className="text-subtle"> → </span>
                    <span className="text-fg">{pct(r.fair, 0)}</span>
                  </span>
                  <span
                    className={cn(
                      "text-sm font-medium md:col-span-1 md:text-right",
                      r.result === "yes" ? "text-yes" : "text-no",
                    )}
                  >
                    {r.result.toUpperCase()}
                  </span>
                  <span className="text-sm tabular-nums md:col-span-2 md:text-right">
                    {r.brier.toFixed(3)}
                    <span
                      className={cn(
                        "ml-1 text-xs",
                        r.skill > 0.002 ? "text-yes" : r.skill < -0.002 ? "text-no" : "text-subtle",
                      )}
                    >
                      {r.skill >= 0 ? "+" : ""}
                      {r.skill.toFixed(3)}
                    </span>
                  </span>
                  <span className="hidden text-xs text-subtle md:col-span-1 md:block md:text-right">
                    {relativeClose(r.closeTime)}
                  </span>
                  <span className="md:col-span-2 md:flex md:justify-end">
                    <SignalBadge signal={r.signal} />
                  </span>
                </Link>
              </li>
            ))}
          </ol>
        </section>
      ) : null}

      {hist.data?.history.length ? (
        <section>
          <h2 className="text-lg font-medium tracking-tight">Recent 15-minute prints</h2>
          <p className="mt-1 text-xs text-muted">
            Kalshi outcomes. A Brier appears once Fairline had a live snapshot of that window.
          </p>
          <ol className="mt-3 divide-y divide-border rounded-xl bg-surface shadow-[var(--shadow-border)]">
            {hist.data.history.slice(0, 16).map((h) => {
              const row = scored.find((r) => r.ticker === h.ticker);
              return (
                <li
                  key={h.ticker}
                  className="flex items-center gap-3 px-4 py-3 text-sm"
                >
                  <span className="w-20 shrink-0 text-xs tabular-nums text-subtle">
                    {relativeClose(h.closeTime)}
                  </span>
                  <span className="min-w-0 flex-1 truncate">
                    {h.seriesTicker.includes("ETH")
                      ? "ETH"
                      : h.seriesTicker.includes("GOLD")
                        ? "GOLD"
                        : "BTC"}{" "}
                    {usdTarget(h.target)}
                  </span>
                  <span className={h.result === "yes" ? "text-yes" : "text-no"}>
                    {h.result === "yes" ? "UP" : "DOWN"}
                  </span>
                  <span className="w-14 text-right tabular-nums text-muted">
                    {row ? row.brier.toFixed(3) : "—"}
                  </span>
                </li>
              );
            })}
          </ol>
        </section>
      ) : null}
    </div>
  );
}

function Stat({
  label,
  value,
  hint,
}: {
  label: string;
  value: string;
  hint?: string;
}) {
  return (
    <div className="rounded-xl bg-surface px-4 py-3 shadow-[var(--shadow-border)]">
      <p className="text-[11px] tracking-wide text-subtle uppercase">{label}</p>
      <p className="mt-1 font-mono text-lg tabular-nums">{value}</p>
      {hint ? <p className="mt-0.5 text-[11px] text-subtle">{hint}</p> : null}
    </div>
  );
}

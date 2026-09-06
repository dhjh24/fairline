import { Link } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { useMemo, useState } from "react";
import { SignalBadge } from "@/components/signal-badge";
import { Button } from "@/components/ui/button";
import { isFifteenCrypto } from "@/lib/crypto";
import { scoredRows, summarize, useCalibration } from "@/lib/calibration";
import { getSettlements } from "@/lib/desk-fn";
import { exportBookJson, exportScoresCsv } from "@/lib/export";
import { useBlotter } from "@/lib/blotter";
import { useBot } from "@/lib/bot";
import { pct, relativeClose, usdTarget } from "@/lib/format";
import { cn } from "@/lib/utils";

type Filter = "all" | "fifteen" | "signals";

export function CalibrationView() {
  const snaps = useCalibration((s) => s.snaps);
  const verdicts = useCalibration((s) => s.verdicts);
  const [filter, setFilter] = useState<Filter>("all");

  const scored = useMemo(() => scoredRows(snaps, verdicts), [snaps, verdicts]);
  const visible = useMemo(() => {
    if (filter === "fifteen") return scored.filter((r) => isFifteenCrypto(r.seriesTicker));
    if (filter === "signals") return scored.filter((r) => r.signal !== "hold");
    return scored;
  }, [scored, filter]);
  const stats = useMemo(() => summarize(visible), [visible]);
  const allStats = useMemo(() => summarize(scored), [scored]);

  const pending = Object.keys(snaps).filter((t) => !verdicts[t]).length;
  const lots = useBlotter((s) => s.lots);
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
          scores the last fair against YES=1 / NO=0. Lower Brier is better. Paper lots on
          those tickers settle automatically.
        </p>
      </div>

      <section className="grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-6">
        <Stat label="Scored" value={String(allStats.n)} hint={pending ? `${pending} waiting` : "snapshots"} />
        <Stat
          label="Brier"
          value={allStats.n ? allStats.brier.toFixed(3) : "—"}
          hint="(fair − outcome)²"
        />
        <Stat
          label="15m Brier"
          value={allStats.fifteenN ? allStats.fifteenBrier.toFixed(3) : "—"}
          hint={`${allStats.fifteenN} prints`}
        />
        <Stat
          label="Side"
          value={allStats.n ? pct(allStats.sideHits / allStats.n, 0) : "—"}
          hint="fair vs mid"
        />
        <Stat
          label="Signals"
          value={
            allStats.signalN
              ? `${allStats.signalHits}/${allStats.signalN}`
              : "—"
          }
          hint="buy YES/NO hits"
        />
        <Stat
          label="Grok Brier"
          value={allStats.grokN ? allStats.grokBrier.toFixed(3) : "—"}
          hint={allStats.grokN ? `${allStats.grokN} overlays` : "run a forecast"}
        />
      </section>

      {allStats.n > 0 ? (
        <section className="rounded-xl bg-surface px-4 py-4 shadow-[var(--shadow-border)] md:px-5">
          <p className="text-xs font-medium tracking-wide text-subtle uppercase">Reliability</p>
          <p className="mt-1 text-xs text-muted">
            In a calibrated model, average fair in a bin matches how often YES actually settled.
          </p>
          <ol className="mt-4 grid grid-cols-5 gap-2">
            {allStats.bins.map((b) => (
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
      ) : (
        <section className="rounded-xl bg-surface px-6 py-10 text-center shadow-[var(--shadow-border)]">
          <p className="text-sm text-muted">
            Nothing scored yet. Leave the desk open through a 15-minute BTC print — that is
            the fastest loop.
          </p>
          <Button asChild className="mt-4">
            <Link to="/">Back to the desk</Link>
          </Button>
        </section>
      )}

      <div className="flex flex-wrap gap-2">
        {(
          [
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
                      {isFifteenCrypto(r.seriesTicker) && r.target
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
                    {h.seriesTicker.includes("ETH") ? "ETH" : "BTC"} {usdTarget(h.target)}
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

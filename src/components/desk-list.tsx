import { Link } from "@tanstack/react-router";
import { useEffect, useMemo, useState } from "react";
import { SignalBadge } from "@/components/signal-badge";
import { StarButton } from "@/components/star-button";
import { ProbBar } from "@/components/prob-bar";
import { marketPlainReason } from "@/lib/decisions";
import { compact, pct, relativeClose, signedCents } from "@/lib/format";
import { useBlotter } from "@/lib/blotter";
import { useForecasts } from "@/lib/forecasts";
import type { DeskMarket } from "@/lib/types";
import { cn } from "@/lib/utils";

function EdgeCell({ market }: { market: DeskMarket }) {
  // Cost-aware executable edge (same value used for the Edge sort).
  const edge = market.execEdge;
  if (market.signal === "hold") {
    return <span className="text-subtle">—</span>;
  }
  return (
    <span className={cn("tabular-nums", edge >= 0 ? "text-yes" : "text-no")}>
      {signedCents(edge)}
    </span>
  );
}

function QuoteAge({ quoteAt }: { quoteAt?: string }) {
  // Hydration-safe like FeedStatus: renders a placeholder until mounted.
  const [now, setNow] = useState<number | null>(null);
  useEffect(() => {
    setNow(Date.now());
    const id = window.setInterval(() => setNow(Date.now()), 15_000);
    return () => window.clearInterval(id);
  }, []);
  if (!quoteAt || now == null) return <span>quote —</span>;
  const t = Date.parse(quoteAt);
  if (!Number.isFinite(t)) return <span>quote —</span>;
  const age = Math.max(0, Math.round((now - t) / 1000));
  return <span title="Quote age: seconds since the desk snapshot that produced this quote">quote {age}s</span>;
}

export function DeskList({ markets }: { markets: DeskMarket[] }) {
  const lots = useBlotter((s) => s.lots);
  const forecasts = useForecasts((s) => s.byTicker);
  const running = useForecasts((s) => s.running);
  const openTickers = useMemo(() => {
    const set = new Set<string>();
    for (const lot of lots) {
      if (lot.status === "open") set.add(lot.ticker);
    }
    return set;
  }, [lots]);
  if (markets.length === 0) {
    return (
      <div className="rounded-xl bg-surface px-6 py-16 text-center shadow-[var(--shadow-border)]">
        <p className="text-sm text-muted">No markets match these filters.</p>
      </div>
    );
  }

  return (
    <div className="rounded-xl bg-surface shadow-[var(--shadow-border)]">
      <div className="hidden grid-cols-10 gap-2 border-b border-border px-4 py-2 text-[0.7rem] font-medium tracking-wide text-subtle uppercase lg:grid-cols-12 md:grid">
        <span className="col-span-5 lg:col-span-5">Market</span>
        <span className="col-span-2">Close</span>
        <span className="col-span-2">Market / Fair</span>
        <span className="col-span-1 text-right">Net edge</span>
        <span className="col-span-1 hidden text-right lg:block">24h</span>
        <span className="col-span-1 hidden text-right lg:block">Quote</span>
      </div>
      <ul>
        {markets.map((m) => (
          <li key={m.ticker} className="border-b border-border last:border-0">
            <Link
              to="/market/$ticker"
              params={{ ticker: m.ticker }}
              className="flex flex-col gap-3 px-3 py-3 transition-colors duration-150 hover:bg-elevated md:grid md:grid-cols-10 md:items-center md:gap-2 md:px-4 lg:grid-cols-12"
            >
              <div className="flex items-start gap-2 md:col-span-5">
                <StarButton ticker={m.ticker} />
                <div className="min-w-0">
                  <div className="mb-1 flex flex-wrap items-center gap-2">
                    <SignalBadge signal={m.signal} />
                    <span className="text-xs text-subtle">{m.category}</span>
                    {openTickers.has(m.ticker) ? (
                      <span className="text-xs text-fg">In blotter</span>
                    ) : null}
                    {running.includes(m.ticker) ? (
                      <span className="text-xs text-subtle">Forecasting…</span>
                    ) : null}
                  </div>
                  <p className="truncate text-sm font-medium text-fg">
                    {m.yesSubTitle || m.title}
                  </p>
                  <p className="truncate text-xs text-muted">{m.eventTitle}</p>
                  <p className="mt-0.5 line-clamp-2 text-xs text-subtle">
                    {marketPlainReason(m)}
                  </p>
                  <div className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-1 text-[11px] text-subtle tabular-nums">
                    <span>
                      Buy YES {pct(m.ask, 0)} / NO {pct(1 - m.bid, 0)}
                    </span>
                    <QuoteAge quoteAt={m.quoteAt} />
                    <span title="Book-liquidity proxy: 24h volume and open interest">
                      depth {compact(m.volume24h)} vol / {compact(m.openInterest)} OI
                    </span>
                  </div>
                  {forecasts[m.ticker] ? (
                    <ForecastLine market={m} forecast={forecasts[m.ticker]!} />
                  ) : null}
                </div>
              </div>

              <div className="flex items-center justify-between gap-4 pl-10 text-xs text-muted md:col-span-2 md:block md:pl-0 md:text-sm">
                <span className="md:hidden">Closes</span>
                <span className="tabular-nums text-fg">{relativeClose(m.closeTime)}</span>
              </div>

              <div className="flex flex-col gap-1.5 pl-10 md:col-span-2 md:pl-0">
                <div className="flex items-baseline justify-between gap-2 text-sm tabular-nums md:justify-start md:gap-3">
                  <span className="text-muted">{pct(m.mid, 1)}</span>
                  <span className="text-subtle">→</span>
                  <span className="text-fg">{pct(m.fair, 1)}</span>
                </div>
                <ProbBar mid={m.mid} fair={m.fair} bid={m.bid} ask={m.ask} />
              </div>

              <div className="flex items-center justify-between pl-10 text-sm md:col-span-1 md:block md:pl-0 md:text-right">
                <span className="text-xs text-muted md:hidden">Net edge</span>
                <EdgeCell market={m} />
              </div>
              <div className="hidden text-right text-sm tabular-nums text-muted lg:col-span-1 lg:block">
                {compact(m.volume24h)}
              </div>
              <div className="hidden text-right text-sm tabular-nums text-muted lg:col-span-1 lg:block">
                {pct(m.quoteQuality, 0)}
              </div>
            </Link>
          </li>
        ))}
      </ul>
    </div>
  );
}

function ForecastLine({
  market,
  forecast,
}: {
  market: DeskMarket;
  forecast: { probability: number; blended: number };
}) {
  const grokSide = forecast.probability >= market.mid ? "yes" : "no";
  const agrees =
    market.signal === "hold" ? null : grokSide === market.signal ? "Agrees" : "Disagrees";
  return (
    <p className="mt-1 truncate text-xs text-subtle">
      Grok {pct(forecast.probability, 0)}
      <span className="text-subtle"> · </span>
      blend {pct(forecast.blended, 0)}
      {agrees ? (
        <>
          <span className="text-subtle"> · </span>
          <span className={agrees === "Agrees" ? "text-yes" : "text-no"}>{agrees}</span>
        </>
      ) : null}
    </p>
  );
}

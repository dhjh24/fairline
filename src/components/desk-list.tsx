import { Link } from "@tanstack/react-router";
import { useMemo } from "react";
import { SignalBadge } from "@/components/signal-badge";
import { StarButton } from "@/components/star-button";
import { ProbBar } from "@/components/prob-bar";
import { compact, pct, relativeClose, signedCents } from "@/lib/format";
import { useBlotter } from "@/lib/blotter";
import type { DeskMarket } from "@/lib/types";
import { cn } from "@/lib/utils";

function EdgeCell({ market }: { market: DeskMarket }) {
  const gap = market.fair - market.mid;
  const pos = gap >= 0;
  return (
    <span className={cn("tabular-nums", pos ? "text-yes" : "text-no")}>
      {signedCents(market.signal === "hold" ? gap : market.edge * Math.sign(gap || 1))}
    </span>
  );
}

export function DeskList({ markets }: { markets: DeskMarket[] }) {
  const lots = useBlotter((s) => s.lots);
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
        <span className="col-span-1 text-right">Edge</span>
        <span className="col-span-1 hidden text-right lg:block">24h</span>
        <span className="col-span-1 hidden text-right lg:block">Conf</span>
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
                  </div>
                  <p className="truncate text-sm font-medium text-fg">{m.title}</p>
                  <p className="truncate text-xs text-muted">{m.eventTitle}</p>
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
                <span className="text-xs text-muted md:hidden">Edge</span>
                <EdgeCell market={m} />
              </div>
              <div className="hidden text-right text-sm tabular-nums text-muted lg:col-span-1 lg:block">
                {compact(m.volume24h)}
              </div>
              <div className="hidden text-right text-sm tabular-nums text-muted lg:col-span-1 lg:block">
                {pct(m.confidence, 0)}
              </div>
            </Link>
          </li>
        ))}
      </ul>
    </div>
  );
}

import { Link } from "@tanstack/react-router";
import { Info } from "lucide-react";
import { useEffect, useMemo, type ReactNode } from "react";
import { Dialog, DialogContent, DialogTrigger } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { STARTING_CASH, blotterTotals, useBlotter } from "@/lib/blotter";
import { scoredRows, summarize, useCalibration } from "@/lib/calibration";
import { useForecasts } from "@/lib/forecasts";
import { useWatchlist } from "@/lib/watchlist";
import { SettlementLoop } from "@/components/settlement-loop";
import { usd } from "@/lib/format";
import { cn } from "@/lib/utils";

export function AppShell({
  children,
  live,
}: {
  children: ReactNode;
  live?: boolean;
}) {
  const hydrateWatch = useWatchlist((s) => s.hydrate);
  const hydrateBook = useBlotter((s) => s.hydrate);
  const hydrateForecasts = useForecasts((s) => s.hydrate);
  const hydrateCal = useCalibration((s) => s.hydrate);
  const lots = useBlotter((s) => s.lots);
  const marks = useBlotter((s) => s.marks);
  const totals = blotterTotals(lots, marks);
  const pnl = totals.realized + totals.unrealizedMarket;
  const hasBook = lots.some((l) => l.closeReason !== "void");
  const snaps = useCalibration((s) => s.snaps);
  const verdicts = useCalibration((s) => s.verdicts);
  const calBrier = useMemo(() => {
    const rows = scoredRows(snaps, verdicts);
    return rows.length ? summarize(rows).brier : null;
  }, [snaps, verdicts]);

  useEffect(() => {
    hydrateWatch();
    hydrateBook();
    hydrateForecasts();
    hydrateCal();
  }, [hydrateWatch, hydrateBook, hydrateForecasts, hydrateCal]);

  return (
    <div className="min-h-dvh bg-bg text-fg">
      <header className="sticky top-0 z-40 border-b border-border bg-bg/90 backdrop-blur-sm">
        <div className="mx-auto flex h-14 max-w-desk items-center justify-between gap-3 px-4 md:px-6">
          <Link to="/" className="flex shrink-0 items-center gap-3">
            <span className="flex size-8 items-center justify-center rounded-sm bg-accent text-accent-fg">
              <svg viewBox="0 0 24 24" className="size-4" aria-hidden="true">
                <path
                  d="M4 18 L12 6 L20 18"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="2.2"
                  strokeLinejoin="miter"
                />
                <path d="M7.5 18 H16.5" stroke="currentColor" strokeWidth="2.2" />
              </svg>
            </span>
            <span className="min-w-max leading-none">
              <span className="block text-sm font-medium tracking-tight">Fairline</span>
              <span className="mt-0.5 block text-xs text-muted">Kalshi fair value</span>
            </span>
          </Link>

          <div className="flex items-center gap-1 sm:gap-2">
            {live ? (
              <span className="hidden items-center gap-2 pr-2 text-xs text-muted sm:inline-flex">
                <span className="live-dot size-1.5 rounded-full bg-yes" />
                Live books
              </span>
            ) : null}
            <Link
              to="/calibration"
              className="inline-flex h-8 items-center gap-2 rounded-sm px-2.5 text-xs text-muted transition-colors duration-150 hover:bg-elevated hover:text-fg"
            >
              <span>Score</span>
              {calBrier != null ? (
                <span className="tabular-nums">{calBrier.toFixed(2)}</span>
              ) : (
                <span className="hidden text-subtle sm:inline">log</span>
              )}
            </Link>
            <Link
              to="/blotter"
              className="inline-flex h-8 items-center gap-2 rounded-sm px-2.5 text-xs text-muted transition-colors duration-150 hover:bg-elevated hover:text-fg"
            >
              <span>Blotter</span>
              {hasBook ? (
                <span
                  className={cn(
                    "tabular-nums",
                    pnl > 0 ? "text-yes" : pnl < 0 ? "text-no" : "text-muted",
                  )}
                >
                  {usd(pnl)}
                </span>
              ) : (
                <span className="hidden tabular-nums text-subtle sm:inline">
                  ${STARTING_CASH.toLocaleString()}
                </span>
              )}
            </Link>
            <Dialog>
              <DialogTrigger asChild>
                <Button variant="ghost" size="iconSm" aria-label="How the model works">
                  <Info className="size-4" />
                </Button>
              </DialogTrigger>
              <DialogContent title="How Fairline prices a contract">
                <div className="space-y-3 text-sm leading-relaxed text-muted">
                  <p>
                    Fairline does not copy the last trade. It estimates a fair YES
                    probability from the live Kalshi book, then ranks contracts where that
                    number disagrees with the market by enough to clear the spread.
                  </p>
                  <ol className="list-decimal space-y-2 pl-4">
                    <li>
                      <span className="text-fg">Event vig.</span> On mutually exclusive
                      fields whose prices sum near 100%, the overround is removed so the
                      book is coherent.
                    </li>
                    <li>
                      <span className="text-fg">Longshot calibration.</span> A power map
                      (γ 1.14) trims overbet longshots and lifts underbet favorites.
                    </li>
                    <li>
                      <span className="text-fg">Liquidity gate.</span> Thin books
                      do not move the point estimate toward 50%. They raise the
                      edge required before a signal fires.
                    </li>
                    <li>
                      <span className="text-fg">Time convexity.</span> Near-dated contracts
                      are pushed toward 0/1; long-dated illiquid ones fade slightly.
                    </li>
                    <li>
                      <span className="text-fg">Tape and book.</span> Last-versus-mid and
                      order-book imbalance, scaled by liquidity.
                    </li>
                    <li>
                      <span className="text-fg">Crypto tape.</span> Hourly Bitcoin and
                      Ethereum above/below contracts are pulled in separately. Implied
                      spot is the strike where the live ladder crosses 50¢. The 15-minute
                      book is a single up/down versus the last CF print.
                    </li>
                    <li>
                      <span className="text-fg">Settlement log.</span> Each desk refresh
                      snapshots fair vs mid. After Kalshi settles, Fairline scores Brier
                      and whether the signal was right. Paper lots on those tickers close
                      at 100 or 0.
                    </li>
                  </ol>
                  <p>
                    A YES or NO signal fires only when expected value after the ask/bid is
                    at least 2¢ and the book is liquid enough. Grok forecasts are optional
                    and only run when you ask — one contract, or a batch of the top eight
                    on the desk. Pick Grok 4.6, 4.5, or 4.3. The blotter is paper — fills
                    never go to Kalshi.
                  </p>
                  <p className="text-xs">
                    Not financial advice. These are model estimates, not a promise of
                    settlement. Kalshi is a CFTC-regulated exchange; trade there at your
                    own risk.
                  </p>
                </div>
              </DialogContent>
            </Dialog>
          </div>
        </div>
      </header>
      <main className="mx-auto w-full max-w-desk px-4 pb-20 pt-6 md:px-6">{children}</main>
      <SettlementLoop />
    </div>
  );
}

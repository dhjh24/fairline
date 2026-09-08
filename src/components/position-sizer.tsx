import { Link } from "@tanstack/react-router";
import { useMemo, useState } from "react";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import {
  cashOnHand,
  lotPnl,
  useBlotter,
} from "@/lib/blotter";
import { takerFeeUsd, FEE_POLICY_ID } from "@/lib/fees";
import type { DeskMarket, OrderBook } from "@/lib/types";
import { pct, usd } from "@/lib/format";
import { cn } from "@/lib/utils";

/** Available contract depth at the executable touch from a real order book. */
function touchDepth(
  book: OrderBook | undefined,
  market: DeskMarket,
  side: "yes" | "no",
): { known: boolean; size: number } {
  if (!book) return { known: false, size: 0 };
  const levels = side === "yes" ? book.asks : book.bids;
  const target = side === "yes" ? market.ask : market.bid;
  if (!levels || levels.length === 0) return { known: false, size: 0 };
  // parseBook levels are grouped at one-cent prices; find the exact touch or
  // the first level that would be crossed.
  const hit = levels.find((l) => Math.abs(l.price - target) < 0.005);
  if (!hit) return { known: false, size: 0 };
  return { known: true, size: hit.cumulative };
}

export function PositionSizer({
  market,
  fair,
  book,
}: {
  market: DeskMarket;
  fair: number;
  book?: OrderBook;
}) {
  const [side, setSide] = useState<"yes" | "no">(market.signal === "no" ? "no" : "yes");
  const [n, setN] = useState(10);
  const [note, setNote] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const openLot = useBlotter((s) => s.openLot);
  const lots = useBlotter((s) => s.lots);
  const marks = useBlotter((s) => s.marks);
  const cash = cashOnHand(lots);

  const price = side === "yes" ? market.ask : 1 - market.bid;
  const p = side === "yes" ? fair : 1 - fair;
  const fee = takerFeeUsd(n, price);
  const cost = n * price + fee;
  const grossEv = n * (p - price);
  const netEv = grossEv - fee;
  const payout = n;
  const kellyN = Math.floor((side === "yes" ? market.kellyYes : market.kellyNo) * 100);
  const depth = touchDepth(book, market, side);
  const effectiveN =
    depth.known && depth.size > 0 ? Math.min(n, Math.floor(depth.size)) : n;
  const cappedByDepth = depth.known && depth.size > 0 && n > depth.size;
  const noLiveDepth = !depth.known;

  const openHere = lots.filter((l) => l.ticker === market.ticker && l.status === "open");
  const herePnl = openHere.reduce((s, lot) => {
    const yes = marks[lot.ticker]?.mid ?? market.mid;
    return s + lotPnl(lot, yes);
  }, 0);

  const summary = useMemo(
    () => ({
      cost,
      netEv,
      payout,
      roi: cost > 0 ? netEv / cost : 0,
    }),
    [cost, netEv, payout],
  );

  function logFill() {
    setError(null);
    if (noLiveDepth) {
      // No book on this quote: do not pretend we know depth; label slippage.
      setNote(
        `No live order book for this market — fill at the quoted touch is estimated; real slippage is unknown.`,
      );
      // Proceed anyway: paper desk fills at the touch, clearly labeled above.
    }
    const contracts = cappedByDepth ? Math.max(1, Math.floor(depth.size)) : n;
    const res = openLot({
      ticker: market.ticker,
      eventTicker: market.eventTicker,
      seriesTicker: market.seriesTicker,
      title: market.title,
      eventTitle: market.eventTitle,
      category: market.category,
      closeTime: market.closeTime,
      side,
      contracts,
      fillPrice: price,
      fairAtEntry: fair,
      midAtEntry: market.mid,
    });
    if (!res.ok) {
      setError(res.error);
      setNote(null);
      return;
    }
    const feeLabel = res.lot.feeUsd != null ? `incl. ~$${res.lot.feeUsd.toFixed(2)} fee` : "";
    setNote(
      `Logged ${contracts} ${side.toUpperCase()} @ ${pct(price)} ${feeLabel} · model EV after fee ${usd(netEv * (contracts / Math.max(1, n)))}`,
    );
  }

  return (
    <div className="flex flex-col gap-4">
      {openHere.length > 0 ? (
        <Link
          to="/blotter"
          className="flex items-center justify-between rounded-md bg-elevated px-3 py-2 text-xs"
        >
          <span className="text-muted">
            {openHere.length} paper lot{openHere.length === 1 ? "" : "s"} on this book
          </span>
          <span className={cn("tabular-nums", herePnl >= 0 ? "text-yes" : "text-no")}>
            {usd(herePnl)}
          </span>
        </Link>
      ) : null}

      <div className="flex gap-2">
        <button
          type="button"
          onClick={() => setSide("yes")}
          className={cn(
            "h-10 flex-1 rounded-md text-sm font-medium transition-colors duration-150",
            side === "yes" ? "bg-yes text-yes-fg" : "bg-elevated text-muted",
          )}
        >
          Buy YES @ {pct(market.ask)}
        </button>
        <button
          type="button"
          onClick={() => setSide("no")}
          className={cn(
            "h-10 flex-1 rounded-md text-sm font-medium transition-colors duration-150",
            side === "no" ? "bg-no text-fg" : "bg-elevated text-muted",
          )}
        >
          Buy NO @ {pct(1 - market.bid)}
        </button>
      </div>
      <label className="block text-xs text-muted">
        Contracts
        <Input
          type="number"
          min={1}
          max={5000}
          value={n}
          onChange={(e) => setN(Math.max(1, Math.min(5000, Number(e.target.value) || 1)))}
          className="mt-1"
        />
      </label>
      {noLiveDepth ? (
        <p className="rounded-md bg-no-dim px-2.5 py-1.5 text-xs text-no">
          No live order-book depth for this ticker — paper fill assumes the quoted touch; actual
          slippage is unknown (estimated).
        </p>
      ) : depth.size > 0 ? (
        <p className="rounded-md bg-elevated px-2.5 py-1.5 text-xs text-muted">
          Book depth at the touch: {Math.floor(depth.size)} contracts
          {cappedByDepth ? ` — capped from ${n} to ${effectiveN}` : ""}.
        </p>
      ) : null}
      <dl className="grid grid-cols-2 gap-3 text-sm">
        <div>
          <dt className="text-xs text-muted">Cost incl. fee</dt>
          <dd className="tabular-nums">${summary.cost.toFixed(2)}</dd>
        </div>
        <div>
          <dt className="text-xs text-muted">Est. taker fee</dt>
          <dd className="tabular-nums">${fee.toFixed(2)}</dd>
        </div>
        <div>
          <dt className="text-xs text-muted">Pays if right</dt>
          <dd className="tabular-nums">${summary.payout.toFixed(2)}</dd>
        </div>
        <div>
          <dt className="text-xs text-muted">Model EV after fee</dt>
          <dd className={cn("tabular-nums", summary.netEv >= 0 ? "text-yes" : "text-no")}>
            {usd(summary.netEv)}
          </dd>
        </div>
        <div>
          <dt className="text-xs text-muted">Kelly contracts (cap)</dt>
          <dd className="tabular-nums">{kellyN > 0 ? kellyN : "—"}</dd>
        </div>
      </dl>
      <div className="flex items-center justify-between text-xs text-subtle">
        <span className="tabular-nums">Paper cash ${cash.toFixed(2)}</span>
        {kellyN > 0 ? (
          <button type="button" className="hover:text-fg" onClick={() => setN(kellyN)}>
            Size to Kelly
          </button>
        ) : null}
      </div>
      <Button
        type="button"
        onClick={logFill}
        disabled={price <= 0 || cost > cash}
      >
        Log paper fill
      </Button>
      {cost > cash ? (
        <p className="text-xs text-no">
          Costs ${cost.toFixed(2)} incl. fee but only ${cash.toFixed(2)} paper cash is available.
        </p>
      ) : null}
      {error ? <p className="text-xs text-no">{error}</p> : null}
      {note ? (
        <p className="text-xs text-muted">
          {note}{" "}
          <Link to="/blotter" className="text-fg underline-offset-2 hover:underline">
            Open blotter
          </Link>
        </p>
      ) : null}
      <p className="text-xs text-subtle">
        Paper only. Fill at the touch ({side === "yes" ? "ask" : "bid"}). The Kalshi taker fee is
        estimated per ticket ({FEE_POLICY_ID}) and deducted from cash and EV. Marks follow the
        live desk — market mid and Fairline fair. Kelly is capped at 25% of a $100 unit and the
        ticket is capped at 10% of paper cash.
      </p>
    </div>
  );
}

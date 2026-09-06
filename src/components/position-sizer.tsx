import { Link } from "@tanstack/react-router";
import { useMemo, useState } from "react";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import {
  cashOnHand,
  lotPnl,
  sideMark,
  useBlotter,
} from "@/lib/blotter";
import type { DeskMarket } from "@/lib/types";
import { pct, usd } from "@/lib/format";
import { cn } from "@/lib/utils";

export function PositionSizer({ market, fair }: { market: DeskMarket; fair: number }) {
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
  const cost = n * price;
  const ev = n * (p - price);
  const payout = n;
  const kellyN = Math.floor((side === "yes" ? market.kellyYes : market.kellyNo) * 100);

  const openHere = lots.filter((l) => l.ticker === market.ticker && l.status === "open");
  const herePnl = openHere.reduce((s, lot) => {
    const yes = marks[lot.ticker]?.mid ?? market.mid;
    return s + lotPnl(lot, yes);
  }, 0);

  const summary = useMemo(
    () => ({
      cost,
      ev,
      payout,
      roi: cost > 0 ? ev / cost : 0,
    }),
    [cost, ev, payout],
  );

  function logFill() {
    setError(null);
    const res = openLot({
      ticker: market.ticker,
      eventTicker: market.eventTicker,
      seriesTicker: market.seriesTicker,
      title: market.title,
      eventTitle: market.eventTitle,
      category: market.category,
      closeTime: market.closeTime,
      side,
      contracts: n,
      fillPrice: price,
      fairAtEntry: fair,
      midAtEntry: market.mid,
    });
    if (!res.ok) {
      setError(res.error);
      setNote(null);
      return;
    }
    setNote(`Logged ${n} ${side.toUpperCase()} @ ${pct(price)} · model EV ${usd(ev)}`);
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
      <dl className="grid grid-cols-2 gap-3 text-sm">
        <div>
          <dt className="text-xs text-muted">Cost</dt>
          <dd className="tabular-nums">${summary.cost.toFixed(2)}</dd>
        </div>
        <div>
          <dt className="text-xs text-muted">Pays if right</dt>
          <dd className="tabular-nums">${summary.payout.toFixed(2)}</dd>
        </div>
        <div>
          <dt className="text-xs text-muted">Model EV</dt>
          <dd className={cn("tabular-nums", summary.ev >= 0 ? "text-yes" : "text-no")}>
            {usd(summary.ev)}
          </dd>
        </div>
        <div>
          <dt className="text-xs text-muted">Quarter-Kelly contracts</dt>
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
      <Button type="button" onClick={logFill} disabled={price <= 0}>
        Log paper fill
      </Button>
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
        Paper only. Fill at the touch ({side === "yes" ? "ask" : "bid"}). Marks follow the
        live desk — market mid and Fairline fair. Kelly is capped at 25% of a $100 unit.
        Model mark at entry is {pct(sideMark(side, fair))}.
      </p>
    </div>
  );
}

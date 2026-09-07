import { Link } from "@tanstack/react-router";
import { useMemo } from "react";
import { Button } from "@/components/ui/button";
import { blotterTotals, useBlotter } from "@/lib/blotter";
import { describeFill, useBot, type BotUniverse } from "@/lib/bot";
import { pct, usd } from "@/lib/format";
import { cn } from "@/lib/utils";

const UNIVERSES: { id: BotUniverse; label: string; hint: string }[] = [
  { id: "fifteen", label: "15-minute", hint: "Only the BTC and ETH 15-minute up/down" },
  { id: "fast", label: "Fast", hint: "Buy YES / Buy NO closing within 6 hours" },
  { id: "signals", label: "All signals", hint: "Every Buy YES / Buy NO on the desk" },
];

export function BotBar() {
  const on = useBot((s) => s.on);
  const universe = useBot((s) => s.universe);
  const lastNote = useBot((s) => s.lastNote);
  const lastFills = useBot((s) => s.lastFills);
  const setOn = useBot((s) => s.setOn);
  const setUniverse = useBot((s) => s.setUniverse);
  const lots = useBlotter((s) => s.lots);
  const marks = useBlotter((s) => s.marks);

  const botLots = useMemo(
    () => lots.filter((l) => l.source === "bot" && l.closeReason !== "void"),
    [lots],
  );
  const openBot = useMemo(
    () => botLots.filter((l) => l.status === "open"),
    [botLots],
  );
  const totals = useMemo(() => blotterTotals(botLots, marks), [botLots, marks]);
  const pnl = totals.realized + totals.unrealizedMarket;

  return (
    <section id="paper-bot" className="rounded-xl bg-surface px-4 py-4 shadow-[var(--shadow-border)] md:px-5">
      <div className="flex flex-col gap-3 md:flex-row md:items-start md:justify-between">
        <div>
          <div className="flex flex-wrap items-center gap-2">
            <p className="text-xs font-medium tracking-wide text-subtle uppercase">Paper bot</p>
            <span
              className={cn(
                "inline-flex items-center gap-1.5 rounded-full px-2 py-0.5 text-xs font-medium",
                on ? "bg-yes-dim text-yes" : "bg-elevated text-muted",
              )}
            >
              {on ? (
                <>
                  <span className="live-dot size-1.5 rounded-full bg-yes" />
                  ON
                </>
              ) : (
                "OFF"
              )}
            </span>
          </div>
          <p className="mt-1 text-sm text-muted">
            {on
              ? "Running. Buys YES at the ask or NO at the bid when Fairline fires. It does not sell, and it does not send orders to Kalshi."
              : "Paused. It will not buy until you turn it on."}
          </p>
        </div>
        <Button type="button" size="sm" variant={on ? "yes" : "secondary"} onClick={() => setOn(!on)}>
          {on ? "Turn off" : "Turn on"}
        </Button>
      </div>

      <div className="mt-4 flex flex-wrap gap-2">
        {UNIVERSES.map((u) => (
          <Button
            key={u.id}
            type="button"
            size="sm"
            variant={universe === u.id ? "primary" : "secondary"}
            onClick={() => setUniverse(u.id)}
          >
            {u.label}
          </Button>
        ))}
      </div>
      <p className="mt-2 text-xs text-subtle">
        {UNIVERSES.find((u) => u.id === universe)?.hint}
      </p>

      <p className="mt-3 rounded-md bg-elevated px-3 py-2 text-sm text-fg">
        {on
          ? lastNote || "ON. Waiting for the next desk refresh."
          : "OFF. Not buying YES or NO."}
      </p>

      {openBot.length > 0 ? (
        <ol className="mt-3 divide-y divide-border rounded-md bg-elevated">
          {openBot.slice(0, 6).map((lot) => (
            <li key={lot.id} className="flex items-center justify-between gap-3 px-3 py-2 text-sm">
              <span className="min-w-0 truncate">
                <span className={lot.side === "yes" ? "text-yes" : "text-no"}>
                  Bought {lot.side.toUpperCase()}
                </span>
                <span className="text-muted"> · {lot.contracts} × {lot.title} @ {pct(lot.fillPrice, 0)}</span>
              </span>
              <Link to="/blotter" className="shrink-0 text-xs text-subtle hover:text-fg">
                open
              </Link>
            </li>
          ))}
        </ol>
      ) : lastFills.length > 0 ? (
        <p className="mt-3 text-xs text-muted">{describeFill(lastFills[0]!)} — last fill</p>
      ) : null}

      <div className="mt-4 flex flex-wrap items-end gap-x-6 gap-y-2 border-t border-border pt-3">
        <Link to="/blotter" className="block">
          <p className="text-[11px] tracking-wide text-subtle uppercase">Bot P&L</p>
          <p
            className={cn(
              "font-mono text-lg tabular-nums",
              pnl > 0 ? "text-yes" : pnl < 0 ? "text-no" : "text-fg",
            )}
          >
            {usd(pnl)}
          </p>
        </Link>
        <div>
          <p className="text-[11px] tracking-wide text-subtle uppercase">Open</p>
          <p className="font-mono text-lg tabular-nums">{totals.openCount}</p>
        </div>
        <div>
          <p className="text-[11px] tracking-wide text-subtle uppercase">Fills</p>
          <p className="font-mono text-lg tabular-nums">{botLots.length}</p>
        </div>
      </div>
    </section>
  );
}

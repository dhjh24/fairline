import { Link } from "@tanstack/react-router";
import { useMemo } from "react";
import { Button } from "@/components/ui/button";
import { blotterTotals, useBlotter } from "@/lib/blotter";
import { useBot, type BotUniverse } from "@/lib/bot";
import { usd } from "@/lib/format";
import { cn } from "@/lib/utils";

const UNIVERSES: { id: BotUniverse; label: string; hint: string }[] = [
  { id: "fifteen", label: "15-minute", hint: "BTC and ETH prints only" },
  { id: "fast", label: "Fast", hint: "Signals closing within 6 hours" },
  { id: "signals", label: "All signals", hint: "Every Buy YES / Buy NO on the desk" },
];

export function BotBar() {
  const on = useBot((s) => s.on);
  const universe = useBot((s) => s.universe);
  const lastNote = useBot((s) => s.lastNote);
  const sessionFills = useBot((s) => s.sessionFills);
  const setOn = useBot((s) => s.setOn);
  const setUniverse = useBot((s) => s.setUniverse);
  const lots = useBlotter((s) => s.lots);
  const marks = useBlotter((s) => s.marks);

  const botLots = useMemo(
    () => lots.filter((l) => l.source === "bot" && l.closeReason !== "void"),
    [lots],
  );
  const totals = useMemo(() => blotterTotals(botLots, marks), [botLots, marks]);
  const pnl = totals.realized + totals.unrealizedMarket;

  return (
    <section className="rounded-xl bg-surface px-4 py-4 shadow-[var(--shadow-border)] md:px-5">
      <div className="flex flex-col gap-3 md:flex-row md:items-start md:justify-between">
        <div>
          <div className="flex items-center gap-2">
            <p className="text-xs font-medium tracking-wide text-subtle uppercase">Paper bot</p>
            {on ? <span className="live-dot size-1.5 rounded-full bg-yes" /> : null}
          </div>
          <p className="mt-1 text-sm text-muted">
            Takes Fairline signals at the touch. Half-Kelly, paper cash only. Settles when
            Kalshi does.
          </p>
        </div>
        <Button type="button" size="sm" variant={on ? "yes" : "secondary"} onClick={() => setOn(!on)}>
          {on ? "Running" : "Start bot"}
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
          <p className="font-mono text-lg tabular-nums">{sessionFills || botLots.length}</p>
        </div>
        <p className="min-w-0 flex-1 text-xs text-muted md:text-right">
          {lastNote || "Off until you start it. Nothing is sent to Kalshi."}
        </p>
      </div>
    </section>
  );
}

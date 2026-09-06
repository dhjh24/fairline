import { Link } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { SignalBadge } from "@/components/signal-badge";
import { clockRemain, compact, pct, relativeClose, usdTarget } from "@/lib/format";
import type { CryptoFifteen } from "@/lib/types";
import { cn } from "@/lib/utils";

export function Crypto15Card({ print }: { print: CryptoFifteen }) {
  const [now, setNow] = useState<number | null>(null);
  useEffect(() => {
    setNow(Date.now());
    const id = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(id);
  }, []);
  const remain = now === null ? relativeClose(print.closeTime) : clockRemain(print.closeTime, now);
  const gap = print.fair - print.mid;
  const up = print.mid >= 0.5;

  return (
    <Link
      to="/market/$ticker"
      params={{ ticker: print.ticker }}
      className="block rounded-xl bg-surface px-4 py-4 shadow-[var(--shadow-border)] transition-colors duration-150 hover:bg-elevated md:px-5"
    >
      <div className="flex items-start justify-between gap-3">
        <div>
          <p className="text-xs font-medium tracking-wide text-subtle uppercase">{print.name}</p>
          <p className="mt-1 font-mono text-2xl font-medium tracking-tight tabular-nums md:text-3xl">
            {usdTarget(print.target)}
          </p>
          <p className="mt-1 text-xs text-muted">
            YES if the next 15 minutes finish at or above this print
          </p>
        </div>
        <div className="text-right">
          <p className="font-mono text-lg tabular-nums text-fg">{remain}</p>
          <p className="mt-1 text-xs text-subtle">to settle</p>
        </div>
      </div>

      <div className="mt-4 flex flex-wrap items-center gap-3 border-t border-border pt-3">
        <span className={cn("text-sm font-medium", up ? "text-yes" : "text-no")}>
          {up ? "Up" : "Down"}
        </span>
        <span className="text-sm tabular-nums text-muted">
          {pct(print.mid, 0)}
          <span className="text-subtle"> → </span>
          <span className="text-fg">{pct(print.fair, 0)}</span>
        </span>
        <span className={cn("text-sm tabular-nums", gap >= 0 ? "text-yes" : "text-no")}>
          {gap >= 0 ? "+" : ""}
          {(gap * 100).toFixed(1)}¢
        </span>
        <span className="text-xs text-subtle tabular-nums">{compact(print.volume24h)} 24h</span>
        <span className="ml-auto">
          <SignalBadge signal={print.signal} />
        </span>
      </div>
    </Link>
  );
}

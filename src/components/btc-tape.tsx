import { Link } from "@tanstack/react-router";
import { SignalBadge } from "@/components/signal-badge";
import { compact, pct, relativeClose, usdPrice } from "@/lib/format";
import type { BtcTape } from "@/lib/types";
import { cn } from "@/lib/utils";

export function BtcTapeCard({ tape }: { tape: BtcTape }) {
  return (
    <section className="rounded-xl bg-surface px-4 py-4 shadow-[var(--shadow-border)] md:px-5">
      <div className="flex flex-col gap-4 md:flex-row md:items-end md:justify-between">
        <div>
          <p className="text-xs font-medium tracking-wide text-subtle uppercase">Bitcoin</p>
          <p className="mt-1 font-mono text-3xl font-medium tracking-tight tabular-nums md:text-4xl">
            {usdPrice(tape.implied)}
          </p>
          <p className="mt-1 text-xs text-muted">
            Implied from the live above/below ladder · settles {relativeClose(tape.closeTime)}
          </p>
        </div>
        <p className="max-w-sm text-xs text-subtle md:text-right">{tape.eventTitle}</p>
      </div>

      <ol className="mt-4 divide-y divide-border border-t border-border">
        {tape.rungs.map((r) => {
          const gap = r.fair - r.mid;
          return (
            <li key={r.ticker}>
              <Link
                to="/market/$ticker"
                params={{ ticker: r.ticker }}
                className="flex items-center gap-3 py-2.5 transition-colors duration-150 hover:bg-elevated md:grid md:grid-cols-12 md:gap-2"
              >
                <span className="min-w-0 flex-1 font-medium md:col-span-4">
                  {r.label}
                </span>
                <span className="hidden text-xs text-subtle md:col-span-2 md:block">
                  {compact(r.volume24h)} 24h
                </span>
                <span className="text-sm tabular-nums text-muted md:col-span-2 md:text-right">
                  {pct(r.mid, 0)}
                  <span className="text-subtle"> → </span>
                  <span className="text-fg">{pct(r.fair, 0)}</span>
                </span>
                <span
                  className={cn(
                    "hidden text-sm tabular-nums md:col-span-2 md:block md:text-right",
                    gap >= 0 ? "text-yes" : "text-no",
                  )}
                >
                  {gap >= 0 ? "+" : ""}
                  {(gap * 100).toFixed(1)}¢
                </span>
                <span className="md:col-span-2 md:flex md:justify-end">
                  <SignalBadge signal={r.signal} />
                </span>
              </Link>
            </li>
          );
        })}
      </ol>
    </section>
  );
}

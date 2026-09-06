import type { OrderBook } from "@/lib/types";
import { compact, pct } from "@/lib/format";
import { cn } from "@/lib/utils";

export function OrderBookView({ book }: { book: OrderBook }) {
  const max = Math.max(
    ...book.bids.map((l) => l.cumulative),
    ...book.asks.map((l) => l.cumulative),
    1,
  );
  const rows = Math.max(book.bids.length, book.asks.length, 1);

  return (
    <div>
      <div className="mb-3 flex items-center justify-between text-xs text-muted">
        <span>YES bids</span>
        <span>
          Imbalance {book.imbalance >= 0 ? "+" : ""}
          {(book.imbalance * 100).toFixed(0)}%
        </span>
        <span>YES asks</span>
      </div>
      <div className="grid grid-cols-2 gap-3 text-xs">
        <div>
          {Array.from({ length: Math.min(rows, 10) }).map((_, i) => {
            const l = book.bids[i];
            if (!l) return <div key={`b-${i}`} className="h-7" />;
            return (
              <div key={`b-${l.price}-${i}`} className="relative h-7">
                <div
                  className="absolute inset-y-0 right-0 bg-yes-dim"
                  style={{ width: `${(l.cumulative / max) * 100}%` }}
                />
                <div className="relative flex h-7 items-center justify-between px-2 tabular-nums">
                  <span className="text-yes">{pct(l.price, 1)}</span>
                  <span className="text-muted">{compact(l.size)}</span>
                </div>
              </div>
            );
          })}
        </div>
        <div>
          {Array.from({ length: Math.min(rows, 10) }).map((_, i) => {
            const l = book.asks[i];
            if (!l) return <div key={`a-${i}`} className="h-7" />;
            return (
              <div key={`a-${l.price}-${i}`} className="relative h-7">
                <div
                  className="absolute inset-y-0 left-0 bg-no-dim"
                  style={{ width: `${(l.cumulative / max) * 100}%` }}
                />
                <div className="relative flex h-7 items-center justify-between px-2 tabular-nums">
                  <span className={cn("text-no")}>{pct(l.price, 1)}</span>
                  <span className="text-muted">{compact(l.size)}</span>
                </div>
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}

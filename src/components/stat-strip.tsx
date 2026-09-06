import { compact, pct } from "@/lib/format";
import type { DeskStats } from "@/lib/types";

export function StatStrip({ stats, asOf }: { stats: DeskStats; asOf: string }) {
  const items = [
    { label: "Scanned", value: compact(stats.scanned) },
    { label: "On desk", value: String(stats.returned) },
    { label: "Signals", value: String(stats.edges) },
    { label: "Buy YES", value: String(stats.yes) },
    { label: "Buy NO", value: String(stats.no) },
    { label: "Median gap", value: pct(stats.medianAbsEdge, 1) },
    { label: "24h volume", value: compact(stats.volume24h) },
  ];

  return (
    <section className="grid grid-cols-2 gap-2 sm:grid-cols-4 lg:grid-cols-7">
      {items.map((item) => (
        <div
          key={item.label}
          className="rounded-lg bg-surface px-3 py-3 shadow-[var(--shadow-border)]"
        >
          <p className="text-xs text-muted">{item.label}</p>
          <p className="mt-1 text-lg font-medium tabular-nums tracking-tight">{item.value}</p>
        </div>
      ))}
      <p className="col-span-full text-xs text-subtle">
        Snapshot {new Date(asOf).toLocaleTimeString()} · refreshed about every 45s
      </p>
    </section>
  );
}

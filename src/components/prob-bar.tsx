import { cn } from "@/lib/utils";

export function ProbBar({
  mid,
  fair,
  bid,
  ask,
  className,
}: {
  mid: number;
  fair: number;
  bid?: number;
  ask?: number;
  className?: string;
}) {
  const midPct = Math.min(100, Math.max(0, mid * 100));
  const fairPct = Math.min(100, Math.max(0, fair * 100));
  const bidPct = bid != null ? Math.min(100, Math.max(0, bid * 100)) : midPct;
  const askPct = ask != null ? Math.min(100, Math.max(0, ask * 100)) : midPct;
  const left = Math.min(bidPct, askPct);
  const width = Math.max(1.5, Math.abs(askPct - bidPct));
  const up = fair >= mid;

  return (
    <div className={cn("relative h-2 w-full rounded-full bg-elevated", className)}>
      <div
        className="absolute inset-y-0 rounded-full bg-border"
        style={{ left: `${left}%`, width: `${width}%` }}
      />
      <div
        className="absolute top-1/2 size-2 -translate-x-1/2 -translate-y-1/2 rounded-full bg-muted"
        style={{ left: `${midPct}%` }}
        title="Market"
      />
      <div
        className={cn(
          "absolute top-1/2 size-2.5 -translate-x-1/2 -translate-y-1/2 rounded-full",
          up ? "bg-yes" : "bg-no",
        )}
        style={{ left: `${fairPct}%` }}
        title="Fair"
      />
    </div>
  );
}

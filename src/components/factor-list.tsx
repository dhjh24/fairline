import type { Factor } from "@/lib/types";
import { pp } from "@/lib/format";
import { cn } from "@/lib/utils";

export function FactorList({ factors }: { factors: Factor[] }) {
  return (
    <ul className="flex flex-col gap-3">
      {factors.map((f) => {
        const pos = f.delta >= 0;
        const width = Math.min(100, Math.abs(f.delta) * 100 * 8);
        return (
          <li key={f.id}>
            <div className="flex items-baseline justify-between gap-3">
              <p className="text-sm text-fg">{f.label}</p>
              <p className={cn("text-sm tabular-nums", pos ? "text-yes" : "text-no")}>
                {pp(f.delta)}
              </p>
            </div>
            <div className="mt-1 h-1 rounded-full bg-elevated">
              <div
                className={cn("h-1 rounded-full", pos ? "bg-yes" : "bg-no")}
                style={{ width: `${Math.max(4, width)}%` }}
              />
            </div>
            <p className="mt-1 text-xs text-muted">{f.detail}</p>
          </li>
        );
      })}
    </ul>
  );
}

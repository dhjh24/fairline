import { useMutation } from "@tanstack/react-query";
import { Cpu } from "lucide-react";
import { Button } from "@/components/ui/button";
import { runGrokForecast } from "@/lib/desk-fn";
import { pct } from "@/lib/format";
import type { GrokForecast, MarketDetail } from "@/lib/types";
import { cn } from "@/lib/utils";

export function GrokPanel({
  detail,
  onForecast,
}: {
  detail: MarketDetail;
  onForecast: (g: Extract<GrokForecast, { ok: true }>) => void;
}) {
  const m = detail.market;
  const mut = useMutation({
    mutationFn: () =>
      runGrokForecast({
        data: {
          ticker: m.ticker,
          title: m.title,
          eventTitle: m.eventTitle,
          category: m.category,
          closeTime: m.closeTime,
          bid: m.bid,
          ask: m.ask,
          last: m.last,
          fair: m.fair,
          fieldSize: m.fieldSize,
          fieldSum: m.fieldSum,
          rules: detail.rules,
        },
      }),
    onSuccess: (res) => {
      if (res.ok) onForecast(res);
    },
  });

  const res = mut.data;

  return (
    <div className="flex flex-col gap-3">
      <div className="flex items-start justify-between gap-3">
        <div>
          <h3 className="text-sm font-medium">Grok overlay</h3>
          <p className="mt-1 text-xs text-muted">
            Optional. Runs once when you ask, then blends with the statistical book.
          </p>
        </div>
        <Button
          size="sm"
          variant="secondary"
          onClick={() => mut.mutate()}
          disabled={mut.isPending}
        >
          <Cpu className="size-3.5" />
          {mut.isPending ? "Forecasting…" : "Run Grok"}
        </Button>
      </div>

      {mut.isPending ? (
        <p className="text-sm text-muted">Reading the contract and writing a forecast…</p>
      ) : null}

      {res && !res.ok ? <p className="text-sm text-no">{res.error}</p> : null}

      {res && res.ok ? (
        <div className="flex flex-col gap-3">
          <div className="grid grid-cols-3 gap-3">
            <Stat label="Grok" value={pct(res.probability)} />
            <Stat label="Confidence" value={pct(res.confidence, 0)} />
            <Stat label="Blend" value={pct(res.blended)} />
          </div>
          <p className="text-sm leading-relaxed text-muted">{res.thesis}</p>
          {res.factors.length > 0 ? (
            <ul className="flex flex-col gap-1.5">
              {res.factors.map((f) => (
                <li key={f.name} className="text-xs text-muted">
                  <span className={cn(f.direction === "up" ? "text-yes" : "text-no")}>
                    {f.direction === "up" ? "Up" : "Down"}
                  </span>
                  {" · "}
                  <span className="text-fg">{f.name}</span>
                  {f.note ? ` — ${f.note}` : ""}
                </li>
              ))}
            </ul>
          ) : null}
          {res.risks.length > 0 ? (
            <p className="text-xs text-subtle">Risks: {res.risks.join(" · ")}</p>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-md bg-elevated px-3 py-2">
      <p className="text-xs text-muted">{label}</p>
      <p className="mt-0.5 text-sm font-medium tabular-nums">{value}</p>
    </div>
  );
}

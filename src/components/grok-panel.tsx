import { useMutation } from "@tanstack/react-query";
import { Cpu } from "lucide-react";
import { ProviderPicker } from "@/components/provider-picker";
import { Button } from "@/components/ui/button";
import { runGrokForecast } from "@/lib/desk-fn";
import { useForecasts } from "@/lib/forecasts";
import { pct } from "@/lib/format";
import { getProvider } from "@/lib/llm-providers";
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
  const providerId = useForecasts((s) => s.providerId);
  const setProvider = useForecasts((s) => s.setProvider);
  const cached = useForecasts((s) => s.byTicker[m.ticker]);
  const put = useForecasts((s) => s.put);
  const provider = getProvider(providerId);

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
          providerId,
        },
      }),
    onSuccess: (res) => {
      if (res.ok) {
        put({
          ticker: m.ticker,
          providerId: res.providerId ?? providerId,
          model: res.model ?? provider.model,
          at: new Date().toISOString(),
          fairAtRun: m.fair,
          midAtRun: m.mid,
          probability: res.probability,
          confidence: res.confidence,
          blended: res.blended,
          thesis: res.thesis,
          factors: res.factors,
          risks: res.risks,
        });
        onForecast(res);
      }
    },
  });

  const live = mut.data;
  const shown =
    live && live.ok
      ? live
      : cached
        ? {
            ok: true as const,
            probability: cached.probability,
            confidence: cached.confidence,
            thesis: cached.thesis,
            factors: cached.factors,
            risks: cached.risks,
            blended: cached.blended,
            providerId: cached.providerId,
            model: cached.model,
          }
        : null;

  return (
    <div className="flex flex-col gap-3">
      <div className="flex items-start justify-between gap-3">
        <div>
          <h3 className="text-sm font-medium">Model overlay</h3>
          <p className="mt-1 text-xs text-muted">
            Optional. Pick a Grok model, then run once. Batch results from the desk
            land here too.
          </p>
        </div>
        <Button
          size="sm"
          variant="secondary"
          onClick={() => mut.mutate()}
          disabled={mut.isPending}
        >
          <Cpu className="size-3.5" />
          {mut.isPending ? "Forecasting…" : shown ? "Re-run" : `Run ${provider.label}`}
        </Button>
      </div>

      <ProviderPicker value={providerId} onChange={setProvider} disabled={mut.isPending} />

      {mut.isPending ? (
        <p className="text-sm text-muted">Reading the contract and writing a forecast…</p>
      ) : null}

      {live && !live.ok ? <p className="text-sm text-no">{live.error}</p> : null}

      {shown && shown.ok ? (
        <div className="flex flex-col gap-3">
          <div className="grid grid-cols-3 gap-3">
            <Stat label={getProvider(shown.providerId).label} value={pct(shown.probability)} />
            <Stat label="Confidence" value={pct(shown.confidence, 0)} />
            <Stat label="Blend" value={pct(shown.blended)} />
          </div>
          <p className="text-sm leading-relaxed text-muted">{shown.thesis}</p>
          {shown.factors.length > 0 ? (
            <ul className="flex flex-col gap-1.5">
              {shown.factors.map((f) => (
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
          {shown.risks.length > 0 ? (
            <p className="text-xs text-subtle">Risks: {shown.risks.join(" · ")}</p>
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

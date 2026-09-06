import { Cpu } from "lucide-react";
import { useMemo, useState } from "react";
import { ProviderPicker } from "@/components/provider-picker";
import { Button } from "@/components/ui/button";
import { runGrokForecast } from "@/lib/desk-fn";
import { useForecasts } from "@/lib/forecasts";
import { BATCH_SIZE, getProvider } from "@/lib/llm-providers";
import type { DeskMarket } from "@/lib/types";

export function ForecastBar({ markets }: { markets: DeskMarket[] }) {
  const providerId = useForecasts((s) => s.providerId);
  const setProvider = useForecasts((s) => s.setProvider);
  const byTicker = useForecasts((s) => s.byTicker);
  const running = useForecasts((s) => s.running);
  const put = useForecasts((s) => s.put);
  const setRunning = useForecasts((s) => s.setRunning);
  const error = useForecasts((s) => s.error);
  const setError = useForecasts((s) => s.setError);
  const [done, setDone] = useState(0);
  const [total, setTotal] = useState(0);

  const provider = getProvider(providerId);
  const busy = running.length > 0;

  const queue = useMemo(() => {
    const top = markets.slice(0, BATCH_SIZE);
    const missing = top.filter((m) => {
      const hit = byTicker[m.ticker];
      return !hit || hit.providerId !== providerId;
    });
    return missing.length ? missing : top;
  }, [markets, byTicker, providerId]);

  const covered = markets
    .slice(0, BATCH_SIZE)
    .filter((m) => byTicker[m.ticker]?.providerId === providerId).length;

  async function run() {
    const jobs = queue.slice(0, BATCH_SIZE);
    if (jobs.length === 0) return;
    setError(null);
    setDone(0);
    setTotal(jobs.length);
    setRunning(jobs.map((m) => m.ticker));
    let next = 0;
    let finished = 0;
    const inflight = new Set(jobs.map((m) => m.ticker));
    const worker = async () => {
      while (next < jobs.length) {
        const idx = next++;
        const m = jobs[idx]!;
        const res = await runGrokForecast({
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
            rules: "",
            providerId,
          },
        });
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
        } else {
          setError(res.error);
        }
        inflight.delete(m.ticker);
        finished += 1;
        setDone(finished);
        setRunning([...inflight]);
      }
    };
    await Promise.all(Array.from({ length: Math.min(2, jobs.length) }, () => worker()));
    setRunning([]);
  }

  return (
    <div className="flex flex-col gap-3 rounded-xl bg-surface px-4 py-4 shadow-[var(--shadow-border)] md:px-5">
      <div className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
        <div>
          <h2 className="text-sm font-medium">Batch forecast</h2>
          <p className="mt-1 text-xs text-muted">
            Runs {BATCH_SIZE} of the ranked books on the selected model. Cached for
            twelve minutes. Does not auto-run.
          </p>
        </div>
        <Button type="button" size="sm" onClick={() => void run()} disabled={busy || markets.length === 0}>
          <Cpu className="size-3.5" />
          {busy
            ? `Forecasting ${done}/${total}`
            : covered >= Math.min(BATCH_SIZE, markets.length) && covered > 0
              ? "Re-run top 8"
              : "Forecast top 8"}
        </Button>
      </div>
      <ProviderPicker value={providerId} onChange={setProvider} disabled={busy} />
      {error ? <p className="text-xs text-no">{error}</p> : null}
      {!busy && covered > 0 ? (
        <p className="text-xs text-subtle tabular-nums">
          {covered} of {Math.min(BATCH_SIZE, markets.length)} on {provider.label}
        </p>
      ) : null}
    </div>
  );
}

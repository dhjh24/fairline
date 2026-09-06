import { Link } from "@tanstack/react-router";
import { ArrowUpRight } from "lucide-react";
import { useEffect, useState } from "react";
import { FactorList } from "@/components/factor-list";
import { GrokPanel } from "@/components/grok-panel";
import { OrderBookView } from "@/components/order-book";
import { PositionSizer } from "@/components/position-sizer";
import { PriceChart } from "@/components/price-chart";
import { ProbBar } from "@/components/prob-bar";
import { SignalBadge } from "@/components/signal-badge";
import { StarButton } from "@/components/star-button";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { useBlotter } from "@/lib/blotter";
import { compact, formatClose, pct, pp, relativeClose, signedCents } from "@/lib/format";
import { kalshiMarketUrl } from "@/lib/kalshi";
import type { GrokForecast, MarketDetail } from "@/lib/types";
import { cn } from "@/lib/utils";

export function MarketDetailView({
  data,
  loading,
  error,
  onRetry,
}: {
  data?: MarketDetail;
  loading: boolean;
  error?: string;
  onRetry: () => void;
}) {
  const [grok, setGrok] = useState<Extract<GrokForecast, { ok: true }> | null>(null);
  const applyMarks = useBlotter((s) => s.applyMarks);

  useEffect(() => {
    if (!data) return;
    applyMarks([
      { ticker: data.market.ticker, mid: data.market.mid, fair: data.market.fair },
    ]);
  }, [data, applyMarks]);

  if (loading && !data) {
    return (
      <div className="flex flex-col gap-4">
        <Skeleton className="h-8 w-40" />
        <Skeleton className="h-24 w-full rounded-xl" />
        <Skeleton className="h-64 w-full rounded-xl" />
      </div>
    );
  }

  if (error && !data) {
    return (
      <div className="rounded-xl bg-surface px-6 py-10 text-center shadow-[var(--shadow-border)]">
        <p className="text-sm text-muted">{error}</p>
        <Button className="mt-4" onClick={onRetry}>
          Retry
        </Button>
      </div>
    );
  }

  if (!data) return null;

  const m = data.market;
  const fair = grok?.blended ?? m.fair;
  const gap = fair - m.mid;
  const kalshiUrl = kalshiMarketUrl(m.seriesTicker, m.eventTicker);

  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-wrap items-center gap-3 text-sm text-muted">
        <Link to="/" className="hover:text-fg">
          Desk
        </Link>
        <span className="text-subtle">/</span>
        <span className="text-fg">{m.ticker}</span>
      </div>

      <div className="flex flex-col gap-4 md:flex-row md:items-start md:justify-between">
        <div className="min-w-0">
          <div className="mb-2 flex flex-wrap items-center gap-2">
            <SignalBadge signal={m.signal} />
            <span className="text-xs text-subtle">{m.category}</span>
            <span className="text-xs text-subtle">Closes {relativeClose(m.closeTime)}</span>
          </div>
          <h1 className="text-2xl font-medium tracking-tight md:text-3xl">{m.title}</h1>
          <p className="mt-1 text-sm text-muted">{m.eventTitle}</p>
        </div>
        <div className="flex items-center gap-2">
          <StarButton ticker={m.ticker} />
          <Button variant="secondary" size="sm" asChild>
            <a href={kalshiUrl} target="_blank" rel="noreferrer">
              Open on Kalshi
              <ArrowUpRight className="size-3.5" />
            </a>
          </Button>
        </div>
      </div>

      <section className="grid gap-3 md:grid-cols-4">
        <HeroStat label="Market mid" value={pct(m.mid)} hint={`${pct(m.bid)} / ${pct(m.ask)}`} />
        <HeroStat
          label={grok ? "Blended fair" : "Fairline"}
          value={pct(fair)}
          hint={grok ? `Stat ${pct(m.fair)} · Grok ${pct(grok.probability)}` : "Statistical book"}
          accent
        />
        <HeroStat
          label="Gap"
          value={pp(gap)}
          hint={gap >= 0 ? "Model above market" : "Model below market"}
          tone={gap >= 0 ? "yes" : "no"}
        />
        <HeroStat
          label="EV at touch"
          value={m.signal === "no" ? signedCents(m.evNo) : signedCents(m.evYes)}
          hint={m.signal === "no" ? "Buying NO at the bid" : "Buying YES at the ask"}
        />
      </section>

      <div className="rounded-xl bg-surface p-4 shadow-[var(--shadow-border)] md:p-5">
        <ProbBar mid={m.mid} fair={fair} bid={m.bid} ask={m.ask} className="h-2.5" />
        <div className="mt-2 flex justify-between text-xs text-subtle">
          <span>0%</span>
          <span>Market {pct(m.mid, 1)}</span>
          <span>Fair {pct(fair, 1)}</span>
          <span>100%</span>
        </div>
      </div>

      <div className="grid gap-4 lg:grid-cols-5">
        <section className="rounded-xl bg-surface p-4 shadow-[var(--shadow-border)] lg:col-span-3 md:p-5">
          <h2 className="mb-3 text-sm font-medium">Price</h2>
          <PriceChart candles={data.candles} />
        </section>
        <section className="rounded-xl bg-surface p-4 shadow-[var(--shadow-border)] lg:col-span-2 md:p-5">
          <h2 className="mb-3 text-sm font-medium">Model factors</h2>
          <FactorList factors={m.factors} />
        </section>
      </div>

      <div className="grid gap-4 lg:grid-cols-2">
        <section className="rounded-xl bg-surface p-4 shadow-[var(--shadow-border)] md:p-5">
          <h2 className="mb-3 text-sm font-medium">Order book</h2>
          <OrderBookView book={data.book} />
        </section>
        <section className="rounded-xl bg-surface p-4 shadow-[var(--shadow-border)] md:p-5">
          <h2 className="mb-3 text-sm font-medium">Position</h2>
          <PositionSizer market={m} fair={fair} />
        </section>
      </div>

      <section className="rounded-xl bg-surface p-4 shadow-[var(--shadow-border)] md:p-5">
        <GrokPanel
          detail={data}
          onForecast={(g) => {
            setGrok(g);
          }}
        />
      </section>

      {data.siblings.length > 0 ? (
        <section className="rounded-xl bg-surface p-4 shadow-[var(--shadow-border)] md:p-5">
          <h2 className="mb-3 text-sm font-medium">Same event</h2>
          <ul className="flex flex-col">
            {data.siblings.map((s) => (
              <li key={s.ticker} className="border-b border-border last:border-0">
                <Link
                  to="/market/$ticker"
                  params={{ ticker: s.ticker }}
                  className="flex items-center justify-between gap-3 py-2.5 text-sm hover:text-fg"
                >
                  <span className="min-w-0 truncate text-muted">{s.title}</span>
                  <span className="shrink-0 tabular-nums text-fg">
                    {pct(s.mid)} → {pct(s.fair)}
                  </span>
                </Link>
              </li>
            ))}
          </ul>
        </section>
      ) : null}

      <section className="grid gap-3 sm:grid-cols-4">
        <Mini label="24h volume" value={compact(m.volume24h)} />
        <Mini label="Open interest" value={compact(m.openInterest)} />
        <Mini label="Confidence" value={pct(m.confidence, 0)} />
        <Mini label="Closes" value={formatClose(m.closeTime)} />
      </section>

      {data.rules ? (
        <section className="rounded-xl bg-surface p-4 shadow-[var(--shadow-border)] md:p-5">
          <h2 className="mb-2 text-sm font-medium">Settlement</h2>
          <p className="text-sm leading-relaxed text-muted whitespace-pre-wrap">
            {data.rules}
          </p>
        </section>
      ) : null}
    </div>
  );
}

function HeroStat({
  label,
  value,
  hint,
  accent,
  tone,
}: {
  label: string;
  value: string;
  hint?: string;
  accent?: boolean;
  tone?: "yes" | "no";
}) {
  return (
    <div className="rounded-xl bg-surface px-4 py-4 shadow-[var(--shadow-border)]">
      <p className="text-xs text-muted">{label}</p>
      <p
        className={cn(
          "mt-1 text-2xl font-medium tracking-tight tabular-nums",
          accent && "text-fg",
          tone === "yes" && "text-yes",
          tone === "no" && "text-no",
        )}
      >
        {value}
      </p>
      {hint ? <p className="mt-1 text-xs text-subtle">{hint}</p> : null}
    </div>
  );
}

function Mini({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-lg bg-surface px-3 py-3 shadow-[var(--shadow-border)]">
      <p className="text-xs text-muted">{label}</p>
      <p className="mt-1 text-sm tabular-nums">{value}</p>
    </div>
  );
}

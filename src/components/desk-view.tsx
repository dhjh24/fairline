import { Search } from "lucide-react";
import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { BotBar } from "@/components/bot-bar";
import { Crypto15Card } from "@/components/crypto-15";
import { CryptoTapeCard } from "@/components/crypto-tape";
import { DeskList } from "@/components/desk-list";
import { ForecastBar } from "@/components/forecast-bar";
import { StatStrip } from "@/components/stat-strip";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import { isBitcoinSeries, isEthereumSeries, isGoldSeries, isHourlyLadder } from "@/lib/crypto";
import { useBlotter } from "@/lib/blotter";
import { useBot } from "@/lib/bot";
import { evaluateBotRound } from "@/lib/decisions";
import { collectDeskSnaps, useCalibration } from "@/lib/calibration";
import { useForecasts } from "@/lib/forecasts";
import type { DeskMarket, DeskResponse } from "@/lib/types";
import { useWatchlist } from "@/lib/watchlist";
import { cn } from "@/lib/utils";

type View = "opportunities" | "all" | "watch" | "btc" | "eth" | "gold";
type SortKey = "score" | "edge" | "volume" | "close" | "quality";

const VIEWS: { id: View; label: string }[] = [
  { id: "opportunities", label: "Opportunities" },
  { id: "btc", label: "Bitcoin" },
  { id: "eth", label: "Ethereum" },
  { id: "gold", label: "Gold" },
  { id: "all", label: "All books" },
  { id: "watch", label: "Watchlist" },
];

const SORTS: { id: SortKey; label: string }[] = [
  { id: "score", label: "Score" },
  { id: "edge", label: "Net edge" },
  { id: "volume", label: "Volume" },
  { id: "close", label: "Close" },
  { id: "quality", label: "Quote" },
];

export function DeskView({
  data,
  loading,
  error,
  onRetry,
}: {
  data?: DeskResponse;
  loading: boolean;
  error?: string;
  onRetry: () => void;
}) {
  const [view, setView] = useState<View>("opportunities");
  const [sort, setSort] = useState<SortKey>("score");
  const [cat, setCat] = useState<string>("All");
  const [q, setQ] = useState("");
  const watch = useWatchlist((s) => s.tickers);
  const applyMarks = useBlotter((s) => s.applyMarks);
  const lots = useBlotter((s) => s.lots);
  const openLot = useBlotter((s) => s.openLot);
  const botOn = useBot((s) => s.on);
  const botUniverse = useBot((s) => s.universe);
  const botHydrated = useBot((s) => s.hydrated);
  const recordEval = useBot((s) => s.recordEval);
  const botFilled = useBot((s) => s.filled);
  const botError = useBot((s) => s.error);
  const clearBotError = useBot((s) => s.clearError);
  const capture = useCalibration((s) => s.capture);
  const grokByTicker = useForecasts((s) => s.byTicker);
  const [showLadders, setShowLadders] = useState(false);
  const lastEvalQuoteRef = useRef<string>("");
  const errorNotifiedRef = useRef(false);

  useEffect(() => {
    if (!data) return;
    applyMarks(
      data.markets.map((m) => ({
        ticker: m.ticker,
        mid: m.mid,
        fair: m.fair,
        bid: m.bid,
        ask: m.ask,
        last: m.last,
        asOf: m.quoteAt ?? data.asOf,
      })),
    );
  }, [data, applyMarks]);

  useEffect(() => {
    if (!data) return;
    capture(
      collectDeskSnaps(
        data,
        watch,
        lots.filter((l) => l.status === "open").map((l) => l.ticker),
        grokByTicker,
      ),
    );
  }, [data, watch, lots, capture, grokByTicker]);

  // Bot engine: evaluate once per fresh desk quote (not on every lots churn),
  // then execute the eligible decisions. Execution is idempotent because the
  // blotter updates synchronously and gates re-check already-open tickers.
  useEffect(() => {
    if (!data || !botOn || !botHydrated) return;
    const quoteAt = data.asOf;
    const isNewQuote = quoteAt !== lastEvalQuoteRef.current;
    if (!isNewQuote) return;

    const round = evaluateBotRound({
      markets: data.markets,
      lots,
      universe: botUniverse,
      quoteAt,
    });

    lastEvalQuoteRef.current = quoteAt;
    if (round.pausedReason) {
      recordEval({
        phase: "PAUSED",
        note: round.note,
        reason: round.pausedReason,
        decisions: [],
        eligibleCount: 0,
      });
      return;
    }

    const fills: { ticker: string; title: string; side: "yes" | "no"; contracts: number; fillPrice: number; at: string }[] = [];
    const failures: string[] = [];
    for (const d of round.eligible) {
      const res = openLot({
        ticker: d.ticker,
        eventTicker: d.eventTicker,
        seriesTicker: d.seriesTicker,
        title: d.title,
        eventTitle: d.eventTitle,
        category: d.category,
        closeTime: d.closeTime,
        side: d.side ?? "yes",
        contracts: d.contracts ?? 1,
        fillPrice: d.execPrice ?? 0.5,
        fairAtEntry: d.fair,
        midAtEntry: d.mid,
        source: "bot",
      });
      if (res.ok) {
        fills.push({
          ticker: d.ticker,
          title: d.title,
          side: d.side ?? "yes",
          contracts: d.contracts ?? 1,
          fillPrice: d.execPrice ?? 0.5,
          at: new Date().toISOString(),
        });
      } else {
        failures.push(res.error);
      }
    }

    if (fills.length > 0) {
      botFilled(fills);
      recordEval({
        phase: fills.length > 0 && round.eligible.length === fills.length ? "PAPER FILLED" : round.phase,
        note: `PAPER FILLED · ${fills.length} ticket${fills.length === 1 ? "" : "s"}`,
        decisions: fills.map((f) => ({
          id: `fill-${f.ticker}-${f.at}`,
          at: f.at,
          ticker: f.ticker,
          title: f.title,
          phase: "PAPER FILLED" as const,
          side: f.side,
          contracts: f.contracts,
          reason: `Bought ${f.side.toUpperCase()} · ${f.contracts} contracts`,
        })),
        eligibleCount: fills.length,
      });
    } else if (failures.length > 0) {
      recordEval({
        phase: "PAUSED",
        note: `HOLD · ${failures[0]}`,
        reason: failures[0],
        decisions: round.decisions.map((d) => ({
          id: d.id,
          at: d.decidedAt,
          ticker: d.ticker,
          title: d.title,
          phase: "HOLD",
          side: d.side,
          contracts: d.contracts,
          edgeAfterCost: d.edgeAfterCost,
          reason: d.reason,
        })),
        eligibleCount: 0,
        error: failures[0],
      });
    } else {
      // Log a compact representative slice — routine HOLD ticks should not
      // crowd the log with every candidate.
      const kept = round.decisions.slice(0, 3);
      recordEval({
        phase: round.phase,
        note: round.note,
        reason: round.decisions[0]?.reason,
        decisions: kept.map((d) => ({
          id: d.id,
          at: d.decidedAt,
          ticker: d.ticker,
          title: d.title,
          phase: d.phase,
          side: d.side,
          contracts: d.contracts,
          edgeAfterCost: d.edgeAfterCost,
          reason: d.reason,
        })),
        eligibleCount: round.eligible.length,
      });
    }
  }, [data, botOn, botHydrated, botUniverse, lots, openLot, botFilled, recordEval]);

  useEffect(() => {
    if (!botOn || !error || errorNotifiedRef.current) return;
    errorNotifiedRef.current = true;
    recordEval({
      phase: "ERROR",
      note: "ERROR: desk books unavailable — the paper bot will not trade on stale or missing quotes.",
      reason: error,
      decisions: [],
      eligibleCount: 0,
      error,
    });
  }, [botOn, error, recordEval]);

  const markets = useMemo(() => {
    if (!data) return [];
    let rows: DeskMarket[] = data.markets;
    if (view === "opportunities") {
      rows = rows.filter((m) => m.signal !== "hold");
      const rungs = new Set([
        ...(data.btc?.rungs.map((r) => r.ticker) ?? []),
        ...(data.eth?.rungs.map((r) => r.ticker) ?? []),
        ...(data.gold?.rungs.map((r) => r.ticker) ?? []),
      ]);
      rows = rows.filter((m) => !isHourlyLadder(m.seriesTicker) || rungs.has(m.ticker));
    }
    if (view === "watch") rows = rows.filter((m) => watch.includes(m.ticker));
    if (view === "btc") rows = rows.filter((m) => isBitcoinSeries(m.seriesTicker));
    if (view === "eth") rows = rows.filter((m) => isEthereumSeries(m.seriesTicker));
    if (view === "gold") rows = rows.filter((m) => isGoldSeries(m.seriesTicker));
    if (cat !== "All") rows = rows.filter((m) => m.category === cat);
    const query = q.trim().toLowerCase();
    if (query) {
      rows = rows.filter(
        (m) =>
          m.title.toLowerCase().includes(query) ||
          m.eventTitle.toLowerCase().includes(query) ||
          m.ticker.toLowerCase().includes(query),
      );
    }
    const copy = [...rows];
    copy.sort((a, b) => {
      if (sort === "edge") return b.execEdge - a.execEdge;
      if (sort === "volume") return b.volume24h - a.volume24h;
      if (sort === "close") return Date.parse(a.closeTime) - Date.parse(b.closeTime);
      if (sort === "quality") return b.quoteQuality - a.quoteQuality;
      return b.score - a.score;
    });
    return copy;
  }, [data, view, cat, q, sort, watch]);

  const feedAge = useMemo(() => {
    if (!data) return null;
    const t = Date.parse(data.asOf);
    if (!Number.isFinite(t)) return null;
    return Math.max(0, Math.round((Date.now() - t) / 1000));
  }, [data]);

  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-col gap-3 md:flex-row md:items-end md:justify-between">
        <div>
          <h1 className="text-3xl font-medium tracking-tight md:text-4xl">The desk</h1>
          <p className="mt-2 max-w-xl text-sm leading-relaxed text-muted">
            Independent fair values for live Kalshi contracts. Buy YES when the model is
            above the ask, buy NO when it is below the bid — after the Kalshi taker fee.
          </p>
        </div>
      </div>

      {loading && !data ? <DeskSkeleton /> : null}
      {error && !data ? (
        <div className="rounded-xl bg-surface px-6 py-10 text-center shadow-[var(--shadow-border)]">
          <p className="text-sm text-muted">{error}</p>
          <Button className="mt-4" onClick={onRetry}>
            Retry
          </Button>
        </div>
      ) : null}

      {data ? (
        <>
          <StatStrip stats={data.stats} asOf={data.asOf} />
          <FeedStatus data={data} feedAge={feedAge} />
          <BotBar error={botError} onDismissError={clearBotError} />

          {data.btc15 || data.eth15 || data.gold15 ? (
            <section aria-labelledby="fifteen-heading">
              <h2 id="fifteen-heading" className="mb-2 text-xs font-medium tracking-wide text-subtle uppercase">
                Next 15-minute prints
              </h2>
              <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
                {data.btc15 ? <Crypto15Card print={data.btc15} /> : null}
                {data.eth15 ? <Crypto15Card print={data.eth15} /> : null}
                {data.gold15 ? <Crypto15Card print={data.gold15} /> : null}
              </div>
            </section>
          ) : null}

          {data.btc || data.eth || data.gold ? (
            <section aria-labelledby="ladder-heading" className="rounded-xl bg-surface shadow-[var(--shadow-border)]">
              <button
                type="button"
                aria-expanded={showLadders}
                onClick={() => setShowLadders((v) => !v)}
                className="flex w-full items-center justify-between gap-3 px-4 py-3 text-left hover:bg-elevated md:px-5"
              >
                <span>
                  <span id="ladder-heading" className="block text-xs font-medium tracking-wide text-subtle uppercase">
                    Hourly above/below ladders
                  </span>
                  <span className="mt-0.5 block text-sm text-muted">
                    {[data.btc, data.eth, data.gold].filter(Boolean).map((t, i) => (
                      <span key={t!.seriesTicker}>
                        {i > 0 ? " · " : ""}
                        {t!.name} implied {t!.implied.toLocaleString("en-US", { style: "currency", currency: "USD", maximumFractionDigits: 0 })}
                      </span>
                    ))}
                  </span>
                </span>
                <span className="shrink-0 rounded-md bg-elevated px-2 py-1 text-xs text-muted">
                  {showLadders ? "Collapse" : "Expand"}
                </span>
              </button>
              {showLadders ? (
                <div className={cn("grid gap-4 border-t border-border p-4 md:grid-cols-2 md:p-5", data.btc && data.eth && data.gold ? "xl:grid-cols-3" : "")}>
                  {data.btc ? <CryptoTapeCard tape={data.btc} /> : null}
                  {data.eth ? <CryptoTapeCard tape={data.eth} /> : null}
                  {data.gold ? <CryptoTapeCard tape={data.gold} /> : null}
                </div>
              ) : null}
            </section>
          ) : null}

          <div className="flex flex-col gap-3">
            <div className="flex flex-wrap gap-2">
              {VIEWS.map((v) => (
                <Button
                  key={v.id}
                  type="button"
                  size="sm"
                  variant={view === v.id ? "primary" : "secondary"}
                  onClick={() => setView(v.id)}
                >
                  {v.label}
                </Button>
              ))}
            </div>

            <div className="relative max-w-md">
              <Search className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-subtle" />
              <Input
                value={q}
                onChange={(e) => setQ(e.target.value)}
                placeholder="Search title or ticker"
                className="pl-9"
                aria-label="Search markets"
              />
            </div>

            <div className="-mx-4 flex gap-2 overflow-x-auto px-4 pb-1 md:mx-0 md:flex-wrap md:overflow-visible md:px-0">
              <Chip active={cat === "All"} onClick={() => setCat("All")}>
                All
              </Chip>
              {data.categories.map((c) => (
                <Chip key={c.name} active={cat === c.name} onClick={() => setCat(c.name)}>
                  {c.name}
                  <span className="text-subtle"> {c.count}</span>
                </Chip>
              ))}
            </div>

            <div className="flex flex-wrap items-center gap-2">
              <span className="text-xs text-subtle">Sort</span>
              {SORTS.map((s) => (
                <button
                  key={s.id}
                  type="button"
                  onClick={() => setSort(s.id)}
                  className={cn(
                    "h-8 rounded-sm px-2.5 text-xs transition-colors duration-150",
                    sort === s.id ? "bg-elevated text-fg" : "text-muted hover:text-fg",
                  )}
                >
                  {s.label}
                </button>
              ))}
              <span className="ml-auto text-xs text-subtle tabular-nums">
                {markets.length} shown
              </span>
            </div>
          </div>

          <ForecastBar markets={markets} />

          <DeskList markets={markets} />
        </>
      ) : null}
    </div>
  );
}

function FeedStatus({ data, feedAge }: { data: DeskResponse; feedAge: number | null }) {
  // Hydration-safe: first paint (server and client) shows the snapshot clock;
  // the live seconds counter appears only after mount.
  const [mounted, setMounted] = useState(false);
  useEffect(() => setMounted(true), []);
  const stale = mounted && feedAge != null && feedAge > 180;
  return (
    <p className="-mt-2 text-xs text-subtle">
      Books snapshot{" "}
      {mounted && feedAge != null ? (
        <span className={cn(stale ? "text-no" : "text-fg")}>{feedAge}s ago</span>
      ) : (
        <span className="text-fg">{new Date(data.asOf).toLocaleTimeString()}</span>
      )}
      {" · "}
      refreshed about every 45s · quote ages show on each row
    </p>
  );
}

function Chip({
  active,
  onClick,
  children,
}: {
  active: boolean;
  onClick: () => void;
  children: ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        "h-8 shrink-0 rounded-full px-3 text-xs transition-colors duration-150",
        active ? "bg-accent text-accent-fg" : "bg-elevated text-muted hover:text-fg",
      )}
    >
      {children}
    </button>
  );
}

function DeskSkeleton() {
  return (
    <div className="flex flex-col gap-4">
      <div className="grid grid-cols-2 gap-2 sm:grid-cols-4 lg:grid-cols-7">
        {Array.from({ length: 7 }).map((_, i) => (
          <Skeleton key={i} className="h-20 rounded-lg" />
        ))}
      </div>
      <Skeleton className="h-12 rounded-lg" />
      <Skeleton className="h-96 rounded-xl" />
    </div>
  );
}

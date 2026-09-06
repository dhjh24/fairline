import { Search } from "lucide-react";
import { useEffect, useMemo, useState, type ReactNode } from "react";
import { Crypto15Card } from "@/components/crypto-15";
import { CryptoTapeCard } from "@/components/crypto-tape";
import { DeskList } from "@/components/desk-list";
import { ForecastBar } from "@/components/forecast-bar";
import { StatStrip } from "@/components/stat-strip";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import { isBitcoinSeries, isEthereumSeries, isFifteenCrypto, isHourlyCrypto } from "@/lib/crypto";
import { useBlotter } from "@/lib/blotter";
import { useCalibration, type QuoteSnap } from "@/lib/calibration";
import { useForecasts } from "@/lib/forecasts";
import type { CryptoFifteen, DeskMarket, DeskResponse } from "@/lib/types";
import { useWatchlist } from "@/lib/watchlist";
import { cn } from "@/lib/utils";

type View = "opportunities" | "all" | "watch" | "btc" | "eth";
type SortKey = "score" | "edge" | "volume" | "close" | "confidence";

const VIEWS: { id: View; label: string }[] = [
  { id: "opportunities", label: "Opportunities" },
  { id: "btc", label: "Bitcoin" },
  { id: "eth", label: "Ethereum" },
  { id: "all", label: "All books" },
  { id: "watch", label: "Watchlist" },
];

const SORTS: { id: SortKey; label: string }[] = [
  { id: "score", label: "Score" },
  { id: "edge", label: "Edge" },
  { id: "volume", label: "Volume" },
  { id: "close", label: "Close" },
  { id: "confidence", label: "Confidence" },
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
  const capture = useCalibration((s) => s.capture);
  const grokByTicker = useForecasts((s) => s.byTicker);

  useEffect(() => {
    if (!data) return;
    applyMarks(data.markets.map((m) => ({ ticker: m.ticker, mid: m.mid, fair: m.fair })));
  }, [data, applyMarks]);

  useEffect(() => {
    if (!data) return;
    const want = new Set<string>([
      ...watch,
      ...lots.filter((l) => l.status === "open").map((l) => l.ticker),
      ...(data.btc?.rungs.map((r) => r.ticker) ?? []),
      ...(data.eth?.rungs.map((r) => r.ticker) ?? []),
    ]);
    const rows: QuoteSnap[] = [];
    const seen = new Set<string>();
    const push = (row: QuoteSnap) => {
      if (seen.has(row.ticker)) return;
      seen.add(row.ticker);
      rows.push(row);
    };
    if (data.btc15) push(snapFifteen(data.btc15, grokByTicker[data.btc15.ticker]?.probability));
    if (data.eth15) push(snapFifteen(data.eth15, grokByTicker[data.eth15.ticker]?.probability));
    for (const m of data.markets) {
      if (
        m.signal === "hold" &&
        !want.has(m.ticker) &&
        !isFifteenCrypto(m.seriesTicker)
      ) {
        continue;
      }
      push(snapMarket(m, grokByTicker[m.ticker]?.probability));
    }
    capture(rows);
  }, [data, watch, lots, capture, grokByTicker]);

  const markets = useMemo(() => {
    if (!data) return [];
    let rows: DeskMarket[] = data.markets;
    if (view === "opportunities") {
      rows = rows.filter((m) => m.signal !== "hold");
      const rungs = new Set([
        ...(data.btc?.rungs.map((r) => r.ticker) ?? []),
        ...(data.eth?.rungs.map((r) => r.ticker) ?? []),
      ]);
      rows = rows.filter((m) => !isHourlyCrypto(m.seriesTicker) || rungs.has(m.ticker));
    }
    if (view === "watch") rows = rows.filter((m) => watch.includes(m.ticker));
    if (view === "btc") rows = rows.filter((m) => isBitcoinSeries(m.seriesTicker));
    if (view === "eth") rows = rows.filter((m) => isEthereumSeries(m.seriesTicker));
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
      if (sort === "edge") return Math.abs(b.fair - b.mid) - Math.abs(a.fair - a.mid);
      if (sort === "volume") return b.volume24h - a.volume24h;
      if (sort === "close") return Date.parse(a.closeTime) - Date.parse(b.closeTime);
      if (sort === "confidence") return b.confidence - a.confidence;
      return b.score - a.score;
    });
    return copy;
  }, [data, view, cat, q, sort, watch]);

  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-col gap-3 md:flex-row md:items-end md:justify-between">
        <div>
          <h1 className="text-3xl font-medium tracking-tight md:text-4xl">The desk</h1>
          <p className="mt-2 max-w-xl text-sm leading-relaxed text-muted">
            Independent fair values for live Kalshi contracts. Buy YES when the model is
            above the ask, buy NO when it is below the bid.
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
          {data.btc || data.eth ? (
            <div className={cn("grid gap-4", data.btc && data.eth ? "lg:grid-cols-2" : "")}>
              {data.btc ? <CryptoTapeCard tape={data.btc} /> : null}
              {data.eth ? <CryptoTapeCard tape={data.eth} /> : null}
            </div>
          ) : null}
          {data.btc15 || data.eth15 ? (
            <div className={cn("grid gap-4", data.btc15 && data.eth15 ? "lg:grid-cols-2" : "")}>
              {data.btc15 ? <Crypto15Card print={data.btc15} /> : null}
              {data.eth15 ? <Crypto15Card print={data.eth15} /> : null}
            </div>
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

function snapMarket(m: DeskMarket, grok?: number): QuoteSnap {
  return {
    ticker: m.ticker,
    eventTicker: m.eventTicker,
    seriesTicker: m.seriesTicker,
    title: m.yesSubTitle || m.title,
    eventTitle: m.eventTitle,
    category: m.category,
    closeTime: m.closeTime,
    target: m.strike,
    mid: m.mid,
    fair: m.fair,
    bid: m.bid,
    ask: m.ask,
    signal: m.signal,
    grok,
    snappedAt: new Date().toISOString(),
  };
}

function snapFifteen(p: CryptoFifteen, grok?: number): QuoteSnap {
  return {
    ticker: p.ticker,
    eventTicker: p.ticker,
    seriesTicker: p.asset === "eth" ? "KXETH15M" : "KXBTC15M",
    title: p.title,
    eventTitle: p.eventTitle,
    category: "Crypto",
    closeTime: p.closeTime,
    target: p.target,
    mid: p.mid,
    fair: p.fair,
    bid: p.bid,
    ask: p.ask,
    signal: p.signal,
    grok,
    snappedAt: new Date().toISOString(),
  };
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

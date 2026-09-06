import { createServerFn } from "@tanstack/react-start";
import { KALSHI_API, dollars, type RawEvent, type RawMarket } from "@/lib/kalshi";
import {
  BATCH_SIZE,
  forecastMarketCached,
  getProvider,
  mapPool,
  type ForecastSnapshot,
} from "@/lib/llm";
import { parseBook, priceMarket, type ModelInput } from "@/lib/model";
import type {
  Candle,
  CategoryCount,
  DeskMarket,
  DeskResponse,
  GrokForecast,
  MarketDetail,
} from "@/lib/types";

const PAGE_LIMIT = 200;
const MAX_PAGES = 5;
const DESK_TTL_MS = 45_000;
const DESK_SIZE = 240;

type CacheBox<T> = { at: number; data: T };
let deskCache: CacheBox<DeskResponse> | null = null;

async function kalshiGet<T>(path: string, timeoutMs = 12_000): Promise<T> {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    const res = await fetch(`${KALSHI_API}${path}`, {
      signal: ctrl.signal,
      headers: { Accept: "application/json" },
    });
    if (!res.ok) {
      throw new Error(`Kalshi ${res.status} on ${path.split("?")[0]}`);
    }
    return (await res.json()) as T;
  } finally {
    clearTimeout(t);
  }
}

function toInput(
  m: RawMarket,
  e: {
    eventTicker: string;
    seriesTicker: string;
    eventTitle: string;
    category: string;
    mutuallyExclusive: boolean;
    fieldSize: number;
    fieldSum: number;
  },
): ModelInput | null {
  if (!m.ticker || m.mve_collection_ticker) return null;
  const bid = dollars(m.yes_bid_dollars);
  const ask = dollars(m.yes_ask_dollars);
  const last = dollars(m.last_price_dollars);
  if (bid <= 0 && ask <= 0 && last <= 0) return null;
  return {
    ticker: m.ticker,
    eventTicker: e.eventTicker,
    seriesTicker: e.seriesTicker,
    title: m.title || e.eventTitle,
    eventTitle: e.eventTitle,
    yesSubTitle: m.yes_sub_title || "",
    category: e.category,
    closeTime: m.close_time || "",
    mutuallyExclusive: e.mutuallyExclusive,
    fieldSize: e.fieldSize,
    fieldSum: e.fieldSum,
    bid,
    ask,
    last,
    prevLast: dollars(m.previous_price_dollars),
    volume: dollars(m.volume_fp),
    volume24h: dollars(m.volume_24h_fp),
    openInterest: dollars(m.open_interest_fp),
  };
}

async function loadEvents(): Promise<RawEvent[]> {
  const events: RawEvent[] = [];
  let cursor = "";
  for (let i = 0; i < MAX_PAGES; i++) {
    const q = new URLSearchParams({
      limit: String(PAGE_LIMIT),
      status: "open",
      with_nested_markets: "true",
    });
    if (cursor) q.set("cursor", cursor);
    const page = await kalshiGet<{ events?: RawEvent[]; cursor?: string }>(
      `/events?${q.toString()}`,
    );
    events.push(...(page.events ?? []));
    cursor = page.cursor ?? "";
    if (!cursor) break;
  }
  return events;
}

function buildDesk(events: RawEvent[]): DeskResponse {
  const priced: DeskMarket[] = [];
  let scanned = 0;

  for (const e of events) {
    const eventTicker = e.event_ticker || "";
    if (!eventTicker || eventTicker.includes("MVE")) continue;
    const markets = (e.markets ?? []).filter((m) => !m.mve_collection_ticker);
    const inputs: ModelInput[] = [];
    const meta = {
      eventTicker,
      seriesTicker: e.series_ticker || "",
      eventTitle: e.title || "",
      category: e.category || "Other",
      mutuallyExclusive: Boolean(e.mutually_exclusive),
      fieldSize: 0,
      fieldSum: 0,
    };
    for (const m of markets) {
      scanned += 1;
      const input = toInput(m, meta);
      if (!input) continue;
      inputs.push(input);
    }
    const fieldSum = inputs.reduce((s, i) => {
      const mid =
        i.bid > 0 && i.ask > 0 && i.ask >= i.bid && i.ask - i.bid < 0.7
          ? (i.bid + i.ask) / 2
          : i.last || i.bid || i.ask;
      return s + mid;
    }, 0);
    const fieldSize = inputs.length;
    for (const input of inputs) {
      input.fieldSize = fieldSize;
      input.fieldSum = fieldSum;
      const volOk = input.volume24h >= 8 || input.volume >= 150 || input.openInterest >= 80;
      if (!volOk) continue;
      priced.push(priceMarket(input));
    }
  }

  priced.sort((a, b) => b.volume24h - a.volume24h);
  const byVol = priced.slice(0, 200);
  const seen = new Set(byVol.map((m) => m.ticker));
  const extra = priced
    .filter((m) => !seen.has(m.ticker) && m.signal !== "hold" && m.volume24h >= 40)
    .sort((a, b) => b.score - a.score)
    .slice(0, 40);
  const markets = [...byVol, ...extra].slice(0, DESK_SIZE);

  const catMap = new Map<string, number>();
  for (const m of markets) {
    catMap.set(m.category, (catMap.get(m.category) ?? 0) + 1);
  }
  const categories: CategoryCount[] = [...catMap.entries()]
    .map(([name, count]) => ({ name, count }))
    .sort((a, b) => b.count - a.count);

  const absEdges = markets.map((m) => Math.abs(m.fair - m.mid)).sort((a, b) => a - b);
  const medianAbsEdge = absEdges.length ? absEdges[Math.floor(absEdges.length / 2)]! : 0;

  return {
    asOf: new Date().toISOString(),
    markets,
    categories,
    stats: {
      scanned,
      returned: markets.length,
      edges: markets.filter((m) => m.signal !== "hold").length,
      yes: markets.filter((m) => m.signal === "yes").length,
      no: markets.filter((m) => m.signal === "no").length,
      hold: markets.filter((m) => m.signal === "hold").length,
      medianAbsEdge,
      volume24h: markets.reduce((s, m) => s + m.volume24h, 0),
    },
  };
}

export const getDesk = createServerFn({ method: "GET" }).handler(async () => {
  if (deskCache && Date.now() - deskCache.at < DESK_TTL_MS) {
    return deskCache.data;
  }
  const events = await loadEvents();
  const data = buildDesk(events);
  deskCache = { at: Date.now(), data };
  return data;
});

type CandleRaw = {
  end_period_ts?: number;
  volume_fp?: string;
  price?: {
    open_dollars?: string;
    high_dollars?: string;
    low_dollars?: string;
    close_dollars?: string;
    previous_dollars?: string;
  };
};

function parseCandles(raw: CandleRaw[]): Candle[] {
  const out: Candle[] = [];
  for (const c of raw) {
    const close = dollars(c.price?.close_dollars ?? c.price?.previous_dollars);
    if (!c.end_period_ts || close <= 0) continue;
    const open = dollars(c.price?.open_dollars) || close;
    const high = dollars(c.price?.high_dollars) || Math.max(open, close);
    const low = dollars(c.price?.low_dollars) || Math.min(open, close);
    out.push({
      t: c.end_period_ts * 1000,
      open,
      high,
      low,
      close,
      volume: dollars(c.volume_fp),
    });
  }
  return out;
}

export const getMarketDetail = createServerFn({ method: "POST" })
  .validator((input: { ticker: string }) => input)
  .handler(async ({ data }): Promise<MarketDetail> => loadMarketDetail(data.ticker));

async function loadMarketDetail(rawTicker: string): Promise<MarketDetail> {
  const ticker = rawTicker.trim();
  if (!ticker) throw new Error("Missing ticker");

  const marketRes = await kalshiGet<{ market: RawMarket }>(
    `/markets/${encodeURIComponent(ticker)}`,
  );
  const raw = marketRes.market;
  if (!raw?.ticker) throw new Error("Market not found");
  const eventTicker = raw.event_ticker || "";

  const [eventRes, bookRes] = await Promise.all([
    kalshiGet<{
      event?: RawEvent;
      markets?: RawMarket[];
    }>(`/events/${encodeURIComponent(eventTicker)}`).catch(() => ({
      event: undefined,
      markets: [] as RawMarket[],
    })),
    kalshiGet<{
      orderbook_fp?: {
        yes_dollars?: [string, string][];
        no_dollars?: [string, string][];
      };
    }>(`/markets/${encodeURIComponent(ticker)}/orderbook`).catch(() => ({
      orderbook_fp: undefined,
    })),
  ]);

  const event = eventRes.event;
  const siblingsRaw = eventRes.markets ?? [];
  const book = parseBook(bookRes.orderbook_fp);

  const fieldInputs: ModelInput[] = [];
  const eventMeta = {
    eventTicker,
    seriesTicker: event?.series_ticker || "",
    eventTitle: event?.title || "",
    category: event?.category || "Other",
    mutuallyExclusive: Boolean(event?.mutually_exclusive),
    fieldSize: 0,
    fieldSum: 0,
  };

  const pool = siblingsRaw.length ? siblingsRaw : [raw];
  for (const m of pool) {
    const input = toInput(m, eventMeta);
    if (input) fieldInputs.push(input);
  }
  const fieldSum = fieldInputs.reduce((s, i) => {
    const mid =
      i.bid > 0 && i.ask > 0 && i.ask >= i.bid && i.ask - i.bid < 0.7
        ? (i.bid + i.ask) / 2
        : i.last || i.bid || i.ask;
    return s + mid;
  }, 0);
  for (const i of fieldInputs) {
    i.fieldSize = fieldInputs.length;
    i.fieldSum = fieldSum;
  }

  let focus = fieldInputs.find((i) => i.ticker === ticker);
  if (!focus) {
    focus = toInput(raw, { ...eventMeta, fieldSize: 1, fieldSum: 0 }) ?? undefined;
  }
  if (!focus) throw new Error("Could not price this market");
  focus.bookImbalance = book.imbalance;

  const market = priceMarket(focus);
  const siblings = fieldInputs
    .filter((i) => i.ticker !== ticker)
    .map((i) => {
      const priced = priceMarket(i);
      return {
        ticker: priced.ticker,
        title: priced.yesSubTitle || priced.title,
        mid: priced.mid,
        fair: priced.fair,
      };
    })
    .sort((a, b) => b.mid - a.mid)
    .slice(0, 8);

  const now = Math.floor(Date.now() / 1000);
  const lookback = market.tauDays < 14 ? 14 * 86400 : 90 * 86400;
  const interval = market.tauDays < 14 ? 60 : 1440;
  let candles: Candle[] = [];
  try {
    const q = new URLSearchParams({
      market_tickers: ticker,
      start_ts: String(now - lookback),
      end_ts: String(now),
      period_interval: String(interval),
    });
    const cRes = await kalshiGet<{
      markets?: { candlesticks?: CandleRaw[] }[];
    }>(`/markets/candlesticks?${q.toString()}`);
    candles = parseCandles(cRes.markets?.[0]?.candlesticks ?? []);
  } catch {
    candles = [];
  }

  const rules = [raw.rules_primary, raw.rules_secondary].filter(Boolean).join("\n\n");

  return {
    market,
    siblings,
    rules,
    book,
    candles,
    asOf: new Date().toISOString(),
  };
}

export type TickerMarkQuote = {
  ticker: string;
  mid: number;
  fair: number;
  bid: number;
  ask: number;
  last: number;
  closeTime: string;
};

export const markTickers = createServerFn({ method: "POST" })
  .validator((input: { tickers: string[] }) => input)
  .handler(async ({ data }): Promise<TickerMarkQuote[]> => {
    const unique = [
      ...new Set(data.tickers.map((t) => t.trim()).filter(Boolean)),
    ].slice(0, 30);

    const fromDesk = new Map<string, TickerMarkQuote>();
    if (deskCache?.data) {
      for (const m of deskCache.data.markets) {
        fromDesk.set(m.ticker, {
          ticker: m.ticker,
          mid: m.mid,
          fair: m.fair,
          bid: m.bid,
          ask: m.ask,
          last: m.last,
          closeTime: m.closeTime,
        });
      }
    }

    const out: TickerMarkQuote[] = [];
    const missing: string[] = [];
    for (const ticker of unique) {
      const hit = fromDesk.get(ticker);
      if (hit) out.push(hit);
      else missing.push(ticker);
    }

    if (missing.length > 0) {
      const extras = await Promise.all(
        missing.map(async (ticker) => {
          try {
            const d = await loadMarketDetail(ticker);
            const m = d.market;
            return {
              ticker: m.ticker,
              mid: m.mid,
              fair: m.fair,
              bid: m.bid,
              ask: m.ask,
              last: m.last,
              closeTime: m.closeTime,
            } satisfies TickerMarkQuote;
          } catch {
            return null;
          }
        }),
      );
      for (const extra of extras) if (extra) out.push(extra);
    }
    return out;
  });

export const runGrokForecast = createServerFn({ method: "POST" })
  .validator(
    (input: {
      ticker: string;
      title: string;
      eventTitle: string;
      category: string;
      closeTime: string;
      bid: number;
      ask: number;
      last: number;
      fair: number;
      fieldSize: number;
      fieldSum: number;
      rules: string;
      providerId?: string;
    }) => input,
  )
  .handler(async ({ data }): Promise<GrokForecast> => {
    return forecastMarketCached(
      {
        ticker: data.ticker,
        title: data.title,
        eventTitle: data.eventTitle,
        category: data.category,
        closeTime: data.closeTime,
        bid: data.bid,
        ask: data.ask,
        last: data.last,
        fair: data.fair,
        fieldSize: data.fieldSize,
        fieldSum: data.fieldSum,
        rules: data.rules,
      },
      data.providerId,
    );
  });

export type BatchForecastItem = {
  ticker: string;
  forecast: GrokForecast;
};

export const runBatchForecast = createServerFn({ method: "POST" })
  .validator(
    (input: {
      providerId?: string;
      markets: ForecastSnapshot[];
    }) => input,
  )
  .handler(async ({ data }): Promise<{ results: BatchForecastItem[] }> => {
    const markets = data.markets.slice(0, BATCH_SIZE);
    const provider = getProvider(data.providerId);
    const results = await mapPool(markets, 2, async (m) => ({
      ticker: m.ticker,
      forecast: await forecastMarketCached(m, provider.id),
    }));
    return { results };
  });

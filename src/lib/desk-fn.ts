import { createServerFn } from "@tanstack/react-start";
import {
  CRYPTO_FIRST,
  CRYPTO_SERIES,
  GOLD_FIRST,
  GOLD_SERIES,
  impliedSpot,
  isBitcoinSeries,
  isEthereumSeries,
  isGoldSeries,
  isHourlyLadder,
  isPrintMarket,
  pickAtmWindow,
  strikeThreshold,
} from "@/lib/crypto";
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
  CryptoFifteen,
  CryptoTape,
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
    if (res.status === 429) {
      // Kalshi rate limit: back off before retrying. Never throw on the first
      // 429 — the desk fetch fans out and will otherwise blank a cold load.
      for (const delay of [800, 1600, 3200]) {
        await new Promise((r) => setTimeout(r, delay));
        const retry = await fetch(`${KALSHI_API}${path}`, {
          headers: { Accept: "application/json" },
        });
        if (retry.ok) return (await retry.json()) as T;
        if (retry.status !== 429) throw new Error(`Kalshi ${retry.status} on ${path.split("?")[0]}`);
      }
      throw new Error(`Kalshi 429 on ${path.split("?")[0]}`);
    }
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
    strike: typeof m.floor_strike === "number" ? strikeThreshold(m.floor_strike) : undefined,
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

async function loadSeriesEvents(series: string): Promise<RawEvent[]> {
  const q = new URLSearchParams({
    limit: "8",
    status: "open",
    series_ticker: series,
    with_nested_markets: "true",
  });
  const page = await kalshiGet<{ events?: RawEvent[] }>(`/events?${q.toString()}`);
  return page.events ?? [];
}

async function loadCryptoEvents(): Promise<RawEvent[]> {
  // BTC/ETH 15m first (highest traffic), then gold 15m, then hourly/longer
  // series — all at low concurrency so Kalshi 429s cannot starve the prints.
  const btcEthFirst = await mapPool([...CRYPTO_FIRST], 2, (series) =>
    loadSeriesEvents(series).catch(() => [] as RawEvent[]),
  );
  const goldFirst = await mapPool([...GOLD_FIRST], 2, (series) =>
    loadSeriesEvents(series).catch(() => [] as RawEvent[]),
  );
  const rest = [
    ...CRYPTO_SERIES.filter(
      (series) => !CRYPTO_FIRST.includes(series as (typeof CRYPTO_FIRST)[number]),
    ),
    ...GOLD_SERIES.filter(
      (series) => !GOLD_FIRST.includes(series as (typeof GOLD_FIRST)[number]),
    ),
  ];
  const later = await mapPool(rest, 2, (series) =>
    loadSeriesEvents(series).catch(() => [] as RawEvent[]),
  );
  const map = new Map<string, RawEvent>();
  for (const e of [...btcEthFirst.flat(), ...goldFirst.flat(), ...later.flat()]) {
    const t = e.event_ticker;
    if (t) map.set(t, e);
  }
  return [...map.values()];
}

function mergeEvents(base: RawEvent[], extra: RawEvent[]): RawEvent[] {
  const map = new Map<string, RawEvent>();
  for (const e of [...base, ...extra]) {
    const t = e.event_ticker;
    if (t) map.set(t, e);
  }
  return [...map.values()];
}

function buildCryptoTape(
  markets: DeskMarket[],
  directionalSeries: string,
  asset: CryptoTape["asset"],
  name: string,
): CryptoTape | null {
  const want = directionalSeries.toUpperCase();
  const directional = markets.filter(
    (m) => m.seriesTicker.toUpperCase() === want && (m.strike ?? 0) > 0,
  );
  if (directional.length < 4) return null;
  const byEvent = new Map<string, DeskMarket[]>();
  for (const m of directional) {
    const list = byEvent.get(m.eventTicker) ?? [];
    list.push(m);
    byEvent.set(m.eventTicker, list);
  }
  let best: DeskMarket[] = [];
  let bestClose = Infinity;
  const now = Date.now();
  for (const list of byEvent.values()) {
    const close = Date.parse(list[0]?.closeTime ?? "");
    if (Number.isFinite(close) && close >= now && close < bestClose) {
      bestClose = close;
      best = list;
    }
  }
  if (best.length < 4) {
    best = [...byEvent.values()].sort((a, b) => b.length - a.length)[0] ?? [];
  }
  if (best.length < 4) return null;
  const rungs = pickAtmWindow(
    best
      .filter((m) => (m.strike ?? 0) > 0)
      .map((m) => ({
        ticker: m.ticker,
        strike: m.strike!,
        label: m.yesSubTitle || m.title,
        mid: m.mid,
        fair: m.fair,
        signal: m.signal,
        edge: m.edge,
        volume24h: m.volume24h,
      })),
    7,
  );
  const implied = impliedSpot(rungs);
  if (!implied || rungs.length < 3) return null;
  const head = best[0]!;
  return {
    asset,
    name,
    implied,
    closeTime: head.closeTime,
    eventTicker: head.eventTicker,
    eventTitle: head.eventTitle,
    seriesTicker: head.seriesTicker,
    rungs,
  };
}

function keepCrypto(
  all: DeskMarket[],
  tape: CryptoTape | null,
  cap: number,
): DeskMarket[] {
  const keep: DeskMarket[] = [];
  const seen = new Set<string>();
  const push = (row: DeskMarket | undefined) => {
    if (!row || seen.has(row.ticker)) return;
    keep.push(row);
    seen.add(row.ticker);
  };
  for (const m of all) {
    if (isPrintMarket(m.seriesTicker)) push(m);
  }
  if (tape) {
    for (const rung of tape.rungs) {
      push(all.find((m) => m.ticker === rung.ticker));
    }
  }
  const more = all
    .filter((m) => {
      if (seen.has(m.ticker)) return false;
      if (isHourlyLadder(m.seriesTicker)) {
        return m.mid >= 0.08 && m.mid <= 0.92 && m.volume24h >= 80;
      }
      return true;
    })
    .sort((a, b) => b.score - a.score || b.volume24h - a.volume24h);
  for (const m of more) {
    push(m);
    if (keep.length >= cap) break;
  }
  return keep;
}

function buildFifteen(
  markets: DeskMarket[],
  series: string,
  asset: CryptoFifteen["asset"],
  name: string,
): CryptoFifteen | null {
  const want = series.toUpperCase();
  const rows = markets.filter((m) => m.seriesTicker.toUpperCase() === want);
  if (rows.length === 0) return null;
  const now = Date.now();
  const live = rows
    .filter((m) => {
      const t = Date.parse(m.closeTime);
      return Number.isFinite(t) && t >= now - 30_000;
    })
    .sort((a, b) => Date.parse(a.closeTime) - Date.parse(b.closeTime));
  const m = live[0] ?? rows.sort((a, b) => b.volume24h - a.volume24h)[0];
  if (!m) return null;
  return {
    asset,
    name,
    ticker: m.ticker,
    target: m.strike ?? 0,
    mid: m.mid,
    fair: m.fair,
    bid: m.bid,
    ask: m.ask,
    signal: m.signal,
    edge: m.edge,
    volume24h: m.volume24h,
    closeTime: m.closeTime,
    title: m.yesSubTitle || m.title,
    eventTitle: m.eventTitle,
  };
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
      const isShort = isPrintMarket(input.seriesTicker) || isHourlyLadder(input.seriesTicker);
      // Print/ladder series (BTC/ETH/gold 15m + hourly) may be genuinely thin:
      // any live executable two-sided quote earns a place on the tape so the
      // gold/XAUUSD book is visible even before volume builds. The general
      // event pool keeps the strict volume gate.
      const quoted =
        input.bid > 0 && input.ask > 0 && input.ask >= input.bid && input.ask < 1;
      const volOk = isShort
        ? quoted || input.volume24h >= 8 || input.volume >= 150 || input.openInterest >= 80
        : input.volume24h >= 8 || input.volume >= 150 || input.openInterest >= 80;
      if (!volOk) continue;
      priced.push(priceMarket(input));
    }
  }

  priced.sort((a, b) => b.volume24h - a.volume24h);

  const btcAll = priced.filter((m) => isBitcoinSeries(m.seriesTicker));
  const ethAll = priced.filter((m) => isEthereumSeries(m.seriesTicker));
  const goldAll = priced.filter((m) => isGoldSeries(m.seriesTicker));
  const rest = priced.filter(
    (m) =>
      !isBitcoinSeries(m.seriesTicker) &&
      !isEthereumSeries(m.seriesTicker) &&
      !isGoldSeries(m.seriesTicker),
  );
  const btcTape = buildCryptoTape(btcAll, "KXBTCD", "btc", "Bitcoin");
  const ethTape = buildCryptoTape(ethAll, "KXETHD", "eth", "Ethereum");
  const goldTape = buildCryptoTape(goldAll, "KXGOLDH", "gold", "Gold");
  const btc15 = buildFifteen(btcAll, "KXBTC15M", "btc", "Bitcoin 15m");
  const eth15 = buildFifteen(ethAll, "KXETH15M", "eth", "Ethereum 15m");
  const gold15 = buildFifteen(goldAll, "KXGOLD15M", "gold", "Gold 15m");

  const CRYPTO_SLOTS = 60; // 24 BTC + 24 ETH + 12 gold keeps
  const byVol = rest.slice(0, 200);
  const seen = new Set(byVol.map((m) => m.ticker));
  const extra = rest
    .filter((m) => !seen.has(m.ticker) && m.signal !== "hold" && m.volume24h >= 40)
    .sort((a, b) => b.score - a.score)
    .slice(0, 40);
  const restMarkets = [...byVol, ...extra].slice(0, DESK_SIZE - CRYPTO_SLOTS);
  const btcKeep = keepCrypto(btcAll, btcTape, 24);
  const ethKeep = keepCrypto(ethAll, ethTape, 24);
  const goldKeep = keepCrypto(goldAll, goldTape, 12);
  const markets = [...restMarkets, ...btcKeep, ...ethKeep, ...goldKeep].slice(0, DESK_SIZE);
  const asOf = new Date().toISOString();
  for (const m of markets) m.quoteAt = asOf;

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
    btc: btcTape,
    eth: ethTape,
    btc15,
    eth15,
    gold: goldTape,
    gold15,
  };
}

export const getDesk = createServerFn({ method: "GET" }).handler(async () => {
  if (deskCache && Date.now() - deskCache.at < DESK_TTL_MS) {
    return deskCache.data;
  }
  try {
    const general = await loadEvents();
    const crypto = await loadCryptoEvents().catch(() => [] as RawEvent[]);
    const data = buildDesk(mergeEvents(general, crypto));
    deskCache = { at: Date.now(), data };
    return data;
  } catch (err) {
    if (deskCache?.data) return deskCache.data;
    throw err;
  }
});

type CandleRaw = {
  end_period_ts?: number;
  volume_fp?: string;
  price?: {
    open_dollars?: string;
    high_dollars?: string;
    low_dollars?: string;
    close_dollars?: string;
    mean_dollars?: string;
    previous_dollars?: string;
  };
  yes_bid?: { close_dollars?: string; open_dollars?: string };
  yes_ask?: { close_dollars?: string; open_dollars?: string };
};

function candlePx(
  price?: CandleRaw["price"],
  bid?: CandleRaw["yes_bid"],
  ask?: CandleRaw["yes_ask"],
): number {
  const traded =
    dollars(price?.close_dollars) ||
    dollars(price?.mean_dollars) ||
    dollars(price?.open_dollars) ||
    dollars(price?.previous_dollars);
  if (traded > 0) return traded;
  const b = dollars(bid?.close_dollars ?? bid?.open_dollars);
  const a = dollars(ask?.close_dollars ?? ask?.open_dollars);
  if (b > 0 && a > 0) return (b + a) / 2;
  return b || a;
}

function parseCandles(raw: CandleRaw[]): Candle[] {
  const out: Candle[] = [];
  for (const c of raw) {
    const close = candlePx(c.price, c.yes_bid, c.yes_ask);
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
  out.sort((a, b) => a.t - b.t);
  return out;
}

async function loadCandles(series: string, ticker: string, tauDays: number): Promise<Candle[]> {
  const now = Math.floor(Date.now() / 1000);
  let interval = 1440;
  let lookback = 180 * 86400;
  if (isPrintMarket(series) || tauDays < 2) {
    interval = 1;
    lookback = 8 * 3600;
  } else if (tauDays < 21) {
    interval = 60;
    lookback = 21 * 86400;
  }
  const q = `start_ts=${now - lookback}&end_ts=${now}&period_interval=${interval}&include_latest_before_start=true`;
  try {
    const res = await kalshiGet<{ candlesticks?: CandleRaw[] }>(
      `/series/${encodeURIComponent(series)}/markets/${encodeURIComponent(ticker)}/candlesticks?${q}`,
    );
    const parsed = parseCandles(res.candlesticks ?? []);
    if (parsed.length) return parsed;
  } catch {
    /* fall through to batch */
  }
  try {
    const res = await kalshiGet<{ markets?: { candlesticks?: CandleRaw[] }[] }>(
      `/markets/candlesticks?market_tickers=${encodeURIComponent(ticker)}&${q}`,
    );
    return parseCandles(res.markets?.[0]?.candlesticks ?? []);
  } catch {
    return [];
  }
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

  const candles = await loadCandles(market.seriesTicker, ticker, market.tauDays);
  const printHistory = isPrintMarket(market.seriesTicker)
    ? (await loadSettledFifteen().catch(() => [])).filter(
        (h) => h.seriesTicker === market.seriesTicker,
      )
    : [];

  const rules = [raw.rules_primary, raw.rules_secondary].filter(Boolean).join("\n\n");
  market.quoteAt = new Date().toISOString();

  return {
    market,
    siblings,
    rules,
    book,
    candles,
    printHistory,
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

export type SettlementHit = {
  ticker: string;
  seriesTicker: string;
  eventTitle: string;
  target: number;
  closeTime: string;
  result: "yes" | "no";
  last: number;
};

function parseResult(raw: string | undefined): "yes" | "no" | null {
  const s = (raw ?? "").toLowerCase();
  if (s === "yes") return "yes";
  if (s === "no") return "no";
  return null;
}

async function loadSettledFifteen(): Promise<SettlementHit[]> {
  const series = ["KXBTC15M", "KXETH15M", "KXGOLD15M"] as const;
  const pages = await mapPool([...series], 2, async (s) => {
    const q = new URLSearchParams({
      limit: "12",
      status: "settled",
      series_ticker: s,
      with_nested_markets: "true",
    });
    const page = await kalshiGet<{ events?: RawEvent[] }>(`/events?${q.toString()}`).catch(
      () => ({ events: [] as RawEvent[] }),
    );
    return page.events ?? [];
  });
  const hits: SettlementHit[] = [];
  for (const e of pages.flat()) {
    const m = (e.markets ?? [])[0];
    const result = parseResult(m?.result);
    if (!m?.ticker || !result) continue;
    hits.push({
      ticker: m.ticker,
      seriesTicker: e.series_ticker || "",
      eventTitle: e.title || m.title || "",
      target:
        typeof m.floor_strike === "number" ? strikeThreshold(m.floor_strike) : 0,
      closeTime: m.close_time || "",
      result,
      last: dollars(m.last_price_dollars),
    });
  }
  hits.sort((a, b) => Date.parse(b.closeTime) - Date.parse(a.closeTime));
  return hits;
}

async function lookupResults(tickers: string[]): Promise<SettlementHit[]> {
  const unique = [...new Set(tickers.map((t) => t.trim()).filter(Boolean))].slice(0, 24);
  const rows = await mapPool(unique, 2, async (ticker) => {
    try {
      const res = await kalshiGet<{ market: RawMarket }>(
        `/markets/${encodeURIComponent(ticker)}`,
      );
      const m = res.market;
      const result = parseResult(m?.result);
      if (!m?.ticker || !result) return null;
      return {
        ticker: m.ticker,
        seriesTicker: "",
        eventTitle: m.title || "",
        target:
          typeof m.floor_strike === "number" ? strikeThreshold(m.floor_strike) : 0,
        closeTime: m.close_time || "",
        result,
        last: dollars(m.last_price_dollars),
      } satisfies SettlementHit;
    } catch {
      return null;
    }
  });
  return rows.filter((r): r is SettlementHit => r != null);
}

export const getSettlements = createServerFn({ method: "POST" })
  .validator((input: { tickers?: string[] }) => input)
  .handler(async ({ data }): Promise<{ history: SettlementHit[]; extra: SettlementHit[] }> => {
    const history = await loadSettledFifteen().catch(() => [] as SettlementHit[]);
    const known = new Set(history.map((h) => h.ticker));
    const need = (data.tickers ?? []).filter((t) => t && !known.has(t));
    const extra = need.length ? await lookupResults(need).catch(() => [] as SettlementHit[]) : [];
    return { history, extra };
  });


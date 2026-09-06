export const KALSHI_API = "https://external-api.kalshi.com/trade-api/v2";

export function dollars(v: unknown): number {
  if (typeof v === "number" && Number.isFinite(v)) return v;
  if (typeof v === "string" && v.length > 0) {
    const n = Number(v);
    return Number.isFinite(n) ? n : 0;
  }
  return 0;
}

export function marketMid(bid: number, ask: number, last: number): number {
  if (bid > 0 && ask > 0 && ask >= bid) {
    const spread = ask - bid;
    if (spread >= 0.7 && last > 0) return clamp01(last);
    return clamp01((bid + ask) / 2);
  }
  if (last > 0) return clamp01(last);
  if (bid > 0) return clamp01(bid);
  if (ask > 0 && ask < 1) return clamp01(ask);
  return 0;
}

export function clamp01(n: number, lo = 0.005, hi = 0.995): number {
  if (!Number.isFinite(n)) return 0.5;
  return Math.min(hi, Math.max(lo, n));
}

export function kalshiMarketUrl(seriesTicker: string, eventTicker: string): string {
  const series = seriesTicker.toLowerCase();
  const event = eventTicker.toLowerCase();
  return `https://kalshi.com/markets/${encodeURIComponent(series)}/${encodeURIComponent(event)}`;
}

export function tauDays(closeTime: string, now = Date.now()): number {
  const t = Date.parse(closeTime);
  if (!Number.isFinite(t)) return 30;
  return Math.max(0, (t - now) / 86_400_000);
}

export type RawMarket = {
  ticker?: string;
  event_ticker?: string;
  title?: string;
  yes_sub_title?: string;
  close_time?: string;
  yes_bid_dollars?: string;
  yes_ask_dollars?: string;
  last_price_dollars?: string;
  previous_price_dollars?: string;
  volume_fp?: string;
  volume_24h_fp?: string;
  open_interest_fp?: string;
  rules_primary?: string;
  rules_secondary?: string;
  mve_collection_ticker?: string;
  status?: string;
};

export type RawEvent = {
  event_ticker?: string;
  series_ticker?: string;
  title?: string;
  category?: string;
  mutually_exclusive?: boolean;
  markets?: RawMarket[];
};

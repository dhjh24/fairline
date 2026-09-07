export type Signal = "yes" | "no" | "hold";

export type Factor = {
  id: string;
  label: string;
  delta: number;
  detail: string;
};

export type DeskMarket = {
  ticker: string;
  eventTicker: string;
  seriesTicker: string;
  title: string;
  eventTitle: string;
  yesSubTitle: string;
  category: string;
  closeTime: string;
  mutuallyExclusive: boolean;
  fieldSize: number;
  fieldSum: number;
  bid: number;
  ask: number;
  last: number;
  prevLast: number;
  volume: number;
  volume24h: number;
  openInterest: number;
  mid: number;
  fair: number;
  edge: number;
  evYes: number;
  evNo: number;
  signal: Signal;
  confidence: number;
  liquidity: number;
  kellyYes: number;
  kellyNo: number;
  score: number;
  spread: number;
  tauDays: number;
  factors: Factor[];
  strike?: number;
};

export type DeskStats = {
  scanned: number;
  returned: number;
  edges: number;
  yes: number;
  no: number;
  hold: number;
  medianAbsEdge: number;
  volume24h: number;
};

export type CategoryCount = {
  name: string;
  count: number;
};

export type DeskResponse = {
  asOf: string;
  markets: DeskMarket[];
  categories: CategoryCount[];
  stats: DeskStats;
  btc?: CryptoTape | null;
  eth?: CryptoTape | null;
  btc15?: CryptoFifteen | null;
  eth15?: CryptoFifteen | null;
};

export type CryptoRung = {
  ticker: string;
  strike: number;
  label: string;
  mid: number;
  fair: number;
  signal: Signal;
  edge: number;
  volume24h: number;
};

export type CryptoTape = {
  asset: "btc" | "eth";
  name: string;
  implied: number;
  closeTime: string;
  eventTicker: string;
  eventTitle: string;
  seriesTicker: string;
  rungs: CryptoRung[];
};

export type CryptoFifteen = {
  asset: "btc" | "eth";
  name: string;
  ticker: string;
  target: number;
  mid: number;
  fair: number;
  bid: number;
  ask: number;
  signal: Signal;
  edge: number;
  volume24h: number;
  closeTime: string;
  title: string;
  eventTitle: string;
};

/** @deprecated use CryptoTape */
export type BtcRung = CryptoRung;
export type BtcTape = CryptoTape;

export type Candle = {
  t: number;
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
};

export type BookLevel = {
  price: number;
  size: number;
  cumulative: number;
};

export type OrderBook = {
  bids: BookLevel[];
  asks: BookLevel[];
  imbalance: number;
};

export type GrokFactor = {
  name: string;
  direction: "up" | "down";
  note: string;
};

export type GrokForecast =
  | {
      ok: true;
      probability: number;
      confidence: number;
      thesis: string;
      factors: GrokFactor[];
      risks: string[];
      blended: number;
      providerId?: string;
      model?: string;
    }
  | { ok: false; error: string };

export type MarketDetail = {
  market: DeskMarket;
  siblings: { ticker: string; title: string; mid: number; fair: number }[];
  rules: string;
  book: OrderBook;
  candles: Candle[];
  printHistory?: {
    ticker: string;
    target: number;
    closeTime: string;
    result: "yes" | "no";
  }[];
  asOf: string;
};

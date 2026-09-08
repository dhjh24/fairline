# Fairline — agent contract

Independent fair-value desk for live Kalshi event contracts. Paper blotter, paper bot, 15-minute BTC/ETH, hourly crypto tapes, Grok overlays, calibration.

**Repo:** [dhjh24/fairline](https://github.com/dhjh24/fairline)
**Product README:** [README.md](README.md)
**Skills:** [docs/skills/README.md](docs/skills/README.md)
**Cursor:** [.cursor/rules/](.cursor/rules/) — always-on contract plus glob-attached skills

Read this file before changing the model, Kalshi fetch, blotter, bot, or calibration. Load the matching skill in `docs/skills/` for that task.

---

## Product rules (do not break)

- **No Kalshi orders.** Paper fills only. Never send live orders.
- **No auth. No database.** Book, bot, watchlist, snapshots, forecasts live in `localStorage`.
- **Do not copy last trade as fair.** Fair is the statistical model in `src/lib/model.ts`.
- **Do not fade 15-minute BTC/ETH toward 0/1.** Skip longshot γ and near-expiry convexity on `KXBTC15M` / `KXETH15M`. Skip γ on hourly BTC/ETH ladders too.
- **Do not score slam-dunks as skill.** Honest calibration = mid still 8¢–92¢ and snap ≥ 90s before close.
- **Do not block the blotter on a Kalshi desk fetch.** Lots are local; marks refresh in the background.
- **Do not parallel-fetch huge hourly series before 15m.** Fetch `KXBTC15M` and `KXETH15M` first, then the rest at concurrency 2. Kalshi 429s otherwise, and the 15m cards go missing.
- **Bot does not sell.** Only **Bought YES** (pay ask) or **Bought NO** (pay bid). Header must show ON/OFF in those words.
- **Paper book is per browser origin.** Fills on the live desk do not appear on a different preview origin.
- Auth stays **OFF**. Do not wire Better Auth / Neon for this product.

---

## Stack

TanStack Start (file routes) + React 19 + Tailwind v4 + Zustand. Kalshi public trade API. Optional xAI (`XAI_API_KEY`) for Grok overlays.

| Command | What |
|---|---|
| `npm run dev` | Vite on `0.0.0.0:8080` (Grok live preview) |
| `npm run typecheck` | `tsc --noEmit` |
| `npm run build` | Production (Vercel nitro by default) |
| `npm run preview:restart` | Built QA on `:8081` |
| `docker compose up -d --build` | Self-host, `NITRO_PRESET=node-server` |

Self-host: `.env.example` → `.env`, optional `XAI_API_KEY`. Paper state still in the browser.

---

## Routes

| Path | File | Notes |
|---|---|---|
| `/` | `src/routes/index.tsx` + `desk-view.tsx` | Desk, tapes, 15m, bot, batch Grok |
| `/market/$ticker` | `src/routes/market.$ticker.tsx` | Detail, 1-minute YES tape, sizer |
| `/blotter` | `src/routes/blotter.tsx` | Local lots. **No loader that awaits getDesk.** |
| `/calibration` | `src/routes/calibration.tsx` | Honest Brier vs market. Background desk fetch, **no loader**. |

---

## File map

| Path | Owns |
|---|---|
| `src/lib/model.ts` | Fair, signals, Kelly, **skip γ/time on 15m and hourly crypto**, `MODEL_VERSION` |
| `src/lib/fees.ts` | Kalshi taker-fee estimate (verified formula) used for net edges and fills |
| `src/lib/decisions.ts` | Typed bot decisions: gates, phases, reasons, decision log |
| `src/lib/risk.ts` | Deterministic paper limits + vetoes (`fairline-risk-v1`) |
| `src/lib/bot-config.ts` | Bot universe, sizing and gate constants (import-cycle-free) |
| `src/lib/kalshi.ts` | Public API helpers, mids, clamp |
| `src/lib/crypto.ts` | Series lists, implied spot, 15m vs hourly |
| `src/lib/desk-fn.ts` | Server fns: desk, market, settlements, candles, batch forecast |
| `src/lib/blotter.ts` | Paper lots, marks, P&L, `$1,000` start |
| `src/lib/bot.ts` | Universes, half-Kelly, idle copy, last fills |
| `src/lib/calibration.ts` | Snaps, verdicts, Brier, honest filter, skill |
| `src/lib/llm.ts` / `llm-providers.ts` | Grok adapter (4.6 / 4.5 / 4.3) |
| `src/lib/export.ts` | CSV / JSON downloads |
| `src/components/desk-view.tsx` | Marks, snapshots, bot engine |
| `src/components/crypto-tape.tsx` | Hourly ladder + implied spot |
| `src/components/crypto-15.tsx` | 15m cards, hydration-safe countdown |
| `src/components/bot-bar.tsx` | ON/OFF, last Bought YES/NO |
| `src/components/price-chart.tsx` | 1-min tape on short books |
| `src/components/settlement-loop.tsx` | Poll Kalshi results → verdicts → auto-settle lots |

`src/lib/auth/**` and `src/lib/db.ts` are scaffold leftovers. **Do not turn them on.**

---

## localStorage keys

| Key | Store |
|---|---|
| `fairline-blotter-v1` | lots + marks |
| `fairline-bot-v1` | on, universe, lastNote, lastFills |
| `fairline-calibration-v1` | snaps + verdicts |
| `fairline-forecasts-v1` | Grok overlays (12 min) |
| `fairline-watch` | watchlist tickers |

Bump the suffix if you change the persisted shape incompatibly.

---

## Kalshi

Base: `https://external-api.kalshi.com/trade-api/v2`

- Events: `GET /events?series_ticker=&status=&with_nested_markets=true`
- Market: `GET /markets/{ticker}`
- Book: `GET /markets/{ticker}/orderbook`
- Candles: `GET /series/{series}/markets/{ticker}/candlesticks?start_ts=&end_ts=&period_interval=`
  - `period_interval` is **1, 60, or 1440 only**
  - 15m and books with τ < 2 days → **1-minute**
  - Fallback: `GET /markets/candlesticks?market_tickers=`
- Settled 15m: `GET /events?status=settled&series_ticker=KXBTC15M|KXETH15M&limit=12`

Priority series in `src/lib/crypto.ts`: `KXBTC15M`, `KXETH15M` first, then `KXBTCD`, `KXETHD`, weeklies/yearlies.

15m is a **binary vs CF print** (one market per window), not an above/below ladder. Hourly BTC/ETH **are** ladders; implied spot is the 50¢ crossing.

---

## Model (fair)

`priceMarket` in `src/lib/model.ts`:

1. Mid from bid/ask/last
2. Event vig on mutually exclusive fields
3. Longshot power map γ **1.14** — **skipped on 15m and hourly crypto**
4. Near-expiry convexity — **skipped on 15m and hourly crypto**
5. Tape momentum + book imbalance, scaled by liquidity
6. Signal YES/NO only if EV after touch ≥ ~2¢ and liquidity ≥ 0.28

The 22:30 15m miss (Buy NO at ~31¢, settled YES) was γ + convexity fading a live coin. Do not reintroduce that.

---

## Paper bot

`proposeBotFills` on each desk refresh when `bot.on && hydrated`.

- Universes: `fifteen` (default), `fast` (signals closing < 6h), `signals` (all)
- Size: half-Kelly, cap 10% cash, skip fill price ≤ 2¢ or ≥ 98¢, skip < 45s to close
- Status copy must say **ON / OFF / HOLD / Bought YES / Bought NO**
- Auto-settles through the calibration loop when Kalshi resolves

---

## Calibration

1. Desk snapshots live quotes (`capture`)
2. `getSettlements` pulls Kalshi results
3. Join snap + verdict → Brier, market Brier, skill = market − model
4. Headline uses **honest** rows
5. Open paper lots on those tickers settle 100/0

Do not treat mutually exclusive hourly rungs as independent samples when talking about skill.

---

## LLM

User-initiated only (one market or **Forecast top 8**). Adapter in `src/lib/llm-providers.ts`. Cache 12 minutes in `fairline-forecasts-v1`. Needs `XAI_API_KEY`. Do not poll Grok on a timer.

---

## How to change something

| Ask | Touch | Skill |
|---|---|---|
| Fair / gamma / signals | `src/lib/model.ts` | [model](docs/skills/model.md) |
| Missing 15m / ETH / 429 | `src/lib/crypto.ts`, `desk-fn.ts` | [kalshi](docs/skills/kalshi.md) |
| Chart empty on market page | `loadCandles` in `desk-fn.ts`, `price-chart.tsx` | [kalshi](docs/skills/kalshi.md) |
| Bot ON/OFF / fills | `src/lib/bot.ts`, `bot-bar.tsx`, `desk-view.tsx` | [paper-book](docs/skills/paper-book.md) |
| Empty blotter | `src/routes/blotter.tsx` — must not require desk | [paper-book](docs/skills/paper-book.md) |
| Brier looks too good | `src/lib/calibration.ts` honest filter | [calibration](docs/skills/calibration.md) |
| New Grok model | `src/lib/llm-providers.ts` | [llm](docs/skills/llm.md) |
| Self-host / Docker | `Dockerfile`, `docker-compose.yml` | [self-host](docs/skills/self-host.md) |

After a behavior change: `npm run typecheck`, `npm run build`, smoke the desk (15m cards present, blotter loads without Kalshi), commit, push `main` on `dhjh24/fairline`.

Git identity used for this repo: `Dirk Hillard` / `174537868+dhjh24@users.noreply.github.com`.

---

## Verify before you call it done

- Desk shows **BTC 15m** and **ETH 15m** with a ticking countdown (hydration-safe: no `Date.now()` on first paint).
- Hourly tapes show implied spot, not a wall of rungs.
- Header **Bot off** / **Bot ON**. With bot on and 15m HOLD, copy says it is **not buying**.
- `/blotter` renders immediately. Empty state says the book is local, not Kalshi history.
- `/calibration` defaults to Honest. vs-market skill is signed.
- Market page for a live 15m shows **YES tape this window** (1-min) plus recent UP/DOWN prints — never “Not enough prints” just because the book is young.
- No live Kalshi order path.

---

## Likely next work (only if asked)

- SOL / other crypto tapes (copy ETH pattern in `crypto.ts`)
- Reliability by series, not pooled rungs
- Import JSON book back into localStorage
- Live Kalshi trading — **do not add unless the user explicitly asks**, and then keep paper mode default

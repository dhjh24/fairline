# Skill: paper-book

**Triggers:** blotter, bot, paper fill, P&L, export, empty blotter, buy or sell, decision log, risk limits

## Where

`src/lib/blotter.ts`, `src/lib/bot.ts`, `src/lib/decisions.ts`, `src/lib/fees.ts`,
`src/lib/risk.ts`, `src/lib/export.ts`
`src/components/bot-bar.tsx`, `blotter-view.tsx`, `desk-view.tsx`, `position-sizer.tsx`
`src/routes/blotter.tsx`

## Blotter

- Starting cash **$1000**. Touch fills: YES at ask, NO at bid.
- Every fill records the estimated **Kalshi taker fee** (see `src/lib/fees.ts`, policy
  `kalshi-taker-0.07-2026-07`) and entry cost is premium + fee. Fees reduce cash, realized and
  unrealized P&L — a breakeven at the fee-free price still loses the fee.
- Marks: Kalshi mid **and** Fairline fair on desk refresh, plus bid/ask and the desk snapshot
  time (`TickerMark`).
- `/blotter` **must not** `loader: getDesk`. If Kalshi is slow/429, the page still shows local lots.
- **Flatten is disabled when there is no executable quote** — it never silently flattens at a
  midpoint. YES lots flatten at the YES bid; NO lots flatten at the NO bid (1 − YES ask).
- Manual settles (dialog) are recorded with `settleProvenance: manual`; exchange-confirmed
  auto-settles (`settleLots`) are `exchange`. Blotter stats and CSV keep them separate.
- Empty copy: this is **not** Kalshi account history. Per-origin `localStorage`
  (`fairline-blotter-v1`, schema 2). Export JSON → Import JSON restores/replaces the book
  (`importBook` validates before writing).

## Risk limits (`src/lib/risk.ts`, `fairline-risk-v1`)

Deterministic vetoes applied inside `blotter.openLot` — manual and bot tickets count together:
ticket cost, total exposure, per-event exposure, max open positions, daily loss (today's realized
+ open unrealized market P&L), cooldown between fills. `pauseVeto` is what PAUSES the bot. Limits
are editable in the bot panel (Adjust limits).

## Bot

- Off by default. Header chip **Bot off** / **Bot ON**. Phases:
  OFF → CHECKING → HOLD / ELIGIBLE → PAPER FILLED → AWAITING SETTLEMENT, plus PAUSED / ERROR.
- There is **no sell**. Tickets are **Bought YES** or **Bought NO**.
- Default universe: 15-minute only. HOLD → “not buying.”
- Eligibility (`src/lib/decisions.ts`) is gate-based: fresh quote, not already open, >45s to close,
  price on board, model signal fires, liquidity floor, **net edge after the estimated fee ≥
  0.5¢/contract**, slot available, cash floor, positive Kelly size. Every message in the UI is
  derived from the gate results — never a disconnected string.
- Every evaluation is a typed `BotDecision` (decision id, decidedAt, quoteAt, quote age,
  modelVersion, strategyVersion, side, executable price, gross/net edge, contracts, cost, gates,
  reason) logged to `fairline-bot-v1` (capped). Last evaluation and last fill are separate.
- The bot runs while this browser tab has the desk open and hydrated — it is not a server
  process. Pausing, closing the tab, or navigating away stops evaluations until the desk refresh.

## Export

CSV: lots (incl. fee policy, fee, entry cost, settle provenance, exit basis) + scores (incl.
series group, model version, `market_brier`, `skill`, `lead_sec`, `informative`).
JSON: full local book (lots, marks, snaps, verdicts, bot) — re-importable.

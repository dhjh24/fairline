# Fairline

Independent fair-value desk for live [Kalshi](https://kalshi.com) event contracts, plus a paper blotter so you can keep score.

Fairline does **not** copy the last trade. It estimates a fair YES probability from the live book, then ranks contracts where that number disagrees with the market by enough to clear the spread.

## Model

1. **Event vig** — on mutually exclusive fields whose prices sum near 100%, the overround is removed.
2. **Longshot calibration** — a power map (γ 1.14) trims overbet longshots and lifts underbet favorites.
3. **Liquidity gate** — thin books raise the edge required before a signal fires. They do not shrink the point estimate toward 50%.
4. **Time convexity** — near-dated contracts push toward 0/1; long-dated illiquid ones fade slightly.
5. **Tape and book** — last-versus-mid and order-book imbalance, scaled by liquidity.

A YES or NO signal fires only when expected value after the ask/bid is at least 2¢ and the book is liquid enough. Optional Grok forecasts blend with the statistical fair value when you ask.

Pick a model (Grok 4.6 flagship, 4.5 balanced, or 4.3 faster) and run one contract, or **Forecast top 8** on the desk. Results cache for twelve minutes. Calls are user-initiated and spend the app owner’s xAI quota.

## Paper blotter

Log a hypothetical fill from any market’s position sizer (at the touch: YES at the ask, NO at the bid). Open lots mark to Kalshi’s mid **and** to Fairline’s fair as the desk refreshes. Flatten at the last mid, or paper-settle YES/NO. Starting cash is $1,000. Nothing is sent to Kalshi.

Lots live in the browser (`localStorage`). Clearing site data clears the book.

## Stack

TanStack Start, React 19, Tailwind v4. Live books come from Kalshi’s public trade API. Grok overlay uses the xAI API when `XAI_API_KEY` is set.

## Disclaimer

Not financial advice. Model estimates are not a promise of settlement. Kalshi is a CFTC-regulated exchange; trade there at your own risk.

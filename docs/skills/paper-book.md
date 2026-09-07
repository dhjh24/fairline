# Skill: paper-book

**Triggers:** blotter, bot, paper fill, P&L, export, empty blotter, buy or sell

## Where

`src/lib/blotter.ts`, `src/lib/bot.ts`, `src/lib/export.ts`
`src/components/bot-bar.tsx`, `blotter-view.tsx`, `desk-view.tsx`
`src/routes/blotter.tsx`

## Blotter

- Starting cash **$1000**. Touch fills: YES at ask, NO at bid.
- Marks: Kalshi mid **and** Fairline fair on desk refresh.
- `/blotter` **must not** `loader: getDesk`. If Kalshi is slow/429, the page still shows local lots.
- Empty copy: this is **not** Kalshi account history. Per-origin `localStorage` (`fairline-blotter-v1`).

## Bot

- Off by default. Header chip **Bot off** / **Bot ON**.
- There is **no sell**. Tickets are **Bought YES** or **Bought NO**.
- Default universe: 15-minute only. HOLD → “not buying.”
- Half-Kelly, max 10% cash, skip < 45s to close, skip 2¢/98¢.
- Persist last fills (`fairline-bot-v1`) so the desk can show the last ticket after refresh.

## Export

CSV: lots + scores (include `market_brier`, `skill`, `lead_sec`, `informative`).
JSON: full local book (lots, marks, snaps, verdicts, bot). Import is not built yet.

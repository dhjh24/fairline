# Skill: llm

**Triggers:** Grok, batch forecast, overlay, provider adapter, xAI

## Where

`src/lib/llm-providers.ts` — Grok 4.6 / 4.5 / 4.3.
`src/lib/llm.ts` — prompt, blend, cache.
`src/components/forecast-bar.tsx`, `grok-panel.tsx`, `provider-picker.tsx`.

## Rules

- User-initiated only. **Forecast top 8** or one market. Do not poll.
- Cache ~12 minutes in `fairline-forecasts-v1`.
- Blend Grok probability with statistical fair in the panel; do not replace the book silently.
- `XAI_API_KEY` required. If missing, the UI should say so — do not fake a forecast.
- Adding Claude/OpenAI: new adapter row in `LLM_PROVIDERS` + env key. Keep the same `{ probability, confidence, thesis, factors, risks }` shape.

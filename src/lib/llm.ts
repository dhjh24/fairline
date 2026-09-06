import {
  getProvider,
  type LlmProvider,
} from "@/lib/llm-providers";
import { blendWithGrok } from "@/lib/model";
import type { GrokFactor, GrokForecast } from "@/lib/types";

export type ForecastSnapshot = {
  ticker: string;
  title: string;
  eventTitle: string;
  category: string;
  closeTime: string;
  bid: number;
  ask: number;
  last: number;
  fair: number;
  mid?: number;
  fieldSize: number;
  fieldSum: number;
  rules?: string;
};

export { getProvider, LLM_PROVIDERS, DEFAULT_PROVIDER_ID, BATCH_SIZE } from "@/lib/llm-providers";
export type { LlmProvider } from "@/lib/llm-providers";

function keyFor(p: LlmProvider): string | undefined {
  return process.env[p.envKey];
}

function extractJson(text: string): unknown {
  const trimmed = text.trim();
  const fence = trimmed.match(/```(?:json)?\s*([\s\S]*?)```/);
  const raw = fence?.[1]?.trim() ?? trimmed;
  return JSON.parse(raw);
}

async function completeJson(
  provider: LlmProvider,
  messages: { role: "system" | "user"; content: string }[],
): Promise<{ ok: true; text: string } | { ok: false; error: string }> {
  const apiKey = keyFor(provider);
  if (!apiKey) {
    return { ok: false, error: `${provider.label} is not available in this environment.` };
  }

  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), provider.timeoutMs);
  try {
    const res = await fetch(`${provider.baseUrl}/chat/completions`, {
      method: "POST",
      signal: ctrl.signal,
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify({
        model: provider.model,
        temperature: 0.2,
        max_tokens: 700,
        response_format: { type: "json_object" },
        messages,
      }),
    });
    if (!res.ok) {
      return { ok: false, error: `${provider.label} request failed (${res.status}).` };
    }
    const body = (await res.json()) as {
      choices?: { message?: { content?: string } }[];
    };
    const text = body.choices?.[0]?.message?.content ?? "";
    if (!text) return { ok: false, error: `${provider.label} returned an empty forecast.` };
    return { ok: true, text };
  } catch {
    return { ok: false, error: `${provider.label} timed out. Try again in a moment.` };
  } finally {
    clearTimeout(timer);
  }
}

function buildPrompt(m: ForecastSnapshot): string {
  return [
    "You are a calibrated superforecaster pricing a Kalshi YES/NO event contract.",
    "Estimate the true probability that YES settles, independently of the market price.",
    "Be well-calibrated. Avoid 0.50 unless the event is truly a coin flip. Do not parrot the market.",
    "Return JSON only with keys: probability (0-1 number), confidence (0-1), thesis (2-4 sentences),",
    'factors (array of {name, direction: "up"|"down", note}), risks (string array).',
    "",
    `Title: ${m.title}`,
    `Event: ${m.eventTitle}`,
    `Category: ${m.category}`,
    `Closes: ${m.closeTime}`,
    `Market bid/ask/last: ${m.bid} / ${m.ask} / ${m.last}`,
    `Statistical fair value: ${m.fair.toFixed(4)}`,
    `Mutually exclusive field size: ${m.fieldSize}, sum of mids: ${m.fieldSum.toFixed(3)}`,
    m.rules ? `Rules: ${m.rules.slice(0, 800)}` : "",
  ]
    .filter(Boolean)
    .join("\n");
}

export async function forecastMarket(
  snapshot: ForecastSnapshot,
  providerId?: string,
): Promise<GrokForecast> {
  const provider = getProvider(providerId);
  const raw = await completeJson(provider, [
    { role: "system", content: "You output only valid JSON. No markdown." },
    { role: "user", content: buildPrompt(snapshot) },
  ]);
  if (!raw.ok) return raw;

  try {
    const parsed = extractJson(raw.text) as {
      probability?: number;
      confidence?: number;
      thesis?: string;
      factors?: { name?: string; direction?: string; note?: string }[];
      risks?: string[];
    };
    const probability = Number(parsed.probability);
    const confidence = Number(parsed.confidence);
    if (!Number.isFinite(probability)) {
      return { ok: false, error: `${provider.label} returned an unreadable probability.` };
    }
    const p = Math.min(0.99, Math.max(0.01, probability));
    const c = Number.isFinite(confidence) ? Math.min(1, Math.max(0, confidence)) : 0.5;
    const factors: GrokFactor[] = (parsed.factors ?? []).slice(0, 6).map((f) => ({
      name: String(f.name ?? "Factor"),
      direction: f.direction === "down" ? "down" : "up",
      note: String(f.note ?? "").slice(0, 240),
    }));
    return {
      ok: true,
      probability: p,
      confidence: c,
      thesis: String(parsed.thesis ?? "").slice(0, 1200),
      factors,
      risks: (parsed.risks ?? []).slice(0, 5).map((r) => String(r).slice(0, 240)),
      blended: blendWithGrok(snapshot.fair, p, c),
      providerId: provider.id,
      model: provider.model,
    };
  } catch {
    return { ok: false, error: `Could not parse ${provider.label}'s forecast.` };
  }
}

const FORECAST_TTL_MS = 12 * 60_000;
const memoryCache = new Map<string, { at: number; result: Extract<GrokForecast, { ok: true }> }>();

function cacheKey(providerId: string, ticker: string, fair: number): string {
  return `${providerId}:${ticker}:${fair.toFixed(3)}`;
}

export async function forecastMarketCached(
  snapshot: ForecastSnapshot,
  providerId?: string,
): Promise<GrokForecast> {
  const provider = getProvider(providerId);
  const key = cacheKey(provider.id, snapshot.ticker, snapshot.fair);
  const hit = memoryCache.get(key);
  if (hit && Date.now() - hit.at < FORECAST_TTL_MS) return hit.result;
  const result = await forecastMarket(snapshot, provider.id);
  if (result.ok) memoryCache.set(key, { at: Date.now(), result });
  return result;
}

export async function mapPool<T, R>(
  items: T[],
  concurrency: number,
  fn: (item: T, index: number) => Promise<R>,
): Promise<R[]> {
  const out: R[] = new Array(items.length);
  let i = 0;
  const workers = Array.from({ length: Math.min(concurrency, items.length) }, async () => {
    while (i < items.length) {
      const idx = i++;
      out[idx] = await fn(items[idx]!, idx);
    }
  });
  await Promise.all(workers);
  return out;
}

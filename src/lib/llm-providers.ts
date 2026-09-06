export type LlmProvider = {
  id: string;
  label: string;
  hint: string;
  vendor: "xai";
  model: string;
  baseUrl: string;
  envKey: "XAI_API_KEY";
  timeoutMs: number;
};

export const LLM_PROVIDERS: LlmProvider[] = [
  {
    id: "grok-4.6",
    label: "Grok 4.6",
    hint: "Flagship",
    vendor: "xai",
    model: "grok-4.6",
    baseUrl: "https://api.x.ai/v1",
    envKey: "XAI_API_KEY",
    timeoutMs: 28_000,
  },
  {
    id: "grok-4.5",
    label: "Grok 4.5",
    hint: "Balanced",
    vendor: "xai",
    model: "grok-4.5",
    baseUrl: "https://api.x.ai/v1",
    envKey: "XAI_API_KEY",
    timeoutMs: 22_000,
  },
  {
    id: "grok-4.3",
    label: "Grok 4.3",
    hint: "Faster",
    vendor: "xai",
    model: "grok-4.3",
    baseUrl: "https://api.x.ai/v1",
    envKey: "XAI_API_KEY",
    timeoutMs: 18_000,
  },
];

export const DEFAULT_PROVIDER_ID = "grok-4.5";
export const BATCH_SIZE = 8;

export function getProvider(id: string | undefined): LlmProvider {
  return LLM_PROVIDERS.find((p) => p.id === id) ?? LLM_PROVIDERS[1]!;
}

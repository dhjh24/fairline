import { create } from "zustand";
import { MAX_DECISION_LOG, type BotUniverse } from "./bot-config.ts";
import type { BotLogEntry, BotPhase } from "./decisions.ts";

const KEY = "fairline-bot-v1";

export type { BotUniverse } from "./bot-config.ts";
export {
  CLOSE_SKIP_MS,
  FRESH_QUOTE_MS,
  MAX_CONTRACTS,
  MAX_DECISION_LOG,
  MAX_EXEC_PRICE,
  MAX_FILLS_PER_TICK,
  MAX_OPEN_BOT,
  MAX_SHARE,
  MIN_CASH,
  MIN_EXEC_EDGE,
  MIN_EXEC_PRICE,
  STRATEGY_VERSION,
  universeLabel,
  inUniverse,
} from "./bot-config.ts";

export type BotFillLog = {
  ticker: string;
  title: string;
  side: "yes" | "no";
  contracts: number;
  fillPrice: number;
  at: string;
};

export type BotSettings = {
  on: boolean;
  universe: BotUniverse;
  lastNote: string;
  lastAt: string;
  sessionFills: number;
  lastFills: BotFillLog[];
};

type BotState = BotSettings & {
  hydrated: boolean;
  /** Last decision phase: OFF → CHECKING → HOLD/ELIGIBLE → PAPER FILLED → AWAITING SETTLEMENT. */
  phase: BotPhase;
  /** Latest full evaluation (HOLD or ELIGIBLE), separate from the last fill. */
  lastEval?: {
    at: string;
    note: string;
    reason: string;
    decisionCount: number;
    eligibleCount: number;
  };
  /** Last executed paper fill, separate from the last evaluation. */
  lastFillAt?: string;
  /** On-desk decision log (capped). */
  decisionLog: BotLogEntry[];
  error: string | null;
  hydrate: () => void;
  setOn: (on: boolean) => void;
  setUniverse: (universe: BotUniverse) => void;
  /** Update the ON/OFF summary note (kept for legacy callers). */
  watching: (text: string) => void;
  /** Record one evaluation tick. */
  recordEval: (input: {
    phase: BotPhase;
    note: string;
    reason?: string;
    decisions: BotLogEntry[];
    eligibleCount?: number;
    error?: string | null;
  }) => void;
  /** Record executed fills (PAPER FILLED). */
  filled: (rows: BotFillLog[]) => void;
  clearError: () => void;
  reset: () => void;
};

const DEFAULTS: BotSettings = {
  on: false,
  universe: "fifteen",
  lastNote: "",
  lastAt: "",
  sessionFills: 0,
  lastFills: [],
};

function readFills(v: unknown): BotFillLog[] {
  if (!Array.isArray(v)) return [];
  const out: BotFillLog[] = [];
  for (const row of v) {
    if (!row || typeof row !== "object") continue;
    const r = row as BotFillLog;
    if (typeof r.ticker !== "string") continue;
    if (r.side !== "yes" && r.side !== "no") continue;
    out.push({
      ticker: r.ticker,
      title: typeof r.title === "string" ? r.title : r.ticker,
      side: r.side,
      contracts: typeof r.contracts === "number" ? r.contracts : 0,
      fillPrice: typeof r.fillPrice === "number" ? r.fillPrice : 0,
      at: typeof r.at === "string" ? r.at : "",
    });
  }
  return out.slice(0, 8);
}

function readLog(v: unknown): BotLogEntry[] {
  if (!Array.isArray(v)) return [];
  const out: BotLogEntry[] = [];
  for (const row of v) {
    if (!row || typeof row !== "object") continue;
    const r = row as BotLogEntry;
    if (typeof r.id !== "string" || typeof r.at !== "string") continue;
    out.push({
      id: r.id,
      at: r.at,
      ticker: typeof r.ticker === "string" ? r.ticker : "",
      title: typeof r.title === "string" ? r.title : "",
      phase: (r.phase as BotPhase) || "HOLD",
      side: r.side === "yes" || r.side === "no" ? r.side : undefined,
      contracts: typeof r.contracts === "number" ? r.contracts : undefined,
      edgeAfterCost: typeof r.edgeAfterCost === "number" ? r.edgeAfterCost : undefined,
      reason: typeof r.reason === "string" ? r.reason : "",
    });
  }
  return out.slice(0, MAX_DECISION_LOG);
}

function read(): BotSettings & {
  phase: BotPhase;
  lastEval?: BotState["lastEval"];
  lastFillAt?: string;
  decisionLog: BotLogEntry[];
  error: string | null;
} {
  if (typeof window === "undefined") {
    return { ...DEFAULTS, phase: "OFF", decisionLog: [], error: null };
  }
  try {
    const raw = window.localStorage.getItem(KEY);
    if (!raw) return { ...DEFAULTS, phase: "OFF", decisionLog: [], error: null };
    const p = JSON.parse(raw) as Partial<
      BotState & { phase?: string; decisionLog?: unknown; lastEval?: unknown; error?: string }
    >;
    const phase = (["OFF", "CHECKING", "HOLD", "ELIGIBLE", "PAPER FILLED", "AWAITING SETTLEMENT", "PAUSED", "ERROR"] as const).includes(
      p.phase as BotPhase,
    )
      ? (p.phase as BotPhase)
      : p.on
        ? "HOLD"
        : "OFF";
    const lastEvalRaw = p.lastEval as BotState["lastEval"] | undefined;
    return {
      on: Boolean(p.on),
      universe: p.universe === "fast" || p.universe === "signals" ? p.universe : "fifteen",
      lastNote: typeof p.lastNote === "string" ? p.lastNote : "",
      lastAt: typeof p.lastAt === "string" ? p.lastAt : "",
      sessionFills: typeof p.sessionFills === "number" ? p.sessionFills : 0,
      lastFills: readFills(p.lastFills),
      phase,
      lastEval:
        lastEvalRaw && typeof lastEvalRaw.at === "string"
          ? {
              at: lastEvalRaw.at,
              note: typeof lastEvalRaw.note === "string" ? lastEvalRaw.note : "",
              reason: typeof lastEvalRaw.reason === "string" ? lastEvalRaw.reason : "",
              decisionCount: typeof lastEvalRaw.decisionCount === "number" ? lastEvalRaw.decisionCount : 0,
              eligibleCount: typeof lastEvalRaw.eligibleCount === "number" ? lastEvalRaw.eligibleCount : 0,
            }
          : undefined,
      lastFillAt: typeof p.lastFillAt === "string" ? p.lastFillAt : undefined,
      decisionLog: readLog(p.decisionLog),
      error: typeof p.error === "string" ? p.error : null,
    };
  } catch {
    return { ...DEFAULTS, phase: "OFF", decisionLog: [], error: null };
  }
}

function write(s: {
  on: boolean;
  universe: BotUniverse;
  lastNote: string;
  lastAt: string;
  sessionFills: number;
  lastFills: BotFillLog[];
  phase: BotPhase;
  lastEval?: BotState["lastEval"];
  lastFillAt?: string;
  decisionLog: BotLogEntry[];
  error: string | null;
}) {
  if (typeof window === "undefined") return;
  const { phase, lastEval, lastFillAt, decisionLog, error, ...rest } = s;
  window.localStorage.setItem(KEY, JSON.stringify({ ...rest, phase, lastEval, lastFillAt, decisionLog, error }));
}

function snapshot(
  s: BotState,
  patch: Partial<
    Pick<BotState, "on" | "universe" | "lastNote" | "lastFills" | "sessionFills" | "phase" | "lastEval" | "lastFillAt" | "decisionLog" | "error">
  >,
): BotState {
  const next = { ...s, ...patch, lastAt: new Date().toISOString() };
  write(next);
  return next;
}

export function describeFill(row: { side: "yes" | "no"; contracts: number; fillPrice: number; title: string }): string {
  const px = `${Math.round(row.fillPrice * 100)}¢`;
  return `Bought ${row.side.toUpperCase()} · ${row.contracts} × ${row.title} @ ${px}`;
}

export const useBot = create<BotState>((set, get) => ({
  ...DEFAULTS,
  hydrated: false,
  phase: "OFF",
  decisionLog: [],
  error: null,
  hydrate: () => {
    if (get().hydrated) return;
    const persisted = read();
    set({ ...persisted, hydrated: true });
  },
  setOn: (on) => {
    set((s) =>
      snapshot(s, {
        on,
        phase: on ? (s.phase === "PAUSED" || s.phase === "ERROR" ? s.phase : "CHECKING") : "OFF",
        lastNote: on
          ? `ON. Watching for Fairline Buy YES / Buy NO. Paper only — nothing goes to Kalshi.`
          : "OFF. Not buying.",
        error: null,
      }),
    );
  },
  setUniverse: (universe) => {
    set((s) => ({ ...snapshot(s, { universe }), hydrated: true }));
  },
  watching: (text) => {
    set((s) => {
      if (s.lastNote === text) return s;
      return { ...snapshot(s, { lastNote: text }), hydrated: true };
    });
  },
  recordEval: (input) => {
    const at = new Date().toISOString();
    set((s) => {
      const entry: BotLogEntry[] =
        input.decisions.length > 0
          ? [...input.decisions, ...s.decisionLog].slice(0, MAX_DECISION_LOG)
          : s.decisionLog;
      const next = snapshot(s, {
        phase: input.phase,
        lastNote: input.note,
        lastEval: {
          at,
          note: input.note,
          reason: input.reason ?? input.note,
          decisionCount: input.decisions.length,
          eligibleCount: input.eligibleCount ?? 0,
        },
        decisionLog: entry,
        error: input.error ?? null,
      });
      return { ...next, hydrated: true };
    });
  },
  filled: (rows) => {
    if (rows.length === 0) return;
    set((s) => {
      const lastFills = [...rows, ...s.lastFills].slice(0, 8);
      const lastNote = rows.map(describeFill).join(" · ");
      const at = new Date().toISOString();
      const entry: BotLogEntry[] = [
        ...rows.map((r) => ({
          id: `fill-${r.ticker}-${at}`,
          at,
          ticker: r.ticker,
          title: r.title,
          phase: "PAPER FILLED" as const,
          side: r.side,
          contracts: r.contracts,
          reason: describeFill(r),
        })),
        ...s.decisionLog,
      ].slice(0, MAX_DECISION_LOG);
      return {
        ...snapshot(s, {
          lastFills,
          lastNote,
          sessionFills: s.sessionFills + rows.length,
          phase: "PAPER FILLED",
          lastFillAt: at,
          decisionLog: entry,
        }),
        hydrated: true,
      };
    });
  },
  clearError: () => {
    set((s) => ({ ...snapshot(s, { error: null }), hydrated: true }));
  },
  reset: () => {
    const base = { ...DEFAULTS, phase: "OFF" as BotPhase, lastEval: undefined, lastFillAt: undefined, decisionLog: [] as BotLogEntry[], error: null };
    write(base);
    set({ ...base, hydrated: true });
  },
}));

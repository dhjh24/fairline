import { Link } from "@tanstack/react-router";
import { useMemo, useState } from "react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogTrigger } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { blotterTotals, useBlotter } from "@/lib/blotter";
import { describeFill, useBot, type BotUniverse } from "@/lib/bot";
import { useRisk } from "@/lib/risk";
import type { BotPhase } from "@/lib/decisions";
import { relativeClose, usd, pct } from "@/lib/format";
import { cn } from "@/lib/utils";

const UNIVERSES: { id: BotUniverse; label: string; hint: string }[] = [
  { id: "fifteen", label: "15-minute", hint: "15-minute BTC, ETH and gold up/down prints" },
  { id: "fast", label: "Fast", hint: "Buy YES / Buy NO closing within 6 hours" },
  { id: "signals", label: "All signals", hint: "Every Buy YES / Buy NO on the desk" },
];

const PHASE_LABEL: Record<BotPhase, string> = {
  OFF: "OFF",
  CHECKING: "CHECKING",
  HOLD: "HOLD",
  ELIGIBLE: "ELIGIBLE",
  "PAPER FILLED": "PAPER FILLED",
  "AWAITING SETTLEMENT": "AWAITING SETTLEMENT",
  PAUSED: "PAUSED",
  ERROR: "ERROR",
};

function RiskInput({
  label,
  value,
  onChange,
}: {
  label: string;
  value: number;
  onChange: (v: number) => void;
}) {
  return (
    <label className="block text-xs text-muted">
      {label}
      <Input
        type="number"
        min={0}
        value={value}
        onChange={(e) => onChange(Math.max(0, Number(e.target.value) || 0))}
        className="mt-1"
      />
    </label>
  );
}

function phaseTone(phase: BotPhase): string {
  switch (phase) {
    case "OFF":
    case "CHECKING":
      return "bg-elevated text-muted";
    case "HOLD":
    case "AWAITING SETTLEMENT":
      return "bg-elevated text-accent";
    case "ELIGIBLE":
    case "PAPER FILLED":
      return "bg-yes-dim text-yes";
    case "PAUSED":
    case "ERROR":
      return "bg-no-dim text-no";
    default:
      return "bg-elevated text-muted";
  }
}

export function BotBar({
  error,
  onDismissError,
}: {
  error?: string | null;
  onDismissError?: () => void;
}) {
  const on = useBot((s) => s.on);
  const universe = useBot((s) => s.universe);
  const phase = useBot((s) => s.phase);
  const lastNote = useBot((s) => s.lastNote);
  const lastFills = useBot((s) => s.lastFills);
  const decisionLog = useBot((s) => s.decisionLog);
  const lastEval = useBot((s) => s.lastEval);
  const lastFillAt = useBot((s) => s.lastFillAt);
  const setOn = useBot((s) => s.setOn);
  const setUniverse = useBot((s) => s.setUniverse);
  const lots = useBlotter((s) => s.lots);
  const marks = useBlotter((s) => s.marks);
  const riskSettings = useRisk((s) => s.settings);
  const updateRisk = useRisk((s) => s.update);
  const resetRisk = useRisk((s) => s.reset);
  const [showLog, setShowLog] = useState(false);

  const botLots = useMemo(
    () => lots.filter((l) => l.source === "bot" && l.closeReason !== "void"),
    [lots],
  );
  const openBot = useMemo(() => botLots.filter((l) => l.status === "open"), [botLots]);
  const totals = useMemo(() => blotterTotals(botLots, marks), [botLots, marks]);
  const pnl = totals.realized + totals.unrealizedMarket;
  const exposed = openBot.reduce((s, l) => s + l.fillPrice * l.contracts + (l.feeUsd ?? 0), 0);
  const shownPhase: BotPhase = !on ? "OFF" : phase;
  const lastDecision = decisionLog[0];

  return (
    <section id="paper-bot" className="rounded-xl bg-surface px-4 py-4 shadow-[var(--shadow-border)] md:px-5">
      <div className="flex flex-col gap-3 md:flex-row md:items-start md:justify-between">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            <p className="text-xs font-medium tracking-wide text-subtle uppercase">Paper bot</p>
            <span
              role="status"
              className={cn(
                "inline-flex items-center gap-1.5 rounded-full px-2 py-0.5 text-xs font-medium",
                phaseTone(shownPhase),
              )}
            >
              {shownPhase === "CHECKING" || shownPhase === "ELIGIBLE" ? (
                <span className="live-dot size-1.5 rounded-full bg-yes" />
              ) : null}
              {PHASE_LABEL[shownPhase]}
            </span>
            <span className="text-xs text-muted">
              watching {UNIVERSES.find((u) => u.id === universe)?.hint}
            </span>
          </div>
          <p className="mt-1 text-sm text-muted">
            {on
              ? "Buys YES at the ask or NO at the bid when Fairline fires and the edge clears the estimated fee. It does not sell, and it does not send orders to Kalshi."
              : "OFF. It will not buy until you turn it on."}
          </p>
        </div>
        <Button type="button" size="sm" variant={on ? "yes" : "secondary"} onClick={() => setOn(!on)}>
          {on ? "Turn off" : "Turn on"}
        </Button>
      </div>

      <div className="mt-3 flex flex-wrap items-center gap-2">
        {UNIVERSES.map((u) => (
          <button
            key={u.id}
            type="button"
            onClick={() => setUniverse(u.id)}
            aria-pressed={universe === u.id}
            className={cn(
              "h-8 rounded-full px-3 text-xs transition-colors duration-150",
              universe === u.id ? "bg-accent text-accent-fg" : "bg-elevated text-muted hover:text-fg",
            )}
          >
            {u.label}
          </button>
        ))}
      </div>

      {error ? (
        <div className="mt-3 flex flex-wrap items-center justify-between gap-2 rounded-md bg-no-dim px-3 py-2 text-sm text-no">
          <span>{error}</span>
          {onDismissError ? (
            <Button type="button" size="sm" variant="ghost" onClick={onDismissError}>
              Dismiss
            </Button>
          ) : null}
        </div>
      ) : null}

      <div className="mt-3 rounded-md bg-elevated px-3 py-2 text-sm text-fg">
        {on ? lastNote || "ON. Waiting for the next desk refresh." : "OFF. Not buying YES or NO."}
      </div>

      <div className="mt-3 grid gap-3 text-xs sm:grid-cols-2 lg:grid-cols-4">
        <div className="rounded-md bg-surface p-2.5 shadow-[var(--shadow-border)]">
          <p className="text-subtle">Last evaluation</p>
          <p className="mt-0.5 text-fg">
            {lastEval ? `${lastEval.note} · ${relativeClose(lastEval.at)}` : "—"}
          </p>
        </div>
        <div className="rounded-md bg-surface p-2.5 shadow-[var(--shadow-border)]">
          <p className="text-subtle">Last fill</p>
          <p className="mt-0.5 truncate text-fg">
            {lastFillAt
              ? lastFills[0]
                ? describeFill(lastFills[0])
                : relativeClose(lastFillAt)
              : "—"}
          </p>
        </div>
        <div className="rounded-md bg-surface p-2.5 shadow-[var(--shadow-border)]">
          <p className="text-subtle">Bot exposure</p>
          <p className="mt-0.5 tabular-nums text-fg">${exposed.toFixed(2)}</p>
        </div>
        <div className="rounded-md bg-surface p-2.5 shadow-[var(--shadow-border)]">
          <p className="text-subtle">Paper risk limits</p>
          <p className="mt-0.5 tabular-nums text-muted">
            ${riskSettings.ticketCostMax}/ticket · ${riskSettings.exposureMax} exposure
          </p>
          <Dialog>
            <DialogTrigger asChild>
              <button type="button" className="mt-1 text-xs text-accent hover:text-fg">
                Adjust limits
              </button>
            </DialogTrigger>
            <DialogContent title="Paper risk limits">
              <p className="text-sm text-muted">
                Deterministic gates applied to every paper fill — manual and bot tickets count
                together. These live in this browser only.
              </p>
              <div className="mt-4 grid grid-cols-2 gap-3 text-sm">
                <RiskInput
                  label="Max per ticket ($)"
                  value={riskSettings.ticketCostMax}
                  onChange={(v) => updateRisk({ ticketCostMax: v })}
                />
                <RiskInput
                  label="Max exposure ($)"
                  value={riskSettings.exposureMax}
                  onChange={(v) => updateRisk({ exposureMax: v })}
                />
                <RiskInput
                  label="Max per event ($)"
                  value={riskSettings.eventExposureMax}
                  onChange={(v) => updateRisk({ eventExposureMax: v })}
                />
                <RiskInput
                  label="Max open positions"
                  value={riskSettings.openMax}
                  onChange={(v) => updateRisk({ openMax: v })}
                />
                <RiskInput
                  label="Daily loss limit ($)"
                  value={riskSettings.dailyLossMax}
                  onChange={(v) => updateRisk({ dailyLossMax: v })}
                />
                <RiskInput
                  label="Cooldown (sec)"
                  value={Math.round(riskSettings.cooldownMs / 1000)}
                  onChange={(v) => updateRisk({ cooldownMs: v * 1000 })}
                />
              </div>
              <Button type="button" size="sm" variant="ghost" className="mt-4" onClick={() => resetRisk()}>
                Reset to defaults
              </Button>
            </DialogContent>
          </Dialog>
        </div>
      </div>

      {lastDecision && on ? (
        <div className="mt-3">
          <button
            type="button"
            onClick={() => setShowLog((v) => !v)}
            aria-expanded={showLog}
            className="flex w-full items-center justify-between gap-3 rounded-md bg-elevated px-3 py-2 text-left text-sm"
          >
            <span className="truncate">
              <span className="text-muted">Why this refresh · </span>
              <span className="text-fg">{lastDecision.reason}</span>
            </span>
            <span className="shrink-0 text-xs text-subtle">{showLog ? "Hide log" : "Show log"}</span>
          </button>
          {showLog ? (
            <ol className="mt-2 divide-y divide-border rounded-md bg-elevated px-3">
              {decisionLog.slice(0, 10).map((entry) => (
                <li key={entry.id} className="flex items-center justify-between gap-3 py-2 text-xs">
                  <span className="min-w-0 flex-1">
                    <span
                      className={cn(
                        "mr-1 inline-block w-14 font-medium",
                        entry.phase === "PAPER FILLED" || entry.phase === "ELIGIBLE"
                          ? "text-yes"
                          : entry.phase === "HOLD"
                            ? "text-muted"
                            : entry.phase === "PAUSED" || entry.phase === "ERROR"
                              ? "text-no"
                              : "text-accent",
                      )}
                    >
                      {entry.phase}
                    </span>
                    <span className="truncate text-fg">{entry.reason}</span>
                  </span>
                  <span className="shrink-0 text-subtle tabular-nums">
                    {relativeClose(entry.at)}
                  </span>
                </li>
              ))}
            </ol>
          ) : null}
        </div>
      ) : null}

      {openBot.length > 0 ? (
        <ol className="mt-3 divide-y divide-border rounded-md bg-elevated">
          {openBot.slice(0, 6).map((lot) => (
            <li key={lot.id} className="flex items-center justify-between gap-3 px-3 py-2 text-sm">
              <span className="min-w-0 truncate">
                <span className={lot.side === "yes" ? "text-yes" : "text-no"}>
                  Bought {lot.side.toUpperCase()}
                </span>
                <span className="text-muted"> · {lot.contracts} × {lot.title} @ {pct(lot.fillPrice, 0)}</span>
              </span>
              <Link to="/blotter" className="shrink-0 text-xs text-subtle hover:text-fg">
                open
              </Link>
            </li>
          ))}
        </ol>
      ) : null}

      <div className="mt-4 flex flex-wrap items-end gap-x-6 gap-y-2 border-t border-border pt-3">
        <Link to="/blotter" className="block">
          <p className="text-[11px] tracking-wide text-subtle uppercase">Bot P&L</p>
          <p
            className={cn(
              "font-mono text-lg tabular-nums",
              pnl > 0 ? "text-yes" : pnl < 0 ? "text-no" : "text-fg",
            )}
          >
            {usd(pnl)}
          </p>
        </Link>
        <div>
          <p className="text-[11px] tracking-wide text-subtle uppercase">Open</p>
          <p className="font-mono text-lg tabular-nums">{totals.openCount}</p>
        </div>
        <div>
          <p className="text-[11px] tracking-wide text-subtle uppercase">Fills</p>
          <p className="font-mono text-lg tabular-nums">{botLots.length}</p>
        </div>
        <p className="ml-auto max-w-xs text-right text-[10px] leading-relaxed text-subtle">
          Runs in this browser tab while the desk is open — it is not a server process. Pausing,
          closing the tab or navigating away stops evaluations until the desk refreshes again.
        </p>
      </div>
    </section>
  );
}

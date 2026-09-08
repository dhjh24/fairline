import { Link } from "@tanstack/react-router";
import { useMemo, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogTrigger } from "@/components/ui/dialog";

import {
  STARTING_CASH,
  blotterTotals,
  lotEntryCost,
  lotPnl,
  sideMark,
  useBlotter,
  type BlotterLot,
  type TickerMark,
} from "@/lib/blotter";
import { scoredRows, useCalibration } from "@/lib/calibration";
import { useBot } from "@/lib/bot";
import { exportBlotterCsv, exportBookJson } from "@/lib/export";
import { pct, relativeClose, usd } from "@/lib/format";
import { cn } from "@/lib/utils";

type Filter = "open" | "closed" | "bot" | "manual" | "all";

export function BlotterView() {
  const lots = useBlotter((s) => s.lots);
  const marks = useBlotter((s) => s.marks);
  const closeLot = useBlotter((s) => s.closeLot);
  const voidLot = useBlotter((s) => s.voidLot);
  const reset = useBlotter((s) => s.reset);
  const importBook = useBlotter((s) => s.importBook);
  const snaps = useCalibration((s) => s.snaps);
  const verdicts = useCalibration((s) => s.verdicts);
  const bot = useBot();
  const [filter, setFilter] = useState<Filter>("all");
  const [importMsg, setImportMsg] = useState<string | null>(null);
  const [importError, setImportError] = useState<string | null>(null);
  const fileRef = useRef<HTMLInputElement | null>(null);
  const totals = useMemo(() => blotterTotals(lots, marks), [lots, marks]);

  const exchangeClosed = useMemo(
    () =>
      lots.filter((l) => l.status === "closed" && l.closeReason !== "void" && l.settleProvenance === "exchange"),
    [lots],
  );
  const manualClosed = useMemo(
    () =>
      lots.filter((l) => l.status === "closed" && l.closeReason !== "void" && l.settleProvenance !== "exchange"),
    [lots],
  );

  const visible = useMemo(() => {
    const rows = lots.filter((l) => l.closeReason !== "void");
    if (filter === "open") return rows.filter((l) => l.status === "open");
    if (filter === "closed") return rows.filter((l) => l.status === "closed");
    if (filter === "bot") return rows.filter((l) => l.source === "bot");
    if (filter === "manual") return rows.filter((l) => l.source !== "bot");
    return rows;
  }, [lots, filter]);

  const visibleLots = lots.filter((l) => l.closeReason !== "void");

  function onImportFile(file: File | undefined) {
    setImportMsg(null);
    setImportError(null);
    if (!file) return;
    const reader = new FileReader();
    reader.onload = () => {
      const text = String(reader.result ?? "");
      const res = importBook(text);
      if (res.ok) {
        setImportMsg(`Imported ${res.lots} paper lots. Fills and marks were replaced from the JSON book.`);
      } else {
        setImportError(res.error);
      }
      if (fileRef.current) fileRef.current.value = "";
    };
    reader.onerror = () => {
      setImportError("Could not read that file.");
      if (fileRef.current) fileRef.current.value = "";
    };
    reader.readAsText(file);
  }

  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-col gap-3">
        <div>
          <h1 className="text-3xl font-medium tracking-tight md:text-4xl">Paper blotter</h1>
          <p className="mt-2 max-w-xl text-sm leading-relaxed text-muted">
            Hypothetical fills at the touch, net of the estimated Kalshi taker fee. This book
            lives in this browser — it is not a Kalshi order history. The paper bot only fills
            when it is ON and Fairline says Buy YES or Buy NO. Starting cash
            ${STARTING_CASH.toLocaleString()}.
          </p>
        </div>
      </div>

      <section className="grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-6">
        <Stat label="Equity" value={`$${totals.equityMarket.toFixed(2)}`} hint="Mark to market, net of fees" />
        <Stat
          label="Realized"
          value={usd(totals.realized)}
          tone={totals.realized}
          hint="Closed fills, net of fees"
        />
        <Stat
          label="Unrealized (market)"
          value={usd(totals.unrealizedMarket)}
          tone={totals.unrealizedMarket}
        />
        <Stat
          label="Unrealized (model)"
          value={usd(totals.unrealizedModel)}
          tone={totals.unrealizedModel}
        />
        <Stat label="Open lots" value={String(totals.openCount)} hint={`${totals.closedCount} closed`} />
        <Stat label="Cash" value={`$${totals.cash.toFixed(2)}`} hint={`Fees paid $${totals.feesPaid.toFixed(2)}`} />
      </section>

      <section className="grid grid-cols-2 gap-2 sm:grid-cols-4">
        <Stat label="Closed by Kalshi" value={String(exchangeClosed.length)} hint="Auto-settled from exchange result" />
        <Stat label="Closed manually" value={String(manualClosed.length)} hint="Flatten / manual settle / void" />
        <Stat label="Bot fills" value={String(bot.sessionFills)} hint="This browser session" />
        <Stat label="Estimated fees" value={`$${totals.feesPaid.toFixed(2)}`} hint="Taker fee per ticket at fill" />
      </section>

      <div className="flex flex-wrap gap-2">
        {(
          [
            ["open", "Open"],
            ["closed", "Closed"],
            ["bot", "Bot"],
            ["manual", "Manual"],
            ["all", "All lots"],
          ] as const
        ).map(([id, label]) => (
          <Button
            key={id}
            type="button"
            size="sm"
            variant={filter === id ? "primary" : "secondary"}
            onClick={() => setFilter(id)}
          >
            {label}
          </Button>
        ))}
        <Button
          variant="secondary"
          size="sm"
          onClick={() => exportBlotterCsv(lots, marks)}
          disabled={visibleLots.length === 0}
        >
          Export CSV
        </Button>
        <Button
          variant="ghost"
          size="sm"
          onClick={() =>
            exportBookJson({
              lots,
              marks,
              snaps,
              verdicts,
              scored: scoredRows(snaps, verdicts),
              bot: {
                on: bot.on,
                universe: bot.universe,
                sessionFills: bot.sessionFills,
                lastNote: bot.lastNote,
              },
            })
          }
        >
          Export JSON
        </Button>
        <Button variant="ghost" size="sm" onClick={() => fileRef.current?.click()}>
          Import JSON
        </Button>
        <input
          ref={fileRef}
          type="file"
          accept="application/json,.json"
          className="hidden"
          aria-label="Import a Fairline JSON book"
          onChange={(e) => onImportFile(e.target.files?.[0])}
        />
        {visibleLots.length > 0 ? (
          <Dialog>
            <DialogTrigger asChild>
              <Button variant="ghost" size="sm">
                Reset book
              </Button>
            </DialogTrigger>
            <DialogContent title="Reset the paper book?">
              <p className="text-sm text-muted">
                This clears every lot and returns cash to ${STARTING_CASH.toLocaleString()}. It
                cannot be undone.
              </p>
              <Button className="mt-4" variant="no" onClick={() => reset()}>
                Clear all lots
              </Button>
            </DialogContent>
          </Dialog>
        ) : null}
        <span className="ml-auto self-center text-xs text-subtle tabular-nums">
          {visible.length} shown
        </span>
      </div>
      {importMsg ? (
        <p className="rounded-md bg-yes-dim px-3 py-2 text-sm text-yes">{importMsg}</p>
      ) : null}
      {importError ? (
        <p className="rounded-md bg-no-dim px-3 py-2 text-sm text-no">{importError}</p>
      ) : null}

      {visibleLots.length === 0 ? (
        <div className="rounded-xl bg-surface px-6 py-16 text-center shadow-[var(--shadow-border)]">
          <p className="text-sm text-muted">No paper fills in this browser yet.</p>
          <p className="mt-2 text-sm text-subtle">
            {bot.on
              ? "Bot is ON. It only buys when Fairline shows Buy YES or Buy NO — HOLD means it sits out. Fills show up here after the next desk refresh."
              : "This page does not pull Kalshi trades. Log a ticket from a market, or turn the paper bot on from the desk."}
          </p>
          <Button asChild className="mt-4">
            <Link to="/">Back to the desk</Link>
          </Button>
        </div>
      ) : visible.length === 0 ? (
        <div className="rounded-xl bg-surface px-6 py-12 text-center shadow-[var(--shadow-border)]">
          <p className="text-sm text-muted">Nothing in this tab.</p>
        </div>
      ) : (
        <ul className="flex flex-col rounded-xl bg-surface shadow-[var(--shadow-border)]">
          {visible.map((lot) => {
            const mark = marks[lot.ticker];
            const mid = mark?.mid ?? lot.midAtEntry;
            const fair = mark?.fair ?? lot.fairAtEntry;
            const flatPx =
              lot.side === "yes"
                ? typeof mark?.bid === "number" && mark.bid > 0
                  ? mark.bid
                  : null
                : typeof mark?.ask === "number" && mark.ask > 0
                  ? 1 - mark.ask
                  : null;
            const canFlatten = lot.status === "open" && flatPx != null;
            return (
              <LotRow
                key={lot.id}
                lot={lot}
                mark={mark}
                mid={mid}
                fair={fair}
                onFlatten={
                  canFlatten
                    ? () =>
                        closeLot(lot.id, "flatten", flatPx!, {
                          settleProvenance: "manual",
                          exitBasis: lot.side === "yes" ? "bid" : "ask",
                        })
                    : undefined
                }
                onSettle={(reason) => {
                  const yes = reason === "settle-yes" ? 1 : 0;
                  closeLot(lot.id, reason, sideMark(lot.side, yes), {
                    settleProvenance: "manual",
                    exitBasis: "manual",
                  });
                }}
                onVoid={() => voidLot(lot.id)}
              />
            );
          })}
        </ul>
      )}

      <p className="text-xs text-subtle">
        Paper book only — not a Kalshi order, not financial advice. Entry is at the touch (YES
        ask / NO bid) plus an estimated taker fee. Flatten sells at the executable side of the
        live quote (YES bid / NO bid): if the quote is missing, flatten is disabled rather than
        pretending a mid exists. Settle YES/NO as if the contract paid $1 or $0 — manual settles
        are counted separately from exchange-confirmed ones.
      </p>
    </div>
  );
}

function Stat({
  label,
  value,
  hint,
  tone,
}: {
  label: string;
  value: string;
  hint?: string;
  tone?: number;
}) {
  return (
    <div className="rounded-lg bg-surface px-3 py-3 shadow-[var(--shadow-border)]">
      <p className="text-xs text-muted">{label}</p>
      <p
        className={cn(
          "mt-1 text-lg font-medium tracking-tight tabular-nums",
          typeof tone === "number" && tone > 0 && "text-yes",
          typeof tone === "number" && tone < 0 && "text-no",
        )}
      >
        {value}
      </p>
      {hint ? <p className="mt-1 text-xs text-subtle">{hint}</p> : null}
    </div>
  );
}

function LotRow({
  lot,
  mark,
  mid,
  fair,
  onFlatten,
  onSettle,
  onVoid,
}: {
  lot: BlotterLot;
  mark?: TickerMark;
  mid: number;
  fair: number;
  onFlatten?: () => void;
  onSettle: (reason: Extract<BlotterLot["closeReason"], "settle-yes" | "settle-no">) => void;
  onVoid: () => void;
}) {
  const expired = Date.parse(lot.closeTime) < Date.now();
  const mtm = lot.status === "open" ? lotPnl(lot, mid) : lotPnl(lot, 0);
  const model = lot.status === "open" ? lotPnl(lot, fair) : lotPnl(lot, 0);
  const markPx = lot.status === "open" ? sideMark(lot.side, mid) : lot.exitPrice ?? lot.fillPrice;
  const feeUsd = lot.feeUsd ?? 0;

  return (
    <li className="flex flex-col gap-3 border-b border-border px-4 py-4 last:border-0 md:grid md:grid-cols-12 md:items-center md:gap-3">
      <div className="min-w-0 md:col-span-4">
        <div className="mb-1 flex flex-wrap items-center gap-2">
          <span
            className={cn(
              "inline-flex rounded-full px-2 py-0.5 text-xs font-medium",
              lot.side === "yes" ? "bg-yes-dim text-yes" : "bg-no-dim text-no",
            )}
          >
            {lot.side.toUpperCase()}
          </span>
          {lot.source === "bot" ? (
            <span className="text-xs font-medium tracking-wide text-subtle uppercase">Bot</span>
          ) : null}
          {lot.status === "closed" ? (
            <span className="text-xs text-subtle">
              {lot.closeReason === "flatten"
                ? "Flattened"
                : lot.closeReason === "settle-yes"
                  ? "Settled YES"
                  : lot.closeReason === "settle-no"
                    ? "Settled NO"
                    : "Closed"}
              {lot.settleProvenance === "exchange" ? " · Kalshi" : " · manual"}
            </span>
          ) : expired ? (
            <span className="text-xs text-no">Past close — awaiting Kalshi result</span>
          ) : (
            <span className="text-xs text-subtle">Closes {relativeClose(lot.closeTime)}</span>
          )}
        </div>
        <Link
          to="/market/$ticker"
          params={{ ticker: lot.ticker }}
          className="block truncate text-sm font-medium hover:text-fg"
        >
          {lot.title}
        </Link>
        <p className="truncate text-xs text-muted">{lot.eventTitle}</p>
        <p className="mt-1 text-[11px] text-subtle tabular-nums">
          Fee {lot.feePolicy === "pre-fee-tracking" ? "n/a (legacy)" : `$${feeUsd.toFixed(2)}`} ·{" "}
          {lot.feePolicy ?? "no policy recorded"}
        </p>
      </div>

      <div className="grid grid-cols-3 gap-2 text-sm md:col-span-4 md:grid-cols-4">
        <Cell label="Qty" value={String(lot.contracts)} />
        <Cell label="Fill" value={pct(lot.fillPrice)} />
        <Cell label={lot.status === "open" ? "Mark" : "Exit"} value={pct(markPx)} />
        <Cell label="Cost+fee" value={`$${lotEntryCost(lot).toFixed(2)}`} className="hidden md:flex" />
      </div>

      <div className="flex items-center justify-between gap-3 md:col-span-2 md:block md:text-right">
        <div>
          <p className="text-xs text-muted">Market / model</p>
          <p className="tabular-nums">
            <span className={cn(mtm >= 0 ? "text-yes" : "text-no")}>{usd(mtm)}</span>
            {lot.status === "open" ? (
              <>
                <span className="text-subtle"> · </span>
                <span className={cn(model >= 0 ? "text-yes" : "text-no")}>{usd(model)}</span>
              </>
            ) : null}
          </p>
        </div>
      </div>

      <div className="flex flex-wrap gap-2 md:col-span-2 md:justify-end">
        {lot.status === "open" ? (
          <>
            <Button
              type="button"
              size="sm"
              variant="secondary"
              onClick={onFlatten}
              disabled={!onFlatten}
              title={
                onFlatten
                  ? lot.side === "yes"
                    ? `Sell YES at the YES bid ${pct(mark?.bid ?? 0)}`
                    : `Sell NO at the NO bid ${pct(mark?.ask != null ? 1 - mark.ask : 0)}`
                  : "No live executable quote — wait for a desk refresh, or settle/void manually"
              }
            >
              {onFlatten ? "Flatten" : "No quote"}
            </Button>
            <Dialog>
              <DialogTrigger asChild>
                <Button type="button" size="sm" variant="ghost">
                  Settle
                </Button>
              </DialogTrigger>
              <DialogContent title="Settle this contract">
                <p className="text-sm text-muted">
                  Paper-settle {lot.contracts} {lot.side.toUpperCase()} as if Kalshi paid $1
                  or $0. Marked as a manual settle — exchange-confirmed settlements come from the
                  Kalshi result poll automatically. This does not touch the live exchange.
                </p>
                <div className="mt-4 flex flex-wrap gap-2">
                  <Button type="button" variant="yes" onClick={() => onSettle("settle-yes")}>
                    YES wins
                  </Button>
                  <Button type="button" variant="no" onClick={() => onSettle("settle-no")}>
                    NO wins
                  </Button>
                </div>
              </DialogContent>
            </Dialog>
            <Button type="button" size="sm" variant="ghost" onClick={onVoid}>
              Void
            </Button>
          </>
        ) : (
          <span className="text-xs text-subtle">
            {lot.closedAt
              ? Date.now() - Date.parse(lot.closedAt) < 60_000
                ? "just now"
                : relativeClose(lot.closedAt)
              : ""}
          </span>
        )}
      </div>
    </li>
  );
}

function Cell({
  label,
  value,
  className,
}: {
  label: string;
  value: string;
  className?: string;
}) {
  return (
    <div className={cn("flex flex-col", className)}>
      <span className="text-xs text-muted">{label}</span>
      <span className="tabular-nums">{value}</span>
    </div>
  );
}

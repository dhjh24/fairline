import {
  STARTING_CASH,
  blotterTotals,
  lotCost,
  lotPnl,
  sideMark,
  type BlotterLot,
  type TickerMark,
} from "@/lib/blotter";
import type { QuoteSnap, ScoredRow, Verdict } from "@/lib/calibration";

function stamp(): string {
  return new Date().toISOString().slice(0, 19).replace(/[:T]/g, "-");
}

function csvCell(v: unknown): string {
  if (v == null) return "";
  const s = String(v);
  if (/[",\n]/.test(s)) return `"${s.replace(/"/g, '""')}"`;
  return s;
}

export function toCsv(headers: string[], rows: unknown[][]): string {
  return [headers.map(csvCell).join(","), ...rows.map((r) => r.map(csvCell).join(","))].join("\n");
}

export function downloadFile(filename: string, body: string, mime: string) {
  const blob = new Blob([body], { type: mime });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}

export function blotterCsv(lots: BlotterLot[], marks: Record<string, TickerMark>): string {
  const headers = [
    "id",
    "source",
    "status",
    "side",
    "ticker",
    "title",
    "event",
    "category",
    "series",
    "close_time",
    "opened_at",
    "closed_at",
    "contracts",
    "fill",
    "mid_entry",
    "fair_entry",
    "mark_mid",
    "mark_fair",
    "exit",
    "close_reason",
    "cost",
    "pnl_market",
    "pnl_model",
  ];
  const rows = lots
    .filter((l) => l.closeReason !== "void")
    .map((lot) => {
      const mark = marks[lot.ticker];
      const mid = mark?.mid ?? lot.midAtEntry;
      const fair = mark?.fair ?? lot.fairAtEntry;
      const pnlM = lot.status === "open" ? lotPnl(lot, mid) : lotPnl(lot, 0);
      const pnlF = lot.status === "open" ? lotPnl(lot, fair) : lotPnl(lot, 0);
      const markPx = lot.status === "open" ? sideMark(lot.side, mid) : (lot.exitPrice ?? "");
      return [
        lot.id,
        lot.source ?? "manual",
        lot.status,
        lot.side,
        lot.ticker,
        lot.title,
        lot.eventTitle,
        lot.category,
        lot.seriesTicker,
        lot.closeTime,
        lot.openedAt,
        lot.closedAt ?? "",
        lot.contracts,
        lot.fillPrice.toFixed(4),
        lot.midAtEntry.toFixed(4),
        lot.fairAtEntry.toFixed(4),
        mid.toFixed(4),
        fair.toFixed(4),
        typeof markPx === "number" ? markPx.toFixed(4) : markPx,
        lot.closeReason ?? "",
        lotCost(lot).toFixed(4),
        pnlM.toFixed(4),
        pnlF.toFixed(4),
      ];
    });
  return toCsv(headers, rows);
}

export function scoresCsv(rows: ScoredRow[]): string {
  const headers = [
    "ticker",
    "series",
    "title",
    "event",
    "category",
    "close_time",
    "snapped_at",
    "target",
    "mid",
    "fair",
    "bid",
    "ask",
    "grok",
    "signal",
    "result",
    "y",
    "brier",
    "market_brier",
    "skill",
    "lead_sec",
    "informative",
    "grok_brier",
    "signal_hit",
    "side_hit",
  ];
  const body = rows.map((r) => [
    r.ticker,
    r.seriesTicker,
    r.title,
    r.eventTitle,
    r.category,
    r.closeTime,
    r.snappedAt,
    r.target ?? "",
    r.mid.toFixed(4),
    r.fair.toFixed(4),
    r.bid.toFixed(4),
    r.ask.toFixed(4),
    r.grok != null ? r.grok.toFixed(4) : "",
    r.signal,
    r.result,
    r.y,
    r.brier.toFixed(6),
    r.marketBrier.toFixed(6),
    r.skill.toFixed(6),
    Math.round(r.leadSec),
    r.informative ? "1" : "0",
    r.grokBrier != null ? r.grokBrier.toFixed(6) : "",
    r.signalHit == null ? "" : r.signalHit ? "1" : "0",
    r.sideHit ? "1" : "0",
  ]);
  return toCsv(headers, body);
}

export function exportBlotterCsv(lots: BlotterLot[], marks: Record<string, TickerMark>) {
  downloadFile(`fairline-blotter-${stamp()}.csv`, blotterCsv(lots, marks), "text/csv;charset=utf-8");
}

export function exportScoresCsv(rows: ScoredRow[]) {
  downloadFile(`fairline-scores-${stamp()}.csv`, scoresCsv(rows), "text/csv;charset=utf-8");
}

export function exportBookJson(input: {
  lots: BlotterLot[];
  marks: Record<string, TickerMark>;
  snaps: Record<string, QuoteSnap>;
  verdicts: Record<string, Verdict>;
  scored: ScoredRow[];
  bot?: { on: boolean; universe: string; sessionFills: number; lastNote: string };
}) {
  const totals = blotterTotals(input.lots, input.marks);
  const payload = {
    exportedAt: new Date().toISOString(),
    startingCash: STARTING_CASH,
    totals,
    bot: input.bot ?? null,
    lots: input.lots.filter((l) => l.closeReason !== "void"),
    marks: input.marks,
    snapshots: input.snaps,
    verdicts: input.verdicts,
    scored: input.scored,
  };
  downloadFile(
    `fairline-book-${stamp()}.json`,
    `${JSON.stringify(payload, null, 2)}\n`,
    "application/json",
  );
}

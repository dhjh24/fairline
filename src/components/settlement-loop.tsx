import { useQuery } from "@tanstack/react-query";
import { useEffect, useMemo } from "react";
import { useBlotter } from "@/lib/blotter";
import { pendingTickers, useCalibration } from "@/lib/calibration";
import { getSettlements } from "@/lib/desk-fn";

export function SettlementLoop() {
  const hydrated = useCalibration((s) => s.hydrated);
  const snaps = useCalibration((s) => s.snaps);
  const verdicts = useCalibration((s) => s.verdicts);
  const applyVerdicts = useCalibration((s) => s.applyVerdicts);
  const settleLots = useBlotter((s) => s.settleLots);

  const pending = useMemo(
    () => pendingTickers(snaps, verdicts).slice(0, 24),
    [snaps, verdicts],
  );

  const q = useQuery({
    queryKey: ["settlements", pending.join(",")],
    queryFn: () => getSettlements({ data: { tickers: pending } }),
    enabled: hydrated && pending.length > 0,
    refetchInterval: pending.length > 0 ? 30_000 : false,
    staleTime: 15_000,
  });

  useEffect(() => {
    const rows = [...(q.data?.history ?? []), ...(q.data?.extra ?? [])].filter(
      (r) => r.result === "yes" || r.result === "no",
    );
    if (rows.length === 0) return;
    applyVerdicts(rows);
    settleLots(rows.map((r) => ({ ticker: r.ticker, result: r.result })));
  }, [q.data, applyVerdicts, settleLots]);

  return null;
}

import { useEffect, useState } from "react";
import {
  Area,
  AreaChart,
  CartesianGrid,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import type { Candle } from "@/lib/types";
import { pct } from "@/lib/format";

function tickLabel(t: number, spanMs: number): string {
  const d = new Date(t);
  if (spanMs < 36 * 3_600_000) {
    return d.toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit" });
  }
  if (spanMs < 14 * 86_400_000) {
    return d.toLocaleString("en-US", { month: "short", day: "numeric", hour: "numeric" });
  }
  return d.toLocaleDateString("en-US", { month: "short", day: "numeric" });
}

export function PriceChart({ candles }: { candles: Candle[] }) {
  const [ready, setReady] = useState(false);
  useEffect(() => setReady(true), []);

  if (candles.length < 2) {
    return (
      <p className="px-1 py-8 text-center text-sm text-muted">
        No tape yet this window. 15-minute books only print once trading starts.
      </p>
    );
  }

  const span = candles[candles.length - 1]!.t - candles[0]!.t;
  const data = candles.map((c) => ({
    t: c.t,
    close: c.close,
    label: tickLabel(c.t, span),
  }));

  if (!ready) {
    return <div className="h-56 rounded-md bg-elevated" />;
  }

  return (
    <div className="h-56 w-full">
      <ResponsiveContainer width="100%" height="100%">
        <AreaChart data={data} margin={{ top: 8, right: 8, left: 0, bottom: 0 }}>
          <defs>
            <linearGradient id="fairlineFill" x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor="#d6d8dc" stopOpacity={0.18} />
              <stop offset="100%" stopColor="#d6d8dc" stopOpacity={0} />
            </linearGradient>
          </defs>
          <CartesianGrid stroke="#2a2c31" vertical={false} />
          <XAxis
            dataKey="label"
            tick={{ fill: "#8b8d93", fontSize: 11 }}
            tickLine={false}
            axisLine={false}
            minTickGap={28}
          />
          <YAxis
            domain={["auto", "auto"]}
            tickFormatter={(v) => `${Math.round(Number(v) * 100)}%`}
            tick={{ fill: "#8b8d93", fontSize: 11 }}
            tickLine={false}
            axisLine={false}
            width={40}
          />
          <Tooltip
            contentStyle={{
              background: "#181a1e",
              border: "1px solid #2a2c31",
              borderRadius: 8,
              color: "#ecece8",
              fontSize: 12,
            }}
            labelFormatter={(_, pts) => {
              const t = Number(pts?.[0]?.payload?.t);
              return Number.isFinite(t) ? new Date(t).toLocaleString() : "";
            }}
            formatter={(value) => [pct(Number(value), 1), "Last"]}
          />
          <Area
            type="monotone"
            dataKey="close"
            stroke="#d6d8dc"
            strokeWidth={1.5}
            fill="url(#fairlineFill)"
            isAnimationActive={false}
          />
        </AreaChart>
      </ResponsiveContainer>
    </div>
  );
}

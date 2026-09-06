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

export function PriceChart({ candles }: { candles: Candle[] }) {
  const [ready, setReady] = useState(false);
  useEffect(() => setReady(true), []);

  if (candles.length < 2) {
    return (
      <p className="px-1 py-8 text-center text-sm text-muted">
        Not enough prints to draw a history.
      </p>
    );
  }

  const data = candles.map((c) => ({
    t: c.t,
    close: c.close,
    label: new Date(c.t).toLocaleDateString("en-US", { month: "short", day: "numeric" }),
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

"use client";
/**
 * Portfolio value over the period. Numbers arrive as decimal strings; they
 * become floats here only for drawing – labels use the exact strings, already
 * formatted on the server. The figure has a text summary and a table view.
 */
import { Area, AreaChart, ReferenceLine, Tooltip, XAxis, YAxis } from "recharts";
import { useI18n } from "./i18n-provider";

export type ChartPoint = { day: string; value: string; label: string; dayLabel: string };
export type ChartMarker = { day: string; label: string };

type TooltipProps = { active?: boolean; payload?: { payload: ChartPoint }[] };

function ChartTooltip({ active, payload }: TooltipProps) {
  const p = active ? payload?.[0]?.payload : undefined;
  if (!p) return null;
  return (
    <div className="rounded-xl border border-border bg-card px-3 py-2 text-sm shadow-md">
      <p className="text-text-muted">{p.dayLabel}</p>
      <p className="amount font-semibold">{p.label}</p>
    </div>
  );
}

export function ValueChart({ points, markers, height = 220 }: { points: ChartPoint[]; markers: ChartMarker[]; height?: number }) {
  const { f } = useI18n();
  const data = points.map((p) => ({ ...p, y: Number(p.value) }));
  return (
    <div className="amount" aria-hidden="true">
      <AreaChart responsive style={{ width: "100%", height }} data={data} margin={{ top: 8, right: 8, bottom: 0, left: 8 }} accessibilityLayer={false}>
        <defs>
          <linearGradient id="value-fill" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor="var(--accent)" stopOpacity={0.22} />
            <stop offset="100%" stopColor="var(--accent)" stopOpacity={0} />
          </linearGradient>
        </defs>
        <XAxis
          dataKey="day"
          tickFormatter={f.shortDay}
          tick={{ fill: "var(--text-muted)", fontSize: 12 }}
          tickLine={false}
          axisLine={{ stroke: "var(--border)" }}
          minTickGap={32}
        />
        <YAxis hide domain={["auto", "auto"]} />
        <Tooltip content={<ChartTooltip />} cursor={{ stroke: "var(--control)", strokeDasharray: "3 3" }} />
        {markers.map((mk) => (
          <ReferenceLine key={`${mk.day}-${mk.label}`} x={mk.day} stroke="var(--c3)" strokeDasharray="4 4" />
        ))}
        <Area type="monotone" dataKey="y" stroke="var(--accent)" strokeWidth={2} fill="url(#value-fill)" isAnimationActive={false} />
      </AreaChart>
    </div>
  );
}

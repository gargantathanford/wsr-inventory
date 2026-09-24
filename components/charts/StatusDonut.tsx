"use client";

import { PieChart, Pie, Cell, ResponsiveContainer, Tooltip } from "recharts";
import { statusLabel } from "@/lib/scoring";

const COLORS: Record<string, string> = {
  OWNED: "#2ED573",
  AVAILABLE_FOR_INSTALLATION: "#2ED573",
  INSTALLED: "#1FA35B",
  PARTIALLY_OWNED: "#FFB020",
  NEEDED: "#6B767F",
  ORDERED: "#3DA9FC",
  BACKORDERED: "#FF3B3B",
  MANUFACTURING: "#FF5A1F",
  UNAVAILABLE: "#FF3B3B",
  NO_LONGER_NEEDED: "#343C44"
};

export function StatusDonut({ data }: { data: { status: string; count: number }[] }) {
  const chartData = data.map((d) => ({ name: statusLabel(d.status), value: d.count, key: d.status }));
  return (
    <div className="h-56 w-full">
      <ResponsiveContainer width="100%" height="100%">
        <PieChart>
          <Pie
            data={chartData}
            dataKey="value"
            nameKey="name"
            innerRadius={55}
            outerRadius={85}
            paddingAngle={2}
            stroke="none"
          >
            {chartData.map((entry, i) => (
              <Cell key={i} fill={COLORS[entry.key] ?? "#4A545D"} />
            ))}
          </Pie>
          <Tooltip
            contentStyle={{
              background: "#161A1E",
              border: "1px solid #262C33",
              borderRadius: 4,
              fontSize: 12,
              fontFamily: "monospace"
            }}
          />
        </PieChart>
      </ResponsiveContainer>
    </div>
  );
}

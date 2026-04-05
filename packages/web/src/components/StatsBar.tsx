import React from "react";
import type { GraphStats } from "../types.js";

interface StatsBarProps {
  stats: GraphStats;
}

export function StatsBar({ stats }: StatsBarProps) {
  const items = [
    { label: "Nodes", value: stats.nodes, color: "#58a6ff" },
    { label: "Edges", value: stats.edges, color: "#3fb950" },
    { label: "Communities", value: stats.communities, color: "#d2a8ff" },
    { label: "Processes", value: stats.processes, color: "#f778ba" },
  ];

  return (
    <div style={{
      display: "grid",
      gridTemplateColumns: "1fr 1fr",
      gap: "8px",
    }}>
      {items.map((item) => (
        <div
          key={item.label}
          style={{
            padding: "10px 12px",
            borderRadius: "6px",
            background: "#161b22",
            border: "1px solid #21262d",
          }}
        >
          <div style={{ fontSize: "20px", fontWeight: 600, color: item.color }}>
            {formatNumber(item.value)}
          </div>
          <div style={{ fontSize: "11px", color: "#8b949e", marginTop: "2px" }}>
            {item.label}
          </div>
        </div>
      ))}
    </div>
  );
}

function formatNumber(n: number): string {
  if (n >= 1000000) return `${(n / 1000000).toFixed(1)}M`;
  if (n >= 1000) return `${(n / 1000).toFixed(1)}K`;
  return n.toString();
}

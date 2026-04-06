import React, { useState, useEffect, useCallback } from "react";
import { GraphView } from "./components/GraphView.js";
import { SearchPanel } from "./components/SearchPanel.js";
import { StatsBar } from "./components/StatsBar.js";
import { useWebSocket } from "./hooks/useWebSocket.js";
import type { GraphStats, SearchResult } from "./types.js";

export function App() {
  const [stats, setStats] = useState<GraphStats | null>(null);
  const [results, setResults] = useState<SearchResult[]>([]);
  const [selectedNode, setSelectedNode] = useState<string | null>(null);
  const [searchError, setSearchError] = useState<string | null>(null);
  // Derive WebSocket URL from current page location so it works through
  // the Vite dev proxy and in production (same host/port as HTTP server)
  const wsUrl = `${window.location.protocol === "https:" ? "wss:" : "ws:"}//${window.location.host}/ws`;
  const ws = useWebSocket(wsUrl);

  useEffect(() => {
    fetchStats();
  }, []);

  useEffect(() => {
    if (ws.lastMessage?.type === "index_update") {
      fetchStats();
    }
  }, [ws.lastMessage]);

  async function fetchStats() {
    try {
      const res = await fetch("/api/stats");
      const data = await res.json();
      setStats(data);
    } catch {
      // Server not running
    }
  }

  const handleSearch = useCallback(async (query: string) => {
    setSearchError(null);
    try {
      const res = await fetch("/api/tools/query", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ query, limit: 50 }),
      });
      const data = await res.json();
      if (data.isError) {
        const textContent = data.content?.find((c: { type: string }) => c.type === "text");
        setSearchError(textContent?.text ?? "Search failed");
        setResults([]);
        return;
      }
      if (data.content) {
        const jsonContent = data.content.find((c: { type: string }) => c.type === "json");
        if (jsonContent) {
          setResults(jsonContent.data);
        } else {
          setResults([]);
        }
      }
    } catch {
      setSearchError("Failed to connect to server");
      setResults([]);
    }
  }, []);

  return (
    <div style={{
      display: "flex",
      flexDirection: "column",
      height: "100vh",
      background: "#0d1117",
    }}>
      <header style={{
        padding: "12px 20px",
        borderBottom: "1px solid #21262d",
        display: "flex",
        alignItems: "center",
        gap: "16px",
      }}>
        <h1 style={{ fontSize: "18px", color: "#58a6ff", fontWeight: 600 }}>
          CodeIntelEngine
        </h1>
        <div style={{ flex: 1 }}>
          <SearchPanel onSearch={handleSearch} />
        </div>
        <div style={{
          display: "flex",
          alignItems: "center",
          gap: "8px",
          fontSize: "12px",
          color: ws.connected ? "#3fb950" : "#f85149",
        }}>
          <span style={{
            width: "8px",
            height: "8px",
            borderRadius: "50%",
            background: ws.connected ? "#3fb950" : "#f85149",
          }} />
          {ws.connected ? "Live" : "Disconnected"}
        </div>
      </header>

      <div style={{ display: "flex", flex: 1, overflow: "hidden" }}>
        <aside style={{
          width: "320px",
          borderRight: "1px solid #21262d",
          overflow: "auto",
          padding: "12px",
        }}>
          {stats && <StatsBar stats={stats} />}

          <div style={{ marginTop: "16px" }}>
            {searchError && (
              <div style={{
                padding: "8px 12px",
                marginBottom: "8px",
                borderRadius: "6px",
                background: "#3d1114",
                border: "1px solid #f8514950",
                color: "#f85149",
                fontSize: "12px",
              }}>
                {searchError}
              </div>
            )}
            <h3 style={{ fontSize: "13px", color: "#8b949e", marginBottom: "8px" }}>
              Results ({results.length})
            </h3>
            {results.map((r: SearchResult, i: number) => (
              <div
                key={i}
                onClick={() => setSelectedNode(r.name)}
                style={{
                  padding: "8px",
                  borderRadius: "6px",
                  cursor: "pointer",
                  marginBottom: "4px",
                  background: selectedNode === r.name ? "#161b22" : "transparent",
                  border: selectedNode === r.name ? "1px solid #30363d" : "1px solid transparent",
                }}
              >
                <div style={{ fontSize: "13px", color: "#c9d1d9" }}>
                  <span style={{ color: getKindColor(r.kind) }}>{r.kind}</span>
                  {" "}{r.name}
                </div>
                <div style={{ fontSize: "11px", color: "#8b949e", marginTop: "2px" }}>
                  {r.file}:{r.lines}
                </div>
              </div>
            ))}
          </div>
        </aside>

        <main style={{ flex: 1, position: "relative" }}>
          <GraphView selectedNode={selectedNode} />
        </main>
      </div>
    </div>
  );
}

function getKindColor(kind: string): string {
  const colors: Record<string, string> = {
    function: "#79c0ff",
    class: "#d2a8ff",
    method: "#7ee787",
    interface: "#f778ba",
    type_alias: "#f778ba",
    variable: "#ffa657",
    file: "#8b949e",
  };
  return colors[kind] ?? "#c9d1d9";
}

import React, { useRef, useEffect, useState } from "react";
import * as d3 from "d3";

interface GraphViewProps {
  selectedNode: string | null;
}

interface GraphData {
  nodes: Array<{
    id: string;
    name: string;
    kind: string;
    file: string;
    x?: number;
    y?: number;
  }>;
  links: Array<{
    source: string;
    target: string;
    kind: string;
  }>;
}

const KIND_COLORS: Record<string, string> = {
  function: "#79c0ff",
  class: "#d2a8ff",
  method: "#7ee787",
  interface: "#f778ba",
  type_alias: "#f778ba",
  variable: "#ffa657",
  constant: "#ffa657",
  enum: "#ff7b72",
  file: "#8b949e",
};

export function GraphView({ selectedNode }: GraphViewProps) {
  const svgRef = useRef<SVGSVGElement>(null);
  const [graphData, setGraphData] = useState<GraphData>({ nodes: [], links: [] });

  useEffect(() => {
    if (!selectedNode) return;

    // Fetch context for selected node
    fetch("/api/tools/context", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name: selectedNode }),
    })
      .then((r) => r.json())
      .then((data) => {
        if (data.content) {
          const json = data.content.find((c: { type: string }) => c.type === "json");
          if (json?.data) {
            const ctx = json.data;
            const nodes: GraphData["nodes"] = [];
            const links: GraphData["links"] = [];
            const seen = new Set<string>();

            const addNode = (n: { name: string; kind: string; file?: string }) => {
              if (!seen.has(n.name)) {
                seen.add(n.name);
                nodes.push({ id: n.name, name: n.name, kind: n.kind, file: n.file ?? "" });
              }
            };

            // Center node
            addNode(ctx.symbol);

            // Callers
            for (const c of ctx.callers ?? []) {
              addNode(c);
              links.push({ source: c.name, target: ctx.symbol.name, kind: "calls" });
            }

            // Callees
            for (const c of ctx.callees ?? []) {
              addNode(c);
              links.push({ source: ctx.symbol.name, target: c.name, kind: "calls" });
            }

            // Imports
            for (const c of ctx.imports ?? []) {
              addNode(c);
              links.push({ source: ctx.symbol.name, target: c.name, kind: "imports" });
            }

            setGraphData({ nodes, links });
          }
        }
      })
      .catch(() => {});
  }, [selectedNode]);

  useEffect(() => {
    if (!svgRef.current || graphData.nodes.length === 0) return;

    const svg = d3.select(svgRef.current);
    const width = svgRef.current.clientWidth;
    const height = svgRef.current.clientHeight;

    svg.selectAll("*").remove();

    const g = svg.append("g");

    // Zoom
    const zoom = d3.zoom<SVGSVGElement, unknown>()
      .scaleExtent([0.1, 4])
      .on("zoom", (event) => g.attr("transform", event.transform));
    svg.call(zoom);

    // Force simulation
    const simulation = d3.forceSimulation(graphData.nodes as d3.SimulationNodeDatum[])
      .force("link", d3.forceLink(graphData.links).id((d: any) => d.id).distance(120))
      .force("charge", d3.forceManyBody().strength(-300))
      .force("center", d3.forceCenter(width / 2, height / 2))
      .force("collision", d3.forceCollide().radius(30));

    // Links
    const link = g.append("g")
      .selectAll("line")
      .data(graphData.links)
      .join("line")
      .attr("stroke", "#21262d")
      .attr("stroke-width", 1.5)
      .attr("stroke-dasharray", (d) => d.kind === "imports" ? "4,4" : "none");

    // Nodes
    const node = g.append("g")
      .selectAll("g")
      .data(graphData.nodes)
      .join("g")
      .attr("cursor", "pointer");

    node.append("circle")
      .attr("r", (d) => d.name === selectedNode ? 12 : 8)
      .attr("fill", (d) => KIND_COLORS[d.kind] ?? "#8b949e")
      .attr("stroke", (d) => d.name === selectedNode ? "#fff" : "none")
      .attr("stroke-width", 2);

    node.append("text")
      .text((d) => d.name)
      .attr("dx", 14)
      .attr("dy", 4)
      .attr("font-size", "12px")
      .attr("fill", "#c9d1d9")
      .attr("font-family", "monospace");

    // Tick
    simulation.on("tick", () => {
      link
        .attr("x1", (d: any) => d.source.x)
        .attr("y1", (d: any) => d.source.y)
        .attr("x2", (d: any) => d.target.x)
        .attr("y2", (d: any) => d.target.y);

      node.attr("transform", (d: any) => `translate(${d.x},${d.y})`);
    });

    // Drag
    const drag = d3.drag<SVGGElement, any>()
      .on("start", (event, d) => {
        if (!event.active) simulation.alphaTarget(0.3).restart();
        d.fx = d.x;
        d.fy = d.y;
      })
      .on("drag", (event, d) => {
        d.fx = event.x;
        d.fy = event.y;
      })
      .on("end", (event, d) => {
        if (!event.active) simulation.alphaTarget(0);
        d.fx = null;
        d.fy = null;
      });

    node.call(drag as any);

    return () => { simulation.stop(); };
  }, [graphData, selectedNode]);

  if (graphData.nodes.length === 0) {
    return (
      <div style={{
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        height: "100%",
        color: "#8b949e",
        fontSize: "14px",
      }}>
        {selectedNode
          ? "Loading graph..."
          : "Search for symbols and select a result to visualize its connections"}
      </div>
    );
  }

  return (
    <svg
      ref={svgRef}
      style={{ width: "100%", height: "100%", background: "#0d1117" }}
    />
  );
}

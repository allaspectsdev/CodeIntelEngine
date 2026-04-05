import chalk from "chalk";

export function formatTable(
  headers: string[],
  rows: string[][]
): string {
  const colWidths = headers.map((h, i) =>
    Math.max(h.length, ...rows.map((r) => (r[i] ?? "").length))
  );

  const sep = colWidths.map((w) => "─".repeat(w + 2)).join("┼");
  const headerLine = headers
    .map((h, i) => ` ${h.padEnd(colWidths[i])} `)
    .join("│");

  const bodyLines = rows.map((row) =>
    row.map((cell, i) => ` ${(cell ?? "").padEnd(colWidths[i])} `).join("│")
  );

  return [
    chalk.bold(headerLine),
    sep,
    ...bodyLines,
  ].join("\n");
}

export function formatNode(node: {
  name: string;
  kind: string;
  filePath?: string;
  file?: string;
  startLine?: number;
  line?: number;
  signature?: string;
  exported?: boolean;
}): string {
  const file = node.filePath ?? node.file ?? "";
  const line = node.startLine ?? node.line ?? 0;
  const kindColor = getKindColor(node.kind);
  const exp = node.exported ? chalk.green("◆") : chalk.dim("○");

  return `${exp} ${kindColor(node.kind.padEnd(12))} ${chalk.white.bold(node.name)} ${chalk.dim(`${file}:${line}`)}${
    node.signature ? chalk.dim(` — ${node.signature}`) : ""
  }`;
}

function getKindColor(kind: string): (s: string) => string {
  switch (kind) {
    case "function": return chalk.cyan;
    case "class": return chalk.yellow;
    case "method": return chalk.blue;
    case "interface": return chalk.magenta;
    case "type_alias": return chalk.magenta;
    case "variable": return chalk.green;
    case "constant": return chalk.green.bold;
    case "enum": return chalk.red;
    case "file": return chalk.gray;
    default: return chalk.white;
  }
}

export function formatScore(score: number): string {
  const bar = "█".repeat(Math.round(score * 20));
  const empty = "░".repeat(20 - Math.round(score * 20));
  return `${chalk.green(bar)}${chalk.dim(empty)} ${(score * 100).toFixed(1)}%`;
}

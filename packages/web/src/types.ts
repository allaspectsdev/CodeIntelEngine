export interface GraphStats {
  nodes: number;
  edges: number;
  communities: number;
  processes: number;
}

export interface SearchResult {
  rank: number;
  name: string;
  kind: string;
  file: string;
  lines: string;
  signature?: string;
  score: number;
  exported: boolean;
}

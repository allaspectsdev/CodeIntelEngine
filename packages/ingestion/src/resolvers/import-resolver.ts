import { existsSync } from "node:fs";
import { resolve, dirname, join } from "node:path";
import type { GraphEdge } from "@codeintel/core";
import type { ExtractedImport } from "../extractors/import-extractor.js";

export interface ResolvedImport {
  edge: GraphEdge;
  resolvedPath: string | null;   // null = external module
  specifierName: string;
}

/**
 * Resolves import statements to file paths and creates edges.
 *
 * For relative imports, resolves to actual file paths in the project.
 * For package imports, marks them as external.
 */
export function resolveImports(
  imports: ExtractedImport[],
  sourceFilePath: string,
  sourceNodeId: string,
  projectRoot: string,
  fileIndex: Map<string, string[]>,  // filePath -> node IDs in that file
): ResolvedImport[] {
  const results: ResolvedImport[] = [];

  for (const imp of imports) {
    const resolvedPath = resolveModulePath(imp.source, sourceFilePath, projectRoot);

    for (const spec of imp.specifiers) {
      // Try to find a target node in the resolved file
      let targetId: string | null = null;

      if (resolvedPath && fileIndex.has(resolvedPath)) {
        const nodesInFile = fileIndex.get(resolvedPath)!;
        // Find a node matching the specifier name
        targetId = nodesInFile.find((nid) => {
          const parts = nid.split("::");
          return parts[2] === spec.name;  // id format: file::kind::name::line
        }) ?? null;
      }

      if (!targetId) {
        // Create a placeholder external module node ID
        targetId = `external::${imp.source}::${spec.name}`;
      }

      const edgeId = `${sourceNodeId}->imports->${targetId}`;
      results.push({
        edge: {
          id: edgeId,
          source: sourceNodeId,
          target: targetId,
          kind: imp.isTypeOnly || spec.isType ? "type_of" : "imports",
          confidence: resolvedPath ? 1.0 : 0.5,
          filePath: sourceFilePath,
          line: imp.line,
        },
        resolvedPath,
        specifierName: spec.alias ?? spec.name,
      });
    }
  }

  return results;
}

/**
 * Resolves a module specifier to a file path.
 * Returns null for external (node_modules) packages.
 */
function resolveModulePath(
  source: string,
  fromFile: string,
  projectRoot: string
): string | null {
  // Relative import
  if (source.startsWith(".") || source.startsWith("/")) {
    const dir = dirname(fromFile);
    const base = source.startsWith("/")
      ? resolve(projectRoot, source.slice(1))
      : resolve(dir, source);

    // Try common extensions
    const extensions = [".ts", ".tsx", ".js", ".jsx", ".mjs", ".py", ".go", ".rs", ".java", ""];
    const indexFiles = ["index.ts", "index.tsx", "index.js", "index.jsx"];

    for (const ext of extensions) {
      const candidate = base + ext;
      if (existsSync(candidate)) return candidate;
    }

    // Try index files in directory
    for (const indexFile of indexFiles) {
      const candidate = join(base, indexFile);
      if (existsSync(candidate)) return candidate;
    }

    // Still return the base path (might exist later during incremental indexing)
    return base;
  }

  // Aliased paths (e.g., @/components/..., ~/utils/...)
  if (source.startsWith("@/") || source.startsWith("~/")) {
    const relativePath = source.slice(2);
    return resolve(projectRoot, "src", relativePath);
  }

  // Package import — external
  return null;
}

/**
 * Resolves call sites to edges by matching callee names against known symbols.
 */
export function resolveCallEdges(
  callSites: Array<{
    callerNodeId: string;
    calleeName: string;
    line: number;
    qualifier?: string;
    filePath: string;
  }>,
  symbolIndex: Map<string, string[]>,   // name -> [nodeId, ...]
): GraphEdge[] {
  const edges: GraphEdge[] = [];

  for (const call of callSites) {
    const candidates = symbolIndex.get(call.calleeName) ?? [];
    if (candidates.length === 0) continue;

    // Pick the best candidate. Heuristic:
    // 1. Same file preferred
    // 2. Exported symbols preferred
    // 3. First match as fallback
    let targetId = candidates[0];
    const sameFileCandidate = candidates.find((c) => c.startsWith(call.filePath + "::"));
    if (sameFileCandidate) {
      targetId = sameFileCandidate;
    }

    // Skip self-calls
    if (targetId === call.callerNodeId) continue;

    const edgeId = `${call.callerNodeId}->calls->${targetId}@${call.line}`;
    edges.push({
      id: edgeId,
      source: call.callerNodeId,
      target: targetId,
      kind: "calls",
      confidence: candidates.length === 1 ? 1.0 : 0.7,
      filePath: call.filePath,
      line: call.line,
    });
  }

  return edges;
}

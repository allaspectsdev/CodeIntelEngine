import type { ParsedTree, SyntaxNode } from "../parsers/parser.js";

export interface ExtractedImport {
  source: string;           // module path / package name
  specifiers: ImportSpecifier[];
  line: number;
  isTypeOnly: boolean;
  isDefault: boolean;
  isNamespace: boolean;
}

export interface ImportSpecifier {
  name: string;
  alias?: string;
  isType: boolean;
}

/**
 * Extracts import statements from a parsed syntax tree.
 */
export function extractImports(tree: ParsedTree): ExtractedImport[] {
  const langId = tree.language.id;
  const importNodeTypes = tree.language.nodeQueries.imports;

  if (importNodeTypes.length === 0) return [];

  const importNodes = tree.rootNode.descendantsOfType(importNodeTypes);
  const results: ExtractedImport[] = [];

  for (const node of importNodes) {
    const extracted = extractImport(node, langId);
    if (extracted) results.push(extracted);
  }

  return results;
}

function extractImport(node: SyntaxNode, langId: string): ExtractedImport | null {
  switch (langId) {
    case "typescript":
    case "javascript":
      return extractJSImport(node);
    case "python":
      return extractPythonImport(node);
    case "go":
      return extractGoImport(node);
    case "rust":
      return extractRustImport(node);
    case "java":
      return extractJavaImport(node);
    default:
      return null;
  }
}

function extractJSImport(node: SyntaxNode): ExtractedImport | null {
  const text = node.text;
  const line = node.startPosition.row + 1;

  // Extract source module
  const sourceMatch = text.match(/from\s+['"]([^'"]+)['"]/);
  const directMatch = text.match(/import\s+['"]([^'"]+)['"]/);  // side-effect import
  const source = sourceMatch?.[1] ?? directMatch?.[1];
  if (!source) return null;

  const isTypeOnly = text.includes("import type ");
  const specifiers: ImportSpecifier[] = [];

  // Default import: import Foo from '...'
  const defaultMatch = text.match(/import\s+(?:type\s+)?(\w+)\s+from/);
  let isDefault = false;
  if (defaultMatch && defaultMatch[1] !== "type") {
    specifiers.push({ name: defaultMatch[1], isType: isTypeOnly });
    isDefault = true;
  }

  // Namespace import: import * as Foo from '...'
  const nsMatch = text.match(/import\s+\*\s+as\s+(\w+)/);
  let isNamespace = false;
  if (nsMatch) {
    specifiers.push({ name: nsMatch[1], isType: isTypeOnly });
    isNamespace = true;
  }

  // Named imports: import { A, B as C } from '...'
  const namedMatch = text.match(/\{([^}]+)\}/);
  if (namedMatch) {
    const items = namedMatch[1].split(",").map((s) => s.trim()).filter(Boolean);
    for (const item of items) {
      const isItemType = item.startsWith("type ");
      const cleaned = item.replace(/^type\s+/, "");
      const parts = cleaned.split(/\s+as\s+/);
      specifiers.push({
        name: parts[0].trim(),
        alias: parts[1]?.trim(),
        isType: isTypeOnly || isItemType,
      });
    }
  }

  return { source, specifiers, line, isTypeOnly, isDefault, isNamespace };
}

function extractPythonImport(node: SyntaxNode): ExtractedImport | null {
  const text = node.text;
  const line = node.startPosition.row + 1;

  // from X import Y, Z
  const fromMatch = text.match(/from\s+(\S+)\s+import\s+(.+)/);
  if (fromMatch) {
    const source = fromMatch[1];
    const items = fromMatch[2].split(",").map((s) => s.trim());
    const specifiers: ImportSpecifier[] = items.map((item) => {
      const parts = item.split(/\s+as\s+/);
      return { name: parts[0].trim(), alias: parts[1]?.trim(), isType: false };
    });
    return { source, specifiers, line, isTypeOnly: false, isDefault: false, isNamespace: false };
  }

  // import X, Y
  const importMatch = text.match(/import\s+(.+)/);
  if (importMatch) {
    const items = importMatch[1].split(",").map((s) => s.trim());
    const specifiers: ImportSpecifier[] = items.map((item) => {
      const parts = item.split(/\s+as\s+/);
      return { name: parts[0].trim(), alias: parts[1]?.trim(), isType: false };
    });
    const source = specifiers[0]?.name ?? "";
    return { source, specifiers, line, isTypeOnly: false, isDefault: false, isNamespace: true };
  }

  return null;
}

function extractGoImport(node: SyntaxNode): ExtractedImport | null {
  const text = node.text;
  const line = node.startPosition.row + 1;
  const specifiers: ImportSpecifier[] = [];

  // Single or grouped imports
  const paths = text.match(/"([^"]+)"/g);
  if (!paths) return null;

  for (const p of paths) {
    const clean = p.replace(/"/g, "");
    const parts = clean.split("/");
    specifiers.push({ name: parts[parts.length - 1], isType: false });
  }

  const source = paths[0]?.replace(/"/g, "") ?? "";
  return { source, specifiers, line, isTypeOnly: false, isDefault: false, isNamespace: true };
}

function extractRustImport(node: SyntaxNode): ExtractedImport | null {
  const text = node.text;
  const line = node.startPosition.row + 1;

  // use crate::foo::bar;  or  use std::collections::HashMap;
  const useMatch = text.match(/use\s+(.+);/);
  if (!useMatch) return null;

  const path = useMatch[1].trim();
  const specifiers: ImportSpecifier[] = [];

  // Check for grouped imports: use foo::{A, B}
  const groupMatch = path.match(/(.+)::\{(.+)\}/);
  if (groupMatch) {
    const base = groupMatch[1];
    const items = groupMatch[2].split(",").map((s) => s.trim());
    for (const item of items) {
      const parts = item.split(/\s+as\s+/);
      specifiers.push({ name: parts[0], alias: parts[1], isType: false });
    }
    return { source: base, specifiers, line, isTypeOnly: false, isDefault: false, isNamespace: false };
  }

  // Simple use: use foo::bar as baz
  const aliasParts = path.split(/\s+as\s+/);
  const cleanPath = aliasParts[0];
  const segments = cleanPath.split("::");
  specifiers.push({
    name: segments[segments.length - 1],
    alias: aliasParts[1],
    isType: false,
  });

  return { source: cleanPath, specifiers, line, isTypeOnly: false, isDefault: false, isNamespace: false };
}

function extractJavaImport(node: SyntaxNode): ExtractedImport | null {
  const text = node.text;
  const line = node.startPosition.row + 1;

  const match = text.match(/import\s+(?:static\s+)?(\S+);/);
  if (!match) return null;

  const path = match[1];
  const parts = path.split(".");
  const name = parts[parts.length - 1];

  return {
    source: path,
    specifiers: [{ name, isType: false }],
    line,
    isTypeOnly: false,
    isDefault: false,
    isNamespace: name === "*",
  };
}
